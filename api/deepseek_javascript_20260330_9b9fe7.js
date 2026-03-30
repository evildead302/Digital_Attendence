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
    console.log(`[API] Auth request: ${req.method}`);

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

    const { action } = req.query;

    if (action === 'register') {
        return handleRegister(req, res);
    } else if (action === 'login') {
        return handleLogin(req, res);
    } else {
        return res.status(400).json({ success: false, message: 'Invalid action. Use ?action=register or ?action=login' });
    }
}

// ==================== REGISTER HANDLER ====================
async function handleRegister(req, res) {
    try {
        const { email, password, name } = req.body;

        console.log(`[API] Register attempt for: ${email}`);

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

        // Check if user already exists and is verified
        const existing = await sql`
            SELECT id, email, is_verified FROM users WHERE email = ${normalizedEmail}
        `;

        if (existing.length > 0) {
            const user = existing[0];
            
            // If user exists and is verified, reject
            if (user.is_verified) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'An account with this email already exists' 
                });
            }
            
            // User exists but is not verified - we can reuse this record
            console.log(`[API] Unverified user exists: ${normalizedEmail}, will update with new OTP`);
        }

        // Generate OTP first (before creating/updating account)
        let otpData = null;
        try {
            const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
            
            console.log(`[API] Generating OTP for ${normalizedEmail}`);
            
            const otpResponse = await fetch(`${baseUrl}/api/generate-otp`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    email: normalizedEmail, 
                    purpose: 'register' 
                })
            });

            console.log(`[API] generate-otp response status: ${otpResponse.status}`);
            
            if (otpResponse.ok) {
                otpData = await otpResponse.json();
                console.log(`[API] OTP generated successfully`);
            } else {
                const errorText = await otpResponse.text();
                console.error(`[API] generate-otp failed: ${otpResponse.status} - ${errorText}`);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to generate verification code. Please try again.'
                });
            }
        } catch (otpError) {
            console.error('[API] Failed to generate OTP:', otpError.message);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate verification code. Please try again.'
            });
        }

        if (!otpData || !otpData.otpCode) {
            return res.status(500).json({
                success: false,
                message: 'Failed to generate verification code'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Generate user ID
        const userId = generateUserId();
        
        // Get display name
        const displayName = name || normalizedEmail.split('@')[0];

        // Check if unverified user exists
        const existingUser = existing.find(u => u.email === normalizedEmail && !u.is_verified);
        
        let newUser;
        
        if (existingUser) {
            // Update existing unverified user with new password and OTP
            const [updatedUser] = await sql`
                UPDATE users 
                SET 
                    password_hash = ${hashedPassword},
                    name = ${displayName},
                    otp_code = ${otpData.otpCode},
                    otp_expiry = ${new Date(otpData.expiry)},
                    updated_at = NOW()
                WHERE id = ${existingUser.id}
                RETURNING id, email, name
            `;
            newUser = updatedUser;
            console.log(`[API] Updated unverified user: ${normalizedEmail} with ID: ${newUser.id}`);
        } else {
            // Create new user with OTP but NOT verified yet
            const [createdUser] = await sql`
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
                    ${otpData.otpCode},
                    ${new Date(otpData.expiry)}
                )
                RETURNING id, email, name
            `;
            newUser = createdUser;
            console.log(`[API] Created user (unverified): ${normalizedEmail} with ID: ${newUser.id}`);
        }

        // Return OTP data to frontend - user must verify before they can login
        return res.status(201).json({
            success: true,
            message: 'Registration successful. Please verify your email to login.',
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name
            },
            requiresVerification: true,
            otpCode: otpData.otpCode,
            appEmail: otpData.appEmail,
            expiry: otpData.expiry
        });

    } catch (error) {
        console.error('[API] Registration error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}

// ==================== LOGIN HANDLER ====================
async function handleLogin(req, res) {
    try {
        const { email, password } = req.body;

        console.log(`[API] Login attempt for: ${email}`);

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password required' 
            });
        }

        // Normalize email
        const normalizedEmail = email.toLowerCase().trim();

        // Get user from database
        const users = await sql`
            SELECT id, email, name, password_hash, is_verified 
            FROM users 
            WHERE email = ${normalizedEmail}
        `;

        if (!users || users.length === 0) {
            console.log(`[API] Login failed: User not found - ${normalizedEmail}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Account not found. Please register first.' 
            });
        }

        const user = users[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            console.log(`[API] Login failed: Invalid password for ${normalizedEmail}`);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid password. Please try again.' 
            });
        }

        // Check if email is verified
        if (!user.is_verified) {
            console.log(`[API] Login failed: Email not verified - ${normalizedEmail}`);
            
            // Generate a new OTP for verification
            let otpData = null;
            try {
                const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
                const otpResponse = await fetch(`${baseUrl}/api/generate-otp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        email: normalizedEmail, 
                        purpose: 'register' 
                    })
                });

                if (otpResponse.ok) {
                    otpData = await otpResponse.json();
                    console.log(`[API] New OTP generated for unverified user during login: ${normalizedEmail}`);
                } else {
                    const errorText = await otpResponse.text();
                    console.error(`[API] generate-otp failed during login: ${otpResponse.status} - ${errorText}`);
                }
            } catch (otpError) {
                console.error('[API] Failed to generate OTP during login:', otpError);
            }
            
            return res.status(403).json({ 
                success: false, 
                message: 'Your email is not verified. Please verify your email to login.',
                requiresVerification: true,
                email: user.email,
                otpCode: otpData?.otpCode || null,
                appEmail: otpData?.appEmail || null,
                expiry: otpData?.expiry || null
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email }, 
            JWT_SECRET, 
            { expiresIn: '7d' }
        );

        console.log(`[API] Login successful for: ${normalizedEmail}`);

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token: token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            }
        });

    } catch (error) {
        console.error('[API] Login error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error. Please try again.' 
        });
    }
}