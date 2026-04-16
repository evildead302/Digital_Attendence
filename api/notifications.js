// api/notifications.js
import { neon } from '@neondatabase/serverless';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET;

// Get VAPID keys from environment variables
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
let WEB_PUSH_CONTACT = process.env.WEB_PUSH_CONTACT;

// Fix the contact format for web-push (add mailto: if missing)
if (WEB_PUSH_CONTACT && !WEB_PUSH_CONTACT.startsWith('mailto:') && !WEB_PUSH_CONTACT.startsWith('https://')) {
    WEB_PUSH_CONTACT = `mailto:${WEB_PUSH_CONTACT}`;
    console.log('[Push] Added mailto: prefix to contact:', WEB_PUSH_CONTACT);
}

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && WEB_PUSH_CONTACT) {
    webpush.setVapidDetails(
        WEB_PUSH_CONTACT,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
    console.log('[Push] Web push configured successfully');
} else {
    console.log('[Push] Missing configuration:', {
        VAPID_PUBLIC_KEY: !!VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: !!VAPID_PRIVATE_KEY,
        WEB_PUSH_CONTACT: !!WEB_PUSH_CONTACT
    });
}

function verifyToken(authHeader) {
    if (!authHeader) return null;
    const token = authHeader.split(' ')[1];
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        console.error('[Auth] Token verification failed:', error.message);
        return null;
    }
}

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;

    try {
        if (action === 'save') {
            return await handleSaveSettings(req, res);
        } else if (action === 'get') {
            return await handleGetSettings(req, res);
        } else if (action === 'subscribe') {
            return await handleSubscribe(req, res);
        } else if (action === 'cron') {
            return await handleCronJob(req, res);
        } else if (action === 'client-check') {
            return await handleClientCheck(req, res);
        } else if (action === 'update-alarms') {
            return await handleUpdateAlarms(req, res);
        } else if (action === 'update-checkout-alarm') {
            return await handleUpdateCheckoutAlarm(req, res);
        } else if (action === 'reset-daily-alarms') {
            return await handleResetDailyAlarms(req, res);
        } else if (action === 'sync-timezone') {
            return await handleSyncTimezone(req, res);
        } else {
            return res.status(200).json({ 
                success: true, 
                message: 'Notifications API is working. Use ?action=save, get, subscribe, cron, client-check, update-alarms, update-checkout-alarm, reset-daily-alarms, or sync-timezone' 
            });
        }
    } catch (error) {
        console.error('[API] Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

// ==================== SAVE ALARM SETTINGS ====================
async function handleSaveSettings(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const { is_alarm_enabled, checkin_time_local, checkout_time_local, tz_offset } = req.body;
        
        console.log(`[Alarm] Saving for user ${user.userId}: enabled=${is_alarm_enabled}, checkin=${checkin_time_local}, checkout=${checkout_time_local}, offset=${tz_offset}`);
        
        // Convert local times to UTC
        let checkin_alarm_utc = null;
        let checkout_alarm_utc = null;
        
        if (is_alarm_enabled && checkin_time_local) {
            const [hours, minutes] = checkin_time_local.split(':').map(Number);
            let utcHours = hours - (tz_offset / 60);
            if (utcHours < 0) utcHours += 24;
            if (utcHours >= 24) utcHours -= 24;
            checkin_alarm_utc = `${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
            console.log(`[Alarm] Checkin converted to UTC: ${checkin_alarm_utc}`);
        }
        
        if (is_alarm_enabled && checkout_time_local) {
            const [hours, minutes] = checkout_time_local.split(':').map(Number);
            let utcHours = hours - (tz_offset / 60);
            if (utcHours < 0) utcHours += 24;
            if (utcHours >= 24) utcHours -= 24;
            checkout_alarm_utc = `${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
            console.log(`[Alarm] Checkout converted to UTC: ${checkout_alarm_utc}`);
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
        
        return res.status(200).json({
            success: true,
            message: 'Alarm settings saved'
        });
        
    } catch (error) {
        console.error('[Alarm] Save error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error: ' + error.message 
        });
    }
}

// ==================== GET ALARM SETTINGS ====================
async function handleGetSettings(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const users = await sql`
            SELECT is_alarm_enabled, checkin_alarm_utc, checkout_alarm_utc, tz_offset, default_checkin_time, default_checkout_time
            FROM users WHERE id = ${user.userId}
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
        console.error('[Alarm] Get error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
}

// ==================== SUBSCRIBE TO PUSH NOTIFICATIONS ====================
async function handleSubscribe(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const subscription = req.body;
        
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid subscription data' 
            });
        }
        
        // Create table if not exists (run this once in Neon)
        await sql`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(50) NOT NULL,
                endpoint TEXT NOT NULL UNIQUE,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `;
        
        // Store or update subscription
        await sql`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
            VALUES (${user.userId}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, NOW())
            ON CONFLICT (endpoint) 
            DO UPDATE SET 
                user_id = ${user.userId}, 
                p256dh = ${subscription.keys.p256dh}, 
                auth = ${subscription.keys.auth}, 
                updated_at = NOW()
        `;
        
        console.log(`[Push] Subscription saved for user ${user.userId}`);
        
        return res.status(200).json({ 
            success: true, 
            message: 'Subscribed successfully' 
        });
        
    } catch (error) {
        console.error('[Push] Subscribe error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to save subscription: ' + error.message 
        });
    }
}

// ==================== SYNC TIMEZONE ====================
async function handleSyncTimezone(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    try {
        const { tz_offset } = req.body;
        
        console.log(`[SyncTimezone] Updating timezone for user ${user.userId} to offset ${tz_offset}`);
        
        await sql`
            UPDATE users 
            SET tz_offset = ${tz_offset},
                updated_at = NOW()
            WHERE id = ${user.userId}
        `;
        
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[SyncTimezone] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==================== UPDATE ALARMS AFTER CHECK-IN/OUT ====================
async function handleUpdateAlarms(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const { action, checkoutTimeLocal, tz_offset } = req.body;
        
        console.log(`[Alarm] Update alarms for user ${user.userId}: action=${action}, checkoutTime=${checkoutTimeLocal}, offset=${tz_offset}`);
        
        // Get current user settings
        const users = await sql`
            SELECT default_checkin_time, default_checkout_time, tz_offset 
            FROM users WHERE id = ${user.userId}
        `;
        
        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const userSettings = users[0];
        const userOffset = tz_offset || userSettings.tz_offset || 0;
        
        if (action === 'checkin') {
            // Calculate next day's alarms
            const defaultCheckin = userSettings.default_checkin_time || '09:00';
            const [checkinHours, checkinMinutes] = defaultCheckin.split(':').map(Number);
            
            let checkinUtcHour = checkinHours - (userOffset / 60);
            if (checkinUtcHour < 0) checkinUtcHour += 24;
            if (checkinUtcHour >= 24) checkinUtcHour -= 24;
            const nextCheckinUTC = `${String(checkinUtcHour).padStart(2, '0')}:${String(checkinMinutes).padStart(2, '0')}:00`;
            
            // Use provided checkout time or default
            let checkoutAlarmLocal = checkoutTimeLocal || userSettings.default_checkout_time || '18:00';
            const [checkoutHours, checkoutMinutes] = checkoutAlarmLocal.split(':').map(Number);
            let checkoutUtcHour = checkoutHours - (userOffset / 60);
            if (checkoutUtcHour < 0) checkoutUtcHour += 24;
            if (checkoutUtcHour >= 24) checkoutUtcHour -= 24;
            const nextCheckoutUTC = `${String(checkoutUtcHour).padStart(2, '0')}:${String(checkoutMinutes).padStart(2, '0')}:00`;
            
            await sql`
                UPDATE users 
                SET checkin_alarm_utc = ${nextCheckinUTC},
                    checkout_alarm_utc = ${nextCheckoutUTC},
                    tz_offset = ${userOffset},
                    last_checkin_notified_at = NULL,
                    last_checkout_notified_at = NULL
                WHERE id = ${user.userId}
            `;
            
            console.log(`[Alarm] Updated alarms for next day: checkin=${nextCheckinUTC}, checkout=${nextCheckoutUTC}`);
            
        } else if (action === 'checkout') {
            // Reset notification flags only
            await sql`
                UPDATE users 
                SET last_checkout_notified_at = NULL
                WHERE id = ${user.userId}
            `;
            console.log(`[Alarm] Reset last_checkout_notified_at for user ${user.userId}`);
        }
        
        return res.status(200).json({
            success: true,
            message: 'Alarms updated successfully'
        });
        
    } catch (error) {
        console.error('[Alarm] Update alarms error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to update alarms: ' + error.message 
        });
    }
}

// ==================== UPDATE CHECKOUT ALARM ONLY ====================
async function handleUpdateCheckoutAlarm(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const { checkout_time_local, tz_offset } = req.body;
        
        console.log(`[Alarm] Updating checkout alarm for user ${user.userId}, checkout=${checkout_time_local}, offset=${tz_offset}`);
        
        const userOffset = tz_offset || 0;
        
        // Convert local checkout time to UTC
        let checkoutAlarmUtc = null;
        if (checkout_time_local) {
            const [hours, minutes] = checkout_time_local.split(':').map(Number);
            let utcHours = hours - (userOffset / 60);
            if (utcHours < 0) utcHours += 24;
            if (utcHours >= 24) utcHours -= 24;
            checkoutAlarmUtc = `${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        }
        
        // Update only checkout alarm
        await sql`
            UPDATE users 
            SET checkout_alarm_utc = ${checkoutAlarmUtc},
                tz_offset = ${userOffset},
                updated_at = NOW()
            WHERE id = ${user.userId}
        `;
        
        console.log(`[Alarm] Checkout alarm updated to UTC: ${checkoutAlarmUtc}`);
        
        return res.status(200).json({
            success: true,
            message: 'Checkout alarm updated',
            checkout_alarm_utc: checkoutAlarmUtc
        });
        
    } catch (error) {
        console.error('[Alarm] Update checkout error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to update checkout alarm: ' + error.message 
        });
    }
}

