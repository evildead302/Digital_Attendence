import { neon } from '@neondatabase/serverless';
import { google } from 'googleapis';

const sql = neon(process.env.DATABASE_URL);

// Gmail API Configuration
let gmail = null;
let gmailConfigured = false;

try {
    console.log('[API] Initializing Gmail API...');
    console.log('[API] GMAIL_CLIENT_ID exists:', !!process.env.GMAIL_CLIENT_ID);
    console.log('[API] GMAIL_CLIENT_SECRET exists:', !!process.env.GMAIL_CLIENT_SECRET);
    console.log('[API] GMAIL_REFRESH_TOKEN exists:', !!process.env.GMAIL_REFRESH_TOKEN);
    console.log('[API] GMAIL_REDIRECT_URI exists:', !!process.env.GMAIL_REDIRECT_URI);
    
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
        console.log('[API] Missing Gmail API credentials. Email verification will be skipped.');
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
 */
async function verifyGmailInbox(email, otpCode, expiry) {
    if (!gmailConfigured || !gmail) {
        console.log('[API] Gmail API not configured - using database verification only');
        return true; // Skip Gmail verification if not configured
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
            console.log('[API] No matching emails found');
            return false;
        }

        // Get the most recent message to verify
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

        console.log(`[API] Email subject: ${emailSubject}`);
        console.log(`[API] Email from: ${emailFrom}`);
        
        // Convert to uppercase for comparison
        const subjectUpper = emailSubject.toUpperCase().trim();
        
        if (!subjectUpper.includes(otpCode)) {
            console.log(`[API] Subject mismatch. Expected to contain: ${otpCode}, Got: ${subjectUpper}`);
            return false;
        }

        if (!emailFrom.toLowerCase().includes(email.toLowerCase())) {
            console.log(`[API] Sender mismatch. Expected: ${email}, Got: ${emailFrom}`);
            return false;
        }

        console.log('[API] Email verified successfully');
        return true;

    } catch (error) {
        console.error('[API] Gmail API error details:', error.message);
        if (error.response) {
            console.error('[API] Error response data:', error.response.data);
        }
        if (error.code) {
            console.error('[API] Error code:', error.code);
        }
        throw new Error(`Gmail verification failed: ${error.message}`);
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

        // Get user from database
        const users = await sql`
            SELECT id, email, otp_code, otp_expiry, is_verified 
            FROM users 
            WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const user = users[0];

        // Check OTP
        if (!user.otp_code) {
            return res.status(400).json({ 
                success: false, 
                message: 'No active OTP found' 
            });
        }

        // Check expiry
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
                message: 'OTP has expired' 
            });
        }

        // Compare OTP
        if (user.otp_code !== normalizedOTP) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid OTP code' 
            });
        }

        // Verify Gmail inbox (if configured)
        let gmailVerified = true;
        
        if (gmailConfigured) {
            try {
                gmailVerified = await verifyGmailInbox(normalizedEmail, normalizedOTP, expiry);
                console.log(`[API] Gmail verification result: ${gmailVerified}`);
            } catch (error) {
                console.error('[API] Gmail verification error:', error.message);
                // For registration, we still verify the user even if Gmail check fails
                // The OTP itself is sufficient proof
                if (purpose === 'register') {
                    console.log('[API] Gmail API error but OTP is valid - proceeding with verification for registration');
                    gmailVerified = true;
                } else {
                    gmailVerified = false;
                }
            }
        } else {
            console.log('[API] Gmail API not configured, skipping inbox verification');
        }

        // For registration, we don't require Gmail verification - OTP is enough
        if (!gmailVerified && purpose === 'register') {
            console.log('[API] Gmail verification failed/skipped but OTP is valid - accepting for registration');
            gmailVerified = true; // Accept OTP-only verification for registration
        }

        if (!gmailVerified) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please send the OTP email to verify your identity' 
            });
        }

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
            console.log(`[API] User ${normalizedEmail} verified successfully`);
        } else if (purpose === 'reset') {
            // For password reset, just clear OTP, don't change verification status
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            console.log(`[API] OTP cleared for password reset - ${normalizedEmail}`);
        } else {
            // Generic OTP verification (clear OTP only)
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            console.log(`[API] OTP cleared for ${normalizedEmail}`);
        }

        return res.status(200).json({
            success: true,
            message: 'OTP verified successfully',
            userId: user.id,
            email: user.email,
            purpose: purpose || 'unknown',
            isVerified: purpose === 'register' ? true : user.is_verified
        });

    } catch (error) {
        console.error('[API] Verify OTP error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Verification failed: ' + (error.message || 'Please try again')
        });
    }
}
