// ==================== APP.JS - COMPLETE FIXED VERSION ====================
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

    // Template data - SUNDAY ALTERNATING: 1st,3rd,5th = 1.0 CPL | 2nd,4th = 0.5 CPL
    let weeklyTemplate = {
        monday: { base: 8, maxOT: 1, cpl: 0 },
        tuesday: { base: 8, maxOT: 1, cpl: 0 },
        wednesday: { base: 8, maxOT: 1, cpl: 0 },
        thursday: { base: 8, maxOT: 1, cpl: 0 },
        friday: { base: 8, maxOT: 1, cpl: 0 },
        saturday: { base: 6, maxOT: 0.5, cpl: 0 },
        // Sunday alternating pattern
        sundayOdd: { base: 8, maxOT: 0, cpl: 1.0 },  // 1st, 3rd, 5th Sundays (Holiday pattern)
        sundayEven: { base: 6, maxOT: 0, cpl: 0.5 }  // 2nd, 4th Sundays (Normal Sunday)
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
                
                // Load today's entry FIRST
                window.addDebugLog('Loading today entry on auth...', 'info');
                await loadTodayEntry();
                loadBalances();
                updateLastSyncTime();
                loadTemplateToUI();
                
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
        
        window.addDebugLog(`Login attempt for: ${email}`, 'info');
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                appAuthToken = data.token;
                appCurrentUser = data.user;
                
                window.addDebugLog(`Login successful for user: ${appCurrentUser.id}`, 'success');
                
                localStorage.setItem('auth_token', data.token);
                localStorage.setItem('auth_user', JSON.stringify(data.user));
                
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                }
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                // Load today's entry FIRST
                window.addDebugLog('Loading today entry after login...', 'info');
                await loadTodayEntry();
                loadBalances();
                updateLastSyncTime();
                loadTemplateToUI();
                
                setTimeout(() => syncFromCloud(), 2000);
                
                errorEl.textContent = '';
            } else {
                errorEl.textContent = data.message || 'Login failed';
                window.addDebugLog(`Login failed: ${data.message}`, 'error');
            }
        } catch (error) {
            errorEl.textContent = 'Connection error';
            window.addDebugLog(`Login error: ${error.message}`, 'error');
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
            
            const data = await response.json();
            
            if (data.success) {
                showLogin();
                document.getElementById('loginEmail').value = email;
                document.getElementById('loginError').textContent = 'Registration successful! Please login.';
                window.addDebugLog('Registration successful', 'success');
            } else {
                errorEl.textContent = data.message || 'Registration failed';
                window.addDebugLog(`Registration failed: ${data.message}`, 'error');
            }
        } catch (error) {
            errorEl.textContent = 'Connection error';
            window.addDebugLog(`Registration error: ${error.message}`, 'error');
        }
    }

    function logout() {
        if (confirm('Logout?')) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            appAuthToken = null;
            appCurrentUser = null;
            
            document.getElementById('appScreen').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'block';
            window.addDebugLog('Logged out', 'info');
        }
    }

    // ==================== HOME PAGE FUNCTIONS ====================
    async function checkIn() {
        if (!appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        window.addDebugLog('checkIn() called', 'info');
        
        // Check if already checked in today
        const today = new Date().toISOString().split('T')[0];
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const todayEntry = entries.find(e => e.date === today);
        
        window.addDebugLog(`Today entry found: ${todayEntry ? 'yes' : 'no'}`, 'info');
        if (todayEntry) {
            window.addDebugLog(`Today check_in: ${todayEntry.check_in}`, 'info');
            window.addDebugLog(`Today check_out: ${todayEntry.check_out}`, 'info');
            window.addDebugLog(`Today is_holiday: ${todayEntry.is_holiday}`, 'info');
            window.addDebugLog(`Today is_off_day: ${todayEntry.is_off_day}`, 'info');
        }
        
        if (todayEntry && todayEntry.check_in && !todayEntry.check_out) {
            if (!confirm('You are already checked in. Check in again?')) {
                return;
            }
        }
        
        // Get local time
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const localDateTime = getLocalTimeForDB(now);
        
        document.getElementById('checkInDisplay').textContent = timeStr;
        appCurrentCheckIn = localDateTime;
        
        window.addDebugLog(`Check-in time: ${timeStr} (${localDateTime})`, 'success');
        
        await saveTodayEntry({ 
            check_in: appCurrentCheckIn,
            check_out: null,
            // Preserve holiday/off day status
            is_holiday: todayEntry?.is_holiday || false,
            is_off_day: todayEntry?.is_off_day || false
        });
        
        window.addDebugLog(`Check-in recorded in DB`, 'success');
        
        // Auto sync after check-in
        setTimeout(() => syncToCloud(), 1000);
    }

    async function checkOut() {
        if (!appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        window.addDebugLog('checkOut() called', 'info');
        
        // Check if checked in today
        const today = new Date().toISOString().split('T')[0];
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const todayEntry = entries.find(e => e.date === today);
        
        if (!todayEntry || !todayEntry.check_in) {
            alert('You must check in first before checking out');
            window.addDebugLog('Check-out failed: no check-in found', 'error');
            return;
        }
        
        if (todayEntry.check_out) {
            if (!confirm('Already checked out. Override?')) {
                return;
            }
        }
        
        // Get local time
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const localDateTime = getLocalTimeForDB(now);
        
        // Validate check out is after check in
        const checkInTime = todayEntry.check_in;
        if (checkInTime && localDateTime <= checkInTime) {
            alert('Check out time must be after check in time');
            window.addDebugLog('Check-out failed: time not after check-in', 'error');
            return;
        }
        
        document.getElementById('checkOutDisplay').textContent = timeStr;
        appCurrentCheckOut = localDateTime;
        
        window.addDebugLog(`Check-out time: ${timeStr} (${localDateTime})`, 'success');
        
        await saveTodayEntry({ 
            check_out: appCurrentCheckOut 
        });
        
        await calculateOT(todayEntry.check_in, appCurrentCheckOut, todayEntry);
        window.addDebugLog(`Check-out recorded in DB`, 'success');
        
        // Auto sync after check-out
        setTimeout(() => syncToCloud(), 1000);
    }

    async function markLeave(type) {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        window.addDebugLog(`markLeave() called with type: ${type}`, 'info');
        
        // Check if already has entry for today
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const existingEntry = entries.find(e => e.date === today);
        
        if (existingEntry && (existingEntry.check_in || existingEntry.check_out)) {
            if (!confirm('This day already has check-in/out. Override with leave?')) {
                return;
            }
        }
        
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            [`${type}_used`]: 1,
            check_in: null,
            check_out: null,
            is_off_day: false,
            is_holiday: false,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`${type} leave marked in DB`, 'success');
            
            // Clear check displays
            document.getElementById('checkInDisplay').textContent = '--:--';
            document.getElementById('checkOutDisplay').textContent = '--:--';
            
            loadBalances();
            setTimeout(() => syncToCloud(), 1000);
        }
    }

    async function markOffDay() {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        window.addDebugLog('markOffDay() called', 'info');
        
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            is_off_day: true,
            is_holiday: false,
            check_in: null,
            check_out: null,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog('Off day marked in DB', 'success');
            
            // Clear check displays
            document.getElementById('checkInDisplay').textContent = '--:--';
            document.getElementById('checkOutDisplay').textContent = '--:--';
            
            setTimeout(() => syncToCloud(), 1000);
        }
    }

    async function saveTodayEntry(data) {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        window.addDebugLog(`saveTodayEntry() called for ${today}`, 'info');
        
        // Get existing entry first
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const existingEntry = entries.find(e => e.date === today) || {};
        
        window.addDebugLog(`Existing entry: ${JSON.stringify(existingEntry)}`, 'info');
        
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            check_in: existingEntry.check_in || null,
            check_out: existingEntry.check_out || null,
            al_used: existingEntry.al_used || 0,
            sl_used: existingEntry.sl_used || 0,
            cl_used: existingEntry.cl_used || 0,
            cpl_used: existingEntry.cpl_used || 0,
            is_off_day: existingEntry.is_off_day || false,
            is_holiday: existingEntry.is_holiday || false,
            base_hours_rule: existingEntry.base_hours_rule || 8,
            ot_cap_rule: existingEntry.ot_cap_rule || 1,
            cpl_grant_rule: existingEntry.cpl_grant_rule || 0,
            final_ot_hours: existingEntry.final_ot_hours || 0,
            cpl_earned: existingEntry.cpl_earned || 0,
            sync_status: 'pending',
            ...data
        };
        
        window.addDebugLog(`Saving entry: ${JSON.stringify(entry)}`, 'info');
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog('Entry saved successfully', 'success');
        }
    }

    async function loadTodayEntry() {
        if (!window.dbAPI || !appCurrentUser) {
            window.addDebugLog('loadTodayEntry: No user or DB', 'warning');
            return;
        }
        
        try {
            const today = new Date().toISOString().split('T')[0];
            window.addDebugLog(`loadTodayEntry() called for date: ${today}`, 'info');
            
            const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
            window.addDebugLog(`Total entries for user: ${entries.length}`, 'info');
            
            const todayEntry = entries.find(e => e.date === today);
            
            if (todayEntry) {
                window.addDebugLog('Found today entry:', 'success');
                window.addDebugLog(`Entry data: ${JSON.stringify(todayEntry)}`, 'info');
                
                // Check if this is a leave day (with actual leave used)
                const isLeaveDay = (todayEntry.al_used && parseFloat(todayEntry.al_used) > 0) || 
                                   (todayEntry.sl_used && parseFloat(todayEntry.sl_used) > 0) || 
                                   (todayEntry.cl_used && parseFloat(todayEntry.cl_used) > 0) || 
                                   (todayEntry.cpl_used && parseFloat(todayEntry.cpl_used) > 0);
                
                if (isLeaveDay || todayEntry.is_off_day) {
                    document.getElementById('checkInDisplay').textContent = '--:--';
                    document.getElementById('checkOutDisplay').textContent = '--:--';
                    window.addDebugLog('Leave/Off day detected - cleared displays', 'info');
                } else {
                    // Not a leave day, show check-in/out times
                    if (todayEntry.check_in) {
                        // Parse local time string
                        const timePart = todayEntry.check_in.split('T')[1] || '00:00:00';
                        const [hours, minutes] = timePart.split(':');
                        const hour12 = parseInt(hours) % 12 || 12;
                        const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
                        const timeStr = `${hour12}:${minutes}`;
                        
                        document.getElementById('checkInDisplay').textContent = timeStr;
                        appCurrentCheckIn = todayEntry.check_in;
                        window.addDebugLog(`Check-in loaded: ${timeStr} ${ampm}`, 'success');
                    } else {
                        document.getElementById('checkInDisplay').textContent = '--:--';
                        window.addDebugLog('No check-in time found', 'info');
                    }
                    
                    if (todayEntry.check_out) {
                        const timePart = todayEntry.check_out.split('T')[1] || '00:00:00';
                        const [hours, minutes] = timePart.split(':');
                        const hour12 = parseInt(hours) % 12 || 12;
                        const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
                        const timeStr = `${hour12}:${minutes}`;
                        
                        document.getElementById('checkOutDisplay').textContent = timeStr;
                        appCurrentCheckOut = todayEntry.check_out;
                        window.addDebugLog(`Check-out loaded: ${timeStr} ${ampm}`, 'success');
                    } else {
                        document.getElementById('checkOutDisplay').textContent = '--:--';
                        window.addDebugLog('No check-out time found', 'info');
                    }
                }
            } else {
                window.addDebugLog('No entry found for today', 'info');
                document.getElementById('checkInDisplay').textContent = '--:--';
                document.getElementById('checkOutDisplay').textContent = '--:--';
            }
        } catch (error) {
            window.addDebugLog(`Error loading today entry: ${error.message}`, 'error');
        }
    }

    function getSundayWeekNumber(date) {
        // Calculate which Sunday of the month (1st, 2nd, 3rd, 4th, 5th)
        const dayOfMonth = date.getDate();
        return Math.ceil(dayOfMonth / 7);
    }

    async function calculateOT(checkIn, checkOut, existingEntry = {}) {
        if (!checkIn || !checkOut || !appCurrentUser) return;
        
        window.addDebugLog(`calculateOT() called with in: ${checkIn}, out: ${checkOut}`, 'info');
        
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        const hoursWorked = (checkOutDate - checkInDate) / (1000 * 60 * 60);
        
        window.addDebugLog(`Hours worked: ${hoursWorked.toFixed(2)}`, 'info');
        
        if (hoursWorked < 0) {
            window.addDebugLog('Negative hours worked - not calculating OT', 'error');
            return;
        }
        
        const date = checkInDate.toISOString().split('T')[0];
        const dayName = checkInDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        window.addDebugLog(`Day: ${dayName}`, 'info');
        window.addDebugLog(`Is holiday: ${existingEntry.is_holiday}`, 'info');
        window.addDebugLog(`Is off day: ${existingEntry.is_off_day}`, 'info');
        
        let base = 8, otCap = 1, cplGrant = 0;
        
        // First check if it's an off day
        if (existingEntry.is_off_day) {
            window.addDebugLog('Off day - no OT or CPL', 'info');
            base = 0;
            otCap = 0;
            cplGrant = 0;
        }
        // Then check if it's a holiday (CPL granted even if worked)
        else if (existingEntry.is_holiday) {
            window.addDebugLog('Holiday - using holiday rules', 'info');
            // Use the cpl_grant_rule from the entry if set, otherwise default
            cplGrant = existingEntry.cpl_grant_rule || 1.0;
            base = existingEntry.base_hours_rule || 8;
            otCap = existingEntry.ot_cap_rule || 1;
        }
        // Otherwise use normal day rules
        else if (dayName === 'sunday') {
            // SUNDAY ALTERNATING RULE: 1st,3rd,5th = 1.0 CPL | 2nd,4th = 0.5 CPL
            const sundayWeek = getSundayWeekNumber(checkInDate);
            
            if (sundayWeek % 2 === 1) { // Odd Sundays (1st, 3rd, 5th) - These are holidays
                base = weeklyTemplate.sundayOdd.base;
                otCap = weeklyTemplate.sundayOdd.maxOT;
                cplGrant = weeklyTemplate.sundayOdd.cpl;
                window.addDebugLog(`Sunday #${sundayWeek} (odd - Holiday pattern) - Base: ${base}, OT Cap: ${otCap}, CPL: ${cplGrant}`, 'info');
            } else { // Even Sundays (2nd, 4th) - Normal Sundays
                base = weeklyTemplate.sundayEven.base;
                otCap = weeklyTemplate.sundayEven.maxOT;
                cplGrant = weeklyTemplate.sundayEven.cpl;
                window.addDebugLog(`Sunday #${sundayWeek} (even - Normal) - Base: ${base}, OT Cap: ${otCap}, CPL: ${cplGrant}`, 'info');
            }
        } else {
            base = weeklyTemplate[dayName]?.base || 8;
            otCap = weeklyTemplate[dayName]?.maxOT || 1;
            cplGrant = weeklyTemplate[dayName]?.cpl || 0;
            window.addDebugLog(`${dayName} - Base: ${base}, OT Cap: ${otCap}, CPL: ${cplGrant}`, 'info');
        }
        
        // Override with any values from the entry (from single date override)
        if (existingEntry.base_hours_rule !== undefined) {
            base = existingEntry.base_hours_rule;
            window.addDebugLog(`Using override base: ${base}`, 'info');
        }
        if (existingEntry.ot_cap_rule !== undefined) {
            otCap = existingEntry.ot_cap_rule;
            window.addDebugLog(`Using override OT cap: ${otCap}`, 'info');
        }
        if (existingEntry.cpl_grant_rule !== undefined) {
            cplGrant = existingEntry.cpl_grant_rule;
            window.addDebugLog(`Using override CPL grant: ${cplGrant}`, 'info');
        }
        
        const ot = Math.max(0, hoursWorked - base);
        const finalOT = Math.min(ot, otCap);
        
        window.addDebugLog(`OT calculated: ${finalOT.toFixed(2)} hours`, 'success');
        
        // Get existing entry to preserve leave data
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const existingEntryFromDB = entries.find(e => e.date === date) || {};
        
        const entry = {
            date: date,
            user_id: appCurrentUser.id,
            check_in: checkIn,
            check_out: checkOut,
            base_hours_rule: base,
            ot_cap_rule: otCap,
            cpl_grant_rule: cplGrant,
            final_ot_hours: finalOT,
            cpl_earned: cplGrant,
            al_used: existingEntryFromDB.al_used || 0,
            sl_used: existingEntryFromDB.sl_used || 0,
            cl_used: existingEntryFromDB.cl_used || 0,
            cpl_used: existingEntryFromDB.cpl_used || 0,
            is_off_day: existingEntryFromDB.is_off_day || false,
            is_holiday: existingEntryFromDB.is_holiday || false,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`OT calculation saved for ${date}`, 'success');
        }
    }

    // ==================== MANUAL ENTRY ====================
    function showManualEntry() {
        document.getElementById('manualEntryModal').style.display = 'flex';
        document.getElementById('manualDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('manualIn').value = '';
        document.getElementById('manualOut').value = '';
        window.addDebugLog('Manual entry modal shown', 'info');
    }

    function closeManualEntry() {
        document.getElementById('manualEntryModal').style.display = 'none';
        window.addDebugLog('Manual entry modal closed', 'info');
    }

    async function saveManualEntry() {
        const date = document.getElementById('manualDate').value;
        const checkIn = document.getElementById('manualIn').value;
        const checkOut = document.getElementById('manualOut').value;
        const type = document.getElementById('manualType').value;
        
        window.addDebugLog(`saveManualEntry() - date: ${date}, type: ${type}`, 'info');
        window.addDebugLog(`checkIn: ${checkIn}, checkOut: ${checkOut}`, 'info');
        
        if (!date) {
            alert('Please select date');
            return;
        }
        
        const entry = {
            date: date,
            user_id: appCurrentUser.id,
            sync_status: 'pending',
            al_used: 0,
            sl_used: 0,
            cl_used: 0,
            cpl_used: 0,
            is_off_day: false,
            is_holiday: false
        };
        
        if (type === 'work') {
            // Store local time without timezone conversion
            if (checkIn) {
                entry.check_in = `${date}T${checkIn}:00`;
            }
            if (checkOut) {
                entry.check_out = `${date}T${checkOut}:00`;
            }
            
            // Validate check out after check in
            if (checkIn && checkOut && entry.check_out <= entry.check_in) {
                alert('Check out time must be after check in time');
                window.addDebugLog('Validation failed: check-out <= check-in', 'error');
                return;
            }
            
            // Calculate OT if both times present
            if (checkIn && checkOut) {
                const inDate = new Date(`${date}T${checkIn}`);
                const outDate = new Date(`${date}T${checkOut}`);
                const hoursWorked = (outDate - inDate) / (1000 * 60 * 60);
                
                const dayName = inDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                
                let base = 8, otCap = 1, cplGrant = 0;
                
                if (dayName === 'sunday') {
                    const sundayWeek = getSundayWeekNumber(inDate);
                    if (sundayWeek % 2 === 1) {
                        base = weeklyTemplate.sundayOdd.base;
                        otCap = weeklyTemplate.sundayOdd.maxOT;
                        cplGrant = weeklyTemplate.sundayOdd.cpl;
                    } else {
                        base = weeklyTemplate.sundayEven.base;
                        otCap = weeklyTemplate.sundayEven.maxOT;
                        cplGrant = weeklyTemplate.sundayEven.cpl;
                    }
                } else {
                    base = weeklyTemplate[dayName]?.base || 8;
                    otCap = weeklyTemplate[dayName]?.maxOT || 1;
                    cplGrant = weeklyTemplate[dayName]?.cpl || 0;
                }
                
                const ot = Math.max(0, hoursWorked - base);
                entry.final_ot_hours = Math.min(ot, otCap);
                entry.cpl_earned = cplGrant;
                entry.base_hours_rule = base;
                entry.ot_cap_rule = otCap;
                
                window.addDebugLog(`Manual OT: ${entry.final_ot_hours}, CPL: ${cplGrant}`, 'info');
            }
        } else if (type === 'holiday') {
            entry.is_holiday = true;
            window.addDebugLog('Manual holiday', 'info');
        } else if (type === 'off') {
            entry.is_off_day = true;
            window.addDebugLog('Manual off day', 'info');
        } else {
            entry[`${type}_used`] = 1;
            window.addDebugLog(`Manual ${type} leave`, 'info');
        }
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`Manual entry saved for ${date}`, 'success');
            closeManualEntry();
            
            setTimeout(() => syncToCloud(), 1000);
            
            if (date === new Date().toISOString().split('T')[0]) {
                await loadTodayEntry();
            }
            loadBalances();
        }
    }

    // ==================== SYNC TO CLOUD - FIXED WITH SINGLE ENTRY SYNC ====================
    async function syncToCloud() {
        if (!appAuthToken || !appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        window.addDebugLog('=== SYNC TO CLOUD STARTED ===', 'info');
        window.addDebugLog(`User: ${appCurrentUser.email}`, 'info');
        
        const syncOutBtn = document.querySelector('.sync-out');
        const originalText = syncOutBtn.innerHTML;
        syncOutBtn.innerHTML = '<span class="sync-icon">⏳</span> SYNCING...';
        syncOutBtn.disabled = true;
        
        try {
            // Get ALL pending entries
            window.addDebugLog('Fetching pending entries from DB...', 'info');
            const pendingEntries = await window.dbAPI.getEntriesNeedingSync(100); // Get up to 100
            
            window.addDebugLog(`Found ${pendingEntries.length} total pending entries`, 'info');
            
            if (pendingEntries.length === 0) {
                window.addDebugLog('No entries to sync', 'info');
                alert('All entries are synced');
                return;
            }
            
            // Show progress
            let successCount = 0;
            let errorCount = 0;
            const errors = [];
            
            // Process entries ONE BY ONE to avoid timeout
            for (let i = 0; i < pendingEntries.length; i++) {
                const entry = pendingEntries[i];
                
                window.addDebugLog(`[${i+1}/${pendingEntries.length}] Syncing entry for ${entry.date}...`, 'info');
                
                // Update button text to show progress
                syncOutBtn.innerHTML = `<span class="sync-icon">⏳</span> ${i+1}/${pendingEntries.length}`;
                
                // Clean single entry
                const cleanEntry = {
                    date: entry.date,
                    check_in: entry.check_in || null,
                    check_out: entry.check_out || null,
                    base_hours_rule: entry.base_hours_rule || 8,
                    ot_cap_rule: entry.ot_cap_rule || 1,
                    cpl_grant_rule: entry.cpl_grant_rule || 0,
                    final_ot_hours: entry.final_ot_hours || 0,
                    cpl_earned: entry.cpl_earned || 0,
                    al_used: entry.al_used || 0,
                    sl_used: entry.sl_used || 0,
                    cl_used: entry.cl_used || 0,
                    cpl_used: entry.cpl_used || 0,
                    is_off_day: entry.is_off_day || false,
                    is_holiday: entry.is_holiday || false
                };
                
                try {
                    // Send ONE entry at a time
                    const response = await fetch('/api/sync?direction=to', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${appAuthToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ entries: [cleanEntry] }) // Send as array with 1 entry
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
                    }
                    
                    const data = await response.json();
                    
                    if (data.success && data.syncedIds && data.syncedIds.length > 0) {
                        // Mark this single entry as synced
                        await window.dbAPI.markAsSynced([entry.date]);
                        successCount++;
                        window.addDebugLog(`✅ Synced ${entry.date}`, 'success');
                    } else {
                        throw new Error(data.message || 'Sync failed');
                    }
                    
                    // Small delay between entries to prevent rate limiting
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                } catch (err) {
                    window.addDebugLog(`❌ Failed to sync ${entry.date}: ${err.message}`, 'error');
                    errorCount++;
                    errors.push({ date: entry.date, error: err.message });
                }
            }
            
            updateLastSyncTime();
            
            // Show summary
            const message = `✅ Synced ${successCount} entries\n❌ Failed: ${errorCount}`;
            window.addDebugLog(`Sync complete - Success: ${successCount}, Failed: ${errorCount}`, 'info');
            
            if (errors.length > 0) {
                window.addDebugLog(`Errors: ${JSON.stringify(errors)}`, 'error');
            }
            
            alert(message);
            
        } catch (error) {
            window.addDebugLog(`Sync error: ${error.message}`, 'error');
            window.addDebugLog(`Error stack: ${error.stack}`, 'error');
            alert('Sync failed: ' + error.message);
        } finally {
            syncOutBtn.innerHTML = originalText;
            syncOutBtn.disabled = false;
            window.addDebugLog('=== SYNC TO CLOUD ENDED ===', 'info');
        }
    }

    // ==================== SYNC FROM CLOUD - FIXED WITH DATE FORMAT AND NUMBER CONVERSION ====================
    async function syncFromCloud() {
        if (!appAuthToken || !appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        window.addDebugLog('=== SYNC FROM CLOUD STARTED ===', 'info');
        
        const syncInBtn = document.querySelector('.sync-in');
        const originalText = syncInBtn.innerHTML;
        syncInBtn.innerHTML = '<span class="sync-icon">⏳</span> SYNCING...';
        syncInBtn.disabled = true;
        
        try {
            window.addDebugLog('Fetching from cloud...', 'info');
            
            const response = await fetch('/api/sync?direction=from', {
                headers: { 
                    'Authorization': `Bearer ${appAuthToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.entries) {
                window.addDebugLog(`Received ${data.entries.length} entries from cloud`, 'info');
                
                // Process entries and FIX THE DATE FORMAT
                let imported = 0;
                for (const entry of data.entries) {
                    // FIX: Convert date from "2026-02-25T00:00:00.000Z" to "2026-02-25"
                    if (entry.date && entry.date.includes('T')) {
                        entry.date = entry.date.split('T')[0];
                    }
                    
                    // FIX: Convert string numbers to actual numbers
                    entry.al_used = parseFloat(entry.al_used) || 0;
                    entry.sl_used = parseFloat(entry.sl_used) || 0;
                    entry.cl_used = parseFloat(entry.cl_used) || 0;
                    entry.cpl_used = parseFloat(entry.cpl_used) || 0;
                    entry.base_hours_rule = parseFloat(entry.base_hours_rule) || 8;
                    entry.ot_cap_rule = parseFloat(entry.ot_cap_rule) || 1;
                    entry.cpl_grant_rule = parseFloat(entry.cpl_grant_rule) || 0;
                    entry.final_ot_hours = parseFloat(entry.final_ot_hours) || 0;
                    entry.cpl_earned = parseFloat(entry.cpl_earned) || 0;
                    
                    // FIX: Convert boolean fields
                    entry.is_off_day = entry.is_off_day === true || entry.is_off_day === 'true';
                    entry.is_holiday = entry.is_holiday === true || entry.is_holiday === 'true';
                    
                    // Add required fields
                    entry.user_id = appCurrentUser.id;
                    entry.sync_status = 'synced';
                    
                    window.addDebugLog(`Saving entry for date: ${entry.date}`, 'info');
                    window.addDebugLog(`is_holiday: ${entry.is_holiday}, is_off_day: ${entry.is_off_day}`, 'info');
                    
                    await window.dbAPI.saveEntry(entry);
                    imported++;
                }
                
                updateLastSyncTime();
                window.addDebugLog(`Imported ${imported} entries`, 'success');
                
                // RELOAD today's entry after import
                await loadTodayEntry();
                loadBalances();
                
                if (imported > 0) {
                    alert(`✅ Imported ${imported} entries from cloud`);
                } else {
                    alert('No new entries in cloud');
                }
            }
            
        } catch (error) {
            window.addDebugLog(`Sync error: ${error.message}`, 'error');
            alert('Sync failed: ' + error.message);
        } finally {
            syncInBtn.innerHTML = originalText;
            syncInBtn.disabled = false;
            window.addDebugLog('=== SYNC FROM CLOUD ENDED ===', 'info');
        }
    }

    function updateLastSyncTime() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        const timeStr = `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        
        document.getElementById('lastSyncTime').textContent = `Last sync: ${timeStr}`;
        window.addDebugLog(`Last sync time updated: ${timeStr}`, 'info');
    }

    // ==================== BALANCE FUNCTIONS ====================
    async function loadBalances() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        window.addDebugLog('loadBalances() called', 'info');
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        window.addDebugLog(`Found ${entries.length} entries for balance calculation`, 'info');
        
        // Initialize balances
        let alBalance = 15.49; // Starting AL
        let slBalance = 10.0;   // Starting SL (10 days per year)
        let clBalance = 10.0;   // Starting CL (10 days per year)
        let cplBalance = 0;      // Start at 0, will be calculated from FIFO
        let otThisMonth = 0;
        let otLastMonth = 0;
        
        // Get current date info
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        
        // CPL FIFO tracking
        const cplEarned = [];
        let totalCPLUsed = 0;
        
        // Sort entries by date for FIFO calculation
        const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const entryYear = entryDate.getFullYear();
            const entryMonth = entryDate.getMonth();
            
            // AL Accrual (1.83 every 30 days)
            if (entryDate > new Date(currentYear, 0, 1)) { // After Jan 1
                const daysSinceStart = Math.floor((entryDate - new Date(currentYear, 0, 1)) / (1000 * 60 * 60 * 24));
                alBalance += Math.floor(daysSinceStart / 30) * 1.83;
            }
            
            // Deduct used leaves
            if (entry.al_used) alBalance -= entry.al_used;
            if (entry.sl_used) slBalance -= entry.sl_used;
            if (entry.cl_used) clBalance -= entry.cl_used;
            
            // Track CPL earned (last 180 days)
            if (entry.cpl_earned > 0) {
                const daysAgo = Math.floor((now - entryDate) / (1000 * 60 * 60 * 24));
                if (daysAgo <= 180) { // Only count CPL from last 180 days
                    cplEarned.push({
                        date: entry.date,
                        amount: entry.cpl_earned
                    });
                }
            }
            
            // Track CPL used
            if (entry.cpl_used) {
                totalCPLUsed += entry.cpl_used;
            }
            
            // Calculate OT totals
            if (entry.final_ot_hours) {
                if (entryMonth === currentMonth && entryYear === currentYear) {
                    otThisMonth += entry.final_ot_hours;
                } else if (entryMonth === lastMonth && entryYear === lastMonthYear) {
                    otLastMonth += entry.final_ot_hours;
                }
            }
        }
        
        // Calculate CPL balance using FIFO
        cplEarned.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        let remainingCPL = 0;
        let usedCPL = totalCPLUsed;
        
        // Apply FIFO: use oldest CPL first
        for (const cpl of cplEarned) {
            if (usedCPL <= 0) {
                remainingCPL += cpl.amount;
            } else if (usedCPL >= cpl.amount) {
                usedCPL -= cpl.amount;
            } else {
                remainingCPL += (cpl.amount - usedCPL);
                usedCPL = 0;
            }
        }
        
        cplBalance = remainingCPL;
        
        // Update UI
        document.getElementById('alBalance').textContent = alBalance.toFixed(2);
        document.getElementById('slBalance').textContent = slBalance.toFixed(2);
        document.getElementById('clBalance').textContent = clBalance.toFixed(2);
        document.getElementById('cplBalance').textContent = cplBalance.toFixed(2);
        document.getElementById('otMonth').textContent = otThisMonth.toFixed(1);
        document.getElementById('otLastMonth').textContent = otLastMonth.toFixed(1);
        
        window.addDebugLog(`Balances - AL: ${alBalance.toFixed(2)}, SL: ${slBalance.toFixed(2)}, CL: ${clBalance.toFixed(2)}, CPL: ${cplBalance.toFixed(2)}`, 'success');
        window.addDebugLog(`OT - This month: ${otThisMonth.toFixed(1)}, Last month: ${otLastMonth.toFixed(1)}`, 'info');
    }

    async function recalculateAll() {
        if (confirm('Recalculate all balances? This will re-evaluate all entries.')) {
            window.addDebugLog('Recalculate all called', 'info');
            await loadBalances();
            alert('Balances recalculated');
        }
    }

    // ==================== SCHEDULE FUNCTIONS ====================
    function loadTemplateToUI() {
        document.getElementById('monBase').value = weeklyTemplate.monday.base;
        document.getElementById('monOT').value = weeklyTemplate.monday.maxOT;
        document.getElementById('monCPL').value = weeklyTemplate.monday.cpl;
        
        document.getElementById('tueBase').value = weeklyTemplate.tuesday.base;
        document.getElementById('tueOT').value = weeklyTemplate.tuesday.maxOT;
        document.getElementById('tueCPL').value = weeklyTemplate.tuesday.cpl;
        
        document.getElementById('wedBase').value = weeklyTemplate.wednesday.base;
        document.getElementById('wedOT').value = weeklyTemplate.wednesday.maxOT;
        document.getElementById('wedCPL').value = weeklyTemplate.wednesday.cpl;
        
        document.getElementById('thuBase').value = weeklyTemplate.thursday.base;
        document.getElementById('thuOT').value = weeklyTemplate.thursday.maxOT;
        document.getElementById('thuCPL').value = weeklyTemplate.thursday.cpl;
        
        document.getElementById('friBase').value = weeklyTemplate.friday.base;
        document.getElementById('friOT').value = weeklyTemplate.friday.maxOT;
        document.getElementById('friCPL').value = weeklyTemplate.friday.cpl;
        
        document.getElementById('satBase').value = weeklyTemplate.saturday.base;
        document.getElementById('satOT').value = weeklyTemplate.saturday.maxOT;
        document.getElementById('satCPL').value = weeklyTemplate.saturday.cpl;
        
        document.getElementById('sunOddBase').value = weeklyTemplate.sundayOdd.base;
        document.getElementById('sunOddOT').value = weeklyTemplate.sundayOdd.maxOT;
        document.getElementById('sunOddCPL').value = weeklyTemplate.sundayOdd.cpl;
        
        document.getElementById('sunEvenBase').value = weeklyTemplate.sundayEven.base;
        document.getElementById('sunEvenOT').value = weeklyTemplate.sundayEven.maxOT;
        document.getElementById('sunEvenCPL').value = weeklyTemplate.sundayEven.cpl;
        
        window.addDebugLog('Template loaded to UI', 'info');
    }

    function saveTemplate() {
        weeklyTemplate = {
            monday: { 
                base: parseFloat(document.getElementById('monBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('monOT').value) || 0, 
                cpl: parseFloat(document.getElementById('monCPL').value) || 0 
            },
            tuesday: { 
                base: parseFloat(document.getElementById('tueBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('tueOT').value) || 0, 
                cpl: parseFloat(document.getElementById('tueCPL').value) || 0 
            },
            wednesday: { 
                base: parseFloat(document.getElementById('wedBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('wedOT').value) || 0, 
                cpl: parseFloat(document.getElementById('wedCPL').value) || 0 
            },
            thursday: { 
                base: parseFloat(document.getElementById('thuBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('thuOT').value) || 0, 
                cpl: parseFloat(document.getElementById('thuCPL').value) || 0 
            },
            friday: { 
                base: parseFloat(document.getElementById('friBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('friOT').value) || 0, 
                cpl: parseFloat(document.getElementById('friCPL').value) || 0 
            },
            saturday: { 
                base: parseFloat(document.getElementById('satBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('satOT').value) || 0, 
                cpl: parseFloat(document.getElementById('satCPL').value) || 0 
            },
            sundayOdd: { 
                base: parseFloat(document.getElementById('sunOddBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('sunOddOT').value) || 0, 
                cpl: parseFloat(document.getElementById('sunOddCPL').value) || 0 
            },
            sundayEven: { 
                base: parseFloat(document.getElementById('sunEvenBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('sunEvenOT').value) || 0, 
                cpl: parseFloat(document.getElementById('sunEvenCPL').value) || 0 
            }
        };
        
        localStorage.setItem('weeklyTemplate', JSON.stringify(weeklyTemplate));
        alert('Template saved');
        window.addDebugLog('Template saved', 'success');
    }

    // ==================== SINGLE DATE OVERRIDE - FIXED ====================
    function showSingleDateOverride() {
        document.getElementById('singleDateModal').style.display = 'flex';
        document.getElementById('singleDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('singleBase').value = '';
        document.getElementById('singleOT').value = '';
        document.getElementById('singleCPL').value = '';
        window.addDebugLog('Single date override modal shown', 'info');
    }

    function closeSingleDateOverride() {
        document.getElementById('singleDateModal').style.display = 'none';
        window.addDebugLog('Single date override modal closed', 'info');
    }

    async function saveSingleDateOverride() {
        const date = document.getElementById('singleDate').value;
        const type = document.getElementById('singleType').value; // work, holiday, off
        const base = document.getElementById('singleBase').value;
        const ot = document.getElementById('singleOT').value;
        const cpl = document.getElementById('singleCPL').value;
        
        window.addDebugLog(`saveSingleDateOverride() - date: ${date}, type: ${type}`, 'info');
        window.addDebugLog(`base: ${base}, ot: ${ot}, cpl: ${cpl}`, 'info');
        
        if (!date) {
            alert('Please select date');
            return;
        }
        
        // Get existing entry first
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const existingEntry = entries.find(e => e.date === date) || {};
        
        const entry = {
            date: date,
            user_id: appCurrentUser.id,
            sync_status: 'pending',
            // Preserve existing values
            check_in: existingEntry.check_in || null,
            check_out: existingEntry.check_out || null,
            al_used: existingEntry.al_used || 0,
            sl_used: existingEntry.sl_used || 0,
            cl_used: existingEntry.cl_used || 0,
            cpl_used: existingEntry.cpl_used || 0
        };
        
        // Apply type-based rules
        if (type === 'work') {
            entry.is_holiday = false;
            entry.is_off_day = false;
            // Only set values if provided (not empty)
            if (base !== '') entry.base_hours_rule = parseFloat(base);
            if (ot !== '') entry.ot_cap_rule = parseFloat(ot);
            if (cpl !== '') entry.cpl_grant_rule = parseFloat(cpl);
            window.addDebugLog('Set as work day', 'info');
        } 
        else if (type === 'holiday') {
            entry.is_holiday = true;
            entry.is_off_day = false;
            // For holidays, set CPL grant if provided, otherwise keep existing or default
            if (cpl !== '') {
                entry.cpl_grant_rule = parseFloat(cpl);
            } else if (!existingEntry.cpl_grant_rule) {
                entry.cpl_grant_rule = 1.0; // Default holiday CPL
            }
            // Also allow base hours and OT cap if provided
            if (base !== '') entry.base_hours_rule = parseFloat(base);
            if (ot !== '') entry.ot_cap_rule = parseFloat(ot);
            window.addDebugLog(`Set as holiday with CPL: ${entry.cpl_grant_rule}`, 'info');
        } 
        else if (type === 'off') {
            entry.is_off_day = true;
            entry.is_holiday = false;
            // Clear work-related fields for off day
            entry.base_hours_rule = 0;
            entry.ot_cap_rule = 0;
            entry.cpl_grant_rule = 0;
            entry.final_ot_hours = 0;
            entry.cpl_earned = 0;
            window.addDebugLog('Set as off day', 'info');
        }
        
        window.addDebugLog(`Final entry: ${JSON.stringify(entry)}`, 'info');
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`Single date override saved for ${date}`, 'success');
            closeSingleDateOverride();
            alert(`✅ Override saved for ${date}`);
            
            // If this is today, reload today's entry
            if (date === new Date().toISOString().split('T')[0]) {
                await loadTodayEntry();
            }
            
            loadBalances();
            setTimeout(() => syncToCloud(), 1000);
        }
    }

    // FIXED: Optimized applyTemplateToRange with batching
    async function applyTemplateToRange() {
        const from = document.getElementById('rangeFrom').value;
        const to = document.getElementById('rangeTo').value;
        
        if (!from || !to) {
            alert('Select date range');
            return;
        }
        
        window.addDebugLog(`applyTemplateToRange() called from ${from} to ${to}`, 'info');
        
        // Show loading
        const applyBtn = document.querySelector('.apply-range-btn');
        const originalText = applyBtn.textContent;
        applyBtn.textContent = '⏳ Applying...';
        applyBtn.disabled = true;
        
        try {
            const start = new Date(from);
            const end = new Date(to);
            
            // Limit range to 30 days max to prevent timeout
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            window.addDebugLog(`Days in range: ${daysDiff}`, 'info');
            
            if (daysDiff > 30) {
                if (!confirm(`This will apply template to ${daysDiff} days which may take time. Continue?`)) {
                    applyBtn.textContent = originalText;
                    applyBtn.disabled = false;
                    return;
                }
            }
            
            // Prepare all entries first (in memory, not DB)
            const entriesToSave = [];
            let count = 0;
            
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                
                let base = 8, otCap = 1, cplGrant = 0;
                let isHoliday = false;
                
                if (dayName === 'sunday') {
                    const sundayWeek = getSundayWeekNumber(d);
                    if (sundayWeek % 2 === 1) { // Odd Sundays - Holiday pattern
                        base = weeklyTemplate.sundayOdd.base;
                        otCap = weeklyTemplate.sundayOdd.maxOT;
                        cplGrant = weeklyTemplate.sundayOdd.cpl;
                        isHoliday = true; // Mark odd Sundays as holidays
                        window.addDebugLog(`Date ${dateStr}: Sunday #${sundayWeek} (odd - HOLIDAY) - Base: ${base}, OT: ${otCap}, CPL: ${cplGrant}`, 'info');
                    } else { // Even Sundays - Normal Sunday
                        base = weeklyTemplate.sundayEven.base;
                        otCap = weeklyTemplate.sundayEven.maxOT;
                        cplGrant = weeklyTemplate.sundayEven.cpl;
                        isHoliday = false;
                        window.addDebugLog(`Date ${dateStr}: Sunday #${sundayWeek} (even - Normal) - Base: ${base}, OT: ${otCap}, CPL: ${cplGrant}`, 'info');
                    }
                } else {
                    base = weeklyTemplate[dayName]?.base || 8;
                    otCap = weeklyTemplate[dayName]?.maxOT || 1;
                    cplGrant = weeklyTemplate[dayName]?.cpl || 0;
                    isHoliday = false;
                    window.addDebugLog(`Date ${dateStr}: ${dayName} - Base: ${base}, OT: ${otCap}, CPL: ${cplGrant}`, 'info');
                }
                
                // Get existing entry to preserve check-in/out times
                const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
                const existingEntry = entries.find(e => e.date === dateStr) || {};
                
                entriesToSave.push({
                    date: dateStr,
                    user_id: appCurrentUser.id,
                    base_hours_rule: base,
                    ot_cap_rule: otCap,
                    cpl_grant_rule: cplGrant,
                    is_holiday: isHoliday,
                    is_off_day: false,
                    // Preserve existing check-in/out times
                    check_in: existingEntry.check_in || null,
                    check_out: existingEntry.check_out || null,
                    al_used: existingEntry.al_used || 0,
                    sl_used: existingEntry.sl_used || 0,
                    cl_used: existingEntry.cl_used || 0,
                    cpl_used: existingEntry.cpl_used || 0,
                    sync_status: 'pending'
                });
                
                count++;
            }
            
            window.addDebugLog(`Prepared ${count} entries, saving to DB...`, 'info');
            
            // Save to DB in batches of 10 to avoid UI freeze
            const batchSize = 10;
            for (let i = 0; i < entriesToSave.length; i += batchSize) {
                const batch = entriesToSave.slice(i, i + batchSize);
                window.addDebugLog(`Saving batch ${i/batchSize + 1}: ${batch.length} entries`, 'info');
                
                // Save batch
                await Promise.all(batch.map(entry => window.dbAPI.saveEntry(entry)));
                
                // Update progress
                applyBtn.textContent = `⏳ ${Math.min(i + batchSize, count)}/${count}`;
                
                // Allow UI to update
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            window.addDebugLog(`Applied template to ${count} days`, 'success');
            alert(`✅ Template applied to ${count} days`);
            
            // Auto sync
            setTimeout(() => syncToCloud(), 1000);
            
        } catch (error) {
            window.addDebugLog(`Error applying template: ${error.message}`, 'error');
            alert('Error applying template: ' + error.message);
        } finally {
            applyBtn.textContent = originalText;
            applyBtn.disabled = false;
        }
    }

    // ==================== HISTORY FUNCTIONS ====================
    async function filterHistory(type) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
        const from = document.getElementById('historyFrom').value;
        const to = document.getElementById('historyTo').value;
        
        window.addDebugLog(`filterHistory() called with type: ${type}, from: ${from}, to: ${to}`, 'info');
        
        let entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
        // Remove duplicates by date (keep only latest version)
        const uniqueEntries = {};
        entries.forEach(entry => {
            if (!uniqueEntries[entry.date] || new Date(entry.updated_at) > new Date(uniqueEntries[entry.date].updated_at)) {
                uniqueEntries[entry.date] = entry;
            }
        });
        
        entries = Object.values(uniqueEntries);
        window.addDebugLog(`Total unique entries: ${entries.length}`, 'info');
        
        if (from && to) {
            entries = entries.filter(e => e.date >= from && e.date <= to);
            window.addDebugLog(`After date filter: ${entries.length}`, 'info');
        }
        
        switch(type) {
            case 'ot':
                entries = entries.filter(e => e.final_ot_hours > 0);
                window.addDebugLog(`OT filter: ${entries.length} entries`, 'info');
                break;
            case 'cpl':
                entries = entries.filter(e => e.cpl_earned > 0);
                window.addDebugLog(`CPL filter: ${entries.length} entries`, 'info');
                break;
            case 'leave':
                entries = entries.filter(e => e.al_used > 0 || e.sl_used > 0 || e.cl_used > 0 || e.cpl_used > 0);
                window.addDebugLog(`Leave filter: ${entries.length} entries`, 'info');
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
        
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        entries.slice(0, 30).forEach(e => {
            const date = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
            let desc = '';
            
            if (e.is_off_day) desc = 'OFF DAY';
            else if (e.is_holiday) desc = 'HOLIDAY';
            else if (e.al_used > 0) desc = `ANNUAL LEAVE (${e.al_used} day)`;
            else if (e.sl_used > 0) desc = `SICK LEAVE (${e.sl_used} day)`;
            else if (e.cl_used > 0) desc = `CASUAL LEAVE (${e.cl_used} day)`;
            else if (e.cpl_used > 0) desc = `CPL USED (${e.cpl_used} day)`;
            else if (e.check_in && e.check_out) {
                const inTime = new Date(e.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const outTime = new Date(e.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                desc = `${inTime} - ${outTime}`;
                const details = [];
                if (e.base_hours_rule) details.push(`${e.base_hours_rule}h Base`);
                if (e.final_ot_hours > 0) details.push(`OT: ${e.final_ot_hours}h`);
                if (e.cpl_earned > 0) details.push(`CPL: ${e.cpl_earned}`);
                if (e.is_holiday) details.push(`Holiday`);
                if (details.length) desc += ` | ${details.join(' | ')}`;
            } else if (e.check_in) {
                const inTime = new Date(e.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                desc = `${inTime} - (open)`;
            }
            
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <div class="history-item-date">${date}:</div>
                <div class="history-item-desc">${desc}</div>
            `;
            list.appendChild(item);
        });
        
        window.addDebugLog(`Displayed ${entries.length} history entries`, 'success');
    }

    async function loadHistory() {
        if (!window.dbAPI || !appCurrentUser) return;
        window.addDebugLog('loadHistory() called', 'info');
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
        // Remove duplicates
        const uniqueEntries = {};
        entries.forEach(entry => {
            if (!uniqueEntries[entry.date] || new Date(entry.updated_at) > new Date(uniqueEntries[entry.date].updated_at)) {
                uniqueEntries[entry.date] = entry;
            }
        });
        
        displayHistory(Object.values(uniqueEntries));
    }

    // ==================== TAB NAVIGATION ====================
    function switchTab(tabName) {
        window.addDebugLog(`Switching to tab: ${tabName}`, 'info');
        
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        
        event.target.classList.add('active');
        document.getElementById(tabName + 'Tab').classList.add('active');
        
        if (tabName === 'history') loadHistory();
        if (tabName === 'balance') loadBalances();
        if (tabName === 'schedule') loadTemplateToUI();
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
    window.showManualEntry = showManualEntry;
    window.closeManualEntry = closeManualEntry;
    window.saveManualEntry = saveManualEntry;
    window.syncToCloud = syncToCloud;
    window.syncFromCloud = syncFromCloud;
    window.saveTemplate = saveTemplate;
    window.applyTemplateToRange = applyTemplateToRange;
    window.filterHistory = filterHistory;
    window.recalculateAll = recalculateAll;
    window.showSingleDateOverride = showSingleDateOverride;
    window.closeSingleDateOverride = closeSingleDateOverride;
    window.saveSingleDateOverride = saveSingleDateOverride;

    window.addDebugLog('app.js: Loading complete', 'success');
})();