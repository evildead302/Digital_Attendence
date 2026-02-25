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
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Auth check
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
            // Get last 90 days of data - optimized query
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            
            const entries = await sql`
                SELECT date, check_in, check_out, base_hours_rule, ot_cap_rule, 
                       cpl_grant_rule, final_ot_hours, cpl_earned, al_used, sl_used, 
                       cl_used, cpl_used, is_off_day, is_holiday
                FROM attendance_ledger 
                WHERE user_id = ${user.userId} 
                AND date >= ${ninetyDaysAgo.toISOString().split('T')[0]}
                ORDER BY date DESC
                LIMIT 200
            `;

            return res.json({
                success: true,
                entries: entries || []
            });
        }

        // SYNC TO CLOUD (POST) - OPTIMIZED FOR SPEED
        if (req.method === 'POST' && direction === 'to') {
            const { entries } = req.body;

            if (!entries || !Array.isArray(entries)) {
                return res.status(400).json({ success: false, message: 'Invalid entries' });
            }

            // Limit batch size to prevent timeout
            if (entries.length > 50) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Too many entries. Please sync in batches of 50 or less.' 
                });
            }

            const syncedIds = [];
            const errors = [];

            // Process entries with error handling
            for (const entry of entries) {
                try {
                    // Check if entry exists
                    const existing = await sql`
                        SELECT id FROM attendance_ledger 
                        WHERE user_id = ${user.userId} AND date = ${entry.date}
                        LIMIT 1
                    `;

                    if (existing.length > 0) {
                        // Update existing entry
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
                        // Insert new entry
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
                    
                } catch (err) {
                    console.error('Error syncing entry:', err);
                    errors.push({ date: entry.date, error: err.message });
                }
            }

            return res.json({
                success: true,
                syncedIds,
                errors: errors.length > 0 ? errors : undefined
            });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('Sync error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
}
