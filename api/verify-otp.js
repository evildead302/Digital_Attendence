import { neon } from '@neondatabase/serverless';
import { google } from 'googleapis';

const sql = neon(process.env.DATABASE_URL);

// Gmail API Configuration
const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
);

oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

/**
 * Verify that the OTP email exists in Gmail inbox
 * @param {string} email - User's email address
 * @param {string} otpCode - Uppercase OTP code
 * @param {Date} expiry - OTP expiry date
 * @returns {Promise<boolean>} - True if email found and verified
 */
async function verifyGmailInbox(email, otpCode, expiry) {
    try {
        // Calculate when OTP was generated (7 minutes before expiry)
        const otpGeneratedAt = new Date(expiry.getTime() - (7 * 60 * 1000));
        
        // Format date for Gmail search (YYYY/MM/DD)
        const year = otpGeneratedAt.getFullYear();
        const month = String(otpGeneratedAt.getMonth() + 1).padStart(2, '0');
        const day = String(otpGeneratedAt.getDate()).padStart(2, '0');
        const dateStr = `${year}/${month}/${day}`;
        
        // Search for emails from this user with subject containing the OTP
        // Gmail search is case-insensitive by default
        const query = `from:${email} subject:${otpCode} after:${dateStr}`;
        
        console.log(`[API] Gmail search query: ${query}`);
        
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 5 // Get a few to verify the most recent
        });

        const messages = response.data.messages || [];

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

        // IMPORTANT: Convert email subject to UPPERCASE for comparison
        const subjectUpper = emailSubject.toUpperCase().trim();
        
        // Check if the uppercase subject contains our uppercase OTP
        if (!subjectUpper.includes(otpCode)) {
            console.log(`[API] Subject mismatch. Expected to contain: ${otpCode}, Got: ${subjectUpper}`);
            return false;
        }

        // Verify email is from the correct user (case-insensitive email check)
        if (!emailFrom.toLowerCase().includes(email.toLowerCase())) {
            console.log(`[API] Sender mismatch. Expected: ${email}, Got: ${emailFrom}`);
            return false;
        }

        // Verify email was sent after OTP generation
        const emailTimestamp = new Date(emailDate).getTime();
        const otpGeneratedTimestamp = otpGeneratedAt.getTime();
        
        if (emailTimestamp < otpGeneratedTimestamp) {
            console.log(`[API] Email sent before OTP generation`);
            return false;
        }

        console.log('[API] Email verified successfully');
        return true;

    } catch (error) {
        console.error('[API] Gmail API error:', error);
        throw new Error('Gmail verification failed');
    }
}

export default async function handler(req, res) {
    console.log(`[API] Verify OTP request: ${req.method}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }

    try {
        const { email, otpCode, purpose } = req.body;

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

        // Normalize email and OTP
        const normalizedEmail = email.toLowerCase().trim();
        
        // IMPORTANT: Convert submitted OTP to UPPERCASE for comparison
        // This ensures case-insensitive matching
        const normalizedOTP = otpCode.toUpperCase().trim();

        // Validate OTP format (6 characters alphanumeric)
        if (!/^[A-Z0-9]{6}$/.test(normalizedOTP)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid OTP format. Must be 6 alphanumeric characters.' 
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

        // Check if OTP exists in database
        if (!user.otp_code) {
            return res.status(400).json({ 
                success: false, 
                message: 'No active OTP found. Please request a new one.' 
            });
        }

        // Check if OTP has expired
        const now = new Date();
        const expiry = new Date(user.otp_expiry);
        
        if (now > expiry) {
            // Clear expired OTP
            await sql`
                UPDATE users 
                SET otp_code = NULL, otp_expiry = NULL
                WHERE id = ${user.id}
            `;
            
            return res.status(400).json({ 
                success: false, 
                message: 'OTP has expired. Please request a new one.' 
            });
        }

        // Compare the stored OTP (already uppercase) with normalized input
        if (user.otp_code !== normalizedOTP) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid OTP code' 
            });
        }

        // Verify the email exists in Gmail inbox
        let gmailVerified = false;
        try {
            gmailVerified = await verifyGmailInbox(normalizedEmail, normalizedOTP, expiry);
        } catch (gmailError) {
            console.error('[API] Gmail verification error:', gmailError);
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to verify email. Please try again.' 
            });
        }

        if (!gmailVerified) {
            return res.status(400).json({ 
                success: false, 
                message: 'OTP email not found in inbox. Please send the email first and try again.' 
            });
        }

        // OTP verified successfully - update user record
        if (purpose === 'register') {
            // For registration, mark as verified
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL,
                    is_verified = TRUE
                WHERE id = ${user.id}
            `;
        } else {
            // For password reset, just clear OTP (keep is_verified as is)
            await sql`
                UPDATE users 
                SET 
                    otp_code = NULL,
                    otp_expiry = NULL
                WHERE id = ${user.id}
            `;
        }

        console.log(`[API] OTP verified successfully for ${normalizedEmail} (purpose: ${purpose || 'unknown'})`);

        return res.status(200).json({
            success: true,
            message: 'OTP verified successfully',
            userId: user.id,
            email: user.email,
            purpose: purpose || 'unknown'
        });

    } catch (error) {
        console.error('[API] Verify OTP error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}
