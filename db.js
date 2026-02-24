// ==================== DB.JS - INDEXEDDB WITH DEBUG LOGGING ====================
if (typeof window.addDebugLog === 'function') {
    window.addDebugLog('db.js: Loading started...', 'info');
}

let db = null;
let currentUserId = null;

// Set current user
function setCurrentUserId(userId) {
    currentUserId = userId;
    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog(`db.js: User ID set to: ${userId}`, 'success');
    }
}

// Open database for user
async function openUserDatabase(userId) {
    if (!userId) {
        throw new Error('User ID required');
    }
    
    currentUserId = userId;
    const dbName = `AttendanceDB_${userId}`;
    
    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog(`db.js: Opening database: ${dbName}`, 'info');
    }
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog('db.js: Database upgrade needed', 'info');
            }
            
            if (!db.objectStoreNames.contains('entries')) {
                const store = db.createObjectStore('entries', { keyPath: 'date' });
                store.createIndex('date', 'date', { unique: true });
                store.createIndex('sync_status', 'sync_status', { unique: false });
                store.createIndex('user_id', 'user_id', { unique: false });
                
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog('db.js: Created entries store', 'success');
                }
            }
            
            if (!db.objectStoreNames.contains('balances')) {
                db.createObjectStore('balances', { keyPath: 'type' });
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog('db.js: Created balances store', 'success');
                }
            }
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog(`db.js: Database opened successfully: ${dbName}`, 'success');
                window.addDebugLog(`db.js: Available stores: ${Array.from(db.objectStoreNames).join(', ')}`, 'info');
            }
            resolve(db);
        };
        
        request.onerror = (event) => {
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog(`db.js: Error opening database: ${event.target.error}`, 'error');
            }
            reject(event.target.error);
        };
    });
}

// Save entry
async function saveEntry(entry) {
    if (!db) {
        throw new Error('Database not open');
    }
    
    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog(`db.js: Saving entry for date: ${entry.date}`, 'info');
    }
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['entries'], 'readwrite');
        const store = transaction.objectStore('entries');
        
        entry.user_id = currentUserId;
        entry.sync_status = entry.sync_status || 'pending';
        entry.updated_at = new Date().toISOString();
        
        const request = store.put(entry);
        
        request.onsuccess = () => {
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog(`db.js: Entry saved successfully: ${entry.date}`, 'success');
            }
            resolve(entry);
        };
        
        request.onerror = () => {
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog(`db.js: Error saving entry: ${request.error}`, 'error');
            }
            reject(request.error);
        };
    });
}

// Get all entries for user
async function getAllEntriesForUser(userId) {
    if (!db) {
        if (typeof window.addDebugLog === 'function') {
            window.addDebugLog('db.js: Database not open, returning empty array', 'warning');
        }
        return [];
    }
    
    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog(`db.js: Getting all entries for user: ${userId}`, 'info');
    }
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['entries'], 'readonly');
        const store = transaction.objectStore('entries');
        const request = store.getAll();
        
        request.onsuccess = () => {
            const entries = request.result || [];
            const userEntries = entries.filter(e => e.user_id === userId);
            
            // Apply 97-day window
            const now = new Date();
            const ninetyDaysAgo = new Date(now.setDate(now.getDate() - 90)).toISOString().split('T')[0];
            const sevenDaysFuture = new Date(now.setDate(now.getDate() + 97)).toISOString().split('T')[0];
            
            const windowedEntries = userEntries.filter(e => 
                e.date >= ninetyDaysAgo && e.date <= sevenDaysFuture
            );
            
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog(`db.js: Retrieved ${userEntries.length} entries for user, ${windowedEntries.length} in window`, 'success');
            }
            
            resolve(windowedEntries);
        };
        
        request.onerror = () => {
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog(`db.js: Error getting entries: ${request.error}`, 'error');
            }
            reject(request.error);
        };
    });
}

// Get entries needing sync
async function getEntriesNeedingSync() {
    if (!db) return [];
    
    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog('db.js: Getting entries needing sync', 'info');
    }
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['entries'], 'readonly');
        const store = transaction.objectStore('entries');
        const index = store.index('sync_status');
        const request = index.getAll('pending');
        
        request.onsuccess = () => {
            const entries = request.result || [];
            const userEntries = entries.filter(e => e.user_id === currentUserId);
            
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog(`db.js: Found ${userEntries.length} entries needing sync`, 'info');
            }
            
            resolve(userEntries);
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Mark entries as synced
async function markAsSynced(entryIds) {
    if (!db) return;
    
    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog(`db.js: Marking ${entryIds.length} entries as synced`, 'info');
    }
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['entries'], 'readwrite');
        const store = transaction.objectStore('entries');
        
        let completed = 0;
        
        entryIds.forEach(date => {
            const getRequest = store.get(date);
            
            getRequest.onsuccess = () => {
                const entry = getRequest.result;
                if (entry && entry.user_id === currentUserId) {
                    entry.sync_status = 'synced';
                    store.put(entry);
                }
                completed++;
                if (completed === entryIds.length) {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog('db.js: All entries marked as synced', 'success');
                    }
                    resolve();
                }
            };
        });
        
        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}

// Initialize database for user
async function initDatabaseForUser(userId) {
    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog(`db.js: Initializing database for user: ${userId}`, 'info');
    }
    
    try {
        await openUserDatabase(userId);
        
        // Check if we have any entries
        const entries = await getAllEntriesForUser(userId);
        
        if (entries.length === 0) {
            if (typeof window.addDebugLog === 'function') {
                window.addDebugLog('db.js: No entries found, creating sample data', 'info');
            }
            
            // Add sample data for demo
            const today = new Date().toISOString().split('T')[0];
            await saveEntry({
                date: today,
                user_id: userId,
                base_hours_rule: 8,
                ot_cap_rule: 1,
                sync_status: 'synced'
            });
        }
        
        if (typeof window.addDebugLog === 'function') {
            window.addDebugLog('db.js: Database initialization complete', 'success');
        }
        
        return db;
    } catch (error) {
        if (typeof window.addDebugLog === 'function') {
            window.addDebugLog(`db.js: Init error: ${error.message}`, 'error');
        }
        throw error;
    }
}

// Close database
function closeDatabase() {
    if (db) {
        db.close();
        if (typeof window.addDebugLog === 'function') {
            window.addDebugLog('db.js: Database closed', 'info');
        }
        db = null;
        currentUserId = null;
    }
}

// Export API
window.dbAPI = {
    setCurrentUserId,
    initDatabaseForUser,
    saveEntry,
    getAllEntriesForUser,
    getEntriesNeedingSync,
    markAsSynced,
    closeDatabase
};

if (typeof window.addDebugLog === 'function') {
    window.addDebugLog('db.js: Loading complete - API exposed', 'success');
    window.addDebugLog(`db.js: Available methods: ${Object.keys(window.dbAPI).join(', ')}`, 'info');
}
