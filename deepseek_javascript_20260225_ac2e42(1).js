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
            const request = indexedDB.open(dbName, 2); // Increment version to ensure schema update
            
            request.onupgradeneeded = (event) => {
                db = event.target.result;
                
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog('db.js: Database upgrade needed', 'info');
                }
                
                // Delete old stores if they exist (for version upgrade)
                if (event.oldVersion < 2) {
                    // Remove old stores if any
                    while(db.objectStoreNames.length) {
                        db.deleteObjectStore(db.objectStoreNames[0]);
                    }
                }
                
                if (!db.objectStoreNames.contains('entries')) {
                    const store = db.createObjectStore('entries', { keyPath: 'date' });
                    store.createIndex('date', 'date', { unique: true });
                    store.createIndex('sync_status', 'sync_status', { unique: false });
                    store.createIndex('user_id', 'user_id', { unique: false });
                    store.createIndex('updated_at', 'updated_at', { unique: false });
                    
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog('db.js: Created entries store with indexes', 'success');
                    }
                }
                
                if (!db.objectStoreNames.contains('balances')) {
                    db.createObjectStore('balances', { keyPath: 'type' });
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog('db.js: Created balances store', 'success');
                    }
                }
                
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
                
                // Ensure entry has all required fields
                entry.user_id = currentUserId;
                entry.sync_status = entry.sync_status || 'pending';
                entry.updated_at = new Date().toISOString();
                entry.created_at = entry.created_at || entry.updated_at;
                
                // Clean undefined values
                Object.keys(entry).forEach(key => {
                    if (entry[key] === undefined) {
                        delete entry[key];
                    }
                });
                
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

    // Get all entries for user with 97-day window
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
                    
                    // Apply 97-day window (90 days past, 7 days future)
                    const now = new Date();
                    const ninetyDaysAgo = new Date(now);
                    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
                    const sevenDaysFuture = new Date(now);
                    sevenDaysFuture.setDate(sevenDaysFuture.getDate() + 7);
                    
                    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];
                    const sevenDaysFutureStr = sevenDaysFuture.toISOString().split('T')[0];
                    
                    const windowedEntries = userEntries.filter(e => 
                        e.date >= ninetyDaysAgoStr && e.date <= sevenDaysFutureStr
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
                
            } catch (error) {
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog(`db.js: Exception in getAllEntriesForUser: ${error.message}`, 'error');
                }
                reject(error);
            }
        });
    }

    // Get entries needing sync - OPTIMIZED with limit
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
                        
                        // Sort by date (oldest first) for FIFO
                        userEntries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                        
                        // Limit to prevent timeout
                        const limited = userEntries.slice(0, limit);
                        
                        if (typeof window.addDebugLog === 'function') {
                            window.addDebugLog(`db.js: Found ${userEntries.length} pending entries, returning ${limited.length}`, 'info');
                        }
                        
                        resolve(limited);
                    };
                    
                    request.onerror = () => {
                        // Fallback to full scan if index fails
                        if (typeof window.addDebugLog === 'function') {
                            window.addDebugLog('db.js: Index query failed, falling back to full scan', 'warning');
                        }
                        fallbackGetEntries(resolve, reject, limit);
                    };
                } else {
                    // Fallback if index doesn't exist
                    fallbackGetEntries(resolve, reject, limit);
                }
                
            } catch (error) {
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog(`db.js: Error in getEntriesNeedingSync: ${error.message}`, 'error');
                }
                // Try fallback
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

    // Mark entries as synced - OPTIMIZED with batch processing
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
                
                // Process in smaller batches internally
                const processBatch = (startIndex) => {
                    const batchSize = 20;
                    const endIndex = Math.min(startIndex + batchSize, entryIds.length);
                    
                    for (let i = startIndex; i < endIndex; i++) {
                        const date = entryIds[i];
                        
                        // Use get request
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
                
                // Start processing first batch
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

    // Save balance
    async function saveBalance(type, value) {
        if (!db) return;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['balances'], 'readwrite');
                const store = transaction.objectStore('balances');
                
                const balance = {
                    type: type,
                    value: value,
                    user_id: currentUserId,
                    updated_at: new Date().toISOString()
                };
                
                const request = store.put(balance);
                
                request.onsuccess = () => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Balance saved: ${type} = ${value}`, 'success');
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

    // Get balance
    async function getBalance(type) {
        if (!db) return null;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['balances'], 'readonly');
                const store = transaction.objectStore('balances');
                const request = store.get(type);
                
                request.onsuccess = () => {
                    const balance = request.result;
                    if (balance && balance.user_id === currentUserId) {
                        resolve(balance.value);
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

    // Save sync metadata
    async function saveSyncMeta(key, value) {
        if (!db) return;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['syncMeta'], 'readwrite');
                const store = transaction.objectStore('syncMeta');
                
                const meta = {
                    key: key,
                    value: value,
                    updated_at: new Date().toISOString()
                };
                
                const request = store.put(meta);
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Get sync metadata
    async function getSyncMeta(key) {
        if (!db) return null;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['syncMeta'], 'readonly');
                const store = transaction.objectStore('syncMeta');
                const request = store.get(key);
                
                request.onsuccess = () => {
                    const meta = request.result;
                    resolve(meta ? meta.value : null);
                };
                
                request.onerror = () => {
                    reject(request.error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    // Clear old entries (keep only 97-day window)
    async function cleanupOldEntries() {
        if (!db) return 0;
        
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const cutoffDate = ninetyDaysAgo.toISOString().split('T')[0];
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['entries'], 'readwrite');
                const store = transaction.objectStore('entries');
                const request = store.getAll();
                
                request.onsuccess = () => {
                    const entries = request.result || [];
                    let deletedCount = 0;
                    
                    entries.forEach(entry => {
                        if (entry.user_id === currentUserId && entry.date < cutoffDate) {
                            // Check if synced before deleting
                            if (entry.sync_status === 'synced') {
                                store.delete(entry.date);
                                deletedCount++;
                            }
                        }
                    });
                    
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Cleaned up ${deletedCount} old entries`, 'info');
                    }
                    
                    resolve(deletedCount);
                };
                
                request.onerror = () => {
                    reject(request.error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    // Get database stats
    async function getDatabaseStats() {
        if (!db) return null;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(['entries'], 'readonly');
                const store = transaction.objectStore('entries');
                const request = store.getAll();
                
                request.onsuccess = () => {
                    const entries = request.result || [];
                    const userEntries = entries.filter(e => e.user_id === currentUserId);
                    
                    const stats = {
                        total: userEntries.length,
                        synced: userEntries.filter(e => e.sync_status === 'synced').length,
                        pending: userEntries.filter(e => e.sync_status === 'pending').length,
                        byMonth: {}
                    };
                    
                    userEntries.forEach(entry => {
                        const month = entry.date.substring(0, 7); // YYYY-MM
                        if (!stats.byMonth[month]) {
                            stats.byMonth[month] = 0;
                        }
                        stats.byMonth[month]++;
                    });
                    
                    resolve(stats);
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
            
            // Check if we have any entries
            const entries = await getAllEntriesForUser(userId);
            
            if (entries.length === 0) {
                if (typeof window.addDebugLog === 'function') {
                    window.addDebugLog('db.js: No entries found, creating sample data', 'info');
                }
                
                // Add today as sample entry if needed
                const today = new Date().toISOString().split('T')[0];
                await saveEntry({
                    date: today,
                    user_id: userId,
                    base_hours_rule: 8,
                    ot_cap_rule: 1,
                    sync_status: 'synced'
                });
            }
            
            // Clean up old entries in background
            setTimeout(() => {
                cleanupOldEntries().catch(err => {
                    if (typeof window.addDebugLog === 'function') {
                        window.addDebugLog(`db.js: Cleanup error: ${err.message}`, 'error');
                    }
                });
            }, 5000);
            
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
        saveBalance,
        getBalance,
        saveSyncMeta,
        getSyncMeta,
        cleanupOldEntries,
        getDatabaseStats,
        closeDatabase
    };

    if (typeof window.addDebugLog === 'function') {
        window.addDebugLog('db.js: Loading complete - API exposed', 'success');
        window.addDebugLog(`db.js: Available methods: ${Object.keys(window.dbAPI).join(', ')}`, 'info');
    }
})();