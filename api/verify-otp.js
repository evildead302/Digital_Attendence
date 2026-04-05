import { neon } from '@neondatabase/serverless';
import { google } from 'googleapis';

const sql = neon(process.env.DATABASE_URL);

// Gmail API Configuration
let gmail = null;
let gmailConfigured = false;

try {
    console.log('[API] Initializing Gmail API...');
    
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
        console.log('[API] Missing Gmail API credentials');
        gmailConfigured = false;
    } else {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET,
            process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.GMAIL_REFRESH_TOKEN
        });

        gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        gmailConfigured = true;
        console.log('[API] Gmail API configured successfully');
    }
} catch (error) {
    console.error('[API] Failed to configure Gmail API:', error.message);
    gmailConfigured = false;
}

/**
 * Verify that the OTP email exists in Gmail inbox
 * Returns detailed status about what was found
 */
async function verifyGmailInbox(email, otpCode, expiry) {
    console.log(`[GMAIL_VERIFY] ========== GMAIL VERIFICATION START ==========`);
    console.log(`[GMAIL_VERIFY] Function: verifyGmailInbox()`);
    console.log(`[GMAIL_VERIFY] Called by: verify-otp handler`);
    console.log(`[GMAIL_VERIFY] Parameters: email=${email}, otpCode=${otpCode}, expiry=${expiry}`);
    
    if (!gmailConfigured || !gmail) {
        console.log(`[GMAIL_VERIFY] ERROR: Gmail API not configured or initialized`);
        return { 
            success: false, 
            status: 'NOT_CONFIGURED',
            message: 'Email verification service is not configured'
        };
    }
    
    try {
        // Calculate when OTP was generated (7 minutes before expiry)
        const otpGeneratedAt = new Date(expiry.getTime() - (7 * 60 * 1000));
        console.log(`[GMAIL_VERIFY] OTP generated at: ${otpGeneratedAt.toISOString()}`);
        
        // Format date for Gmail search (YYYY/MM/DD)
        const year = otpGeneratedAt.getFullYear();
        const month = String(otpGeneratedAt.getMonth() + 1).padStart(2, '0');
        const day = String(otpGeneratedAt.getDate()).padStart(2, '0');
        const dateStr = `${year}/${month}/${day}`;
        
        // Search for emails from this user with subject containing the OTP
        const query = `from:${email} subject:${otpCode} after:${dateStr}`;
        
        console.log(`[GMAIL_VERIFY] Gmail search query: ${query}`);
        console.log(`[GMAIL_VERIFY] Searching Gmail inbox for email from: ${email} with subject containing: ${otpCode}`);
        
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 5
        });

        const messages = response.data.messages || [];
        console.log(`[GMAIL_VERIFY] Found ${messages.length} matching emails in Gmail inbox`);

        if (messages.length === 0) {
            console.log(`[GMAIL_VERIFY] ❌ No email found matching criteria`);
            return { 
                success: false, 
                status: 'NO_EMAIL_FOUND',
                message: `No email found from ${email} with OTP: ${otpCode}`
            };
        }

        // Get the most recent message
        console.log(`[GMAIL_VERIFY] Fetching most recent matching email (ID: ${messages[0].id})`);
        const message = await gmail.users.messages.get({
            userId: 'me',
            id: messages[0].id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
        });

        const headers = message.data.payload.headers;
        const subjectHeader = headers.find(h => h.name === 'Subject');
        const fromHeader = headers.find(h => h.name === 'From');
        const dateHeader = headers.find(h => h.name === 'Date');
        
        const emailSubject = subjectHeader?.value || '';
        const emailFrom = fromHeader?.value || '';
        const emailDate = dateHeader?.value || '';

        console.log(`[GMAIL_VERIFY] Email found - From: ${emailFrom}, Subject: ${emailSubject}, Date: ${emailDate}`);
        
        // Verify subject contains OTP
        const subjectUpper = emailSubject.toUpperCase().trim();
        if (!subjectUpper.includes(otpCode)) {
            console.log(`[GMAIL_VERIFY] ❌ Subject mismatch - Expected to contain: ${otpCode}, Actual: ${emailSubject}`);
            return { 
                success: false, 
                status: 'SUBJECT_MISMATCH',
                message: `Email subject "${emailSubject}" does not contain OTP: ${otpCode}`
            };
        }
        console.log(`[GMAIL_VERIFY] ✅ Subject verification passed`);

        // Verify sender email matches
        if (!emailFrom.toLowerCase().includes(email.toLowerCase())) {
            console.log(`[GMAIL_VERIFY] ❌ Sender mismatch - Expected: ${email}, Actual: ${emailFrom}`);
            return { 
                success: false, 
                status: 'SENDER_MISMATCH',
                message: `Email sent from ${emailFrom}, but expected from ${email}`
            };
        }
        console.log(`[GMAIL_VERIFY] ✅ Sender verification passed`);

        console.log(`[GMAIL_VERIFY] ✅ Email verified successfully in Gmail inbox`);
        console.log(`[GMAIL_VERIFY] ========== GMAIL VERIFICATION END ==========`);
        
        return { 
            success: true, 
            status: 'VERIFIED',
            message: 'Email verified successfully',
            details: {
                from: emailFrom,
                subject: emailSubject,
                date: emailDate
            }
        };

    } catch (error) {
        console.error('[GMAIL_VERIFY] Gmail API error:', error.message);
        console.log(`[GMAIL_VERIFY] ========== GMAIL VERIFICATION ERROR ==========`);
        
        // Handle specific API errors
        if (error.message.includes('invalid_grant')) {
            return { 
                success: false, 
                status: 'AUTH_ERROR',
                message: 'Email verification service needs to be reauthorized. Please contact support.'
            };
        }
        
        if (error.message.includes('rateLimitExceeded')) {
            return { 
                success: false, 
                status: 'RATE_LIMIT',
                message: 'Too many verification attempts. Please wait a moment and try again.'
            };
        }
        
        if (error.message.includes('dailyLimitExceeded')) {
            return { 
                success: false, 
                status: 'QUOTA_EXCEEDED',
                message: 'Verification service limit reached. Please try again tomorrow.'
            };
        }
        
        if (error.code === 401 || error.code === 403) {
            return { 
                success: false, 
                status: 'PERMISSION_ERROR',
                message: 'Email verification permission error. Please contact support.'
            };
        }
        
        return { 
            success: false, 
            status: 'API_ERROR',
            message: `Gmail API error: ${error.message}`
        };
    }
}

