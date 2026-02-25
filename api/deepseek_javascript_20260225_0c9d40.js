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
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
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

    // Set a timeout to prevent hanging
    let isTimedOut = false;
    const timeout = setTimeout(() => {
        isTimedOut = true;
        console.log('[API] ⚠️ Request timeout reached (9 seconds)');
        res.status(504).json({ 
            success: false, 
            message: 'Sync timeout - please try with fewer entries' 
        });
    }, 9000); // 9 second timeout (Vercel has 10s limit)

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
                SELECT date, check_in, check_out, base_hours_rule, ot_cap_rule, 
                       cpl_grant_rule, final_ot_hours, cpl_earned, al_used, sl_used, 
                       cl_used, cpl_used, is_off_day, is_holiday
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

            // Check if too many entries
            if (entries.length > 50) {
                console.log(`[API] ERROR: Too many entries (${entries.length}) - limit 50`);
                clearTimeout(timeout);
                return res.status(400).json({ 
                    success: false, 
                    message: 'Too many entries. Please sync in batches of 50 or less.' 
                });
            }

            // Log all entries for debugging
            console.log('[API] === ENTRIES TO SYNC ===');
            entries.forEach((entry, index) => {
                console.log(`[API] Entry ${index + 1}:`, JSON.stringify({
                    date: entry.date,
                    check_in: entry.check_in,
                    check_out: entry.check_out,
                    base_hours: entry.base_hours_rule,
                    ot_cap: entry.ot_cap_rule,
                    cpl_grant: entry.cpl_grant_rule,
                    final_ot: entry.final_ot_hours,
                    cpl_earned: entry.cpl_earned,
                    al_used: entry.al_used,
                    sl_used: entry.sl_used,
                    cl_used: entry.cl_used,
                    cpl_used: entry.cpl_used,
                    is_off_day: entry.is_off_day,
                    is_holiday: entry.is_holiday
                }));
            });

            const syncedIds = [];
            const errors = [];

            // Process entries one by one
            for (let i = 0; i < entries.length; i++) {
                if (isTimedOut) {
                    console.log(`[API] ⚠️ Timeout approaching, stopping at entry ${i+1}`);
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
                        console.log(`[API] ✅ Inserted entry: ${entry.date}`);
                    }
                    
                    const dbEndTime = Date.now();
                    console.log(`[API] Database operation took ${dbEndTime - dbStartTime}ms`);
                    
                    syncedIds.push(entry.date);
                    
                } catch (err) {
                    console.error(`[API] ❌ Error syncing entry ${entry.date}:`, err);
                    errors.push({ date: entry.date, error: err.message });
                }
                
                // Small delay between entries to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            const totalTime = Date.now() - startTime;
            console.log(`[API] === SYNC RESULTS ===`);
            console.log(`[API] Total time: ${totalTime}ms`);
            console.log(`[API] Successfully synced: ${syncedIds.length} entries`);
            console.log(`[API] Failed: ${errors.length} entries`);
            if (errors.length > 0) {
                console.log(`[API] Errors:`, errors);
            }

            clearTimeout(timeout);
            console.log(`[API] SYNC TO CLOUD completed in ${totalTime}ms`);
            console.log(`[API] ========== SYNC REQUEST ENDED ==========`);
            
            return res.json({
                success: true,
                syncedIds,
                errors: errors.length > 0 ? errors : undefined
            });
        }

        console.log(`[API] Method not allowed: ${req.method} ${direction}`);
        clearTimeout(timeout);
        console.log(`[API] ========== SYNC REQUEST ENDED ==========`);
        
        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('[API] ❌ Unhandled error:', error);
        console.error('[API] Error stack:', error.stack);
        
        clearTimeout(timeout);
        console.log(`[API] ========== SYNC REQUEST ENDED WITH ERROR ==========`);
        
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error',
            error: error.message 
        });
    }
}