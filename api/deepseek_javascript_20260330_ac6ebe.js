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
    if (!gmailConfigured || !gmail) {
        return { 
            success: false, 
            status: 'NOT_CONFIGURED',
            message: 'Email verification service is not configured'
        };
    }
    
    try {
        // Calculate when OTP was generated (7 minutes before expiry)
        const otpGeneratedAt = new Date(expiry.getTime() - (7 * 60 * 1000));
        
        // Format date for Gmail search (YYYY/MM/DD)
        const year = otpGeneratedAt.getFullYear();
        const month = String(otpGeneratedAt.getMonth() + 1).padStart(2, '0');
        const day = String(otpGeneratedAt.getDate()).padStart(2, '0');
        const dateStr = `${year}/${month}/${day}`;
        
        // Search for emails from this user with subject containing the OTP
        const query = `from:${email} subject:${otpCode} after:${dateStr}`;
        
        console.log(`[API] Gmail search query: ${query}`);
        
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 5
        });

        const messages = response.data.messages || [];
        console.log(`[API] Found ${messages.length} matching emails`);

        if (messages.length === 0) {
            return { 
                success: false, 
                status: 'NO_EMAIL_FOUND',
                message: `No email found from ${email} with OTP: ${otpCode}`
            };
        }

        // Get the most recent message
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

        console.log(`[API] Email found - From: ${emailFrom}, Subject: ${emailSubject}`);
        
        // Verify subject contains OTP
        const subjectUpper = emailSubject.toUpperCase().trim();
        if (!subjectUpper.includes(otpCode)) {
            return { 
                success: false, 
                status: 'SUBJECT_MISMATCH',
                message: `Email subject "${emailSubject}" does not contain OTP: ${otpCode}`
            };
        }

        // Verify sender email matches
        if (!emailFrom.toLowerCase().includes(email.toLowerCase())) {
            return { 
                success: false, 
                status: 'SENDER_MISMATCH',
                message: `Email sent from ${emailFrom}, but expected from ${email}`
            };
        }

        console.log('[API] Email verified successfully');
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
        console.error('[API] Gmail API error:', error.message);
        
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
    console.log(`[API] Verify OTP request: ${req.method}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }

    try {
        const { email, otpCode, purpose } = req.body;

        console.log(`[API] Verifying OTP for: ${email}, purpose: ${purpose}`);

        // Validate required fields
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email is required' 
            });
        }

        if (!otpCode) {
            return res.status(400).json({ 
                success: false, 
                message: 'OTP code is required' 
            });
        }

        // Normalize
        const normalizedEmail = email.toLowerCase().trim();
        const normalizedOTP = otpCode.toUpperCase().trim();

        // Validate OTP format
        if (!/^[A-Z0-9]{6}$/.test(normalizedOTP)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid OTP format' 
            });
        }

        // Check if Gmail API is configured
        if (!gmailConfigured) {
            console.error('[API] Gmail API not configured');
            return res.status(500).json({ 
                success: false, 
                message: 'Email verification service is not configured. Please contact support.' 
            });
        }

        // Get user from database
        const users = await sql`
            SELECT id, email, otp_code, otp_expiry, is_verified 
            FROM users 
            WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found. Please register first.' 
            });
        }

        const user = users[0];

        // Check OTP exists
        if (!user.otp_code) {
            return res.status(400).json({ 
                success: false, 
                message: 'No active OTP found. Please request a new OTP.' 
            });
        }

        // Check OTP expiry
        const now = new Date();
        const expiry = new Date(user.otp_expiry);
        
        if (now > expiry) {
            await sql`
                UPDATE users 
                SET otp_code = NULL, otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            return res.status(400).json({ 
                success: false, 
                message: 'OTP has expired. Please request a new OTP.' 
            });
        }

        // Compare OTP code
        if (user.otp_code !== normalizedOTP) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid OTP code. Please check and try again.' 
            });
        }

        // ========== VERIFY EMAIL IN GMAIL INBOX ==========
        const verificationResult = await verifyGmailInbox(normalizedEmail, normalizedOTP, expiry);
        
        console.log(`[API] Verification result: ${verificationResult.status}`);
        
        // Handle different verification results
        if (!verificationResult.success) {
            // Return specific user-friendly messages based on status
            switch(verificationResult.status) {
                case 'NO_EMAIL_FOUND':
                    return res.status(400).json({ 
                        success: false, 
                        message: `📧 No email found. Please send an email to the app email address with subject: ${normalizedOTP}`,
                        details: {
                            requiredOTP: normalizedOTP,
                            appEmail: process.env.APP_GMAIL_ADDRESS || 'attendance.diary.app@gmail.com'
                        }
                    });
                    
                case 'SUBJECT_MISMATCH':
                    return res.status(400).json({ 
                        success: false, 
                        message: `❌ Email subject incorrect. The subject must be exactly: ${normalizedOTP}`,
                        details: {
                            requiredOTP: normalizedOTP,
                            currentSubject: verificationResult.details?.subject
                        }
                    });
                    
                case 'SENDER_MISMATCH':
                    return res.status(400).json({ 
                        success: false, 
                        message: `❌ Please send the email from ${normalizedEmail}`,
                        details: {
                            requiredEmail: normalizedEmail,
                            sentFrom: verificationResult.details?.from
                        }
                    });
                    
                case 'AUTH_ERROR':
                    return res.status(503).json({ 
                        success: false, 
                        message: '🔧 Email verification service needs maintenance. Please try again later or contact support.'
                    });
                    
                case 'RATE_LIMIT':
                    return res.status(429).json({ 
                        success: false, 
                        message: '⏳ Too many verification attempts. Please wait 1 minute and try again.'
                    });
                    
                case 'QUOTA_EXCEEDED':
                    return res.status(503).json({ 
                        success: false, 
                        message: '📊 Daily verification limit reached. Please try again tomorrow.'
                    });
                    
                case 'PERMISSION_ERROR':
                    return res.status(503).json({ 
                        success: false, 
                        message: '🔒 Email verification permission error. Please contact support.'
                    });
                    
                case 'API_ERROR':
                    return res.status(500).json({ 
                        success: false, 
                        message: `⚠️ Email verification error: ${verificationResult.message}`
                    });
                    
                default:
                    return res.status(500).json({ 
                        success: false, 
                        message: verificationResult.message || 'Email verification failed. Please try again.'
                    });
            }
        }

        // ========== EMAIL VERIFIED SUCCESSFULLY ==========
        console.log(`[API] ✅ Email verified for ${normalizedEmail}`);
        console.log(`[API] Email details - From: ${verificationResult.details?.from}, Subject: ${verificationResult.details?.subject}`);

        // Update user based on purpose
        if (purpose === 'register') {
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL,
                    is_verified = TRUE
                WHERE id = ${user.id}
            `;
            console.log(`[API] User ${normalizedEmail} verified and activated`);
            
            return res.status(200).json({
                success: true,
                message: '✅ Email verified successfully! Your account is now active.',
                userId: user.id,
                email: user.email,
                purpose: 'register',
                isVerified: true
            });
            
        } else if (purpose === 'reset') {
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            console.log(`[API] OTP cleared for password reset - ${normalizedEmail}`);
            
            return res.status(200).json({
                success: true,
                message: '✅ Email verified! You can now reset your password.',
                userId: user.id,
                email: user.email,
                purpose: 'reset'
            });
            
        } else {
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            
            return res.status(200).json({
                success: true,
                message: '✅ OTP verified successfully',
                userId: user.id,
                email: user.email,
                purpose: purpose || 'unknown'
            });
        }

    } catch (error) {
        console.error('[API] Verify OTP error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Verification failed due to a server error. Please try again.'
        });
    }
}