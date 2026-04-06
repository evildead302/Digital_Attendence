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
    console.log(`[API] Account request URL: ${req.url}`);
    console.log(`[API] Account request query params:`, req.query);
    console.log(`[API] Account request body:`, req.body);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        console.log(`[API] OPTIONS request handled`);
        return res.status(200).end();
    }

    const { action } = req.query;
    console.log(`[API] Account action: ${action}`);

    // Map actions to handlers
    const handlers = {
        'change-password': handleChangePassword,
        'forgot-password': handleForgotPassword,
        'reset-password': handleResetPassword,
        'reset-data': handleResetData,
        'delete-account': handleDeleteAccount,
        'update-settings': handleUpdateSettings,
        'get-settings': handleGetSettings
    };

    if (action && handlers[action]) {
        console.log(`[API] Dispatching to handler: ${action}`);
        return handlers[action](req, res);
    }

    console.log(`[API] Invalid action: ${action}`);
    return res.status(400).json({ 
        success: false, 
        message: 'Invalid action. Use: change-password, forgot-password, reset-password, reset-data, delete-account, update-settings, or get-settings' 
    });
}

// ==================== CHANGE PASSWORD ====================
async function handleChangePassword(req, res) {
    console.log(`[API] ========== CHANGE PASSWORD START ==========`);
    console.log(`[API] Change password request method: ${req.method}`);

    if (req.method !== 'POST') {
        console.log(`[API] Method not allowed: ${req.method}`);
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    console.log(`[API] User authenticated: ${user.userId}`);

    try {
        const { currentPassword, newPassword } = req.body;
        console.log(`[API] Change password request body received`);

        if (!currentPassword || !newPassword) {
            console.log(`[API] Missing required fields: currentPassword=${!!currentPassword}, newPassword=${!!newPassword}`);
            return res.status(400).json({ success: false, message: 'Current password and new password required' });
        }

        if (newPassword.length < 6) {
            console.log(`[API] New password too short: ${newPassword.length} characters`);
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }

        console.log(`[API] Fetching user from database: ${user.userId}`);
        const users = await sql`
            SELECT password_hash FROM users WHERE id = ${user.userId}
        `;

        if (!users || users.length === 0) {
            console.log(`[API] User not found: ${user.userId}`);
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        console.log(`[API] Verifying current password`);
        const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);

        if (!isValid) {
            console.log(`[API] Current password is incorrect`);
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        console.log(`[API] Hashing new password`);
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        console.log(`[API] Updating password in database`);
        await sql`
            UPDATE users SET password_hash = ${hashedPassword} WHERE id = ${user.userId}
        `;

        console.log(`[API] Password changed successfully for user: ${user.userId}`);
        console.log(`[API] ========== CHANGE PASSWORD END ==========`);

        return res.status(200).json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error(`[API] Change password error:`, error);
        console.log(`[API] ========== CHANGE PASSWORD ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== FORGOT PASSWORD (Initiate OTP for password reset) ====================
async function handleForgotPassword(req, res) {
    console.log(`[API] ========== FORGOT PASSWORD START ==========`);
    console.log(`[API] Forgot password request method: ${req.method}`);

    if (req.method !== 'POST') {
        console.log(`[API] Method not allowed: ${req.method}`);
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { email } = req.body;
        console.log(`[API] Forgot password request for email: ${email}`);

        if (!email) {
            console.log(`[API] Email is required but not provided`);
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        console.log(`[API] Normalized email: ${normalizedEmail}`);

        // Check if user exists
        console.log(`[API] Checking if user exists in database`);
        const users = await sql`
            SELECT id, email, name, is_verified 
            FROM users 
            WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            console.log(`[API] Forgot password attempted for non-existent email: ${normalizedEmail}`);
            console.log(`[API] ========== FORGOT PASSWORD END (user not found) ==========`);
            return res.status(200).json({
                success: true,
                message: 'If an account exists with this email, you will receive OTP instructions',
                requiresVerification: false
            });
        }

        const user = users[0];
        console.log(`[API] User found: ID=${user.id}, is_verified=${user.is_verified}`);

        // Check if email is verified
        if (!user.is_verified) {
            console.log(`[API] Email not verified for user: ${normalizedEmail}`);
            console.log(`[API] ========== FORGOT PASSWORD END (unverified) ==========`);
            return res.status(403).json({
                success: false,
                message: 'Please verify your email before resetting password',
                requiresVerification: true,
                email: user.email
            });
        }

        // Generate OTP for password reset by calling generate-otp endpoint
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
            console.log(`[API] ========== FORGOT PASSWORD END (success) ==========`);

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
            console.log(`[API] ========== FORGOT PASSWORD END (error generating OTP) ==========`);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate verification code. Please try again.'
            });
        }

    } catch (error) {
        console.error('[API] Forgot password error:', error);
        console.log(`[API] ========== FORGOT PASSWORD ERROR ==========`);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}

