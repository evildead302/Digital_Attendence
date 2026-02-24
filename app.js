// ==================== APP.JS - COMPLETE WITH DEBUG LOGGING ====================
addDebugLog('app.js: Loading started...', 'info');

// ==================== GLOBAL VARIABLES ====================
let currentUser = null;
let authToken = null;
let currentCheckIn = null;
let currentCheckOut = null;

// Template data
const weeklyTemplate = {
    monday: { base: 8, maxOT: 1, cpl: 0 },
    tuesday: { base: 8, maxOT: 1, cpl: 0 },
    wednesday: { base: 8, maxOT: 1, cpl: 0 },
    thursday: { base: 8, maxOT: 1, cpl: 0 },
    friday: { base: 8, maxOT: 1, cpl: 0 },
    saturday: { base: 6, maxOT: 0.5, cpl: 0 },
    sunday1: { base: 8, maxOT: 0, cpl: 1.0 },  // 1st Sunday
    sunday2: { base: 6, maxOT: 0, cpl: 0.5 }    // 2nd+ Sunday
};

addDebugLog('Global variables initialized', 'success');

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    addDebugLog('app.js: DOMContentLoaded fired', 'success');
    
    // Update time every second
    updateDateTime();
    setInterval(updateDateTime, 1000);
    
    // Check if user is logged in
    checkAuth();
    
    addDebugLog('Initialization complete', 'success');
});

function updateDateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase();
    
    document.getElementById('currentTime').textContent = timeStr;
    document.getElementById('currentDate').textContent = dateStr;
    document.getElementById('homeTime').textContent = timeStr;
    document.getElementById('homeDate').textContent = dateStr;
    
    // Also update auth times if they exist
    if (document.getElementById('authTime')) {
        document.getElementById('authTime').textContent = timeStr;
        document.getElementById('authDate').textContent = dateStr;
    }
}

// ==================== AUTH FUNCTIONS ====================
function showRegister() {
    addDebugLog('Switching to register screen', 'info');
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('registerScreen').style.display = 'block';
}

function showLogin() {
    addDebugLog('Switching to login screen', 'info');
    document.getElementById('registerScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'block';
}

async function checkAuth() {
    addDebugLog('checkAuth() called', 'info');
    
    const token = localStorage.getItem('auth_token');
    const userStr = localStorage.getItem('auth_user');
    
    if (token && userStr) {
        try {
            currentUser = JSON.parse(userStr);
            authToken = token;
            addDebugLog(`Found existing user: ${currentUser.email}`, 'success');
            
            // Initialize database
            if (window.dbAPI) {
                await window.dbAPI.initDatabaseForUser(currentUser.id);
                addDebugLog('Database initialized for user', 'success');
            }
            
            // Show app
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('appScreen').style.display = 'block';
            
            // Load data
            loadBalances();
            loadTodayEntry();
            updateLastSyncTime();
            
            addDebugLog('App loaded successfully', 'success');
        } catch (error) {
            addDebugLog(`Auth error: ${error.message}`, 'error');
            showLogin();
        }
    } else {
        addDebugLog('No existing auth found', 'info');
        showLogin();
    }
}

async function login() {
    addDebugLog('login() called', 'info');
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    addDebugLog(`Login attempt for: ${email}`, 'info');
    
    if (!email || !password) {
        errorEl.textContent = 'Email and password required';
        addDebugLog('Login failed: missing credentials', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        addDebugLog(`Login response status: ${response.status}`, 'info');
        
        const data = await response.json();
        
        if (data.success) {
            authToken = data.token;
            currentUser = data.user;
            
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_user', JSON.stringify(data.user));
            
            addDebugLog(`Login successful for user: ${currentUser.id}`, 'success');
            
            // Initialize database
            if (window.dbAPI) {
                await window.dbAPI.initDatabaseForUser(currentUser.id);
                addDebugLog('Database initialized', 'success');
            }
            
            // Show app
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('appScreen').style.display = 'block';
            
            // Load data
            loadBalances();
            loadTodayEntry();
            updateLastSyncTime();
            
            addDebugLog('App ready', 'success');
            errorEl.textContent = '';
        } else {
            errorEl.textContent = data.message || 'Login failed';
            addDebugLog(`Login failed: ${data.message}`, 'error');
        }
    } catch (error) {
        errorEl.textContent = 'Connection error';
        addDebugLog(`Login error: ${error.message}`, 'error');
    }
}

async function register() {
    addDebugLog('register() called', 'info');
    
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const errorEl = document.getElementById('registerError');
    
    if (!name || !email || !password) {
        errorEl.textContent = 'All fields required';
        addDebugLog('Registration failed: missing fields', 'error');
        return;
    }
    
    if (password.length < 6) {
        errorEl.textContent = 'Password must be 6+ characters';
        addDebugLog('Registration failed: password too short', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name })
        });
        
        addDebugLog(`Register response status: ${response.status}`, 'info');
        
        const data = await response.json();
        
        if (data.success) {
            addDebugLog('Registration successful', 'success');
            showLogin();
            document.getElementById('loginEmail').value = email;
            document.getElementById('loginError').textContent = 'Registration successful! Please login.';
        } else {
            errorEl.textContent = data.message || 'Registration failed';
            addDebugLog(`Registration failed: ${data.message}`, 'error');
        }
    } catch (error) {
        errorEl.textContent = 'Connection error';
        addDebugLog(`Register error: ${error.message}`, 'error');
    }
}

