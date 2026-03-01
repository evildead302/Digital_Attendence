import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
    console.log(`[API] Change password request: ${req.method} ${req.url}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
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
        const { currentPassword, newPassword } = req.body;

        // Get user with current password
        const users = await sql`
            SELECT password_hash FROM users WHERE id = ${user.userId}
        `;

        if (!users || users.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }

        const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);

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

        return res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('[API] Change password error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}
