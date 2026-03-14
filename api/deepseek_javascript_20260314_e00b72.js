import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * Generate a unique user ID
 * @returns {string} Unique user ID (max 50 chars)
 */
function generateUserId() {
    const chars = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result = '';
    const timestamp = Date.now().toString(36);
    result += timestamp;
    for (let i = 0; i < 8; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result.substring(0, 50);
}

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { email, password, name } = req.body;

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password required' 
            });
        }

        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters' 
            });
        }

        // Normalize email
        const normalizedEmail = email.toLowerCase().trim();

        // Check if user already exists
        const existing = await sql`
            SELECT id FROM users WHERE email = ${normalizedEmail}
        `;

        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'An account with this email already exists' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Generate user ID
        const userId = generateUserId();
        
        // Get display name
        const displayName = name || normalizedEmail.split('@')[0];

        // Create user (initially unverified)
        const [newUser] = await sql`
            INSERT INTO users (
                id, 
                email, 
                password_hash, 
                name, 
                created_at, 
                is_verified,
                otp_code,
                otp_expiry
            )
            VALUES (
                ${userId}, 
                ${normalizedEmail}, 
                ${hashedPassword}, 
                ${displayName}, 
                NOW(),
                FALSE,
                NULL,
                NULL
            )
            RETURNING id, email, name
        `;

        console.log(`[API] User registered: ${normalizedEmail}`);

        // Generate OTP for email verification
        let otpData = null;
        try {
            // Call internal OTP generation endpoint
            const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
            const otpResponse = await fetch(`${baseUrl}/api/generate-otp`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || ''
                },
                body: JSON.stringify({ 
                    email: normalizedEmail, 
                    purpose: 'register' 
                })
            });

            if (otpResponse.ok) {
                otpData = await otpResponse.json();
            }
        } catch (otpError) {
            console.error('[API] Failed to generate OTP:', otpError);
            // Continue without OTP - user can request verification later
        }

        // Return success with OTP data if available
        return res.status(201).json({
            success: true,
            message: 'Registration successful. Please verify your email.',
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name
            },
            requiresVerification: true,
            ...(otpData && {
                otpCode: otpData.otpCode,
                appEmail: otpData.appEmail,
                expiry: otpData.expiry
            })
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}