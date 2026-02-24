// ==================== GLOBAL VARIABLES ====================
let currentUser = null;
let authToken = null;
let db = null;
let weeklyTemplate = {
    monday: { base: 8, maxOT: 1, cpl: 0 },
    tuesday: { base: 8, maxOT: 1, cpl: 0 },
    wednesday: { base: 8, maxOT: 1, cpl: 0 },
    thursday: { base: 8, maxOT: 1, cpl: 0 },
    friday: { base: 8, maxOT: 1, cpl: 0 },
    saturday: { base: 6, maxOT: 0.5, cpl: 0 },
    sunday: { base: 0, maxOT: 0, cpl: 1 }
};

let currentCheckIn = null;
let currentCheckOut = null;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    checkAuth();
});

function updateDateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase();
    
    document.getElementById('currentTime').textContent = timeStr;
    document.getElementById('currentDate').textContent = dateStr;
    document.getElementById('authTime').textContent = timeStr;
    document.getElementById('authDate').textContent = dateStr;
    document.getElementById('registerTime').textContent = timeStr;
    document.getElementById('registerDate').textContent = dateStr;
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

async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');

    if (!email || !password) {
        errorEl.textContent = 'Please enter email and password';
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
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_user', JSON.stringify(data.user));
            
            await window.dbAPI.initDatabaseForUser(data.user.id);
            
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('appScreen').style.display = 'block';
            
            loadInitialData();
            updateLastSyncTime();
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
        errorEl.textContent = 'Password must be at least 6 characters';
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
            document.getElementById('loginPassword').value = '';
            alert('Registration successful! Please login.');
        } else {
            errorEl.textContent = data.message || 'Registration failed';
        }
    } catch (error) {
        errorEl.textContent = 'Connection error';
    }
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        authToken = null;
        currentUser = null;
        document.getElementById('appScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'block';
    }
}

// ==================== TAB NAVIGATION ====================
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    if (tabName === 'schedule') loadWeeklyTemplate();
    if (tabName === 'balance') loadBalances();
    if (tabName === 'search') loadSearchResults();
}

// ==================== HOME PAGE FUNCTIONS ====================
async function checkIn() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    document.getElementById('checkInDisplay').textContent = timeStr;
    currentCheckIn = now.toISOString();
    
    await saveTodayEntry({ checkIn: currentCheckIn });
    showManualOverride();
}

async function checkOut() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    document.getElementById('checkOutDisplay').textContent = timeStr;
    currentCheckOut = now.toISOString();
    
    await saveTodayEntry({ checkOut: currentCheckOut });
    await calculateTodayOT();
    showManualOverride();
}

function showManualOverride() {
    document.getElementById('manualSection').style.display = 'block';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('manualDate').value = today;
}

function cancelManual() {
    document.getElementById('manualSection').style.display = 'none';
}

async function saveManualEntry() {
    const date = document.getElementById('manualDate').value;
    const checkIn = document.getElementById('manualIn').value;
    const checkOut = document.getElementById('manualOut').value;
    
    if (!date) {
        alert('Please select date');
        return;
    }
    
    const entry = {
        date: date,
        check_in: checkIn ? new Date(`${date}T${checkIn}`).toISOString() : null,
        check_out: checkOut ? new Date(`${date}T${checkOut}`).toISOString() : null,
        user_id: currentUser.id,
        sync_status: 'pending'
    };
    
    await window.dbAPI.saveEntry(entry);
    document.getElementById('manualSection').style.display = 'none';
    alert('Manual entry saved');
}

async function markLeave(type) {
    const today = new Date().toISOString().split('T')[0];
    
    const entry = {
        date: today,
        user_id: currentUser.id,
        [`${type}_used`]: 1,
        sync_status: 'pending'
    };
    
    await window.dbAPI.saveEntry(entry);
    
    // Update balance immediately
    if (type === 'annual') await deductAL(1);
    if (type === 'sick') await deductSL(1);
    if (type === 'casual') await deductCL(1);
    if (type === 'cpl') await deductCPL(1);
    
    alert(`${type.toUpperCase()} leave marked for today`);
}