function logout() {
    addDebugLog('logout() called', 'info');
    
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        authToken = null;
        currentUser = null;
        
        document.getElementById('appScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'block';
        
        addDebugLog('Logged out successfully', 'success');
    }
}

// ==================== TAB NAVIGATION ====================
function switchTab(tabName) {
    addDebugLog(`Switching to tab: ${tabName}`, 'info');
    
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    
    event.target.classList.add('active');
    
    let tabId = tabName;
    if (tabName === 'history') tabId = 'historyTab';
    else if (tabName === 'home') tabId = 'homeTab';
    else if (tabName === 'schedule') tabId = 'scheduleTab';
    else if (tabName === 'balance') tabId = 'balanceTab';
    
    document.getElementById(tabId).classList.add('active');
    
    if (tabName === 'balance') loadBalances();
    if (tabName === 'history') loadHistory();
}

// ==================== HOME PAGE FUNCTIONS ====================
async function checkIn() {
    addDebugLog('checkIn() called', 'info');
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    document.getElementById('checkInDisplay').textContent = timeStr;
    currentCheckIn = now.toISOString();
    
    await saveTodayEntry({ check_in: currentCheckIn });
    addDebugLog(`Check-in recorded: ${timeStr}`, 'success');
}

async function checkOut() {
    addDebugLog('checkOut() called', 'info');
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    document.getElementById('checkOutDisplay').textContent = timeStr;
    currentCheckOut = now.toISOString();
    
    await saveTodayEntry({ check_out: currentCheckOut });
    await calculateOT();
    addDebugLog(`Check-out recorded: ${timeStr}`, 'success');
}

async function markLeave(type) {
    addDebugLog(`markLeave() called with type: ${type}`, 'info');
    
    const today = new Date().toISOString().split('T')[0];
    
    const entry = {
        date: today,
        user_id: currentUser.id,
        [`${type}_used`]: 1,
        sync_status: 'pending'
    };
    
    if (window.dbAPI) {
        await window.dbAPI.saveEntry(entry);
        addDebugLog(`${type.toUpperCase()} leave marked for ${today}`, 'success');
        alert(`${type.toUpperCase()} leave marked for today`);
        loadBalances();
    }
}

