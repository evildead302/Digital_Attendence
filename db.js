// ==================== DB.JS - INDEXEDDB WITH OPTIMIZATIONS ====================
(function() {
    if (typeof window.addDebugLog !== 'function') {
        window.addDebugLog = function(msg, type) {
            console.log(`[${type}] ${msg}`);
        };
    }
    
    window.addDebugLog('db.js: Loading started...', 'info');

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
            const request = indexedDB.open(dbName, 4); // Version 4 for expiry fields
            
            request.onupgradeneeded = (event) => {
                db = event.target.result;
                
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog('db.js: Database upgrade needed', 'info');
                    window.addDebugLog(`db.js: Old version: ${event.oldVersion}, New version: ${event.newVersion}`, 'info');
                }
                
                // Handle upgrades from older versions
                if (event.oldVersion < 4) {
                    // Delete old stores if they exist for clean upgrade
                    if (db.objectStoreNames.contains('entries')) {
                        db.deleteObjectStore('entries');
                    }
                    if (db.objectStoreNames.contains('balances')) {
                        db.deleteObjectStore('balances');
                    }
                    if (db.objectStoreNames.contains('syncMeta')) {
                        db.deleteObjectStore('syncMeta');
                    }
                }
                
                // Create entries store with all fields including expiry
                if (!db.objectStoreNames.contains('entries')) {
                    const store = db.createObjectStore('entries', { keyPath: 'date' });
                    
                    // Create indexes for faster queries
                    store.createIndex('date', 'date', { unique: true });
                    store.createIndex('sync_status', 'sync_status', { unique: false });
                    store.createIndex('user_id', 'user_id', { unique: false });
                    store.createIndex('updated_at', 'updated_at', { unique: false });
                    store.createIndex('is_holiday', 'is_holiday', { unique: false });
                    store.createIndex('is_off_day', 'is_off_day', { unique: false });
                    store.createIndex('al_expiry_date', 'al_expiry_date', { unique: false });
                    store.createIndex('cpl_expiry_date', 'cpl_expiry_date', { unique: false });
                    
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog('db.js: Created entries store with all indexes', 'success');
                    }
                }
                
                // Create balances store
                if (!db.objectStoreNames.contains('balances')) {
                    db.createObjectStore('balances', { keyPath: 'type' });
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog('db.js: Created balances store', 'success');
                    }
                }
                
                // Create sync metadata store
                if (!db.objectStoreNames.contains('syncMeta')) {
                    db.createObjectStore('syncMeta', { keyPath: 'key' });
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog('db.js: Created syncMeta store', 'success');
                    }
                }
            };
            
            request.onsuccess = (event) => {
                db = event.target.result;
                
                // Add proper error handlers
                db.onerror = (event) => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Database error: ${event.target.error}`, 'error');
                    }
                };
                
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
            
            request.onblocked = () => {
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog('db.js: Database blocked - close other tabs', 'warning');
                }
            };
        });
    }

    // Save entry with optimized write
    async function saveEntry(entry) {
        if (!db) {
            throw new Error('Database not open');
        }
        
        if (typeof window.addDebugLog === 'function') {
            window.addDebugLog(`db.js: Saving entry for date: ${entry.date}`, 'info');
        }
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['entries'], 'readwrite');
                const store = transaction.objectStore('entries');
                
                // Ensure entry has all required fields including expiry
                const completeEntry = {
                    // Core fields
                    date: entry.date,
                    user_id: currentUserId,
                    
                    // Time tracking
                    check_in: entry.check_in || null,
                    check_out: entry.check_out || null,
                    
                    // Rule fields
                    base_hours_rule: entry.base_hours_rule !== undefined ? entry.base_hours_rule : 8,
                    ot_cap_rule: entry.ot_cap_rule !== undefined ? entry.ot_cap_rule : 1,
                    cpl_grant_rule: entry.cpl_grant_rule !== undefined ? entry.cpl_grant_rule : 0,
                    
                    // Calculated fields
                    final_ot_hours: entry.final_ot_hours !== undefined ? entry.final_ot_hours : 0,
                    cpl_earned: entry.cpl_earned !== undefined ? entry.cpl_earned : 0,
                    
                    // Leave usage
                    al_used: entry.al_used || 0,
                    sl_used: entry.sl_used || 0,
                    cl_used: entry.cl_used || 0,
                    cpl_used: entry.cpl_used || 0,
                    
                    // Day type flags
                    is_off_day: entry.is_off_day || false,
                    is_holiday: entry.is_holiday || false,
                    
                    // Accrual and expiry fields
                    al_accrued: entry.al_accrued || 0,
                    al_expiry_date: entry.al_expiry_date || null,
                    cpl_expiry_date: entry.cpl_expiry_date || null,
                    
                    // Notes
                    adjustment_note: entry.adjustment_note || '',
                    
                    // Sync and metadata
                    sync_status: entry.sync_status || 'pending',
                    created_at: entry.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                
                // Clean undefined values
                Object.keys(completeEntry).forEach(key => {
                    if (completeEntry[key] === undefined) {
                        delete completeEntry[key];
                    }
                });
                
                const request = store.put(completeEntry);
                
                request.onsuccess = () => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Entry saved successfully: ${entry.date}`, 'success');
                    }
                    resolve(completeEntry);
                };
                
                request.onerror = () => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Error saving entry: ${request.error}`, 'error');
                    }
                    reject(request.error);
                };
                
                transaction.oncomplete = () => {
                    // Transaction completed successfully
                };
                
                transaction.onerror = (event) => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Transaction error: ${event.target.error}`, 'error');
                    }
                    reject(event.target.error);
                };
                
            } catch (error) {
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog(`db.js: Exception in saveEntry: ${error.message}`, 'error');
                }
                reject(error);
            }
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
            try {
                const transaction = db.transaction(['entries'], 'readonly');
                const store = transaction.objectStore('entries');
                const request = store.getAll();
                
                request.onsuccess = () => {
                    const entries = request.result || [];
                    
                    // Filter by user_id
                    const userEntries = entries.filter(e => e.user_id === userId);
                    
                    // Sort by date
                    userEntries.sort((a, b) => a.date.localeCompare(b.date));
                    
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Retrieved ${userEntries.length} entries for user`, 'success');
                    }
                    
                    resolve(userEntries);
                };
                
                request.onerror = () => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Error getting entries: ${request.error}`, 'error');
                    }
                    reject(request.error);
                };
                
            } catch (error) {
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog(`db.js: Exception in getAllEntriesForUser: ${error.message}`, 'error');
                }
                reject(error);
            }
        });
    }

    // Get entries needing sync
    async function getEntriesNeedingSync(limit = 50) {
        if (!db) return [];
        
        if (typeof window.addDebugLog === 'function') {
            window.addDebugLog('db.js: Getting entries needing sync', 'info');
        }
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['entries'], 'readonly');
                const store = transaction.objectStore('entries');
                
                // Use index for faster query if available
                if (store.indexNames.contains('sync_status')) {
                    const index = store.index('sync_status');
                    const request = index.getAll('pending');
                    
                    request.onsuccess = () => {
                        const entries = request.result || [];
                        const userEntries = entries.filter(e => e.user_id === currentUserId);
                        
                        // Sort by date (oldest first)
                        userEntries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                        
                        // Limit to prevent timeout
                        const limited = userEntries.slice(0, limit);
                        
                        if (typeof window.addDebugLog === 'function') {
                            window.addDebugLog(`db.js: Found ${userEntries.length} pending entries, returning ${limited.length}`, 'info');
                        }
                        
                        resolve(limited);
                    };
                    
                    request.onerror = () => {
                        fallbackGetEntries(resolve, reject, limit);
                    };
                } else {
                    fallbackGetEntries(resolve, reject, limit);
                }
                
            } catch (error) {
                fallbackGetEntries(resolve, reject, limit);
            }
        });
    }

    // Fallback method for getEntriesNeedingSync
    function fallbackGetEntries(resolve, reject, limit) {
        try {
            const transaction = db.transaction(['entries'], 'readonly');
            const store = transaction.objectStore('entries');
            const request = store.getAll();
            
            request.onsuccess = () => {
                const entries = request.result || [];
                const pending = entries.filter(e => 
                    e.user_id === currentUserId && 
                    e.sync_status === 'pending'
                );
                
                pending.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                const limited = pending.slice(0, limit);
                
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog(`db.js: Fallback found ${pending.length} pending entries`, 'info');
                }
                
                resolve(limited);
            };
            
            request.onerror = () => {
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog('db.js: Fallback query failed', 'error');
                }
                reject(request.error);
            };
        } catch (error) {
            reject(error);
        }
    }

    // Mark entries as synced
    async function markAsSynced(entryIds) {
        if (!db) return { success: true, errors: [] };
        
        if (typeof window.addDebugLog === 'function') {
            window.addDebugLog(`db.js: Marking ${entryIds.length} entries as synced`, 'info');
        }
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['entries'], 'readwrite');
                const store = transaction.objectStore('entries');
                
                let completed = 0;
                const errors = [];
                
                // Process in batches
                const processBatch = (startIndex) => {
                    const batchSize = 20;
                    const endIndex = Math.min(startIndex + batchSize, entryIds.length);
                    
                    for (let i = startIndex; i < endIndex; i++) {
                        const date = entryIds[i];
                        
                        const getRequest = store.get(date);
                        
                        getRequest.onsuccess = (function(date) {
                            return function() {
                                const entry = getRequest.result;
                                if (entry && entry.user_id === currentUserId) {
                                    entry.sync_status = 'synced';
                                    entry.updated_at = new Date().toISOString();
                                    
                                    const updateRequest = store.put(entry);
                                    updateRequest.onsuccess = () => {
                                        completed++;
                                        if (completed === entryIds.length) {
                                            if (typeof window.addDebugLog === 'function') {
                                                window.addDebugLog(`db.js: All entries marked as synced`, 'success');
                                            }
                                            resolve({ success: true, errors });
                                        }
                                    };
                                    updateRequest.onerror = () => {
                                        errors.push({ date, error: updateRequest.error });
                                        completed++;
                                        if (completed === entryIds.length) {
                                            resolve({ success: true, errors });
                                        }
                                    };
                                } else {
                                    completed++;
                                    if (completed === entryIds.length) {
                                        resolve({ success: true, errors });
                                    }
                                }
                            };
                        })(date);
                        
                        getRequest.onerror = (function(date) {
                            return function() {
                                errors.push({ date, error: getRequest.error });
                                completed++;
                                if (completed === entryIds.length) {
                                    resolve({ success: true, errors });
                                }
                            };
                        })(date);
                    }
                    
                    // Process next batch
                    if (endIndex < entryIds.length) {
                        setTimeout(() => processBatch(endIndex), 0);
                    }
                };
                
                processBatch(0);
                
                transaction.onerror = (event) => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Transaction error: ${event.target.error}`, 'error');
                    }
                    reject(event.target.error);
                };
                
            } catch (error) {
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog(`db.js: Error in markAsSynced: ${error.message}`, 'error');
                }
                reject(error);
            }
        });
    }

    // Get entry by date
    async function getEntryByDate(date) {
        if (!db) return null;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['entries'], 'readonly');
                const store = transaction.objectStore('entries');
                const request = store.get(date);
                
                request.onsuccess = () => {
                    const entry = request.result;
                    if (entry && entry.user_id === currentUserId) {
                        resolve(entry);
                    } else {
                        resolve(null);
                    }
                };
                
                request.onerror = () => {
                    reject(request.error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    // Delete entry
    async function deleteEntry(date) {
        if (!db) return;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['entries'], 'readwrite');
                const store = transaction.objectStore('entries');
                const request = store.delete(date);
                
                request.onsuccess = () => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Deleted entry: ${date}`, 'success');
                    }
                    resolve();
                };
                
                request.onerror = () => {
                    reject(request.error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    // Clear all data for current user
    async function clearAllData() {
        if (!db) return;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['entries'], 'readwrite');
                const store = transaction.objectStore('entries');
                const request = store.clear();
                
                request.onsuccess = () => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog('db.js: All data cleared', 'success');
                    }
                    resolve();
                };
                
                request.onerror = () => {
                    reject(request.error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    // Initialize database for user
    async function initDatabaseForUser(userId) {
        if (typeof window.addDebugLog === 'function') {
            window.addDebugLog(`db.js: Initializing database for user: ${userId}`, 'info');
        }
        
        try {
            await openUserDatabase(userId);
            
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
        getEntryByDate,
        deleteEntry,
        getEntriesNeedingSync,
        markAsSynced,
        clearAllData,
        closeDatabase
    };

    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog('db.js: Loading complete - API exposed', 'success');
        window.addDebugLog(`db.js: Available methods: ${Object.keys(window.dbAPI).join(', ')}`, 'info');
    }
})();
