// ==================== APP.JS - WITH CLOUD SYNC ====================
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

    // Template data
    let weeklyTemplate = {
        monday: { base: 8, maxOT: 1, cpl: 0 },
        tuesday: { base: 8, maxOT: 1, cpl: 0 },
        wednesday: { base: 8, maxOT: 1, cpl: 0 },
        thursday: { base: 8, maxOT: 1, cpl: 0 },
        friday: { base: 8, maxOT: 1, cpl: 0 },
        saturday: { base: 6, maxOT: 0.5, cpl: 0 },
        sunday1: { base: 8, maxOT: 0, cpl: 1.0 },
        sunday2: { base: 6, maxOT: 0, cpl: 0.5 }
    };

    // ==================== INITIALIZATION ====================
    document.addEventListener('DOMContentLoaded', function() {
        window.addDebugLog('DOMContentLoaded fired', 'success');
        updateDateTime();
        setInterval(updateDateTime, 1000);
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
        
        document.getElementById('homeTime').textContent = timeStr;
        document.getElementById('homePeriod').textContent = ampm;
        document.getElementById('homeDate').textContent = dateStr;
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
                document.getElementById('logoutContainer').style.display = 'block';
                
                loadTodayEntry();
                loadBalances();
                updateLastSyncTime();
                
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
                document.getElementById('logoutContainer').style.display = 'block';
                
                loadTodayEntry();
                loadBalances();
                updateLastSyncTime();
                
                // Auto sync from cloud
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
            document.getElementById('logoutContainer').style.display = 'none';
        }
    }

    // ==================== HOME PAGE FUNCTIONS ====================
    async function checkIn() {
        if (!appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        document.getElementById('checkInDisplay').textContent = timeStr;
        appCurrentCheckIn = now.toISOString();
        
        await saveTodayEntry({ check_in: appCurrentCheckIn });
        window.addDebugLog(`Check-in recorded: ${timeStr}`, 'success');
        
        // Auto sync after check-in
        setTimeout(() => syncToCloud(), 1000);
    }

    async function checkOut() {
        if (!appCurrentUser) {
            alert('Please login first');
            return;
        }
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        document.getElementById('checkOutDisplay').textContent = timeStr;
        appCurrentCheckOut = now.toISOString();
        
        await saveTodayEntry({ check_out: appCurrentCheckOut });
        await calculateOT();
        window.addDebugLog(`Check-out recorded: ${timeStr}`, 'success');
        
        // Auto sync after check-out
        setTimeout(() => syncToCloud(), 1000);
    }

    async function markLeave(type) {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        
        const entry = {
            date: today,
            user_id: appCurrentUser.id,
            [`${type}_used`]: 1,
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`${type} leave marked`, 'success');
            loadBalances();
            
            // Auto sync after marking leave
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
            sync_status: 'pending'
        };
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog('Off day marked', 'success');
            
            // Auto sync
            setTimeout(() => syncToCloud(), 1000);
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
            }
            if (todayEntry.check_out) {
                const time = new Date(todayEntry.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                document.getElementById('checkOutDisplay').textContent = time;
            }
        }
    }

    async function calculateOT() {
        if (!appCurrentCheckIn || !appCurrentCheckOut || !appCurrentUser) return;
        
        const checkIn = new Date(appCurrentCheckIn);
        const checkOut = new Date(appCurrentCheckOut);
        const hoursWorked = (checkOut - checkIn) / (1000 * 60 * 60);
        
        const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const dayOfMonth = new Date().getDate();
        
        let base = 8, otCap = 1;
        
        if (dayName === 'sunday') {
            if (dayOfMonth <= 7) {
                base = weeklyTemplate.sunday1.base;
                otCap = weeklyTemplate.sunday1.maxOT;
            } else {
                base = weeklyTemplate.sunday2.base;
                otCap = weeklyTemplate.sunday2.maxOT;
            }
        } else {
            base = weeklyTemplate[dayName]?.base || 8;
            otCap = weeklyTemplate[dayName]?.maxOT || 1;
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
    }

    // ==================== MANUAL ENTRY ====================
    function showManualEntry() {
        document.getElementById('manualEntryModal').style.display = 'flex';
        document.getElementById('manualDate').value = new Date().toISOString().split('T')[0];
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
        
        const entry = {
            date: date,
            user_id: appCurrentUser.id,
            sync_status: 'pending'
        };
        
        if (type === 'work') {
            if (checkIn) entry.check_in = new Date(`${date}T${checkIn}`).toISOString();
            if (checkOut) entry.check_out = new Date(`${date}T${checkOut}`).toISOString();
        } else if (type === 'off') {
            entry.is_off_day = true;
        } else {
            entry[`${type}_used`] = 1;
        }
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`Manual entry saved for ${date}`, 'success');
            closeManualEntry();
            
            // Auto sync
            setTimeout(() => syncToCloud(), 1000);
            
            if (date === new Date().toISOString().split('T')[0]) {
                loadTodayEntry();
            }
        }
    }

    // ==================== SYNC FUNCTIONS (CLOUD) ====================
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
            // Get pending entries from IndexedDB
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
                // Mark as synced in local DB
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
        
        let al = 15.49, sl = 7.0, cl = 7.0, cpl = 8.5, ot = 22.5;
        
        entries.forEach(e => {
            if (e.al_used) al -= e.al_used;
            if (e.sl_used) sl -= e.sl_used;
            if (e.cl_used) cl -= e.cl_used;
            if (e.cpl_used) cpl -= e.cpl_used;
        });
        
        document.getElementById('alBalance').textContent = al.toFixed(2);
        document.getElementById('slBalance').textContent = sl.toFixed(2);
        document.getElementById('clBalance').textContent = cl.toFixed(2);
        document.getElementById('cplBalance').textContent = cpl.toFixed(2);
        document.getElementById('otMonth').textContent = ot.toFixed(1);
    }

    async function recalculateAll() {
        if (confirm('Recalculate all balances?')) {
            await loadBalances();
            alert('Balances recalculated');
        }
    }

    // ==================== SCHEDULE FUNCTIONS ====================
    function saveTemplate() {
        weeklyTemplate = {
            monday: { base: parseFloat(document.getElementById('monBase').value) || 0, maxOT: parseFloat(document.getElementById('monOT').value) || 0, cpl: parseFloat(document.getElementById('monCPL').value) || 0 },
            tuesday: { base: parseFloat(document.getElementById('tueBase').value) || 0, maxOT: parseFloat(document.getElementById('tueOT').value) || 0, cpl: parseFloat(document.getElementById('tueCPL').value) || 0 },
            wednesday: { base: parseFloat(document.getElementById('wedBase').value) || 0, maxOT: parseFloat(document.getElementById('wedOT').value) || 0, cpl: parseFloat(document.getElementById('wedCPL').value) || 0 },
            thursday: { base: parseFloat(document.getElementById('thuBase').value) || 0, maxOT: parseFloat(document.getElementById('thuOT').value) || 0, cpl: parseFloat(document.getElementById('thuCPL').value) || 0 },
            friday: { base: parseFloat(document.getElementById('friBase').value) || 0, maxOT: parseFloat(document.getElementById('friOT').value) || 0, cpl: parseFloat(document.getElementById('friCPL').value) || 0 },
            saturday: { base: parseFloat(document.getElementById('satBase').value) || 0, maxOT: parseFloat(document.getElementById('satOT').value) || 0, cpl: parseFloat(document.getElementById('satCPL').value) || 0 },
            sunday1: { base: parseFloat(document.getElementById('sun1Base').value) || 0, maxOT: parseFloat(document.getElementById('sun1OT').value) || 0, cpl: parseFloat(document.getElementById('sun1CPL').value) || 0 },
            sunday2: { base: parseFloat(document.getElementById('sun2Base').value) || 0, maxOT: parseFloat(document.getElementById('sun2OT').value) || 0, cpl: parseFloat(document.getElementById('sun2CPL').value) || 0 }
        };
        
        localStorage.setItem('weeklyTemplate', JSON.stringify(weeklyTemplate));
        alert('Template saved');
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
            const dayOfMonth = d.getDate();
            
            let template;
            if (dayName === 'sunday') {
                template = dayOfMonth <= 7 ? weeklyTemplate.sunday1 : weeklyTemplate.sunday2;
            } else {
                template = weeklyTemplate[dayName] || { base: 8, maxOT: 1, cpl: 0 };
            }
            
            const entry = {
                date: dateStr,
                user_id: appCurrentUser.id,
                base_hours_rule: template.base,
                ot_cap_rule: template.maxOT,
                cpl_grant_rule: template.cpl,
                sync_status: 'pending'
            };
            
            await window.dbAPI.saveEntry(entry);
            count++;
        }
        
        window.addDebugLog(`Applied template to ${count} days`, 'success');
        alert(`Template applied to ${count} days`);
        
        // Auto sync
        setTimeout(() => syncToCloud(), 1000);
    }

    // ==================== HISTORY FUNCTIONS ====================
    async function filterHistory(type) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
        const from = document.getElementById('historyFrom').value;
        const to = document.getElementById('historyTo').value;
        
        let entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
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
        
        entries.slice(0, 20).forEach(e => {
            const date = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
            let desc = '';
            
            if (e.is_off_day) desc = 'OFF DAY';
            else if (e.al_used) desc = 'ANNUAL LEAVE';
            else if (e.sl_used) desc = 'SICK LEAVE';
            else if (e.cl_used) desc = 'CASUAL LEAVE';
            else if (e.cpl_used) desc = 'CPL USED';
            else if (e.check_in && e.check_out) {
                const inTime = new Date(e.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const outTime = new Date(e.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                desc = `${inTime} - ${outTime} | ${e.base_hours_rule || 8}h Base`;
                if (e.final_ot_hours) desc += ` | OT: ${e.final_ot_hours}h`;
            }
            
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <div class="history-item-date">${date}</div>
                <div class="history-item-desc">${desc}</div>
            `;
            list.appendChild(item);
        });
    }

    // ==================== TAB NAVIGATION ====================
    function switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        
        event.target.classList.add('active');
        document.getElementById(tabName + 'Tab').classList.add('active');
        
        if (tabName === 'history') loadHistory();
        if (tabName === 'balance') loadBalances();
    }

    async function loadHistory() {
        if (!window.dbAPI || !appCurrentUser) return;
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        displayHistory(entries);
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

    window.addDebugLog('app.js: Loading complete', 'success');
})();
