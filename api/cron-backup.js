// api/cron-backup.js
import { neon } from '@neondatabase/serverless';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const sql = neon(process.env.DATABASE_URL);

const PREFIX = (process.env.R2_BACKUP_PREFIX || 'attendance-backups').replace(/^\/+|\/+$/g, '');
const KEEP_DAYS = parseInt(process.env.BACKUP_KEEP_DAYS || '60', 10);

const pad = (n) => String(n).padStart(2, '0');

function dateOnly(v) {
    if (!v) return v;
    if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    return String(v).slice(0, 10);
}
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

// ---------- DEBUG HANDLER ----------
async function handleDebug(req, res) {
    const out = {
        step: 'start',
        env: {},
        auth: {},
        db: {},
        r2: {},
        errors: []
    };

    // 1. Env vars
    const envKeys = [
        'CRON_SECRET', 'CRON_SECRET_1',
        'DATABASE_URL',
        'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_BACKUP_PREFIX', 'BACKUP_KEEP_DAYS'
    ];
    for (const k of envKeys) {
        const v = process.env[k];
        out.env[k] = {
            present: !!v,
            length: v ? v.length : 0,
            // show a tiny hint without leaking the full secret
            preview: v ? (v.length <= 6 ? v : v.slice(0, 3) + '…' + v.slice(-2)) : null
        };
    }

    // 2. Auth check
    const secret = process.env.CRON_SECRET_1 || process.env.CRON_SECRET;
    out.auth = {
        active_secret_source: process.env.CRON_SECRET_1 ? 'CRON_SECRET_1' : (process.env.CRON_SECRET ? 'CRON_SECRET' : 'none'),
        header_received: req.headers.authorization ? 'yes' : 'no',
        header_matches: !!(secret && req.headers.authorization === `Bearer ${secret}`),
        query_secret_received: req.query?.secret ? 'yes' : 'no',
        query_secret_matches: !!(secret && req.query?.secret === secret),
        query_secret_length: (req.query?.secret || '').length,
        expected_secret_length: (secret || '').length
    };

    // 3. DB connection test
    out.step = 'db';
    try {
        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
        const t0 = Date.now();
        const r = await sql`SELECT 1 AS ok`;
        out.db.connected = r?.[0]?.ok === 1;
        out.db.latency_ms = Date.now() - t0;
        const cnt = await sql`SELECT COUNT(*)::int AS n FROM users`;
        out.db.users_count = cnt?.[0]?.n ?? null;
        const cnt2 = await sql`SELECT COUNT(*)::int AS n FROM attendance_ledger`;
        out.db.entries_count = cnt2?.[0]?.n ?? null;
    } catch (e) {
        out.db.connected = false;
        out.errors.push('DB: ' + e.message);
    }

    // 4. R2 connection test
    out.step = 'r2';
    const missingR2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
        .filter((k) => !process.env[k]);
    out.r2.missing_env = missingR2;
    if (!missingR2.length) {
        try {
            const s3 = new S3Client({
                region: 'auto',
                endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId: process.env.R2_ACCESS_KEY_ID,
                    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
                }
            });
            out.r2.endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
            out.r2.bucket = process.env.R2_BUCKET;

            // 4a. HeadBucket
            try {
                await s3.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET }));
                out.r2.head_bucket = 'ok';
            } catch (e) {
                out.r2.head_bucket = 'failed: ' + e.message;
                out.errors.push('R2 HeadBucket: ' + e.message);
            }

            // 4b. Put a tiny test object
            const testKey = `${PREFIX}/_debug/ping-${Date.now()}.json`;
            try {
                await s3.send(new PutObjectCommand({
                    Bucket: process.env.R2_BUCKET,
                    Key: testKey,
                    Body: JSON.stringify({ ping: true, at: new Date().toISOString() }),
                    ContentType: 'application/json'
                }));
                out.r2.put_object = 'ok';
                out.r2.test_key = testKey;
            } catch (e) {
                out.r2.put_object = 'failed: ' + e.message;
                out.errors.push('R2 PutObject: ' + e.message);
            }

            // 4c. List (proves read permission)
            try {
                const list = await s3.send(new ListObjectsV2Command({
                    Bucket: process.env.R2_BUCKET,
                    Prefix: PREFIX + '/',
                    MaxKeys: 5
                }));
                out.r2.list_object = 'ok';
                out.r2.sample_keys = (list.Contents || []).map((o) => o.Key);
            } catch (e) {
                out.r2.list_object = 'failed: ' + e.message;
                out.errors.push('R2 List: ' + e.message);
            }

            // 4d. Cleanup test object
            if (out.r2.put_object === 'ok') {
                try {
                    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: testKey }));
                    out.r2.delete_object = 'ok';
                } catch (e) {
                    out.r2.delete_object = 'failed: ' + e.message;
                    out.errors.push('R2 Delete: ' + e.message);
                }
            }
        } catch (e) {
            out.errors.push('R2 client init: ' + e.message);
        }
    } else {
        out.errors.push('R2 env vars missing: ' + missingR2.join(', '));
    }

    out.step = 'done';
    out.success = out.errors.length === 0;
    return res.status(200).json(out);
}

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
    // ---- DEBUG MODE ----
    if (req.query?.debug === '1') {
        return handleDebug(req, res);
    }

    // ---- AUTH ----
    const secret = process.env.CRON_SECRET_1 || process.env.CRON_SECRET;
    const headerOk = secret && req.headers.authorization === `Bearer ${secret}`;
    const queryOk  = secret && req.query?.secret === secret;
    if (!headerOk && !queryOk) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized',
            hint: {
                active_secret_source: process.env.CRON_SECRET_1 ? 'CRON_SECRET_1' : (process.env.CRON_SECRET ? 'CRON_SECRET' : 'none'),
                secret_present: !!secret,
                header_present: !!req.headers.authorization,
                query_secret_present: !!req.query?.secret,
                // lengths only — do NOT leak values
                expected_len: (secret || '').length,
                received_query_len: (req.query?.secret || '').length
            }
        });
    }

    // ---- ENV CHECK ----
    const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'DATABASE_URL']
        .filter((k) => !process.env[k]);
    if (missing.length) {
        return res.status(500).json({ success: false, message: 'Missing environment variables: ' + missing.join(', ') });
    }

    // ---- RUN BACKUP ----
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
        const todayKey = now.toISOString().slice(0, 10);

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
            if (entries.length === 0) continue;
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
        return res.status(200).json({ success: true, ...summary, old_files_deleted: deleted });
    } catch (error) {
        console.error('[Backup] Failed:', error);
        return res.status(500).json({ success: false, message: 'Backup failed: ' + (error && error.message ? error.message : 'unknown error') });
    }
}
