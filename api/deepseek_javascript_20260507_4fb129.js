// api/sync.js - COMPLETE UPDATED VERSION
// Stores check_in/check_out as local datetime strings (no UTC conversion)
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

        // ============================================================
        // SYNC FROM CLOUD (GET) - Return entries to client
        // ============================================================
        if (req.method === 'GET' && direction === 'from') {
            const isRecalc = req.query.recalc === 'true';
            
            let entries;
            
            if (isRecalc) {
                const today = new Date();
                const ninetyDaysAgo = new Date();
                ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
                const sevenDaysFuture = new Date();
                sevenDaysFuture.setDate(sevenDaysFuture.getDate() + 7);
                
                const cutoffDate = ninetyDaysAgo.toISOString().split('T')[0];
                const futureDate = sevenDaysFuture.toISOString().split('T')[0];
                
                console.log(`[API] Smart Recalc mode: Fetching 90d past + 7d future + all leave entries`);
                
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
                        al_adjustment,
                        sl_adjustment,
                        cl_adjustment,
                        cpl_adjustment,
                        ot_adjustment
                    FROM attendance_ledger 
                    WHERE user_id = ${user.userId} 
                    AND (
                        date >= ${cutoffDate}
                        OR date <= ${futureDate}
                        OR cpl_earned > 0
                        OR cpl_adjustment != 0
                        OR cpl_used != 0
                        OR al_accrued > 0
                        OR al_adjustment != 0
                        OR al_used != 0
                        OR sl_adjustment != 0
                        OR sl_used != 0
                        OR cl_adjustment != 0
                        OR cl_used != 0
                    )
                    ORDER BY date DESC
                    LIMIT 1000
                `;
                
            } else {
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

            // Return entries as-is - check_in/out are already local datetime strings
            // No UTC conversion needed
            return res.json({
                success: true,
                entries: entries || [],
                recalcMode: isRecalc || false
            });
        }

        // ============================================================
        // SYNC TO CLOUD (POST) - Save entries from client
        // ============================================================
        if (req.method === 'POST' && direction === 'to') {
            const { entries } = req.body;

            if (!entries || !Array.isArray(entries)) {
                return res.status(400).json({ success: false, message: 'Invalid entries' });
            }

            console.log(`[API] Syncing ${entries.length} entries to cloud for user ${user.userId}`);

            const syncedIds = [];
            const errors = [];

            for (const entry of entries) {
                try {
                    // ====================================================
                    // CRITICAL: Store check_in/out as local datetime strings
                    // No UTC conversion - preserve the local time exactly as received
                    // The app sends times like "2026-05-07 09:30:00"
                    // ====================================================
                    let checkInValue = entry.check_in;
                    let checkOutValue = entry.check_out;
                    
                    // Convert ISO format (with 'T') to space format if needed
                    if (checkInValue && typeof checkInValue === 'string' && checkInValue.includes('T')) {
                        checkInValue = checkInValue.replace('T', ' ');
                        // Remove timezone suffix if present (Z or +00:00)
                        checkInValue = checkInValue.replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
                    }
                    if (checkOutValue && typeof checkOutValue === 'string' && checkOutValue.includes('T')) {
                        checkOutValue = checkOutValue.replace('T', ' ');
                        checkOutValue = checkOutValue.replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
                    }
                    
                    // Ensure numeric values are properly parsed
                    const baseHoursRule = (entry.base_hours_rule !== undefined && entry.base_hours_rule !== null) 
                        ? parseFloat(entry.base_hours_rule) : null;
                    const otCapRule = (entry.ot_cap_rule !== undefined && entry.ot_cap_rule !== null) 
                        ? parseFloat(entry.ot_cap_rule) : null;
                    
                    const existing = await sql`
                        SELECT id FROM attendance_ledger 
                        WHERE user_id = ${user.userId} AND date = ${entry.date}
                        LIMIT 1
                    `;

                    if (existing.length > 0) {
                        // UPDATE existing record - store local times directly
                        await sql`
                            UPDATE attendance_ledger SET
                                check_in = ${checkInValue || null},
                                check_out = ${checkOutValue || null},
                                base_hours_rule = ${baseHoursRule},
                                ot_cap_rule = ${otCapRule},
                                cpl_grant_rule = ${entry.cpl_grant_rule !== undefined ? parseFloat(entry.cpl_grant_rule) : 0},
                                final_ot_hours = ${entry.final_ot_hours !== undefined ? parseFloat(entry.final_ot_hours) : 0},
                                cpl_earned = ${entry.cpl_earned !== undefined ? parseFloat(entry.cpl_earned) : 0},
                                al_used = ${entry.al_used !== undefined ? parseFloat(entry.al_used) : 0},
                                sl_used = ${entry.sl_used !== undefined ? parseFloat(entry.sl_used) : 0},
                                cl_used = ${entry.cl_used !== undefined ? parseFloat(entry.cl_used) : 0},
                                cpl_used = ${entry.cpl_used !== undefined ? parseFloat(entry.cpl_used) : 0},
                                is_off_day = ${entry.is_off_day === true || entry.is_off_day === 'true'},
                                is_holiday = ${entry.is_holiday === true || entry.is_holiday === 'true'},
                                al_accrued = ${entry.al_accrued !== undefined ? parseFloat(entry.al_accrued) : 0},
                                al_expiry_date = ${entry.al_expiry_date || null},
                                cpl_expiry_date = ${entry.cpl_expiry_date || null},
                                adjustment_note = ${entry.adjustment_note || ''},
                                al_adjustment = ${entry.al_adjustment !== undefined ? parseFloat(entry.al_adjustment) : 0},
                                sl_adjustment = ${entry.sl_adjustment !== undefined ? parseFloat(entry.sl_adjustment) : 0},
                                cl_adjustment = ${entry.cl_adjustment !== undefined ? parseFloat(entry.cl_adjustment) : 0},
                                cpl_adjustment = ${entry.cpl_adjustment !== undefined ? parseFloat(entry.cpl_adjustment) : 0},
                                ot_adjustment = ${entry.ot_adjustment !== undefined ? parseFloat(entry.ot_adjustment) : 0},
                                updated_at = NOW()
                            WHERE user_id = ${user.userId} AND date = ${entry.date}
                        `;
                        console.log(`[API] Updated entry for ${entry.date}`);
                    } else {
                        // INSERT new record - store local times directly
                        await sql`
                            INSERT INTO attendance_ledger (
                                user_id, date, check_in, check_out,
                                base_hours_rule, ot_cap_rule, cpl_grant_rule,
                                final_ot_hours, cpl_earned,
                                al_used, sl_used, cl_used, cpl_used,
                                is_off_day, is_holiday,
                                al_accrued, al_expiry_date, cpl_expiry_date,
                                adjustment_note,
                                al_adjustment, sl_adjustment, cl_adjustment,
                                cpl_adjustment, ot_adjustment,
                                created_at, updated_at, sync_status
                            ) VALUES (
                                ${user.userId}, ${entry.date}, ${checkInValue || null}, ${checkOutValue || null},
                                ${baseHoursRule},
                                ${otCapRule},
                                ${entry.cpl_grant_rule !== undefined ? parseFloat(entry.cpl_grant_rule) : 0},
                                ${entry.final_ot_hours !== undefined ? parseFloat(entry.final_ot_hours) : 0},
                                ${entry.cpl_earned !== undefined ? parseFloat(entry.cpl_earned) : 0},
                                ${entry.al_used !== undefined ? parseFloat(entry.al_used) : 0},
                                ${entry.sl_used !== undefined ? parseFloat(entry.sl_used) : 0},
                                ${entry.cl_used !== undefined ? parseFloat(entry.cl_used) : 0},
                                ${entry.cpl_used !== undefined ? parseFloat(entry.cpl_used) : 0},
                                ${entry.is_off_day === true || entry.is_off_day === 'true'},
                                ${entry.is_holiday === true || entry.is_holiday === 'true'},
                                ${entry.al_accrued !== undefined ? parseFloat(entry.al_accrued) : 0},
                                ${entry.al_expiry_date || null},
                                ${entry.cpl_expiry_date || null},
                                ${entry.adjustment_note || ''},
                                ${entry.al_adjustment !== undefined ? parseFloat(entry.al_adjustment) : 0},
                                ${entry.sl_adjustment !== undefined ? parseFloat(entry.sl_adjustment) : 0},
                                ${entry.cl_adjustment !== undefined ? parseFloat(entry.cl_adjustment) : 0},
                                ${entry.cpl_adjustment !== undefined ? parseFloat(entry.cpl_adjustment) : 0},
                                ${entry.ot_adjustment !== undefined ? parseFloat(entry.ot_adjustment) : 0},
                                NOW(), NOW(), 'synced'
                            )
                        `;
                        console.log(`[API] Inserted new entry for ${entry.date}`);
                    }
                    
                    syncedIds.push(entry.date);
                    
                } catch (err) {
                    console.error(`[API] Error syncing entry ${entry.date}:`, err);
                    errors.push({ date: entry.date, error: err.message });
                }
            }

            console.log(`[API] Sync complete: ${syncedIds.length} succeeded, ${errors.length} failed`);

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