async function markOffDay() {
    addDebugLog('markOffDay() called', 'info');
    
    const today = new Date().toISOString().split('T')[0];
    
    const entry = {
        date: today,
        user_id: currentUser.id,
        is_off_day: true,
        sync_status: 'pending'
    };
    
    if (window.dbAPI) {
        await window.dbAPI.saveEntry(entry);
        addDebugLog(`Off day marked for ${today}`, 'success');
        alert('Today marked as off day');
    }
}

async function saveTodayEntry(data) {
    if (!currentUser) return;
    
    const today = new Date().toISOString().split('T')[0];
    
    const entry = {
        date: today,
        user_id: currentUser.id,
        ...data,
        sync_status: 'pending'
    };
    
    if (window.dbAPI) {
        await window.dbAPI.saveEntry(entry);
        addDebugLog('Today\'s entry saved', 'success');
    }
}

async function loadTodayEntry() {
    if (!window.dbAPI || !currentUser) return;
    
    const today = new Date().toISOString().split('T')[0];
    const entries = await window.dbAPI.getAllEntriesForUser(currentUser.id);
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
        addDebugLog('Today\'s entry loaded', 'success');
    }
}

async function calculateOT() {
    if (!currentCheckIn || !currentCheckOut) return;
    
    const checkIn = new Date(currentCheckIn);
    const checkOut = new Date(currentCheckOut);
    const hoursWorked = (checkOut - checkIn) / (1000 * 60 * 60);
    
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const dayOfMonth = new Date().getDate();
    
    let base = 8;
    let otCap = 1;
    
    // Apply Sunday rules
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
        user_id: currentUser.id,
        check_in: currentCheckIn,
        check_out: currentCheckOut,
        base_hours_rule: base,
        ot_cap_rule: otCap,
        final_ot_hours: finalOT,
        sync_status: 'pending'
    };
    
    await window.dbAPI.saveEntry(entry);
    addDebugLog(`OT calculated: ${finalOT.toFixed(2)} hours`, 'success');
}

// ==================== SCHEDULE FUNCTIONS ====================
function toggleBulkSettings() {
    const bulk = document.getElementById('bulkSettings');
    bulk.style.display = bulk.style.display === 'none' ? 'block' : 'none';
    addDebugLog(`Bulk settings ${bulk.style.display === 'block' ? 'shown' : 'hidden'}`, 'info');
}

async function applyTemplate() {
    addDebugLog('applyTemplate() called', 'info');
    
    const fromDate = document.getElementById('rangeFrom').value;
    
    if (!fromDate) {
        alert('Please select a date');
        return;
    }
    
    // Get template values
    const template = {
        monday: {
            base: parseFloat(document.getElementById('monBase').value) || 0,
            ot: parseFloat(document.getElementById('monOT').value) || 0,
            cpl: parseFloat(document.getElementById('monCPL').value) || 0
        },
        tuesday: {
            base: parseFloat(document.getElementById('tueBase').value) || 0,
            ot: parseFloat(document.getElementById('tueOT').value) || 0,
            cpl: parseFloat(document.getElementById('tueCPL').value) || 0
        },
        wednesday: {
            base: parseFloat(document.getElementById('wedBase').value) || 0,
            ot: parseFloat(document.getElementById('wedOT').value) || 0,
            cpl: parseFloat(document.getElementById('wedCPL').value) || 0
        },
        thursday: {
            base: parseFloat(document.getElementById('thuBase').value) || 0,
            ot: parseFloat(document.getElementById('thuOT').value) || 0,
            cpl: parseFloat(document.getElementById('thuCPL').value) || 0
        },
        friday: {
            base: parseFloat(document.getElementById('friBase').value) || 0,
            ot: parseFloat(document.getElementById('friOT').value) || 0,
            cpl: parseFloat(document.getElementById('friCPL').value) || 0
        },
        saturday: {
            base: parseFloat(document.getElementById('satBase').value) || 0,
            ot: parseFloat(document.getElementById('satOT').value) || 0,
            cpl: parseFloat(document.getElementById('satCPL').value) || 0
        },
        sunday1: {
            base: parseFloat(document.getElementById('sun1Base').value) || 0,
            ot: parseFloat(document.getElementById('sun1OT').value) || 0,
            cpl: parseFloat(document.getElementById('sun1CPL').value) || 0
        },
        sunday2: {
            base: parseFloat(document.getElementById('sun2Base').value) || 0,
            ot: parseFloat(document.getElementById('sun2OT').value) || 0,
            cpl: parseFloat(document.getElementById('sun2CPL').value) || 0
        }
    };
    
    // Save to localStorage
    localStorage.setItem('weeklyTemplate_' + currentUser.id, JSON.stringify(template));
    
    addDebugLog('Template saved and applied', 'success');
    alert('Template applied from ' + fromDate);
    toggleBulkSettings();
}

