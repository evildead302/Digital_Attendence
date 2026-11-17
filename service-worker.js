// service-worker.js
// ---------------------------------------------------------------------------
// UPDATE POLICY (why the app now updates by itself)
//  * Pages, scripts and styles are NETWORK-FIRST: whenever the phone is online it
//    gets the newest files from your server and refreshes its saved copy.
//    The saved copy is only used when you are offline (or the network is very slow).
//  * So a normal deploy needs NO change in this file. Bump VERSION only if you
//    want to clear every old saved file on all phones.
//  * When this file itself changes, the new worker takes over immediately and
//    reloads the open app once, so no phone stays on an old version.
// ---------------------------------------------------------------------------
const VERSION = '2026-11-17-1';
const CACHE_PREFIX = 'attendance-tracker-';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const CACHE_VERSION = VERSION;   // kept for the log line at the bottom
const NETWORK_TIMEOUT = 6000;    // ms to wait for the network before using the saved copy
const API_TIMEOUT = 10000;

const STATIC_FILES = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './db.js',
    './manifest.json'
];

// Caches that must survive updates (used by the code further down)
const KEEP_CACHES = ['auth-data', 'offline-queue'];

self.addEventListener('install', event => {
    console.log('[SW] Installing...', VERSION);
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            // Fetch fresh copies (bypass the browser HTTP cache). One missing file must not fail the install.
            Promise.all(STATIC_FILES.map(url =>
                fetch(new Request(url, { cache: 'reload' }))
                    .then(res => (res && res.ok ? cache.put(url, res) : null))
                    .catch(err => console.warn('[SW] Could not pre-cache', url, err && err.message))
            ))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    console.log('[SW] Activating...', VERSION);
    event.waitUntil((async () => {
        // Delete ONLY old app-file caches. (The old code deleted every other cache, including the
        // saved login for background reminders.)
        const names = await caches.keys();
        const old = names.filter(n => n.startsWith('attendance-tracker') && n !== CACHE_NAME && !KEEP_CACHES.includes(n));
        await Promise.all(old.map(n => { console.log('[SW] Deleting old cache:', n); return caches.delete(n); }));

        await self.clients.claim();

        // This is an UPDATE (an older version existed): reload the open app so it runs the new files now.
        if (old.length > 0) {
            const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const client of windows) {
                try {
                    client.postMessage({ type: 'SW_UPDATED', version: VERSION });
                    // Do NOT await: the reload is answered by this worker, which can only answer after
                    // activation has finished - waiting here would deadlock.
                    client.navigate(client.url).catch(e => console.warn('[SW] Could not reload client:', e && e.message));
                } catch (e) {
                    console.warn('[SW] Could not reload client:', e && e.message);
                }
            }
        }
    })());
});

// One fetch handler for everything (the old file had two; the second one never ran)
self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);

    // API calls: always the network, with a friendly offline answer
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetchWithTimeout(req, API_TIMEOUT).catch(() => new Response(JSON.stringify({
                success: false,
                offline: true,
                message: 'You are offline. Please check your connection.'
            }), { headers: { 'Content-Type': 'application/json' } }))
        );
        return;
    }

    // Only handle normal page/file requests from this site
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;

    event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
    const cache = await caches.open(CACHE_NAME);
    const isPage = req.mode === 'navigate';

    // Start the network request now; it also refreshes the saved copy when it finishes
    const network = (async () => {
        const res = await fetch(isPage ? req : new Request(req, { cache: 'no-cache' }));
        if (res && res.ok && res.type === 'basic' && !res.redirected) {
            cache.put(req, res.clone()).catch(() => {});
        }
        return res;
    })();

    try {
        // Online: use the fresh file (give the network a few seconds)
        return await Promise.race([
            network,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT))
        ]);
    } catch (err) {
        network.catch(() => {});   // the late response (if any) still refreshes the saved copy
        // Offline / too slow: use the saved copy
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (isPage) {
            const page = (await cache.match('./index.html')) || (await cache.match('./'));
            if (page) return page;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

// Helper: Fetch with timeout
function fetchWithTimeout(request, timeout) {
    return Promise.race([
        fetch(request),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), timeout);
        })
    ]);
}

// ==================== PUSH NOTIFICATION HANDLERS ====================

