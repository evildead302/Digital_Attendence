// api/cron-backup.js
// Daily backup of every user's attendance data to a Cloudflare R2 bucket.
// Triggered once a day by Vercel Cron (see vercel.json). Each file uses the SAME format as the in-app
// backup, so it can be restored from Settings > Export Data > Backup & Restore.
//
// Files:  <prefix>/YYYY-MM-DD/user-<id>.json   and   <prefix>/YYYY-MM-DD/_summary.json
// Passwords / tokens are never included.

import { neon } from '@neondatabase/serverless';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const sql = neon(process.env.DATABASE_URL);

const PREFIX = (process.env.R2_BACKUP_PREFIX || 'attendance-backups').replace(/^\/+|\/+$/g, '');
const KEEP_DAYS = parseInt(process.env.BACKUP_KEEP_DAYS || '60', 10);   // 0 = keep forever

const pad = (n) => String(n).padStart(2, '0');

// DATE column -> 'YYYY-MM-DD'
function dateOnly(v) {
    if (!v) return v;
    if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    return String(v).slice(0, 10);
}

// TIMESTAMP column -> 'YYYY-MM-DD HH:MM:SS' (local wall-clock text, the format the app stores)
function dateTime(v) {
    if (!v) return null;
    const s = v instanceof Date ? v.toISOString() : String(v);
    return s.replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
}

function cleanRow(row) {
    const out = { ...row };
    out.date = dateOnly(row.date);
    out.check_in = dateTime(row.check_in);
    out.check_out = dateTime(row.check_out);
    if ('al_expiry_date' in out) out.al_expiry_date = dateOnly(out.al_expiry_date);
    if ('cpl_expiry_date' in out) out.cpl_expiry_date = dateOnly(out.cpl_expiry_date);
    return out;
}

async function pruneOld(s3, bucket, todayKey) {
    if (!(KEEP_DAYS > 0)) return 0;
    const cutoff = new Date(Date.parse(todayKey) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    const doomed = [];
    let token;
    do {
        const out = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX + '/', ContinuationToken: token }));
        for (const o of out.Contents || []) {
            const m = o.Key.match(/\/(\d{4}-\d{2}-\d{2})\//);
            if (m && m[1] < cutoff) doomed.push({ Key: o.Key });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    for (let i = 0; i < doomed.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: doomed.slice(i, i + 1000), Quiet: true } }));
    }
    return doomed.length;
}

export default async function handler(req, res) {
    // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET env var is set.
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'DATABASE_URL']
        .filter((k) => !process.env[k]);
    if (missing.length) {
        return res.status(500).json({ success: false, message: 'Missing environment variables: ' + missing.join(', ') });
    }

    try {
        const bucket = process.env.R2_BUCKET;
        const s3 = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
            }
        });

        const now = new Date();
        const todayKey = now.toISOString().slice(0, 10);          // UTC date used in the folder name

        const users = await sql`
            SELECT id, email, has_ot, has_cpl, limit_annual, limit_casual, limit_sick
            FROM users
            ORDER BY id
        `;
        const rows = await sql`SELECT * FROM attendance_ledger ORDER BY user_id, date`;

        const byUser = new Map();
        for (const r of rows) {
            const k = String(r.user_id);
            if (!byUser.has(k)) byUser.set(k, []);
            byUser.get(k).push(cleanRow(r));
        }

        const files = [];
        let totalEntries = 0;
        for (const u of users) {
            const entries = byUser.get(String(u.id)) || [];
            if (entries.length === 0) continue;                    // nothing to back up for this user
            const body = JSON.stringify({
                app: 'attendance',
                version: 1,
                source: 'server-cron',
                created_at: now.toISOString(),
                user: { id: u.id, email: u.email },
                settings: {
                    has_ot: u.has_ot, has_cpl: u.has_cpl,
                    limit_annual: u.limit_annual, limit_casual: u.limit_casual, limit_sick: u.limit_sick
                },
                entry_count: entries.length,
                entries
            });
            files.push({ key: `${PREFIX}/${todayKey}/user-${u.id}.json`, body, user_id: u.id, entries: entries.length });
            totalEntries += entries.length;
        }

        // upload, 5 at a time
        for (let i = 0; i < files.length; i += 5) {
            await Promise.all(files.slice(i, i + 5).map((f) => s3.send(new PutObjectCommand({
                Bucket: bucket, Key: f.key, Body: f.body, ContentType: 'application/json'
            }))));
        }

        const summary = {
            date: todayKey,
            created_at: now.toISOString(),
            users_in_db: users.length,
            users_backed_up: files.length,
            total_entries: totalEntries,
            files: files.map((f) => ({ key: f.key, user_id: f.user_id, entries: f.entries, bytes: f.body.length }))
        };
        await s3.send(new PutObjectCommand({
            Bucket: bucket, Key: `${PREFIX}/${todayKey}/_summary.json`,
            Body: JSON.stringify(summary, null, 1), ContentType: 'application/json'
        }));

        let deleted = 0;
        try { deleted = await pruneOld(s3, bucket, todayKey); }
        catch (e) { console.error('[Backup] Cleanup of old backups failed:', e.message); }

        console.log(`[Backup] ${todayKey}: ${files.length} user file(s), ${totalEntries} entries, ${deleted} old file(s) removed`);
        return res.status(200).json({ success: true, ...summary, files: undefined, old_files_deleted: deleted });
    } catch (error) {
        console.error('[Backup] Failed:', error);
        return res.status(500).json({ success: false, message: 'Backup failed: ' + (error && error.message ? error.message : 'unknown error') });
    }
}
