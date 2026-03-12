import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
    console.log(`[API] Sync request: ${req.method} ${req.url}`);

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
    try {
        const user = jwt.verify(token, JWT_SECRET);
        const direction = req.query.direction;

        // SYNC FROM CLOUD (GET)
        if (req.method === 'GET' && direction === 'from') {
            // Check if this is a recalculation request
            const isRecalc = req.query.recalc === 'true';
            
            let entries;
            
            if (isRecalc) {
                // FOR RECALCULATE ALL: 
                // 1. Fetch 90 days past from today
                // 2. Fetch 7 days future from today
                // 3. Fetch ALL entries with leave values (earned, adjustment, used)
                //    OT is NOT included as it's covered by 90-day range
                
                const today = new Date();
                const ninetyDaysAgo = new Date();
                ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
                const sevenDaysFuture = new Date();
                sevenDaysFuture.setDate(sevenDaysFuture.getDate() + 7);
                
                const cutoffDate = ninetyDaysAgo.toISOString().split('T')[0];
                const futureDate = sevenDaysFuture.toISOString().split('T')[0];
                
                console.log(`[API] Smart Recalc mode: Fetching 90d past + 7d future + all leave entries (OT excluded)`);
                
                entries = await sql`
                    SELECT 
                        date, 
                        check_in, 
                        check_out, 
                        base_hours_rule, 
                        ot_cap_rule, 
                        cpl_grant_rule, 
                        final_ot_hours, 
                        cpl_earned, 
                        al_used, 
                        sl_used, 
                        cl_used, 
                        cpl_used, 
                        is_off_day, 
                        is_holiday,
                        al_accrued,
                        al_expiry_date,
                        cpl_expiry_date,
                        adjustment_note,
                        -- ADJUSTMENT FIELDS
                        al_adjustment,
                        sl_adjustment,
                        cl_adjustment,
                        cpl_adjustment,
                        ot_adjustment
                    FROM attendance_ledger 
                    WHERE user_id = ${user.userId} 
                    AND (
                        -- 90 days past
                        date >= ${cutoffDate}
                        OR
                        -- 7 days future
                        date <= ${futureDate}
                        OR
                        -- ALL entries with CPL earned > 0
                        cpl_earned > 0
                        OR
                        -- ALL entries with CPL adjustment ≠ 0
                        cpl_adjustment != 0
                        OR
                        -- ALL entries with CPL used ≠ 0 (can be 1 or -1)
                        cpl_used != 0
                        OR
                        -- ALL entries with AL accrued > 0
                        al_accrued > 0
                        OR
                        -- ALL entries with AL adjustment ≠ 0
                        al_adjustment != 0
                        OR
                        -- ALL entries with AL used ≠ 0 (can be 1 or -1)
                        al_used != 0
                        OR
                        -- ALL entries with SL adjustment ≠ 0
                        sl_adjustment != 0
                        OR
                        -- ALL entries with SL used ≠ 0 (can be 1 or -1)
                        sl_used != 0
                        OR
                        -- ALL entries with CL adjustment ≠ 0
                        cl_adjustment != 0
                        OR
                        -- ALL entries with CL used ≠ 0 (can be 1 or -1)
                        cl_used != 0
                    )
                    ORDER BY date DESC
                    LIMIT 1000
                `;
                
            } else {
                // Normal sync: only last 90 days
                const ninetyDaysAgo = new Date();
                ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
                const cutoffDate = ninetyDaysAgo.toISOString().split('T')[0];

                entries = await sql`
                    SELECT 
                        date, 
                        check_in, 
                        check_out, 
                        base_hours_rule, 
                        ot_cap_rule, 
                        cpl_grant_rule, 
                        final_ot_hours, 
                        cpl_earned, 
                        al_used, 
                        sl_used, 
                        cl_used, 
                        cpl_used, 
                        is_off_day, 
                        is_holiday,
                        al_accrued,
                        al_expiry_date,
                        cpl_expiry_date,
                        adjustment_note,
                        -- ADJUSTMENT FIELDS
                        al_adjustment,
                        sl_adjustment,
                        cl_adjustment,
                        cpl_adjustment,
                        ot_adjustment
                    FROM attendance_ledger 
                    WHERE user_id = ${user.userId} 
                    AND date >= ${cutoffDate}
                    ORDER BY date DESC
                    LIMIT 200
                `;
            }

            return res.json({
                success: true,
                entries: entries || [],
                recalcMode: isRecalc || false
            });
        }

        // SYNC TO CLOUD (POST)
        if (req.method === 'POST' && direction === 'to') {
            const { entries } = req.body;

            if (!entries || !Array.isArray(entries)) {
                return res.status(400).json({ success: false, message: 'Invalid entries' });
            }

            const syncedIds = [];
            const errors = [];

            for (const entry of entries) {
                try {
                    const existing = await sql`
                        SELECT id FROM attendance_ledger 
                        WHERE user_id = ${user.userId} AND date = ${entry.date}
                        LIMIT 1
                    `;

                    if (existing.length > 0) {
                        // UPDATE existing record - include all adjustment fields
                        await sql`
                            UPDATE attendance_ledger SET
                                check_in = ${entry.check_in},
                                check_out = ${entry.check_out},
                                base_hours_rule = ${entry.base_hours_rule},
                                ot_cap_rule = ${entry.ot_cap_rule},
                                cpl_grant_rule = ${entry.cpl_grant_rule || 0},
                                final_ot_hours = ${entry.final_ot_hours || 0},
                                cpl_earned = ${entry.cpl_earned || 0},
                                al_used = ${entry.al_used || 0},
                                sl_used = ${entry.sl_used || 0},
                                cl_used = ${entry.cl_used || 0},
                                cpl_used = ${entry.cpl_used || 0},
                                is_off_day = ${entry.is_off_day || false},
                                is_holiday = ${entry.is_holiday || false},
                                al_accrued = ${entry.al_accrued || 0},
                                al_expiry_date = ${entry.al_expiry_date || null},
                                cpl_expiry_date = ${entry.cpl_expiry_date || null},
                                adjustment_note = ${entry.adjustment_note || ''},
                                -- ADJUSTMENT FIELDS
                                al_adjustment = ${entry.al_adjustment || 0},
                                sl_adjustment = ${entry.sl_adjustment || 0},
                                cl_adjustment = ${entry.cl_adjustment || 0},
                                cpl_adjustment = ${entry.cpl_adjustment || 0},
                                ot_adjustment = ${entry.ot_adjustment || 0},
                                updated_at = NOW()
                            WHERE user_id = ${user.userId} AND date = ${entry.date}
                        `;
                    } else {
                        // INSERT new record - include all adjustment fields
                        await sql`
                            INSERT INTO attendance_ledger (
                                user_id, date, check_in, check_out,
                                base_hours_rule, ot_cap_rule, cpl_grant_rule,
                                final_ot_hours, cpl_earned,
                                al_used, sl_used, cl_used, cpl_used,
                                is_off_day, is_holiday,
                                al_accrued, al_expiry_date, cpl_expiry_date,
                                adjustment_note,
                                -- ADJUSTMENT FIELDS
                                al_adjustment,
                                sl_adjustment,
                                cl_adjustment,
                                cpl_adjustment,
                                ot_adjustment,
                                created_at, updated_at
                            ) VALUES (
                                ${user.userId}, ${entry.date}, ${entry.check_in}, ${entry.check_out},
                                ${entry.base_hours_rule}, ${entry.ot_cap_rule}, ${entry.cpl_grant_rule || 0},
                                ${entry.final_ot_hours || 0}, ${entry.cpl_earned || 0},
                                ${entry.al_used || 0}, ${entry.sl_used || 0}, ${entry.cl_used || 0}, ${entry.cpl_used || 0},
                                ${entry.is_off_day || false}, ${entry.is_holiday || false},
                                ${entry.al_accrued || 0}, ${entry.al_expiry_date || null}, ${entry.cpl_expiry_date || null},
                                ${entry.adjustment_note || ''},
                                -- ADJUSTMENT VALUES
                                ${entry.al_adjustment || 0},
                                ${entry.sl_adjustment || 0},
                                ${entry.cl_adjustment || 0},
                                ${entry.cpl_adjustment || 0},
                                ${entry.ot_adjustment || 0},
                                NOW(), NOW()
                            )
                        `;
                    }
                    
                    syncedIds.push(entry.date);
                    
                } catch (err) {
                    console.error(`[API] Error syncing entry ${entry.date}:`, err);
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
        console.error('[API] Sync error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}