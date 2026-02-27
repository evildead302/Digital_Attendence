import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

function authenticate(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        console.log('[API] Auth error:', error.message);
        return null;
    }
}

export default async function handler(req, res) {
    const startTime = Date.now();
    console.log(`[API] ========== SYNC REQUEST STARTED ==========`);
    console.log(`[API] Method: ${req.method}`);
    console.log(`[API] URL: ${req.url}`);
    console.log(`[API] Query:`, req.query);
    console.log(`[API] Time: ${new Date().toISOString()}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS
    if (req.method === 'OPTIONS') {
        console.log('[API] OPTIONS request - returning 200');
        return res.status(200).end();
    }

    // Auth check
    const authHeader = req.headers.authorization;
    console.log('[API] Auth header present:', !!authHeader);
    
    if (!authHeader) {
        console.log('[API] ERROR: No authorization header');
        return res.status(401).json({ success: false, message: 'Unauthorized - no token' });
    }

    const token = authHeader.split(' ')[1];
    console.log('[API] Token extracted:', token ? `${token.substring(0, 20)}...` : 'none');
    
    const user = authenticate(token);
    if (!user) {
        console.log('[API] ERROR: Invalid token');
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    console.log(`[API] User authenticated: ID=${user.userId}, Email=${user.email}`);

    const direction = req.query.direction;
    console.log(`[API] Direction: ${direction}`);

    // Set a timeout to prevent hanging - 9 seconds (Vercel has 10s limit)
    let isTimedOut = false;
    const timeout = setTimeout(() => {
        isTimedOut = true;
        console.log('[API] ⚠️ Request timeout reached (9 seconds)');
        res.status(504).json({ 
            success: false, 
            message: 'Sync timeout - please try with fewer entries' 
        });
    }, 9000);

    try {
        // SYNC FROM CLOUD (GET)
        if (req.method === 'GET' && direction === 'from') {
            console.log('[API] Processing SYNC FROM CLOUD request');
            
            if (isTimedOut) {
                console.log('[API] Request already timed out');
                return;
            }
            
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const cutoffDate = ninetyDaysAgo.toISOString().split('T')[0];
            
            console.log(`[API] Fetching entries since: ${cutoffDate} for user: ${user.userId}`);
            
            const dbStartTime = Date.now();
            const entries = await sql`
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
                    adjustment_note
                FROM attendance_ledger 
                WHERE user_id = ${user.userId} 
                AND date >= ${cutoffDate}
                ORDER BY date DESC
                LIMIT 200
            `;
            const dbEndTime = Date.now();
            
            console.log(`[API] Database query took ${dbEndTime - dbStartTime}ms`);
            console.log(`[API] Found ${entries.length} entries`);
            
            if (entries.length > 0) {
                console.log(`[API] Sample entry:`, JSON.stringify(entries[0]));
            }

            clearTimeout(timeout);
            console.log(`[API] SYNC FROM CLOUD completed in ${Date.now() - startTime}ms`);
            console.log(`[API] ========== SYNC REQUEST ENDED ==========`);
            
            return res.json({
                success: true,
                entries: entries || []
            });
        }

        // SYNC TO CLOUD (POST)
        if (req.method === 'POST' && direction === 'to') {
            console.log('[API] Processing SYNC TO CLOUD request');
            
            if (isTimedOut) {
                console.log('[API] Request already timed out');
                return;
            }
            
            const { entries } = req.body;
            
            console.log(`[API] Received ${entries?.length || 0} entries to sync`);
            
            if (!entries || !Array.isArray(entries)) {
                console.log('[API] ERROR: Invalid entries format');
                clearTimeout(timeout);
                return res.status(400).json({ success: false, message: 'Invalid entries' });
            }

            // Log entries for debugging
            console.log('[API] === ENTRIES TO SYNC ===');
            entries.forEach((entry, index) => {
                console.log(`[API] Entry ${index + 1}:`, JSON.stringify({
                    date: entry.date,
                    check_in: entry.check_in,
                    check_out: entry.check_out,
                    al_accrued: entry.al_accrued,
                    al_expiry: entry.al_expiry_date,
                    cpl_expiry: entry.cpl_expiry_date
                }));
            });

            const syncedIds = [];
            const errors = [];

            // Process entries one by one
            for (let i = 0; i < entries.length; i++) {
                // Check timeout before each entry
                if (isTimedOut || Date.now() - startTime > 8500) {
                    console.log(`[API] ⚠️ Timeout approaching, stopping after ${i} entries`);
                    break;
                }
                
                const entry = entries[i];
                
                try {
                    console.log(`[API] [${i+1}/${entries.length}] Processing entry for date: ${entry.date}`);
                    
                    const dbStartTime = Date.now();
                    
                    // Check if entry exists
                    const existing = await sql`
                        SELECT id FROM attendance_ledger 
                        WHERE user_id = ${user.userId} AND date = ${entry.date}
                        LIMIT 1
                    `;

                    if (existing.length > 0) {
                        // Update existing entry
                        console.log(`[API] Entry exists, updating...`);
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
                                updated_at = NOW()
                            WHERE user_id = ${user.userId} AND date = ${entry.date}
                        `;
                        console.log(`[API] ✅ Updated entry: ${entry.date}`);
                    } else {
                        // Insert new entry
                        console.log(`[API] New entry, inserting...`);
                        await sql`
                            INSERT INTO attendance_ledger (
                                user_id, date, check_in, check_out,
                                base_hours_rule, ot_cap_rule, cpl_grant_rule,
                                final_ot_hours, cpl_earned,
                                al_used, sl_used, cl_used, cpl_used,
                                is_off_day, is_holiday,
                                al_accrued, al_expiry_date, cpl_expiry_date,
                                adjustment_note,
                                created_at, updated_at
                            ) VALUES (
                                ${user.userId}, ${entry.date}, ${entry.check_in}, ${entry.check_out},
                                ${entry.base_hours_rule}, ${entry.ot_cap_rule}, ${entry.cpl_grant_rule || 0},
                                ${entry.final_ot_hours || 0}, ${entry.cpl_earned || 0},
                                ${entry.al_used || 0}, ${entry.sl_used || 0}, ${entry.cl_used || 0}, ${entry.cpl_used || 0},
                                ${entry.is_off_day || false}, ${entry.is_holiday || false},
                                ${entry.al_accrued || 0}, ${entry.al_expiry_date || null}, ${entry.cpl_expiry_date || null},
                                ${entry.adjustment_note || ''},
                                NOW(), NOW()
                            )
                        `;
                        console.log(`[API] ✅ Inserted entry: ${entry.date}`);
                    }
                    
                    const dbEndTime = Date.now();
                    console.log(`[API] Database operation took ${dbEndTime - dbStartTime}ms`);
                    
                    syncedIds.push(entry.date);
                    
                } catch (err) {
                    console.error(`[API] ❌ Error syncing entry ${entry.date}:`, err);
                    errors.push({ date: entry.date, error: err.message });
                }
                
                // Small delay between entries
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const totalTime = Date.now() - startTime;
            console.log(`[API] === SYNC RESULTS ===`);
            console.log(`[API] Total time: ${totalTime}ms`);
            console.log(`[API] Successfully synced: ${syncedIds.length} entries`);
            console.log(`[API] Failed: ${errors.length} entries`);
            
            clearTimeout(timeout);
            
            return res.json({
                success: true,
                syncedIds,
                errors: errors.length > 0 ? errors : undefined
            });
        }

        // DELETE ACCOUNT
        if (req.method === 'DELETE' && req.url === '/api/delete-account') {
            console.log('[API] Processing DELETE ACCOUNT request');
            
            // Delete all user data from database
            await sql`DELETE FROM attendance_ledger WHERE user_id = ${user.userId}`;
            await sql`DELETE FROM users WHERE id = ${user.userId}`;
            
            console.log(`[API] Account deleted for user: ${user.userId}`);
            
            clearTimeout(timeout);
            return res.json({
                success: true,
                message: 'Account permanently deleted'
            });
        }

        // CHANGE PASSWORD
        if (req.method === 'POST' && req.url === '/api/change-password') {
            console.log('[API] Processing CHANGE PASSWORD request');
            
            const { currentPassword, newPassword } = req.body;
            
            // Verify current password
            const user = await sql`
                SELECT password_hash FROM users WHERE id = ${user.userId}
            `;
            
            if (!user || user.length === 0) {
                return res.status(401).json({ success: false, message: 'User not found' });
            }
            
            const bcrypt = require('bcryptjs');
            const isValid = await bcrypt.compare(currentPassword, user[0].password_hash);
            
            if (!isValid) {
                return res.status(401).json({ success: false, message: 'Current password is incorrect' });
            }
            
            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            
            // Update password
            await sql`
                UPDATE users SET password_hash = ${hashedPassword} WHERE id = ${user.userId}
            `;
            
            console.log(`[API] Password changed for user: ${user.userId}`);
            
            clearTimeout(timeout);
            return res.json({
                success: true,
                message: 'Password changed successfully'
            });
        }

        console.log(`[API] Method not allowed: ${req.method} ${direction}`);
        clearTimeout(timeout);
        
        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('[API] ❌ Unhandled error:', error);
        console.error('[API] Error stack:', error.stack);
        
        clearTimeout(timeout);
        
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error',
            error: error.message 
        });
    }
}
