import { google } from 'googleapis';

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        console.log('[TEST] Testing Gmail API configuration...');
        
        // Check if environment variables exist
        const hasClientId = !!process.env.GMAIL_CLIENT_ID;
        const hasClientSecret = !!process.env.GMAIL_CLIENT_SECRET;
        const hasRefreshToken = !!process.env.GMAIL_REFRESH_TOKEN;
        const hasRedirectUri = !!process.env.GMAIL_REDIRECT_URI;
        
        console.log('[TEST] Environment variables:');
        console.log(`  GMAIL_CLIENT_ID: ${hasClientId ? '✓ Present' : '✗ Missing'}`);
        console.log(`  GMAIL_CLIENT_SECRET: ${hasClientSecret ? '✓ Present' : '✗ Missing'}`);
        console.log(`  GMAIL_REFRESH_TOKEN: ${hasRefreshToken ? '✓ Present' : '✗ Missing'}`);
        console.log(`  GMAIL_REDIRECT_URI: ${hasRedirectUri ? '✓ Present' : '✗ Missing'}`);
        
        if (!hasClientId || !hasClientSecret || !hasRefreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Missing Gmail API credentials',
                missing: {
                    clientId: !hasClientId,
                    clientSecret: !hasClientSecret,
                    refreshToken: !hasRefreshToken
                }
            });
        }
        
        // Initialize Gmail API
        console.log('[TEST] Initializing OAuth2 client...');
        const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET,
            process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
        );
        
        oauth2Client.setCredentials({
            refresh_token: process.env.GMAIL_REFRESH_TOKEN
        });
        
        console.log('[TEST] Creating Gmail client...');
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        // Test by getting profile info
        console.log('[TEST] Testing Gmail API connection...');
        const profile = await gmail.users.getProfile({
            userId: 'me'
        });
        
        console.log('[TEST] Gmail API connection successful!');
        console.log(`[TEST] Email address: ${profile.data.emailAddress}`);
        console.log(`[TEST] Messages total: ${profile.data.messagesTotal}`);
        console.log(`[TEST] Threads total: ${profile.data.threadsTotal}`);
        
        return res.status(200).json({
            success: true,
            message: 'Gmail API is working correctly',
            profile: {
                email: profile.data.emailAddress,
                messagesTotal: profile.data.messagesTotal,
                threadsTotal: profile.data.threadsTotal
            }
        });
        
    } catch (error) {
        console.error('[TEST] Gmail API test failed:', error.message);
        
        if (error.response) {
            console.error('[TEST] Error response data:', error.response.data);
            console.error('[TEST] Error response status:', error.response.status);
        }
        
        return res.status(500).json({
            success: false,
            message: 'Gmail API test failed',
            error: error.message,
            details: error.response?.data || null
        });
    }
}