// ==================== BALANCE FUNCTIONS ====================
async function loadBalances() {
    addDebugLog('loadBalances() called', 'info');
    
    if (!window.dbAPI || !currentUser) return;
    
    const entries = await window.dbAPI.getAllEntriesForUser(currentUser.id);
    
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
    document.getElementById('alBalance').textContent = alBalance.toFixed(2);
    document.getElementById('slBalance').textContent = slBalance.toFixed(2);
    document.getElementById('slBalance2').textContent = slBalance.toFixed(2);
    document.getElementById('cplBalance').textContent = cplBalance.toFixed(2);
    document.getElementById('otMonth').textContent = otThisMonth.toFixed(1);
    
    addDebugLog(`Balances loaded - AL: ${alBalance}, SL: ${slBalance}, CPL: ${cplBalance}`, 'success');
}

async function recalculateAll() {
    addDebugLog('recalculateAll() called', 'info');
    
    if (!confirm('This will recalculate all balances. Continue?')) return;
    
    // Recalculate logic here
    await loadBalances();
    
    addDebugLog('All balances recalculated', 'success');
    alert('All balances recalculated');
}

// ==================== HISTORY FUNCTIONS ====================
let currentHistoryFilter = 'all';

function filterHistory(filter) {
    addDebugLog(`Filtering history: ${filter}`, 'info');
    
    currentHistoryFilter = filter;
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    loadHistory();
}

async function loadHistory() {
    addDebugLog('loadHistory() called', 'info');
    
    if (!window.dbAPI || !currentUser) return;
    
    const fromDate = document.getElementById('historyFrom').value;
    const toDate = document.getElementById('historyTo').value;
    
    let entries = await window.dbAPI.getAllEntriesForUser(currentUser.id);
    
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
    
    addDebugLog(`Displayed ${Math.min(entries.length, 10)} history entries`, 'success');
}

// ==================== SYNC FUNCTIONS ====================
async function syncFromCloud() {
    addDebugLog('syncFromCloud() called', 'info');
    
    if (!authToken || !currentUser) {
        addDebugLog('Sync failed: not authenticated', 'error');
        return;
    }
    
    const syncBox = document.querySelector('.sync-box');
    syncBox.style.opacity = '0.5';
    
    try {
        const response = await fetch('/api/sync?direction=from', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success && data.entries) {
            for (const entry of data.entries) {
                if (window.dbAPI) {
                    await window.dbAPI.saveEntry(entry);
                }
            }
            updateLastSyncTime();
            addDebugLog(`Synced ${data.entries.length} entries from cloud`, 'success');
            loadBalances();
            loadHistory();
        }
    } catch (error) {
        addDebugLog(`Sync error: ${error.message}`, 'error');
    } finally {
        syncBox.style.opacity = '1';
    }
}

function updateLastSyncTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('lastSyncTime').textContent = `Last sync: ${timeStr}`;
    addDebugLog('Last sync time updated', 'info');
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

addDebugLog('app.js: All functions exposed to global scope', 'success');
addDebugLog('app.js: Loading complete', 'success');