export default async function handler(req, res) {
    console.log(`\n[VERIFY_OTP] ==========================================`);
    console.log(`[VERIFY_OTP] VERIFY OTP HANDLER INVOKED`);
    console.log(`[VERIFY_OTP] ==========================================`);
    console.log(`[VERIFY_OTP] Request Method: ${req.method}`);
    console.log(`[VERIFY_OTP] Request Time: ${new Date().toISOString()}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        console.log(`[VERIFY_OTP] Handling OPTIONS preflight request`);
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        console.log(`[VERIFY_OTP] ERROR: Method not allowed - ${req.method}`);
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }

    try {
        const { email, otpCode, purpose } = req.body;

        console.log(`\n[VERIFY_OTP] Request Body:`);
        console.log(`[VERIFY_OTP]   - email: ${email}`);
        console.log(`[VERIFY_OTP]   - otpCode: ${otpCode}`);
        console.log(`[VERIFY_OTP]   - purpose: ${purpose}`);
        console.log(`[VERIFY_OTP]   - purpose type: ${purpose === 'register' ? 'REGISTRATION' : purpose === 'reset' ? 'PASSWORD RESET' : 'UNKNOWN'}`);
        
        console.log(`\n[VERIFY_OTP] === FLOW: ${purpose === 'register' ? 'REGISTRATION VERIFICATION' : purpose === 'reset' ? 'PASSWORD RESET VERIFICATION' : 'GENERIC VERIFICATION'} ===`);

        // Validate required fields
        if (!email) {
            console.log(`[VERIFY_OTP] ERROR: Email is missing from request body`);
            return res.status(400).json({ 
                success: false, 
                message: 'Email is required' 
            });
        }

        if (!otpCode) {
            console.log(`[VERIFY_OTP] ERROR: OTP code is missing from request body`);
            return res.status(400).json({ 
                success: false, 
                message: 'OTP code is required' 
            });
        }

        // Normalize
        const normalizedEmail = email.toLowerCase().trim();
        const normalizedOTP = otpCode.toUpperCase().trim();
        
        console.log(`[VERIFY_OTP] Normalized values:`);
        console.log(`[VERIFY_OTP]   - email: ${normalizedEmail}`);
        console.log(`[VERIFY_OTP]   - otpCode: ${normalizedOTP}`);

        // Validate OTP format
        if (!/^[A-Z0-9]{6}$/.test(normalizedOTP)) {
            console.log(`[VERIFY_OTP] ERROR: Invalid OTP format - ${normalizedOTP} (must be 6 alphanumeric characters)`);
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid OTP format' 
            });
        }
        console.log(`[VERIFY_OTP] ✅ OTP format validation passed`);

        // Check if Gmail API is configured
        if (!gmailConfigured) {
            console.error('[VERIFY_OTP] ERROR: Gmail API not configured - verification service unavailable');
            return res.status(500).json({ 
                success: false, 
                message: 'Email verification service is not configured. Please contact support.' 
            });
        }
        console.log(`[VERIFY_OTP] ✅ Gmail API is configured`);

        // Get user from database
        console.log(`[VERIFY_OTP] Querying database for user: ${normalizedEmail}`);
        const users = await sql`
            SELECT id, email, otp_code, otp_expiry, is_verified 
            FROM users 
            WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            console.log(`[VERIFY_OTP] ❌ User not found in database: ${normalizedEmail}`);
            return res.status(404).json({ 
                success: false, 
                message: 'User not found. Please register first.' 
            });
        }

        const user = users[0];
        console.log(`[VERIFY_OTP] ✅ User found:`);
        console.log(`[VERIFY_OTP]   - User ID: ${user.id}`);
        console.log(`[VERIFY_OTP]   - Email: ${user.email}`);
        console.log(`[VERIFY_OTP]   - Is Verified: ${user.is_verified}`);
        console.log(`[VERIFY_OTP]   - Stored OTP: ${user.otp_code}`);
        console.log(`[VERIFY_OTP]   - OTP Expiry: ${user.otp_expiry}`);

        // Check OTP exists
        if (!user.otp_code) {
            console.log(`[VERIFY_OTP] ❌ No active OTP found for user ${normalizedEmail}`);
            return res.status(400).json({ 
                success: false, 
                message: 'No active OTP found. Please request a new OTP.' 
            });
        }

        // Check OTP expiry
        const now = new Date();
        const expiry = new Date(user.otp_expiry);
        
        console.log(`[VERIFY_OTP] OTP Expiry Check:`);
        console.log(`[VERIFY_OTP]   - Current time: ${now.toISOString()}`);
        console.log(`[VERIFY_OTP]   - OTP Expiry: ${expiry.toISOString()}`);
        console.log(`[VERIFY_OTP]   - Time remaining: ${Math.max(0, (expiry - now) / 1000)} seconds`);
        
        if (now > expiry) {
            console.log(`[VERIFY_OTP] ❌ OTP has expired for user ${normalizedEmail}`);
            await sql`
                UPDATE users 
                SET otp_code = NULL, otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            console.log(`[VERIFY_OTP] Expired OTP cleared from database`);
            return res.status(400).json({ 
                success: false, 
                message: 'OTP has expired. Please request a new OTP.' 
            });
        }
        console.log(`[VERIFY_OTP] ✅ OTP is still valid`);

        // Compare OTP code
        console.log(`[VERIFY_OTP] Comparing OTP codes:`);
        console.log(`[VERIFY_OTP]   - Provided OTP: ${normalizedOTP}`);
        console.log(`[VERIFY_OTP]   - Stored OTP: ${user.otp_code}`);
        console.log(`[VERIFY_OTP]   - Match: ${user.otp_code === normalizedOTP ? 'YES' : 'NO'}`);
        
        if (user.otp_code !== normalizedOTP) {
            console.log(`[VERIFY_OTP] ❌ OTP code mismatch for ${normalizedEmail}`);
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid OTP code. Please check and try again.' 
            });
        }
        console.log(`[VERIFY_OTP] ✅ OTP code matches`);

        // ========== VERIFY EMAIL IN GMAIL INBOX ==========
        console.log(`\n[VERIFY_OTP] === STARTING GMAIL INBOX VERIFICATION ===`);
        console.log(`[VERIFY_OTP] Calling verifyGmailInbox() for ${normalizedEmail}`);
        
        const verificationResult = await verifyGmailInbox(normalizedEmail, normalizedOTP, expiry);
        
        console.log(`\n[VERIFY_OTP] Gmail Verification Result:`);
        console.log(`[VERIFY_OTP]   - Status: ${verificationResult.status}`);
        console.log(`[VERIFY_OTP]   - Success: ${verificationResult.success}`);
        console.log(`[VERIFY_OTP]   - Message: ${verificationResult.message}`);
        
        // Handle different verification results
        if (!verificationResult.success) {
            console.log(`[VERIFY_OTP] ❌ Gmail verification FAILED for ${normalizedEmail}`);
            console.log(`[VERIFY_OTP] Failure reason: ${verificationResult.status}`);
            
            // Return specific user-friendly messages based on status
            switch(verificationResult.status) {
                case 'NO_EMAIL_FOUND':
                    console.log(`[VERIFY_OTP] No email found in Gmail inbox`);
                    return res.status(400).json({ 
                        success: false, 
                        message: `📧 No email found. Please send an email to the app email address with subject: ${normalizedOTP}`,
                        details: {
                            requiredOTP: normalizedOTP,
                            appEmail: process.env.APP_GMAIL_ADDRESS || 'attendance.diary.app@gmail.com'
                        }
                    });
                    
                case 'SUBJECT_MISMATCH':
                    console.log(`[VERIFY_OTP] Email subject mismatch`);
                    return res.status(400).json({ 
                        success: false, 
                        message: `❌ Email subject incorrect. The subject must be exactly: ${normalizedOTP}`,
                        details: {
                            requiredOTP: normalizedOTP,
                            currentSubject: verificationResult.details?.subject
                        }
                    });
                    
                case 'SENDER_MISMATCH':
                    console.log(`[VERIFY_OTP] Email sender mismatch`);
                    return res.status(400).json({ 
                        success: false, 
                        message: `❌ Please send the email from ${normalizedEmail}`,
                        details: {
                            requiredEmail: normalizedEmail,
                            sentFrom: verificationResult.details?.from
                        }
                    });
                    
                case 'AUTH_ERROR':
                    console.log(`[VERIFY_OTP] Gmail authentication error`);
                    return res.status(503).json({ 
                        success: false, 
                        message: '🔧 Email verification service needs maintenance. Please try again later or contact support.'
                    });
                    
                case 'RATE_LIMIT':
                    console.log(`[VERIFY_OTP] Rate limit exceeded`);
                    return res.status(429).json({ 
                        success: false, 
                        message: '⏳ Too many verification attempts. Please wait 1 minute and try again.'
                    });
                    
                case 'QUOTA_EXCEEDED':
                    console.log(`[VERIFY_OTP] Daily quota exceeded`);
                    return res.status(503).json({ 
                        success: false, 
                        message: '📊 Daily verification limit reached. Please try again tomorrow.'
                    });
                    
                case 'PERMISSION_ERROR':
                    console.log(`[VERIFY_OTP] Permission error`);
                    return res.status(503).json({ 
                        success: false, 
                        message: '🔒 Email verification permission error. Please contact support.'
                    });
                    
                case 'API_ERROR':
                    console.log(`[VERIFY_OTP] Gmail API error: ${verificationResult.message}`);
                    return res.status(500).json({ 
                        success: false, 
                        message: `⚠️ Email verification error: ${verificationResult.message}`
                    });
                    
                default:
                    console.log(`[VERIFY_OTP] Unknown error: ${verificationResult.status}`);
                    return res.status(500).json({ 
                        success: false, 
                        message: verificationResult.message || 'Email verification failed. Please try again.'
                    });
            }
        }

        // ========== EMAIL VERIFIED SUCCESSFULLY ==========
        console.log(`\n[VERIFY_OTP] ✅✅✅ GMAIL VERIFICATION SUCCESSFUL ✅✅✅`);
        console.log(`[VERIFY_OTP] Email verified for ${normalizedEmail}`);
        console.log(`[VERIFY_OTP] Email details:`);
        console.log(`[VERIFY_OTP]   - From: ${verificationResult.details?.from}`);
        console.log(`[VERIFY_OTP]   - Subject: ${verificationResult.details?.subject}`);
        console.log(`[VERIFY_OTP]   - Date: ${verificationResult.details?.date}`);

        // Update user based on purpose
        console.log(`\n[VERIFY_OTP] === PROCESSING ${purpose.toUpperCase()} FLOW ===`);
        
        if (purpose === 'register') {
            console.log(`[VERIFY_OTP] 📝 REGISTRATION FLOW - Activating user account`);
            console.log(`[VERIFY_OTP] Updating user ${normalizedEmail}: setting is_verified = TRUE, clearing OTP`);
            
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL,
                    is_verified = TRUE
                WHERE id = ${user.id}
            `;
            console.log(`[VERIFY_OTP] ✅ User ${normalizedEmail} has been VERIFIED and ACTIVATED`);
            console.log(`[VERIFY_OTP] Registration flow completed successfully`);
            
            return res.status(200).json({
                success: true,
                message: '✅ Email verified successfully! Your account is now active.',
                userId: user.id,
                email: user.email,
                purpose: 'register',
                isVerified: true
            });
            
        } else if (purpose === 'reset') {
            console.log(`[VERIFY_OTP] 🔐 PASSWORD RESET FLOW - Verifying for password reset`);
            console.log(`[VERIFY_OTP] Updating user ${normalizedEmail}: clearing OTP for password reset`);
            
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            console.log(`[VERIFY_OTP] ✅ OTP cleared for ${normalizedEmail} - ready for password reset`);
            console.log(`[VERIFY_OTP] Password reset flow completed - user can now reset password`);
            
            return res.status(200).json({
                success: true,
                message: '✅ Email verified! You can now reset your password.',
                userId: user.id,
                email: user.email,
                purpose: 'reset'
            });
            
        } else {
            console.log(`[VERIFY_OTP] ℹ️ GENERIC VERIFICATION FLOW (purpose: ${purpose})`);
            console.log(`[VERIFY_OTP] Updating user ${normalizedEmail}: clearing OTP`);
            
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            
            console.log(`[VERIFY_OTP] ✅ OTP cleared for ${normalizedEmail}`);
            console.log(`[VERIFY_OTP] Generic verification flow completed`);
            
            return res.status(200).json({
                success: true,
                message: '✅ OTP verified successfully',
                userId: user.id,
                email: user.email,
                purpose: purpose || 'unknown'
            });
        }

    } catch (error) {
        console.error(`\n[VERIFY_OTP] ❌❌❌ UNHANDLED ERROR ❌❌❌`);
        console.error(`[VERIFY_OTP] Error message: ${error.message}`);
        console.error(`[VERIFY_OTP] Error stack: ${error.stack}`);
        console.error(`[VERIFY_OTP] Error name: ${error.name}`);
        
        console.log(`\n[VERIFY_OTP] Returning 500 Internal Server Error`);
        return res.status(500).json({ 
            success: false, 
            message: 'Verification failed due to a server error. Please try again.'
        });
    } finally {
        console.log(`\n[VERIFY_OTP] ==========================================`);
        console.log(`[VERIFY_OTP] VERIFY OTP HANDLER COMPLETED`);
        console.log(`[VERIFY_OTP] ==========================================\n`);
    }
}
