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
        sundayOdd: { base: 8, maxOT: 0, cpl: 1.0 },  // 1st, 3rd, 5th Sundays
        sundayEven: { base: 6, maxOT: 0, cpl: 0.5 }  // 2nd, 4th Sundays
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
                
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                }
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                loadTodayEntry();
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
                
                localStorage.setItem('auth_token', data.token);
                localStorage.setItem('auth_user', JSON.stringify(data.user));
                
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                }
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                loadTodayEntry();
                loadBalances();
                updateLastSyncTime();
                loadTemplateToUI();
                
                setTimeout(() => syncFromCloud(), 2000);
                
                errorEl.textContent = '';
            } else {
                errorEl.textContent = data.message || 'Login failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error';
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
            } else {
                errorEl.textContent = data.message || 'Registration failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error';
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
        }
    }

    // ==================== HOME PAGE FUNCTIONS ====================
    async function checkIn() {
        if (!appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        // Check if already checked in today
        const today = new Date().toISOString().split('T')[0];
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const todayEntry = entries.find(e => e.date === today);
        
        if (todayEntry && todayEntry.check_in && !todayEntry.check_out) {
            if (!confirm('You are already checked in. Check in again?')) {
                return;
            }
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        document.getElementById('checkInDisplay').textContent = timeStr;
        appCurrentCheckIn = now.toISOString();
        
        await saveTodayEntry({ 
            check_in: appCurrentCheckIn,
            check_out: null  // Clear checkout when checking in
        });
        
        window.addDebugLog(`Check-in recorded: ${timeStr}`, 'success');
        
        // Auto sync after check-in
        setTimeout(() => syncToCloud(), 1000);
    }

    async function checkOut() {
        if (!appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        // Check if checked in today
        const today = new Date().toISOString().split('T')[0];
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const todayEntry = entries.find(e => e.date === today);
        
        if (!todayEntry || !todayEntry.check_in) {
            alert('You must check in first before checking out');
            return;
        }
        
        if (todayEntry.check_out) {
            if (!confirm('Already checked out. Override?')) {
                return;
            }
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        // Validate check out is after check in
        const checkInTime = todayEntry.check_in ? new Date(todayEntry.check_in) : null;
        if (checkInTime && now <= checkInTime) {
            alert('Check out time must be after check in time');
            return;
        }
        
        document.getElementById('checkOutDisplay').textContent = timeStr;
        appCurrentCheckOut = now.toISOString();
        
        await saveTodayEntry({ 
            check_out: appCurrentCheckOut 
        });
        
        await calculateOT(todayEntry.check_in, appCurrentCheckOut);
        window.addDebugLog(`Check-out recorded: ${timeStr}`, 'success');
        
        // Auto sync after check-out
        setTimeout(() => syncToCloud(), 1000);
    }

    async function markLeave(type) {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        
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
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`${type} leave marked`, 'success');
            
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
        
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            is_off_day: true,
            check_in: null,
            check_out: null,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog('Off day marked', 'success');
            
            // Clear check displays
            document.getElementById('checkInDisplay').textContent = '--:--';
            document.getElementById('checkOutDisplay').textContent = '--:--';
            
            setTimeout(() => syncToCloud(), 1000);
        }
    }

    async function saveTodayEntry(data) {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        
        // Get existing entry first
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const existingEntry = entries.find(e => e.date === today) || {};
        
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
            base_hours_rule: existingEntry.base_hours_rule || 8,
            ot_cap_rule: existingEntry.ot_cap_rule || 1,
            final_ot_hours: existingEntry.final_ot_hours || 0,
            cpl_earned: existingEntry.cpl_earned || 0,
            sync_status: 'pending',
            ...data
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
        }
    }

    async function loadTodayEntry() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const todayEntry = entries.find(e => e.date === today);
        
        if (todayEntry) {
            if (todayEntry.check_in) {
                const time = new Date(todayEntry.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                document.getElementById('checkInDisplay').textContent = time;
                appCurrentCheckIn = todayEntry.check_in;
            }
            if (todayEntry.check_out) {
                const time = new Date(todayEntry.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                document.getElementById('checkOutDisplay').textContent = time;
                appCurrentCheckOut = todayEntry.check_out;
            }
        } else {
            // Reset displays if no entry
            document.getElementById('checkInDisplay').textContent = '--:--';
            document.getElementById('checkOutDisplay').textContent = '--:--';
        }
    }

    function getSundayWeekNumber(date) {
        // Calculate which Sunday of the month (1st, 2nd, 3rd, 4th, 5th)
        const dayOfMonth = date.getDate();
        return Math.ceil(dayOfMonth / 7);
    }

    async function calculateOT(checkIn, checkOut) {
        if (!checkIn || !checkOut || !appCurrentUser) return;
        
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        const hoursWorked = (checkOutDate - checkInDate) / (1000 * 60 * 60);
        
        if (hoursWorked < 0) {
            window.addDebugLog('Negative hours worked - not calculating OT', 'error');
            return;
        }
        
        const date = checkInDate.toISOString().split('T')[0];
        const dayName = checkInDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        let base = 8, otCap = 1, cplGrant = 0;
        
        if (dayName === 'sunday') {
            // SUNDAY ALTERNATING RULE: 1st,3rd,5th = 1.0 CPL | 2nd,4th = 0.5 CPL
            const sundayWeek = getSundayWeekNumber(checkInDate);
            
            if (sundayWeek % 2 === 1) { // Odd Sundays (1st, 3rd, 5th)
                base = weeklyTemplate.sundayOdd.base;
                otCap = weeklyTemplate.sundayOdd.maxOT;
                cplGrant = weeklyTemplate.sundayOdd.cpl;
                window.addDebugLog(`Sunday #${sundayWeek} (odd) - CPL: ${cplGrant}`, 'info');
            } else { // Even Sundays (2nd, 4th)
                base = weeklyTemplate.sundayEven.base;
                otCap = weeklyTemplate.sundayEven.maxOT;
                cplGrant = weeklyTemplate.sundayEven.cpl;
                window.addDebugLog(`Sunday #${sundayWeek} (even) - CPL: ${cplGrant}`, 'info');
            }
        } else {
            base = weeklyTemplate[dayName]?.base || 8;
            otCap = weeklyTemplate[dayName]?.maxOT || 1;
            cplGrant = weeklyTemplate[dayName]?.cpl || 0;
        }
        
        const ot = Math.max(0, hoursWorked - base);
        const finalOT = Math.min(ot, otCap);
        
        const entry = {
            date: date,
            user_id: appCurrentUser.id,
            check_in: checkIn,
            check_out: checkOut,
            base_hours_rule: base,
            ot_cap_rule: otCap,
            final_ot_hours: finalOT,
            cpl_earned: cplGrant,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
        }
        window.addDebugLog(`OT calculated: ${finalOT.toFixed(2)} hours, CPL: ${cplGrant}`, 'success');
    }

    // ==================== MANUAL ENTRY ====================
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
        
        // Validate check out after check in
        if (checkIn && checkOut) {
            const inTime = new Date(`${date}T${checkIn}`);
            const outTime = new Date(`${date}T${checkOut}`);
            if (outTime <= inTime) {
                alert('Check out time must be after check in time');
                return;
            }
        }
        
        const entry = {
            date: date,
            user_id: appCurrentUser.id,
            sync_status: 'pending',
            al_used: 0,
            sl_used: 0,
            cl_used: 0,
            cpl_used: 0,
            is_off_day: false
        };
        
        if (type === 'work') {
            if (checkIn) entry.check_in = new Date(`${date}T${checkIn}`).toISOString();
            if (checkOut) entry.check_out = new Date(`${date}T${checkOut}`).toISOString();
            
            // Calculate OT if both times present
            if (checkIn && checkOut) {
                const inDate = new Date(`${date}T${checkIn}`);
                const outDate = new Date(`${date}T${checkOut}`);
                const hoursWorked = (outDate - inDate) / (1000 * 60 * 60);
                
                const dayName = inDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                
                let base = 8, otCap = 1, cplGrant = 0;
                
                if (dayName === 'sunday') {
                    const sundayWeek = getSundayWeekNumber(inDate);
                    if (sundayWeek % 2 === 1) { // Odd Sundays
                        base = weeklyTemplate.sundayOdd.base;
                        otCap = weeklyTemplate.sundayOdd.maxOT;
                        cplGrant = weeklyTemplate.sundayOdd.cpl;
                    } else { // Even Sundays
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
            }
        } else if (type === 'off') {
            entry.is_off_day = true;
        } else {
            entry[`${type}_used`] = 1;
        }
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`Manual entry saved for ${date}`, 'success');
            closeManualEntry();
            
            setTimeout(() => syncToCloud(), 1000);
            
            if (date === new Date().toISOString().split('T')[0]) {
                loadTodayEntry();
            }
            loadBalances();
        }
    }

    // ==================== SYNC FUNCTIONS ====================
    async function syncToCloud() {
        if (!appAuthToken || !appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        window.addDebugLog('Syncing to cloud...', 'info');
        
        const syncOutBtn = document.querySelector('.sync-out');
        const originalText = syncOutBtn.innerHTML;
        syncOutBtn.innerHTML = '<span class="sync-icon">⏳</span> SYNCING...';
        syncOutBtn.disabled = true;
        
        try {
            const pendingEntries = await window.dbAPI.getEntriesNeedingSync();
            
            if (pendingEntries.length === 0) {
                window.addDebugLog('No entries to sync', 'info');
                alert('All entries are synced');
                return;
            }
            
            window.addDebugLog(`Sending ${pendingEntries.length} entries to cloud`, 'info');
            
            const response = await fetch('/api/sync?direction=to', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${appAuthToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ entries: pendingEntries })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                await window.dbAPI.markAsSynced(data.syncedIds);
                updateLastSyncTime();
                window.addDebugLog(`Synced ${data.syncedIds.length} entries`, 'success');
                alert(`Synced ${data.syncedIds.length} entries to cloud`);
            }
            
        } catch (error) {
            window.addDebugLog(`Sync error: ${error.message}`, 'error');
            alert('Sync failed: ' + error.message);
        } finally {
            syncOutBtn.innerHTML = originalText;
            syncOutBtn.disabled = false;
        }
    }

    async function syncFromCloud() {
        if (!appAuthToken || !appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        window.addDebugLog('Syncing from cloud...', 'info');
        
        const syncInBtn = document.querySelector('.sync-in');
        const originalText = syncInBtn.innerHTML;
        syncInBtn.innerHTML = '<span class="sync-icon">⏳</span> SYNCING...';
        syncInBtn.disabled = true;
        
        try {
            const response = await fetch('/api/sync?direction=from', {
                headers: { 'Authorization': `Bearer ${appAuthToken}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.entries) {
                let imported = 0;
                for (const entry of data.entries) {
                    await window.dbAPI.saveEntry(entry);
                    imported++;
                }
                
                updateLastSyncTime();
                window.addDebugLog(`Imported ${imported} entries from cloud`, 'success');
                
                loadTodayEntry();
                loadBalances();
                
                if (imported > 0) {
                    alert(`Imported ${imported} entries from cloud`);
                }
            }
            
        } catch (error) {
            window.addDebugLog(`Sync error: ${error.message}`, 'error');
        } finally {
            syncInBtn.innerHTML = originalText;
            syncInBtn.disabled = false;
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
    }

    // ==================== BALANCE FUNCTIONS ====================
    async function loadBalances() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
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
        // Sort earned CPL by date (oldest first)
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
        
        window.addDebugLog(`Balances loaded - AL: ${alBalance.toFixed(2)}, CPL: ${cplBalance.toFixed(2)}`, 'success');
    }

    async function recalculateAll() {
        if (confirm('Recalculate all balances? This will re-evaluate all entries.')) {
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

    // Single Date Override
    function showSingleDateOverride() {
        document.getElementById('singleDateModal').style.display = 'flex';
        document.getElementById('singleDate').value = new Date().toISOString().split('T')[0];
    }

    function closeSingleDateOverride() {
        document.getElementById('singleDateModal').style.display = 'none';
    }

    async function saveSingleDateOverride() {
        const date = document.getElementById('singleDate').value;
        const type = document.getElementById('singleType').value;
        const base = parseFloat(document.getElementById('singleBase').value) || 0;
        const ot = parseFloat(document.getElementById('singleOT').value) || 0;
        const cpl = parseFloat(document.getElementById('singleCPL').value) || 0;
        
        if (!date) {
            alert('Please select date');
            return;
        }
        
        const entry = {
            date: date,
            user_id: appCurrentUser.id,
            base_hours_rule: base,
            ot_cap_rule: ot,
            cpl_grant_rule: cpl,
            sync_status: 'pending'
        };
        
        if (type === 'holiday') {
            entry.is_holiday = true;
        } else if (type === 'off') {
            entry.is_off_day = true;
        }
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`Single date override saved for ${date}`, 'success');
            closeSingleDateOverride();
            alert(`Override saved for ${date}`);
            setTimeout(() => syncToCloud(), 1000);
        }
    }

    async function applyTemplateToRange() {
        const from = document.getElementById('rangeFrom').value;
        const to = document.getElementById('rangeTo').value;
        
        if (!from || !to) {
            alert('Select date range');
            return;
        }
        
        const start = new Date(from);
        const end = new Date(to);
        let count = 0;
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            
            let base = 8, otCap = 1, cplGrant = 0;
            
            if (dayName === 'sunday') {
                const sundayWeek = getSundayWeekNumber(d);
                if (sundayWeek % 2 === 1) { // Odd Sundays
                    base = weeklyTemplate.sundayOdd.base;
                    otCap = weeklyTemplate.sundayOdd.maxOT;
                    cplGrant = weeklyTemplate.sundayOdd.cpl;
                } else { // Even Sundays
                    base = weeklyTemplate.sundayEven.base;
                    otCap = weeklyTemplate.sundayEven.maxOT;
                    cplGrant = weeklyTemplate.sundayEven.cpl;
                }
            } else {
                base = weeklyTemplate[dayName]?.base || 8;
                otCap = weeklyTemplate[dayName]?.maxOT || 1;
                cplGrant = weeklyTemplate[dayName]?.cpl || 0;
            }
            
            const entry = {
                date: dateStr,
                user_id: appCurrentUser.id,
                base_hours_rule: base,
                ot_cap_rule: otCap,
                cpl_grant_rule: cplGrant,
                sync_status: 'pending'
            };
            
            await window.dbAPI.saveEntry(entry);
            count++;
        }
        
        window.addDebugLog(`Applied template to ${count} days`, 'success');
        alert(`Template applied to ${count} days`);
        setTimeout(() => syncToCloud(), 1000);
    }

    // ==================== HISTORY FUNCTIONS ====================
    async function filterHistory(type) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
        const from = document.getElementById('historyFrom').value;
        const to = document.getElementById('historyTo').value;
        
        let entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
        // Remove duplicates by date (keep only latest version)
        const uniqueEntries = {};
        entries.forEach(entry => {
            if (!uniqueEntries[entry.date] || new Date(entry.updated_at) > new Date(uniqueEntries[entry.date].updated_at)) {
                uniqueEntries[entry.date] = entry;
            }
        });
        
        entries = Object.values(uniqueEntries);
        
        if (from && to) {
            entries = entries.filter(e => e.date >= from && e.date <= to);
        }
        
        switch(type) {
            case 'ot':
                entries = entries.filter(e => e.final_ot_hours > 0);
                break;
            case 'cpl':
                entries = entries.filter(e => e.cpl_earned > 0);
                break;
            case 'leave':
                entries = entries.filter(e => e.al_used || e.sl_used || e.cl_used || e.cpl_used);
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
            else if (e.al_used) desc = `ANNUAL LEAVE (${e.al_used} day)`;
            else if (e.sl_used) desc = `SICK LEAVE (${e.sl_used} day)`;
            else if (e.cl_used) desc = `CASUAL LEAVE (${e.cl_used} day)`;
            else if (e.cpl_used) desc = `CPL USED (${e.cpl_used} day)`;
            else if (e.check_in && e.check_out) {
                const inTime = new Date(e.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const outTime = new Date(e.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                desc = `${inTime} - ${outTime}`;
                const details = [];
                if (e.base_hours_rule) details.push(`${e.base_hours_rule}h Base`);
                if (e.final_ot_hours) details.push(`OT: ${e.final_ot_hours}h`);
                if (e.cpl_earned) details.push(`CPL: ${e.cpl_earned}`);
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
