// api/account.js
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

// Helper function to verify JWT token
function verifyToken(authHeader) {
    if (!authHeader) return null;
    const token = authHeader.split(' ')[1];
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

export default async function handler(req, res) {
    console.log(`[API] Account request: ${req.method}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;

    // Map actions to handlers
    const handlers = {
        'change-password': handleChangePassword,
        'forgot-password': handleForgotPassword,
        'reset-password': handleResetPassword,
        'reset-data': handleResetData,
        'delete-account': handleDeleteAccount
    };

    if (action && handlers[action]) {
        return handlers[action](req, res);
    }

    return res.status(400).json({ 
        success: false, 
        message: 'Invalid action. Use: change-password, forgot-password, reset-password, reset-data, or delete-account' 
    });
}

// ==================== CHANGE PASSWORD ====================
async function handleChangePassword(req, res) {
    console.log(`[API] Change password request: ${req.method}`);

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current password and new password required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }

        const users = await sql`
            SELECT password_hash FROM users WHERE id = ${user.userId}
        `;

        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);

        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await sql`
            UPDATE users SET password_hash = ${hashedPassword} WHERE id = ${user.userId}
        `;

        console.log(`[API] Password changed for user: ${user.userId}`);

        return res.status(200).json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('[API] Change password error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== FORGOT PASSWORD (Initiate OTP for password reset) ====================
async function handleForgotPassword(req, res) {
    console.log(`[API] Forgot password request: ${req.method}`);

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if user exists
        const users = await sql`
            SELECT id, email, name, is_verified 
            FROM users 
            WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            console.log(`[API] Forgot password attempted for non-existent email: ${normalizedEmail}`);
            return res.status(200).json({
                success: true,
                message: 'If an account exists with this email, you will receive OTP instructions',
                requiresVerification: false
            });
        }

        const user = users[0];

        // Check if email is verified
        if (!user.is_verified) {
            return res.status(403).json({
                success: false,
                message: 'Please verify your email before resetting password',
                requiresVerification: true,
                email: user.email
            });
        }

        // Generate OTP for password reset
        try {
            const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
            
            console.log(`[API] Calling generate-otp for password reset: ${normalizedEmail}`);
            
            const otpResponse = await fetch(`${baseUrl}/api/generate-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: normalizedEmail, 
                    purpose: 'reset' 
                })
            });

            console.log(`[API] generate-otp response status: ${otpResponse.status}`);

            if (!otpResponse.ok) {
                const errorText = await otpResponse.text();
                console.error(`[API] generate-otp failed: ${otpResponse.status} - ${errorText}`);
                throw new Error('Failed to generate OTP');
            }

            const otpData = await otpResponse.json();
            
            console.log(`[API] Password reset OTP generated for: ${normalizedEmail}`);
            console.log(`[API] OTP Code: ${otpData.otpCode}`);
            console.log(`[API] App Email: ${otpData.appEmail}`);
            console.log(`[API] Expiry: ${otpData.expiry}`);

            return res.status(200).json({
                success: true,
                message: 'OTP generated for password reset',
                requiresVerification: true,
                email: user.email,
                otpCode: otpData.otpCode,
                appEmail: otpData.appEmail,
                expiry: otpData.expiry
            });

        } catch (otpError) {
            console.error('[API] Failed to generate OTP for password reset:', otpError);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate verification code. Please try again.'
            });
        }

    } catch (error) {
        console.error('[API] Forgot password error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}

// ==================== RESET PASSWORD (After OTP verification) ====================
async function handleResetPassword(req, res) {
    console.log(`[API] Reset password request: ${req.method}`);

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { email, newPassword } = req.body;

        if (!email || !newPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and new password required' 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters' 
            });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if user exists
        const users = await sql`
            SELECT id FROM users WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await sql`
            UPDATE users 
            SET password_hash = ${hashedPassword}
            WHERE email = ${normalizedEmail}
        `;

        console.log(`[API] Password reset successful for: ${normalizedEmail}`);

        return res.status(200).json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        console.error('[API] Reset password error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}

// ==================== RESET DATA (Clear entries only) ====================
async function handleResetData(req, res) {
    console.log(`[API] Reset data request: ${req.method}`);

    if (req.method !== 'DELETE') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        await sql`DELETE FROM attendance_ledger WHERE user_id = ${user.userId}`;

        console.log(`[API] All data reset for user: ${user.userId}`);

        return res.status(200).json({
            success: true,
            message: 'All data deleted successfully'
        });

    } catch (error) {
        console.error('[API] Reset data error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== DELETE ACCOUNT ====================
async function handleDeleteAccount(req, res) {
    console.log(`[API] Delete account request: ${req.method}`);

    if (req.method !== 'DELETE') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        await sql`DELETE FROM attendance_ledger WHERE user_id = ${user.userId}`;
        await sql`DELETE FROM users WHERE id = ${user.userId}`;

        console.log(`[API] Account deleted for user: ${user.userId}`);

        return res.status(200).json({
            success: true,
            message: 'Account permanently deleted'
        });

    } catch (error) {
        console.error('[API] Delete account error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}