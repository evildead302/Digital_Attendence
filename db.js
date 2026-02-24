// db.js - IndexedDB for Attendance Tracker
let db = null;
let currentUserId = null;

// Open database for specific user
async function openUserDatabase(userId) {
    if (!userId) throw new Error('User ID required');
    
    currentUserId = userId;
    const dbName = `AttendanceDB_${userId}`;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            
            if (!db.objectStoreNames.contains('entries')) {
                const store = db.createObjectStore('entries', { keyPath: 'date' });
                store.createIndex('date', 'date', { unique: true });
                store.createIndex('sync_status', 'sync_status', { unique: false });
                store.createIndex('user_id', 'user_id', { unique: false });
            }
            
            if (!db.objectStoreNames.contains('balances')) {
                db.createObjectStore('balances', { keyPath: 'type' });
            }
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

// Save entry
async function saveEntry(entry) {
    if (!db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['entries'], 'readwrite');
        const store = transaction.objectStore('entries');
        
        // Ensure entry has required fields
        entry.user_id = currentUserId;
        entry.sync_status = entry.sync_status || 'pending';
        entry.updated_at = new Date().toISOString();
        
        const request = store.put(entry);
        
        request.onsuccess = () => resolve(entry);
        request.onerror = () => reject(request.error);
    });
}

// Get all entries for user
async function getAllEntriesForUser(userId) {
    if (!db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['entries'], 'readonly');
        const store = transaction.objectStore('entries');
        const request = store.getAll();
        
        request.onsuccess = () => {
            const entries = request.result || [];
            // Filter by user_id and within 97-day window
            const userEntries = entries.filter(e => e.user_id === userId);
            
            // Apply 97-day window filter
            const now = new Date();
            const ninetyDaysAgo = new Date(now.setDate(now.getDate() - 90)).toISOString().split('T')[0];
            const sevenDaysFuture = new Date(now.setDate(now.getDate() + 97)).toISOString().split('T')[0];
            
            const windowedEntries = userEntries.filter(e => 
                e.date >= ninetyDaysAgo && e.date <= sevenDaysFuture
            );
            
            resolve(windowedEntries);
        };
        
        request.onerror = () => reject(request.error);
    });
}

// Get entries needing sync
async function getEntriesNeedingSync() {
    if (!db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['entries'], 'readonly');
        const store = transaction.objectStore('entries');
        const index = store.index('sync_status');
        const request = index.getAll('pending');
        
        request.onsuccess = () => {
            const entries = request.result || [];
            resolve(entries.filter(e => e.user_id === currentUserId));
        };
        
        request.onerror = () => reject(request.error);
    });
}

// Mark entries as synced
async function markAsSynced(entryIds) {
    if (!db) throw new Error('Database not open');
    
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
                if (completed === entryIds.length) resolve();
            };
        });
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

// Save balance
async function saveBalance(type, value) {
    if (!db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['balances'], 'readwrite');
        const store = transaction.objectStore('balances');
        
        const request = store.put({
            type: type,
            value: value,
            user_id: currentUserId,
            updated_at: new Date().toISOString()
        });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Get balance
async function getBalance(type) {
    if (!db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['balances'], 'readonly');
        const store = transaction.objectStore('balances');
        const request = store.get(type);
        
        request.onsuccess = () => {
            const balance = request.result;
            resolve(balance ? balance.value : null);
        };
        
        request.onerror = () => reject(request.error);
    });
}

// Clear old entries (keep only 97-day window)
async function cleanupOldEntries() {
    if (!db) throw new Error('Database not open');
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoffDate = ninetyDaysAgo.toISOString().split('T')[0];
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['entries'], 'readwrite');
        const store = transaction.objectStore('entries');
        const index = store.index('date');
        const range = IDBKeyRange.upperBound(cutoffDate);
        const request = index.openCursor(range);
        
        let deletedCount = 0;
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                if (cursor.value.user_id === currentUserId) {
                    cursor.delete();
                    deletedCount++;
                }
                cursor.continue();
            } else {
                resolve(deletedCount);
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}

// Initialize database for user
async function initDatabaseForUser(userId) {
    await openUserDatabase(userId);
    
    // Create default entries if needed
    const entries = await getAllEntriesForUser(userId);
    if (entries.length === 0) {
        // Add some sample data for demo
        const today = new Date().toISOString().split('T')[0];
        await saveEntry({
            date: today,
            user_id: userId,
            base_hours_rule: 8,
            ot_cap_rule: 1,
            sync_status: 'synced'
        });
    }
    
    // Clean up old entries
    await cleanupOldEntries();
    
    return db;
}

// Export API
window.dbAPI = {
    initDatabaseForUser,
    saveEntry,
    getAllEntriesForUser,
    getEntriesNeedingSync,
    markAsSynced,
    saveBalance,
    getBalance,
    cleanupOldEntries
};
