const CACHE_NAME = 'attendance-tracker-v1';
const STATIC_FILES = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './db.js',
    './manifest.json'
];

self.addEventListener('install', event => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_FILES))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(name => {
                    if (name !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Skip API calls - they need to go to network
    if (event.request.url.includes('/api/')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached response if found
                if (response) {
                    return response;
                }
                // Otherwise fetch from network
                return fetch(event.request).catch(error => {
                    console.error('[SW] Fetch failed:', error);
                    // Return offline page for navigation requests
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                    throw error;
                });
            })
    );
});

// ==================== PUSH NOTIFICATION HANDLERS ====================

self.addEventListener('push', function(event) {
    console.log('[SW] Push received:', event);
    
    let data = {};
    
    if (event.data) {
        try {
            data = event.data.json();
            console.log('[SW] Push data:', data);
        } catch (e) {
            console.error('[SW] Failed to parse push data:', e);
            data = {
                title: 'Attendance Reminder',
                body: event.data.text(),
                icon: '/icon-192.png'
            };
        }
    }
    
    const title = data.title || '⏰ Attendance Reminder';
    const options = {
        body: data.body || 'Time to check in or out!',
        icon: data.icon || '/icon-192.png',
        badge: data.badge || '/badge.png',
        data: data.data || {},
        actions: data.actions || [],
        vibrate: [200, 100, 200],
        requireInteraction: true,
        tag: data.tag || 'attendance-reminder',
        renotify: true
    };
    
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
    
    // Handle action buttons (Check In / Check Out)
    if (action === 'checkin' || action === 'checkout') {
        // Send message to client to perform the action
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then(windowClients => {
                    // Check if there's already a window/tab open
                    for (let client of windowClients) {
                        if (client.url === '/' && 'focus' in client) {
                            client.focus();
                            // Send message to client to perform action
                            client.postMessage({
                                type: action,
                                userId: notificationData.userId,
                                timestamp: new Date().toISOString()
                            });
                            return;
                        }
                    }
                    // If no window/tab is open, open one
                    if (clients.openWindow) {
                        return clients.openWindow(urlToOpen).then(client => {
                            // Send message after window loads
                            setTimeout(() => {
                                client.postMessage({
                                    type: action,
                                    userId: notificationData.userId,
                                    timestamp: new Date().toISOString()
                                });
                            }, 1000);
                        });
                    }
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
    }
});

// Background sync for offline entries
self.addEventListener('sync', function(event) {
    console.log('[SW] Background sync:', event.tag);
    
    if (event.tag === 'sync-attendance') {
        event.waitUntil(syncPendingEntries());
    }
});

async function syncPendingEntries() {
    console.log('[SW] Syncing pending entries...');
    
    // Get all clients to send sync request
    const clients = await self.clients.matchAll();
    for (const client of clients) {
        client.postMessage({
            type: 'SYNC_ATTENDANCE',
            timestamp: new Date().toISOString()
        });
    }
    
    return true;
}