// ==================== APP.JS - ULTRA DEBUG VERSION ====================
(function() {
    if (typeof window.addDebugLog !== 'function') {
        window.addDebugLog = function(msg, type) {
            console.log(`[${type}] ${msg}`);
        };
    }
    
    window.addDebugLog('app.js: Loading started...', 'info');

    // ==================== GLOBAL VARIABLES ====================
    let appCurrentUser = null;
    let appAuthToken = null;
    let appCurrentCheckIn = null;
    let appCurrentCheckOut = null;

    // Template data - ALL SUNDAYS ARE HOLIDAYS with alternating CPL
    let weeklyTemplate = {
        monday: { base: 8, maxOT: 1, cpl: 0 },
        tuesday: { base: 8, maxOT: 1, cpl: 0 },
        wednesday: { base: 8, maxOT: 1, cpl: 0 },
        thursday: { base: 8, maxOT: 1, cpl: 0 },
        friday: { base: 8, maxOT: 1, cpl: 0 },
        saturday: { base: 6, maxOT: 0.5, cpl: 0 },
        // ALL Sundays are holidays with alternating CPL
        sundayOdd: { base: 8, maxOT: 0, cpl: 1.0, isHoliday: true },  // 1st, 3rd, 5th Sundays (1.0 CPL)
        sundayEven: { base: 6, maxOT: 0, cpl: 0.5, isHoliday: true }  // 2nd, 4th Sundays (0.5 CPL)
    };

    // ==================== INITIALIZATION ====================
    document.addEventListener('DOMContentLoaded', function() {
        window.addDebugLog('DOMContentLoaded fired', 'success');
        updateDateTime();
        setInterval(updateDateTime, 1000);
        
        // Load saved template if exists
        const savedTemplate = localStorage.getItem('weeklyTemplate');
        if (savedTemplate) {
            try {
                weeklyTemplate = JSON.parse(savedTemplate);
                window.addDebugLog('Loaded saved template', 'success');
            } catch (e) {
                window.addDebugLog('Error loading template', 'error');
            }
        }
        
        checkAuth();
        
        // Setup online/offline listeners
        setupNetworkListeners();
    });

    function updateDateTime() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        const timeStr = `${hour12}:${minutes.toString().padStart(2, '0')}`;
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase();
        
        const homeTime = document.getElementById('homeTime');
        const homePeriod = document.getElementById('homePeriod');
        const homeDate = document.getElementById('homeDate');
        
        if (homeTime) homeTime.textContent = timeStr;
        if (homePeriod) homePeriod.textContent = ampm;
        if (homeDate) homeDate.textContent = dateStr;
    }

    // ==================== NETWORK LISTENERS ====================
    function setupNetworkListeners() {
        window.addEventListener('online', function() {
            window.addDebugLog('Network is online - syncing pending entries', 'success');
            syncToCloud();
        });
        
        window.addEventListener('offline', function() {
            window.addDebugLog('Network is offline - entries will be saved locally', 'warning');
        });
    }

    // ==================== HELPER FUNCTION FOR LOCAL TIME ====================
    function getLocalTimeForDB(date = new Date()) {
        const localDate = new Date(date);
        const year = localDate.getFullYear();
        const month = String(localDate.getMonth() + 1).padStart(2, '0');
        const day = String(localDate.getDate()).padStart(2, '0');
        const hours = String(localDate.getHours()).padStart(2, '0');
        const minutes = String(localDate.getMinutes()).padStart(2, '0');
        const seconds = String(localDate.getSeconds()).padStart(2, '0');
        
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }

    // ==================== EXPIRY CALCULATIONS ====================
    function calculateCPLExpiry(earnedDate) {
        const date = new Date(earnedDate);
        date.setDate(date.getDate() + 180);
        return date.toISOString().split('T')[0];
    }

    function calculateALExpiry(earnedDate) {
        const date = new Date(earnedDate);
        const year = date.getFullYear();
        // AL expires at end of next year (Dec 31 of year+1)
        const expiryDate = new Date(year + 1, 11, 31);
        return expiryDate.toISOString().split('T')[0];
    }

    // ==================== GET SUNDAY WEEK NUMBER ====================
    function getSundayWeekNumber(date) {
        const dayOfMonth = date.getDate();
        return Math.ceil(dayOfMonth / 7);
    }

    // ==================== DYNAMIC HOLIDAY DETECTOR ====================
    function determineIsHoliday(entry, dayName) {
        // A: Is it a Sunday?
        if (dayName === 'sunday') {
            return true;
        }
        
        // B: Is cpl_grant_rule > 0?
        if (entry.cpl_grant_rule && entry.cpl_grant_rule > 0) {
            return true;
        }
        
        return false;
    }

    // ==================== STRICT OVERRIDER WITH ABSOLUTE ADJUSTMENT SHIELD ====================
    async function strictOverrider(entry) {
        if (!entry || !entry.date) return entry;
        
        window.addDebugLog(`STRICT OVERRIDER: Processing ${entry.date}`, 'info');
        window.addDebugLog(`Entry flags - is_manual_adjustment: ${entry.is_manual_adjustment}, al_adjustment: ${entry.al_adjustment}, cpl_adjustment: ${entry.cpl_adjustment}, ot_adjustment: ${entry.ot_adjustment}`, 'info');
        
        // ===== ABSOLUTE ADJUSTMENT SHIELD =====
        // If this is a manual adjustment, STOP IMMEDIATELY - return untouched
        if (entry.is_manual_adjustment === true) {
            window.addDebugLog(`🔒 ADJUSTMENT SHIELD ACTIVE - returning entry untouched with values: AL=${entry.al_adjustment}, CPL=${entry.cpl_adjustment}, OT=${entry.ot_adjustment}`, 'success');
            return entry; // Return the entry exactly as is, with adjustment values intact
        }
        
        // Make a copy to work with for non-adjustment entries
        const updatedEntry = { ...entry };
        
        // Get day name for rule determination
        const entryDate = new Date(updatedEntry.date + 'T12:00:00');
        const dayName = entryDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const sundayWeek = dayName === 'sunday' ? getSundayWeekNumber(entryDate) : null;
        
        // ===== STEP 1: Apply template rules if base hours not set =====
        if (updatedEntry.base_hours_rule === undefined || updatedEntry.base_hours_rule === null) {
            if (dayName === 'sunday') {
                if (sundayWeek % 2 === 1) { // Odd Sundays
                    updatedEntry.base_hours_rule = weeklyTemplate.sundayOdd.base;
                    updatedEntry.ot_cap_rule = weeklyTemplate.sundayOdd.maxOT;
                    updatedEntry.cpl_grant_rule = weeklyTemplate.sundayOdd.cpl;
                } else { // Even Sundays
                    updatedEntry.base_hours_rule = weeklyTemplate.sundayEven.base;
                    updatedEntry.ot_cap_rule = weeklyTemplate.sundayEven.maxOT;
                    updatedEntry.cpl_grant_rule = weeklyTemplate.sundayEven.cpl;
                }
            } else {
                updatedEntry.base_hours_rule = weeklyTemplate[dayName]?.base !== undefined ? weeklyTemplate[dayName].base : 8;
                updatedEntry.ot_cap_rule = weeklyTemplate[dayName]?.maxOT !== undefined ? weeklyTemplate[dayName].maxOT : 1;
                updatedEntry.cpl_grant_rule = weeklyTemplate[dayName]?.cpl !== undefined ? weeklyTemplate[dayName].cpl : 0;
            }
        }
        
        // Ensure values are numbers (preserve 0)
        updatedEntry.base_hours_rule = updatedEntry.base_hours_rule !== null ? Number(updatedEntry.base_hours_rule) : 8;
        updatedEntry.ot_cap_rule = updatedEntry.ot_cap_rule !== null ? Number(updatedEntry.ot_cap_rule) : 1;
        updatedEntry.cpl_grant_rule = updatedEntry.cpl_grant_rule !== null ? Number(updatedEntry.cpl_grant_rule) : 0;
        
        // ===== STEP 2: DYNAMIC HOLIDAY DETECTION =====
        updatedEntry.is_holiday = determineIsHoliday(updatedEntry, dayName);
        
        // ===== STEP 3: Check if it's a leave or off day =====
        const isLeaveDay = (updatedEntry.al_used && updatedEntry.al_used > 0) || 
                           (updatedEntry.sl_used && updatedEntry.sl_used > 0) || 
                           (updatedEntry.cl_used && updatedEntry.cl_used > 0) || 
                           (updatedEntry.cpl_used && updatedEntry.cpl_used > 0);
        
        if (updatedEntry.is_off_day || isLeaveDay) {
            window.addDebugLog('Off day or leave day - zeroing OT and CPL', 'info');
            updatedEntry.final_ot_hours = null;
            updatedEntry.cpl_earned = null;
            updatedEntry.cpl_expiry_date = null;
            updatedEntry.sync_status = 'pending';
            return updatedEntry;
        }
        
        // ===== STEP 4: Calculate hours worked =====
        let hoursWorked = 0;
        if (updatedEntry.check_in && updatedEntry.check_out) {
            const checkInDate = new Date(updatedEntry.check_in);
            const checkOutDate = new Date(updatedEntry.check_out);
            hoursWorked = (checkOutDate - checkInDate) / (1000 * 60 * 60);
            
            if (hoursWorked < 0) {
                window.addDebugLog('Negative hours - setting to 0', 'warning');
                hoursWorked = 0;
            }
        }
        
        // ===== STEP 5: WHOLE-NUMBER OT LOGIC =====
        // Formula: rawOT = hoursWorked - base_hours_rule
        // finalOT = Math.floor(Math.min(Math.max(rawOT, 0), ot_cap_rule))
        // If result is 0, set to null
        const rawOT = hoursWorked - updatedEntry.base_hours_rule;
        const cappedOT = Math.min(Math.max(rawOT, 0), updatedEntry.ot_cap_rule || 0);
        const floorOT = Math.floor(cappedOT);
        
        if (floorOT > 0) {
            updatedEntry.final_ot_hours = floorOT;
        } else {
            updatedEntry.final_ot_hours = null;
        }
        
        // ===== STEP 6: DIRECT CPL & EXPIRY LOGIC =====
        // Rule: If cpl_grant_rule > 0 AND hoursWorked >= base_hours_rule, then cpl_earned = cpl_grant_rule
        if (updatedEntry.cpl_grant_rule > 0 && hoursWorked >= updatedEntry.base_hours_rule) {
            updatedEntry.cpl_earned = updatedEntry.cpl_grant_rule;
            updatedEntry.cpl_expiry_date = calculateCPLExpiry(updatedEntry.date);
            window.addDebugLog(`CPL earned: ${updatedEntry.cpl_grant_rule} (expires: ${updatedEntry.cpl_expiry_date})`, 'success');
        } else {
            updatedEntry.cpl_earned = null;
            updatedEntry.cpl_expiry_date = null;
        }
        
        // ===== STEP 7: AL Accrual - Only add if this is the last day of month =====
        const lastDayOfMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
        if (entryDate.getDate() === lastDayOfMonth && !updatedEntry.al_accrued) {
            updatedEntry.al_accrued = 1.833;
            updatedEntry.al_expiry_date = calculateALExpiry(updatedEntry.date);
            window.addDebugLog(`Added AL accrual: 1.833 for month end`, 'info');
        }
        
        updatedEntry.sync_status = 'pending';
        
        window.addDebugLog(`STRICT OVERRIDER complete - Hours: ${hoursWorked.toFixed(2)}, Base: ${updatedEntry.base_hours_rule}, OT: ${updatedEntry.final_ot_hours}, CPL: ${updatedEntry.cpl_earned}, Holiday: ${updatedEntry.is_holiday}`, 'success');
        
        return updatedEntry;
    }

    // ==================== SMART FETCH ====================
    async function fetchOrCreateEntry(date) {
        if (!appCurrentUser || !window.dbAPI) return null;
        
        window.addDebugLog(`fetchOrCreateEntry: Fetching entry for ${date}`, 'info');
        
        // Check Local Storage
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        let entry = entries.find(e => e.date === date);
        
        if (entry) {
            window.addDebugLog(`fetchOrCreateEntry: Found entry locally for ${date}`, 'success');
            window.addDebugLog(`Local entry data - AL_adj:${entry.al_adjustment}, CPL_adj:${entry.cpl_adjustment}, OT_adj:${entry.ot_adjustment}`, 'info');
            return entry;
        }
        
        // If offline, wait for online
        if (!navigator.onLine) {
            window.addDebugLog(`fetchOrCreateEntry: Offline - waiting for network to fetch ${date}`, 'warning');
            return new Promise((resolve) => {
                const onlineHandler = async () => {
                    window.removeEventListener('online', onlineHandler);
                    const cloudEntry = await fetchFromCloud(date);
                    resolve(cloudEntry);
                };
                window.addEventListener('online', onlineHandler);
            });
        }
        
        // Fetch from Cloud
        window.addDebugLog(`fetchOrCreateEntry: No local entry, fetching from cloud for ${date}`, 'info');
        return await fetchFromCloud(date);
    }

    async function fetchFromCloud(date) {
        window.addDebugLog(`fetchFromCloud: Fetching ${date} from cloud`, 'info');
        
        try {
            const response = await fetch(`/api/archive?date=${date}`, {
                headers: { 'Authorization': `Bearer ${appAuthToken}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.entry) {
                    const cloudEntry = data.entry;
                    if (cloudEntry.date && cloudEntry.date.includes('T')) {
                        cloudEntry.date = cloudEntry.date.split('T')[0];
                    }
                    cloudEntry.user_id = appCurrentUser.id;
                    cloudEntry.sync_status = 'synced';
                    
                    // Ensure all fields exist with proper defaults
                    cloudEntry.al_adjustment = cloudEntry.al_adjustment !== undefined && cloudEntry.al_adjustment !== null ? cloudEntry.al_adjustment : 0;
                    cloudEntry.cpl_adjustment = cloudEntry.cpl_adjustment !== undefined && cloudEntry.cpl_adjustment !== null ? cloudEntry.cpl_adjustment : 0;
                    cloudEntry.ot_adjustment = cloudEntry.ot_adjustment !== undefined && cloudEntry.ot_adjustment !== null ? cloudEntry.ot_adjustment : 0;
                    cloudEntry.al_accrued = cloudEntry.al_accrued !== undefined && cloudEntry.al_accrued !== null ? cloudEntry.al_accrued : 0;
                    cloudEntry.al_used = cloudEntry.al_used !== undefined && cloudEntry.al_used !== null ? cloudEntry.al_used : 0;
                    cloudEntry.sl_used = cloudEntry.sl_used !== undefined && cloudEntry.sl_used !== null ? cloudEntry.sl_used : 0;
                    cloudEntry.cl_used = cloudEntry.cl_used !== undefined && cloudEntry.cl_used !== null ? cloudEntry.cl_used : 0;
                    cloudEntry.cpl_used = cloudEntry.cpl_used !== undefined && cloudEntry.cpl_used !== null ? cloudEntry.cpl_used : 0;
                    
                    window.addDebugLog(`fetchFromCloud: Cloud entry loaded with adjustments: AL=${cloudEntry.al_adjustment}, CPL=${cloudEntry.cpl_adjustment}, OT=${cloudEntry.ot_adjustment}`, 'success');
                    
                    // Run through strict overrider (will respect is_manual_adjustment if set)
                    const overriddenEntry = await strictOverrider(cloudEntry);
                    await window.dbAPI.saveEntry(overriddenEntry);
                    return overriddenEntry;
                }
            }
            window.addDebugLog(`fetchFromCloud: No entry found in cloud for ${date}`, 'info');
        } catch (error) {
            window.addDebugLog(`fetchFromCloud: Error fetching from cloud: ${error.message}`, 'error');
        }
        
        // Create new entry - ALL fields defined with explicit defaults
        const newEntry = {
            date: date,
            user_id: appCurrentUser.id,
            check_in: null,
            check_out: null,
            base_hours_rule: null,
            ot_cap_rule: null,
            cpl_grant_rule: null,
            final_ot_hours: null,
            cpl_earned: null,
            al_used: 0,
            sl_used: 0,
            cl_used: 0,
            cpl_used: 0,
            is_off_day: false,
            is_holiday: false,
            is_manual_adjustment: false,
            al_accrued: 0,
            al_adjustment: 0,        // IMPORTANT: Initialize to 0
            al_expiry_date: null,
            cpl_adjustment: 0,        // IMPORTANT: Initialize to 0
            cpl_expiry_date: null,
            ot_adjustment: 0,          // IMPORTANT: Initialize to 0
            adjustment_note: '',
            sync_status: 'pending'
        };
        
        window.addDebugLog(`fetchFromCloud: Created new entry with adjustment fields initialized to 0`, 'info');
        
        // Run through strict overrider
        const overriddenEntry = await strictOverrider(newEntry);
        return overriddenEntry;
    }

    // ==================== SAVE WITH STRICT OVERRIDE ====================
    async function saveAndSync(entry, skipSync = false) {
        if (!entry || !entry.date || !appCurrentUser) return;
        
        window.addDebugLog(`saveAndSync called for ${entry.date}`, 'info');
        window.addDebugLog(`Entry before strictOverrider - AL_adj:${entry.al_adjustment}, CPL_adj:${entry.cpl_adjustment}, is_manual:${entry.is_manual_adjustment}`, 'info');
        
        // ALWAYS run through strict overrider before saving
        // This will bypass for adjustments due to the shield
        const overriddenEntry = await strictOverrider(entry);
        
        window.addDebugLog(`Entry after strictOverrider - AL_adj:${overriddenEntry.al_adjustment}, CPL_adj:${overriddenEntry.cpl_adjustment}, is_manual:${overriddenEntry.is_manual_adjustment}`, 'info');
        
        // Save to local DB
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(overriddenEntry);
            window.addDebugLog(`saveAndSync: Saved entry for ${entry.date} to local DB`, 'success');
        }
        
        // Only trigger sync if not skipped and online
        if (!skipSync && navigator.onLine) {
            window.addDebugLog('saveAndSync: Scheduling sync', 'info');
            setTimeout(() => syncToCloud(), 500);
        }
        
        return overriddenEntry;
    }

    // ==================== BATCH SYNC ====================
    async function batchSyncToCloud() {
        if (!appAuthToken || !appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        if (!navigator.onLine) {
            window.addDebugLog('Offline - cannot sync to cloud', 'warning');
            return;
        }
        
        window.addDebugLog('=== BATCH SYNC STARTED ===', 'info');
        
        const syncOutBtn = document.querySelector('.sync-out');
        const originalText = syncOutBtn ? syncOutBtn.innerHTML : 'SYNC OUT';
        if (syncOutBtn) {
            syncOutBtn.innerHTML = '<span class="sync-icon">⏳</span> SYNCING...';
            syncOutBtn.disabled = true;
        }
        
        try {
            const pendingEntries = await window.dbAPI.getEntriesNeedingSync(100);
            
            if (pendingEntries.length === 0) {
                window.addDebugLog('No entries to sync', 'info');
                return { success: true, count: 0 };
            }
            
            let successCount = 0;
            let errorCount = 0;
            
            for (let i = 0; i < pendingEntries.length; i++) {
                const entry = pendingEntries[i];
                
                if (syncOutBtn) {
                    syncOutBtn.innerHTML = `<span class="sync-icon">⏳</span> ${i+1}/${pendingEntries.length}`;
                }
                
                // Clean entry for sync - ensure null values where appropriate
                const cleanEntry = {
                    date: entry.date,
                    check_in: entry.check_in || null,
                    check_out: entry.check_out || null,
                    // For manual adjustments, base rules must be null
                    base_hours_rule: entry.is_manual_adjustment ? null : (entry.base_hours_rule !== null ? entry.base_hours_rule : null),
                    ot_cap_rule: entry.is_manual_adjustment ? null : (entry.ot_cap_rule !== null ? entry.ot_cap_rule : null),
                    cpl_grant_rule: entry.is_manual_adjustment ? null : (entry.cpl_grant_rule !== null ? entry.cpl_grant_rule : null),
                    final_ot_hours: entry.final_ot_hours || null,
                    cpl_earned: entry.cpl_earned || null,
                    al_used: entry.al_used || 0,
                    sl_used: entry.sl_used || 0,
                    cl_used: entry.cl_used || 0,
                    cpl_used: entry.cpl_used || 0,
                    is_off_day: entry.is_off_day || false,
                    is_holiday: entry.is_holiday || false,
                    is_manual_adjustment: entry.is_manual_adjustment ? 1 : 0,
                    al_accrued: entry.al_accrued || 0,
                    al_adjustment: parseFloat(entry.al_adjustment) || 0,
                    al_expiry_date: entry.al_expiry_date || null,
                    cpl_adjustment: parseFloat(entry.cpl_adjustment) || 0,
                    cpl_expiry_date: entry.cpl_expiry_date || null,
                    ot_adjustment: parseFloat(entry.ot_adjustment) || 0,
                    adjustment_note: entry.adjustment_note || ''
                };
                
                window.addDebugLog(`Syncing entry ${entry.date} with adjustments: AL=${cleanEntry.al_adjustment}, CPL=${cleanEntry.cpl_adjustment}, OT=${cleanEntry.ot_adjustment}`, 'info');
                
                try {
                    const response = await fetch('/api/sync?direction=to', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${appAuthToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ entries: [cleanEntry] })
                    });
                    
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    
                    const data = await response.json();
                    
                    if (data.success && data.syncedIds && data.syncedIds.length > 0) {
                        await window.dbAPI.markAsSynced([entry.date]);
                        successCount++;
                        window.addDebugLog(`Successfully synced ${entry.date}`, 'success');
                    }
                    
                } catch (err) {
                    window.addDebugLog(`Failed to sync ${entry.date}: ${err.message}`, 'error');
                    errorCount++;
                }
            }
            
            updateLastSyncTime();
            window.addDebugLog(`Batch sync complete - Success: ${successCount}, Failed: ${errorCount}`, 'info');
            
            return { success: true, successCount, errorCount };
            
        } catch (error) {
            window.addDebugLog(`Batch sync error: ${error.message}`, 'error');
            throw error;
        } finally {
            if (syncOutBtn) {
                syncOutBtn.innerHTML = originalText;
                syncOutBtn.disabled = false;
            }
        }
    }

    // ==================== SYNC TO CLOUD (Wrapper) ====================
    async function syncToCloud() {
        try {
            await batchSyncToCloud();
        } catch (error) {
            alert('Sync failed: ' + error.message);
        }
    }

    // ==================== SYNC FROM CLOUD ====================
    async function syncFromCloud() {
        if (!appAuthToken || !appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        if (!navigator.onLine) {
            alert('You are offline. Please connect to the internet to sync.');
            return;
        }
        
        window.addDebugLog('=== SYNC FROM CLOUD STARTED ===', 'info');
        
        const syncInBtn = document.querySelector('.sync-in');
        const originalText = syncInBtn ? syncInBtn.innerHTML : 'SYNC IN';
        if (syncInBtn) {
            syncInBtn.innerHTML = '<span class="sync-icon">⏳</span> SYNCING...';
            syncInBtn.disabled = true;
        }
        
        try {
            const response = await fetch('/api/sync?direction=from', {
                headers: { 'Authorization': `Bearer ${appAuthToken}` }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            if (data.success && data.entries) {
                let imported = 0;
                for (const entry of data.entries) {
                    if (entry.date && entry.date.includes('T')) {
                        entry.date = entry.date.split('T')[0];
                    }
                    
                    // Convert string numbers, preserving nulls
                    entry.al_used = entry.al_used !== null ? parseFloat(entry.al_used) : 0;
                    entry.sl_used = entry.sl_used !== null ? parseFloat(entry.sl_used) : 0;
                    entry.cl_used = entry.cl_used !== null ? parseFloat(entry.cl_used) : 0;
                    entry.cpl_used = entry.cpl_used !== null ? parseFloat(entry.cpl_used) : 0;
                    entry.base_hours_rule = entry.base_hours_rule !== null ? parseFloat(entry.base_hours_rule) : null;
                    entry.ot_cap_rule = entry.ot_cap_rule !== null ? parseFloat(entry.ot_cap_rule) : null;
                    entry.cpl_grant_rule = entry.cpl_grant_rule !== null ? parseFloat(entry.cpl_grant_rule) : null;
                    entry.final_ot_hours = entry.final_ot_hours !== null ? parseFloat(entry.final_ot_hours) : null;
                    entry.cpl_earned = entry.cpl_earned !== null ? parseFloat(entry.cpl_earned) : null;
                    entry.al_accrued = entry.al_accrued !== null ? parseFloat(entry.al_accrued) : 0;
                    
                    // CRITICAL: Ensure adjustment fields are properly parsed
                    entry.al_adjustment = entry.al_adjustment !== null ? parseFloat(entry.al_adjustment) : 0;
                    entry.cpl_adjustment = entry.cpl_adjustment !== null ? parseFloat(entry.cpl_adjustment) : 0;
                    entry.ot_adjustment = entry.ot_adjustment !== null ? parseFloat(entry.ot_adjustment) : 0;
                    
                    entry.is_off_day = entry.is_off_day === true || entry.is_off_day === 'true';
                    entry.is_holiday = entry.is_holiday === true || entry.is_holiday === 'true';
                    entry.is_manual_adjustment = entry.is_manual_adjustment === true || entry.is_manual_adjustment === 'true';
                    
                    entry.user_id = appCurrentUser.id;
                    entry.sync_status = 'synced';
                    
                    window.addDebugLog(`Cloud entry ${entry.date} has adjustments: AL=${entry.al_adjustment}, CPL=${entry.cpl_adjustment}, OT=${entry.ot_adjustment}`, 'info');
                    
                    // Run through strict overrider (will respect is_manual_adjustment)
                    const overriddenEntry = await strictOverrider(entry);
                    await window.dbAPI.saveEntry(overriddenEntry);
                    imported++;
                }
                
                updateLastSyncTime();
                window.addDebugLog(`Imported ${imported} entries`, 'success');
                
                await loadTodayEntry();
                await loadBalances();
                await loadAdjustments();
                await loadExpiryInfo();
                
                if (imported > 0) {
                    alert(`✅ Imported ${imported} entries from cloud`);
                }
            }
            
        } catch (error) {
            window.addDebugLog(`Sync error: ${error.message}`, 'error');
            alert('Sync failed: ' + error.message);
        } finally {
            if (syncInBtn) {
                syncInBtn.innerHTML = originalText;
                syncInBtn.disabled = false;
            }
        }
    }

    function updateLastSyncTime() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        const timeStr = `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        
        const lastSyncEl = document.getElementById('lastSyncTime');
        if (lastSyncEl) {
            lastSyncEl.textContent = `Last sync: ${timeStr}`;
        }
    }

    // ==================== ADVANCED FIFO MATCHMAKER ====================
    function calculateFIFOBalance(entries, targetDate = new Date()) {
        window.addDebugLog('Running FIFO Matchmaker...', 'info');
        
        targetDate.setHours(23, 59, 59, 999);
        
        // Sort all entries by date
        const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // COLLECT ALL PACKETS - Including adjustment packets
        const alPackets = [];
        const cplPackets = [];
        const alUsage = [];
        const cplUsage = [];
        
        // Track yearly totals for AL cap
        const alByYear = {};
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const year = entryDate.getFullYear();
            
            // AL Packets (accruals)
            if (entry.al_accrued && entry.al_accrued > 0) {
                const packet = {
                    date: entry.date,
                    amount: entry.al_accrued,
                    expiryDate: entry.al_expiry_date ? new Date(entry.al_expiry_date) : null,
                    type: 'accrual',
                    entryId: entry.date + '-accrual'
                };
                alPackets.push(packet);
                
                if (!alByYear[year]) alByYear[year] = 0;
                alByYear[year] += entry.al_accrued;
            }
            
            // AL Packets (adjustments) - CRITICAL: These are separate packets
            if (entry.al_adjustment && entry.al_adjustment !== 0) {
                const packet = {
                    date: entry.date,
                    amount: entry.al_adjustment,
                    expiryDate: entry.al_expiry_date ? new Date(entry.al_expiry_date) : null,
                    type: 'adjustment',
                    entryId: entry.date + '-adj'
                };
                alPackets.push(packet);
                window.addDebugLog(`Added AL adjustment packet: ${entry.al_adjustment} on ${entry.date}`, 'info');
                
                if (!alByYear[year]) alByYear[year] = 0;
                alByYear[year] += entry.al_adjustment;
            }
            
            // CPL Packets
            if (entry.cpl_earned && entry.cpl_earned > 0 && entry.cpl_expiry_date) {
                cplPackets.push({
                    date: entry.date,
                    amount: entry.cpl_earned,
                    expiryDate: new Date(entry.cpl_expiry_date),
                    entryId: entry.date
                });
            }
            
            // CPL Adjustment Packets - CRITICAL: These are separate packets
            if (entry.cpl_adjustment && entry.cpl_adjustment !== 0) {
                cplPackets.push({
                    date: entry.date,
                    amount: entry.cpl_adjustment,
                    expiryDate: entry.cpl_expiry_date ? new Date(entry.cpl_expiry_date) : null,
                    type: 'adjustment',
                    entryId: entry.date + '-cpl-adj'
                });
                window.addDebugLog(`Added CPL adjustment packet: ${entry.cpl_adjustment} on ${entry.date}`, 'info');
            }
            
            // AL Usage
            if (entry.al_used && entry.al_used > 0) {
                alUsage.push({
                    date: entry.date,
                    amount: entry.al_used,
                    entryId: entry.date
                });
            }
            
            // CPL Usage
            if (entry.cpl_used && entry.cpl_used > 0) {
                cplUsage.push({
                    date: entry.date,
                    amount: entry.cpl_used,
                    entryId: entry.date
                });
            }
        }
        
        // APPLY YEAR-END CAP (22-day limit)
        const years = Object.keys(alByYear).map(Number).sort();
        const yearEndCaps = {};
        
        for (let i = 0; i < years.length; i++) {
            const year = years[i];
            const nextYear = year + 1;
            
            // Calculate Dec 31st balance for this year (including adjustments)
            const dec31Balance = alByYear[year];
            
            // Apply 22-day cap for carry forward to next year
            if (dec31Balance > 22) {
                yearEndCaps[year] = 22;
                window.addDebugLog(`Year ${year} Dec 31 balance ${dec31Balance.toFixed(2)} capped to 22 for Jan 1 ${nextYear}`, 'info');
            } else {
                yearEndCaps[year] = dec31Balance;
            }
        }
        
        // FIFO MATCHMAKING
        alPackets.sort((a, b) => new Date(a.date) - new Date(b.date));
        cplPackets.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Process AL usage with FIFO
        let alPacketsCopy = [...alPackets];
        
        for (const usage of alUsage) {
            const usageDate = new Date(usage.date);
            let remainingToUse = usage.amount;
            
            // Find packets that were valid on usage date
            const validPackets = [];
            for (let i = 0; i < alPacketsCopy.length; i++) {
                const packet = alPacketsCopy[i];
                if (packet.amount <= 0) continue;
                
                const packetDate = new Date(packet.date);
                const expiryDate = packet.expiryDate;
                
                // Check if packet was valid on usage date
                const isValidOnUsageDate = packetDate <= usageDate && 
                                          (!expiryDate || expiryDate > usageDate);
                
                if (isValidOnUsageDate) {
                    validPackets.push({ index: i, packet });
                }
            }
            
            // Use from oldest valid packets first
            validPackets.sort((a, b) => new Date(a.packet.date) - new Date(b.packet.date));
            
            for (const { index, packet } of validPackets) {
                if (remainingToUse <= 0) break;
                
                const available = packet.amount;
                if (available <= remainingToUse) {
                    remainingToUse -= available;
                    alPacketsCopy[index] = { ...packet, amount: 0 };
                } else {
                    alPacketsCopy[index] = { 
                        ...packet, 
                        amount: available - remainingToUse
                    };
                    remainingToUse = 0;
                }
            }
        }
        
        // Process CPL usage with FIFO
        let cplPacketsCopy = [...cplPackets];
        
        for (const usage of cplUsage) {
            const usageDate = new Date(usage.date);
            let remainingToUse = usage.amount;
            
            const validPackets = [];
            for (let i = 0; i < cplPacketsCopy.length; i++) {
                const packet = cplPacketsCopy[i];
                if (packet.amount <= 0) continue;
                
                const packetDate = new Date(packet.date);
                const expiryDate = packet.expiryDate;
                
                const isValidOnUsageDate = packetDate <= usageDate && expiryDate > usageDate;
                
                if (isValidOnUsageDate) {
                    validPackets.push({ index: i, packet });
                }
            }
            
            validPackets.sort((a, b) => new Date(a.packet.date) - new Date(b.packet.date));
            
            for (const { index, packet } of validPackets) {
                if (remainingToUse <= 0) break;
                
                const available = packet.amount;
                if (available <= remainingToUse) {
                    remainingToUse -= available;
                    cplPacketsCopy[index] = { ...packet, amount: 0 };
                } else {
                    cplPacketsCopy[index] = { 
                        ...packet, 
                        amount: available - remainingToUse
                    };
                    remainingToUse = 0;
                }
            }
        }
        
        // CALCULATE CURRENT BALANCE
        let alBalance = 0;
        let cplBalance = 0;
        
        // Group remaining AL packets by year for cap application
        const remainingByYear = {};
        
        for (const packet of alPacketsCopy) {
            if (packet.amount > 0) {
                const expiryDate = packet.expiryDate;
                if (!expiryDate || expiryDate > targetDate) {
                    const year = new Date(packet.date).getFullYear();
                    if (!remainingByYear[year]) remainingByYear[year] = 0;
                    remainingByYear[year] += packet.amount;
                }
            }
        }
        
        // Apply year-end caps to current balance
        for (const [year, amount] of Object.entries(remainingByYear)) {
            const yearNum = parseInt(year);
            if (yearEndCaps[yearNum] !== undefined && amount > yearEndCaps[yearNum]) {
                alBalance += yearEndCaps[yearNum];
            } else {
                alBalance += amount;
            }
        }
        
        // Sum remaining CPL packets
        for (const packet of cplPacketsCopy) {
            if (packet.amount > 0 && packet.expiryDate > targetDate) {
                cplBalance += packet.amount;
            }
        }
        
        window.addDebugLog(`FIFO Matchmaker complete - AL: ${alBalance.toFixed(2)}, CPL: ${cplBalance.toFixed(2)}`, 'success');
        
        return {
            alBalance,
            cplBalance,
            alPackets: alPacketsCopy,
            cplPackets: cplPacketsCopy
        };
    }

    // ==================== BALANCE FUNCTIONS ====================
    async function loadBalances() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        window.addDebugLog('loadBalances() called', 'info');
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const today = new Date();
        
        // Filter to past entries
        const pastEntries = entries.filter(e => new Date(e.date) <= today);
        
        // Run FIFO matchmaker
        const fifoResult = calculateFIFOBalance(pastEntries, today);
        
        // Calculate OT totals
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        
        let otThisMonth = 0;
        let otLastMonth = 0;
        let totalOT = 0;
        let totalLeave = 0;
        
        // SL/CL tracking
        let slBalance = 10.0;
        let clBalance = 10.0;
        let currentYearSL = currentYear;
        let currentYearCL = currentYear;
        
        const sortedEntries = [...pastEntries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const entryYear = entryDate.getFullYear();
            
            // SL/CL reset at start of each year
            if (entryYear > currentYearSL) {
                slBalance = 10.0;
                currentYearSL = entryYear;
            }
            if (entryYear > currentYearCL) {
                clBalance = 10.0;
                currentYearCL = entryYear;
            }
            
            if (entry.sl_used) {
                slBalance -= entry.sl_used;
                totalLeave += entry.sl_used;
            }
            if (entry.cl_used) {
                clBalance -= entry.cl_used;
                totalLeave += entry.cl_used;
            }
            if (entry.al_used) totalLeave += entry.al_used;
            if (entry.cpl_used) totalLeave += entry.cpl_used;
            
            // OT totals - only count if not null
            if (entry.final_ot_hours && entry.final_ot_hours > 0) {
                totalOT += entry.final_ot_hours;
                
                if (entryDate.getMonth() === currentMonth && entryYear === currentYear) {
                    otThisMonth += entry.final_ot_hours;
                } else if (entryDate.getMonth() === lastMonth && entryYear === lastMonthYear) {
                    otLastMonth += entry.final_ot_hours;
                }
            }
        }
        
        // Update UI
        document.getElementById('alBalance').textContent = fifoResult.alBalance.toFixed(2);
        document.getElementById('slBalance').textContent = slBalance.toFixed(2);
        document.getElementById('clBalance').textContent = clBalance.toFixed(2);
        document.getElementById('cplBalance').textContent = fifoResult.cplBalance.toFixed(2);
        document.getElementById('otMonth').textContent = otThisMonth.toFixed(1);
        document.getElementById('otLastMonth').textContent = otLastMonth.toFixed(1);
        
        // Update settings fields
        const setupAL = document.getElementById('setupAL');
        const setupSL = document.getElementById('setupSL');
        const setupCL = document.getElementById('setupCL');
        const setupCPL = document.getElementById('setupCPL');
        const setupOT = document.getElementById('setupOT');
        
        if (setupAL) setupAL.value = fifoResult.alBalance.toFixed(2);
        if (setupSL) setupSL.value = slBalance.toFixed(2);
        if (setupCL) setupCL.value = clBalance.toFixed(2);
        if (setupCPL) setupCPL.value = fifoResult.cplBalance.toFixed(2);
        if (setupOT) setupOT.value = totalOT.toFixed(1);
        
        window.addDebugLog(`Balances - AL: ${fifoResult.alBalance.toFixed(2)}, SL: ${slBalance.toFixed(2)}, CL: ${clBalance.toFixed(2)}, CPL: ${fifoResult.cplBalance.toFixed(2)}`, 'success');
    }

    // ==================== LOAD EXPIRY INFO ====================
    async function loadExpiryInfo() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const now = new Date();
        
        const fifoResult = calculateFIFOBalance(entries, now);
        
        const alExpiryDiv = document.getElementById('alExpiryInfo');
        const cplExpiryDiv = document.getElementById('cplExpiryInfo');
        
        // AL Expiring
        const alExpiring = [];
        const alPackets = fifoResult.alPackets || [];
        
        for (const packet of alPackets) {
            if (packet.amount > 0 && packet.expiryDate) {
                const daysUntil = Math.ceil((packet.expiryDate - now) / (1000 * 60 * 60 * 24));
                if (daysUntil > 0 && daysUntil <= 90) {
                    alExpiring.push({
                        year: new Date(packet.date).getFullYear(),
                        amount: packet.amount,
                        daysUntil: daysUntil,
                        type: packet.type
                    });
                }
            }
        }
        
        // Group by year
        const alByYear = {};
        alExpiring.forEach(item => {
            if (!alByYear[item.year]) alByYear[item.year] = 0;
            alByYear[item.year] += item.amount;
        });
        
        if (alExpiryDiv) {
            if (Object.keys(alByYear).length === 0) {
                alExpiryDiv.innerHTML = '<p>No AL expiring soon</p>';
            } else {
                let html = '<h4>AL Expiring Soon</h4>';
                Object.entries(alByYear).forEach(([year, amount]) => {
                    html += `
                        <div class="expiry-item">
                            <div><strong>Year ${year}</strong></div>
                            <div>${amount.toFixed(2)} days expiring</div>
                        </div>
                    `;
                });
                alExpiryDiv.innerHTML = html;
            }
        }
        
        // CPL Expiring
        const cplExpiring = [];
        const cplPackets = fifoResult.cplPackets || [];
        
        for (const packet of cplPackets) {
            if (packet.amount > 0 && packet.expiryDate) {
                const daysUntil = Math.ceil((packet.expiryDate - now) / (1000 * 60 * 60 * 24));
                if (daysUntil > 0 && daysUntil <= 90) {
                    cplExpiring.push({
                        date: packet.date,
                        amount: packet.amount,
                        daysUntil: daysUntil
                    });
                }
            }
        }
        
        cplExpiring.sort((a, b) => a.daysUntil - b.daysUntil);
        
        if (cplExpiryDiv) {
            if (cplExpiring.length === 0) {
                cplExpiryDiv.innerHTML = '<p>No CPL expiring soon</p>';
            } else {
                let html = '<h4>CPL Expiring Soon</h4>';
                cplExpiring.slice(0, 5).forEach(item => {
                    html += `
                        <div class="expiry-item">
                            <div>${item.amount.toFixed(2)} days from ${item.date}</div>
                            <div>Expires in ${item.daysUntil} days</div>
                        </div>
                    `;
                });
                cplExpiryDiv.innerHTML = html;
            }
        }
    }

    // ==================== RECALCULATE ALL ====================
    async function recalculateAll() {
        if (!confirm('This will HARD RESET all calculations and re-run the Strict Overrider on every entry. Continue?')) {
            return;
        }
        
        window.addDebugLog('🔄 RECALCULATE ALL - HARD RESET STARTED', 'warning');
        
        if (!appCurrentUser || !window.dbAPI) {
            alert('Please login first');
            return;
        }
        
        try {
            // Get all entries
            const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
            window.addDebugLog(`Found ${entries.length} entries to process`, 'info');
            
            // Show progress
            const progressDiv = document.createElement('div');
            progressDiv.className = 'progress-bar';
            progressDiv.style.position = 'fixed';
            progressDiv.style.top = '50%';
            progressDiv.style.left = '50%';
            progressDiv.style.transform = 'translate(-50%, -50%)';
            progressDiv.style.zIndex = '10000';
            progressDiv.style.padding = '20px';
            progressDiv.style.background = 'white';
            progressDiv.style.borderRadius = '8px';
            progressDiv.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
            document.body.appendChild(progressDiv);
            
            let count = 0;
            const total = entries.length;
            
            // STRICT OVERRIDE on every entry (adjustments will be skipped by shield)
            for (const entry of entries) {
                count++;
                progressDiv.innerHTML = `Processing ${count}/${total}<br>Entry: ${entry.date}`;
                
                // Run through strict overrider - adjustments will be returned untouched
                const overriddenEntry = await strictOverrider(entry);
                
                // Save to local DB
                await window.dbAPI.saveEntry(overriddenEntry);
                
                // Small delay to prevent UI freeze
                if (count % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            progressDiv.innerHTML = 'Running FIFO Matchmaker...';
            
            // Re-run FIFO matchmaker on all entries
            const today = new Date();
            const allEntries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
            calculateFIFOBalance(allEntries, today);
            
            progressDiv.innerHTML = 'Syncing to cloud...';
            
            // Batch sync to cloud
            if (navigator.onLine) {
                await batchSyncToCloud();
            }
            
            // Remove progress
            document.body.removeChild(progressDiv);
            
            // Update UI
            await loadBalances();
            await loadExpiryInfo();
            
            window.addDebugLog('RECALCULATE ALL - HARD RESET COMPLETE', 'success');
            alert('✅ All entries have been recalculated and synced');
            
        } catch (error) {
            window.addDebugLog(`Recalculate All error: ${error.message}`, 'error');
            alert('Error recalculating: ' + error.message);
        }
    }

    // ==================== AUTH FUNCTIONS ====================
    function showRegister() {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('registerScreen').style.display = 'block';
    }

    function showLogin() {
        document.getElementById('registerScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'block';
    }

    async function checkAuth() {
        const token = localStorage.getItem('auth_token');
        const userStr = localStorage.getItem('auth_user');
        
        if (token && userStr) {
            try {
                appCurrentUser = JSON.parse(userStr);
                appAuthToken = token;
                window.addDebugLog(`Found user: ${appCurrentUser.email}`, 'success');
                window.addDebugLog(`User ID: ${appCurrentUser.id}`, 'info');
                
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                }
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                // Load today's entry
                await loadTodayEntry();
                await loadBalances();
                updateLastSyncTime();
                loadTemplateToUI();
                await loadAdjustments();
                await loadExpiryInfo();
                
                // Auto sync from cloud on login
                setTimeout(() => syncFromCloud(), 2000);
                
            } catch (error) {
                window.addDebugLog(`Auth error: ${error.message}`, 'error');
                showLogin();
            }
        } else {
            showLogin();
        }
    }

    async function login() {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        
        if (!email || !password) {
            errorEl.textContent = 'Email and password required';
            return;
        }
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            if (data.success) {
                appAuthToken = data.token;
                appCurrentUser = data.user;
                
                localStorage.setItem('auth_token', data.token);
                localStorage.setItem('auth_user', JSON.stringify(data.user));
                
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                }
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                await loadTodayEntry();
                await loadBalances();
                updateLastSyncTime();
                loadTemplateToUI();
                await loadAdjustments();
                await loadExpiryInfo();
                
                setTimeout(() => syncFromCloud(), 2000);
                
                errorEl.textContent = '';
            } else {
                errorEl.textContent = data.message || 'Login failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error: ' + error.message;
        }
    }

    async function register() {
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const errorEl = document.getElementById('registerError');
        
        if (!name || !email || !password) {
            errorEl.textContent = 'All fields required';
            return;
        }
        
        if (password.length < 6) {
            errorEl.textContent = 'Password too short';
            return;
        }
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            if (data.success) {
                showLogin();
                document.getElementById('loginEmail').value = email;
                document.getElementById('loginError').textContent = 'Registration successful! Please login.';
            } else {
                errorEl.textContent = data.message || 'Registration failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error: ' + error.message;
        }
    }

    // ==================== CHANGE PASSWORD ====================
    function showChangePasswordModal() {
        document.getElementById('changePasswordModal').style.display = 'flex';
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('passwordError').textContent = '';
    }

    function closeChangePasswordModal() {
        document.getElementById('changePasswordModal').style.display = 'none';
    }

    async function changePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const errorEl = document.getElementById('passwordError');
        
        if (!currentPassword || !newPassword || !confirmPassword) {
            errorEl.textContent = 'All fields required';
            return;
        }
        
        if (newPassword !== confirmPassword) {
            errorEl.textContent = 'New passwords do not match';
            return;
        }
        
        if (newPassword.length < 6) {
            errorEl.textContent = 'Password must be at least 6 characters';
            return;
        }
        
        try {
            const response = await fetch('/api/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${appAuthToken}`
                },
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            if (data.success) {
                closeChangePasswordModal();
                alert('✅ Password changed successfully');
            } else {
                errorEl.textContent = data.message || 'Password change failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error: ' + error.message;
        }
    }

    // ==================== DELETE ACCOUNT ====================
    function showDeleteAccountModal() {
        document.getElementById('deleteAccountModal').style.display = 'flex';
        document.getElementById('deleteConfirm').value = '';
        document.getElementById('deleteError').textContent = '';
    }

    function closeDeleteAccountModal() {
        document.getElementById('deleteAccountModal').style.display = 'none';
    }

    async function deleteAccount() {
        const confirmText = document.getElementById('deleteConfirm').value;
        const errorEl = document.getElementById('deleteError');
        
        if (confirmText !== 'DELETE') {
            errorEl.textContent = 'Please type DELETE to confirm';
            return;
        }
        
        if (!confirm('⚠️ WARNING: This will permanently delete ALL your data and account. This action cannot be undone!')) {
            return;
        }
        
        try {
            const response = await fetch('/api/delete-account', {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${appAuthToken}` }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            if (data.success) {
                if (window.dbAPI) {
                    await window.dbAPI.clearAllData();
                    window.dbAPI.closeDatabase();
                }
                
                localStorage.removeItem('auth_token');
                localStorage.removeItem('auth_user');
                localStorage.removeItem('weeklyTemplate');
                
                appAuthToken = null;
                appCurrentUser = null;
                
                document.getElementById('deleteAccountModal').style.display = 'none';
                document.getElementById('appScreen').style.display = 'none';
                document.getElementById('loginScreen').style.display = 'block';
                
                alert('✅ Your account has been permanently deleted');
            } else {
                errorEl.textContent = data.message || 'Account deletion failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error: ' + error.message;
        }
    }

    // ==================== LOGOUT ====================
    function logout() {
        if (confirm('Logout?')) {
            if (window.dbAPI) {
                window.dbAPI.closeDatabase();
            }
            
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            localStorage.removeItem('weeklyTemplate');
            
            appAuthToken = null;
            appCurrentUser = null;
            
            document.getElementById('appScreen').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'block';
        }
    }

    // ==================== HOME PAGE FUNCTIONS ====================
    async function checkIn() {
        if (!appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await fetchOrCreateEntry(today);
        
        if (entry && entry.check_in && !entry.check_out) {
            if (!confirm('You are already checked in. Check in again?')) {
                return;
            }
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const localDateTime = getLocalTimeForDB(now);
        
        document.getElementById('checkInDisplay').textContent = timeStr;
        
        entry.check_in = localDateTime;
        entry.check_out = null;
        entry.is_manual_adjustment = false; // Ensure not marked as adjustment
        
        await saveAndSync(entry);
    }

    async function checkOut() {
        if (!appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await fetchOrCreateEntry(today);
        
        if (!entry || !entry.check_in) {
            alert('You must check in first before checking out');
            return;
        }
        
        if (entry.check_out) {
            if (!confirm('Already checked out. Override?')) {
                return;
            }
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const localDateTime = getLocalTimeForDB(now);
        
        const checkInTime = entry.check_in;
        if (checkInTime && localDateTime <= checkInTime) {
            alert('Check out time must be after check in time');
            return;
        }
        
        document.getElementById('checkOutDisplay').textContent = timeStr;
        
        entry.check_out = localDateTime;
        entry.is_manual_adjustment = false; // Ensure not marked as adjustment
        
        await saveAndSync(entry);
    }

    async function markLeave(type) {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await fetchOrCreateEntry(today);
        
        if (entry && (entry.check_in || entry.check_out)) {
            if (!confirm('This day already has check-in/out. Override with leave?')) {
                return;
            }
        }
        
        entry[`${type}_used`] = (entry[`${type}_used`] || 0) + 1;
        entry.check_in = null;
        entry.check_out = null;
        entry.is_off_day = false;
        entry.is_holiday = false;
        entry.is_manual_adjustment = false;
        
        await saveAndSync(entry);
        
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
        
        await loadBalances();
    }

    async function markOffDay() {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await fetchOrCreateEntry(today);
        
        entry.is_off_day = true;
        entry.is_holiday = false;
        entry.check_in = null;
        entry.check_out = null;
        entry.al_used = 0;
        entry.sl_used = 0;
        entry.cl_used = 0;
        entry.cpl_used = 0;
        entry.is_manual_adjustment = false;
        
        await saveAndSync(entry);
        
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
    }

    async function loadTodayEntry() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        try {
            const today = new Date().toISOString().split('T')[0];
            const entry = await fetchOrCreateEntry(today);
            
            if (entry) {
                const isLeaveDay = (entry.al_used && entry.al_used > 0) || 
                                   (entry.sl_used && entry.sl_used > 0) || 
                                   (entry.cl_used && entry.cl_used > 0) || 
                                   (entry.cpl_used && entry.cpl_used > 0);
                
                if (isLeaveDay || entry.is_off_day || entry.is_manual_adjustment) {
                    document.getElementById('checkInDisplay').textContent = '--:--';
                    document.getElementById('checkOutDisplay').textContent = '--:--';
                } else {
                    if (entry.check_in) {
                        const timePart = entry.check_in.split('T')[1] || '00:00:00';
                        const [hours, minutes] = timePart.split(':');
                        const hour12 = parseInt(hours) % 12 || 12;
                        const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
                        const timeStr = `${hour12}:${minutes}`;
                        document.getElementById('checkInDisplay').textContent = timeStr;
                        appCurrentCheckIn = entry.check_in;
                    }
                    
                    if (entry.check_out) {
                        const timePart = entry.check_out.split('T')[1] || '00:00:00';
                        const [hours, minutes] = timePart.split(':');
                        const hour12 = parseInt(hours) % 12 || 12;
                        const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
                        const timeStr = `${hour12}:${minutes}`;
                        document.getElementById('checkOutDisplay').textContent = timeStr;
                        appCurrentCheckOut = entry.check_out;
                    }
                }
            }
        } catch (error) {
            window.addDebugLog(`Error loading today entry: ${error.message}`, 'error');
        }
    }

    // ==================== TOGGLE ENTRY OPTIONS ====================
    function toggleEntryOptions() {
        const options = document.getElementById('entryOptions');
        const toggle = document.getElementById('entryToggle');
        
        if (options.style.display === 'none' || !options.style.display) {
            options.style.display = 'flex';
            if (toggle) toggle.textContent = '▲';
        } else {
            options.style.display = 'none';
            if (toggle) toggle.textContent = '▼';
        }
    }

    // ==================== BULK MANUAL ENTRY ====================
    function showBulkManualEntry() {
        document.getElementById('bulkManualModal').style.display = 'flex';
        document.getElementById('bulkFromDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('bulkToDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('bulkCheckIn').value = '';
        document.getElementById('bulkCheckOut').value = '';
        document.getElementById('bulkType').value = 'work';
        document.getElementById('bulkProgress').style.display = 'none';
    }

    function closeBulkManualEntry() {
        document.getElementById('bulkManualModal').style.display = 'none';
    }

    async function saveBulkManualEntry() {
        const fromDate = document.getElementById('bulkFromDate').value;
        const toDate = document.getElementById('bulkToDate').value;
        const checkIn = document.getElementById('bulkCheckIn').value;
        const checkOut = document.getElementById('bulkCheckOut').value;
        const type = document.getElementById('bulkType').value;
        
        if (!fromDate || !toDate) {
            alert('Please select both FROM and TO dates');
            return;
        }
        
        if (fromDate > toDate) {
            alert('FROM date must be before TO date');
            return;
        }
        
        const start = new Date(fromDate);
        const end = new Date(toDate);
        const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        
        if (daysDiff > 30) {
            if (!confirm(`This will apply to ${daysDiff} days. Continue?`)) {
                return;
            }
        }
        
        const progressDiv = document.getElementById('bulkProgress');
        progressDiv.style.display = 'block';
        progressDiv.innerHTML = 'Processing...';
        
        let successCount = 0;
        let errorCount = 0;
        let count = 0;
        
        // SEQUENTIAL PROCESSING - NO SYNC INSIDE LOOP
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            count++;
            progressDiv.innerHTML = `Processing ${count}/${daysDiff}...`;
            
            try {
                let entry = await fetchOrCreateEntry(dateStr);
                
                // Reset all fields first
                entry.al_used = 0;
                entry.sl_used = 0;
                entry.cl_used = 0;
                entry.cpl_used = 0;
                entry.is_off_day = false;
                entry.is_holiday = false;
                entry.is_manual_adjustment = false;
                
                if (type === 'work') {
                    if (checkIn) {
                        entry.check_in = `${dateStr}T${checkIn}:00`;
                    } else {
                        entry.check_in = null;
                    }
                    if (checkOut) {
                        entry.check_out = `${dateStr}T${checkOut}:00`;
                    } else {
                        entry.check_out = null;
                    }
                    
                    if (entry.check_in && entry.check_out && entry.check_out <= entry.check_in) {
                        errorCount++;
                        continue;
                    }
                    
                } else if (type === 'holiday') {
                    entry.is_holiday = true;
                    entry.check_in = checkIn ? `${dateStr}T${checkIn}:00` : null;
                    entry.check_out = checkOut ? `${dateStr}T${checkOut}:00` : null;
                    
                } else if (type === 'off') {
                    entry.is_off_day = true;
                    entry.check_in = null;
                    entry.check_out = null;
                    
                } else {
                    // Leave types (annual, sick, casual, cpl) - these are USAGE, not adjustments
                    entry[`${type}_used`] = (entry[`${type}_used`] || 0) + 1;
                    entry.check_in = null;
                    entry.check_out = null;
                }
                
                // Save to local DB only (skip sync)
                await saveAndSync(entry, true);
                successCount++;
                
            } catch (error) {
                window.addDebugLog(`Error processing ${dateStr}: ${error.message}`, 'error');
                errorCount++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        progressDiv.innerHTML = `Complete! Success: ${successCount}, Failed: ${errorCount}`;
        
        // SINGLE BATCH SYNC AFTER ALL SAVES
        if (navigator.onLine && successCount > 0) {
            progressDiv.innerHTML = 'Syncing to cloud...';
            await batchSyncToCloud();
        }
        
        alert(`✅ Bulk entry complete\nSuccess: ${successCount} days\nFailed: ${errorCount} days`);
        
        closeBulkManualEntry();
        
        await loadBalances();
        await loadExpiryInfo();
    }

    // ==================== MANUAL ENTRY (Single) ====================
    function showManualEntry() {
        document.getElementById('manualEntryModal').style.display = 'flex';
        document.getElementById('manualDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('manualIn').value = '';
        document.getElementById('manualOut').value = '';
    }

    function closeManualEntry() {
        document.getElementById('manualEntryModal').style.display = 'none';
    }

    async function saveManualEntry() {
        const date = document.getElementById('manualDate').value;
        const checkIn = document.getElementById('manualIn').value;
        const checkOut = document.getElementById('manualOut').value;
        const type = document.getElementById('manualType').value;
        
        if (!date) {
            alert('Please select date');
            return;
        }
        
        let entry = await fetchOrCreateEntry(date);
        
        // Reset fields based on type
        entry.al_used = 0;
        entry.sl_used = 0;
        entry.cl_used = 0;
        entry.cpl_used = 0;
        entry.is_off_day = false;
        entry.is_holiday = false;
        entry.is_manual_adjustment = false;
        
        if (type === 'work') {
            if (checkIn) {
                entry.check_in = `${date}T${checkIn}:00`;
            } else {
                entry.check_in = null;
            }
            if (checkOut) {
                entry.check_out = `${date}T${checkOut}:00`;
            } else {
                entry.check_out = null;
            }
            
            if (entry.check_in && entry.check_out && entry.check_out <= entry.check_in) {
                alert('Check out time must be after check in time');
                return;
            }
            
        } else if (type === 'holiday') {
            entry.is_holiday = true;
            entry.check_in = checkIn ? `${date}T${checkIn}:00` : null;
            entry.check_out = checkOut ? `${date}T${checkOut}:00` : null;
            
        } else if (type === 'off') {
            entry.is_off_day = true;
            entry.check_in = null;
            entry.check_out = null;
        } else {
            // Leave types (annual, sick, casual, cpl) - these are USAGE
            entry[`${type}_used`] = 1;
            entry.check_in = null;
            entry.check_out = null;
        }
        
        await saveAndSync(entry);
        
        closeManualEntry();
        
        if (date === new Date().toISOString().split('T')[0]) {
            await loadTodayEntry();
        }
        await loadBalances();
        await loadExpiryInfo();
    }

    // ==================== SCHEDULE FUNCTIONS ====================
    function loadTemplateToUI() {
        const monBase = document.getElementById('monBase');
        const monOT = document.getElementById('monOT');
        const monCPL = document.getElementById('monCPL');
        const tueBase = document.getElementById('tueBase');
        const tueOT = document.getElementById('tueOT');
        const tueCPL = document.getElementById('tueCPL');
        const wedBase = document.getElementById('wedBase');
        const wedOT = document.getElementById('wedOT');
        const wedCPL = document.getElementById('wedCPL');
        const thuBase = document.getElementById('thuBase');
        const thuOT = document.getElementById('thuOT');
        const thuCPL = document.getElementById('thuCPL');
        const friBase = document.getElementById('friBase');
        const friOT = document.getElementById('friOT');
        const friCPL = document.getElementById('friCPL');
        const satBase = document.getElementById('satBase');
        const satOT = document.getElementById('satOT');
        const satCPL = document.getElementById('satCPL');
        const sunOddBase = document.getElementById('sunOddBase');
        const sunOddOT = document.getElementById('sunOddOT');
        const sunOddCPL = document.getElementById('sunOddCPL');
        const sunEvenBase = document.getElementById('sunEvenBase');
        const sunEvenOT = document.getElementById('sunEvenOT');
        const sunEvenCPL = document.getElementById('sunEvenCPL');
        
        if (monBase) monBase.value = weeklyTemplate.monday.base;
        if (monOT) monOT.value = weeklyTemplate.monday.maxOT;
        if (monCPL) monCPL.value = weeklyTemplate.monday.cpl;
        
        if (tueBase) tueBase.value = weeklyTemplate.tuesday.base;
        if (tueOT) tueOT.value = weeklyTemplate.tuesday.maxOT;
        if (tueCPL) tueCPL.value = weeklyTemplate.tuesday.cpl;
        
        if (wedBase) wedBase.value = weeklyTemplate.wednesday.base;
        if (wedOT) wedOT.value = weeklyTemplate.wednesday.maxOT;
        if (wedCPL) wedCPL.value = weeklyTemplate.wednesday.cpl;
        
        if (thuBase) thuBase.value = weeklyTemplate.thursday.base;
        if (thuOT) thuOT.value = weeklyTemplate.thursday.maxOT;
        if (thuCPL) thuCPL.value = weeklyTemplate.thursday.cpl;
        
        if (friBase) friBase.value = weeklyTemplate.friday.base;
        if (friOT) friOT.value = weeklyTemplate.friday.maxOT;
        if (friCPL) friCPL.value = weeklyTemplate.friday.cpl;
        
        if (satBase) satBase.value = weeklyTemplate.saturday.base;
        if (satOT) satOT.value = weeklyTemplate.saturday.maxOT;
        if (satCPL) satCPL.value = weeklyTemplate.saturday.cpl;
        
        if (sunOddBase) sunOddBase.value = weeklyTemplate.sundayOdd.base;
        if (sunOddOT) sunOddOT.value = weeklyTemplate.sundayOdd.maxOT;
        if (sunOddCPL) sunOddCPL.value = weeklyTemplate.sundayOdd.cpl;
        
        if (sunEvenBase) sunEvenBase.value = weeklyTemplate.sundayEven.base;
        if (sunEvenOT) sunEvenOT.value = weeklyTemplate.sundayEven.maxOT;
        if (sunEvenCPL) sunEvenCPL.value = weeklyTemplate.sundayEven.cpl;
    }

    function saveTemplate() {
        const monBase = document.getElementById('monBase');
        const monOT = document.getElementById('monOT');
        const monCPL = document.getElementById('monCPL');
        const tueBase = document.getElementById('tueBase');
        const tueOT = document.getElementById('tueOT');
        const tueCPL = document.getElementById('tueCPL');
        const wedBase = document.getElementById('wedBase');
        const wedOT = document.getElementById('wedOT');
        const wedCPL = document.getElementById('wedCPL');
        const thuBase = document.getElementById('thuBase');
        const thuOT = document.getElementById('thuOT');
        const thuCPL = document.getElementById('thuCPL');
        const friBase = document.getElementById('friBase');
        const friOT = document.getElementById('friOT');
        const friCPL = document.getElementById('friCPL');
        const satBase = document.getElementById('satBase');
        const satOT = document.getElementById('satOT');
        const satCPL = document.getElementById('satCPL');
        const sunOddBase = document.getElementById('sunOddBase');
        const sunOddOT = document.getElementById('sunOddOT');
        const sunOddCPL = document.getElementById('sunOddCPL');
        const sunEvenBase = document.getElementById('sunEvenBase');
        const sunEvenOT = document.getElementById('sunEvenOT');
        const sunEvenCPL = document.getElementById('sunEvenCPL');
        
        weeklyTemplate = {
            monday: { 
                base: monBase ? parseFloat(monBase.value) || 0 : 8, 
                maxOT: monOT ? parseFloat(monOT.value) || 0 : 1, 
                cpl: monCPL ? parseFloat(monCPL.value) || 0 : 0 
            },
            tuesday: { 
                base: tueBase ? parseFloat(tueBase.value) || 0 : 8, 
                maxOT: tueOT ? parseFloat(tueOT.value) || 0 : 1, 
                cpl: tueCPL ? parseFloat(tueCPL.value) || 0 : 0 
            },
            wednesday: { 
                base: wedBase ? parseFloat(wedBase.value) || 0 : 8, 
                maxOT: wedOT ? parseFloat(wedOT.value) || 0 : 1, 
                cpl: wedCPL ? parseFloat(wedCPL.value) || 0 : 0 
            },
            thursday: { 
                base: thuBase ? parseFloat(thuBase.value) || 0 : 8, 
                maxOT: thuOT ? parseFloat(thuOT.value) || 0 : 1, 
                cpl: thuCPL ? parseFloat(thuCPL.value) || 0 : 0 
            },
            friday: { 
                base: friBase ? parseFloat(friBase.value) || 0 : 8, 
                maxOT: friOT ? parseFloat(friOT.value) || 0 : 1, 
                cpl: friCPL ? parseFloat(friCPL.value) || 0 : 0 
            },
            saturday: { 
                base: satBase ? parseFloat(satBase.value) || 0 : 6, 
                maxOT: satOT ? parseFloat(satOT.value) || 0 : 0.5, 
                cpl: satCPL ? parseFloat(satCPL.value) || 0 : 0 
            },
            sundayOdd: { 
                base: sunOddBase ? parseFloat(sunOddBase.value) || 0 : 8, 
                maxOT: sunOddOT ? parseFloat(sunOddOT.value) || 0 : 0, 
                cpl: sunOddCPL ? parseFloat(sunOddCPL.value) || 0 : 1.0,
                isHoliday: true
            },
            sundayEven: { 
                base: sunEvenBase ? parseFloat(sunEvenBase.value) || 0 : 6, 
                maxOT: sunEvenOT ? parseFloat(sunEvenOT.value) || 0 : 0, 
                cpl: sunEvenCPL ? parseFloat(sunEvenCPL.value) || 0 : 0.5,
                isHoliday: true
            }
        };
        
        localStorage.setItem('weeklyTemplate', JSON.stringify(weeklyTemplate));
        alert('Template saved');
    }

    // ==================== SINGLE DATE OVERRIDE ====================
    function showSingleDateOverride() {
        document.getElementById('singleDateModal').style.display = 'flex';
        document.getElementById('singleDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('singleBase').value = '';
        document.getElementById('singleOT').value = '';
        document.getElementById('singleCPL').value = '';
    }

    function closeSingleDateOverride() {
        document.getElementById('singleDateModal').style.display = 'none';
    }

    async function saveSingleDateOverride() {
        const date = document.getElementById('singleDate').value;
        const type = document.getElementById('singleType').value;
        const baseInput = document.getElementById('singleBase').value;
        const otInput = document.getElementById('singleOT').value;
        const cplInput = document.getElementById('singleCPL').value;
        
        if (!date) {
            alert('Please select date');
            return;
        }
        
        let entry = await fetchOrCreateEntry(date);
        
        // Reset adjustment flag
        entry.is_manual_adjustment = false;
        
        if (type === 'work') {
            entry.is_holiday = false;
            entry.is_off_day = false;
            if (baseInput !== '') entry.base_hours_rule = parseFloat(baseInput);
            if (otInput !== '') entry.ot_cap_rule = parseFloat(otInput);
            if (cplInput !== '') entry.cpl_grant_rule = parseFloat(cplInput);
        } 
        else if (type === 'holiday') {
            entry.is_holiday = true;
            entry.is_off_day = false;
            if (cplInput !== '') {
                entry.cpl_grant_rule = parseFloat(cplInput);
            }
            if (baseInput !== '') entry.base_hours_rule = parseFloat(baseInput);
            if (otInput !== '') entry.ot_cap_rule = parseFloat(otInput);
        } 
        else if (type === 'off') {
            entry.is_off_day = true;
            entry.is_holiday = false;
            entry.base_hours_rule = null;
            entry.ot_cap_rule = null;
            entry.cpl_grant_rule = null;
        }
        
        await saveAndSync(entry);
        
        closeSingleDateOverride();
        alert(`✅ Override saved for ${date}`);
        
        if (date === new Date().toISOString().split('T')[0]) {
            await loadTodayEntry();
        }
        
        await loadBalances();
        await loadExpiryInfo();
    }

    // ==================== APPLY TEMPLATE TO RANGE ====================
    async function applyTemplateToRange() {
        const from = document.getElementById('rangeFrom').value;
        const to = document.getElementById('rangeTo').value;
        
        if (!from || !to) {
            alert('Select date range');
            return;
        }
        
        const applyBtn = document.querySelector('.apply-range-btn');
        const originalText = applyBtn ? applyBtn.textContent : 'Apply to Range';
        if (applyBtn) {
            applyBtn.textContent = '⏳ Applying...';
            applyBtn.disabled = true;
        }
        
        try {
            const start = new Date(from);
            const end = new Date(to);
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            
            if (daysDiff > 30) {
                if (!confirm(`This will apply template to ${daysDiff} days. Continue?`)) {
                    if (applyBtn) {
                        applyBtn.textContent = originalText;
                        applyBtn.disabled = false;
                    }
                    return;
                }
            }
            
            let count = 0;
            
            // SEQUENTIAL PROCESSING - NO SYNC INSIDE LOOP
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                
                let entry = await fetchOrCreateEntry(dateStr);
                
                // Ensure not marked as adjustment
                entry.is_manual_adjustment = false;
                
                const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                
                if (dayName === 'sunday') {
                    const sundayWeek = getSundayWeekNumber(d);
                    
                    if (sundayWeek % 2 === 1) {
                        entry.base_hours_rule = weeklyTemplate.sundayOdd.base;
                        entry.ot_cap_rule = weeklyTemplate.sundayOdd.maxOT;
                        entry.cpl_grant_rule = weeklyTemplate.sundayOdd.cpl;
                    } else {
                        entry.base_hours_rule = weeklyTemplate.sundayEven.base;
                        entry.ot_cap_rule = weeklyTemplate.sundayEven.maxOT;
                        entry.cpl_grant_rule = weeklyTemplate.sundayEven.cpl;
                    }
                    // is_holiday will be set by dynamic detector
                } else {
                    entry.base_hours_rule = weeklyTemplate[dayName]?.base !== undefined ? weeklyTemplate[dayName].base : 8;
                    entry.ot_cap_rule = weeklyTemplate[dayName]?.maxOT !== undefined ? weeklyTemplate[dayName].maxOT : 1;
                    entry.cpl_grant_rule = weeklyTemplate[dayName]?.cpl !== undefined ? weeklyTemplate[dayName].cpl : 0;
                }
                
                // Save to local DB only (skip sync)
                await saveAndSync(entry, true);
                count++;
                
                if (applyBtn) {
                    applyBtn.textContent = `⏳ ${count}/${daysDiff}`;
                }
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            // SINGLE BATCH SYNC AFTER ALL SAVES
            if (navigator.onLine && count > 0) {
                await batchSyncToCloud();
            }
            
            alert(`✅ Template applied to ${count} days`);
            
            await loadBalances();
            await loadExpiryInfo();
            
        } catch (error) {
            window.addDebugLog(`Error applying template: ${error.message}`, 'error');
            alert('Error applying template: ' + error.message);
        } finally {
            if (applyBtn) {
                applyBtn.textContent = originalText;
                applyBtn.disabled = false;
            }
        }
    }

    // ==================== HISTORY FUNCTIONS ====================
    let currentHistoryFilter = 'all';
    let currentHistoryFrom = '';
    let currentHistoryTo = '';

    async function filterHistory(type) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
        currentHistoryFilter = type;
        await loadHistory();
    }

    async function applyDateRange() {
        const from = document.getElementById('historyFrom').value;
        const to = document.getElementById('historyTo').value;
        
        if (!from || !to) {
            alert('Please select both FROM and TO dates');
            return;
        }
        
        currentHistoryFrom = from;
        currentHistoryTo = to;
        
        await loadHistory();
    }

    async function loadHistory() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        let entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
        const uniqueEntries = {};
        entries.forEach(entry => {
            if (!uniqueEntries[entry.date] || new Date(entry.updated_at) > new Date(uniqueEntries[entry.date].updated_at)) {
                uniqueEntries[entry.date] = entry;
            }
        });
        
        entries = Object.values(uniqueEntries);
        
        const now = new Date();
        entries = entries.filter(e => new Date(e.date) <= now);
        
        if (currentHistoryFrom && currentHistoryTo) {
            entries = entries.filter(e => e.date >= currentHistoryFrom && e.date <= currentHistoryTo);
        }
        
        switch(currentHistoryFilter) {
            case 'ot':
                entries = entries.filter(e => e.final_ot_hours && e.final_ot_hours > 0);
                break;
            case 'cpl':
                entries = entries.filter(e => e.cpl_earned && e.cpl_earned > 0);
                break;
            case 'leave':
                entries = entries.filter(e => e.al_used > 0 || e.sl_used > 0 || e.cl_used > 0 || e.cpl_used > 0);
                break;
        }
        
        displayHistory(entries);
    }

    function displayHistory(entries) {
        const list = document.getElementById('historyList');
        list.innerHTML = '';
        
        if (entries.length === 0) {
            list.innerHTML = '<div class="history-item">No entries found</div>';
            return;
        }
        
        let totalOT = 0;
        let totalCPL = 0;
        let totalLeave = 0;
        
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        entries.forEach(e => {
            if (e.final_ot_hours && e.final_ot_hours > 0) totalOT += e.final_ot_hours;
            if (e.cpl_earned && e.cpl_earned > 0) totalCPL += e.cpl_earned;
            if (e.al_used) totalLeave += e.al_used;
            if (e.sl_used) totalLeave += e.sl_used;
            if (e.cl_used) totalLeave += e.cl_used;
            if (e.cpl_used) totalLeave += e.cpl_used;
        });
        
        const totalsDiv = document.createElement('div');
        totalsDiv.className = 'history-totals';
        totalsDiv.innerHTML = `
            <div class="totals-row">
                <span class="total-label">Total OT:</span>
                <span class="total-value">${totalOT.toFixed(1)} hours</span>
            </div>
            <div class="totals-row">
                <span class="total-label">Total CPL:</span>
                <span class="total-value">${totalCPL.toFixed(2)} days</span>
            </div>
            <div class="totals-row">
                <span class="total-label">Total Leave:</span>
                <span class="total-value">${totalLeave.toFixed(2)} days</span>
            </div>
        `;
        list.appendChild(totalsDiv);
        
        entries.slice(0, 50).forEach(e => {
            const date = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
            let desc = '';
            let details = [];
            
            if (e.is_off_day) {
                desc = 'OFF DAY';
            } else if (e.is_holiday && e.cpl_earned && e.cpl_earned > 0) {
                desc = 'HOLIDAY (Worked)';
                if (e.cpl_earned) details.push(`CPL: ${e.cpl_earned}`);
            } else if (e.is_holiday) {
                desc = 'HOLIDAY (No work)';
            } else if (e.al_used > 0) {
                desc = `ANNUAL LEAVE (${e.al_used} day)`;
            } else if (e.sl_used > 0) {
                desc = `SICK LEAVE (${e.sl_used} day)`;
            } else if (e.cl_used > 0) {
                desc = `CASUAL LEAVE (${e.cl_used} day)`;
            } else if (e.cpl_used > 0) {
                desc = `CPL USED (${e.cpl_used} day)`;
            } else if (e.check_in && e.check_out) {
                const inTimePart = e.check_in.split('T')[1] || '00:00:00';
                const [inHours, inMinutes] = inTimePart.split(':');
                const outTimePart = e.check_out.split('T')[1] || '00:00:00';
                const [outHours, outMinutes] = outTimePart.split(':');
                
                desc = `${inHours}:${inMinutes} - ${outHours}:${outMinutes}`;
                if (e.base_hours_rule !== null) details.push(`${e.base_hours_rule}h Base`);
                if (e.final_ot_hours && e.final_ot_hours > 0) details.push(`OT: ${e.final_ot_hours}h`);
            }
            
            if (e.al_accrued > 0) {
                details.push(`AL Accrued: +${e.al_accrued}`);
            }
            
            if (e.al_adjustment && e.al_adjustment !== 0) {
                details.push(`AL Adjustment: ${e.al_adjustment > 0 ? '+' : ''}${e.al_adjustment}`);
            }
            
            if (e.cpl_adjustment && e.cpl_adjustment !== 0) {
                details.push(`CPL Adjustment: ${e.cpl_adjustment > 0 ? '+' : ''}${e.cpl_adjustment}`);
            }
            
            if (details.length > 0) {
                desc += ` | ${details.join(' | ')}`;
            }
            
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <div class="history-item-date">${date}:</div>
                <div class="history-item-desc">${desc}</div>
            `;
            list.appendChild(item);
        });
    }

    // ==================== BALANCE ADJUSTMENT FUNCTIONS - ULTRA DEBUG ====================
    function showBalanceAdjustmentModal() {
        window.addDebugLog('showBalanceAdjustmentModal() called', 'info');
        document.getElementById('balanceAdjustmentModal').style.display = 'flex';
        document.getElementById('adjustmentDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('adjustmentAL').value = '0';
        document.getElementById('adjustmentSL').value = '0';
        document.getElementById('adjustmentCL').value = '0';
        document.getElementById('adjustmentCPL').value = '0';
        document.getElementById('adjustmentOT').value = '0';
        document.getElementById('adjustmentNote').value = '';
        window.addDebugLog('Balance adjustment modal shown', 'info');
    }

    function closeBalanceAdjustmentModal() {
        window.addDebugLog('closeBalanceAdjustmentModal() called', 'info');
        document.getElementById('balanceAdjustmentModal').style.display = 'none';
    }

    async function saveBalanceAdjustment() {
        window.addDebugLog('========== SAVE BALANCE ADJUSTMENT STARTED ==========', 'warning');
        
        const date = document.getElementById('adjustmentDate').value;
        const al = parseFloat(document.getElementById('adjustmentAL').value) || 0;
        const sl = parseFloat(document.getElementById('adjustmentSL').value) || 0;
        const cl = parseFloat(document.getElementById('adjustmentCL').value) || 0;
        const cpl = parseFloat(document.getElementById('adjustmentCPL').value) || 0;
        const ot = parseFloat(document.getElementById('adjustmentOT').value) || 0;
        const note = document.getElementById('adjustmentNote').value;
        
        window.addDebugLog(`Input values - date: ${date}, al: ${al}, cpl: ${cpl}, ot: ${ot}, note: ${note}`, 'info');
        
        if (!date) {
            window.addDebugLog('ERROR: No date selected', 'error');
            alert('Please select a date');
            return;
        }
        
        if (al === 0 && sl === 0 && cl === 0 && cpl === 0 && ot === 0) {
            window.addDebugLog('ERROR: No adjustment values entered', 'error');
            alert('Please enter at least one adjustment value');
            return;
        }
        
        window.addDebugLog('STEP 1: Calling fetchOrCreateEntry to get entry', 'info');
        let entry = await fetchOrCreateEntry(date);
        
        window.addDebugLog(`STEP 2: Entry received from fetchOrCreateEntry: ${JSON.stringify({
            date: entry.date,
            al_adjustment: entry.al_adjustment,
            cpl_adjustment: entry.cpl_adjustment,
            ot_adjustment: entry.ot_adjustment,
            is_manual_adjustment: entry.is_manual_adjustment,
            adjustment_note: entry.adjustment_note
        })}`, 'info');
        
        window.addDebugLog('STEP 3: Setting is_manual_adjustment = true', 'info');
        entry.is_manual_adjustment = true;
        
        window.addDebugLog('STEP 4: Clearing work-related fields', 'info');
        entry.check_in = null;
        entry.check_out = null;
        entry.base_hours_rule = null;
        entry.ot_cap_rule = null;
        entry.cpl_grant_rule = null;
        entry.final_ot_hours = null;
        entry.cpl_earned = null;
        entry.is_off_day = false;
        entry.is_holiday = false;
        
        window.addDebugLog('STEP 5: Ensuring adjustment fields exist', 'info');
        if (entry.al_adjustment === undefined) {
            window.addDebugLog('al_adjustment was undefined, setting to 0', 'warning');
            entry.al_adjustment = 0;
        }
        if (entry.cpl_adjustment === undefined) {
            window.addDebugLog('cpl_adjustment was undefined, setting to 0', 'warning');
            entry.cpl_adjustment = 0;
        }
        if (entry.ot_adjustment === undefined) {
            window.addDebugLog('ot_adjustment was undefined, setting to 0', 'warning');
            entry.ot_adjustment = 0;
        }
        
        window.addDebugLog(`STEP 6: Current adjustment values before update - AL: ${entry.al_adjustment}, CPL: ${entry.cpl_adjustment}, OT: ${entry.ot_adjustment}`, 'info');
        
        // Store adjustments in separate columns
        if (al !== 0) {
            const oldValue = entry.al_adjustment;
            entry.al_adjustment = (entry.al_adjustment || 0) + al;
            window.addDebugLog(`STEP 6a: AL adjustment changed from ${oldValue} to ${entry.al_adjustment} (added ${al})`, 'success');
            
            // Only set expiry if this is a positive addition
            if (entry.al_adjustment > 0 && !entry.al_expiry_date) {
                entry.al_expiry_date = calculateALExpiry(date);
                window.addDebugLog(`STEP 6b: Set al_expiry_date to: ${entry.al_expiry_date}`, 'info');
            }
        }
        
        if (cpl !== 0) {
            const oldValue = entry.cpl_adjustment;
            entry.cpl_adjustment = (entry.cpl_adjustment || 0) + cpl;
            window.addDebugLog(`STEP 6c: CPL adjustment changed from ${oldValue} to ${entry.cpl_adjustment} (added ${cpl})`, 'success');
            
            if (entry.cpl_adjustment > 0 && !entry.cpl_expiry_date) {
                entry.cpl_expiry_date = calculateCPLExpiry(date);
                window.addDebugLog(`STEP 6d: Set cpl_expiry_date to: ${entry.cpl_expiry_date}`, 'info');
            }
        }
        
        if (ot !== 0) {
            const oldValue = entry.ot_adjustment;
            entry.ot_adjustment = (entry.ot_adjustment || 0) + ot;
            window.addDebugLog(`STEP 6e: OT adjustment changed from ${oldValue} to ${entry.ot_adjustment} (added ${ot})`, 'success');
        }
        
        entry.adjustment_note = note;
        window.addDebugLog(`STEP 7: Set adjustment_note to: ${note}`, 'info');
        
        window.addDebugLog(`STEP 8: Final entry object before save: ${JSON.stringify({
            date: entry.date,
            al_adjustment: entry.al_adjustment,
            cpl_adjustment: entry.cpl_adjustment,
            ot_adjustment: entry.ot_adjustment,
            al_expiry_date: entry.al_expiry_date,
            cpl_expiry_date: entry.cpl_expiry_date,
            adjustment_note: entry.adjustment_note,
            is_manual_adjustment: entry.is_manual_adjustment,
            check_in: entry.check_in,
            check_out: entry.check_out,
            base_hours_rule: entry.base_hours_rule,
            ot_cap_rule: entry.ot_cap_rule,
            cpl_grant_rule: entry.cpl_grant_rule
        })}`, 'success');
        
        window.addDebugLog('STEP 9: Calling window.dbAPI.saveEntry directly', 'info');
        if (window.dbAPI) {
            try {
                await window.dbAPI.saveEntry(entry);
                window.addDebugLog('STEP 9a: Direct save to local DB successful', 'success');
            } catch (saveError) {
                window.addDebugLog(`STEP 9b: Direct save failed: ${saveError.message}`, 'error');
            }
        } else {
            window.addDebugLog('STEP 9c: window.dbAPI not available', 'error');
        }
        
        window.addDebugLog('STEP 10: Calling saveAndSync', 'info');
        await saveAndSync(entry);
        
        window.addDebugLog('STEP 11: Closing modal', 'info');
        closeBalanceAdjustmentModal();
        
        window.addDebugLog('STEP 12: Refreshing balances and adjustments', 'info');
        await loadBalances();
        await loadAdjustments();
        await loadExpiryInfo();
        
        window.addDebugLog('========== SAVE BALANCE ADJUSTMENT COMPLETE ==========', 'success');
        alert('✅ Balance adjustment saved');
    }

    async function loadAdjustments() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        window.addDebugLog('loadAdjustments() called', 'info');
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        window.addDebugLog(`Found ${entries.length} total entries in database`, 'info');
        
        // Log all entries to see what's in the database
        entries.forEach(e => {
            window.addDebugLog(`Entry ${e.date}: AL_adj=${e.al_adjustment}, CPL_adj=${e.cpl_adjustment}, OT_adj=${e.ot_adjustment}, note=${e.adjustment_note}`, 'info');
        });
        
        // Show adjustments (entries with adjustment_note OR non-zero adjustment columns)
        const adjustments = entries.filter(e => 
            (e.adjustment_note && e.adjustment_note.length > 0) ||
            (e.al_adjustment && e.al_adjustment !== 0) ||
            (e.cpl_adjustment && e.cpl_adjustment !== 0) ||
            (e.ot_adjustment && e.ot_adjustment !== 0)
        );
        
        window.addDebugLog(`Filtered to ${adjustments.length} adjustment entries`, 'info');
        
        const list = document.getElementById('adjustmentList');
        if (!list) return;
        
        list.innerHTML = '<h4>Manual Adjustments</h4>';
        
        if (adjustments.length === 0) {
            list.innerHTML += '<p class="no-adjustments">No manual adjustments found</p>';
            window.addDebugLog('No adjustments to display', 'warning');
            return;
        }
        
        adjustments.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        adjustments.slice(0, 20).forEach(adj => {
            window.addDebugLog(`Displaying adjustment: ${adj.date} - AL:${adj.al_adjustment}, CPL:${adj.cpl_adjustment}, OT:${adj.ot_adjustment}`, 'success');
            
            const item = document.createElement('div');
            item.className = 'adjustment-item';
            
            let details = [];
            if (adj.al_adjustment && adj.al_adjustment !== 0) details.push(`AL: ${adj.al_adjustment > 0 ? '+' : ''}${adj.al_adjustment.toFixed(2)}`);
            if (adj.cpl_adjustment && adj.cpl_adjustment !== 0) details.push(`CPL: ${adj.cpl_adjustment > 0 ? '+' : ''}${adj.cpl_adjustment.toFixed(2)}`);
            if (adj.ot_adjustment && adj.ot_adjustment !== 0) details.push(`OT: ${adj.ot_adjustment > 0 ? '+' : ''}${adj.ot_adjustment.toFixed(1)}`);
            
            item.innerHTML = `
                <div class="adjustment-date">${adj.date}</div>
                <div class="adjustment-details">${details.join(' | ')}</div>
                ${adj.adjustment_note ? `<div class="adjustment-note">📝 ${adj.adjustment_note}</div>` : ''}
            `;
            
            list.appendChild(item);
        });
    }

    // ==================== SETUP COLLAPSIBLE SECTIONS ====================
    function setupCollapsibleSections() {
        document.querySelectorAll('.collapsible-header').forEach(header => {
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);
            
            newHeader.addEventListener('click', function(e) {
                e.preventDefault();
                this.classList.toggle('active');
                const content = this.nextElementSibling;
                
                if (content.style.maxHeight) {
                    content.style.maxHeight = null;
                    content.classList.remove('active');
                } else {
                    content.style.maxHeight = content.scrollHeight + 20 + "px";
                    content.classList.add('active');
                }
            });
        });
    }

    // ==================== INITIAL BALANCE SETUP ====================
    function showInitialBalanceModal() {
        document.getElementById('initialBalanceModal').style.display = 'flex';
        const today = new Date();
        const janFirst = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
        document.getElementById('initialDate').value = janFirst;
        
        document.getElementById('initialAL').value = document.getElementById('alBalance').textContent;
        document.getElementById('initialSL').value = document.getElementById('slBalance').textContent;
        document.getElementById('initialCL').value = document.getElementById('clBalance').textContent;
        document.getElementById('initialCPL').value = document.getElementById('cplBalance').textContent;
        document.getElementById('initialOT').value = document.getElementById('otMonth').textContent;
    }

    function closeInitialBalanceModal() {
        document.getElementById('initialBalanceModal').style.display = 'none';
    }

    async function saveInitialBalances() {
        const date = document.getElementById('initialDate').value;
        const al = parseFloat(document.getElementById('initialAL').value) || 0;
        const sl = parseFloat(document.getElementById('initialSL').value) || 0;
        const cl = parseFloat(document.getElementById('initialCL').value) || 0;
        const cpl = parseFloat(document.getElementById('initialCPL').value) || 0;
        const ot = parseFloat(document.getElementById('initialOT').value) || 0;
        
        if (!date) {
            alert('Please select a start date');
            return;
        }
        
        let entry = await fetchOrCreateEntry(date);
        
        window.addDebugLog(`Before initial setup - Entry: ${JSON.stringify(entry)}`, 'info');
        
        // ===== ABSOLUTE ADJUSTMENT SHIELD =====
        entry.is_manual_adjustment = true;
        
        // Clear work fields to NULL
        entry.check_in = null;
        entry.check_out = null;
        entry.base_hours_rule = null;
        entry.ot_cap_rule = null;
        entry.cpl_grant_rule = null;
        entry.final_ot_hours = null;
        entry.cpl_earned = null;
        entry.is_off_day = false;
        entry.is_holiday = false;
        
        // IMPORTANT: Initialize adjustment fields
        if (entry.al_adjustment === undefined) entry.al_adjustment = 0;
        if (entry.cpl_adjustment === undefined) entry.cpl_adjustment = 0;
        if (entry.ot_adjustment === undefined) entry.ot_adjustment = 0;
        
        // Store as adjustments
        if (al !== 0) {
            entry.al_adjustment = (entry.al_adjustment || 0) + al;
            window.addDebugLog(`Set initial al_adjustment to: ${entry.al_adjustment}`, 'success');
            if (al > 0) {
                entry.al_expiry_date = calculateALExpiry(date);
            }
        }
        
        if (cpl !== 0) {
            entry.cpl_adjustment = (entry.cpl_adjustment || 0) + cpl;
            window.addDebugLog(`Set initial cpl_adjustment to: ${entry.cpl_adjustment}`, 'success');
            if (cpl > 0) {
                entry.cpl_expiry_date = calculateCPLExpiry(date);
            }
        }
        
        if (ot !== 0) {
            entry.ot_adjustment = (entry.ot_adjustment || 0) + ot;
            window.addDebugLog(`Set initial ot_adjustment to: ${entry.ot_adjustment}`, 'success');
        }
        
        entry.adjustment_note = 'Initial balance setup';
        
        window.addDebugLog(`After initial setup - Entry: ${JSON.stringify(entry)}`, 'success');
        
        await saveAndSync(entry);
        
        closeInitialBalanceModal();
        alert('✅ Initial balances set successfully');
        
        await loadBalances();
        await loadAdjustments();
        await loadExpiryInfo();
    }

    // ==================== RESET ALL DATA ====================
    async function resetAllData() {
        if (!confirm('⚠️ WARNING: This will DELETE ALL your data from both local device AND cloud. Are you absolutely sure?')) {
            return;
        }
        
        const confirmText = prompt('Type "RESET" to confirm permanent deletion of all your data:');
        if (confirmText !== 'RESET') {
            alert('Reset cancelled');
            return;
        }
        
        try {
            if (appAuthToken && navigator.onLine) {
                const response = await fetch('/api/reset-data', {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${appAuthToken}` }
                });
                
                if (!response.ok) throw new Error('Failed to delete cloud data');
                
                const data = await response.json();
                if (!data.success) throw new Error(data.message || 'Failed to delete cloud data');
            }
            
            if (window.dbAPI) {
                await window.dbAPI.clearAllData();
            }
            
            localStorage.removeItem('weeklyTemplate');
            
            weeklyTemplate = {
                monday: { base: 8, maxOT: 1, cpl: 0 },
                tuesday: { base: 8, maxOT: 1, cpl: 0 },
                wednesday: { base: 8, maxOT: 1, cpl: 0 },
                thursday: { base: 8, maxOT: 1, cpl: 0 },
                friday: { base: 8, maxOT: 1, cpl: 0 },
                saturday: { base: 6, maxOT: 0.5, cpl: 0 },
                sundayOdd: { base: 8, maxOT: 0, cpl: 1.0, isHoliday: true },
                sundayEven: { base: 6, maxOT: 0, cpl: 0.5, isHoliday: true }
            };
            
            document.getElementById('checkInDisplay').textContent = '--:--';
            document.getElementById('checkOutDisplay').textContent = '--:--';
            
            const today = new Date().toISOString().split('T')[0];
            await fetchOrCreateEntry(today);
            
            await loadBalances();
            loadTemplateToUI();
            await loadAdjustments();
            await loadExpiryInfo();
            
            alert('✅ All data has been reset (local + cloud)');
            
        } catch (error) {
            window.addDebugLog(`Reset error: ${error.message}`, 'error');
            alert('Error resetting data: ' + error.message);
        }
    }

    // ==================== TAB NAVIGATION ====================
    function switchTab(tabName) {
        window.addDebugLog(`Switching to tab: ${tabName}`, 'info');
        
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        
        event.target.classList.add('active');
        document.getElementById(tabName + 'Tab').classList.add('active');
        
        if (tabName === 'history') {
            currentHistoryFilter = 'all';
            currentHistoryFrom = '';
            currentHistoryTo = '';
            const historyFrom = document.getElementById('historyFrom');
            const historyTo = document.getElementById('historyTo');
            if (historyFrom) historyFrom.value = '';
            if (historyTo) historyTo.value = '';
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            const firstFilter = document.querySelector('.filter-btn');
            if (firstFilter) firstFilter.classList.add('active');
            loadHistory();
        }
        if (tabName === 'balance') {
            loadBalances();
            loadExpiryInfo();
        }
        if (tabName === 'schedule') loadTemplateToUI();
        if (tabName === 'settings') {
            const settingsUserEmail = document.getElementById('settingsUserEmail');
            const settingsUserID = document.getElementById('settingsUserID');
            if (settingsUserEmail) settingsUserEmail.textContent = appCurrentUser?.email || '';
            if (settingsUserID) settingsUserID.textContent = appCurrentUser?.id || '';
            loadAdjustments();
            loadExpiryInfo();
            setTimeout(setupCollapsibleSections, 500);
        }
    }

    // ==================== EXPOSE GLOBALLY ====================
    window.login = login;
    window.register = register;
    window.logout = logout;
    window.showRegister = showRegister;
    window.showLogin = showLogin;
    window.checkAuth = checkAuth;
    window.switchTab = switchTab;
    window.checkIn = checkIn;
    window.checkOut = checkOut;
    window.markLeave = markLeave;
    window.markOffDay = markOffDay;
    window.toggleEntryOptions = toggleEntryOptions;
    window.showManualEntry = showManualEntry;
    window.closeManualEntry = closeManualEntry;
    window.saveManualEntry = saveManualEntry;
    window.showBulkManualEntry = showBulkManualEntry;
    window.closeBulkManualEntry = closeBulkManualEntry;
    window.saveBulkManualEntry = saveBulkManualEntry;
    window.syncToCloud = syncToCloud;
    window.syncFromCloud = syncFromCloud;
    window.saveTemplate = saveTemplate;
    window.applyTemplateToRange = applyTemplateToRange;
    window.filterHistory = filterHistory;
    window.applyDateRange = applyDateRange;
    window.recalculateAll = recalculateAll;
    window.showSingleDateOverride = showSingleDateOverride;
    window.closeSingleDateOverride = closeSingleDateOverride;
    window.saveSingleDateOverride = saveSingleDateOverride;
    window.showBalanceAdjustmentModal = showBalanceAdjustmentModal;
    window.closeBalanceAdjustmentModal = closeBalanceAdjustmentModal;
    window.saveBalanceAdjustment = saveBalanceAdjustment;
    window.showInitialBalanceModal = showInitialBalanceModal;
    window.closeInitialBalanceModal = closeInitialBalanceModal;
    window.saveInitialBalances = saveInitialBalances;
    window.resetAllData = resetAllData;
    window.showChangePasswordModal = showChangePasswordModal;
    window.closeChangePasswordModal = closeChangePasswordModal;
    window.changePassword = changePassword;
    window.showDeleteAccountModal = showDeleteAccountModal;
    window.closeDeleteAccountModal = closeDeleteAccountModal;
    window.deleteAccount = deleteAccount;

    window.addDebugLog('app.js: Loading complete - ULTRA DEBUG VERSION', 'success');
})();