self.addEventListener('push', function(event) {
    console.log('[SW] Push received:', event);
    
    let data = {};
    
    if (event.data) {
        try {
            data = event.data.json();
            console.log('[SW] Push data parsed:', data);
        } catch (e) {
            console.error('[SW] Failed to parse push data:', e);
            // Try to get text if JSON parsing fails
            try {
                const text = event.data.text();
                data = {
                    title: 'Attendance Reminder',
                    body: text,
                    icon: '/icon-192.png'
                };
            } catch (e2) {
                data = {
                    title: '⏰ Attendance Reminder',
                    body: 'Time to check in or out!',
                    icon: '/icon-192.png'
                };
            }
        }
    }
    
    const title = data.title || '⏰ Attendance Reminder';
    const options = {
        body: data.body || 'Time to check in or out!',
        icon: data.icon || '/icon-192.png',
        badge: data.badge || '/badge.png',
        data: data.data || {},
        actions: data.actions || [
            {
                action: 'open',
                title: 'Open App'
            }
        ],
        vibrate: [200, 100, 200],
        requireInteraction: true,
        tag: data.tag || 'attendance-reminder',
        renotify: true,
        silent: false
    };
    
    // Add specific action buttons based on notification type
    if (data.type === 'checkin') {
        options.actions = [
            { action: 'checkin', title: '✅ Check In Now' },
            { action: 'open', title: 'Open App' }
        ];
        options.data.type = 'checkin';
    } else if (data.type === 'checkout') {
        options.actions = [
            { action: 'checkout', title: '✅ Check Out Now' },
            { action: 'snooze', title: '⏰ Snooze 15 min' },
            { action: 'open', title: 'Open App' }
        ];
        options.data.type = 'checkout';
    }
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Handle notification click
self.addEventListener('notificationclick', function(event) {
    console.log('[SW] Notification click:', event);
    
    event.notification.close();
    
    const action = event.action;
    const notificationData = event.notification.data;
    const urlToOpen = notificationData.url || '/';
    const notificationType = notificationData.type || 'unknown';
    
    // Handle action buttons
    if (action === 'checkin') {
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then(windowClients => {
                    for (let client of windowClients) {
                        if (client.url === '/' && 'focus' in client) {
                            client.focus();
                            client.postMessage({
                                type: 'checkin',
                                userId: notificationData.userId,
                                timestamp: new Date().toISOString(),
                                source: 'notification'
                            });
                            console.log('[SW] Sent checkin message to existing client');
                            return;
                        }
                    }
                    if (clients.openWindow) {
                        return clients.openWindow(urlToOpen).then(client => {
                            setTimeout(() => {
                                if (client) {
                                    client.postMessage({
                                        type: 'checkin',
                                        userId: notificationData.userId,
                                        timestamp: new Date().toISOString(),
                                        source: 'notification'
                                    });
                                    console.log('[SW] Sent checkin message to new client');
                                }
                            }, 2000);
                        });
                    }
                })
        );
    } else if (action === 'checkout') {
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then(windowClients => {
                    for (let client of windowClients) {
                        if (client.url === '/' && 'focus' in client) {
                            client.focus();
                            client.postMessage({
                                type: 'checkout',
                                userId: notificationData.userId,
                                timestamp: new Date().toISOString(),
                                source: 'notification'
                            });
                            console.log('[SW] Sent checkout message to existing client');
                            return;
                        }
                    }
                    if (clients.openWindow) {
                        return clients.openWindow(urlToOpen).then(client => {
                            setTimeout(() => {
                                if (client) {
                                    client.postMessage({
                                        type: 'checkout',
                                        userId: notificationData.userId,
                                        timestamp: new Date().toISOString(),
                                        source: 'notification'
                                    });
                                    console.log('[SW] Sent checkout message to new client');
                                }
                            }, 2000);
                        });
                    }
                })
        );
    } else if (action === 'snooze') {
        // Snooze for 15 minutes - register a background sync
        console.log('[SW] Snoozing notification');
        event.waitUntil(
            self.registration.sync.register('snooze-check').catch(err => {
                console.log('[SW] Sync not supported, using timeout');
                // Fallback: set a timeout to check again in 15 minutes
                setTimeout(() => {
                    self.registration.showNotification('Reminder', {
                        body: 'Time to check out!',
                        icon: '/icon-192.png',
                        tag: 'snooze-reminder',
                        requireInteraction: true
                    });
                }, 15 * 60 * 1000);
            })
        );
    } else {
        // Just open the app
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then(windowClients => {
                    for (let client of windowClients) {
                        if (client.url === '/' && 'focus' in client) {
                            return client.focus();
                        }
                    }
                    if (clients.openWindow) {
                        return clients.openWindow(urlToOpen);
                    }
                })
        );
    }
});