// ==================== RESET DAILY ALARMS ====================
async function handleResetDailyAlarms(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const users = await sql`
            SELECT default_checkin_time, default_checkout_time, tz_offset 
            FROM users WHERE id = ${user.userId}
        `;
        
        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const userData = users[0];
        const tzOffset = userData.tz_offset || 0;
        
        // Convert default local times to UTC
        const [checkinHour, checkinMinute] = (userData.default_checkin_time || '09:00').split(':').map(Number);
        const [checkoutHour, checkoutMinute] = (userData.default_checkout_time || '18:00').split(':').map(Number);
        
        let checkinUtcHour = checkinHour - (tzOffset / 60);
        let checkoutUtcHour = checkoutHour - (tzOffset / 60);
        
        if (checkinUtcHour < 0) checkinUtcHour += 24;
        if (checkinUtcHour >= 24) checkinUtcHour -= 24;
        if (checkoutUtcHour < 0) checkoutUtcHour += 24;
        if (checkoutUtcHour >= 24) checkoutUtcHour -= 24;
        
        const checkinAlarmUtc = `${String(checkinUtcHour).padStart(2, '0')}:${String(checkinMinute).padStart(2, '0')}:00`;
        const checkoutAlarmUtc = `${String(checkoutUtcHour).padStart(2, '0')}:${String(checkoutMinute).padStart(2, '0')}:00`;
        
        await sql`
            UPDATE users 
            SET checkin_alarm_utc = ${checkinAlarmUtc},
                checkout_alarm_utc = ${checkoutAlarmUtc},
                last_checkin_notified_at = NULL,
                last_checkout_notified_at = NULL,
                updated_at = NOW()
            WHERE id = ${user.userId}
        `;
        
        console.log(`[Alarm] Daily reset for user ${user.userId}: checkin=${checkinAlarmUtc}, checkout=${checkoutAlarmUtc}`);
        
        return res.status(200).json({
            success: true,
            message: 'Daily alarms reset successfully',
            checkin_alarm_utc: checkinAlarmUtc,
            checkout_alarm_utc: checkoutAlarmUtc
        });
        
    } catch (error) {
        console.error('[Alarm] Daily reset error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// ==================== CLIENT-SIDE NOTIFICATION CHECK ====================
async function handleClientCheck(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    console.log(`[ClientCheck] Manual check for user ${user.userId} at ${new Date().toISOString()}`);
    
    const now = new Date();
    const currentUtcTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:00`;
    const currentUtcTimestamp = now;
    const todayDate = now.toISOString().split('T')[0];
    
    try {
        const users = await sql`
            SELECT 
                id, email, name, tz_offset,
                checkin_alarm_utc, checkout_alarm_utc,
                last_checkin_notified_at, last_checkout_notified_at
            FROM users 
            WHERE id = ${user.userId} AND is_alarm_enabled = TRUE
        `;
        
        if (!users || users.length === 0) {
            return res.status(200).json({ success: true, message: 'No alarms enabled' });
        }
        
        const userData = users[0];
        
        // Check if already checked in/out today
        const hasEntry = await sql`
            SELECT check_in, check_out FROM attendance_ledger 
            WHERE user_id = ${user.userId} AND date = ${todayDate}
            LIMIT 1
        `;
        
        const isCheckedIn = hasEntry.length > 0 && hasEntry[0].check_in !== null;
        const isCheckedOut = hasEntry.length > 0 && hasEntry[0].check_out !== null;
        
        let notificationsSent = [];
        
        // Check-in notification - STRICT 15-MINUTE WINDOW
        if (userData.checkin_alarm_utc && !isCheckedIn) {
            const isWithinWindow = isStrictlyWithin15Minutes(userData.checkin_alarm_utc, currentUtcTime);
            
            if (isWithinWindow) {
                const shouldSend = shouldSendNotification(
                    userData.last_checkin_notified_at, 
                    userData.checkin_alarm_utc,
                    currentUtcTimestamp
                );
                
                if (shouldSend) {
                    await sendPushToUser(user.userId, 'checkin', userData);
                    notificationsSent.push('checkin');
                    
                    await sql`
                        UPDATE users SET last_checkin_notified_at = ${currentUtcTimestamp.toISOString()} 
                        WHERE id = ${user.userId}
                    `;
                }
            }
        }
        
        // Check-out notification - STRICT 15-MINUTE WINDOW
        if (userData.checkout_alarm_utc && isCheckedIn && !isCheckedOut) {
            const isWithinWindow = isStrictlyWithin15Minutes(userData.checkout_alarm_utc, currentUtcTime);
            
            if (isWithinWindow) {
                const shouldSend = shouldSendNotification(
                    userData.last_checkout_notified_at, 
                    userData.checkout_alarm_utc,
                    currentUtcTimestamp
                );
                
                if (shouldSend) {
                    await sendPushToUser(user.userId, 'checkout', userData);
                    notificationsSent.push('checkout');
                    
                    await sql`
                        UPDATE users SET last_checkout_notified_at = ${currentUtcTimestamp.toISOString()} 
                        WHERE id = ${user.userId}
                    `;
                    
                    // Reset checkout alarm for next day after sending notification
                    const usersDefault = await sql`
                        SELECT default_checkout_time, tz_offset FROM users WHERE id = ${user.userId}
                    `;
                    if (usersDefault.length > 0) {
                        const defaultCheckout = usersDefault[0].default_checkout_time || '18:00';
                        const [checkoutHour, checkoutMinute] = defaultCheckout.split(':').map(Number);
                        const tzOff = usersDefault[0].tz_offset || 0;
                        let checkoutUtcHour = checkoutHour - (tzOff / 60);
                        if (checkoutUtcHour < 0) checkoutUtcHour += 24;
                        if (checkoutUtcHour >= 24) checkoutUtcHour -= 24;
                        const nextDayCheckoutUtc = `${String(checkoutUtcHour).padStart(2, '0')}:${String(checkoutMinute).padStart(2, '0')}:00`;
                        
                        await sql`
                            UPDATE users SET checkout_alarm_utc = ${nextDayCheckoutUtc}
                            WHERE id = ${user.userId}
                        `;
                        console.log(`[ClientCheck] Reset checkout alarm for next day: ${nextDayCheckoutUtc}`);
                    }
                }
            }
        }
        
        return res.status(200).json({
            success: true,
            notificationsSent,
            timestamp: currentUtcTimestamp.toISOString()
        });
        
    } catch (error) {
        console.error('[ClientCheck] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// ==================== CRON JOB - SEND NOTIFICATIONS ====================
async function handleCronJob(req, res) {
    // Security: Verify cron secret from environment variable
    const cronSecret = req.headers['x-cron-secret'];
    const expectedSecret = process.env.CRON_SECRET;
    
    if (!expectedSecret) {
        console.error('[Cron] CRON_SECRET not set in environment variables');
        return res.status(500).json({ error: 'Cron secret not configured' });
    }
    
    if (cronSecret !== expectedSecret) {
        console.log('[Cron] Unauthorized attempt - invalid secret');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log('[Cron] Running notification check at', new Date().toISOString());
    
    const now = new Date();
    const currentUtcTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:00`;
    const currentUtcTimestamp = now;
    const todayDate = now.toISOString().split('T')[0];
    
    console.log(`[Cron] Current UTC time: ${currentUtcTime}, Date: ${todayDate}`);
    
    try {
        // Get users with alarms enabled
        const users = await sql`
            SELECT 
                id, email, name, tz_offset,
                checkin_alarm_utc, checkout_alarm_utc,
                last_checkin_notified_at, last_checkout_notified_at,
                default_checkout_time
            FROM users 
            WHERE is_alarm_enabled = TRUE
        `;
        
        console.log(`[Cron] Found ${users.length} users with alarms enabled`);
        
        let checkinCount = 0;
        let checkoutCount = 0;
        
        for (const user of users) {
            // Check if already checked in/out today
            const hasEntry = await sql`
                SELECT check_in, check_out FROM attendance_ledger 
                WHERE user_id = ${user.id} AND date = ${todayDate}
                LIMIT 1
            `;
            
            const isCheckedIn = hasEntry.length > 0 && hasEntry[0].check_in !== null;
            const isCheckedOut = hasEntry.length > 0 && hasEntry[0].check_out !== null;
            
            // Check-in notification - STRICT 15-MINUTE WINDOW
            if (user.checkin_alarm_utc && !isCheckedIn) {
                const isWithinWindow = isStrictlyWithin15Minutes(user.checkin_alarm_utc, currentUtcTime);
                
                if (isWithinWindow) {
                    const shouldSend = shouldSendNotification(
                        user.last_checkin_notified_at, 
                        user.checkin_alarm_utc,
                        currentUtcTimestamp
                    );
                    
                    if (shouldSend) {
                        console.log(`[Cron] Sending check-in notification to ${user.email}`);
                        await sendPushToUser(user.id, 'checkin', user);
                        checkinCount++;
                        
                        await sql`
                            UPDATE users SET last_checkin_notified_at = ${currentUtcTimestamp.toISOString()} 
                            WHERE id = ${user.id}
                        `;
                        console.log(`[Cron] Updated last_checkin_notified_at for user ${user.id}`);
                    }
                }
            }
            
            // Check-out notification - STRICT 15-MINUTE WINDOW
            if (user.checkout_alarm_utc && isCheckedIn && !isCheckedOut) {
                const isWithinWindow = isStrictlyWithin15Minutes(user.checkout_alarm_utc, currentUtcTime);
                
                if (isWithinWindow) {
                    const shouldSend = shouldSendNotification(
                        user.last_checkout_notified_at, 
                        user.checkout_alarm_utc,
                        currentUtcTimestamp
                    );
                    
                    if (shouldSend) {
                        console.log(`[Cron] Sending check-out notification to ${user.email}`);
                        await sendPushToUser(user.id, 'checkout', user);
                        checkoutCount++;
                        
                        await sql`
                            UPDATE users SET last_checkout_notified_at = ${currentUtcTimestamp.toISOString()} 
                            WHERE id = ${user.id}
                        `;
                        console.log(`[Cron] Updated last_checkout_notified_at for user ${user.id}`);
                        
                        // Reset checkout alarm for next day after sending notification
                        const defaultCheckout = user.default_checkout_time || '18:00';
                        const [checkoutHour, checkoutMinute] = defaultCheckout.split(':').map(Number);
                        let checkoutUtcHour = checkoutHour - (user.tz_offset / 60);
                        if (checkoutUtcHour < 0) checkoutUtcHour += 24;
                        if (checkoutUtcHour >= 24) checkoutUtcHour -= 24;
                        const nextDayCheckoutUtc = `${String(checkoutUtcHour).padStart(2, '0')}:${String(checkoutMinute).padStart(2, '0')}:00`;
                        
                        await sql`
                            UPDATE users SET checkout_alarm_utc = ${nextDayCheckoutUtc}
                            WHERE id = ${user.id}
                        `;
                        console.log(`[Cron] Reset checkout alarm for next day: ${nextDayCheckoutUtc}`);
                    }
                }
            }
        }
        
        console.log(`[Cron] Sent: ${checkinCount} check-in, ${checkoutCount} check-out notifications`);
        
        return res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            checkinSent: checkinCount,
            checkoutSent: checkoutCount,
            usersChecked: users.length,
            message: `Cron job executed. ${checkinCount} check-in, ${checkoutCount} check-out notifications sent.`
        });
        
    } catch (error) {
        console.error('[Cron] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Helper: Check if current time is strictly within 15 minutes BEFORE alarm time
function isStrictlyWithin15Minutes(alarmTime, currentTime) {
    const [alarmHour, alarmMin] = alarmTime.split(':').map(Number);
    const [currentHour, currentMin] = currentTime.split(':').map(Number);
    
    let alarmTotal = alarmHour * 60 + alarmMin;
    let currentTotal = currentHour * 60 + currentMin;
    
    // Handle overnight (e.g., alarm 00:30, current 23:45)
    if (currentTotal > alarmTotal && (currentTotal - alarmTotal) > 12 * 60) {
        currentTotal -= 24 * 60;
    }
    if (alarmTotal < currentTotal && (currentTotal - alarmTotal) > 12 * 60) {
        alarmTotal += 24 * 60;
    }
    
    const diff = alarmTotal - currentTotal;
    const isEligible = diff >= 0 && diff <= 15;
    
    if (isEligible) {
        console.log(`[Cron] Strict window: Alarm ${alarmTime} vs Current ${currentTime} = ${diff} minutes until alarm`);
    }
    
    return isEligible;
}

// Helper: Check if we should send notification based on last notification time
function shouldSendNotification(lastNotifiedAt, alarmTime, currentUtcTimestamp) {
    if (!lastNotifiedAt) {
        console.log(`[Cron] No previous notification - can send`);
        return true;
    }
    
    try {
        const lastNotified = new Date(lastNotifiedAt);
        const [alarmHour, alarmMin] = alarmTime.split(':').map(Number);
        
        // Create today's alarm timestamp
        const alarmTimestamp = new Date(currentUtcTimestamp);
        alarmTimestamp.setUTCHours(alarmHour, alarmMin, 0, 0);
        
        // If alarm time is earlier than current time (handles next day)
        let alarmDateTime = alarmTimestamp;
        if (alarmTimestamp < currentUtcTimestamp) {
            alarmDateTime = new Date(alarmTimestamp);
            alarmDateTime.setUTCDate(alarmDateTime.getUTCDate() + 1);
        }
        
        const minutesSinceLastNotified = (alarmDateTime - lastNotified) / (1000 * 60);
        const shouldSend = minutesSinceLastNotified > 15;
        
        console.log(`[Cron] Last notified at ${lastNotified.toISOString()}, alarm at ${alarmDateTime.toISOString()}, diff: ${minutesSinceLastNotified.toFixed(1)} minutes - ${shouldSend ? 'SEND' : 'SKIP'}`);
        
        return shouldSend;
    } catch (error) {
        console.error(`[Cron] Error checking last notification:`, error);
        return true;
    }
}

// Helper: Check if current time is within window of alarm time (legacy - kept for compatibility)
function isWithinWindow(alarmTime, currentTime, minutesWindow) {
    const [alarmHour, alarmMin] = alarmTime.split(':').map(Number);
    const [currentHour, currentMin] = currentTime.split(':').map(Number);
    
    let alarmTotal = alarmHour * 60 + alarmMin;
    let currentTotal = currentHour * 60 + currentMin;
    
    // Handle overnight (e.g., alarm 23:30, current 00:15)
    if (currentTotal < alarmTotal && (alarmTotal - currentTotal) > 12 * 60) {
        currentTotal += 24 * 60;
    }
    if (alarmTotal < currentTotal && (currentTotal - alarmTotal) > 12 * 60) {
        alarmTotal += 24 * 60;
    }
    
    const diff = currentTotal - alarmTotal;
    return diff >= 0 && diff <= minutesWindow;
}

// Helper: Send push notification to user
async function sendPushToUser(userId, type, user) {
    // Check if web push is configured using environment variables
    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        console.log(`[Push] VAPID keys not configured - cannot send push to ${userId}`);
        return;
    }
    
    try {
        // Get user's push subscriptions
        const subscriptions = await sql`
            SELECT endpoint, p256dh, auth 
            FROM push_subscriptions 
            WHERE user_id = ${userId}
        `;
        
        if (subscriptions.length === 0) {
            console.log(`[Push] No subscription for user ${userId}`);
            return;
        }
        
        // Calculate local time for display
        let localTime = type === 'checkin' ? user.checkin_alarm_utc : user.checkout_alarm_utc;
        if (localTime && user.tz_offset !== null) {
            const [utcHour, utcMin] = localTime.split(':').map(Number);
            let localHour = utcHour + (user.tz_offset / 60);
            if (localHour >= 24) localHour -= 24;
            if (localHour < 0) localHour += 24;
            localTime = `${String(localHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')}`;
        } else {
            localTime = type === 'checkin' ? 'morning' : 'end of day';
        }
        
        const title = type === 'checkin' ? '⏰ Time to Check In!' : '🏠 Time to Check Out!';
        const body = type === 'checkin' 
            ? `${user.name || 'Hello'}, it's ${localTime} - time to check in for work.`
            : `${user.name || 'Hello'}, your work day should be ending at ${localTime}. Time to check out!`;
        
        const payload = JSON.stringify({
            title,
            body,
            icon: '/icon-192.png',
            badge: '/badge.png',
            data: { userId: user.id, type, url: '/' },
            actions: [{ action: type, title: type === 'checkin' ? '✅ Check In Now' : '✅ Check Out Now' }]
        });
        
        let sentCount = 0;
        for (const sub of subscriptions) {
            try {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                };
                
                await webpush.sendNotification(pushSubscription, payload);
                sentCount++;
                console.log(`[Push] Sent ${type} notification to ${userId}`);
            } catch (error) {
                console.error(`[Push] Failed to send to ${userId}:`, error.statusCode, error.message);
                // Remove invalid subscription (410 = Gone)
                if (error.statusCode === 410) {
                    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
                    console.log(`[Push] Removed invalid subscription for ${userId}`);
                }
            }
        }
        
        console.log(`[Push] Sent ${sentCount}/${subscriptions.length} notifications to user ${userId}`);
        
    } catch (error) {
        console.error(`[Push] Error sending to user ${userId}:`, error);
    }
}
