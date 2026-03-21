import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
    console.log(`[API] Delete account request: ${req.method} ${req.url}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'DELETE') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    // Auth check
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const user = jwt.verify(token, JWT_SECRET);

        // Delete all user entries first
        await sql`DELETE FROM attendance_ledger WHERE user_id = ${user.userId}`;
        // Then delete user account
        await sql`DELETE FROM users WHERE id = ${user.userId}`;

        console.log(`[API] Account deleted for user: ${user.userId}`);

        return res.json({
            success: true,
            message: 'Account permanently deleted'
        });

    } catch (error) {
        console.error('[API] Delete account error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}