// ==================== RESET PASSWORD (After OTP verification) ====================
async function handleResetPassword(req, res) {
    console.log(`[API] ========== RESET PASSWORD START ==========`);
    console.log(`[API] Reset password request method: ${req.method}`);

    if (req.method !== 'POST') {
        console.log(`[API] Method not allowed: ${req.method}`);
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { email, newPassword } = req.body;
        console.log(`[API] Reset password request for email: ${email}`);

        if (!email || !newPassword) {
            console.log(`[API] Missing required fields: email=${!!email}, newPassword=${!!newPassword}`);
            return res.status(400).json({ 
                success: false, 
                message: 'Email and new password required' 
            });
        }

        if (newPassword.length < 6) {
            console.log(`[API] New password too short: ${newPassword.length} characters`);
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters' 
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        console.log(`[API] Normalized email: ${normalizedEmail}`);

        // Check if user exists
        console.log(`[API] Checking if user exists in database`);
        const users = await sql`
            SELECT id FROM users WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            console.log(`[API] User not found: ${normalizedEmail}`);
            console.log(`[API] ========== RESET PASSWORD END (user not found) ==========`);
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const user = users[0];
        console.log(`[API] User found: ID=${user.id}`);

        // Hash new password
        console.log(`[API] Hashing new password`);
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        console.log(`[API] Updating password in database`);
        await sql`
            UPDATE users 
            SET password_hash = ${hashedPassword}
            WHERE email = ${normalizedEmail}
        `;

        console.log(`[API] Password reset successful for: ${normalizedEmail}`);
        console.log(`[API] ========== RESET PASSWORD END ==========`);

        return res.status(200).json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        console.error('[API] Reset password error:', error);
        console.log(`[API] ========== RESET PASSWORD ERROR ==========`);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}

// ==================== RESET DATA (Clear entries only) ====================
async function handleResetData(req, res) {
    console.log(`[API] ========== RESET DATA START ==========`);
    console.log(`[API] Reset data request method: ${req.method}`);

    if (req.method !== 'DELETE') {
        console.log(`[API] Method not allowed: ${req.method}`);
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    console.log(`[API] User authenticated: ${user.userId}`);

    try {
        console.log(`[API] Deleting all attendance ledger entries for user: ${user.userId}`);
        await sql`DELETE FROM attendance_ledger WHERE user_id = ${user.userId}`;

        console.log(`[API] All data reset for user: ${user.userId}`);
        console.log(`[API] ========== RESET DATA END ==========`);

        return res.status(200).json({
            success: true,
            message: 'All data deleted successfully'
        });

    } catch (error) {
        console.error('[API] Reset data error:', error);
        console.log(`[API] ========== RESET DATA ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== DELETE ACCOUNT ====================
async function handleDeleteAccount(req, res) {
    console.log(`[API] ========== DELETE ACCOUNT START ==========`);
    console.log(`[API] Delete account request method: ${req.method}`);

    if (req.method !== 'DELETE') {
        console.log(`[API] Method not allowed: ${req.method}`);
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    console.log(`[API] User authenticated: ${user.userId}`);

    try {
        console.log(`[API] Deleting attendance ledger entries for user: ${user.userId}`);
        await sql`DELETE FROM attendance_ledger WHERE user_id = ${user.userId}`;
        
        console.log(`[API] Deleting user account: ${user.userId}`);
        await sql`DELETE FROM users WHERE id = ${user.userId}`;

        console.log(`[API] Account deleted for user: ${user.userId}`);
        console.log(`[API] ========== DELETE ACCOUNT END ==========`);

        return res.status(200).json({
            success: true,
            message: 'Account permanently deleted'
        });

    } catch (error) {
        console.error('[API] Delete account error:', error);
        console.log(`[API] ========== DELETE ACCOUNT ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== UPDATE USER SETTINGS ====================
async function handleUpdateSettings(req, res) {
    console.log(`[API] ========== UPDATE SETTINGS START ==========`);
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const { has_ot, has_cpl, limit_annual, limit_casual, limit_sick } = req.body;
        
        console.log(`[API] Updating settings for user: ${user.userId}`);
        console.log(`[API] Settings: OT=${has_ot}, CPL=${has_cpl}, AL=${limit_annual}, CL=${limit_casual}, SL=${limit_sick}`);
        
        await sql`
            UPDATE users 
            SET has_ot = ${has_ot},
                has_cpl = ${has_cpl},
                limit_annual = ${limit_annual},
                limit_casual = ${limit_casual},
                limit_sick = ${limit_sick},
                updated_at = NOW()
            WHERE id = ${user.userId}
        `;
        
        console.log(`[API] Settings updated successfully for user: ${user.userId}`);
        console.log(`[API] ========== UPDATE SETTINGS END ==========`);
        
        return res.status(200).json({
            success: true,
            message: 'Settings updated successfully'
        });
        
    } catch (error) {
        console.error('[API] Update settings error:', error);
        console.log(`[API] ========== UPDATE SETTINGS ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== GET USER SETTINGS ====================
async function handleGetSettings(req, res) {
    console.log(`[API] ========== GET SETTINGS START ==========`);
    
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        console.log(`[API] Fetching settings for user: ${user.userId}`);
        
        const users = await sql`
            SELECT has_ot, has_cpl, limit_annual, limit_casual, limit_sick
            FROM users 
            WHERE id = ${user.userId}
        `;
        
        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const settings = users[0];
        
        console.log(`[API] Settings retrieved: OT=${settings.has_ot}, CPL=${settings.has_cpl}, AL=${settings.limit_annual}, CL=${settings.limit_casual}, SL=${settings.limit_sick}`);
        console.log(`[API] ========== GET SETTINGS END ==========`);
        
        return res.status(200).json({
            success: true,
            settings: {
                has_ot: settings.has_ot ?? true,
                has_cpl: settings.has_cpl ?? true,
                limit_annual: settings.limit_annual ?? 22,
                limit_casual: settings.limit_casual ?? 10,
                limit_sick: settings.limit_sick ?? 10
            }
        });
        
    } catch (error) {
        console.error('[API] Get settings error:', error);
        console.log(`[API] ========== GET SETTINGS ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}