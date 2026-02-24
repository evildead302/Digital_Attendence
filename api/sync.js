import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

function authenticate(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const user = authenticate(token);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const direction = req.query.direction;

    try {
        // SYNC FROM CLOUD (GET)
        if (req.method === 'GET' && direction === 'from') {
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            
            const entries = await sql`
                SELECT * FROM attendance_ledger 
                WHERE user_id = ${user.userId} 
                AND date >= ${ninetyDaysAgo.toISOString().split('T')[0]}
                ORDER BY date DESC
                LIMIT 500
            `;

            return res.json({
                success: true,
                entries: entries || []
            });
        }

        // SYNC TO CLOUD (POST)
        if (req.method === 'POST' && direction === 'to') {
            const { entries } = req.body;

            if (!entries || !Array.isArray(entries)) {
                return res.status(400).json({ success: false, message: 'Invalid entries' });
            }

            const syncedIds = [];

            for (const entry of entries) {
                if (!entry.date) continue;

                const existing = await sql`
                    SELECT id FROM attendance_ledger 
                    WHERE user_id = ${user.userId} AND date = ${entry.date}
                `;

                if (existing.length > 0) {
                    await sql`
                        UPDATE attendance_ledger SET
                            check_in = ${entry.check_in},
                            check_out = ${entry.check_out},
                            base_hours_rule = ${entry.base_hours_rule},
                            ot_cap_rule = ${entry.ot_cap_rule},
                            cpl_grant_rule = ${entry.cpl_grant_rule},
                            final_ot_hours = ${entry.final_ot_hours},
                            cpl_earned = ${entry.cpl_earned},
                            al_used = ${entry.al_used || 0},
                            sl_used = ${entry.sl_used || 0},
                            cl_used = ${entry.cl_used || 0},
                            cpl_used = ${entry.cpl_used || 0},
                            is_off_day = ${entry.is_off_day || false},
                            is_holiday = ${entry.is_holiday || false},
                            updated_at = NOW()
                        WHERE user_id = ${user.userId} AND date = ${entry.date}
                    `;
                } else {
                    await sql`
                        INSERT INTO attendance_ledger (
                            user_id, date, check_in, check_out,
                            base_hours_rule, ot_cap_rule, cpl_grant_rule,
                            final_ot_hours, cpl_earned,
                            al_used, sl_used, cl_used, cpl_used,
                            is_off_day, is_holiday,
                            created_at, updated_at
                        ) VALUES (
                            ${user.userId}, ${entry.date}, ${entry.check_in}, ${entry.check_out},
                            ${entry.base_hours_rule}, ${entry.ot_cap_rule}, ${entry.cpl_grant_rule},
                            ${entry.final_ot_hours}, ${entry.cpl_earned},
                            ${entry.al_used || 0}, ${entry.sl_used || 0}, ${entry.cl_used || 0}, ${entry.cpl_used || 0},
                            ${entry.is_off_day || false}, ${entry.is_holiday || false},
                            NOW(), NOW()
                        )
                    `;
                }

                syncedIds.push(entry.date);
            }

            return res.json({
                success: true,
                syncedIds
            });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('Sync error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}
