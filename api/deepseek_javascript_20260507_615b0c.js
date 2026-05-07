// api/archive.js - COMPLETE UPDATED VERSION
// Returns check_in/check_out as local datetime strings (no UTC conversion)
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
    console.log(`[Archive] Request: ${req.method} ${req.url}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow GET
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        const user = jwt.verify(token, JWT_SECRET);
        
        const { date, from, to } = req.query;

        // ============================================================
        // Handle single date request (used by fetchFromCloud)
        // ============================================================
        if (date) {
            console.log(`[Archive] Fetching single date: ${date} for user ${user.userId}`);
            
            const entries = await sql`
                SELECT * FROM attendance_ledger 
                WHERE user_id = ${user.userId} 
                AND date = ${date}
                LIMIT 1
            `;
            
            if (entries && entries.length > 0) {
                let entry = entries[0];
                
                // ====================================================
                // IMPORTANT: check_in and check_out are stored as local datetime strings
                // Format stored: "YYYY-MM-DD HH:MM:SS"
                // Return them as-is - NO UTC conversion
                // ====================================================
                console.log(`[Archive] Found entry for ${date}`);
                console.log(`[Archive] check_in (stored): ${entry.check_in}`);
                console.log(`[Archive] check_out (stored): ${entry.check_out}`);
                
                return res.json({
                    success: true,
                    entry: entry
                });
            } else {
                console.log(`[Archive] No entry found for ${date}`);
                return res.json({
                    success: true,
                    entry: null
                });
            }
        }
        
        // ============================================================
        // Handle date range request
        // ============================================================
        if (!from || !to) {
            return res.status(400).json({ 
                success: false, 
                message: 'Either date parameter or from/to range required' 
            });
        }

        console.log(`[Archive] Fetching date range: ${from} to ${to} for user ${user.userId}`);

        const entries = await sql`
            SELECT * FROM attendance_ledger 
            WHERE user_id = ${user.userId} 
            AND date >= ${from}
            AND date <= ${to}
            ORDER BY date DESC
        `;

        console.log(`[Archive] Found ${entries.length} entries for date range`);

        // ====================================================
        // Return entries as-is - check_in/out are already local datetime strings
        // Format stored: "YYYY-MM-DD HH:MM:SS"
        // Return them as-is - NO UTC conversion
        // ====================================================
        return res.json({
            success: true,
            entries: entries || []
        });

    } catch (error) {
        console.error('[Archive] Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
}