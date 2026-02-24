// ==================== APP.JS - COMPLETE WITH DEBUG LOGGING ====================
// Use IIFE to avoid variable conflicts
(function() {
    // Check if addDebugLog exists, if not create it
    if (typeof window.addDebugLog !== 'function') {
        window.addDebugLog = function(msg, type) {
            console.log(`[${type}] ${msg}`);
        };
    }
    
    window.addDebugLog('app.js: Loading started...', 'info');

    // ==================== GLOBAL VARIABLES ====================
    // Use unique names to avoid conflicts with debug panel
    let appCurrentUser = null;
    let appAuthToken = null;
    let appCurrentCheckIn = null;
    let appCurrentCheckOut = null;

    // Template data
    const appWeeklyTemplate = {
        monday: { base: 8, maxOT: 1, cpl: 0 },
        tuesday: { base: 8, maxOT: 1, cpl: 0 },
        wednesday: { base: 8, maxOT: 1, cpl: 0 },
        thursday: { base: 8, maxOT: 1, cpl: 0 },
        friday: { base: 8, maxOT: 1, cpl: 0 },
        saturday: { base: 6, maxOT: 0.5, cpl: 0 },
        sunday1: { base: 8, maxOT: 0, cpl: 1.0 },  // 1st Sunday
        sunday2: { base: 6, maxOT: 0, cpl: 0.5 }    // 2nd+ Sunday
    };

    window.addDebugLog('Global variables initialized', 'success');

    // ==================== INITIALIZATION ====================
    document.addEventListener('DOMContentLoaded', function() {
        window.addDebugLog('app.js: DOMContentLoaded fired', 'success');
        
        // Update time every second
        updateDateTime();
        setInterval(updateDateTime, 1000);
        
        // Check if user is logged in
        checkAuth();
        
        window.addDebugLog('Initialization complete', 'success');
    });

    function updateDateTime() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase();
        
        const currentTimeEl = document.getElementById('currentTime');
        const currentDateEl = document.getElementById('currentDate');
        const homeTimeEl = document.getElementById('homeTime');
        const homeDateEl = document.getElementById('homeDate');
        
        if (currentTimeEl) currentTimeEl.textContent = timeStr;
        if (currentDateEl) currentDateEl.textContent = dateStr;
        if (homeTimeEl) homeTimeEl.textContent = timeStr;
        if (homeDateEl) homeDateEl.textContent = dateStr;
        
        // Also update auth times if they exist
        const authTimeEl = document.getElementById('authTime');
        const authDateEl = document.getElementById('authDate');
        if (authTimeEl) authTimeEl.textContent = timeStr;
        if (authDateEl) authDateEl.textContent = dateStr;
    }

    // ==================== AUTH FUNCTIONS ====================
    function showRegister() {
        window.addDebugLog('Switching to register screen', 'info');
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('registerScreen').style.display = 'block';
    }

    function showLogin() {
        window.addDebugLog('Switching to login screen', 'info');
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
                window.addDebugLog(`Found existing user: ${appCurrentUser.email}`, 'success');
                
                // Initialize database
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                    window.addDebugLog('Database initialized for user', 'success');
                }
                
                // Show app
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                // Load data
                loadBalances();
                loadTodayEntry();
                updateLastSyncTime();
                
                window.addDebugLog('App loaded successfully', 'success');
            } catch (error) {
                window.addDebugLog(`Auth error: ${error.message}`, 'error');
                showLogin();
            }
        } else {
            window.addDebugLog('No existing auth found', 'info');
            showLogin();
        }
    }

    async function login() {
        window.addDebugLog('login() called', 'info');
        
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        
        window.addDebugLog(`Login attempt for: ${email}`, 'info');
        
        if (!email || !password) {
            if (errorEl) errorEl.textContent = 'Email and password required';
            window.addDebugLog('Login failed: missing credentials', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            window.addDebugLog(`Login response status: ${response.status}`, 'info');
            
            // Check if response is OK before parsing JSON
            if (!response.ok) {
                const text = await response.text();
                window.addDebugLog(`Login failed with status ${response.status}: ${text}`, 'error');
                if (errorEl) errorEl.textContent = `Login failed (${response.status})`;
                return;
            }
            
            const data = await response.json();
            
            if (data.success) {
                appAuthToken = data.token;
                appCurrentUser = data.user;
                
                localStorage.setItem('auth_token', data.token);
                localStorage.setItem('auth_user', JSON.stringify(data.user));
                
                window.addDebugLog(`Login successful for user: ${appCurrentUser.id}`, 'success');
                
                // Initialize database
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                    window.addDebugLog('Database initialized', 'success');
                }
                
                // Show app
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                // Load data
                loadBalances();
                loadTodayEntry();
                updateLastSyncTime();
                
                window.addDebugLog('App ready', 'success');
                if (errorEl) errorEl.textContent = '';
            } else {
                if (errorEl) errorEl.textContent = data.message || 'Login failed';
                window.addDebugLog(`Login failed: ${data.message}`, 'error');
            }
        } catch (error) {
            window.addDebugLog(`Login error: ${error.message}`, 'error');
            if (errorEl) {
                errorEl.textContent = 'Connection error. Please check if server is running.';
            }
        }
    }

    async function register() {
        window.addDebugLog('register() called', 'info');
        
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const errorEl = document.getElementById('registerError');
        
        if (!name || !email || !password) {
            if (errorEl) errorEl.textContent = 'All fields required';
            window.addDebugLog('Registration failed: missing fields', 'error');
            return;
        }
        
        if (password.length < 6) {
            if (errorEl) errorEl.textContent = 'Password must be 6+ characters';
            window.addDebugLog('Registration failed: password too short', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name })
            });
            
            window.addDebugLog(`Register response status: ${response.status}`, 'info');
            
            if (!response.ok) {
                const text = await response.text();
                window.addDebugLog(`Registration failed with status ${response.status}`, 'error');
                if (errorEl) errorEl.textContent = `Registration failed (${response.status})`;
                return;
            }
            
            const data = await response.json();
            
            if (data.success) {
                window.addDebugLog('Registration successful', 'success');
                showLogin();
                document.getElementById('loginEmail').value = email;
                const loginError = document.getElementById('loginError');
                if (loginError) loginError.textContent = 'Registration successful! Please login.';
            } else {
                if (errorEl) errorEl.textContent = data.message || 'Registration failed';
                window.addDebugLog(`Registration failed: ${data.message}`, 'error');
            }
        } catch (error) {
            window.addDebugLog(`Register error: ${error.message}`, 'error');
            if (errorEl) {
                errorEl.textContent = 'Connection error. Please check if server is running.';
            }
        }
    }

    function logout() {
        window.addDebugLog('logout() called', 'info');
        
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            appAuthToken = null;
            appCurrentUser = null;
            
            if (window.dbAPI) {
                window.dbAPI.closeDatabase();
            }
            
            document.getElementById('appScreen').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'block';
            
            window.addDebugLog('Logged out successfully', 'success');
        }
    }

    // ==================== TAB NAVIGATION ====================
    function switchTab(tabName) {
        window.addDebugLog(`Switching to tab: ${tabName}`, 'info');
        
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        
        if (event && event.target) {
            event.target.classList.add('active');
        }
        
        let tabId = tabName;
        if (tabName === 'history') tabId = 'historyTab';
        else if (tabName === 'home') tabId = 'homeTab';
        else if (tabName === 'schedule') tabId = 'scheduleTab';
        else if (tabName === 'balance') tabId = 'balanceTab';
        
        const tabElement = document.getElementById(tabId);
        if (tabElement) {
            tabElement.classList.add('active');
        }
        
        if (tabName === 'balance') loadBalances();
        if (tabName === 'history') loadHistory();
    }

    // ==================== HOME PAGE FUNCTIONS ====================
    async function checkIn() {
        window.addDebugLog('checkIn() called', 'info');
        
        if (!appCurrentUser) {
            window.addDebugLog('Cannot check in: No user logged in', 'error');
            return;
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        const checkInDisplay = document.getElementById('checkInDisplay');
        if (checkInDisplay) checkInDisplay.textContent = timeStr;
        appCurrentCheckIn = now.toISOString();
        
        await saveTodayEntry({ check_in: appCurrentCheckIn });
        window.addDebugLog(`Check-in recorded: ${timeStr}`, 'success');
    }

    async function checkOut() {
        window.addDebugLog('checkOut() called', 'info');
        
        if (!appCurrentUser) {
            window.addDebugLog('Cannot check out: No user logged in', 'error');
            return;
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        const checkOutDisplay = document.getElementById('checkOutDisplay');
        if (checkOutDisplay) checkOutDisplay.textContent = timeStr;
        appCurrentCheckOut = now.toISOString();
        
        await saveTodayEntry({ check_out: appCurrentCheckOut });
        await calculateOT();
        window.addDebugLog(`Check-out recorded: ${timeStr}`, 'success');
    }

    async function markLeave(type) {
        window.addDebugLog(`markLeave() called with type: ${type}`, 'info');
        
        if (!appCurrentUser) {
            window.addDebugLog('Cannot mark leave: No user logged in', 'error');
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            [`${type}_used`]: 1,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`${type.toUpperCase()} leave marked for ${today}`, 'success');
            alert(`${type.toUpperCase()} leave marked for today`);
            loadBalances();
        }
    }

    async function markOffDay() {
        window.addDebugLog('markOffDay() called', 'info');
        
        if (!appCurrentUser) {
            window.addDebugLog('Cannot mark off day: No user logged in', 'error');
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            is_off_day: true,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`Off day marked for ${today}`, 'success');
            alert('Today marked as off day');
        }
    }

    async function saveTodayEntry(data) {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            ...data,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog('Today\'s entry saved', 'success');
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
                const checkInDisplay = document.getElementById('checkInDisplay');
                if (checkInDisplay) checkInDisplay.textContent = time;
            }
            if (todayEntry.check_out) {
                const time = new Date(todayEntry.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const checkOutDisplay = document.getElementById('checkOutDisplay');
                if (checkOutDisplay) checkOutDisplay.textContent = time;
            }
            window.addDebugLog('Today\'s entry loaded', 'success');
        }
    }

    async function calculateOT() {
        if (!appCurrentCheckIn || !appCurrentCheckOut || !appCurrentUser) return;
        
        const checkIn = new Date(appCurrentCheckIn);
        const checkOut = new Date(appCurrentCheckOut);
        const hoursWorked = (checkOut - checkIn) / (1000 * 60 * 60);
        
        const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const dayOfMonth = new Date().getDate();
        
        let base = 8;
        let otCap = 1;
        
        // Apply Sunday rules
        if (dayName === 'sunday') {
            if (dayOfMonth <= 7) {
                base = appWeeklyTemplate.sunday1.base;
                otCap = appWeeklyTemplate.sunday1.maxOT;
            } else {
                base = appWeeklyTemplate.sunday2.base;
                otCap = appWeeklyTemplate.sunday2.maxOT;
            }
        } else {
            base = appWeeklyTemplate[dayName]?.base || 8;
            otCap = appWeeklyTemplate[dayName]?.maxOT || 1;
        }
        
        const ot = Math.max(0, hoursWorked - base);
        const finalOT = Math.min(ot, otCap);
        
        const today = new Date().toISOString().split('T')[0];
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            check_in: appCurrentCheckIn,
            check_out: appCurrentCheckOut,
            base_hours_rule: base,
            ot_cap_rule: otCap,
            final_ot_hours: finalOT,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
        }
        window.addDebugLog(`OT calculated: ${finalOT.toFixed(2)} hours`, 'success');
    }

    // ==================== SCHEDULE FUNCTIONS ====================
    function toggleBulkSettings() {
        const bulk = document.getElementById('bulkSettings');
        if (bulk) {
            bulk.style.display = bulk.style.display === 'none' ? 'block' : 'none';
            window.addDebugLog(`Bulk settings ${bulk.style.display === 'block' ? 'shown' : 'hidden'}`, 'info');
        }
    }

    async function applyTemplate() {
        window.addDebugLog('applyTemplate() called', 'info');
        
        if (!appCurrentUser) {
            window.addDebugLog('Cannot apply template: No user logged in', 'error');
            return;
        }
        
        const fromDate = document.getElementById('rangeFrom')?.value;
        
        if (!fromDate) {
            alert('Please select a date');
            return;
        }
        
        // Get template values
        const template = {
            monday: {
                base: parseFloat(document.getElementById('monBase')?.value) || 0,
                ot: parseFloat(document.getElementById('monOT')?.value) || 0,
                cpl: parseFloat(document.getElementById('monCPL')?.value) || 0
            },
            tuesday: {
                base: parseFloat(document.getElementById('tueBase')?.value) || 0,
                ot: parseFloat(document.getElementById('tueOT')?.value) || 0,
                cpl: parseFloat(document.getElementById('tueCPL')?.value) || 0
            },
            wednesday: {
                base: parseFloat(document.getElementById('wedBase')?.value) || 0,
                ot: parseFloat(document.getElementById('wedOT')?.value) || 0,
                cpl: parseFloat(document.getElementById('wedCPL')?.value) || 0
            },
            thursday: {
                base: parseFloat(document.getElementById('thuBase')?.value) || 0,
                ot: parseFloat(document.getElementById('thuOT')?.value) || 0,
                cpl: parseFloat(document.getElementById('thuCPL')?.value) || 0
            },
            friday: {
                base: parseFloat(document.getElementById('friBase')?.value) || 0,
                ot: parseFloat(document.getElementById('friOT')?.value) || 0,
                cpl: parseFloat(document.getElementById('friCPL')?.value) || 0
            },
            saturday: {
                base: parseFloat(document.getElementById('satBase')?.value) || 0,
                ot: parseFloat(document.getElementById('satOT')?.value) || 0,
                cpl: parseFloat(document.getElementById('satCPL')?.value) || 0
            },
            sunday1: {
                base: parseFloat(document.getElementById('sun1Base')?.value) || 0,
                ot: parseFloat(document.getElementById('sun1OT')?.value) || 0,
                cpl: parseFloat(document.getElementById('sun1CPL')?.value) || 0
            },
            sunday2: {
                base: parseFloat(document.getElementById('sun2Base')?.value) || 0,
                ot: parseFloat(document.getElementById('sun2OT')?.value) || 0,
                cpl: parseFloat(document.getElementById('sun2CPL')?.value) || 0
            }
        };
        
        // Save to localStorage
        localStorage.setItem('weeklyTemplate_' + appCurrentUser.id, JSON.stringify(template));
        
        window.addDebugLog('Template saved and applied', 'success');
        alert('Template applied from ' + fromDate);
        toggleBulkSettings();
    }

    // ==================== BALANCE FUNCTIONS ====================
    async function loadBalances() {
        window.addDebugLog('loadBalances() called', 'info');
        
        if (!window.dbAPI || !appCurrentUser) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
        // Calculate balances (demo values for now)
        let alBalance = 15.49;
        let slBalance = 7.0;
        let cplBalance = 8.5;
        let otThisMonth = 22.5;
        
        // Deduct used leaves
        entries.forEach(entry => {
            if (entry.al_used) alBalance -= entry.al_used;
            if (entry.sl_used) slBalance -= entry.sl_used;
            if (entry.cpl_used) cplBalance -= entry.cpl_used;
        });
        
        // Update UI
        const alEl = document.getElementById('alBalance');
        const slEl = document.getElementById('slBalance');
        const sl2El = document.getElementById('slBalance2');
        const cplEl = document.getElementById('cplBalance');
        const otEl = document.getElementById('otMonth');
        
        if (alEl) alEl.textContent = alBalance.toFixed(2);
        if (slEl) slEl.textContent = slBalance.toFixed(2);
        if (sl2El) sl2El.textContent = slBalance.toFixed(2);
        if (cplEl) cplEl.textContent = cplBalance.toFixed(2);
        if (otEl) otEl.textContent = otThisMonth.toFixed(1);
        
        window.addDebugLog(`Balances loaded - AL: ${alBalance}, SL: ${slBalance}, CPL: ${cplBalance}`, 'success');
    }

    async function recalculateAll() {
        window.addDebugLog('recalculateAll() called', 'info');
        
        if (!confirm('This will recalculate all balances. Continue?')) return;
        
        // Recalculate logic here
        await loadBalances();
        
        window.addDebugLog('All balances recalculated', 'success');
        alert('All balances recalculated');
    }

    // ==================== HISTORY FUNCTIONS ====================
    let currentHistoryFilter = 'all';

    function filterHistory(filter) {
        window.addDebugLog(`Filtering history: ${filter}`, 'info');
        
        currentHistoryFilter = filter;
        
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        if (event && event.target) {
            event.target.classList.add('active');
        }
        
        loadHistory();
    }

    async function loadHistory() {
        window.addDebugLog('loadHistory() called', 'info');
        
        if (!window.dbAPI || !appCurrentUser) return;
        
        const fromDate = document.getElementById('historyFrom')?.value;
        const toDate = document.getElementById('historyTo')?.value;
        
        let entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
        // Apply date filter
        if (fromDate && toDate) {
            entries = entries.filter(e => e.date >= fromDate && e.date <= toDate);
        }
        
        // Apply achievement filter
        switch(currentHistoryFilter) {
            case 'achievement':
                entries = entries.filter(e => e.cpl_earned > 0 || e.final_ot_hours > 0);
                break;
            case 'anyOT':
                entries = entries.filter(e => e.final_ot_hours > 0);
                break;
            case 'anyCPL':
                entries = entries.filter(e => e.cpl_earned > 0);
                break;
            case 'nyot':
                entries = entries.filter(e => !e.final_ot_hours);
                break;
        }
        
        displayHistory(entries);
    }

    function displayHistory(entries) {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;
        
        historyList.innerHTML = '';
        
        if (entries.length === 0) {
            historyList.innerHTML = '<div class="history-item">No entries found</div>';
            return;
        }
        
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        entries.slice(0, 10).forEach(entry => {
            const date = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
            
            let desc = '';
            if (entry.is_off_day) desc = 'OFF DAY (holiday)';
            else if (entry.al_used) desc = 'ANNUAL LEAVE';
            else if (entry.sl_used) desc = 'SICK LEAVE';
            else if (entry.cl_used) desc = 'CASUAL LEAVE';
            else if (entry.cpl_used) desc = 'CPL USED';
            else if (entry.check_in && entry.check_out) {
                const inTime = new Date(entry.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const outTime = new Date(entry.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                desc = `${inTime} - ${outTime} | ${entry.base_hours_rule || 8}h Base`;
            }
            
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <span class="item-date">${date}:</span>
                <span class="item-desc">${desc}</span>
            `;
            
            historyList.appendChild(item);
        });
        
        window.addDebugLog(`Displayed ${Math.min(entries.length, 10)} history entries`, 'success');
    }

    // ==================== SYNC FUNCTIONS ====================
    async function syncFromCloud() {
        window.addDebugLog('syncFromCloud() called', 'info');
        
        if (!appAuthToken || !appCurrentUser) {
            window.addDebugLog('Sync failed: not authenticated', 'error');
            alert('Please login first');
            return;
        }
        
        const syncBox = document.querySelector('.sync-box');
        if (syncBox) syncBox.style.opacity = '0.5';
        
        try {
            const response = await fetch('/api/sync?direction=from', {
                headers: { 'Authorization': `Bearer ${appAuthToken}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.entries) {
                for (const entry of data.entries) {
                    if (window.dbAPI) {
                        await window.dbAPI.saveEntry(entry);
                    }
                }
                updateLastSyncTime();
                window.addDebugLog(`Synced ${data.entries.length} entries from cloud`, 'success');
                loadBalances();
                loadHistory();
                alert(`Synced ${data.entries.length} entries`);
            }
        } catch (error) {
            window.addDebugLog(`Sync error: ${error.message}`, 'error');
            alert('Sync failed: ' + error.message);
        } finally {
            if (syncBox) syncBox.style.opacity = '1';
        }
    }

    function updateLastSyncTime() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const lastSyncEl = document.getElementById('lastSyncTime');
        if (lastSyncEl) {
            lastSyncEl.textContent = `Last sync: ${timeStr}`;
        }
        window.addDebugLog('Last sync time updated', 'info');
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
    window.toggleBulkSettings = toggleBulkSettings;
    window.applyTemplate = applyTemplate;
    window.filterHistory = filterHistory;
    window.syncFromCloud = syncFromCloud;
    window.recalculateAll = recalculateAll;

    window.addDebugLog('app.js: All functions exposed to global scope', 'success');
    window.addDebugLog('app.js: Loading complete', 'success');
})();