async function markOffDay() {
    const today = new Date().toISOString().split('T')[0];
    
    const entry = {
        date: today,
        user_id: currentUser.id,
        is_off_day: true,
        sync_status: 'pending'
    };
    
    await window.dbAPI.saveEntry(entry);
    alert('Today marked as off day');
}

// ==================== SCHEDULE PAGE FUNCTIONS ====================
function loadWeeklyTemplate() {
    const tbody = document.getElementById('weeklyTemplateBody');
    tbody.innerHTML = '';
    
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    days.forEach(day => {
        const key = day.toLowerCase();
        const template = weeklyTemplate[key] || { base: 0, maxOT: 0, cpl: 0 };
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${day}</td>
            <td><input type="number" value="${template.base}" step="0.5" min="0" onchange="updateTemplate('${key}', 'base', this.value)"></td>
            <td><input type="number" value="${template.maxOT}" step="0.5" min="0" onchange="updateTemplate('${key}', 'maxOT', this.value)"></td>
            <td><input type="number" value="${template.cpl}" step="0.5" min="0" onchange="updateTemplate('${key}', 'cpl', this.value)"></td>
        `;
        tbody.appendChild(row);
    });
}

function updateTemplate(day, field, value) {
    if (!weeklyTemplate[day]) weeklyTemplate[day] = { base: 0, maxOT: 0, cpl: 0 };
    weeklyTemplate[day][field] = parseFloat(value) || 0;
    saveTemplate();
}

function saveTemplate() {
    localStorage.setItem('weeklyTemplate_' + currentUser.id, JSON.stringify(weeklyTemplate));
}

function toggleBulkSettings() {
    const bulk = document.getElementById('bulkSettings');
    bulk.style.display = bulk.style.display === 'none' ? 'block' : 'none';
}

async function applyTemplate() {
    const fromDate = document.getElementById('rangeFrom').value;
    const toDate = document.getElementById('rangeTo').value;
    const specialSunday = document.getElementById('specialSunday').checked;
    
    if (!fromDate || !toDate) {
        alert('Please select date range');
        return;
    }
    
    const entries = [];
    const start = new Date(fromDate);
    const end = new Date(toDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const dayOfMonth = d.getDate();
        
        let template = weeklyTemplate[dayName] || { base: 0, maxOT: 0, cpl: 0 };
        
        // Special Sunday logic
        if (specialSunday && dayName === 'sunday') {
            const isFirstSunday = dayOfMonth <= 7;
            if (isFirstSunday) {
                template = { base: 8, maxOT: 0, cpl: 1.0 };
            } else {
                template = { base: 6, maxOT: 0, cpl: 0.5 };
            }
        }
        
        entries.push({
            date: dateStr,
            user_id: currentUser.id,
            base_hours_rule: template.base,
            ot_cap_rule: template.maxOT,
            cpl_grant_rule: template.cpl,
            sync_status: 'pending'
        });
    }
    
    for (const entry of entries) {
        await window.dbAPI.saveEntry(entry);
    }
    
    alert(`Applied template to ${entries.length} days`);
    toggleBulkSettings();
}

async function saveOverride() {
    const date = document.getElementById('singleDate').value;
    const type = document.getElementById('singleType').value;
    const base = document.getElementById('singleBase').value;
    const ot = document.getElementById('singleOT').value;
    const cpl = document.getElementById('singleCPL').value;
    
    if (!date) {
        alert('Please select date');
        return;
    }
    
    const entry = {
        date: date,
        user_id: currentUser.id,
        base_hours_rule: parseFloat(base) || 0,
        ot_cap_rule: parseFloat(ot) || 0,
        cpl_grant_rule: parseFloat(cpl) || 0,
        is_holiday: type === 'holiday',
        is_off_day: type === 'off',
        sync_status: 'pending'
    };
    
    await window.dbAPI.saveEntry(entry);
    alert('Override saved for ' + date);
}

// ==================== BALANCE PAGE FUNCTIONS ====================
async function loadBalances() {
    const entries = await window.dbAPI.getAllEntriesForUser(currentUser.id);
    
    // Calculate balances
    let alBalance = 15.49; // Starting balance
    let slBalance = 7.0;
    let clBalance = 7.0;
    let cplBalance = 8.5;
    
    // Calculate AL accrual (1.83 every 30 days)
    const lastAccrual = localStorage.getItem('lastALAccrual_' + currentUser.id);
    if (lastAccrual) {
        const daysSince = Math.floor((new Date() - new Date(lastAccrual)) / (1000 * 60 * 60 * 24));
        const accruals = Math.floor(daysSince / 30);
        alBalance += accruals * 1.83;
    }
    
    // Deduct used leaves
    entries.forEach(entry => {
        if (entry.al_used) alBalance -= entry.al_used;
        if (entry.sl_used) slBalance -= entry.sl_used;
        if (entry.cl_used) clBalance -= entry.cl_used;
        if (entry.cpl_used) cplBalance -= entry.cpl_used;
    });
    
    // Calculate CPL using FIFO (last 180 days)
    const cplEarned = entries
        .filter(e => e.cpl_earned && new Date(e.date) > new Date(Date.now() - 180 * 24 * 60 * 60 * 1000))
        .reduce((sum, e) => sum + e.cpl_earned, 0);
    
    cplBalance = cplEarned - (8.5 - cplBalance); // Adjust based on used
    
    // Calculate OT this month and last month
    const now = new Date();
    const thisMonth = now.getMonth();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const thisYear = now.getFullYear();
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
    
    let otThisMonth = 0;
    let otLastMonth = 0;
    
    entries.forEach(entry => {
        const entryDate = new Date(entry.date);
        if (entry.final_ot_hours) {
            if (entryDate.getMonth() === thisMonth && entryDate.getFullYear() === thisYear) {
                otThisMonth += entry.final_ot_hours;
            }
            if (entryDate.getMonth() === lastMonth && entryDate.getFullYear() === lastMonthYear) {
                otLastMonth += entry.final_ot_hours;
            }
        }
    });
    
    // Update UI
    document.getElementById('alBalance').textContent = alBalance.toFixed(2);
    document.getElementById('slBalance').textContent = slBalance.toFixed(2);
    document.getElementById('clBalance').textContent = clBalance.toFixed(2);
    document.getElementById('cplBalance').textContent = cplBalance.toFixed(2);
    document.getElementById('otMonth').textContent = otThisMonth.toFixed(1);
    document.getElementById('otThisMonth').textContent = otThisMonth.toFixed(1);
    document.getElementById('otLastMonth').textContent = otLastMonth.toFixed(1);
}

async function deductAL(days) {
    const alBalance = parseFloat(document.getElementById('alBalance').textContent);
    document.getElementById('alBalance').textContent = (alBalance - days).toFixed(2);
}

async function deductSL(days) {
    const slBalance = parseFloat(document.getElementById('slBalance').textContent);
    document.getElementById('slBalance').textContent = (slBalance - days).toFixed(2);
}

async function deductCL(days) {
    const clBalance = parseFloat(document.getElementById('clBalance').textContent);
    document.getElementById('clBalance').textContent = (clBalance - days).toFixed(2);
}

async function deductCPL(days) {
    const cplBalance = parseFloat(document.getElementById('cplBalance').textContent);
    document.getElementById('cplBalance').textContent = (cplBalance - days).toFixed(2);
}

async function recalculateAll() {
    if (!confirm('This will recalculate all balances. Continue?')) return;
    
    const entries = await window.dbAPI.getAllEntriesForUser(currentUser.id);
    
    for (const entry of entries) {
        await calculateEntry(entry);
    }
    
    await loadBalances();
    alert('All balances recalculated');
}

// ==================== CALCULATION ENGINE ====================
async function calculateTodayOT() {
    if (!currentCheckIn || !currentCheckOut) return;
    
    const today = new Date().toISOString().split('T')[0];
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const template = weeklyTemplate[dayName] || { base: 8, maxOT: 1, cpl: 0 };
    
    const checkIn = new Date(currentCheckIn);
    const checkOut = new Date(currentCheckOut);
    const hoursWorked = (checkOut - checkIn) / (1000 * 60 * 60);
    
    const ot = Math.max(0, hoursWorked - template.base);
    const finalOT = Math.min(ot, template.maxOT);
    
    const entry = {
        date: today,
        user_id: currentUser.id,
        check_in: currentCheckIn,
        check_out: currentCheckOut,
        base_hours_rule: template.base,
        ot_cap_rule: template.maxOT,
        cpl_grant_rule: template.cpl,
        final_ot_hours: finalOT,
        cpl_earned: template.cpl,
        sync_status: 'pending'
    };
    
    await window.dbAPI.saveEntry(entry);
}

async function calculateEntry(entry) {
    if (entry.is_off_day) {
        entry.final_ot_hours = 0;
        entry.cpl_earned = 0;
        return entry;
    }
    
    if (entry.al_used > 0 || entry.sl_used > 0 || entry.cl_used > 0 || entry.cpl_used > 0) {
        entry.final_ot_hours = 0;
        entry.cpl_earned = 0;
        return entry;
    }
    
    if (entry.check_in && entry.check_out) {
        const checkIn = new Date(entry.check_in);
        const checkOut = new Date(entry.check_out);
        const hoursWorked = (checkOut - checkIn) / (1000 * 60 * 60);
        
        const baseRule = entry.base_hours_rule || 8;
        const otCap = entry.ot_cap_rule || 1;
        
        const ot = Math.max(0, hoursWorked - baseRule);
        entry.final_ot_hours = Math.min(ot, otCap);
    }
    
    if (entry.is_holiday && !entry.is_off_day) {
        entry.cpl_earned = entry.cpl_grant_rule || 1;
    }
    
    entry.sync_status = 'pending';
    return entry;
}

// ==================== SEARCH PAGE FUNCTIONS ====================
let currentSearchFilter = 'all';

function filterBy(filter) {
    currentSearchFilter = filter;
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    loadSearchResults();
}

async function loadSearchResults() {
    const fromDate = document.getElementById('searchFrom').value;
    const toDate = document.getElementById('searchTo').value;
    
    let entries = await window.dbAPI.getAllEntriesForUser(currentUser.id);
    
    // Apply date filter
    if (fromDate && toDate) {
        entries = entries.filter(e => e.date >= fromDate && e.date <= toDate);
    }
    
    // Apply achievement filter
    switch(currentSearchFilter) {
        case 'achievement':
            entries = entries.filter(e => e.cpl_earned > 0 || e.final_ot_hours > 0);
            break;
        case 'anyOT':
            entries = entries.filter(e => e.final_ot_hours > 0);
            break;
        case 'nyot':
            entries = entries.filter(e => !e.final_ot_hours);
            break;
        case 'anyCPL':
            entries = entries.filter(e => e.cpl_earned > 0);
            break;
    }
    
    displaySearchResults(entries);
}

function displaySearchResults(entries) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';
    
    if (entries.length === 0) {
        resultsDiv.innerHTML = '<div class="no-results">No entries found</div>';
        return;
    }
    
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'search-item';
        
        let type = '';
        if (entry.al_used) type = 'ANNUAL';
        else if (entry.sl_used) type = 'SICK';
        else if (entry.cl_used) type = 'CASUAL';
        else if (entry.cpl_used) type = 'CPL';
        else if (entry.is_off_day) type = 'OFF DAY';
        else if (entry.is_holiday) type = 'HOLIDAY';
        else type = 'WORK';
        
        const date = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
        
        item.innerHTML = `
            <div class="search-item-date">${date}</div>
            <div class="search-item-type">${type}</div>
            ${entry.check_in ? `<div class="search-item-time">${new Date(entry.check_in).toLocaleTimeString()} - ${entry.check_out ? new Date(entry.check_out).toLocaleTimeString() : '--:--'}</div>` : ''}
            ${entry.final_ot_hours ? `<div class="search-item-ot">OT: ${entry.final_ot_hours}h</div>` : ''}
            ${entry.cpl_earned ? `<div class="search-item-cpl">CPL: ${entry.cpl_earned}</div>` : ''}
        `;
        
        resultsDiv.appendChild(item);
    });
}

async function searchCloud() {
    if (!authToken) return;
    
    try {
        const fromDate = document.getElementById('searchFrom').value;
        const toDate = document.getElementById('searchTo').value;
        
        const response = await fetch(`/api/archive?from=${fromDate}&to=${toDate}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success && data.entries) {
            for (const entry of data.entries) {
                await window.dbAPI.saveEntry(entry);
            }
            alert(`Loaded ${data.entries.length} entries from cloud`);
            loadSearchResults();
        }
    } catch (error) {
        alert('Failed to load from cloud');
    }
}

