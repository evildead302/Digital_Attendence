// ==================== APP.JS - STRICT OVERRIDER LOGIC ====================
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

    // ==================== STRICT OVERRIDER - THE SOURCE OF TRUTH ====================
    async function strictOverrider(entry) {
        if (!entry || !entry.date) return entry;
        
        window.addDebugLog(`STRICT OVERRIDER: Processing ${entry.date}`, 'info');
        
        // Make a copy to work with
        const updatedEntry = { ...entry };
        
        // Get day name for rule determination
        const entryDate = new Date(updatedEntry.date + 'T12:00:00');
        const dayName = entryDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        // ===== STEP 1: Apply template rules if base hours not set =====
        // This ensures we have base_hours_rule and ot_cap_rule defined
        if (updatedEntry.base_hours_rule === undefined || updatedEntry.base_hours_rule === null) {
            if (dayName === 'sunday') {
                const sundayWeek = getSundayWeekNumber(entryDate);
                if (sundayWeek % 2 === 1) { // Odd Sundays
                    updatedEntry.base_hours_rule = weeklyTemplate.sundayOdd.base;
                    updatedEntry.ot_cap_rule = weeklyTemplate.sundayOdd.maxOT;
                    updatedEntry.cpl_grant_rule = weeklyTemplate.sundayOdd.cpl;
                    updatedEntry.is_holiday = true;
                } else { // Even Sundays
                    updatedEntry.base_hours_rule = weeklyTemplate.sundayEven.base;
                    updatedEntry.ot_cap_rule = weeklyTemplate.sundayEven.maxOT;
                    updatedEntry.cpl_grant_rule = weeklyTemplate.sundayEven.cpl;
                    updatedEntry.is_holiday = true;
                }
            } else {
                updatedEntry.base_hours_rule = weeklyTemplate[dayName]?.base !== undefined ? weeklyTemplate[dayName].base : 8;
                updatedEntry.ot_cap_rule = weeklyTemplate[dayName]?.maxOT !== undefined ? weeklyTemplate[dayName].maxOT : 1;
                updatedEntry.cpl_grant_rule = weeklyTemplate[dayName]?.cpl !== undefined ? weeklyTemplate[dayName].cpl : 0;
                updatedEntry.is_holiday = false;
            }
        }
        
        // Ensure values are numbers (preserve 0)
        updatedEntry.base_hours_rule = updatedEntry.base_hours_rule !== null ? Number(updatedEntry.base_hours_rule) : 8;
        updatedEntry.ot_cap_rule = updatedEntry.ot_cap_rule !== null ? Number(updatedEntry.ot_cap_rule) : 1;
        updatedEntry.cpl_grant_rule = updatedEntry.cpl_grant_rule !== null ? Number(updatedEntry.cpl_grant_rule) : 0;
        
        // ===== STEP 2: Check if it's a leave or off day =====
        const isLeaveDay = (updatedEntry.al_used && updatedEntry.al_used > 0) || 
                           (updatedEntry.sl_used && updatedEntry.sl_used > 0) || 
                           (updatedEntry.cl_used && updatedEntry.cl_used > 0) || 
                           (updatedEntry.cpl_used && updatedEntry.cpl_used > 0);
        
        if (updatedEntry.is_off_day || isLeaveDay) {
            window.addDebugLog('Off day or leave day - zeroing OT and CPL', 'info');
            updatedEntry.final_ot_hours = 0;
            updatedEntry.cpl_earned = 0;
            updatedEntry.cpl_expiry_date = null;
            updatedEntry.sync_status = 'pending';
            return updatedEntry;
        }
        
        // ===== STEP 3: STRICT OVERRIDE - Calculate hours worked =====
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
        
        // ===== STEP 4: STRICT OVERRIDE - Calculate OT =====
        // Formula: Math.min(Math.max(hoursWorked - base_hours_rule, 0), ot_cap_rule)
        const rawOT = Math.max(0, hoursWorked - updatedEntry.base_hours_rule);
        updatedEntry.final_ot_hours = Math.min(rawOT, updatedEntry.ot_cap_rule);
        
        // ===== STEP 5: STRICT OVERRIDE - Calculate CPL =====
        // Rule: If hoursWorked >= base_hours_rule, force set to cpl_grant_rule, else 0
        if (updatedEntry.is_holiday && hoursWorked >= updatedEntry.base_hours_rule) {
            updatedEntry.cpl_earned = updatedEntry.cpl_grant_rule;
            // Always update expiry date when CPL is earned
            updatedEntry.cpl_expiry_date = calculateCPLExpiry(updatedEntry.date);
            window.addDebugLog(`CPL earned: ${updatedEntry.cpl_grant_rule} (expires: ${updatedEntry.cpl_expiry_date})`, 'success');
        } else {
            updatedEntry.cpl_earned = 0;
            updatedEntry.cpl_expiry_date = null;
        }
        
        // ===== STEP 6: AL Accrual - Only add if this is the last day of month =====
        const lastDayOfMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
        if (entryDate.getDate() === lastDayOfMonth) {
            // Check if AL already exists for this month
            if (!updatedEntry.al_accrued) {
                updatedEntry.al_accrued = 1.833;
                updatedEntry.al_expiry_date = calculateALExpiry(updatedEntry.date);
                window.addDebugLog(`Added AL accrual: 1.833 for month end`, 'info');
            }
        }
        
        updatedEntry.sync_status = 'pending';
        
        window.addDebugLog(`STRICT OVERRIDER complete - Hours: ${hoursWorked.toFixed(2)}, Base: ${updatedEntry.base_hours_rule}, OT: ${updatedEntry.final_ot_hours}, CPL: ${updatedEntry.cpl_earned}`, 'success');
        
        return updatedEntry;
    }

    // ==================== ADVANCED FIFO MATCHMAKER (E2 vs U2) ====================
    function calculateFIFOBalance(entries, targetDate = new Date()) {
        window.addDebugLog('Running FIFO Matchmaker...', 'info');
        
        targetDate.setHours(23, 59, 59, 999);
        
        // Sort all entries by date
        const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // COLLECT ALL PACKETS
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
            
            // AL Packets (adjustments) - stored in al_adjustment column
            if (entry.al_adjustment && entry.al_adjustment !== 0) {
                const packet = {
                    date: entry.date,
                    amount: entry.al_adjustment,
                    expiryDate: entry.al_expiry_date ? new Date(entry.al_expiry_date) : null,
                    type: 'adjustment',
                    entryId: entry.date + '-adj'
                };
                alPackets.push(packet);
                
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
        const cappedYears = {};
        const years = Object.keys(alByYear).map(Number).sort();
        
        for (let i = 0; i < years.length; i++) {
            const year = years[i];
            // If this year's total > 22, cap it at 22 for carry forward
            if (alByYear[year] > 22) {
                cappedYears[year] = 22;
                window.addDebugLog(`Year ${year} AL capped from ${alByYear[year].toFixed(2)} to 22 days`, 'info');
            } else {
                cappedYears[year] = alByYear[year];
            }
        }
        
        // FIFO MATCHMAKING - E2 vs U2
        alPackets.sort((a, b) => new Date(a.date) - new Date(b.date));
        cplPackets.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Process AL usage with FIFO
        const unspentAL = [];
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
                    // Use entire packet
                    remainingToUse -= available;
                    alPacketsCopy[index] = { ...packet, amount: 0 };
                } else {
                    // Partially use packet
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
        
        // Sum remaining AL packets that are not expired
        for (const packet of alPacketsCopy) {
            if (packet.amount > 0) {
                const expiryDate = packet.expiryDate;
                if (!expiryDate || expiryDate > targetDate) {
                    alBalance += packet.amount;
                }
            }
        }
        
        // Apply yearly caps to balance
        const balanceByYear = {};
        for (const packet of alPacketsCopy) {
            if (packet.amount > 0) {
                const year = new Date(packet.date).getFullYear();
                if (!balanceByYear[year]) balanceByYear[year] = 0;
                balanceByYear[year] += packet.amount;
            }
        }
        
        // Recalculate balance with caps
        alBalance = 0;
        for (const [year, amount] of Object.entries(balanceByYear)) {
            const yearNum = parseInt(year);
            const cap = cappedYears[yearNum] !== undefined ? cappedYears[yearNum] : amount;
            alBalance += Math.min(amount, cap);
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

    // ==================== SMART FETCH ====================
    async function fetchOrCreateEntry(date) {
        if (!appCurrentUser || !window.dbAPI) return null;
        
        window.addDebugLog(`Fetching entry for ${date}`, 'info');
        
        // Check Local Storage
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        let entry = entries.find(e => e.date === date);
        
        if (entry) {
            window.addDebugLog(`Found entry locally for ${date}`, 'success');
            return entry;
        }
        
        // If offline, wait for online
        if (!navigator.onLine) {
            window.addDebugLog(`Offline - waiting for network to fetch ${date}`, 'warning');
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
        return await fetchFromCloud(date);
    }

    async function fetchFromCloud(date) {
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
                    
                    // Run through strict overrider
                    const overriddenEntry = await strictOverrider(cloudEntry);
                    await window.dbAPI.saveEntry(overriddenEntry);
                    return overriddenEntry;
                }
            }
        } catch (error) {
            window.addDebugLog(`Error fetching from cloud: ${error.message}`, 'error');
        }
        
        // Create new entry
        const newEntry = {
            date: date,
            user_id: appCurrentUser.id,
            check_in: null,
            check_out: null,
            base_hours_rule: 8,
            ot_cap_rule: 1,
            cpl_grant_rule: 0,
            final_ot_hours: 0,
            cpl_earned: 0,
            al_used: 0,
            sl_used: 0,
            cl_used: 0,
            cpl_used: 0,
            is_off_day: false,
            is_holiday: false,
            al_accrued: 0,
            al_adjustment: 0,
            al_expiry_date: null,
            cpl_expiry_date: null,
            adjustment_note: '',
            sync_status: 'pending'
        };
        
        // Run through strict overrider
        const overriddenEntry = await strictOverrider(newEntry);
        return overriddenEntry;
    }

    // ==================== SAVE WITH STRICT OVERRIDE ====================
    async function saveAndSync(entry, skipSync = false) {
        if (!entry || !entry.date || !appCurrentUser) return;
        
        // ALWAYS run through strict overrider before saving
        const overriddenEntry = await strictOverrider(entry);
        
        // Save to local DB
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(overriddenEntry);
            window.addDebugLog(`Saved overridden entry for ${entry.date}`, 'success');
        }
        
        // Only trigger sync if not skipped and online
        if (!skipSync && navigator.onLine) {
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
                
                const cleanEntry = {
                    date: entry.date,
                    check_in: entry.check_in || null,
                    check_out: entry.check_out || null,
                    base_hours_rule: entry.base_hours_rule !== null ? entry.base_hours_rule : 8,
                    ot_cap_rule: entry.ot_cap_rule !== null ? entry.ot_cap_rule : 1,
                    cpl_grant_rule: entry.cpl_grant_rule !== null ? entry.cpl_grant_rule : 0,
                    final_ot_hours: entry.final_ot_hours || 0,
                    cpl_earned: entry.cpl_earned || 0,
                    al_used: entry.al_used || 0,
                    sl_used: entry.sl_used || 0,
                    cl_used: entry.cl_used || 0,
                    cpl_used: entry.cpl_used || 0,
                    is_off_day: entry.is_off_day || false,
                    is_holiday: entry.is_holiday || false,
                    al_accrued: entry.al_accrued || 0,
                    al_adjustment: entry.al_adjustment || 0,
                    al_expiry_date: entry.al_expiry_date || null,
                    cpl_expiry_date: entry.cpl_expiry_date || null,
                    adjustment_note: entry.adjustment_note || ''
                };
                
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
                    
                    // Convert string numbers
                    entry.al_used = entry.al_used !== null ? parseFloat(entry.al_used) : 0;
                    entry.sl_used = entry.sl_used !== null ? parseFloat(entry.sl_used) : 0;
                    entry.cl_used = entry.cl_used !== null ? parseFloat(entry.cl_used) : 0;
                    entry.cpl_used = entry.cpl_used !== null ? parseFloat(entry.cpl_used) : 0;
                    entry.base_hours_rule = entry.base_hours_rule !== null ? parseFloat(entry.base_hours_rule) : 8;
                    entry.ot_cap_rule = entry.ot_cap_rule !== null ? parseFloat(entry.ot_cap_rule) : 1;
                    entry.cpl_grant_rule = entry.cpl_grant_rule !== null ? parseFloat(entry.cpl_grant_rule) : 0;
                    entry.final_ot_hours = entry.final_ot_hours !== null ? parseFloat(entry.final_ot_hours) : 0;
                    entry.cpl_earned = entry.cpl_earned !== null ? parseFloat(entry.cpl_earned) : 0;
                    entry.al_accrued = entry.al_accrued !== null ? parseFloat(entry.al_accrued) : 0;
                    entry.al_adjustment = entry.al_adjustment !== null ? parseFloat(entry.al_adjustment) : 0;
                    
                    entry.is_off_day = entry.is_off_day === true || entry.is_off_day === 'true';
                    entry.is_holiday = entry.is_holiday === true || entry.is_holiday === 'true';
                    
                    entry.user_id = appCurrentUser.id;
                    entry.sync_status = 'synced';
                    
                    // Run through strict overrider
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
            
            // OT totals
            if (entry.final_ot_hours) {
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
                        daysUntil: daysUntil
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

    // ==================== RECALCULATE ALL - HARD RESET ====================
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
            
            // STRICT OVERRIDE on every entry
            for (const entry of entries) {
                count++;
                progressDiv.innerHTML = `Processing ${count}/${total}<br>Entry: ${entry.date}`;
                
                // Run through strict overrider
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
            const fifoResult = calculateFIFOBalance(allEntries, today);
            
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
                
                if (isLeaveDay || entry.is_off_day) {
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
                
                entry.al_used = 0;
                entry.sl_used = 0;
                entry.cl_used = 0;
                entry.cpl_used = 0;
                entry.is_off_day = false;
                entry.is_holiday = false;
                
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
        
        entry.al_used = 0;
        entry.sl_used = 0;
        entry.cl_used = 0;
        entry.cpl_used = 0;
        entry.is_off_day = false;
        entry.is_holiday = false;
        
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
            entry.base_hours_rule = 0;
            entry.ot_cap_rule = 0;
            entry.cpl_grant_rule = 0;
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
                
                const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                
                if (dayName === 'sunday') {
                    const sundayWeek = getSundayWeekNumber(d);
                    entry.is_holiday = true;
                    
                    if (sundayWeek % 2 === 1) {
                        entry.base_hours_rule = weeklyTemplate.sundayOdd.base;
                        entry.ot_cap_rule = weeklyTemplate.sundayOdd.maxOT;
                        entry.cpl_grant_rule = weeklyTemplate.sundayOdd.cpl;
                    } else {
                        entry.base_hours_rule = weeklyTemplate.sundayEven.base;
                        entry.ot_cap_rule = weeklyTemplate.sundayEven.maxOT;
                        entry.cpl_grant_rule = weeklyTemplate.sundayEven.cpl;
                    }
                } else {
                    entry.base_hours_rule = weeklyTemplate[dayName]?.base !== undefined ? weeklyTemplate[dayName].base : 8;
                    entry.ot_cap_rule = weeklyTemplate[dayName]?.maxOT !== undefined ? weeklyTemplate[dayName].maxOT : 1;
                    entry.cpl_grant_rule = weeklyTemplate[dayName]?.cpl !== undefined ? weeklyTemplate[dayName].cpl : 0;
                    entry.is_holiday = false;
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
                entries = entries.filter(e => e.final_ot_hours > 0);
                break;
            case 'cpl':
                entries = entries.filter(e => e.cpl_earned > 0);
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
            if (e.final_ot_hours) totalOT += e.final_ot_hours;
            if (e.cpl_earned) totalCPL += e.cpl_earned;
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
            } else if (e.is_holiday && e.cpl_earned > 0) {
                desc = 'HOLIDAY (Worked)';
                if (e.cpl_earned > 0) details.push(`CPL: ${e.cpl_earned}`);
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
                if (e.base_hours_rule !== undefined) details.push(`${e.base_hours_rule}h Base`);
                if (e.final_ot_hours > 0) details.push(`OT: ${e.final_ot_hours}h`);
            }
            
            if (e.al_accrued > 0) {
                details.push(`AL Accrued: +${e.al_accrued}`);
            }
            
            if (e.al_adjustment && e.al_adjustment !== 0) {
                details.push(`AL Adjustment: ${e.al_adjustment > 0 ? '+' : ''}${e.al_adjustment}`);
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

    // ==================== BALANCE ADJUSTMENT FUNCTIONS ====================
    function showBalanceAdjustmentModal() {
        document.getElementById('balanceAdjustmentModal').style.display = 'flex';
        document.getElementById('adjustmentDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('adjustmentAL').value = '0';
        document.getElementById('adjustmentSL').value = '0';
        document.getElementById('adjustmentCL').value = '0';
        document.getElementById('adjustmentCPL').value = '0';
        document.getElementById('adjustmentOT').value = '0';
        document.getElementById('adjustmentNote').value = '';
    }

    function closeBalanceAdjustmentModal() {
        document.getElementById('balanceAdjustmentModal').style.display = 'none';
    }

    async function saveBalanceAdjustment() {
        const date = document.getElementById('adjustmentDate').value;
        const al = parseFloat(document.getElementById('adjustmentAL').value) || 0;
        const sl = parseFloat(document.getElementById('adjustmentSL').value) || 0;
        const cl = parseFloat(document.getElementById('adjustmentCL').value) || 0;
        const cpl = parseFloat(document.getElementById('adjustmentCPL').value) || 0;
        const ot = parseFloat(document.getElementById('adjustmentOT').value) || 0;
        const note = document.getElementById('adjustmentNote').value;
        
        if (!date) {
            alert('Please select a date');
            return;
        }
        
        if (al === 0 && sl === 0 && cl === 0 && cpl === 0 && ot === 0) {
            alert('Please enter at least one adjustment value');
            return;
        }
        
        let entry = await fetchOrCreateEntry(date);
        
        // Store adjustments in separate columns - leave work fields blank
        if (al !== 0) {
            entry.al_adjustment = (entry.al_adjustment || 0) + al;
            // Only set expiry if this is a positive addition
            if (entry.al_adjustment > 0 && !entry.al_expiry_date) {
                entry.al_expiry_date = calculateALExpiry(date);
            }
        }
        
        if (cpl !== 0) {
            entry.cpl_adjustment = (entry.cpl_adjustment || 0) + cpl;
            if (entry.cpl_adjustment > 0 && !entry.cpl_expiry_date) {
                entry.cpl_expiry_date = calculateCPLExpiry(date);
            }
        }
        
        if (ot !== 0) {
            entry.ot_adjustment = (entry.ot_adjustment || 0) + ot;
        }
        
        // DO NOT modify work-related fields for adjustments
        // Keep base_hours_rule, ot_cap_rule, check_in, check_out as they were
        
        entry.adjustment_note = note;
        
        await saveAndSync(entry);
        
        closeBalanceAdjustmentModal();
        alert('✅ Balance adjustment saved');
        
        await loadBalances();
        await loadAdjustments();
        await loadExpiryInfo();
    }

    async function loadAdjustments() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
        // Show adjustments (entries with adjustment_note)
        const adjustments = entries.filter(e => 
            e.adjustment_note && e.adjustment_note.length > 0
        );
        
        const list = document.getElementById('adjustmentList');
        if (!list) return;
        
        list.innerHTML = '<h4>Manual Adjustments</h4>';
        
        if (adjustments.length === 0) {
            list.innerHTML += '<p class="no-adjustments">No manual adjustments found</p>';
            return;
        }
        
        adjustments.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        adjustments.slice(0, 20).forEach(adj => {
            const item = document.createElement('div');
            item.className = 'adjustment-item';
            
            let details = [];
            if (adj.al_adjustment && adj.al_adjustment !== 0) details.push(`AL: ${adj.al_adjustment > 0 ? '+' : ''}${adj.al_adjustment.toFixed(2)}`);
            if (adj.cpl_adjustment && adj.cpl_adjustment !== 0) details.push(`CPL: ${adj.cpl_adjustment > 0 ? '+' : ''}${adj.cpl_adjustment.toFixed(2)}`);
            if (adj.ot_adjustment && adj.ot_adjustment !== 0) details.push(`OT: ${adj.ot_adjustment > 0 ? '+' : ''}${adj.ot_adjustment.toFixed(1)}`);
            
            item.innerHTML = `
                <div class="adjustment-date">${adj.date}</div>
                <div class="adjustment-details">${details.join(' | ')}</div>
                <div class="adjustment-note">📝 ${adj.adjustment_note}</div>
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
        
        // Store as adjustments
        entry.al_adjustment = (entry.al_adjustment || 0) + al;
        if (al > 0) {
            entry.al_expiry_date = calculateALExpiry(date);
        }
        
        entry.cpl_adjustment = (entry.cpl_adjustment || 0) + cpl;
        if (cpl > 0) {
            entry.cpl_expiry_date = calculateCPLExpiry(date);
        }
        
        entry.ot_adjustment = (entry.ot_adjustment || 0) + ot;
        entry.adjustment_note = 'Initial balance setup';
        
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

    window.addDebugLog('app.js: Loading complete - STRICT OVERRIDER ACTIVE', 'success');
})();
