import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const user = jwt.verify(token, JWT_SECRET);
        const { from, to } = req.query;

        if (!from || !to) {
            return res.status(400).json({ success: false, message: 'Date range required' });
        }

        const entries = await sql`
            SELECT * FROM attendance_ledger 
            WHERE user_id = ${user.userId} 
            AND date >= ${from}
            AND date <= ${to}
            ORDER BY date DESC
        `;

        return res.json({
            success: true,
            entries: entries || []
        });

    } catch (error) {
        console.error('Archive error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}