// ==================== SYNC FUNCTIONS ====================
async function syncFromCloud() {
    if (!authToken) return;
    
    const syncBtn = document.querySelector('.sync-box');
    syncBtn.style.opacity = '0.5';
    
    try {
        const response = await fetch('/api/sync?direction=from', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success && data.entries) {
            for (const entry of data.entries) {
                await window.dbAPI.saveEntry(entry);
            }
            updateLastSyncTime();
            alert(`Synced ${data.entries.length} entries`);
        }
    } catch (error) {
        console.error('Sync failed:', error);
    } finally {
        syncBtn.style.opacity = '1';
    }
}

async function syncToCloud() {
    if (!authToken) return;
    
    const pendingEntries = await window.dbAPI.getEntriesNeedingSync();
    
    if (pendingEntries.length === 0) return;
    
    try {
        const response = await fetch('/api/sync?direction=to', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ entries: pendingEntries })
        });
        
        const data = await response.json();
        
        if (data.success) {
            await window.dbAPI.markAsSynced(data.syncedIds);
            updateLastSyncTime();
        }
    } catch (error) {
        console.error('Sync failed:', error);
    }
}

function updateLastSyncTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('lastSyncTime').textContent = `Last sync: ${timeStr}`;
}

// ==================== INITIAL DATA LOAD ====================
async function loadInitialData() {
    await loadBalances();
    loadWeeklyTemplate();
    
    // Load today's entry
    const today = new Date().toISOString().split('T')[0];
    const entries = await window.dbAPI.getAllEntriesForUser(currentUser.id);
    const todayEntry = entries.find(e => e.date === today);
    
    if (todayEntry) {
        if (todayEntry.check_in) {
            document.getElementById('checkInDisplay').textContent = 
                new Date(todayEntry.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        }
        if (todayEntry.check_out) {
            document.getElementById('checkOutDisplay').textContent = 
                new Date(todayEntry.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        }
    }
    
    // Try to sync from cloud
    setTimeout(syncFromCloud, 2000);
}

// ==================== EXPOSE GLOBALLY ====================
window.login = login;
window.register = register;
window.logout = logout;
window.showRegister = showRegister;
window.showLogin = showLogin;
window.switchTab = switchTab;
window.checkIn = checkIn;
window.checkOut = checkOut;
window.markLeave = markLeave;
window.markOffDay = markOffDay;
window.showManualOverride = showManualOverride;
window.cancelManual = cancelManual;
window.saveManualEntry = saveManualEntry;
window.updateTemplate = updateTemplate;
window.toggleBulkSettings = toggleBulkSettings;
window.applyTemplate = applyTemplate;
window.saveOverride = saveOverride;
window.filterBy = filterBy;
window.searchCloud = searchCloud;
window.syncFromCloud = syncFromCloud;
window.recalculateAll = recalculateAll;
