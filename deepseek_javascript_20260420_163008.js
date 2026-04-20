// service-worker.js
const CACHE_NAME = 'attendance-tracker-v2';
const STATIC_FILES = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './db.js',
    './manifest.json'
];

// Cache busting version
const CACHE_VERSION = '2024.02';

self.addEventListener('install', event => {
    console.log('[SW] Installing...', CACHE_VERSION);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static files');
                return cache.addAll(STATIC_FILES);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    console.log('[SW] Activating...', CACHE_VERSION);
    event.waitUntil(
        Promise.all([
            // Clean up old caches
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(name => {
                        if (name !== CACHE_NAME) {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        }
                    })
                );
            }),
            // Claim clients immediately
            self.clients.claim()
        ])
    );
});

self.addEventListener('fetch', event => {
    // Skip API calls - they need to go to network
    if (event.request.url.includes('/api/')) {
        // For API calls, try network first with timeout
        event.respondWith(
            fetchWithTimeout(event.request, 10000).catch(() => {
                // Return offline response for API
                return new Response(JSON.stringify({
                    success: false,
                    offline: true,
                    message: 'You are offline. Please check your connection.'
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetchWithTimeout(event.request, 10000).catch(error => {
                    console.error('[SW] Fetch failed:', error);
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                    // Return a simple offline response for other assets
                    return new Response('Offline', { status: 503 });
                });
            })
    );
});

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

// Store offline requests for later retry
const offlineQueue = [];

self.addEventListener('fetch', event => {
    // Handle POST requests for offline queue
    if (event.request.method === 'POST' && event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request).catch(async error => {
                console.log('[SW] Offline - queueing POST request:', event.request.url);
                
                // Clone the request to store it
                const requestClone = event.request.clone();
                const requestData = {
                    url: event.request.url,
                    method: event.request.method,
                    headers: Object.fromEntries(event.request.headers.entries()),
                    body: await requestClone.text(),
                    timestamp: Date.now()
                };
                
                // Store in IndexedDB or cache
                const queueCache = await caches.open('offline-queue');
                const queueId = `req_${Date.now()}_${Math.random()}`;
                await queueCache.put(queueId, new Response(JSON.stringify(requestData)));
                
                // Trigger sync when online
                if ('sync' in self.registration) {
                    await self.registration.sync.register('sync-attendance');
                }
                
                return new Response(JSON.stringify({
                    success: false,
                    offline: true,
                    queued: true,
                    message: 'Request queued for later sync'
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }
    
    // Handle static assets as before
    if (event.request.url.includes('/api/')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetchWithTimeout(event.request, 10000).catch(error => {
                    console.error('[SW] Fetch failed:', error);
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                    // Return a simple offline response for other assets
                    return new Response('Offline', { status: 503 });
                });
            })
    );
});

// Process offline queue when online
self.addEventListener('online', () => {
    console.log('[SW] Online - processing offline queue');
    processOfflineQueue();
});

async function processOfflineQueue() {
    const queueCache = await caches.open('offline-queue');
    const requests = await queueCache.keys();
    
    console.log(`[SW] Processing ${requests.length} queued requests`);
    
    for (const request of requests) {
        try {
            const response = await queueCache.match(request);
            if (response) {
                const data = await response.json();
                const fetchResponse = await fetch(data.url, {
                    method: data.method,
                    headers: data.headers,
                    body: data.body
                });
                
                if (fetchResponse.ok) {
                    await queueCache.delete(request);
                    console.log('[SW] Successfully processed queued request:', data.url);
                }
            }
        } catch (error) {
            console.error('[SW] Failed to process queued request:', error);
        }
    }
}

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