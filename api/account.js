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

    // Map actions to handlers - ADDED sync-single handler
    const handlers = {
        'change-password': handleChangePassword,
        'forgot-password': handleForgotPassword,
        'reset-password': handleResetPassword,
        'reset-data': handleResetData,
        'delete-account': handleDeleteAccount,
        'update-settings': handleUpdateSettings,
        'get-settings': handleGetSettings,
        'update-alarm-settings': handleUpdateAlarmSettings,
        'get-alarm-settings': handleGetAlarmSettings,
        'export': handleExportData,
        'sync-single': handleSyncSingleEntry  // ADDED: Single entry sync
    };

    if (action && handlers[action]) {
        console.log(`[API] Dispatching to handler: ${action}`);
        return handlers[action](req, res);
    }

    console.log(`[API] Invalid action: ${action}`);
    return res.status(400).json({ 
        success: false, 
        message: 'Invalid action. Use: change-password, forgot-password, reset-password, reset-data, delete-account, update-settings, get-settings, update-alarm-settings, get-alarm-settings, export, or sync-single' 
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

// ==================== UPDATE ALARM SETTINGS ====================
async function handleUpdateAlarmSettings(req, res) {
    console.log(`[API] ========== UPDATE ALARM SETTINGS START ==========`);
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const { is_alarm_enabled, checkin_time_local, checkout_time_local, tz_offset } = req.body;
        
        console.log(`[API] Updating alarm settings for user: ${user.userId}`);
        console.log(`[API] Settings: enabled=${is_alarm_enabled}, checkin=${checkin_time_local}, checkout=${checkout_time_local}, offset=${tz_offset}`);
        
        // Convert local times to UTC for storage
        let checkin_alarm_utc = null;
        let checkout_alarm_utc = null;
        
        if (is_alarm_enabled && checkin_time_local) {
            const [hours, minutes] = checkin_time_local.split(':').map(Number);
            let utcHours = hours - (tz_offset / 60);
            if (utcHours < 0) utcHours += 24;
            if (utcHours >= 24) utcHours -= 24;
            checkin_alarm_utc = `${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        }
        
        if (is_alarm_enabled && checkout_time_local) {
            const [hours, minutes] = checkout_time_local.split(':').map(Number);
            let utcHours = hours - (tz_offset / 60);
            if (utcHours < 0) utcHours += 24;
            if (utcHours >= 24) utcHours -= 24;
            checkout_alarm_utc = `${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        }
        
        await sql`
            UPDATE users 
            SET is_alarm_enabled = ${is_alarm_enabled},
                checkin_alarm_utc = ${checkin_alarm_utc},
                checkout_alarm_utc = ${checkout_alarm_utc},
                default_checkin_time = ${checkin_time_local || '09:00:00'},
                default_checkout_time = ${checkout_time_local || '18:00:00'},
                tz_offset = ${tz_offset},
                updated_at = NOW()
            WHERE id = ${user.userId}
        `;
        
        console.log(`[API] Alarm settings updated successfully for user: ${user.userId}`);
        console.log(`[API] ========== UPDATE ALARM SETTINGS END ==========`);
        
        return res.status(200).json({
            success: true,
            message: 'Alarm settings updated successfully',
            settings: {
                is_alarm_enabled,
                checkin_time: checkin_time_local,
                checkout_time: checkout_time_local,
                tz_offset
            }
        });
        
    } catch (error) {
        console.error('[API] Update alarm settings error:', error);
        console.log(`[API] ========== UPDATE ALARM SETTINGS ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== GET ALARM SETTINGS ====================
async function handleGetAlarmSettings(req, res) {
    console.log(`[API] ========== GET ALARM SETTINGS START ==========`);
    
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        console.log(`[API] Fetching alarm settings for user: ${user.userId}`);
        
        const users = await sql`
            SELECT is_alarm_enabled, checkin_alarm_utc, checkout_alarm_utc, tz_offset, default_checkin_time, default_checkout_time
            FROM users 
            WHERE id = ${user.userId}
        `;
        
        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const settings = users[0];
        
        // Convert UTC alarm times to local time for display
        let local_checkin_time = settings.default_checkin_time || '09:00';
        let local_checkout_time = settings.default_checkout_time || '18:00';
        
        if (settings.checkin_alarm_utc && settings.tz_offset !== null) {
            const [utcHours, utcMinutes] = settings.checkin_alarm_utc.split(':').map(Number);
            let localHours = utcHours + (settings.tz_offset / 60);
            if (localHours >= 24) localHours -= 24;
            if (localHours < 0) localHours += 24;
            local_checkin_time = `${String(localHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}`;
        }
        
        if (settings.checkout_alarm_utc && settings.tz_offset !== null) {
            const [utcHours, utcMinutes] = settings.checkout_alarm_utc.split(':').map(Number);
            let localHours = utcHours + (settings.tz_offset / 60);
            if (localHours >= 24) localHours -= 24;
            if (localHours < 0) localHours += 24;
            local_checkout_time = `${String(localHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}`;
        }
        
        console.log(`[API] Alarm settings retrieved for user: ${user.userId}`);
        console.log(`[API] ========== GET ALARM SETTINGS END ==========`);
        
        return res.status(200).json({
            success: true,
            settings: {
                is_alarm_enabled: settings.is_alarm_enabled ?? false,
                checkin_time: local_checkin_time.substring(0, 5),
                checkout_time: local_checkout_time.substring(0, 5),
                tz_offset: settings.tz_offset ?? 0
            }
        });
        
    } catch (error) {
        console.error('[API] Get alarm settings error:', error);
        console.log(`[API] ========== GET ALARM SETTINGS ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== SYNC SINGLE ENTRY (NEW) ====================
async function handleSyncSingleEntry(req, res) {
    console.log(`[API] ========== SYNC SINGLE ENTRY START ==========`);
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const { entry } = req.body;
        
        if (!entry || !entry.date) {
            return res.status(400).json({ success: false, message: 'Entry with date is required' });
        }
        
        console.log(`[API] Syncing single entry for user ${user.userId}, date: ${entry.date}`);
        
        // Check if entry exists
        const existing = await sql`
            SELECT id FROM attendance_ledger 
            WHERE user_id = ${user.userId} AND date = ${entry.date}
        `;
        
        let result;
        if (existing && existing.length > 0) {
            // Update existing entry
            result = await sql`
                UPDATE attendance_ledger 
                SET check_in = ${entry.check_in},
                    check_out = ${entry.check_out},
                    base_hours_rule = ${entry.base_hours_rule},
                    ot_cap_rule = ${entry.ot_cap_rule},
                    cpl_grant_rule = ${entry.cpl_grant_rule},
                    final_ot_hours = ${entry.final_ot_hours},
                    cpl_earned = ${entry.cpl_earned},
                    al_used = ${entry.al_used},
                    sl_used = ${entry.sl_used},
                    cl_used = ${entry.cl_used},
                    cpl_used = ${entry.cpl_used},
                    is_off_day = ${entry.is_off_day},
                    is_holiday = ${entry.is_holiday},
                    al_accrued = ${entry.al_accrued},
                    al_adjustment = ${entry.al_adjustment},
                    sl_adjustment = ${entry.sl_adjustment},
                    cl_adjustment = ${entry.cl_adjustment},
                    al_expiry_date = ${entry.al_expiry_date},
                    cpl_adjustment = ${entry.cpl_adjustment},
                    cpl_expiry_date = ${entry.cpl_expiry_date},
                    ot_adjustment = ${entry.ot_adjustment},
                    adjustment_note = ${entry.adjustment_note},
                    updated_at = NOW()
                WHERE user_id = ${user.userId} AND date = ${entry.date}
                RETURNING date
            `;
            console.log(`[API] Updated existing entry for ${entry.date}`);
        } else {
            // Insert new entry
            result = await sql`
                INSERT INTO attendance_ledger (
                    user_id, date, check_in, check_out,
                    base_hours_rule, ot_cap_rule, cpl_grant_rule,
                    final_ot_hours, cpl_earned,
                    al_used, sl_used, cl_used, cpl_used,
                    is_off_day, is_holiday,
                    al_accrued, al_adjustment, sl_adjustment, cl_adjustment,
                    al_expiry_date, cpl_adjustment, cpl_expiry_date,
                    ot_adjustment, adjustment_note, sync_status
                ) VALUES (
                    ${user.userId}, ${entry.date}, ${entry.check_in}, ${entry.check_out},
                    ${entry.base_hours_rule}, ${entry.ot_cap_rule}, ${entry.cpl_grant_rule},
                    ${entry.final_ot_hours}, ${entry.cpl_earned},
                    ${entry.al_used}, ${entry.sl_used}, ${entry.cl_used}, ${entry.cpl_used},
                    ${entry.is_off_day}, ${entry.is_holiday},
                    ${entry.al_accrued}, ${entry.al_adjustment}, ${entry.sl_adjustment}, ${entry.cl_adjustment},
                    ${entry.al_expiry_date}, ${entry.cpl_adjustment}, ${entry.cpl_expiry_date},
                    ${entry.ot_adjustment}, ${entry.adjustment_note}, 'synced'
                )
                RETURNING date
            `;
            console.log(`[API] Inserted new entry for ${entry.date}`);
        }
        
        console.log(`[API] Successfully synced entry for ${entry.date}`);
        console.log(`[API] ========== SYNC SINGLE ENTRY END ==========`);
        
        return res.status(200).json({
            success: true,
            message: 'Entry synced successfully',
            syncedIds: [entry.date]
        });
        
    } catch (error) {
        console.error('[API] Sync single entry error:', error);
        console.log(`[API] ========== SYNC SINGLE ENTRY ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== EXPORT ATTENDANCE DATA TO CSV (UPDATED FOR DATE RANGE) ====================
async function handleExportData(req, res) {
    console.log(`[API] ========== EXPORT DATA START ==========`);
    
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const user = verifyToken(req.headers.authorization);
    if (!user) {
        console.log(`[API] Unauthorized - invalid or missing token`);
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const { from, to } = req.query;
        console.log(`[API] Exporting data for user: ${user.userId}, from: ${from}, to: ${to}`);
        
        if (!from || !to) {
            return res.status(400).json({ success: false, message: 'From and To dates are required' });
        }
        
        // Fetch attendance entries for the date range
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
                is_holiday,
                is_off_day,
                is_manual_adjustment,
                al_accrued,
                al_adjustment,
                sl_adjustment,
                cl_adjustment,
                al_expiry_date,
                cpl_adjustment,
                cpl_expiry_date,
                ot_adjustment,
                adjustment_note,
                sync_status
            FROM attendance_ledger 
            WHERE user_id = ${user.userId} 
            AND date >= ${from} AND date <= ${to}
            ORDER BY date ASC
        `;
        
        console.log(`[API] Found ${entries.length} entries for date range`);
        
        // Generate CSV content
        const csvContent = generateCSVFromEntries(entries, user, from, to);
        
        // Set response headers for CSV download
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="attendance_${from}_to_${to}_${user.email}.csv"`);
        
        console.log(`[API] ========== EXPORT DATA END ==========`);
        
        return res.status(200).send(csvContent);
        
    } catch (error) {
        console.error('[API] Export data error:', error);
        console.log(`[API] ========== EXPORT DATA ERROR ==========`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// ==================== CSV GENERATION UTILITY (UPDATED) ====================
function generateCSVFromEntries(entries, user, fromDate, toDate) {
    // Define CSV headers
    const headers = [
        'Date',
        'Day of Week',
        'Check In',
        'Check Out',
        'Base Hours',
        'OT Hours (Final)',
        'OT Cap Rule',
        'CPL Earned',
        'CPL Grant Rule',
        'Annual Leave Used',
        'Sick Leave Used',
        'Casual Leave Used',
        'CPL Used',
        'Is Holiday',
        'Is Off Day',
        'Is Manual Adjustment',
        'AL Accrued',
        'AL Adjustment',
        'SL Adjustment',
        'CL Adjustment',
        'CPL Adjustment',
        'OT Adjustment',
        'AL Expiry Date',
        'CPL Expiry Date',
        'Adjustment Note',
        'Sync Status'
    ];
    
    // Create CSV rows
    const rows = [];
    rows.push(headers.join(','));
    
    for (const entry of entries) {
        const entryDate = new Date(entry.date);
        const dayOfWeek = entryDate.toLocaleDateString('en-US', { weekday: 'long' });
        
        // Format times for CSV
        let checkIn = entry.check_in || '';
        let checkOut = entry.check_out || '';
        
        if (checkIn && checkIn.includes('T')) {
            checkIn = checkIn.replace('T', ' ');
        }
        if (checkOut && checkOut.includes('T')) {
            checkOut = checkOut.replace('T', ' ');
        }
        
        const row = [
            escapeCSV(entry.date),
            escapeCSV(dayOfWeek),
            escapeCSV(checkIn),
            escapeCSV(checkOut),
            entry.base_hours_rule !== null ? entry.base_hours_rule : '',
            entry.final_ot_hours !== null ? entry.final_ot_hours : '',
            entry.ot_cap_rule !== null ? entry.ot_cap_rule : '',
            entry.cpl_earned !== null ? entry.cpl_earned : '',
            entry.cpl_grant_rule !== null ? entry.cpl_grant_rule : '',
            entry.al_used || 0,
            entry.sl_used || 0,
            entry.cl_used || 0,
            entry.cpl_used || 0,
            entry.is_holiday ? 'Yes' : 'No',
            entry.is_off_day ? 'Yes' : 'No',
            entry.is_manual_adjustment ? 'Yes' : 'No',
            entry.al_accrued || 0,
            entry.al_adjustment || 0,
            entry.sl_adjustment || 0,
            entry.cl_adjustment || 0,
            entry.cpl_adjustment || 0,
            entry.ot_adjustment || 0,
            entry.al_expiry_date || '',
            entry.cpl_expiry_date || '',
            escapeCSV(entry.adjustment_note || ''),
            entry.sync_status || ''
        ];
        
        rows.push(row.join(','));
    }
    
    // Add summary section
    rows.push('');
    rows.push('"=== SUMMARY ==="');
    rows.push(`"User Email",${escapeCSV(user?.email || '')}`);
    rows.push(`"User ID",${user?.userId || ''}`);
    rows.push(`"Export Date",${escapeCSV(new Date().toLocaleString())}`);
    rows.push(`"Date Range",${fromDate} to ${toDate}`);
    rows.push(`"Total Entries",${entries.length}`);
    
    // Calculate summary statistics
    let totalOT = 0;
    let totalCPL = 0;
    let totalAnnualLeave = 0;
    let totalSickLeave = 0;
    let totalCasualLeave = 0;
    let totalCPLUsed = 0;
    let totalALAccrued = 0;
    let totalALAdjustment = 0;
    let totalCPLAdjustment = 0;
    let totalOTAdjustment = 0;
    let daysWorked = 0;
    
    for (const entry of entries) {
        if (entry.final_ot_hours) totalOT += parseFloat(entry.final_ot_hours);
        if (entry.cpl_earned) totalCPL += parseFloat(entry.cpl_earned);
        if (entry.al_used) totalAnnualLeave += parseFloat(entry.al_used);
        if (entry.sl_used) totalSickLeave += parseFloat(entry.sl_used);
        if (entry.cl_used) totalCasualLeave += parseFloat(entry.cl_used);
        if (entry.cpl_used) totalCPLUsed += parseFloat(entry.cpl_used);
        if (entry.al_accrued) totalALAccrued += parseFloat(entry.al_accrued);
        if (entry.al_adjustment) totalALAdjustment += parseFloat(entry.al_adjustment);
        if (entry.cpl_adjustment) totalCPLAdjustment += parseFloat(entry.cpl_adjustment);
        if (entry.ot_adjustment) totalOTAdjustment += parseFloat(entry.ot_adjustment);
        
        // Count days worked
        if (entry.check_in && !entry.is_off_day && !(entry.al_used > 0 || entry.sl_used > 0 || entry.cl_used > 0)) {
            daysWorked++;
        }
    }
    
    rows.push(`"Total Days Worked",${daysWorked}`);
    rows.push(`"Total OT Hours",${totalOT.toFixed(1)}`);
    rows.push(`"Total OT Adjustment",${totalOTAdjustment.toFixed(1)}`);
    rows.push(`"Total CPL Earned",${totalCPL.toFixed(2)}`);
    rows.push(`"Total CPL Adjustment",${totalCPLAdjustment.toFixed(2)}`);
    rows.push(`"Total Annual Leave Used",${totalAnnualLeave.toFixed(2)}`);
    rows.push(`"Total Sick Leave Used",${totalSickLeave.toFixed(2)}`);
    rows.push(`"Total Casual Leave Used",${totalCasualLeave.toFixed(2)}`);
    rows.push(`"Total CPL Used",${totalCPLUsed.toFixed(2)}`);
    rows.push(`"Total AL Accrued",${totalALAccrued.toFixed(2)}`);
    rows.push(`"Total AL Adjustment",${totalALAdjustment.toFixed(2)}`);
    
    return rows.join('\n');
}

// ==================== ESCAPE CSV FIELD ====================
function escapeCSV(field) {
    if (field === undefined || field === null) {
        return '';
    }
    
    const stringField = String(field);
    
    // If field contains comma, newline, or double quote, wrap in double quotes
    if (stringField.includes(',') || stringField.includes('\n') || stringField.includes('"')) {
        // Replace double quotes with two double quotes
        return '"' + stringField.replace(/"/g, '""') + '"';
    }
    
    return stringField;
}
