// ==================== APP.JS - ULTRA DEBUG VERSION WITH OTP, DYNAMIC USER SETTINGS & ALARMS ====================
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

    // OTP Variables
    let otpTimerInterval = null;
    let currentOTPData = null;
    let verificationPurpose = null; // 'register' or 'reset'
    let pendingEmail = null;
    
    // Alarm Variables
    let currentAlarmSettings = {
        enabled: false,
        checkinTime: '09:00',
        tzOffset: null
    };
    
    // ==================== USER SETTINGS ====================
    let userSettings = {
        has_ot: true,
        has_cpl: true,
        limit_annual: 22,
        limit_casual: 10,
        limit_sick: 10
    };

    // Template data - ALL SUNDAYS ARE HOLIDAYS with alternating CPL
    // UPDATED: Saturday base 8 hours with CPL 1, Friday base 8.5 hours
    let weeklyTemplate = {
        monday: { base: 8, maxOT: 1, cpl: 0 },
        tuesday: { base: 8, maxOT: 1, cpl: 0 },
        wednesday: { base: 8, maxOT: 1, cpl: 0 },
        thursday: { base: 8, maxOT: 1, cpl: 0 },
        friday: { base: 8.5, maxOT: 1, cpl: 0 },
        saturday: { base: 8, maxOT: 1, cpl: 1 },
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
        
        // Setup alarm time input change listener
        const alarmTimeInput = document.getElementById('checkinAlarmTime');
        if (alarmTimeInput) {
            alarmTimeInput.addEventListener('change', function() {
                updateTargetTimeDisplay();
            });
        }
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
    
    // ==================== USER PERMISSION OVERRIDES ====================
    function applyUserPermissionOverrides(entry) {
        if (!entry) return entry;
        
        // Create a copy to avoid modifying original
        const result = { ...entry };
        
        // If OT is disabled for this user, force OT values to 0/null
        if (!userSettings.has_ot) {
            result.final_ot_hours = null;
            result.ot_cap_rule = 0;
            result.ot_adjustment = 0;
            window.addDebugLog(`OT disabled for user - overriding OT values to 0 for ${entry.date}`, 'info');
        }
        
        // If CPL is disabled for this user, force CPL values to 0/null
        if (!userSettings.has_cpl) {
            result.cpl_earned = null;
            result.cpl_grant_rule = 0;
            result.cpl_adjustment = 0;
            result.cpl_used = 0;
            result.cpl_expiry_date = null;
            window.addDebugLog(`CPL disabled for user - overriding CPL values to 0 for ${entry.date}`, 'info');
        }
        
        return result;
    }

    // ==================== STRICT OVERRIDER WITH ABSOLUTE ADJUSTMENT SHIELD ====================
    async function strictOverrider(entry, isActiveEdit = false) {
        if (!entry || !entry.date) return entry;
        
        // ===== APPLY USER PERMISSION OVERRIDES FIRST =====
        entry = applyUserPermissionOverrides(entry);
        
        window.addDebugLog(`STRICT OVERRIDER: Processing ${entry.date} (isActiveEdit: ${isActiveEdit})`, 'info');
        window.addDebugLog(`Entry flags - is_manual_adjustment: ${entry.is_manual_adjustment}, al_adjustment: ${entry.al_adjustment}, sl_adjustment: ${entry.sl_adjustment}, cl_adjustment: ${entry.cl_adjustment}, cpl_adjustment: ${entry.cpl_adjustment}, ot_adjustment: ${entry.ot_adjustment}`, 'info');
        window.addDebugLog(`Leave usage - al_used: ${entry.al_used}, sl_used: ${entry.sl_used}, cl_used: ${entry.cl_used}, cpl_used: ${entry.cpl_used}`, 'info');
        window.addDebugLog(`Expiry dates - AL: ${entry.al_expiry_date}, CPL: ${entry.cpl_expiry_date}`, 'info');
        
        // ===== ABSOLUTE ADJUSTMENT SHIELD =====
        // If this is a manual adjustment, ensure expiry dates are set for positive adjustments
        if (entry.is_manual_adjustment === true) {
            window.addDebugLog(`🔒 ADJUSTMENT SHIELD ACTIVE - checking expiry dates for adjustments`, 'success');
            
            // ENSURE CPL ADJUSTMENT HAS EXPIRY DATE
            const cplAdjustment = parseFloat(entry.cpl_adjustment) || 0;
            if (cplAdjustment > 0 && !entry.cpl_expiry_date && userSettings.has_cpl) {
                entry.cpl_expiry_date = calculateCPLExpiry(entry.date);
                window.addDebugLog(`⚠️ FIXED: Added missing CPL expiry date: ${entry.cpl_expiry_date}`, 'warning');
            }
            
            // ENSURE AL ADJUSTMENT HAS EXPIRY DATE
            const alAdjustment = parseFloat(entry.al_adjustment) || 0;
            if (alAdjustment > 0 && !entry.al_expiry_date) {
                entry.al_expiry_date = calculateALExpiry(entry.date);
                window.addDebugLog(`⚠️ FIXED: Added missing AL expiry date: ${entry.al_expiry_date}`, 'warning');
            }
            
            window.addDebugLog(`🔒 ADJUSTMENT SHIELD ACTIVE - returning entry with values: AL=${entry.al_adjustment}, SL=${entry.sl_adjustment}, CL=${entry.cl_adjustment}, CPL=${entry.cpl_adjustment}, OT=${entry.ot_adjustment}, CPL Expiry=${entry.cpl_expiry_date}`, 'success');
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
        
        if (floorOT > 0 && userSettings.has_ot) {
            updatedEntry.final_ot_hours = floorOT;
        } else {
            updatedEntry.final_ot_hours = null;
        }
        
        // ===== STEP 6: DIRECT CPL & EXPIRY LOGIC =====
        // Rule: If cpl_grant_rule > 0 AND hoursWorked >= base_hours_rule, then cpl_earned = cpl_grant_rule
        if (userSettings.has_cpl && updatedEntry.cpl_grant_rule > 0 && hoursWorked >= updatedEntry.base_hours_rule) {
            updatedEntry.cpl_earned = updatedEntry.cpl_grant_rule;
            updatedEntry.cpl_expiry_date = calculateCPLExpiry(updatedEntry.date);
            window.addDebugLog(`CPL earned: ${updatedEntry.cpl_grant_rule} (expires: ${updatedEntry.cpl_expiry_date})`, 'success');
        } else {
            updatedEntry.cpl_earned = null;
            updatedEntry.cpl_expiry_date = null;
        }
        
        // ===== STEP 7: ENSURE CPL ADJUSTMENTS HAVE EXPIRY DATES =====
        const cplAdjustment = parseFloat(updatedEntry.cpl_adjustment) || 0;
        if (userSettings.has_cpl && cplAdjustment > 0 && !updatedEntry.cpl_expiry_date) {
            updatedEntry.cpl_expiry_date = calculateCPLExpiry(updatedEntry.date);
            window.addDebugLog(`⚠️ FIXED CPL ADJUSTMENT: Added missing expiry date: ${updatedEntry.cpl_expiry_date}`, 'warning');
        }
        
        // ===== STEP 8: ENSURE AL ADJUSTMENTS HAVE EXPIRY DATES =====
        const alAdjustment = parseFloat(updatedEntry.al_adjustment) || 0;
        if (alAdjustment > 0 && !updatedEntry.al_expiry_date) {
            updatedEntry.al_expiry_date = calculateALExpiry(updatedEntry.date);
            window.addDebugLog(`⚠️ FIXED AL ADJUSTMENT: Added missing expiry date: ${updatedEntry.al_expiry_date}`, 'warning');
        }
        
        // ===== STEP 9: AL Accrual - ONLY ON ACTIVE EDIT =====
        // ONLY recalculate if this is an active edit AND it's month-end
        const lastDayOfMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
        const isMonthEnd = (entryDate.getDate() === lastDayOfMonth);
        
        if (isActiveEdit && isMonthEnd) {
            // Calculate monthly accrual based on annual limit divided by 12
            const monthlyAccrual = userSettings.limit_annual / 12;
            updatedEntry.al_accrued = parseFloat(monthlyAccrual.toFixed(3));
            updatedEntry.al_expiry_date = calculateALExpiry(updatedEntry.date);
            window.addDebugLog(`🔄 ACTIVE EDIT: AL accrual recalculated for ${updatedEntry.date}: ${updatedEntry.al_accrued} (${userSettings.limit_annual}/12) (expires: ${updatedEntry.al_expiry_date})`, 'info');
        } else if (!isActiveEdit && isMonthEnd) {
            // This is a passive load/sync - preserve existing AL accrual value
            window.addDebugLog(`⏸️ PASSIVE LOAD: Preserving existing AL accrual for ${updatedEntry.date} (was ${updatedEntry.al_accrued || 0})`, 'info');
            // Keep existing values, don't recalculate
        } else if (isActiveEdit && !isMonthEnd) {
            // Active edit but not month-end - ensure no accrual is set
            if (updatedEntry.al_accrued && updatedEntry.al_accrued > 0) {
                window.addDebugLog(`Clearing AL accrual for non-month-end entry ${updatedEntry.date} (was ${updatedEntry.al_accrued})`, 'info');
                updatedEntry.al_accrued = 0;
                updatedEntry.al_expiry_date = null;
            }
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
            window.addDebugLog(`Local entry data - al_adjustment:${entry.al_adjustment}, sl_adjustment:${entry.sl_adjustment}, cl_adjustment:${entry.cl_adjustment}, cpl_adjustment:${entry.cpl_adjustment}, ot_adjustment:${entry.ot_adjustment}`, 'info');
            window.addDebugLog(`Leave usage - al_used:${entry.al_used}, sl_used:${entry.sl_used}, cl_used:${entry.cl_used}, cpl_used:${entry.cpl_used}`, 'info');
            window.addDebugLog(`Expiry dates - AL: ${entry.al_expiry_date}, CPL: ${entry.cpl_expiry_date}`, 'info');
            return entry;
        }
        
        // If offline, wait for network
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
                    
                    // Check if this entry already exists locally
                    const existingLocal = await window.dbAPI.getEntryByDate(date);
                    
                    cloudEntry.user_id = appCurrentUser.id;
                    cloudEntry.sync_status = 'synced';
                    
                    // DEBUG: Log raw cloud entry
                    window.addDebugLog(`fetchFromCloud: RAW cloud entry for ${date}: ${JSON.stringify(cloudEntry)}`, 'debug');
                    
                    // Ensure all fields exist with proper defaults - PRESERVE ADJUSTMENT VALUES
                    cloudEntry.al_adjustment = cloudEntry.al_adjustment !== undefined && cloudEntry.al_adjustment !== null ? parseFloat(cloudEntry.al_adjustment) : 0;
                    cloudEntry.sl_adjustment = cloudEntry.sl_adjustment !== undefined && cloudEntry.sl_adjustment !== null ? parseFloat(cloudEntry.sl_adjustment) : 0;
                    cloudEntry.cl_adjustment = cloudEntry.cl_adjustment !== undefined && cloudEntry.cl_adjustment !== null ? parseFloat(cloudEntry.cl_adjustment) : 0;
                    cloudEntry.cpl_adjustment = cloudEntry.cpl_adjustment !== undefined && cloudEntry.cpl_adjustment !== null ? parseFloat(cloudEntry.cpl_adjustment) : 0;
                    cloudEntry.ot_adjustment = cloudEntry.ot_adjustment !== undefined && cloudEntry.ot_adjustment !== null ? parseFloat(cloudEntry.ot_adjustment) : 0;
                    cloudEntry.al_accrued = cloudEntry.al_accrued !== undefined && cloudEntry.al_accrued !== null ? parseFloat(cloudEntry.al_accrued) : 0;
                    cloudEntry.al_used = cloudEntry.al_used !== undefined && cloudEntry.al_used !== null ? parseFloat(cloudEntry.al_used) : 0;
                    cloudEntry.sl_used = cloudEntry.sl_used !== undefined && cloudEntry.sl_used !== null ? parseFloat(cloudEntry.sl_used) : 0;
                    cloudEntry.cl_used = cloudEntry.cl_used !== undefined && cloudEntry.cl_used !== null ? parseFloat(cloudEntry.cl_used) : 0;
                    cloudEntry.cpl_used = cloudEntry.cpl_used !== undefined && cloudEntry.cpl_used !== null ? parseFloat(cloudEntry.cpl_used) : 0;
                    
                    // Handle expiry dates - if cloud has null but we have a local value, log it for debugging
                    if (existingLocal) {
                        if (cloudEntry.al_expiry_date === null && existingLocal.al_expiry_date) {
                            window.addDebugLog(`fetchFromCloud: WARNING - Cloud has null AL expiry but local has ${existingLocal.al_expiry_date} for ${date}`, 'warn');
                        }
                        if (cloudEntry.cpl_expiry_date === null && existingLocal.cpl_expiry_date) {
                            window.addDebugLog(`fetchFromCloud: WARNING - Cloud has null CPL expiry but local has ${existingLocal.cpl_expiry_date} for ${date}`, 'warn');
                        }
                    }
                    
                    // Use cloud expiry dates (even if null) - we want cloud to be source of truth
                    cloudEntry.al_expiry_date = cloudEntry.al_expiry_date || null;
                    cloudEntry.cpl_expiry_date = cloudEntry.cpl_expiry_date || null;
                    
                    cloudEntry.adjustment_note = cloudEntry.adjustment_note || '';
                    
                    window.addDebugLog(`fetchFromCloud: Processed cloud entry with adjustments: AL=${cloudEntry.al_adjustment}, SL=${cloudEntry.sl_adjustment}, CL=${cloudEntry.cl_adjustment}, CPL=${cloudEntry.cpl_adjustment}, OT=${cloudEntry.ot_adjustment}`, 'success');
                    window.addDebugLog(`fetchFromCloud: Expiry dates - AL: ${cloudEntry.al_expiry_date}, CPL: ${cloudEntry.cpl_expiry_date}`, 'info');
                    
                    // Run through strict overrider with isActiveEdit = false (passive load)
                    const overriddenEntry = await strictOverrider(cloudEntry, false);
                    await window.dbAPI.saveEntry(overriddenEntry);
                    return overriddenEntry;
                }
            }
            window.addDebugLog(`fetchFromCloud: No entry found in cloud for ${date}`, 'info');
        } catch (error) {
            window.addDebugLog(`fetchFromCloud: Error fetching from cloud: ${error.message}`, 'error');
        }
        
        // Create new entry - ALL fields defined with explicit defaults matching cloud schema
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
            al_adjustment: 0,
            sl_adjustment: 0,
            cl_adjustment: 0,
            al_expiry_date: null,
            cpl_adjustment: 0,
            cpl_expiry_date: null,
            ot_adjustment: 0,
            adjustment_note: '',
            sync_status: 'pending'
        };
        
        window.addDebugLog(`fetchFromCloud: Created new entry with adjustment fields initialized to 0`, 'info');
        
        // Run through strict overrider with isActiveEdit = true for new entries (they need to be calculated)
        const overriddenEntry = await strictOverrider(newEntry, true);
        return overriddenEntry;
    }

    // ==================== SAVE WITH STRICT OVERRIDE ====================
    async function saveAndSync(entry, skipSync = false, isActiveEdit = true) {
        if (!entry || !entry.date || !appCurrentUser) return;
        
        window.addDebugLog(`saveAndSync called for ${entry.date} (isActiveEdit: ${isActiveEdit})`, 'info');
        window.addDebugLog(`Entry before strictOverrider - al_adjustment:${entry.al_adjustment}, sl_adjustment:${entry.sl_adjustment}, cl_adjustment:${entry.cl_adjustment}, cpl_adjustment:${entry.cpl_adjustment}, is_manual:${entry.is_manual_adjustment}`, 'info');
        window.addDebugLog(`Leave usage before - al_used:${entry.al_used}, sl_used:${entry.sl_used}, cl_used:${entry.cl_used}, cpl_used:${entry.cpl_used}`, 'info');
        window.addDebugLog(`Expiry dates before - AL: ${entry.al_expiry_date}, CPL: ${entry.cpl_expiry_date}`, 'info');
        
        // ALWAYS run through strict overrider before saving
        // Pass isActiveEdit flag to control AL accrual recalculation
        const overriddenEntry = await strictOverrider(entry, isActiveEdit);
        
        window.addDebugLog(`Entry after strictOverrider - al_adjustment:${overriddenEntry.al_adjustment}, sl_adjustment:${overriddenEntry.sl_adjustment}, cl_adjustment:${overriddenEntry.cl_adjustment}, cpl_adjustment:${overriddenEntry.cpl_adjustment}, is_manual:${overriddenEntry.is_manual_adjustment}`, 'info');
        window.addDebugLog(`Leave usage after - al_used:${overriddenEntry.al_used}, sl_used:${overriddenEntry.sl_used}, cl_used:${overriddenEntry.cl_used}, cpl_used:${overriddenEntry.cpl_used}`, 'info');
        window.addDebugLog(`Expiry dates after - AL: ${overriddenEntry.al_expiry_date}, CPL: ${overriddenEntry.cpl_expiry_date}`, 'info');
        
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
        
        // Update target time display after save (for check-in/out)
        await updateTargetTimeDisplay();
        
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
                
                // DEBUG: Log raw entry from db before cleaning
                window.addDebugLog(`batchSync: RAW entry from db for ${entry.date}: al_adjustment=${entry.al_adjustment}, sl_adjustment=${entry.sl_adjustment}, cl_adjustment=${entry.cl_adjustment}, cpl_adjustment=${entry.cpl_adjustment}, ot_adjustment=${entry.ot_adjustment}`, 'debug');
                window.addDebugLog(`batchSync: Leave usage - al_used=${entry.al_used}, sl_used=${entry.sl_used}, cl_used=${entry.cl_used}, cpl_used=${entry.cpl_used}`, 'debug');
                window.addDebugLog(`batchSync: Expiry dates - AL: ${entry.al_expiry_date}, CPL: ${entry.cpl_expiry_date}`, 'debug');
                
                // Clean entry for sync - ensure all fields match cloud schema
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
                    al_used: parseFloat(entry.al_used) || 0,
                    sl_used: parseFloat(entry.sl_used) || 0,
                    cl_used: parseFloat(entry.cl_used) || 0,
                    cpl_used: parseFloat(entry.cpl_used) || 0,
                    is_off_day: entry.is_off_day || false,
                    is_holiday: entry.is_holiday || false,
                    al_accrued: entry.al_accrued || 0,
                    al_adjustment: parseFloat(entry.al_adjustment) || 0,
                    sl_adjustment: parseFloat(entry.sl_adjustment) || 0,
                    cl_adjustment: parseFloat(entry.cl_adjustment) || 0,
                    al_expiry_date: entry.al_expiry_date || null,
                    cpl_adjustment: parseFloat(entry.cpl_adjustment) || 0,
                    cpl_expiry_date: entry.cpl_expiry_date || null,
                    ot_adjustment: parseFloat(entry.ot_adjustment) || 0,
                    adjustment_note: entry.adjustment_note || ''
                };
                
                window.addDebugLog(`Syncing entry ${entry.date} with adjustments: AL=${cleanEntry.al_adjustment}, SL=${cleanEntry.sl_adjustment}, CL=${cleanEntry.cl_adjustment}, CPL=${cleanEntry.cpl_adjustment}, OT=${cleanEntry.ot_adjustment}`, 'info');
                window.addDebugLog(`Syncing entry ${entry.date} with leave usage: AL Used=${cleanEntry.al_used}, SL Used=${cleanEntry.sl_used}, CL Used=${cleanEntry.cl_used}, CPL Used=${cleanEntry.cpl_used}`, 'info');
                window.addDebugLog(`Syncing entry ${entry.date} with expiry dates: AL=${cleanEntry.al_expiry_date}, CPL=${cleanEntry.cpl_expiry_date}`, 'info');
                
                try {
                    const response = await fetch('/api/sync?direction=to', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${appAuthToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ entries: [cleanEntry] })
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        window.addDebugLog(`Sync HTTP error: ${response.status} - ${errorText}`, 'error');
                        throw new Error(`HTTP ${response.status}`);
                    }
                    
                    const data = await response.json();
                    window.addDebugLog(`Sync response: ${JSON.stringify(data)}`, 'debug');
                    
                    if (data.success && data.syncedIds && data.syncedIds.length > 0) {
                        await window.dbAPI.markAsSynced([entry.date]);
                        successCount++;
                        window.addDebugLog(`Successfully synced ${entry.date}`, 'success');
                    } else {
                        window.addDebugLog(`Sync response indicated failure: ${JSON.stringify(data)}`, 'error');
                        errorCount++;
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
                    
                    // DEBUG: Log raw cloud entry before processing
                    window.addDebugLog(`syncFromCloud: RAW cloud entry for ${entry.date}: ${JSON.stringify(entry)}`, 'debug');
                    
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
                    
                    // CRITICAL: Ensure adjustment fields are properly parsed and preserved
                    entry.al_adjustment = entry.al_adjustment !== undefined && entry.al_adjustment !== null ? parseFloat(entry.al_adjustment) : 0;
                    entry.sl_adjustment = entry.sl_adjustment !== undefined && entry.sl_adjustment !== null ? parseFloat(entry.sl_adjustment) : 0;
                    entry.cl_adjustment = entry.cl_adjustment !== undefined && entry.cl_adjustment !== null ? parseFloat(entry.cl_adjustment) : 0;
                    entry.cpl_adjustment = entry.cpl_adjustment !== undefined && entry.cpl_adjustment !== null ? parseFloat(entry.cpl_adjustment) : 0;
                    entry.ot_adjustment = entry.ot_adjustment !== undefined && entry.ot_adjustment !== null ? parseFloat(entry.ot_adjustment) : 0;
                    
                    entry.is_off_day = entry.is_off_day === true || entry.is_off_day === 'true';
                    entry.is_holiday = entry.is_holiday === true || entry.is_holiday === 'true';
                    
                    entry.user_id = appCurrentUser.id;
                    entry.sync_status = 'synced';
                    
                    window.addDebugLog(`syncFromCloud: Processed cloud entry ${entry.date} has adjustments: AL=${entry.al_adjustment}, SL=${entry.sl_adjustment}, CL=${entry.cl_adjustment}, CPL=${entry.cpl_adjustment}, OT=${entry.ot_adjustment}`, 'info');
                    window.addDebugLog(`syncFromCloud: Expiry dates - AL: ${entry.al_expiry_date}, CPL: ${entry.cpl_expiry_date}`, 'info');
                    
                    // Run through strict overrider with isActiveEdit = false (passive sync)
                    const overriddenEntry = await strictOverrider(entry, false);
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
        
        // DEBUG: Log all entries being processed by FIFO
        window.addDebugLog(`FIFO: Processing ${sortedEntries.length} entries`, 'info');
        sortedEntries.forEach(e => {
            window.addDebugLog(`FIFO entry ${e.date}: al_adjustment=${e.al_adjustment}, sl_adjustment=${e.sl_adjustment}, cl_adjustment=${e.cl_adjustment}, cpl_adjustment=${e.cpl_adjustment}, ot_adjustment=${e.ot_adjustment}`, 'debug');
            window.addDebugLog(`FIFO entry ${e.date} usage: al_used=${e.al_used}, sl_used=${e.sl_used}, cl_used=${e.cl_used}, cpl_used=${e.cpl_used}`, 'debug');
            window.addDebugLog(`FIFO entry ${e.date} expiry: al_expiry=${e.al_expiry_date}, cpl_expiry=${e.cpl_expiry_date}`, 'debug');
        });
        
        // COLLECT ALL PACKETS - Including adjustment packets
        const alPackets = [];
        const cplPackets = [];
        const alUsage = [];
        const cplUsage = [];
        
        // Track OT, SL, CL adjustments separately
        let totalOTAdjustment = 0;
        let totalSLAdjustment = 0;
        let totalCLAdjustment = 0;
        
        // Track yearly totals for AL cap
        const alByYear = {};
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const year = entryDate.getFullYear();
            
            // Ensure adjustment values are numbers
            const alAdjustment = entry.al_adjustment !== undefined && entry.al_adjustment !== null ? parseFloat(entry.al_adjustment) : 0;
            const slAdjustment = entry.sl_adjustment !== undefined && entry.sl_adjustment !== null ? parseFloat(entry.sl_adjustment) : 0;
            const clAdjustment = entry.cl_adjustment !== undefined && entry.cl_adjustment !== null ? parseFloat(entry.cl_adjustment) : 0;
            const cplAdjustment = entry.cpl_adjustment !== undefined && entry.cpl_adjustment !== null ? parseFloat(entry.cpl_adjustment) : 0;
            const otAdjustment = entry.ot_adjustment !== undefined && entry.ot_adjustment !== null ? parseFloat(entry.ot_adjustment) : 0;
            
            window.addDebugLog(`Matchmaker scanning ${entry.date}: al_adjustment is ${alAdjustment}`, 'info');
            
            // Add OT adjustment to total (only if OT is enabled for user)
            if (otAdjustment !== 0 && userSettings.has_ot) {
                totalOTAdjustment += otAdjustment;
                window.addDebugLog(`FIFO: Added OT adjustment: ${otAdjustment} from ${entry.date}, running total: ${totalOTAdjustment}`, 'debug');
            }
            
            // Track SL and CL adjustments
            if (slAdjustment !== 0) {
                totalSLAdjustment += slAdjustment;
                window.addDebugLog(`FIFO: Added SL adjustment: ${slAdjustment} from ${entry.date}, running total: ${totalSLAdjustment}`, 'debug');
            }
            
            if (clAdjustment !== 0) {
                totalCLAdjustment += clAdjustment;
                window.addDebugLog(`FIFO: Added CL adjustment: ${clAdjustment} from ${entry.date}, running total: ${totalCLAdjustment}`, 'debug');
            }
            
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
                window.addDebugLog(`FIFO: Added AL accrual packet: ${entry.al_accrued} on ${entry.date}, expires: ${packet.expiryDate?.toISOString().split('T')[0] || 'never'}`, 'debug');
                
                if (!alByYear[year]) alByYear[year] = 0;
                alByYear[year] += entry.al_accrued;
            }
            
            // AL Packets (adjustments) - CRITICAL: These are separate packets
            if (alAdjustment !== 0) {
                const packet = {
                    date: entry.date,
                    amount: alAdjustment,
                    expiryDate: entry.al_expiry_date ? new Date(entry.al_expiry_date) : null,
                    type: 'adjustment',
                    entryId: entry.date + '-adj'
                };
                alPackets.push(packet);
                window.addDebugLog(`FIFO: Added AL adjustment packet: ${alAdjustment} on ${entry.date}, expires: ${packet.expiryDate?.toISOString().split('T')[0] || 'never'}`, 'debug');
                
                if (!alByYear[year]) alByYear[year] = 0;
                alByYear[year] += alAdjustment;
            }
            
            // CPL Packets (only if CPL is enabled for user)
            if (userSettings.has_cpl && entry.cpl_earned && entry.cpl_earned > 0 && entry.cpl_expiry_date) {
                cplPackets.push({
                    date: entry.date,
                    amount: entry.cpl_earned,
                    expiryDate: new Date(entry.cpl_expiry_date),
                    entryId: entry.date
                });
                window.addDebugLog(`FIFO: Added CPL earned packet: ${entry.cpl_earned} on ${entry.date}, expires: ${entry.cpl_expiry_date}`, 'debug');
            }
            
            // CPL Adjustment Packets (only if CPL is enabled for user)
            if (userSettings.has_cpl && cplAdjustment !== 0) {
                const packet = {
                    date: entry.date,
                    amount: cplAdjustment,
                    expiryDate: entry.cpl_expiry_date ? new Date(entry.cpl_expiry_date) : null,
                    type: 'adjustment',
                    entryId: entry.date + '-cpl-adj'
                };
                cplPackets.push(packet);
                window.addDebugLog(`FIFO: Added CPL adjustment packet: ${cplAdjustment} on ${entry.date}, expires: ${packet.expiryDate?.toISOString().split('T')[0] || 'never'}`, 'debug');
            }
            
            // AL Usage - Capture leave usage
            if (entry.al_used && parseFloat(entry.al_used) > 0) {
                const usageAmount = parseFloat(entry.al_used);
                alUsage.push({
                    date: entry.date,
                    amount: usageAmount,
                    entryId: entry.date
                });
                window.addDebugLog(`FIFO: Added AL usage: ${usageAmount} on ${entry.date}`, 'debug');
            }
            
            // CPL Usage - Capture leave usage (only if CPL is enabled)
            if (userSettings.has_cpl && entry.cpl_used && parseFloat(entry.cpl_used) > 0) {
                const usageAmount = parseFloat(entry.cpl_used);
                cplUsage.push({
                    date: entry.date,
                    amount: usageAmount,
                    entryId: entry.date
                });
                window.addDebugLog(`FIFO: Added CPL usage: ${usageAmount} on ${entry.date}`, 'debug');
            }
        }
        
        window.addDebugLog(`FIFO: Collected ${alPackets.length} AL packets and ${cplPackets.length} CPL packets`, 'info');
        window.addDebugLog(`FIFO: Collected ${alUsage.length} AL usage and ${cplUsage.length} CPL usage`, 'info');
        window.addDebugLog(`FIFO: Total OT adjustment: ${totalOTAdjustment}`, 'info');
        window.addDebugLog(`FIFO: Total SL adjustment: ${totalSLAdjustment}`, 'info');
        window.addDebugLog(`FIFO: Total CL adjustment: ${totalCLAdjustment}`, 'info');
        
        // APPLY YEAR-END CAP (using dynamic user limit)
        const years = Object.keys(alByYear).map(Number).sort();
        const yearEndCaps = {};
        
        for (let i = 0; i < years.length; i++) {
            const year = years[i];
            const nextYear = year + 1;
            
            // Calculate Dec 31st balance for this year (including adjustments)
            const dec31Balance = alByYear[year];
            
            // Apply dynamic user limit for carry forward to next year
            if (dec31Balance > userSettings.limit_annual) {
                yearEndCaps[year] = userSettings.limit_annual;
                window.addDebugLog(`Year ${year} Dec 31 balance ${dec31Balance.toFixed(2)} capped to ${userSettings.limit_annual} for Jan 1 ${nextYear}`, 'info');
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
        
        // Process CPL usage with FIFO (only if CPL is enabled)
        let cplPacketsCopy = [...cplPackets];
        
        if (userSettings.has_cpl) {
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
        }
        
        // CALCULATE CURRENT BALANCE with year-end caps
        // Start from 0, sum all packets (accruals and adjustments) minus usage
        let alBalance = 0;
        let cplBalance = 0;
        
        // Sum all remaining AL packets (accruals + adjustments that are still available)
        for (const packet of alPacketsCopy) {
            if (packet.amount > 0) {
                const expiryDate = packet.expiryDate;
                if (!expiryDate || expiryDate > targetDate) {
                    alBalance += packet.amount;
                    window.addDebugLog(`FIFO: Adding remaining AL packet from ${packet.date}: ${packet.amount} (total now: ${alBalance})`, 'debug');
                }
            }
        }
        
        // Apply user's annual leave limit as a cap (not starting balance)
        if (userSettings.limit_annual > 0 && alBalance > userSettings.limit_annual) {
            alBalance = userSettings.limit_annual;
            window.addDebugLog(`AL balance capped at user limit: ${userSettings.limit_annual}`, 'info');
        }
        
        // Sum remaining CPL packets (only if CPL is enabled)
        if (userSettings.has_cpl) {
            for (const packet of cplPacketsCopy) {
                if (packet.amount > 0 && packet.expiryDate > targetDate) {
                    cplBalance += packet.amount;
                    window.addDebugLog(`FIFO: Remaining CPL packet from ${packet.date}: ${packet.amount}, expires: ${packet.expiryDate.toISOString().split('T')[0]}`, 'debug');
                }
            }
        }
        
        window.addDebugLog(`FIFO Matchmaker complete - AL: ${alBalance.toFixed(2)} (actual balance), CPL: ${cplBalance.toFixed(2)}, OT Adj: ${totalOTAdjustment}, SL Adj: ${totalSLAdjustment}, CL Adj: ${totalCLAdjustment}`, 'success');
        
        return {
            alBalance,
            cplBalance,
            otAdjustmentTotal: totalOTAdjustment,
            slAdjustmentTotal: totalSLAdjustment,
            clAdjustmentTotal: totalCLAdjustment,
            alPackets: alPacketsCopy,
            cplPackets: cplPacketsCopy
        };
    }

    // ==================== BALANCE FUNCTIONS ====================
    async function loadBalances() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        window.addDebugLog('loadBalances() called', 'info');
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        window.addDebugLog(`loadBalances: Retrieved ${entries.length} entries from db`, 'info');
        
        // DEBUG: Log all entries from db
        entries.forEach(e => {
            window.addDebugLog(`loadBalances: Entry from db ${e.date}: al_adjustment=${e.al_adjustment}, sl_adjustment=${e.sl_adjustment}, cl_adjustment=${e.cl_adjustment}, cpl_adjustment=${e.cpl_adjustment}, ot_adjustment=${e.ot_adjustment}`, 'debug');
            window.addDebugLog(`loadBalances: Entry from db ${e.date} usage: al_used=${e.al_used}, sl_used=${e.sl_used}, cl_used=${e.cl_used}, cpl_used=${e.cpl_used}`, 'debug');
            window.addDebugLog(`loadBalances: Entry from db ${e.date} expiry: al_expiry=${e.al_expiry_date}, cpl_expiry=${e.cpl_expiry_date}`, 'debug');
        });
        
        const today = new Date();
        
        // Filter to past entries
        const pastEntries = entries.filter(e => new Date(e.date) <= today);
        
        // Run FIFO matchmaker
        const fifoResult = calculateFIFOBalance(pastEntries, today);
        
        // Calculate OT totals from regular work AND adjustments (only if OT is enabled)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        
        let otThisMonth = 0;
        let otLastMonth = 0;
        let totalOT = 0;
        let totalLeave = 0;
        
        // SL/CL tracking with adjustment support
        let slBalance = userSettings.limit_sick > 0 ? userSettings.limit_sick : 0;
        let clBalance = userSettings.limit_casual > 0 ? userSettings.limit_casual : 0;
        let currentYearSL = currentYear;
        let currentYearCL = currentYear;
        
        // Track SL and CL adjustments from FIFO result
        let totalSLAdjustment = fifoResult.slAdjustmentTotal || 0;
        let totalCLAdjustment = fifoResult.clAdjustmentTotal || 0;
        
        const sortedEntries = [...pastEntries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const entryYear = entryDate.getFullYear();
            
            // SL/CL reset at start of each year (if limits are > 0)
            if (userSettings.limit_sick > 0 && entryYear > currentYearSL) {
                slBalance = userSettings.limit_sick;
                currentYearSL = entryYear;
            }
            if (userSettings.limit_casual > 0 && entryYear > currentYearCL) {
                clBalance = userSettings.limit_casual;
                currentYearCL = entryYear;
            }
            
            // Regular usage - Use parseFloat to ensure numbers
            if (entry.sl_used && userSettings.limit_sick > 0) {
                const slUsed = parseFloat(entry.sl_used) || 0;
                slBalance -= slUsed;
                totalLeave += slUsed;
                window.addDebugLog(`loadBalances: Subtracted SL used ${slUsed} from balance, new SL balance: ${slBalance}`, 'debug');
            }
            if (entry.cl_used && userSettings.limit_casual > 0) {
                const clUsed = parseFloat(entry.cl_used) || 0;
                clBalance -= clUsed;
                totalLeave += clUsed;
                window.addDebugLog(`loadBalances: Subtracted CL used ${clUsed} from balance, new CL balance: ${clBalance}`, 'debug');
            }
            if (entry.al_used) {
                totalLeave += parseFloat(entry.al_used) || 0;
            }
            if (userSettings.has_cpl && entry.cpl_used) {
                totalLeave += parseFloat(entry.cpl_used) || 0;
            }
            
            // OT totals - count both regular OT and OT adjustments (only if OT is enabled)
            if (userSettings.has_ot && entry.final_ot_hours && entry.final_ot_hours > 0) {
                const otHours = parseFloat(entry.final_ot_hours) || 0;
                totalOT += otHours;
                
                // Track OT by month based on entry date
                if (entryDate.getMonth() === currentMonth && entryYear === currentYear) {
                    otThisMonth += otHours;
                } else if (entryDate.getMonth() === lastMonth && entryYear === lastMonthYear) {
                    otLastMonth += otHours;
                }
            }
        }
        
        // Add OT adjustments to totals (only if OT is enabled)
        if (userSettings.has_ot) {
            let otAdjustmentThisMonth = 0;
            let otAdjustmentLastMonth = 0;
            
            for (const entry of sortedEntries) {
                const entryDate = new Date(entry.date);
                const entryYear = entryDate.getFullYear();
                const otAdjustment = entry.ot_adjustment !== undefined && entry.ot_adjustment !== null ? parseFloat(entry.ot_adjustment) : 0;
                
                if (otAdjustment !== 0) {
                    // Add to total OT
                    totalOT += otAdjustment;
                    
                    // Add to appropriate month
                    if (entryDate.getMonth() === currentMonth && entryYear === currentYear) {
                        otAdjustmentThisMonth += otAdjustment;
                    } else if (entryDate.getMonth() === lastMonth && entryYear === lastMonthYear) {
                        otAdjustmentLastMonth += otAdjustment;
                    }
                }
            }
            
            // Add monthly OT adjustments to the monthly totals
            otThisMonth += otAdjustmentThisMonth;
            otLastMonth += otAdjustmentLastMonth;
            
            window.addDebugLog(`loadBalances: OT adjustments - This month: ${otAdjustmentThisMonth}, Last month: ${otAdjustmentLastMonth}`, 'info');
        }
        
        // Add SL/CL adjustments to balances (only if limits are > 0)
        if (userSettings.limit_sick > 0) {
            slBalance += totalSLAdjustment;
            if (slBalance < 0) slBalance = 0;
        }
        if (userSettings.limit_casual > 0) {
            clBalance += totalCLAdjustment;
            if (clBalance < 0) clBalance = 0;
        }
        
        window.addDebugLog(`loadBalances: Applied SL adjustment total ${totalSLAdjustment}, CL adjustment total ${totalCLAdjustment}`, 'info');
        window.addDebugLog(`loadBalances: Final SL balance: ${slBalance}, CL balance: ${clBalance}`, 'info');
        
        // Apply user limits to AL and CPL (cap only, not starting balance)
        let finalALBalance = fifoResult.alBalance;
        if (userSettings.limit_annual > 0 && finalALBalance > userSettings.limit_annual) {
            finalALBalance = userSettings.limit_annual;
            window.addDebugLog(`AL balance capped at user limit: ${userSettings.limit_annual}`, 'info');
        }
        if (userSettings.limit_annual === 0) {
            finalALBalance = 0;
        }
        
        let finalCPLBalance = userSettings.has_cpl ? fifoResult.cplBalance : 0;
        
        // Update UI
        const alBalanceEl = document.getElementById('alBalance');
        const slBalanceEl = document.getElementById('slBalance');
        const clBalanceEl = document.getElementById('clBalance');
        const cplBalanceEl = document.getElementById('cplBalance');
        const otMonthEl = document.getElementById('otMonth');
        const otLastMonthEl = document.getElementById('otLastMonth');
        
        if (alBalanceEl) alBalanceEl.textContent = finalALBalance.toFixed(2);
        if (slBalanceEl) slBalanceEl.textContent = slBalance.toFixed(2);
        if (clBalanceEl) clBalanceEl.textContent = clBalance.toFixed(2);
        if (cplBalanceEl) cplBalanceEl.textContent = finalCPLBalance.toFixed(2);
        if (otMonthEl) otMonthEl.textContent = otThisMonth.toFixed(1);
        if (otLastMonthEl) otLastMonthEl.textContent = otLastMonth.toFixed(1);
        
        // Update AL balance card note with dynamic limit
        const alBalanceNote = document.querySelector('.al-card .balance-note');
        if (alBalanceNote && userSettings.limit_annual > 0) {
            alBalanceNote.textContent = `${userSettings.limit_annual} days carry forward per year`;
        } else if (alBalanceNote && userSettings.limit_annual === 0) {
            alBalanceNote.textContent = `Annual Leave disabled`;
        }
        
        // Hide balance cards if limits are 0
        const alCard = document.querySelector('.al-card');
        const slCard = document.querySelector('.sl-card');
        const clCard = document.querySelector('.cl-card');
        const cplCard = document.querySelector('.cpl-card');
        
        if (userSettings.limit_annual === 0 && alCard) alCard.style.display = 'none';
        else if (alCard) alCard.style.display = '';
        
        if (userSettings.limit_sick === 0 && slCard) slCard.style.display = 'none';
        else if (slCard) slCard.style.display = '';
        
        if (userSettings.limit_casual === 0 && clCard) clCard.style.display = 'none';
        else if (clCard) clCard.style.display = '';
        
        if (!userSettings.has_cpl && cplCard) cplCard.style.display = 'none';
        else if (cplCard) cplCard.style.display = '';
        
        // Update settings fields
        const setupAL = document.getElementById('setupAL');
        const setupSL = document.getElementById('setupSL');
        const setupCL = document.getElementById('setupCL');
        const setupCPL = document.getElementById('setupCPL');
        const setupOT = document.getElementById('setupOT');
        
        if (setupAL) setupAL.value = finalALBalance.toFixed(2);
        if (setupSL) setupSL.value = slBalance.toFixed(2);
        if (setupCL) setupCL.value = clBalance.toFixed(2);
        if (setupCPL) setupCPL.value = finalCPLBalance.toFixed(2);
        if (setupOT) setupOT.value = totalOT.toFixed(1);
        
        window.addDebugLog(`Balances - AL: ${finalALBalance.toFixed(2)} (actual balance), SL: ${slBalance.toFixed(2)}, CL: ${clBalance.toFixed(2)}, CPL: ${finalCPLBalance.toFixed(2)}, OT: ${totalOT.toFixed(1)} (with adjustments)`, 'success');
    }

    // ==================== LOAD EXPIRY INFO ====================
    async function loadExpiryInfo() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const now = new Date();
        
        const fifoResult = calculateFIFOBalance(entries, now);
        
        const alExpiryDiv = document.getElementById('alExpiryInfo');
        const cplExpiryDiv = document.getElementById('cplExpiryInfo');
        
        // Clear previous content
        if (alExpiryDiv) alExpiryDiv.innerHTML = '';
        if (cplExpiryDiv) cplExpiryDiv.innerHTML = '';
        
        // Hide CPL expiry section if CPL is disabled
        const cplExpirySection = document.querySelector('.expiry-section');
        if (cplExpirySection && !userSettings.has_cpl) {
            cplExpirySection.style.display = 'none';
        } else if (cplExpirySection) {
            cplExpirySection.style.display = '';
        }
        
        // ===== CPL EXPIRY - Show CPL packets expiring within 180 days (only if CPL enabled) =====
        if (userSettings.has_cpl) {
            const cplExpiring = [];
            const cplPackets = fifoResult.cplPackets || [];
            
            window.addDebugLog(`loadExpiryInfo: Checking ${cplPackets.length} CPL packets for expiry`, 'info');
            
            for (const packet of cplPackets) {
                if (packet.amount > 0 && packet.expiryDate) {
                    const daysUntil = Math.ceil((packet.expiryDate - now) / (1000 * 60 * 60 * 24));
                    const expiryDateStr = packet.expiryDate.toISOString().split('T')[0];
                    window.addDebugLog(`CPL Packet from ${packet.date}: amount=${packet.amount}, expiry=${expiryDateStr}, daysUntil=${daysUntil}`, 'debug');
                    
                    // Show CPL expiring within 180 days (or any positive days until expiry)
                    if (daysUntil > 0 && daysUntil <= 180) {
                        cplExpiring.push({
                            date: packet.date,
                            amount: packet.amount,
                            daysUntil: daysUntil,
                            expiryDate: expiryDateStr
                        });
                    }
                }
            }
            
            // Sort by days until expiry (nearest first)
            cplExpiring.sort((a, b) => a.daysUntil - b.daysUntil);
            
            if (cplExpiryDiv) {
                if (cplExpiring.length === 0) {
                    cplExpiryDiv.innerHTML = '<p>No CPL expiring soon</p>';
                    window.addDebugLog('No CPL expiring soon', 'info');
                } else {
                    let html = '<h4>CPL Expiring Soon</h4>';
                    cplExpiring.slice(0, 5).forEach(item => {
                        html += `
                            <div class="expiry-item">
                                <div>${item.amount.toFixed(2)} days from ${item.date}</div>
                                <div>Expires in ${item.daysUntil} days (${item.expiryDate})</div>
                            </div>
                        `;
                    });
                    cplExpiryDiv.innerHTML = html;
                    window.addDebugLog(`Displaying ${Math.min(5, cplExpiring.length)} CPL expiry items`, 'success');
                }
            }
        }
        
        // ===== AL EXPIRY - Calculate AL that will expire this year =====
        if (userSettings.limit_annual > 0) {
            const currentYear = now.getFullYear();
            const endOfCurrentYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);
            
            // Find all AL packets (accruals and adjustments) that expire after now but before end of current year
            let alExpiringThisYear = 0;
            const alPackets = fifoResult.alPackets || [];
            
            window.addDebugLog(`loadExpiryInfo: Checking ${alPackets.length} AL packets for expiry this year`, 'info');
            
            for (const packet of alPackets) {
                if (packet.amount > 0 && packet.expiryDate) {
                    const expiryDate = packet.expiryDate;
                    const expiryYear = expiryDate.getFullYear();
                    
                    window.addDebugLog(`AL Packet from ${packet.date}: amount=${packet.amount}, expiry=${expiryDate.toISOString().split('T')[0]}, expiryYear=${expiryYear}`, 'debug');
                    
                    // If packet expires this year (current year) and hasn't expired yet
                    if (expiryYear === currentYear && expiryDate > now) {
                        alExpiringThisYear += packet.amount;
                        window.addDebugLog(`AL Packet expiring this year: +${packet.amount}, total=${alExpiringThisYear}`, 'debug');
                    }
                }
            }
            
            // Alternative calculation: balance - limit (if balance > limit)
            const alBalance = parseFloat(document.getElementById('alBalance')?.textContent) || 0;
            const alExpiringFromBalance = Math.max(0, alBalance - userSettings.limit_annual);
            
            // Use the packet-based calculation as it's more accurate
            const alExpiringTotal = alExpiringThisYear;
            
            window.addDebugLog(`AL Expiring this year: ${alExpiringTotal.toFixed(2)} (from packets: ${alExpiringThisYear.toFixed(2)}, from balance-limit: ${alExpiringFromBalance.toFixed(2)})`, 'info');
            
            if (alExpiryDiv) {
                if (alExpiringTotal <= 0) {
                    alExpiryDiv.innerHTML = '<p>No AL expiring this year</p>';
                    window.addDebugLog('No AL expiring this year', 'info');
                } else {
                    alExpiryDiv.innerHTML = `
                        <h4>AL Expiring This Year</h4>
                        <div class="expiry-item">
                            <div><strong>${alExpiringTotal.toFixed(2)} days</strong> will expire on Dec 31, ${currentYear}</div>
                            <div>(Balance above ${userSettings.limit_annual}-day carryover limit)</div>
                        </div>
                    `;
                    window.addDebugLog(`Displaying AL expiry: ${alExpiringTotal.toFixed(2)} days expiring Dec 31, ${currentYear}`, 'success');
                }
            }
        } else if (alExpiryDiv) {
            alExpiryDiv.innerHTML = '<p>Annual Leave is disabled for your account</p>';
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
        
        if (!navigator.onLine) {
            alert('You need to be online to fetch cloud data for recalculation');
            return;
        }
        
        try {
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
            
            progressDiv.innerHTML = 'Fetching all cloud entries for CPL and Annual Leave calculation...';
            
            // FIRST: Fetch ALL entries from cloud for recalculation (including old CPL/AL)
            const response = await fetch('/api/sync?direction=from&recalc=true', {
                headers: { 'Authorization': `Bearer ${appAuthToken}` }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            if (data.success && data.entries) {
                progressDiv.innerHTML = `Downloaded ${data.entries.length} cloud entries. Processing...`;
                
                // Process cloud entries first
                let imported = 0;
                for (const entry of data.entries) {
                    if (entry.date && entry.date.includes('T')) {
                        entry.date = entry.date.split('T')[0];
                    }
                    
                    // Parse all fields
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
                    
                    // CRITICAL: Parse adjustment fields
                    entry.al_adjustment = entry.al_adjustment !== undefined && entry.al_adjustment !== null ? parseFloat(entry.al_adjustment) : 0;
                    entry.sl_adjustment = entry.sl_adjustment !== undefined && entry.sl_adjustment !== null ? parseFloat(entry.sl_adjustment) : 0;
                    entry.cl_adjustment = entry.cl_adjustment !== undefined && entry.cl_adjustment !== null ? parseFloat(entry.cl_adjustment) : 0;
                    entry.cpl_adjustment = entry.cpl_adjustment !== undefined && entry.cpl_adjustment !== null ? parseFloat(entry.cpl_adjustment) : 0;
                    entry.ot_adjustment = entry.ot_adjustment !== undefined && entry.ot_adjustment !== null ? parseFloat(entry.ot_adjustment) : 0;
                    
                    entry.is_off_day = entry.is_off_day === true || entry.is_off_day === 'true';
                    entry.is_holiday = entry.is_holiday === true || entry.is_holiday === 'true';
                    entry.user_id = appCurrentUser.id;
                    entry.sync_status = 'synced';
                    
                    // Save to local DB without running through overrider yet
                    await window.dbAPI.saveEntry(entry);
                    imported++;
                    
                    if (imported % 50 === 0) {
                        progressDiv.innerHTML = `Saved ${imported}/${data.entries.length} entries to local DB...`;
                    }
                }
                
                window.addDebugLog(`Recalc: Imported ${imported} entries from cloud`, 'success');
            }
            
            // Get all entries from local DB (now including cloud data)
            const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
            window.addDebugLog(`Found ${entries.length} entries to process`, 'info');
            
            let count = 0;
            const total = entries.length;
            
            // STRICT OVERRIDE on every entry (adjustments will be skipped by shield)
            // IMPORTANT: Use isActiveEdit = false to preserve existing AL accrual values
            for (const entry of entries) {
                count++;
                progressDiv.innerHTML = `Processing ${count}/${total}<br>Entry: ${entry.date}`;
                
                // Run through strict overrider with isActiveEdit = false to preserve AL accrual
                const overriddenEntry = await strictOverrider(entry, false);
                
                // Save to local DB
                await window.dbAPI.saveEntry(overriddenEntry);
                
                // Small delay to prevent UI freeze
                if (count % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            progressDiv.innerHTML = 'Running FIFO Matchmaker...';
            
            // Re-run FIFO matchmaker on all entries
            const allEntries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
            const today = new Date();
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
            await loadAdjustments();
            
            window.addDebugLog('RECALCULATE ALL - HARD RESET COMPLETE', 'success');
            alert('✅ All entries have been recalculated with cloud data and synced');
            
        } catch (error) {
            window.addDebugLog(`Recalculate All error: ${error.message}`, 'error');
            alert('Error recalculating: ' + error.message);
            
            // Remove progress div if it exists
            const progressDiv = document.querySelector('.progress-bar');
            if (progressDiv) document.body.removeChild(progressDiv);
        }
    }

    // ==================== USER SETTINGS FUNCTIONS ====================
    
    // Load user settings from server
    async function loadUserSettings() {
        if (!appCurrentUser) return;
        
        window.addDebugLog('loadUserSettings() called', 'info');
        
        // First, try to load from user object (which came from login)
        if (appCurrentUser.has_ot !== undefined) {
            userSettings.has_ot = appCurrentUser.has_ot;
            userSettings.has_cpl = appCurrentUser.has_cpl;
            userSettings.limit_annual = appCurrentUser.limit_annual || 22;
            userSettings.limit_casual = appCurrentUser.limit_casual || 10;
            userSettings.limit_sick = appCurrentUser.limit_sick || 10;
            window.addDebugLog(`User settings loaded from user object`, 'success');
        }
        
        // Then try to fetch latest from server
        if (appAuthToken && navigator.onLine) {
            try {
                const response = await fetch('/api/account?action=get-settings', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${appAuthToken}` }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.settings) {
                        userSettings = data.settings;
                        window.addDebugLog(`User settings loaded from server: ${JSON.stringify(userSettings)}`, 'success');
                        
                        // Update appCurrentUser with latest settings
                        appCurrentUser.has_ot = userSettings.has_ot;
                        appCurrentUser.has_cpl = userSettings.has_cpl;
                        appCurrentUser.limit_annual = userSettings.limit_annual;
                        appCurrentUser.limit_casual = userSettings.limit_casual;
                        appCurrentUser.limit_sick = userSettings.limit_sick;
                        localStorage.setItem('auth_user', JSON.stringify(appCurrentUser));
                    }
                }
            } catch (error) {
                window.addDebugLog(`Failed to fetch settings from server: ${error.message}`, 'warning');
            }
        }
        
        // Apply UI permissions based on settings
        applyUserPermissions();
        
        // Update UI with current values
        updateSettingsUI();
        
        window.addDebugLog(`User settings loaded - OT:${userSettings.has_ot}, CPL:${userSettings.has_cpl}, AL:${userSettings.limit_annual}, CL:${userSettings.limit_casual}, SL:${userSettings.limit_sick}`, 'info');
    }

    // Save user settings to server
    async function saveUserSettings() {
        if (!appAuthToken) {
            window.addDebugLog('Cannot save settings - not authenticated', 'error');
            return false;
        }
        
        window.addDebugLog('saveUserSettings() called', 'info');
        
        try {
            const response = await fetch('/api/account?action=update-settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${appAuthToken}`
                },
                body: JSON.stringify(userSettings)
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            if (data.success) {
                window.addDebugLog('User settings saved to server', 'success');
                
                // Update local user object
                if (appCurrentUser) {
                    appCurrentUser.has_ot = userSettings.has_ot;
                    appCurrentUser.has_cpl = userSettings.has_cpl;
                    appCurrentUser.limit_annual = userSettings.limit_annual;
                    appCurrentUser.limit_casual = userSettings.limit_casual;
                    appCurrentUser.limit_sick = userSettings.limit_sick;
                    localStorage.setItem('auth_user', JSON.stringify(appCurrentUser));
                }
                
                return true;
            } else {
                throw new Error(data.message || 'Save failed');
            }
        } catch (error) {
            window.addDebugLog(`Failed to save settings: ${error.message}`, 'error');
            return false;
        }
    }

    // Update settings UI with current values
    function updateSettingsUI() {
        const otCheckbox = document.getElementById('userHasOT');
        const cplCheckbox = document.getElementById('userHasCPL');
        const annualLimit = document.getElementById('userLimitAnnual');
        const casualLimit = document.getElementById('userLimitCasual');
        const sickLimit = document.getElementById('userLimitSick');
        
        if (otCheckbox) otCheckbox.checked = userSettings.has_ot;
        if (cplCheckbox) cplCheckbox.checked = userSettings.has_cpl;
        if (annualLimit) annualLimit.value = userSettings.limit_annual;
        if (casualLimit) casualLimit.value = userSettings.limit_casual;
        if (sickLimit) sickLimit.value = userSettings.limit_sick;
    }

    // Apply user permissions to UI (conditional visibility)
    function applyUserPermissions() {
        window.addDebugLog(`applyUserPermissions() - OT:${userSettings.has_ot}, CPL:${userSettings.has_cpl}`, 'info');
        
        // Hide/Show OT elements
        const otCards = document.querySelectorAll('.ot-card');
        const otValues = document.querySelectorAll('#otMonth, #otLastMonth');
        const otCols = document.querySelectorAll('.ot-col');
        
        if (!userSettings.has_ot) {
            otCards.forEach(card => {
                if (card) card.style.display = 'none';
            });
            otValues.forEach(val => {
                if (val && val.parentElement) val.parentElement.style.display = 'none';
            });
            otCols.forEach(col => {
                if (col) col.style.display = 'none';
            });
            window.addDebugLog('OT features hidden (disabled for user)', 'info');
        } else {
            otCards.forEach(card => {
                if (card) card.style.display = '';
            });
            otValues.forEach(val => {
                if (val && val.parentElement) val.parentElement.style.display = '';
            });
            otCols.forEach(col => {
                if (col) col.style.display = '';
            });
            window.addDebugLog('OT features shown (enabled for user)', 'info');
        }
        
        // Hide/Show CPL elements
        const cplButtons = document.querySelectorAll('.leave-btn.cpl');
        const cplBalance = document.getElementById('cplBalance');
        const cplCols = document.querySelectorAll('.cpl-col');
        
        if (!userSettings.has_cpl) {
            cplButtons.forEach(btn => {
                if (btn) btn.style.display = 'none';
            });
            if (cplBalance && cplBalance.parentElement) cplBalance.parentElement.style.display = 'none';
            cplCols.forEach(col => {
                if (col) col.style.display = 'none';
            });
            window.addDebugLog('CPL features hidden (disabled for user)', 'info');
        } else {
            cplButtons.forEach(btn => {
                if (btn) btn.style.display = '';
            });
            if (cplBalance && cplBalance.parentElement) cplBalance.parentElement.style.display = '';
            cplCols.forEach(col => {
                if (col) col.style.display = '';
            });
            window.addDebugLog('CPL features shown (enabled for user)', 'info');
        }
        
        // Hide leave buttons if limits are 0
        const annualBtn = document.querySelector('.leave-btn.annual');
        const sickBtn = document.querySelector('.leave-btn.sick');
        const casualBtn = document.querySelector('.leave-btn.casual');
        
        if (userSettings.limit_annual === 0 && annualBtn) annualBtn.style.display = 'none';
        else if (annualBtn) annualBtn.style.display = '';
        
        if (userSettings.limit_sick === 0 && sickBtn) sickBtn.style.display = 'none';
        else if (sickBtn) sickBtn.style.display = '';
        
        if (userSettings.limit_casual === 0 && casualBtn) casualBtn.style.display = 'none';
        else if (casualBtn) casualBtn.style.display = '';
        
        // Update leave type dropdowns based on limits
        updateLeaveTypeDropdowns();
    }

    // Update leave type dropdowns to only show enabled leave types
    function updateLeaveTypeDropdowns() {
        const leaveSelects = document.querySelectorAll('#manualType, #bulkType');
        
        const leaveOptions = [
            { value: 'work', label: 'Work Day', enabled: true },
            { value: 'annual', label: 'Annual Leave', enabled: userSettings.limit_annual > 0 },
            { value: 'sick', label: 'Sick Leave', enabled: userSettings.limit_sick > 0 },
            { value: 'casual', label: 'Casual Leave', enabled: userSettings.limit_casual > 0 },
            { value: 'cpl', label: 'CPL', enabled: userSettings.has_cpl },
            { value: 'holiday', label: 'Holiday', enabled: true },
            { value: 'off', label: 'Off Day', enabled: true }
        ];
        
        leaveSelects.forEach(select => {
            if (!select) return;
            
            const currentValue = select.value;
            const options = leaveOptions.filter(opt => opt.enabled);
            
            select.innerHTML = '';
            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                select.appendChild(option);
            });
            
            // Try to restore previous selection
            if (options.some(opt => opt.value === currentValue)) {
                select.value = currentValue;
            }
        });
        
        window.addDebugLog('Leave type dropdowns updated based on limits', 'info');
    }
    
    // Save user settings and apply immediately
    async function saveUserSettingsAndApply() {
        window.addDebugLog('saveUserSettingsAndApply() called', 'info');
        
        const statusEl = document.getElementById('settingsSaveStatus');
        if (statusEl) {
            statusEl.textContent = 'Saving settings...';
            statusEl.style.color = '#666';
        }
        
        // Get values from UI
        userSettings.has_ot = document.getElementById('userHasOT')?.checked || false;
        userSettings.has_cpl = document.getElementById('userHasCPL')?.checked || false;
        userSettings.limit_annual = parseInt(document.getElementById('userLimitAnnual')?.value) || 0;
        userSettings.limit_casual = parseInt(document.getElementById('userLimitCasual')?.value) || 0;
        userSettings.limit_sick = parseInt(document.getElementById('userLimitSick')?.value) || 0;
        
        window.addDebugLog(`New settings: ${JSON.stringify(userSettings)}`, 'info');
        
        // Save to server
        const saved = await saveUserSettings();
        
        if (saved) {
            // Apply UI changes
            applyUserPermissions();
            
            if (statusEl) {
                statusEl.textContent = '✓ Settings saved successfully!';
                statusEl.style.color = '#4caf50';
                setTimeout(() => {
                    statusEl.textContent = '';
                }, 3000);
            }
            
            // Refresh balances and UI to reflect new limits
            await loadBalances();
            await loadExpiryInfo();
            
            alert('Settings saved successfully! The app has been updated with your preferences.');
        } else {
            if (statusEl) {
                statusEl.textContent = '✗ Failed to save settings. Please try again.';
                statusEl.style.color = '#f44336';
                setTimeout(() => {
                    statusEl.textContent = '';
                }, 3000);
            }
            alert('Failed to save settings. Please check your connection and try again.');
        }
    }
    
    // Reset user settings to defaults
    function resetUserSettingsToDefault() {
        window.addDebugLog('resetUserSettingsToDefault() called', 'info');
        
        if (confirm('Reset all customization to default values? (OT: ON, CPL: ON, AL:22, CL:10, SL:10)')) {
            userSettings = {
                has_ot: true,
                has_cpl: true,
                limit_annual: 22,
                limit_casual: 10,
                limit_sick: 10
            };
            
            // Update UI
            updateSettingsUI();
            
            // Save to server
            saveUserSettingsAndApply();
        }
    }

    // ==================== ALARM & NOTIFICATION FUNCTIONS ====================

    // Load alarm settings on app start
    async function loadAlarmSettings() {
        if (!appAuthToken) return;
        
        try {
            const response = await fetch('/api/notifications?action=get', {
                headers: { 'Authorization': `Bearer ${appAuthToken}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    currentAlarmSettings = {
                        enabled: data.settings.is_alarm_enabled,
                        checkinTime: data.settings.checkin_time || '09:00',
                        tzOffset: data.settings.tz_offset
                    };
                    
                    // Update UI
                    const alarmEnabledCheckbox = document.getElementById('alarmEnabled');
                    const alarmTimeInput = document.getElementById('checkinAlarmTime');
                    
                    if (alarmEnabledCheckbox) alarmEnabledCheckbox.checked = currentAlarmSettings.enabled;
                    if (alarmTimeInput) alarmTimeInput.value = currentAlarmSettings.checkinTime;
                    
                    window.addDebugLog('[Alarm] Settings loaded:', currentAlarmSettings);
                }
            }
        } catch (error) {
            window.addDebugLog('[Alarm] Failed to load settings:', error);
        }
        
        // Update target time display
        await updateTargetTimeDisplay();
        
        // Check notification permission status
        updateNotificationStatus();
    }

    // Save alarm settings
    async function saveAlarmSettings() {
        const isEnabled = document.getElementById('alarmEnabled')?.checked || false;
        const checkinTime = document.getElementById('checkinAlarmTime')?.value || '09:00';
        
        if (!checkinTime && isEnabled) {
            alert('Please select a check-in time');
            return;
        }
        
        // Get user's current timezone offset in minutes (negative for UTC-)
        const tzOffset = new Date().getTimezoneOffset();
        
        window.addDebugLog(`[Alarm] Saving: enabled=${isEnabled}, time=${checkinTime}, offset=${tzOffset}`, 'info');
        
        try {
            const response = await fetch('/api/notifications?action=save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${appAuthToken}`
                },
                body: JSON.stringify({
                    is_alarm_enabled: isEnabled,
                    checkin_time_local: checkinTime,
                    tz_offset: tzOffset
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentAlarmSettings = {
                    enabled: isEnabled,
                    checkinTime: checkinTime,
                    tzOffset: tzOffset
                };
                
                window.addDebugLog('[Alarm] Settings saved successfully', 'success');
                alert('✅ Alarm settings saved!');
                await updateTargetTimeDisplay();
                
                // Update user object in localStorage
                if (appCurrentUser) {
                    appCurrentUser.is_alarm_enabled = isEnabled;
                    appCurrentUser.default_checkin_time = checkinTime;
                    appCurrentUser.tz_offset = tzOffset;
                    localStorage.setItem('auth_user', JSON.stringify(appCurrentUser));
                }
            } else {
                alert('Failed to save: ' + data.message);
            }
        } catch (error) {
            window.addDebugLog(`[Alarm] Save error: ${error.message}`, 'error');
            alert('Failed to save alarm settings');
        }
    }

    // Update target time display based on actual check-in or planned time
    async function updateTargetTimeDisplay() {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        const todayEntry = await fetchOrCreateEntry(today);
        
        const hasOT = userSettings.has_ot;
        const baseHours = todayEntry?.base_hours_rule || 8;
        const otHours = hasOT ? (todayEntry?.final_ot_hours || 0) : 0;
        const totalWorkHours = baseHours + otHours;
        
        const targetDisplay = document.getElementById('targetTimeDisplay');
        const calculationDisplay = document.getElementById('targetCalculation');
        
        if (!targetDisplay || !calculationDisplay) return;
        
        if (todayEntry?.check_in && !todayEntry?.check_out) {
            // User is checked in - calculate based on actual check-in time
            const checkinTime = new Date(todayEntry.check_in);
            const targetTime = new Date(checkinTime.getTime() + (totalWorkHours * 60 * 60 * 1000));
            
            const targetHours = targetTime.getHours();
            const targetMinutes = targetTime.getMinutes();
            const ampm = targetHours >= 12 ? 'PM' : 'AM';
            const hour12 = targetHours % 12 || 12;
            
            targetDisplay.textContent = `${hour12}:${String(targetMinutes).padStart(2, '0')} ${ampm}`;
            calculationDisplay.innerHTML = `📊 Expected: ${formatTimeDisplay(checkinTime)} + ${baseHours}h Base + ${otHours}h OT = ${targetDisplay.textContent}`;
            
        } else {
            // Not checked in - use planned alarm time
            const alarmTime = currentAlarmSettings.checkinTime;
            if (alarmTime && currentAlarmSettings.enabled) {
                const [hours, minutes] = alarmTime.split(':').map(Number);
                const ampm = hours >= 12 ? 'PM' : 'AM';
                const hour12 = hours % 12 || 12;
                const checkinDisplay = `${hour12}:${String(minutes).padStart(2, '0')} ${ampm}`;
                
                // Calculate target from planned time
                const baseDate = new Date();
                baseDate.setHours(hours, minutes, 0, 0);
                const targetDate = new Date(baseDate.getTime() + (totalWorkHours * 60 * 60 * 1000));
                const targetHours = targetDate.getHours();
                const targetMinutes = targetDate.getMinutes();
                const targetAmpm = targetHours >= 12 ? 'PM' : 'AM';
                const targetHour12 = targetHours % 12 || 12;
                
                targetDisplay.textContent = `${targetHour12}:${String(targetMinutes).padStart(2, '0')} ${targetAmpm}`;
                calculationDisplay.innerHTML = `📅 Planned: ${checkinDisplay} + ${baseHours}h Base + ${otHours}h OT = ${targetDisplay.textContent}`;
            } else {
                targetDisplay.textContent = '--:--';
                calculationDisplay.innerHTML = 'Enable alarms and set check-in time to see target calculation';
            }
        }
    }

    // Helper function to format time display
    function formatTimeDisplay(date) {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        return `${hour12}:${String(minutes).padStart(2, '0')} ${ampm}`;
    }

    // Update notification status display
    function updateNotificationStatus() {
        const notifStatus = document.getElementById('notifStatus');
        if (!notifStatus) return;
        
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                notifStatus.innerHTML = '✅ Notifications: Enabled';
            } else if (Notification.permission === 'denied') {
                notifStatus.innerHTML = '❌ Notifications: Blocked - Please enable in browser settings';
            } else {
                notifStatus.innerHTML = '🔔 Notifications: Click Enable to receive reminders';
            }
        } else {
            notifStatus.innerHTML = '⚠️ Notifications not supported in this browser';
        }
    }

    // Request notification permission and subscribe to push
    async function requestNotificationPermission() {
        if (!('Notification' in window)) {
            alert('This browser does not support notifications');
            return;
        }
        
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
            // Register service worker and subscribe to push
            await subscribeToPushNotifications();
            updateNotificationStatus();
            alert('✅ Notifications enabled! You will receive check-in reminders.');
        } else {
            updateNotificationStatus();
            alert('❌ Notifications blocked. You can enable them in browser settings.');
        }
    }

    // Subscribe to push notifications
    async function subscribeToPushNotifications() {
        if (!appAuthToken) return;
        
        try {
            const registration = await navigator.serviceWorker.ready;
            
            // Check if already subscribed
            let subscription = await registration.pushManager.getSubscription();
            
            if (!subscription) {
                // VAPID public key - replace with your actual key from Vercel env
                const vapidPublicKey = 'YOUR_VAPID_PUBLIC_KEY';
                
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
                });
            }
            
            // Send subscription to server
            const response = await fetch('/api/notifications?action=subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${appAuthToken}`
                },
                body: JSON.stringify(subscription)
            });
            
            if (response.ok) {
                window.addDebugLog('[Push] Subscribed successfully', 'success');
            } else {
                window.addDebugLog('[Push] Subscription failed', 'error');
            }
        } catch (error) {
            window.addDebugLog(`[Push] Subscription failed: ${error.message}`, 'error');
        }
    }

    // Helper: Convert base64 to Uint8Array for VAPID key
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    // ==================== OTP FUNCTIONS WITH ENHANCED DEBUG LOGS ====================

    // Show OTP verification modal
    function showOTPModal(otpData, purpose, email) {
        window.addDebugLog(`========== SHOW OTP MODAL START ==========`, 'info');
        window.addDebugLog(`Purpose: ${purpose}, Email: ${email}`, 'info');
        window.addDebugLog(`OTP Data received: ${JSON.stringify({
            otpCode: otpData.otpCode,
            appEmail: otpData.appEmail,
            expiry: otpData.expiry
        })}`, 'debug');
        
        currentOTPData = otpData;
        verificationPurpose = purpose;
        pendingEmail = email;
        
        window.addDebugLog(`[STORED] verificationPurpose = ${verificationPurpose} (type: ${typeof verificationPurpose})`, 'info');
        window.addDebugLog(`[STORED] pendingEmail = ${pendingEmail}`, 'info');
        
        document.getElementById('appEmailDisplay').textContent = otpData.appEmail;
        document.getElementById('otpCodeDisplay').textContent = otpData.otpCode;
        
        // Calculate remaining time
        const expiry = new Date(otpData.expiry);
        const now = new Date();
        const remainingSeconds = Math.max(0, Math.floor((expiry - now) / 1000));
        window.addDebugLog(`OTP expiry: ${expiry.toISOString()}, remaining: ${remainingSeconds} seconds`, 'info');
        
        startOTPTimer(expiry);
        
        document.getElementById('otpModal').style.display = 'flex';
        window.addDebugLog(`OTP modal shown for purpose: ${purpose}`, 'success');
        window.addDebugLog(`========== SHOW OTP MODAL END ==========`, 'info');
    }

    // Start OTP countdown timer
    function startOTPTimer(expiryDate) {
        if (otpTimerInterval) clearInterval(otpTimerInterval);
        
        window.addDebugLog(`Starting OTP timer, expires at: ${expiryDate.toISOString()}`, 'info');
        
        function updateTimer() {
            const now = new Date();
            const diff = expiryDate - now;
            
            if (diff <= 0) {
                window.addDebugLog(`OTP timer expired at: ${now.toISOString()}`, 'warning');
                document.getElementById('otpTimer').textContent = '00:00';
                document.getElementById('otpTimer').classList.add('expired');
                document.getElementById('verifyOtpBtn').disabled = true;
                document.getElementById('verifyOtpBtn').style.opacity = '0.5';
                clearInterval(otpTimerInterval);
                window.addDebugLog('OTP expired, verification button disabled', 'warning');
                return;
            }
            
            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            document.getElementById('otpTimer').textContent = timeStr;
            document.getElementById('otpTimer').classList.remove('expired');
            document.getElementById('verifyOtpBtn').disabled = false;
            document.getElementById('verifyOtpBtn').style.opacity = '1';
            
            if (seconds % 10 === 0) {
                window.addDebugLog(`OTP timer: ${timeStr} remaining`, 'debug');
            }
        }
        
        updateTimer();
        otpTimerInterval = setInterval(updateTimer, 1000);
    }

    // Close OTP modal
    function closeOTPModal() {
        window.addDebugLog(`Closing OTP modal - Purpose: ${verificationPurpose}, Email: ${pendingEmail}`, 'info');
        document.getElementById('otpModal').style.display = 'none';
        if (otpTimerInterval) {
            clearInterval(otpTimerInterval);
            otpTimerInterval = null;
            window.addDebugLog('OTP timer cleared', 'info');
        }
        document.getElementById('otpError').textContent = '';
    }

    // Copy to clipboard
    function copyToClipboard(elementId) {
        const element = document.getElementById(elementId);
        const text = element.textContent;
        
        window.addDebugLog(`Copying to clipboard: ${text} (case-insensitive)`, 'info');
        
        navigator.clipboard.writeText(text).then(() => {
            window.addDebugLog(`Successfully copied OTP to clipboard`, 'success');
            alert('Copied to clipboard! (OTP is case-insensitive)');
        }).catch(err => {
            window.addDebugLog(`Failed to copy to clipboard: ${err.message}`, 'error');
            alert('Failed to copy. Please select and copy manually.');
        });
    }

    // Open email client with pre-filled subject
    function openMailClient() {
        if (!currentOTPData) {
            window.addDebugLog('openMailClient: No OTP data available', 'error');
            return;
        }
        
        const subject = encodeURIComponent(currentOTPData.otpCode);
        const to = currentOTPData.appEmail;
        const body = encodeURIComponent(
            `Please verify my email for Attendance Diary App.\n\n` +
            `OTP: ${currentOTPData.otpCode}\n\n` +
            `Sent from my Attendance Diary account.`
        );
        
        window.addDebugLog(`Opening mail client to: ${to}, subject: ${currentOTPData.otpCode}`, 'info');
        window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
        window.addDebugLog('Email client opened', 'success');
    }

    // Verify OTP - ENHANCED WITH DETAILED LOGGING
    async function verifyOTP() {
        window.addDebugLog(`\n========== VERIFY OTP START ==========`, 'info');
        window.addDebugLog(`[CHECK] Current OTP Data exists: ${!!currentOTPData}`, 'info');
        window.addDebugLog(`[CHECK] Pending Email: ${pendingEmail}`, 'info');
        window.addDebugLog(`[CHECK] Verification Purpose: ${verificationPurpose}`, 'info');
        window.addDebugLog(`[CHECK] Verification Purpose type: ${typeof verificationPurpose}`, 'info');
        window.addDebugLog(`[CHECK] Purpose === 'reset'? ${verificationPurpose === 'reset' ? 'YES' : 'NO'}`, 'info');
        window.addDebugLog(`[CHECK] Purpose === 'register'? ${verificationPurpose === 'register' ? 'YES' : 'NO'}`, 'info');
        
        if (!currentOTPData || !pendingEmail) {
            const errorMsg = !currentOTPData ? 'Missing OTP data' : 'Missing email';
            window.addDebugLog(`Verify OTP failed: ${errorMsg}`, 'error');
            document.getElementById('otpError').textContent = 'Missing verification data';
            return;
        }
        
        document.getElementById('otpError').textContent = '';
        document.getElementById('verifyOtpBtn').disabled = true;
        document.getElementById('verifyOtpBtn').textContent = 'Verifying...';
        
        window.addDebugLog(`[REQUEST] Sending verification request:`, 'info');
        window.addDebugLog(`  - email: ${pendingEmail}`, 'debug');
        window.addDebugLog(`  - otpCode: ${currentOTPData.otpCode}`, 'debug');
        window.addDebugLog(`  - purpose: ${verificationPurpose}`, 'debug');
        
        try {
            const response = await fetch('/api/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: pendingEmail,
                    otpCode: currentOTPData.otpCode,
                    purpose: verificationPurpose
                })
            });
            
            window.addDebugLog(`[RESPONSE] Verify OTP response status: ${response.status}`, 'info');
            const data = await response.json();
            window.addDebugLog(`[RESPONSE] Verify OTP response data: ${JSON.stringify(data)}`, 'debug');
            
            if (data.success) {
                window.addDebugLog(`✅ OTP verified successfully for ${pendingEmail}`, 'success');
                
                // SAVE VALUES BEFORE CLOSING MODAL
                const savedPurpose = verificationPurpose;
                const savedEmail = pendingEmail;
                
                window.addDebugLog(`[SAVED] Purpose before close: "${savedPurpose}" (type: ${typeof savedPurpose})`, 'info');
                window.addDebugLog(`[SAVED] Email before close: ${savedEmail}`, 'info');
                
                // Close modal but keep variables
                closeOTPModal();
                
                window.addDebugLog(`[AFTER CLOSE] Checking savedPurpose: "${savedPurpose}"`, 'info');
                window.addDebugLog(`[AFTER CLOSE] savedPurpose === 'reset'? ${savedPurpose === 'reset' ? 'YES - WILL SHOW RESET MODAL' : 'NO'}`, 'info');
                window.addDebugLog(`[AFTER CLOSE] savedPurpose === 'register'? ${savedPurpose === 'register' ? 'YES - WILL SHOW LOGIN' : 'NO'}`, 'info');
                
                if (savedPurpose === 'register') {
                    window.addDebugLog('[FLOW] REGISTRATION verification complete, redirecting to login', 'success');
                    alert('Email verified successfully! You can now login.');
                    showLogin();
                } else if (savedPurpose === 'reset') {
                    window.addDebugLog('[FLOW] ========== PASSWORD RESET FLOW ==========', 'success');
                    window.addDebugLog('[FLOW] OTP verified for password reset', 'success');
                    window.addDebugLog('[FLOW] Calling showResetPasswordModal directly (no setTimeout)', 'info');
                    
                    // Call directly without setTimeout
                    showResetPasswordModal(savedEmail);
                    
                    window.addDebugLog('[FLOW] showResetPasswordModal function called', 'info');
                } else {
                    window.addDebugLog(`[FLOW] Unknown purpose: ${savedPurpose}`, 'warning');
                }
                
                // Clear the variables after use
                currentOTPData = null;
                verificationPurpose = null;
                pendingEmail = null;
                window.addDebugLog(`[CLEANUP] Variables cleared`, 'debug');
                
            } else {
                const errorMsg = data.message || 'Verification failed';
                window.addDebugLog(`❌ OTP verification failed: ${errorMsg}`, 'error');
                document.getElementById('otpError').textContent = errorMsg;
                document.getElementById('verifyOtpBtn').disabled = false;
                document.getElementById('verifyOtpBtn').textContent = "I've Sent the Email";
            }
        } catch (error) {
            window.addDebugLog(`❌ OTP verification error: ${error.message}`, 'error');
            document.getElementById('otpError').textContent = 'Verification failed. Please try again.';
            document.getElementById('verifyOtpBtn').disabled = false;
            document.getElementById('verifyOtpBtn').textContent = "I've Sent the Email";
        }
        window.addDebugLog(`========== VERIFY OTP END ==========\n`, 'info');
    }

    // ==================== FORGOT PASSWORD FLOW WITH DEBUG ====================

    // Show forgot password prompt
    function showForgotPassword() {
        window.addDebugLog('showForgotPassword() called', 'info');
        const email = prompt('Enter your email address:');
        if (!email) {
            window.addDebugLog('Forgot password cancelled - no email entered', 'info');
            return;
        }
        
        window.addDebugLog(`Forgot password requested for email: ${email}`, 'info');
        
        // Create hidden input for email if not exists
        if (!document.getElementById('forgotEmail')) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.id = 'forgotEmail';
            document.body.appendChild(input);
            window.addDebugLog('Created hidden forgotEmail input element', 'debug');
        }
        document.getElementById('forgotEmail').value = email;
        
        initiateForgotPassword(email);
    }

    // Initiate forgot password flow
    async function initiateForgotPassword(email) {
        window.addDebugLog(`========== INITIATE FORGOT PASSWORD START ==========`, 'info');
        window.addDebugLog(`Email: ${email}`, 'info');
        
        try {
            const response = await fetch('/api/account?action=forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            
            window.addDebugLog(`Forgot password response status: ${response.status}`, 'info');
            const data = await response.json();
            window.addDebugLog(`Forgot password response data: ${JSON.stringify(data)}`, 'debug');
            
            if (data.success) {
                if (data.requiresVerification) {
                    window.addDebugLog(`Password reset requires OTP verification for ${email}`, 'info');
                    window.addDebugLog(`OTP Code received: ${data.otpCode}`, 'debug');
                    window.addDebugLog(`App email: ${data.appEmail}`, 'info');
                    window.addDebugLog(`OTP expiry: ${data.expiry}`, 'info');
                    
                    // Store email and show OTP modal with purpose 'reset'
                    showOTPModal({
                        appEmail: data.appEmail,
                        otpCode: data.otpCode,
                        expiry: data.expiry
                    }, 'reset', email);
                } else {
                    window.addDebugLog(`Password reset initiated without OTP: ${data.message}`, 'info');
                    alert(data.message);
                }
            } else {
                const errorMsg = data.message || 'Failed to process request';
                window.addDebugLog(`Forgot password failed: ${errorMsg}`, 'error');
                alert(errorMsg);
            }
        } catch (error) {
            window.addDebugLog(`Forgot password error: ${error.message}`, 'error');
            alert('Failed to process request. Please try again.');
        }
        window.addDebugLog(`========== INITIATE FORGOT PASSWORD END ==========`, 'info');
    }

    // ==================== RESET PASSWORD MODAL FUNCTIONS ====================
    
    // Show reset password modal
    function showResetPasswordModal(email) {
        window.addDebugLog(`\n========== SHOW RESET PASSWORD MODAL START ==========`, 'info');
        window.addDebugLog(`[MODAL] Email for password reset: ${email}`, 'info');
        window.addDebugLog(`[MODAL] Function called at: ${new Date().toISOString()}`, 'info');
        
        // Remove existing modal if any
        const existingModal = document.getElementById('resetPasswordModal');
        if (existingModal) {
            window.addDebugLog('[MODAL] Removing existing reset password modal', 'debug');
            existingModal.remove();
        }
        
        // Create modal container
        const modal = document.createElement('div');
        modal.id = 'resetPasswordModal';
        modal.className = 'modal';
        modal.style.display = 'flex';
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        modalContent.style.maxWidth = '400px';
        
        modalContent.innerHTML = `
            <h3 style="margin: 0 0 8px 0; color: #333;">🔐 Reset Password</h3>
            <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
                Set a new password for<br>
                <strong style="color: #667eea; word-break: break-all;">${escapeHtml(email)}</strong>
            </p>
            
            <div class="input-group" style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; color: #555; font-size: 14px; font-weight: 500;">New Password</label>
                <input type="password" id="resetNewPassword" class="modal-input" placeholder="Enter new password (min 6 characters)" style="width: 100%; padding: 14px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 15px; box-sizing: border-box;">
            </div>
            
            <div class="input-group" style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; color: #555; font-size: 14px; font-weight: 500;">Confirm Password</label>
                <input type="password" id="resetConfirmPassword" class="modal-input" placeholder="Re-enter new password" style="width: 100%; padding: 14px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 15px; box-sizing: border-box;">
            </div>
            
            <div id="resetError" class="error-message" style="color: #e74c3c; font-size: 13px; margin-bottom: 16px; min-height: 20px; text-align: center;"></div>
            
            <div class="modal-buttons" style="display: flex; gap: 12px; margin-top: 20px;">
                <button onclick="closeResetPasswordModal()" class="modal-cancel" style="flex: 1; padding: 14px; background: #e0e0e0; color: #666; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 15px;">Cancel</button>
                <button onclick="submitNewPassword('${escapeHtml(email)}')" class="modal-save" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 15px;">Reset Password</button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        window.addDebugLog('[MODAL] Modal HTML created and appended to body', 'success');
        
        // Focus on password field
        setTimeout(() => {
            const passwordField = document.getElementById('resetNewPassword');
            if (passwordField) {
                passwordField.focus();
                window.addDebugLog('[MODAL] Password field focused', 'debug');
            } else {
                window.addDebugLog('[MODAL] Password field not found!', 'error');
            }
        }, 100);
        
        window.addDebugLog(`[MODAL] Reset password modal shown for ${email}`, 'success');
        window.addDebugLog(`========== SHOW RESET PASSWORD MODAL END ==========\n`, 'info');
    }
    
    // Helper function to escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    // Close reset password modal
    function closeResetPasswordModal() {
        window.addDebugLog('Closing reset password modal', 'info');
        const modal = document.getElementById('resetPasswordModal');
        if (modal) {
            modal.remove();
            window.addDebugLog('Reset password modal removed', 'success');
        } else {
            window.addDebugLog('Reset password modal not found', 'warning');
        }
    }

    // Submit new password after reset
    async function submitNewPassword(email) {
        window.addDebugLog(`========== SUBMIT NEW PASSWORD START ==========`, 'info');
        window.addDebugLog(`Email: ${email}`, 'info');
        
        const newPassword = document.getElementById('resetNewPassword')?.value;
        const confirmPassword = document.getElementById('resetConfirmPassword')?.value;
        
        if (!newPassword || !confirmPassword) {
            const errorMsg = 'Please fill in both password fields';
            window.addDebugLog(`Password validation failed: ${errorMsg}`, 'warning');
            const errorEl = document.getElementById('resetError');
            if (errorEl) errorEl.textContent = errorMsg;
            return;
        }
        
        window.addDebugLog(`Password length: ${newPassword.length} chars`, 'debug');
        
        // Validate passwords
        if (newPassword.length < 6) {
            const errorMsg = 'Password must be at least 6 characters';
            window.addDebugLog(`Password validation failed: ${errorMsg}`, 'warning');
            const errorEl = document.getElementById('resetError');
            if (errorEl) errorEl.textContent = errorMsg;
            return;
        }
        
        if (newPassword !== confirmPassword) {
            const errorMsg = 'Passwords do not match';
            window.addDebugLog(`Password validation failed: ${errorMsg}`, 'warning');
            const errorEl = document.getElementById('resetError');
            if (errorEl) errorEl.textContent = errorMsg;
            return;
        }
        
        // Disable button to prevent double submission
        const submitBtn = document.querySelector('#resetPasswordModal .modal-save');
        const originalText = submitBtn ? submitBtn.textContent : 'Reset Password';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Resetting...';
            submitBtn.style.opacity = '0.6';
            submitBtn.style.cursor = 'not-allowed';
        }
        
        try {
            window.addDebugLog(`Sending password reset request for ${email}`, 'info');
            const response = await fetch('/api/account?action=reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, newPassword })
            });
            
            window.addDebugLog(`Reset password response status: ${response.status}`, 'info');
            const data = await response.json();
            window.addDebugLog(`Reset password response: ${JSON.stringify(data)}`, 'debug');
            
            if (data.success) {
                window.addDebugLog(`✅ Password reset successful for ${email}`, 'success');
                alert('✅ Password reset successfully! You can now login with your new password.');
                closeResetPasswordModal();
                showLogin();
            } else {
                const errorMsg = data.message || 'Password reset failed';
                window.addDebugLog(`❌ Password reset failed: ${errorMsg}`, 'error');
                const errorEl = document.getElementById('resetError');
                if (errorEl) errorEl.textContent = errorMsg;
                
                // Re-enable button
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                }
            }
        } catch (error) {
            window.addDebugLog(`Password reset error: ${error.message}`, 'error');
            const errorEl = document.getElementById('resetError');
            if (errorEl) errorEl.textContent = 'Failed to reset password. Please try again.';
            
            // Re-enable button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            }
        }
        window.addDebugLog(`========== SUBMIT NEW PASSWORD END ==========`, 'info');
    }

    // ==================== AUTH FUNCTIONS WITH DEBUG ====================
    function showRegister() {
        window.addDebugLog('showRegister() called', 'info');
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('registerScreen').style.display = 'block';
    }

    function showLogin() {
        window.addDebugLog('showLogin() called', 'info');
        document.getElementById('registerScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'block';
    }

    async function checkAuth() {
        window.addDebugLog('checkAuth() called', 'info');
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
                
                // Load user settings
                await loadUserSettings();
                
                // Load alarm settings
                await loadAlarmSettings();
                
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

    // UPDATED LOGIN FUNCTION
    async function login() {
        window.addDebugLog(`========== LOGIN START ==========`, 'info');
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        
        window.addDebugLog(`Login attempt for email: ${email}`, 'info');
        
        if (!email || !password) {
            const errorMsg = 'Email and password required';
            window.addDebugLog(`Login validation failed: ${errorMsg}`, 'warning');
            errorEl.textContent = errorMsg;
            return;
        }
        
        try {
            window.addDebugLog(`Sending login request to /api/auth?action=login`, 'info');
            const response = await fetch('/api/auth?action=login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            window.addDebugLog(`Login response status: ${response.status}`, 'info');
            
            const data = await response.json();
            window.addDebugLog(`Login response data: ${JSON.stringify({
                success: data.success,
                message: data.message,
                hasUser: !!data.user,
                hasToken: !!data.token,
                requiresVerification: data.requiresVerification
            })}`, 'debug');
            
            if (data.success) {
                window.addDebugLog(`✅ Login successful for ${email}`, 'success');
                window.addDebugLog(`User ID: ${data.user.id}`, 'info');
                
                appAuthToken = data.token;
                appCurrentUser = data.user;
                
                localStorage.setItem('auth_token', data.token);
                localStorage.setItem('auth_user', JSON.stringify(data.user));
                window.addDebugLog(`Auth token stored in localStorage`, 'debug');
                
                if (window.dbAPI) {
                    window.addDebugLog(`Initializing database for user: ${appCurrentUser.id}`, 'info');
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                    window.addDebugLog(`Database initialization complete`, 'success');
                }
                
                // Load user settings
                await loadUserSettings();
                
                // Load alarm settings
                await loadAlarmSettings();
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                window.addDebugLog(`UI switched to app screen`, 'info');
                
                await loadTodayEntry();
                await loadBalances();
                updateLastSyncTime();
                loadTemplateToUI();
                await loadAdjustments();
                await loadExpiryInfo();
                window.addDebugLog(`Initial data loaded`, 'success');
                
                setTimeout(() => {
                    window.addDebugLog(`Triggering auto sync from cloud`, 'info');
                    syncFromCloud();
                }, 2000);
                
                errorEl.textContent = '';
            } else {
                // Only show OTP modal if the account requires verification AND user is not verified
                if (data.requiresVerification && data.otpCode && data.message?.includes('not verified')) {
                    window.addDebugLog(`Login failed - account requires verification for ${data.email}`, 'warning');
                    window.addDebugLog(`OTP Code: ${data.otpCode}`, 'debug');
                    window.addDebugLog(`App Email: ${data.appEmail}`, 'info');
                    window.addDebugLog(`OTP Expiry: ${data.expiry}`, 'info');
                    
                    // Show OTP modal directly for verification
                    if (confirm('Your email is not verified. Would you like to verify now?')) {
                        window.addDebugLog(`User requested verification for ${data.email}`, 'info');
                        showOTPModal({
                            appEmail: data.appEmail,
                            otpCode: data.otpCode,
                            expiry: data.expiry
                        }, 'register', data.email);
                    }
                } else if (response.status === 404) {
                    // User not found - show clear message
                    window.addDebugLog(`❌ Login failed: Account not found`, 'error');
                    errorEl.textContent = 'Account not found. Please register first.';
                } else {
                    const errorMsg = data.message || 'Login failed';
                    window.addDebugLog(`❌ Login failed: ${errorMsg}`, 'error');
                    errorEl.textContent = errorMsg;
                }
            }
        } catch (error) {
            const errorMsg = 'Connection error: ' + error.message;
            window.addDebugLog(`❌ Login error: ${errorMsg}`, 'error');
            errorEl.textContent = errorMsg;
        }
        window.addDebugLog(`========== LOGIN END ==========`, 'info');
    }

    // UPDATED REGISTER FUNCTION
    async function register() {
        window.addDebugLog(`========== REGISTER START ==========`, 'info');
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const errorEl = document.getElementById('registerError');
        
        window.addDebugLog(`Registration attempt - Name: ${name}, Email: ${email}`, 'info');
        window.addDebugLog(`Password length: ${password.length} chars`, 'debug');
        
        if (!name || !email || !password) {
            const errorMsg = 'All fields required';
            window.addDebugLog(`Registration validation failed: ${errorMsg}`, 'warning');
            errorEl.textContent = errorMsg;
            return;
        }
        
        if (password.length < 6) {
            const errorMsg = 'Password too short (min 6 characters)';
            window.addDebugLog(`Registration validation failed: ${errorMsg}`, 'warning');
            errorEl.textContent = errorMsg;
            return;
        }
        
        try {
            window.addDebugLog(`Sending registration request to /api/auth?action=register`, 'info');
            const response = await fetch('/api/auth?action=register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name })
            });
            
            window.addDebugLog(`Registration response status: ${response.status}`, 'info');
            
            const data = await response.json();
            window.addDebugLog(`Registration response data: ${JSON.stringify({
                success: data.success,
                message: data.message,
                hasUser: !!data.user,
                requiresVerification: data.requiresVerification,
                hasOTPCode: !!data.otpCode,
                appEmail: data.appEmail,
                isUnverifiedUser: data.isUnverifiedUser
            })}`, 'debug');
            
            if (data.success) {
                window.addDebugLog(`✅ Registration successful for ${email}`, 'success');
                window.addDebugLog(`User ID: ${data.user?.id || 'N/A'}`, 'info');
                
                if (data.requiresVerification && data.otpCode) {
                    window.addDebugLog(`Registration requires OTP verification`, 'info');
                    window.addDebugLog(`OTP Code: ${data.otpCode}`, 'debug');
                    window.addDebugLog(`App Email: ${data.appEmail}`, 'info');
                    window.addDebugLog(`OTP Expiry: ${data.expiry}`, 'info');
                    
                    // Show OTP modal for verification
                    showOTPModal({
                        appEmail: data.appEmail,
                        otpCode: data.otpCode,
                        expiry: data.expiry
                    }, 'register', email);
                } else {
                    window.addDebugLog(`No OTP verification required, showing login screen`, 'info');
                    alert('Registration successful! Please check your email for verification instructions.');
                    showLogin();
                }
            } else {
                const errorMsg = data.message || 'Registration failed';
                window.addDebugLog(`❌ Registration failed: ${errorMsg}`, 'error');
                errorEl.textContent = errorMsg;
            }
        } catch (error) {
            const errorMsg = 'Connection error: ' + error.message;
            window.addDebugLog(`❌ Registration error: ${errorMsg}`, 'error');
            errorEl.textContent = errorMsg;
        }
        window.addDebugLog(`========== REGISTER END ==========`, 'info');
    }

    // ==================== CHANGE PASSWORD ====================
    function showChangePasswordModal() {
        window.addDebugLog('showChangePasswordModal() called', 'info');
        document.getElementById('changePasswordModal').style.display = 'flex';
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('passwordError').textContent = '';
    }

    function closeChangePasswordModal() {
        window.addDebugLog('closeChangePasswordModal() called', 'info');
        document.getElementById('changePasswordModal').style.display = 'none';
    }

    async function changePassword() {
        window.addDebugLog('changePassword() called', 'info');
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
            const response = await fetch('/api/account?action=change-password', {
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
        window.addDebugLog('showDeleteAccountModal() called', 'info');
        document.getElementById('deleteAccountModal').style.display = 'flex';
        document.getElementById('deleteConfirm').value = '';
        document.getElementById('deleteError').textContent = '';
    }

    function closeDeleteAccountModal() {
        window.addDebugLog('closeDeleteAccountModal() called', 'info');
        document.getElementById('deleteAccountModal').style.display = 'none';
    }

    async function deleteAccount() {
        window.addDebugLog('deleteAccount() called', 'info');
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
            const response = await fetch('/api/account?action=delete-account', {
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
        window.addDebugLog('logout() called', 'info');
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
        entry.is_manual_adjustment = false;
        
        await saveAndSync(entry, false, true);
        
        // Update target time display after check-in
        await updateTargetTimeDisplay();
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
        entry.is_manual_adjustment = false;
        
        await saveAndSync(entry, false, true);
        
        // Update target time display after check-out
        await updateTargetTimeDisplay();
    }

    async function markLeave(type) {
        if (!appCurrentUser) return;
        
        // Check if this leave type is enabled
        let isEnabled = true;
        
        switch(type) {
            case 'annual':
                isEnabled = userSettings.limit_annual > 0;
                break;
            case 'sick':
                isEnabled = userSettings.limit_sick > 0;
                break;
            case 'casual':
                isEnabled = userSettings.limit_casual > 0;
                break;
            case 'cpl':
                isEnabled = userSettings.has_cpl;
                break;
        }
        
        if (!isEnabled) {
            alert(`⚠️ ${type.toUpperCase()} leave is disabled for your account.`);
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await fetchOrCreateEntry(today);
        
        if (entry && (entry.check_in || entry.check_out)) {
            if (!confirm('This day already has check-in/out. Override with leave?')) {
                return;
            }
        }
        
        entry.check_in = null;
        entry.check_out = null;
        entry.is_off_day = false;
        entry.is_holiday = false;
        entry.is_manual_adjustment = false;
        
        entry.al_used = 0;
        entry.sl_used = 0;
        entry.cl_used = 0;
        entry.cpl_used = 0;
        
        entry[`${type}_used`] = 1;
        
        window.addDebugLog(`markLeave: Setting ${type}_used to 1 for ${today}`, 'info');
        
        await saveAndSync(entry, false, true);
        
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
        
        await loadBalances();
        
        // Update target time display
        await updateTargetTimeDisplay();
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
        
        await saveAndSync(entry, false, true);
        
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
        
        // Update target time display
        await updateTargetTimeDisplay();
    }

    async function loadTodayEntry() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        try {
            const today = new Date().toISOString().split('T')[0];
            const entry = await fetchOrCreateEntry(today);
            
            if (entry) {
                const isLeaveDay = (entry.al_used && parseFloat(entry.al_used) > 0) || 
                                   (entry.sl_used && parseFloat(entry.sl_used) > 0) || 
                                   (entry.cl_used && parseFloat(entry.cl_used) > 0) || 
                                   (entry.cpl_used && parseFloat(entry.cpl_used) > 0);
                
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
            
            // Update target time display
            await updateTargetTimeDisplay();
            
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
        window.addDebugLog('showBulkManualEntry() called', 'info');
        document.getElementById('bulkManualModal').style.display = 'flex';
        document.getElementById('bulkFromDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('bulkToDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('bulkCheckIn').value = '';
        document.getElementById('bulkCheckOut').value = '';
        document.getElementById('bulkType').value = 'work';
        document.getElementById('bulkProgress').style.display = 'none';
    }

    function closeBulkManualEntry() {
        window.addDebugLog('closeBulkManualEntry() called', 'info');
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
                    // Check if leave type is enabled for this user
                    let isEnabled = true;
                    switch(type) {
                        case 'annual':
                            isEnabled = userSettings.limit_annual > 0;
                            break;
                        case 'sick':
                            isEnabled = userSettings.limit_sick > 0;
                            break;
                        case 'casual':
                            isEnabled = userSettings.limit_casual > 0;
                            break;
                        case 'cpl':
                            isEnabled = userSettings.has_cpl;
                            break;
                    }
                    
                    if (!isEnabled) {
                        window.addDebugLog(`saveBulkManualEntry: ${type} leave is disabled for user, skipping ${dateStr}`, 'warning');
                        errorCount++;
                        continue;
                    }
                    
                    entry.al_used = 0;
                    entry.sl_used = 0;
                    entry.cl_used = 0;
                    entry.cpl_used = 0;
                    
                    if (type === 'annual') {
                        entry.al_used = 1;
                    } else if (type === 'sick') {
                        entry.sl_used = 1;
                    } else if (type === 'casual') {
                        entry.cl_used = 1;
                    } else if (type === 'cpl') {
                        entry.cpl_used = 1;
                    }
                    
                    entry.check_in = null;
                    entry.check_out = null;
                    window.addDebugLog(`saveBulkManualEntry: Setting ${type}_used to 1 for ${dateStr}`, 'debug');
                }
                
                await saveAndSync(entry, true, true);
                successCount++;
                
            } catch (error) {
                window.addDebugLog(`Error processing ${dateStr}: ${error.message}`, 'error');
                errorCount++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        progressDiv.innerHTML = `Complete! Success: ${successCount}, Failed: ${errorCount}`;
        
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
        window.addDebugLog('showManualEntry() called', 'info');
        document.getElementById('manualEntryModal').style.display = 'flex';
        document.getElementById('manualDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('manualIn').value = '';
        document.getElementById('manualOut').value = '';
    }

    function closeManualEntry() {
        window.addDebugLog('closeManualEntry() called', 'info');
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
            // Check if leave type is enabled
            let isEnabled = true;
            switch(type) {
                case 'annual':
                    isEnabled = userSettings.limit_annual > 0;
                    break;
                case 'sick':
                    isEnabled = userSettings.limit_sick > 0;
                    break;
                case 'casual':
                    isEnabled = userSettings.limit_casual > 0;
                    break;
                case 'cpl':
                    isEnabled = userSettings.has_cpl;
                    break;
            }
            
            if (!isEnabled) {
                alert(`⚠️ ${type.toUpperCase()} leave is disabled for your account.`);
                return;
            }
            
            entry.al_used = 0;
            entry.sl_used = 0;
            entry.cl_used = 0;
            entry.cpl_used = 0;
            
            if (type === 'annual') {
                entry.al_used = 1;
            } else if (type === 'sick') {
                entry.sl_used = 1;
            } else if (type === 'casual') {
                entry.cl_used = 1;
            } else if (type === 'cpl') {
                entry.cpl_used = 1;
            }
            
            entry.check_in = null;
            entry.check_out = null;
            window.addDebugLog(`saveManualEntry: Setting ${type}_used to 1 for ${date}`, 'debug');
        }
        
        await saveAndSync(entry, false, true);
        
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
        window.addDebugLog('saveTemplate() called', 'info');
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
                base: friBase ? parseFloat(friBase.value) || 0 : 8.5, 
                maxOT: friOT ? parseFloat(friOT.value) || 0 : 1, 
                cpl: friCPL ? parseFloat(friCPL.value) || 0 : 0 
            },
            saturday: { 
                base: satBase ? parseFloat(satBase.value) || 0 : 8, 
                maxOT: satOT ? parseFloat(satOT.value) || 0 : 1, 
                cpl: satCPL ? parseFloat(satCPL.value) || 0 : 1 
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
        window.addDebugLog('showSingleDateOverride() called', 'info');
        document.getElementById('singleDateModal').style.display = 'flex';
        document.getElementById('singleDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('singleBase').value = '';
        document.getElementById('singleOT').value = '';
        document.getElementById('singleCPL').value = '';
    }

    function closeSingleDateOverride() {
        window.addDebugLog('closeSingleDateOverride() called', 'info');
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
        
        entry.is_manual_adjustment = false;
        
        if (type === 'work') {
            entry.is_holiday = false;
            entry.is_off_day = false;
            if (baseInput !== '') entry.base_hours_rule = parseFloat(baseInput);
            if (otInput !== '' && userSettings.has_ot) entry.ot_cap_rule = parseFloat(otInput);
            if (cplInput !== '' && userSettings.has_cpl) entry.cpl_grant_rule = parseFloat(cplInput);
        } 
        else if (type === 'holiday') {
            entry.is_holiday = true;
            entry.is_off_day = false;
            if (cplInput !== '' && userSettings.has_cpl) {
                entry.cpl_grant_rule = parseFloat(cplInput);
            }
            if (baseInput !== '') entry.base_hours_rule = parseFloat(baseInput);
            if (otInput !== '' && userSettings.has_ot) entry.ot_cap_rule = parseFloat(otInput);
        } 
        else if (type === 'off') {
            entry.is_off_day = true;
            entry.is_holiday = false;
            entry.base_hours_rule = null;
            entry.ot_cap_rule = null;
            entry.cpl_grant_rule = null;
        }
        
        await saveAndSync(entry, false, true);
        
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
        window.addDebugLog('applyTemplateToRange() called', 'info');
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
            
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                
                let entry = await fetchOrCreateEntry(dateStr);
                
                entry.is_manual_adjustment = false;
                
                const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                
                if (dayName === 'sunday') {
                    const sundayWeek = getSundayWeekNumber(d);
                    
                    if (sundayWeek % 2 === 1) {
                        entry.base_hours_rule = weeklyTemplate.sundayOdd.base;
                        if (userSettings.has_ot) entry.ot_cap_rule = weeklyTemplate.sundayOdd.maxOT;
                        if (userSettings.has_cpl) entry.cpl_grant_rule = weeklyTemplate.sundayOdd.cpl;
                    } else {
                        entry.base_hours_rule = weeklyTemplate.sundayEven.base;
                        if (userSettings.has_ot) entry.ot_cap_rule = weeklyTemplate.sundayEven.maxOT;
                        if (userSettings.has_cpl) entry.cpl_grant_rule = weeklyTemplate.sundayEven.cpl;
                    }
                } else {
                    entry.base_hours_rule = weeklyTemplate[dayName]?.base !== undefined ? weeklyTemplate[dayName].base : 8;
                    if (userSettings.has_ot) entry.ot_cap_rule = weeklyTemplate[dayName]?.maxOT !== undefined ? weeklyTemplate[dayName].maxOT : 1;
                    if (userSettings.has_cpl) entry.cpl_grant_rule = weeklyTemplate[dayName]?.cpl !== undefined ? weeklyTemplate[dayName].cpl : 0;
                }
                
                await saveAndSync(entry, true, true);
                count++;
                
                if (applyBtn) {
                    applyBtn.textContent = `⏳ ${count}/${daysDiff}`;
                }
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
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
        window.addDebugLog(`filterHistory() called with type: ${type}`, 'info');
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
        currentHistoryFilter = type;
        await loadHistory();
    }

    async function applyDateRange() {
        window.addDebugLog('applyDateRange() called', 'info');
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
                if (userSettings.has_ot) {
                    entries = entries.filter(e => e.final_ot_hours && e.final_ot_hours > 0);
                } else {
                    entries = [];
                }
                break;
            case 'cpl':
                if (userSettings.has_cpl) {
                    entries = entries.filter(e => e.cpl_earned && e.cpl_earned > 0);
                } else {
                    entries = [];
                }
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
            if (userSettings.has_ot && e.final_ot_hours && e.final_ot_hours > 0) totalOT += e.final_ot_hours;
            if (userSettings.has_cpl && e.cpl_earned && e.cpl_earned > 0) totalCPL += e.cpl_earned;
            if (e.al_used) totalLeave += parseFloat(e.al_used) || 0;
            if (e.sl_used) totalLeave += parseFloat(e.sl_used) || 0;
            if (e.cl_used) totalLeave += parseFloat(e.cl_used) || 0;
            if (userSettings.has_cpl && e.cpl_used) totalLeave += parseFloat(e.cpl_used) || 0;
        });
        
        const totalsDiv = document.createElement('div');
        totalsDiv.className = 'history-totals';
        let totalsHTML = '';
        
        if (userSettings.has_ot) {
            totalsHTML += `
                <div class="totals-row">
                    <span class="total-label">Total OT:</span>
                    <span class="total-value">${totalOT.toFixed(1)} hours</span>
                </div>
            `;
        }
        
        if (userSettings.has_cpl) {
            totalsHTML += `
                <div class="totals-row">
                    <span class="total-label">Total CPL:</span>
                    <span class="total-value">${totalCPL.toFixed(2)} days</span>
                </div>
            `;
        }
        
        totalsHTML += `
            <div class="totals-row">
                <span class="total-label">Total Leave:</span>
                <span class="total-value">${totalLeave.toFixed(2)} days</span>
            </div>
        `;
        
        totalsDiv.innerHTML = totalsHTML;
        list.appendChild(totalsDiv);
        
        entries.slice(0, 50).forEach(e => {
            const date = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
            let desc = '';
            let details = [];
            
            if (e.is_off_day) {
                desc = 'OFF DAY';
            } else if (e.is_holiday && userSettings.has_cpl && e.cpl_earned && e.cpl_earned > 0) {
                desc = 'HOLIDAY (Worked)';
                if (e.cpl_earned) details.push(`CPL: ${e.cpl_earned}`);
            } else if (e.is_holiday) {
                desc = 'HOLIDAY (No work)';
            } else if (e.al_used && parseFloat(e.al_used) > 0) {
                desc = `ANNUAL LEAVE (${parseFloat(e.al_used)} day)`;
            } else if (e.sl_used && parseFloat(e.sl_used) > 0) {
                desc = `SICK LEAVE (${parseFloat(e.sl_used)} day)`;
            } else if (e.cl_used && parseFloat(e.cl_used) > 0) {
                desc = `CASUAL LEAVE (${parseFloat(e.cl_used)} day)`;
            } else if (userSettings.has_cpl && e.cpl_used && parseFloat(e.cpl_used) > 0) {
                desc = `CPL USED (${parseFloat(e.cpl_used)} day)`;
            } else if (e.check_in && e.check_out) {
                const inTimePart = e.check_in.split('T')[1] || '00:00:00';
                const [inHours, inMinutes] = inTimePart.split(':');
                const outTimePart = e.check_out.split('T')[1] || '00:00:00';
                const [outHours, outMinutes] = outTimePart.split(':');
                
                desc = `${inHours}:${inMinutes} - ${outHours}:${outMinutes}`;
                if (e.base_hours_rule !== null) details.push(`${e.base_hours_rule}h Base`);
                if (userSettings.has_ot && e.final_ot_hours && e.final_ot_hours > 0) details.push(`OT: ${e.final_ot_hours}h`);
            }
            
            if (e.al_accrued > 0) {
                details.push(`AL Accrued: +${e.al_accrued}`);
            }
            
            if (e.al_adjustment && e.al_adjustment !== 0) {
                details.push(`AL Adjustment: ${e.al_adjustment > 0 ? '+' : ''}${e.al_adjustment}`);
            }
            
            if (e.sl_adjustment && e.sl_adjustment !== 0) {
                details.push(`SL Adjustment: ${e.sl_adjustment > 0 ? '+' : ''}${e.sl_adjustment}`);
            }
            
            if (e.cl_adjustment && e.cl_adjustment !== 0) {
                details.push(`CL Adjustment: ${e.cl_adjustment > 0 ? '+' : ''}${e.cl_adjustment}`);
            }
            
            if (userSettings.has_cpl && e.cpl_adjustment && e.cpl_adjustment !== 0) {
                details.push(`CPL Adjustment: ${e.cpl_adjustment > 0 ? '+' : ''}${e.cpl_adjustment}`);
            }
            
            if (userSettings.has_ot && e.ot_adjustment && e.ot_adjustment !== 0) {
                details.push(`OT Adjustment: ${e.ot_adjustment > 0 ? '+' : ''}${e.ot_adjustment}`);
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
        window.addDebugLog('showBalanceAdjustmentModal() called', 'info');
        document.getElementById('balanceAdjustmentModal').style.display = 'flex';
        document.getElementById('adjustmentDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('adjustmentAL').value = '';
        document.getElementById('adjustmentSL').value = '';
        document.getElementById('adjustmentCL').value = '';
        document.getElementById('adjustmentCPL').value = '';
        document.getElementById('adjustmentOT').value = '';
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
        // Parse values - treat empty string as 0 to allow clearing adjustments
        let al = document.getElementById('adjustmentAL').value;
        let sl = document.getElementById('adjustmentSL').value;
        let cl = document.getElementById('adjustmentCL').value;
        let cpl = document.getElementById('adjustmentCPL').value;
        let ot = document.getElementById('adjustmentOT').value;
        const note = document.getElementById('adjustmentNote').value;
        
        // Convert to numbers - empty string becomes 0 (allows resetting to zero)
        al = al === '' ? 0 : parseFloat(al);
        sl = sl === '' ? 0 : parseFloat(sl);
        cl = cl === '' ? 0 : parseFloat(cl);
        cpl = cpl === '' ? 0 : parseFloat(cpl);
        ot = ot === '' ? 0 : parseFloat(ot);
        
        window.addDebugLog(`Input values - date: ${date}, al: ${al}, sl: ${sl}, cl: ${cl}, cpl: ${cpl}, ot: ${ot}, note: ${note}`, 'info');
        
        if (!date) {
            window.addDebugLog('ERROR: No date selected', 'error');
            alert('Please select a date');
            return;
        }
        
        // Allow 0 values to clear adjustments - removed the check that required non-zero
        
        // Check if adjustments are allowed based on user settings
        if (ot !== 0 && !userSettings.has_ot) {
            alert('OT adjustments are disabled for your account. Please enable OT in settings first.');
            return;
        }
        
        if (cpl !== 0 && !userSettings.has_cpl) {
            alert('CPL adjustments are disabled for your account. Please enable CPL in settings first.');
            return;
        }
        
        window.addDebugLog('STEP 1: Calling fetchOrCreateEntry to get entry', 'info');
        let entry = await fetchOrCreateEntry(date);
        
        window.addDebugLog(`STEP 2: Entry received from fetchOrCreateEntry: ${JSON.stringify({
            date: entry.date,
            al_adjustment: entry.al_adjustment,
            sl_adjustment: entry.sl_adjustment,
            cl_adjustment: entry.cl_adjustment,
            cpl_adjustment: entry.cpl_adjustment,
            ot_adjustment: entry.ot_adjustment,
            al_expiry_date: entry.al_expiry_date,
            cpl_expiry_date: entry.cpl_expiry_date,
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
        if (entry.sl_adjustment === undefined) {
            window.addDebugLog('sl_adjustment was undefined, setting to 0', 'warning');
            entry.sl_adjustment = 0;
        }
        if (entry.cl_adjustment === undefined) {
            window.addDebugLog('cl_adjustment was undefined, setting to 0', 'warning');
            entry.cl_adjustment = 0;
        }
        if (entry.cpl_adjustment === undefined) {
            window.addDebugLog('cpl_adjustment was undefined, setting to 0', 'warning');
            entry.cpl_adjustment = 0;
        }
        if (entry.ot_adjustment === undefined) {
            window.addDebugLog('ot_adjustment was undefined, setting to 0', 'warning');
            entry.ot_adjustment = 0;
        }
        
        window.addDebugLog(`STEP 6: Current adjustment values before update - AL: ${entry.al_adjustment}, SL: ${entry.sl_adjustment}, CL: ${entry.cl_adjustment}, CPL: ${entry.cpl_adjustment}, OT: ${entry.ot_adjustment}`, 'info');
        window.addDebugLog(`Current expiry dates - AL: ${entry.al_expiry_date}, CPL: ${entry.cpl_expiry_date}`, 'info');
        
        // Update AL adjustment (allow setting to 0 to clear)
        const oldAlValue = entry.al_adjustment;
        entry.al_adjustment = al;
        window.addDebugLog(`STEP 6a: AL adjustment changed from ${oldAlValue} to ${entry.al_adjustment}`, 'success');
        
        if (entry.al_adjustment > 0) {
            entry.al_expiry_date = calculateALExpiry(date);
            window.addDebugLog(`STEP 6b: Set/Updated al_expiry_date to: ${entry.al_expiry_date}`, 'info');
        } else if (entry.al_adjustment <= 0) {
            entry.al_expiry_date = null;
            window.addDebugLog(`STEP 6b: Cleared al_expiry_date (adjustment <= 0)`, 'info');
        }
        
        // Update SL adjustment (allow setting to 0 to clear)
        const oldSlValue = entry.sl_adjustment;
        entry.sl_adjustment = sl;
        window.addDebugLog(`STEP 6b1: SL adjustment changed from ${oldSlValue} to ${entry.sl_adjustment}`, 'success');
        
        // Update CL adjustment (allow setting to 0 to clear)
        const oldClValue = entry.cl_adjustment;
        entry.cl_adjustment = cl;
        window.addDebugLog(`STEP 6b2: CL adjustment changed from ${oldClValue} to ${entry.cl_adjustment}`, 'success');
        
        // Update CPL adjustment (allow setting to 0 to clear)
        if (userSettings.has_cpl) {
            const oldCplValue = entry.cpl_adjustment;
            entry.cpl_adjustment = cpl;
            window.addDebugLog(`STEP 6c: CPL adjustment changed from ${oldCplValue} to ${entry.cpl_adjustment}`, 'success');
            
            if (entry.cpl_adjustment > 0) {
                entry.cpl_expiry_date = calculateCPLExpiry(date);
                window.addDebugLog(`STEP 6d: Set/Updated cpl_expiry_date to: ${entry.cpl_expiry_date}`, 'info');
            } else if (entry.cpl_adjustment <= 0) {
                entry.cpl_expiry_date = null;
                window.addDebugLog(`STEP 6d: Cleared cpl_expiry_date (adjustment <= 0)`, 'info');
            }
        }
        
        // Update OT adjustment (allow setting to 0 to clear)
        if (userSettings.has_ot) {
            const oldOtValue = entry.ot_adjustment;
            entry.ot_adjustment = ot;
            window.addDebugLog(`STEP 6e: OT adjustment changed from ${oldOtValue} to ${entry.ot_adjustment}`, 'success');
        }
        
        entry.adjustment_note = note;
        window.addDebugLog(`STEP 7: Set adjustment_note to: ${note}`, 'info');
        
        window.addDebugLog(`STEP 8: Final entry object before save: ${JSON.stringify({
            date: entry.date,
            al_adjustment: entry.al_adjustment,
            sl_adjustment: entry.sl_adjustment,
            cl_adjustment: entry.cl_adjustment,
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
        await saveAndSync(entry, false, true);
        
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
        
        window.addDebugLog('loadAdjustments: RAW entries from db:', 'debug');
        entries.forEach((e, index) => {
            window.addDebugLog(`loadAdjustments[${index}]: ${JSON.stringify(e)}`, 'debug');
        });
        
        entries.forEach(e => {
            const alValue = e.al_adjustment !== undefined && e.al_adjustment !== null ? e.al_adjustment : 0;
            const slValue = e.sl_adjustment !== undefined && e.sl_adjustment !== null ? e.sl_adjustment : 0;
            const clValue = e.cl_adjustment !== undefined && e.cl_adjustment !== null ? e.cl_adjustment : 0;
            const cplValue = e.cpl_adjustment !== undefined && e.cpl_adjustment !== null ? e.cpl_adjustment : 0;
            const otValue = e.ot_adjustment !== undefined && e.ot_adjustment !== null ? e.ot_adjustment : 0;
            window.addDebugLog(`Processing table row for ${e.date}: Found al_adjustment=${alValue}, sl_adjustment=${slValue}, cl_adjustment=${clValue}, cpl_adjustment=${cplValue}, ot_adjustment=${otValue}, is_manual=${e.is_manual_adjustment}`, 'debug');
            window.addDebugLog(`Leave usage for ${e.date}: al_used=${e.al_used}, sl_used=${e.sl_used}, cl_used=${e.cl_used}, cpl_used=${e.cpl_used}`, 'debug');
            window.addDebugLog(`Expiry dates for ${e.date}: al_expiry=${e.al_expiry_date}, cpl_expiry=${e.cpl_expiry_date}`, 'debug');
        });
        
        const adjustments = entries.filter(e => {
            const alValue = e.al_adjustment !== undefined && e.al_adjustment !== null ? parseFloat(e.al_adjustment) : 0;
            const slValue = e.sl_adjustment !== undefined && e.sl_adjustment !== null ? parseFloat(e.sl_adjustment) : 0;
            const clValue = e.cl_adjustment !== undefined && e.cl_adjustment !== null ? parseFloat(e.cl_adjustment) : 0;
            const cplValue = e.cpl_adjustment !== undefined && e.cpl_adjustment !== null ? parseFloat(e.cpl_adjustment) : 0;
            const otValue = e.ot_adjustment !== undefined && e.ot_adjustment !== null ? parseFloat(e.ot_adjustment) : 0;
            
            return (e.adjustment_note && e.adjustment_note.length > 0) ||
                   (alValue !== 0) ||
                   (slValue !== 0) ||
                   (clValue !== 0) ||
                   (cplValue !== 0) ||
                   (otValue !== 0);
        });
        
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
            const alValue = adj.al_adjustment !== undefined && adj.al_adjustment !== null ? parseFloat(adj.al_adjustment) : 0;
            const slValue = adj.sl_adjustment !== undefined && adj.sl_adjustment !== null ? parseFloat(adj.sl_adjustment) : 0;
            const clValue = adj.cl_adjustment !== undefined && adj.cl_adjustment !== null ? parseFloat(adj.cl_adjustment) : 0;
            const cplValue = adj.cpl_adjustment !== undefined && adj.cpl_adjustment !== null ? parseFloat(adj.cpl_adjustment) : 0;
            const otValue = adj.ot_adjustment !== undefined && adj.ot_adjustment !== null ? parseFloat(adj.ot_adjustment) : 0;
            
            window.addDebugLog(`Displaying adjustment: ${adj.date} - AL:${alValue}, SL:${slValue}, CL:${clValue}, CPL:${cplValue}, OT:${otValue}`, 'success');
            
            const item = document.createElement('div');
            item.className = 'adjustment-item';
            
            let details = [];
            if (alValue !== 0) details.push(`AL: ${alValue > 0 ? '+' : ''}${alValue.toFixed(2)}`);
            if (slValue !== 0) details.push(`SL: ${slValue > 0 ? '+' : ''}${slValue.toFixed(2)}`);
            if (clValue !== 0) details.push(`CL: ${clValue > 0 ? '+' : ''}${clValue.toFixed(2)}`);
            if (userSettings.has_cpl && cplValue !== 0) details.push(`CPL: ${cplValue > 0 ? '+' : ''}${cplValue.toFixed(2)}`);
            if (userSettings.has_ot && otValue !== 0) details.push(`OT: ${otValue > 0 ? '+' : ''}${otValue.toFixed(1)}`);
            
            // Add edit/delete buttons for adjustments
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.style.background = '#f44336';
            deleteBtn.style.color = 'white';
            deleteBtn.style.border = 'none';
            deleteBtn.style.borderRadius = '4px';
            deleteBtn.style.padding = '4px 8px';
            deleteBtn.style.marginLeft = '10px';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.fontSize = '11px';
            deleteBtn.onclick = async () => {
                if (confirm(`Delete adjustment for ${adj.date}?`)) {
                    // Reset all adjustments to 0
                    adj.al_adjustment = 0;
                    adj.sl_adjustment = 0;
                    adj.cl_adjustment = 0;
                    adj.cpl_adjustment = 0;
                    adj.ot_adjustment = 0;
                    adj.adjustment_note = '';
                    adj.is_manual_adjustment = true; // Keep as adjustment entry but with zeros
                    
                    await saveAndSync(adj, false, true);
                    await loadAdjustments();
                    await loadBalances();
                    await loadExpiryInfo();
                    alert(`Adjustment for ${adj.date} deleted`);
                }
            };
            
            item.innerHTML = `
                <div class="adjustment-date">${adj.date}</div>
                <div class="adjustment-details">${details.join(' | ')}</div>
                ${adj.adjustment_note ? `<div class="adjustment-note">📝 ${adj.adjustment_note}</div>` : ''}
            `;
            
            // Add edit button
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.style.background = '#667eea';
            editBtn.style.color = 'white';
            editBtn.style.border = 'none';
            editBtn.style.borderRadius = '4px';
            editBtn.style.padding = '4px 8px';
            editBtn.style.marginLeft = '10px';
            editBtn.style.cursor = 'pointer';
            editBtn.style.fontSize = '11px';
            editBtn.onclick = () => {
                // Pre-fill modal with existing values
                document.getElementById('adjustmentDate').value = adj.date;
                document.getElementById('adjustmentAL').value = alValue !== 0 ? alValue : '';
                document.getElementById('adjustmentSL').value = slValue !== 0 ? slValue : '';
                document.getElementById('adjustmentCL').value = clValue !== 0 ? clValue : '';
                document.getElementById('adjustmentCPL').value = cplValue !== 0 ? cplValue : '';
                document.getElementById('adjustmentOT').value = otValue !== 0 ? otValue : '';
                document.getElementById('adjustmentNote').value = adj.adjustment_note || '';
                document.getElementById('balanceAdjustmentModal').style.display = 'flex';
            };
            
            const buttonContainer = document.createElement('div');
            buttonContainer.style.marginTop = '8px';
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '8px';
            buttonContainer.appendChild(editBtn);
            buttonContainer.appendChild(deleteBtn);
            item.appendChild(buttonContainer);
            
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
        window.addDebugLog('showInitialBalanceModal() called', 'info');
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
        window.addDebugLog('closeInitialBalanceModal() called', 'info');
        document.getElementById('initialBalanceModal').style.display = 'none';
    }

    async function saveInitialBalances() {
        window.addDebugLog('saveInitialBalances() called', 'info');
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
        
        entry.is_manual_adjustment = true;
        
        entry.check_in = null;
        entry.check_out = null;
        entry.base_hours_rule = null;
        entry.ot_cap_rule = null;
        entry.cpl_grant_rule = null;
        entry.final_ot_hours = null;
        entry.cpl_earned = null;
        entry.is_off_day = false;
        entry.is_holiday = false;
        
        if (entry.al_adjustment === undefined) entry.al_adjustment = 0;
        if (entry.sl_adjustment === undefined) entry.sl_adjustment = 0;
        if (entry.cl_adjustment === undefined) entry.cl_adjustment = 0;
        if (entry.cpl_adjustment === undefined) entry.cpl_adjustment = 0;
        if (entry.ot_adjustment === undefined) entry.ot_adjustment = 0;
        
        if (al !== 0) {
            entry.al_adjustment = (entry.al_adjustment || 0) + al;
            window.addDebugLog(`Set initial al_adjustment to: ${entry.al_adjustment}`, 'success');
            if (al > 0) {
                entry.al_expiry_date = calculateALExpiry(date);
                window.addDebugLog(`Set initial al_expiry_date to: ${entry.al_expiry_date}`, 'info');
            }
        }
        
        if (sl !== 0) {
            entry.sl_adjustment = (entry.sl_adjustment || 0) + sl;
            window.addDebugLog(`Set initial sl_adjustment to: ${entry.sl_adjustment}`, 'success');
        }
        
        if (cl !== 0) {
            entry.cl_adjustment = (entry.cl_adjustment || 0) + cl;
            window.addDebugLog(`Set initial cl_adjustment to: ${entry.cl_adjustment}`, 'success');
        }
        
        if (cpl !== 0 && userSettings.has_cpl) {
            entry.cpl_adjustment = (entry.cpl_adjustment || 0) + cpl;
            window.addDebugLog(`Set initial cpl_adjustment to: ${entry.cpl_adjustment}`, 'success');
            if (cpl > 0) {
                entry.cpl_expiry_date = calculateCPLExpiry(date);
                window.addDebugLog(`Set initial cpl_expiry_date to: ${entry.cpl_expiry_date}`, 'info');
            }
        }
        
        if (ot !== 0 && userSettings.has_ot) {
            entry.ot_adjustment = (entry.ot_adjustment || 0) + ot;
            window.addDebugLog(`Set initial ot_adjustment to: ${entry.ot_adjustment}`, 'success');
        }
        
        entry.adjustment_note = 'Initial balance setup';
        
        window.addDebugLog(`After initial setup - Entry: ${JSON.stringify(entry)}`, 'success');
        
        await saveAndSync(entry, false, true);
        
        closeInitialBalanceModal();
        alert('✅ Initial balances set successfully');
        
        await loadBalances();
        await loadAdjustments();
        await loadExpiryInfo();
    }

    // ==================== RESET ALL DATA ====================
    async function resetAllData() {
        window.addDebugLog('resetAllData() called', 'warning');
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
                const response = await fetch('/api/account?action=reset-data', {
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
                friday: { base: 8.5, maxOT: 1, cpl: 0 },
                saturday: { base: 8, maxOT: 1, cpl: 1 },
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
    
    // User Settings Functions
    window.saveUserSettingsAndApply = saveUserSettingsAndApply;
    window.resetUserSettingsToDefault = resetUserSettingsToDefault;
    
    // Alarm Functions
    window.saveAlarmSettings = saveAlarmSettings;
    window.requestNotificationPermission = requestNotificationPermission;
    
    // OTP Functions
    window.showForgotPassword = showForgotPassword;
    window.copyToClipboard = copyToClipboard;
    window.openMailClient = openMailClient;
    window.verifyOTP = verifyOTP;
    window.closeOTPModal = closeOTPModal;
    window.showResetPasswordModal = showResetPasswordModal;
    window.closeResetPasswordModal = closeResetPasswordModal;
    window.submitNewPassword = submitNewPassword;

    window.addDebugLog('app.js: Loading complete - ULTRA DEBUG VERSION WITH OTP, DYNAMIC USER SETTINGS & ALARMS', 'success');
})();
