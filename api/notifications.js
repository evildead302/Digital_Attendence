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

// DEBUG: Log VAPID key source
console.log('[ENV] ========== VAPID KEY SOURCE CHECK ==========');
console.log('[ENV] VAPID_PUBLIC_KEY from Vercel env:', VAPID_PUBLIC_KEY ? `${VAPID_PUBLIC_KEY.substring(0, 30)}...` : 'NOT SET');
console.log('[ENV] VAPID_PRIVATE_KEY from Vercel env:', VAPID_PRIVATE_KEY ? `${VAPID_PRIVATE_KEY.substring(0, 30)}...` : 'NOT SET');
console.log('[ENV] WEB_PUSH_CONTACT from Vercel env:', WEB_PUSH_CONTACT || 'NOT SET');
console.log('[ENV] ===========================================');

// Fix the contact format for web-push
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
    console.log('[Push] Web push configured successfully with Vercel env variables');
} else {
    console.log('[Push] Web push NOT configured - missing Vercel env variables:', {
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

// ==================== GET VAPID PUBLIC KEY ====================
function handleGetVapidKey(req, res) {
    console.log('[API] handleGetVapidKey called');
    console.log('[API] VAPID_PUBLIC_KEY from Vercel env:', VAPID_PUBLIC_KEY ? `${VAPID_PUBLIC_KEY.substring(0, 30)}...` : 'NOT SET');
    
    if (!VAPID_PUBLIC_KEY) {
        console.log('[API] ERROR: VAPID_PUBLIC_KEY not set in Vercel environment variables');
        return res.status(404).json({ 
            success: false, 
            error: 'VAPID public key not configured on server',
            message: 'Please set VAPID_PUBLIC_KEY in Vercel environment variables'
        });
    }
    
    console.log('[API] Returning VAPID public key to client');
    return res.status(200).json({
        success: true,
        vapidPublicKey: VAPID_PUBLIC_KEY,
        source: 'vercel_environment_variables'
    });
}

// ==================== TEST ENDPOINT - CHECK SUBSCRIPTIONS ====================
async function handleTestSubscriptions(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    try {
        // Get all subscriptions for this user
        const subscriptions = await sql`
            SELECT id, user_id, endpoint, 
                   CASE WHEN p256dh IS NOT NULL THEN 'YES' ELSE 'NO' END as has_p256dh,
                   CASE WHEN auth IS NOT NULL THEN 'YES' ELSE 'NO' END as has_auth,
                   created_at, updated_at
            FROM push_subscriptions 
            WHERE user_id = ${user.userId}
        `;
        
        console.log(`[Test] Found ${subscriptions.length} subscriptions for user ${user.userId}`);
        
        return res.status(200).json({
            success: true,
            subscriptions: subscriptions.map(s => ({
                id: s.id,
                has_p256dh: s.has_p256dh,
                has_auth: s.has_auth,
                endpoint_preview: s.endpoint ? s.endpoint.substring(0, 60) + '...' : null,
                created_at: s.created_at,
                updated_at: s.updated_at
            })),
            count: subscriptions.length,
            message: subscriptions.length > 0 ? 'Subscriptions found in database' : 'No subscriptions found for this user'
        });
        
    } catch (error) {
        console.error('[Test] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==================== TEST SEND NOTIFICATION ====================
async function handleTestSend(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    try {
        const { title, body } = req.body;
        
        // Get user's push subscriptions
        const subscriptions = await sql`
            SELECT endpoint, p256dh, auth 
            FROM push_subscriptions 
            WHERE user_id = ${user.userId}
        `;
        
        if (subscriptions.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'No push subscriptions found for this user' 
            });
        }
        
        const payload = JSON.stringify({
            title: title || 'Test Notification',
            body: body || 'This is a test notification from your server!',
            icon: '/icon-192.png',
            badge: '/badge.png',
            data: { userId: user.userId, url: '/' }
        });
        
        let sentCount = 0;
        let errors = [];
        
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
                console.log(`[Test] Sent test notification to ${user.userId}`);
            } catch (error) {
                console.error(`[Test] Failed to send to ${user.userId}:`, error.statusCode, error.message);
                errors.push({ endpoint: sub.endpoint.substring(0, 50), error: error.message });
                if (error.statusCode === 410) {
                    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
                    console.log(`[Test] Removed invalid subscription for ${user.userId}`);
                }
            }
        }
        
        return res.status(200).json({
            success: sentCount > 0,
            sent: sentCount,
            total: subscriptions.length,
            errors: errors.length > 0 ? errors : undefined,
            message: sentCount > 0 ? `Sent ${sentCount} test notification(s)` : 'Failed to send test notifications'
        });
        
    } catch (error) {
        console.error('[Test] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ==================== DELETE ALL SUBSCRIPTIONS ====================
async function handleClearSubscriptions(req, res) {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    try {
        const result = await sql`
            DELETE FROM push_subscriptions 
            WHERE user_id = ${user.userId}
            RETURNING id
        `;
        
        console.log(`[Clear] Deleted ${result.length} subscriptions for user ${user.userId}`);
        
        return res.status(200).json({
            success: true,
            deleted: result.length,
            message: `Deleted ${result.length} subscription(s)`
        });
        
    } catch (error) {
        console.error('[Clear] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;
    
    console.log(`[API] Request received: action=${action}, method=${req.method}`);

    try {
        // NEW TEST ACTIONS
        if (action === 'get-vapid-key') {
            return handleGetVapidKey(req, res);
        } else if (action === 'test-subscriptions') {
            return await handleTestSubscriptions(req, res);
        } else if (action === 'test-send') {
            return await handleTestSend(req, res);
        } else if (action === 'clear-subscriptions') {
            return await handleClearSubscriptions(req, res);
        } else if (action === 'save') {
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
                message: 'Notifications API is working. Available actions: save, get, subscribe, cron, client-check, update-alarms, update-checkout-alarm, reset-daily-alarms, sync-timezone, get-vapid-key, test-subscriptions, test-send, clear-subscriptions' 
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
        
        let checkin_alarm_utc = null;
        let checkout_alarm_utc = null;
        
        if (is_alarm_enabled && checkin_time_local) {
            const [hours, minutes] = checkin_time_local.split(':').map(Number);
            let totalMinutes = (hours * 60) + minutes;
            let utcTotalMinutes = totalMinutes + tz_offset;
            if (utcTotalMinutes < 0) utcTotalMinutes += 1440;
            if (utcTotalMinutes >= 1440) utcTotalMinutes -= 1440;
            const utcHours = Math.floor(utcTotalMinutes / 60);
            const utcMinutes = utcTotalMinutes % 60;
            checkin_alarm_utc = `${String(utcHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}:00`;
            console.log(`[Alarm] Checkin converted to UTC: ${checkin_alarm_utc}`);
        }
        
        if (is_alarm_enabled && checkout_time_local) {
            const [hours, minutes] = checkout_time_local.split(':').map(Number);
            let totalMinutes = (hours * 60) + minutes;
            let utcTotalMinutes = totalMinutes + tz_offset;
            if (utcTotalMinutes < 0) utcTotalMinutes += 1440;
            if (utcTotalMinutes >= 1440) utcTotalMinutes -= 1440;
            const utcHours = Math.floor(utcTotalMinutes / 60);
            const utcMinutes = utcTotalMinutes % 60;
            checkout_alarm_utc = `${String(utcHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}:00`;
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
        
        let local_checkin_time = settings.default_checkin_time || '09:00';
        let local_checkout_time = settings.default_checkout_time || '18:00';
        
        if (settings.checkin_alarm_utc && settings.tz_offset !== null) {
            const [utcHours, utcMinutes] = settings.checkin_alarm_utc.split(':').map(Number);
            let totalMinutes = (utcHours * 60) + utcMinutes;
            let localTotalMinutes = totalMinutes - settings.tz_offset;
            if (localTotalMinutes < 0) localTotalMinutes += 1440;
            if (localTotalMinutes >= 1440) localTotalMinutes -= 1440;
            const localHours = Math.floor(localTotalMinutes / 60);
            const localMins = localTotalMinutes % 60;
            local_checkin_time = `${String(localHours).padStart(2, '0')}:${String(localMins).padStart(2, '0')}`;
        }
        
        if (settings.checkout_alarm_utc && settings.tz_offset !== null) {
            const [utcHours, utcMinutes] = settings.checkout_alarm_utc.split(':').map(Number);
            let totalMinutes = (utcHours * 60) + utcMinutes;
            let localTotalMinutes = totalMinutes - settings.tz_offset;
            if (localTotalMinutes < 0) localTotalMinutes += 1440;
            if (localTotalMinutes >= 1440) localTotalMinutes -= 1440;
            const localHours = Math.floor(localTotalMinutes / 60);
            const localMins = localTotalMinutes % 60;
            local_checkout_time = `${String(localHours).padStart(2, '0')}:${String(localMins).padStart(2, '0')}`;
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
        
        console.log(`[Subscribe] Received subscription for user ${user.userId}`);
        console.log(`[Subscribe] Has endpoint: ${!!subscription.endpoint}`);
        console.log(`[Subscribe] Has keys: ${!!subscription.keys}`);
        console.log(`[Subscribe] Has p256dh: ${!!(subscription.keys && subscription.keys.p256dh)}`);
        console.log(`[Subscribe] Has auth: ${!!(subscription.keys && subscription.keys.auth)}`);
        
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid subscription data - missing endpoint' 
            });
        }
        
        // Validate keys exist
        if (!subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
            console.log(`[Subscribe] WARNING: Subscription missing keys!`);
            console.log(`[Subscribe] Keys object:`, subscription.keys);
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid subscription data - missing p256dh or auth keys',
                debug: { hasKeys: !!subscription.keys, hasP256dh: !!(subscription.keys && subscription.keys.p256dh), hasAuth: !!(subscription.keys && subscription.keys.auth) }
            });
        }
        
        // Create table if not exists
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
        
        // UPSERT
        await sql`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
            VALUES (${user.userId}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, NOW())
            ON CONFLICT (endpoint) 
            DO UPDATE SET 
                user_id = EXCLUDED.user_id, 
                p256dh = EXCLUDED.p256dh, 
                auth = EXCLUDED.auth, 
                updated_at = NOW()
        `;
        
        console.log(`[Subscribe] Subscription saved/updated for user ${user.userId}`);
        
        return res.status(200).json({ 
            success: true, 
            message: 'Subscribed successfully' 
        });
        
    } catch (error) {
        console.error('[Subscribe] Error:', error);
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
            const defaultCheckin = userSettings.default_checkin_time || '09:00';
            const [checkinHours, checkinMinutes] = defaultCheckin.split(':').map(Number);
            
            let checkinTotalMinutes = (checkinHours * 60) + checkinMinutes;
            let checkinUtcTotalMinutes = checkinTotalMinutes + userOffset;
            if (checkinUtcTotalMinutes < 0) checkinUtcTotalMinutes += 1440;
            if (checkinUtcTotalMinutes >= 1440) checkinUtcTotalMinutes -= 1440;
            const checkinUtcHour = Math.floor(checkinUtcTotalMinutes / 60);
            const checkinUtcMinute = checkinUtcTotalMinutes % 60;
            const nextCheckinUTC = `${String(checkinUtcHour).padStart(2, '0')}:${String(checkinUtcMinute).padStart(2, '0')}:00`;
            
            let checkoutAlarmLocal = checkoutTimeLocal || userSettings.default_checkout_time || '18:00';
            const [checkoutHours, checkoutMinutes] = checkoutAlarmLocal.split(':').map(Number);
            
            let checkoutTotalMinutes = (checkoutHours * 60) + checkoutMinutes;
            let checkoutUtcTotalMinutes = checkoutTotalMinutes + userOffset;
            if (checkoutUtcTotalMinutes < 0) checkoutUtcTotalMinutes += 1440;
            if (checkoutUtcTotalMinutes >= 1440) checkoutUtcTotalMinutes -= 1440;
            const checkoutUtcHour = Math.floor(checkoutUtcTotalMinutes / 60);
            const checkoutUtcMinute = checkoutUtcTotalMinutes % 60;
            const nextCheckoutUTC = `${String(checkoutUtcHour).padStart(2, '0')}:${String(checkoutUtcMinute).padStart(2, '0')}:00`;
            
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
        
        let checkoutAlarmUtc = null;
        if (checkout_time_local) {
            const [hours, minutes] = checkout_time_local.split(':').map(Number);
            let totalMinutes = (hours * 60) + minutes;
            let utcTotalMinutes = totalMinutes + userOffset;
            if (utcTotalMinutes < 0) utcTotalMinutes += 1440;
            if (utcTotalMinutes >= 1440) utcTotalMinutes -= 1440;
            const utcHours = Math.floor(utcTotalMinutes / 60);
            const utcMinutes = utcTotalMinutes % 60;
            checkoutAlarmUtc = `${String(utcHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}:00`;
        }
        
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
        
        const [checkinHour, checkinMinute] = (userData.default_checkin_time || '09:00').split(':').map(Number);
        const [checkoutHour, checkoutMinute] = (userData.default_checkout_time || '18:00').split(':').map(Number);
        
        let checkinTotalMinutes = (checkinHour * 60) + checkinMinute;
        let checkinUtcTotalMinutes = checkinTotalMinutes + tzOffset;
        if (checkinUtcTotalMinutes < 0) checkinUtcTotalMinutes += 1440;
        if (checkinUtcTotalMinutes >= 1440) checkinUtcTotalMinutes -= 1440;
        const checkinUtcHour = Math.floor(checkinUtcTotalMinutes / 60);
        const checkinUtcMinute = checkinUtcTotalMinutes % 60;
        const checkinAlarmUtc = `${String(checkinUtcHour).padStart(2, '0')}:${String(checkinUtcMinute).padStart(2, '0')}:00`;
        
        let checkoutTotalMinutes = (checkoutHour * 60) + checkoutMinute;
        let checkoutUtcTotalMinutes = checkoutTotalMinutes + tzOffset;
        if (checkoutUtcTotalMinutes < 0) checkoutUtcTotalMinutes += 1440;
        if (checkoutUtcTotalMinutes >= 1440) checkoutUtcTotalMinutes -= 1440;
        const checkoutUtcHour = Math.floor(checkoutUtcTotalMinutes / 60);
        const checkoutUtcMinute = checkoutUtcTotalMinutes % 60;
        const checkoutAlarmUtc = `${String(checkoutUtcHour).padStart(2, '0')}:${String(checkoutUtcMinute).padStart(2, '0')}:00`;
        
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
        
        const hasEntry = await sql`
            SELECT check_in, check_out FROM attendance_ledger 
            WHERE user_id = ${user.userId} AND date = ${todayDate}
            LIMIT 1
        `;
        
        const isCheckedIn = hasEntry.length > 0 && hasEntry[0].check_in !== null;
        const isCheckedOut = hasEntry.length > 0 && hasEntry[0].check_out !== null;
        
        let notificationsSent = [];
        
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
                    
                    const usersDefault = await sql`
                        SELECT default_checkout_time, tz_offset FROM users WHERE id = ${user.userId}
                    `;
                    if (usersDefault.length > 0) {
                        const defaultCheckout = usersDefault[0].default_checkout_time || '18:00';
                        const [checkoutHour, checkoutMinute] = defaultCheckout.split(':').map(Number);
                        const tzOff = usersDefault[0].tz_offset || 0;
                        
                        let checkoutTotalMinutes = (checkoutHour * 60) + checkoutMinute;
                        let checkoutUtcTotalMinutes = checkoutTotalMinutes + tzOff;
                        if (checkoutUtcTotalMinutes < 0) checkoutUtcTotalMinutes += 1440;
                        if (checkoutUtcTotalMinutes >= 1440) checkoutUtcTotalMinutes -= 1440;
                        const checkoutUtcHour = Math.floor(checkoutUtcTotalMinutes / 60);
                        const checkoutUtcMinute = checkoutUtcTotalMinutes % 60;
                        const nextDayCheckoutUtc = `${String(checkoutUtcHour).padStart(2, '0')}:${String(checkoutUtcMinute).padStart(2, '0')}:00`;
                        
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
            const hasEntry = await sql`
                SELECT check_in, check_out FROM attendance_ledger 
                WHERE user_id = ${user.id} AND date = ${todayDate}
                LIMIT 1
            `;
            
            const isCheckedIn = hasEntry.length > 0 && hasEntry[0].check_in !== null;
            const isCheckedOut = hasEntry.length > 0 && hasEntry[0].check_out !== null;
            
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
                        
                        const defaultCheckout = user.default_checkout_time || '18:00';
                        const [checkoutHour, checkoutMinute] = defaultCheckout.split(':').map(Number);
                        
                        let checkoutTotalMinutes = (checkoutHour * 60) + checkoutMinute;
                        let checkoutUtcTotalMinutes = checkoutTotalMinutes + user.tz_offset;
                        if (checkoutUtcTotalMinutes < 0) checkoutUtcTotalMinutes += 1440;
                        if (checkoutUtcTotalMinutes >= 1440) checkoutUtcTotalMinutes -= 1440;
                        const checkoutUtcHour = Math.floor(checkoutUtcTotalMinutes / 60);
                        const checkoutUtcMinute = checkoutUtcTotalMinutes % 60;
                        const nextDayCheckoutUtc = `${String(checkoutUtcHour).padStart(2, '0')}:${String(checkoutUtcMinute).padStart(2, '0')}:00`;
                        
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

// Helper functions
function isStrictlyWithin15Minutes(alarmTime, currentTime) {
    const [alarmHour, alarmMin] = alarmTime.split(':').map(Number);
    const [currentHour, currentMin] = currentTime.split(':').map(Number);
    
    let alarmTotal = alarmHour * 60 + alarmMin;
    let currentTotal = currentHour * 60 + currentMin;
    
    if (currentTotal > alarmTotal && (currentTotal - alarmTotal) > 12 * 60) {
        currentTotal -= 24 * 60;
    }
    if (alarmTotal < currentTotal && (currentTotal - alarmTotal) > 12 * 60) {
        alarmTotal += 24 * 60;
    }
    
    const diff = alarmTotal - currentTotal;
    return diff >= 0 && diff <= 15;
}

function shouldSendNotification(lastNotifiedAt, alarmTime, currentUtcTimestamp) {
    if (!lastNotifiedAt) return true;
    
    try {
        const lastNotified = new Date(lastNotifiedAt);
        const [alarmHour, alarmMin] = alarmTime.split(':').map(Number);
        
        const alarmTimestamp = new Date(currentUtcTimestamp);
        alarmTimestamp.setUTCHours(alarmHour, alarmMin, 0, 0);
        
        let alarmDateTime = alarmTimestamp;
        if (alarmTimestamp < currentUtcTimestamp) {
            alarmDateTime = new Date(alarmTimestamp);
            alarmDateTime.setUTCDate(alarmDateTime.getUTCDate() + 1);
        }
        
        const minutesSinceLastNotified = (alarmDateTime - lastNotified) / (1000 * 60);
        return minutesSinceLastNotified > 15;
    } catch (error) {
        return true;
    }
}

async function sendPushToUser(userId, type, user) {
    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        console.log(`[Push] VAPID keys not configured - cannot send push to ${userId}`);
        return;
    }
    
    try {
        const subscriptions = await sql`
            SELECT endpoint, p256dh, auth 
            FROM push_subscriptions 
            WHERE user_id = ${userId}
        `;
        
        if (subscriptions.length === 0) {
            console.log(`[Push] No subscription for user ${userId}`);
            return;
        }
        
        let localTime = type === 'checkin' ? user.checkin_alarm_utc : user.checkout_alarm_utc;
        if (localTime && user.tz_offset !== null) {
            const [utcHour, utcMin] = localTime.split(':').map(Number);
            let totalMinutes = (utcHour * 60) + utcMin;
            let localTotalMinutes = totalMinutes - user.tz_offset;
            if (localTotalMinutes < 0) localTotalMinutes += 1440;
            if (localTotalMinutes >= 1440) localTotalMinutes -= 1440;
            const localHour = Math.floor(localTotalMinutes / 60);
            const localMinute = localTotalMinutes % 60;
            const ampm = localHour >= 12 ? 'PM' : 'AM';
            const hour12 = localHour % 12 || 12;
            localTime = `${hour12}:${String(localMinute).padStart(2, '0')} ${ampm}`;
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