// Handle messages from client
self.addEventListener('message', function(event) {
    console.log('[SW] Message received:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (event.data && event.data.type === 'REGISTER_SYNC') {
        // Register background sync for offline data
        event.waitUntil(registerBackgroundSync());
    } else if (event.data && event.data.type === 'CHECK_NOTIFICATIONS') {
        // Manual check from client
        event.waitUntil(checkNotificationsInBackground());
    } else if (event.data && event.data.type === 'PONG') {
        // Heartbeat response
        console.log('[SW] Heartbeat received');
    }
});

// ==================== BACKGROUND SYNC ====================

// Register background sync for offline entries
self.addEventListener('sync', function(event) {
    console.log('[SW] Background sync:', event.tag);
    
    if (event.tag === 'sync-attendance') {
        event.waitUntil(syncPendingEntries());
    } else if (event.tag === 'check-notifications') {
        event.waitUntil(checkNotificationsInBackground());
    } else if (event.tag === 'snooze-check') {
        event.waitUntil(checkNotificationsInBackground());
    }
});

// Periodic sync for regular notification checks (if supported)
self.addEventListener('periodicsync', function(event) {
    console.log('[SW] Periodic sync:', event.tag);
    
    if (event.tag === 'check-notifications') {
        event.waitUntil(checkNotificationsInBackground());
    }
});

async function registerBackgroundSync() {
    console.log('[SW] Registering background sync...');
    
    if ('sync' in self.registration) {
        try {
            await self.registration.sync.register('sync-attendance');
            console.log('[SW] Background sync registered for attendance');
        } catch (error) {
            console.error('[SW] Failed to register sync:', error);
        }
    }
    
    // Register periodic sync if supported
    if ('periodicSync' in self.registration) {
        try {
            const status = await navigator.permissions.query({
                name: 'periodic-background-sync'
            });
            
            if (status.state === 'granted') {
                await self.registration.periodicSync.register('check-notifications', {
                    minInterval: 15 * 60 * 1000  // 15 minutes
                });
                console.log('[SW] Periodic sync registered for notifications');
            }
        } catch (error) {
            console.log('[SW] Periodic sync not supported:', error);
        }
    }
}

async function syncPendingEntries() {
    console.log('[SW] Syncing pending entries...');
    
    // Get all clients to send sync request
    const clients = await self.clients.matchAll();
    let syncTriggered = false;
    
    for (const client of clients) {
        client.postMessage({
            type: 'SYNC_ATTENDANCE',
            timestamp: new Date().toISOString()
        });
        syncTriggered = true;
    }
    
    if (!syncTriggered) {
        // No clients open, try to sync in background
        console.log('[SW] No clients open, background sync may be limited');
    }
    
    return true;
}

async function checkNotificationsInBackground() {
    console.log('[SW] Checking notifications in background...');
    
    // Try to get auth token from cache
    const authCache = await caches.open('auth-data');
    const authResponse = await authCache.match('/auth-token');
    let authToken = null;
    let userId = null;
    
    if (authResponse) {
        try {
            const authData = await authResponse.json();
            authToken = authData.token;
            userId = authData.userId;
        } catch (e) {
            console.error('[SW] Failed to parse auth data:', e);
        }
    }
    
    if (authToken && userId) {
        try {
            // Try to check notifications via API
            const response = await fetch('/api/notifications?action=client-check', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tz_offset: new Date().getTimezoneOffset()
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('[SW] Background notification check result:', data);
            }
        } catch (error) {
            console.error('[SW] Background notification check failed:', error);
        }
    }
    
    // Also check for pending entries to sync
    await syncPendingEntries();
}

// ==================== OFFLINE SUPPORT ====================

// Store auth token for background use
self.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'STORE_AUTH') {
        const cache = await caches.open('auth-data');
        const response = new Response(JSON.stringify({
            token: event.data.token,
            userId: event.data.userId,
            timestamp: Date.now()
        }));
        await cache.put('/auth-token', response);
        console.log('[SW] Auth token stored for background use');
    } else if (event.data && event.data.type === 'CLEAR_AUTH') {
        const cache = await caches.open('auth-data');
        await cache.delete('/auth-token');
        console.log('[SW] Auth token cleared');
    }
});


// ==================== HEARTBEAT / KEEP ALIVE ====================

// Send heartbeat to keep service worker alive
setInterval(() => {
    self.clients.matchAll().then(clients => {
        for (const client of clients) {
            client.postMessage({ type: 'HEARTBEAT', timestamp: Date.now() });
        }
    });
}, 30000); // Every 30 seconds

// Log service worker lifecycle
console.log('[SW] Service Worker loaded with cache version:', CACHE_VERSION);
