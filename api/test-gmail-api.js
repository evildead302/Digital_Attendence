import { google } from 'googleapis';

export default async function handler(req, res) {
    console.log('[API] Test Gmail API - Starting diagnostics');
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const results = {
        timestamp: new Date().toISOString(),
        environment: {},
        gmailApi: {},
        tests: []
    };

    // 1. Check Environment Variables
    console.log('📋 Checking environment variables...');
    results.environment = {
        GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID ? '✅ Present' : '❌ Missing',
        GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET ? '✅ Present' : '❌ Missing',
        GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN ? '✅ Present' : '❌ Missing',
        GMAIL_REDIRECT_URI: process.env.GMAIL_REDIRECT_URI || '⚠️ Using default',
        APP_GMAIL_ADDRESS: process.env.APP_GMAIL_ADDRESS || '⚠️ Not set'
    };
    
    results.tests.push({
        name: 'Environment Variables Check',
        passed: !!process.env.GMAIL_CLIENT_ID && !!process.env.GMAIL_CLIENT_SECRET && !!process.env.GMAIL_REFRESH_TOKEN
    });

    // 2. Test Gmail Authentication
    console.log('🔐 Testing Gmail authentication...');
    
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
        results.gmailApi = {
            configured: false,
            error: 'Missing required environment variables'
        };
        results.tests.push({
            name: 'Gmail API Authentication',
            passed: false,
            error: 'Missing credentials'
        });
        
        return res.status(500).json({
            success: false,
            message: 'Gmail API not configured',
            results
        });
    }

    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET,
            process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.GMAIL_REFRESH_TOKEN
        });

        // Try to refresh token
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        results.gmailApi.tokenRefreshed = true;
        results.gmailApi.hasAccessToken = !!credentials.access_token;
        results.gmailApi.expiresAt = credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : 'Unknown';
        
        results.tests.push({
            name: 'Token Refresh',
            passed: true,
            details: 'Access token obtained successfully'
        });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // 3. Test Get Profile
        console.log('👤 Testing get profile...');
        try {
            const profile = await gmail.users.getProfile({ userId: 'me' });
            results.gmailApi.profile = {
                email: profile.data.emailAddress,
                messagesTotal: profile.data.messagesTotal,
                threadsTotal: profile.data.threadsTotal
            };
            results.tests.push({
                name: 'Get Profile',
                passed: true,
                details: `Connected as: ${profile.data.emailAddress}`
            });
        } catch (profileError) {
            results.gmailApi.profileError = profileError.message;
            results.tests.push({
                name: 'Get Profile',
                passed: false,
                error: profileError.message
            });
        }

        // 4. Test Search with optional parameters
        const { email, otpCode } = req.query;
        
        if (email && otpCode) {
            console.log(`🔍 Testing search for: from:${email} subject:${otpCode}`);
            
            try {
                const searchQuery = `from:${email} subject:${otpCode}`;
                const response = await gmail.users.messages.list({
                    userId: 'me',
                    q: searchQuery,
                    maxResults: 5
                });

                const messages = response.data.messages || [];
                
                results.gmailApi.searchResults = {
                    query: searchQuery,
                    count: messages.length,
                    messagesFound: messages.length > 0
                };

                if (messages.length > 0) {
                    // Get first message details
                    const message = await gmail.users.messages.get({
                        userId: 'me',
                        id: messages[0].id,
                        format: 'metadata',
                        metadataHeaders: ['Subject', 'From', 'Date']
                    });
                    
                    const headers = message.data.payload.headers;
                    results.gmailApi.firstMessage = {
                        id: messages[0].id,
                        from: headers.find(h => h.name === 'From')?.value,
                        subject: headers.find(h => h.name === 'Subject')?.value,
                        date: headers.find(h => h.name === 'Date')?.value
                    };
                    
                    results.tests.push({
                        name: 'Email Search',
                        passed: true,
                        details: `Found ${messages.length} email(s) matching criteria`
                    });
                } else {
                    results.tests.push({
                        name: 'Email Search',
                        passed: false,
                        details: 'No emails found',
                        suggestion: `Send an email to ${process.env.APP_GMAIL_ADDRESS || 'app email'} with subject: ${otpCode}`
                    });
                }
            } catch (searchError) {
                results.gmailApi.searchError = searchError.message;
                results.tests.push({
                    name: 'Email Search',
                    passed: false,
                    error: searchError.message
                });
            }
        }

        results.gmailApi.configured = true;
        results.gmailApi.status = 'healthy';
        
        console.log('✅ Gmail API test completed');

    } catch (error) {
        console.error('❌ Gmail API test failed:', error.message);
        
        results.gmailApi = {
            configured: true,
            status: 'error',
            error: error.message
        };
        
        results.tests.push({
            name: 'Gmail API Overall',
            passed: false,
            error: error.message,
            solution: error.message.includes('invalid_grant') 
                ? 'Refresh token expired. Get a new one from Google OAuth Playground'
                : 'Check your Gmail API credentials'
        });
    }

    // 5. Summary
    const allPassed = results.tests.every(test => test.passed);
    
    return res.status(allPassed ? 200 : 500).json({
        success: allPassed,
        message: allPassed ? 'Gmail API is working correctly' : 'Gmail API has issues',
        results
    });
}
