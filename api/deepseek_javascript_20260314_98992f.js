import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
    console.log(`[API] Forgot password request: ${req.method}`);

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
        const { email } = req.body;

        // Validate input
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email is required' 
            });
        }

        // Normalize email
        const normalizedEmail = email.toLowerCase().trim();

        // Check if user exists
        const users = await sql`
            SELECT id, email, name, is_verified 
            FROM users 
            WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            // Return success even if user doesn't exist (security through obscurity)
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
            const otpResponse = await fetch(`${baseUrl}/api/generate-otp`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || ''
                },
                body: JSON.stringify({ 
                    email: normalizedEmail, 
                    purpose: 'reset' 
                })
            });

            if (!otpResponse.ok) {
                throw new Error('Failed to generate OTP');
            }

            const otpData = await otpResponse.json();

            console.log(`[API] Password reset OTP generated for: ${normalizedEmail}`);

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