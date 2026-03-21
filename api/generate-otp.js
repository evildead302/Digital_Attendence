import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

/**
 * Generate a 6-character alphanumeric OTP
 * Uses only unambiguous characters (no I, O, 0, 1)
 * @returns {string} 6-character uppercase OTP
 */
function generateOTP() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed I, O, 0, 1 for clarity
    let otp = '';
    for (let i = 0; i < 6; i++) {
        otp += chars[Math.floor(Math.random() * chars.length)];
    }
    return otp; // Always uppercase by design
}

export default async function handler(req, res) {
    console.log(`[API] Generate OTP request: ${req.method}`);

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
        const { email, purpose } = req.body;

        // Validate required fields
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email is required' 
            });
        }

        // Validate purpose
        if (purpose && !['register', 'reset'].includes(purpose)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid purpose. Must be "register" or "reset"' 
            });
        }

        // Normalize email to lowercase for consistent storage
        const normalizedEmail = email.toLowerCase().trim();

        console.log(`[API] Generating OTP for ${normalizedEmail}, purpose: ${purpose || 'unknown'}`);

        // Check if user exists
        const users = await sql`
            SELECT id, is_verified 
            FROM users 
            WHERE email = ${normalizedEmail}
        `;
        
        const userExists = users && users.length > 0;

        // For password reset, verify user exists
        if (purpose === 'reset' && !userExists) {
            return res.status(404).json({ 
                success: false, 
                message: 'No account found with this email address' 
            });
        }

        // Generate OTP (always uppercase)
        const otpCode = generateOTP();
        
        // Set expiry to 7 minutes from now
        const expiry = new Date();
        expiry.setMinutes(expiry.getMinutes() + 7);

        console.log(`[API] Generated OTP: ${otpCode} for ${normalizedEmail}, expires: ${expiry.toISOString()}`);

        // Store OTP in database
        if (userExists) {
            // Update existing user
            const updateResult = await sql`
                UPDATE users 
                SET 
                    otp_code = ${otpCode},
                    otp_expiry = ${expiry},
                    is_verified = ${purpose === 'register' ? false : sql`is_verified`}
                WHERE email = ${normalizedEmail}
                RETURNING id
            `;
            
            console.log(`[API] OTP stored for existing user ${normalizedEmail}, updated: ${updateResult.length > 0}`);
        } else {
            // For registration, user doesn't exist yet - that's OK
            // We'll just return the OTP and the frontend will handle it
            console.log(`[API] OTP generated for new user ${normalizedEmail} (will be stored when user is created)`);
        }

        // Return OTP and app email to frontend
        return res.status(200).json({
            success: true,
            message: 'OTP generated successfully',
            otpCode: otpCode,
            expiry: expiry.toISOString(),
            appEmail: process.env.APP_GMAIL_ADDRESS || 'attendance.diary.app@gmail.com',
            purpose: purpose || 'unknown'
        });

    } catch (error) {
        console.error('[API] Generate OTP error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}
