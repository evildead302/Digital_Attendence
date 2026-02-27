// ==================== APP.JS - COMPLETE WITH ALL FEATURES ====================
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
        
        // Setup collapsible sections
        setupCollapsibleSections();
        
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

    // ==================== COLLAPSIBLE SECTIONS ====================
    function setupCollapsibleSections() {
        document.querySelectorAll('.collapsible-header').forEach(header => {
            header.addEventListener('click', function() {
                this.classList.toggle('active');
                const content = this.nextElementSibling;
                if (content.style.maxHeight) {
                    content.style.maxHeight = null;
                } else {
                    content.style.maxHeight = content.scrollHeight + "px";
                }
            });
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

    // ==================== AL EXPIRY CALCULATION ====================
    function calculateALExpiry(earnedDate) {
        const date = new Date(earnedDate);
        const year = date.getFullYear();
        // AL expires at end of next year (Dec 31 of year+1)
        const expiryDate = new Date(year + 1, 11, 31);
        return expiryDate.toISOString().split('T')[0];
    }

    // ==================== CPL EXPIRY CALCULATION ====================
    function calculateCPLExpiry(earnedDate) {
        const date = new Date(earnedDate);
        date.setDate(date.getDate() + 180);
        return date.toISOString().split('T')[0];
    }

    // ==================== RECALCULATE ENTRY FUNCTION ====================
    async function recalculateEntry(entry) {
        if (!entry || !entry.date) return entry;
        
        window.addDebugLog(`Recalculating entry for ${entry.date}`, 'info');
        
        // Make a copy to work with
        const updatedEntry = { ...entry };
        
        // Check if it's an off day or leave day
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
        
        // If no check-in/out, nothing to calculate
        if (!updatedEntry.check_in || !updatedEntry.check_out) {
            window.addDebugLog('No check-in/out times, skipping OT calculation', 'info');
            return updatedEntry;
        }
        
        // Calculate hours worked
        const checkInDate = new Date(updatedEntry.check_in);
        const checkOutDate = new Date(updatedEntry.check_out);
        const hoursWorked = (checkOutDate - checkInDate) / (1000 * 60 * 60);
        
        window.addDebugLog(`Hours worked: ${hoursWorked.toFixed(2)}`, 'info');
        
        if (hoursWorked < 0) {
            window.addDebugLog('Negative hours worked - invalid', 'error');
            return updatedEntry;
        }
        
        const dayName = checkInDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        // Determine base hours, OT cap, and CPL grant based on rules
        let base = 8, otCap = 1, cplGrant = 0;
        let isHoliday = false;
        
        // First check if explicitly set in entry (from override)
        if (updatedEntry.base_hours_rule !== undefined) {
            base = updatedEntry.base_hours_rule;
        }
        if (updatedEntry.ot_cap_rule !== undefined) {
            otCap = updatedEntry.ot_cap_rule;
        }
        if (updatedEntry.cpl_grant_rule !== undefined) {
            cplGrant = updatedEntry.cpl_grant_rule;
        }
        
        // If not set by override, use template rules
        if (updatedEntry.base_hours_rule === undefined || 
            updatedEntry.ot_cap_rule === undefined || 
            updatedEntry.cpl_grant_rule === undefined) {
            
            if (dayName === 'sunday') {
                const sundayWeek = getSundayWeekNumber(checkInDate);
                isHoliday = true; // ALL Sundays are holidays
                
                if (sundayWeek % 2 === 1) { // Odd Sundays (1st, 3rd, 5th)
                    if (updatedEntry.base_hours_rule === undefined) base = weeklyTemplate.sundayOdd.base;
                    if (updatedEntry.ot_cap_rule === undefined) otCap = weeklyTemplate.sundayOdd.maxOT;
                    if (updatedEntry.cpl_grant_rule === undefined) cplGrant = weeklyTemplate.sundayOdd.cpl;
                } else { // Even Sundays (2nd, 4th)
                    if (updatedEntry.base_hours_rule === undefined) base = weeklyTemplate.sundayEven.base;
                    if (updatedEntry.ot_cap_rule === undefined) otCap = weeklyTemplate.sundayEven.maxOT;
                    if (updatedEntry.cpl_grant_rule === undefined) cplGrant = weeklyTemplate.sundayEven.cpl;
                }
            } else {
                if (updatedEntry.base_hours_rule === undefined) base = weeklyTemplate[dayName]?.base || 8;
                if (updatedEntry.ot_cap_rule === undefined) otCap = weeklyTemplate[dayName]?.maxOT || 1;
                if (updatedEntry.cpl_grant_rule === undefined) cplGrant = weeklyTemplate[dayName]?.cpl || 0;
            }
        }
        
        // Calculate OT
        const ot = Math.max(0, hoursWorked - base);
        const finalOT = Math.min(ot, otCap);
        
        // Update entry with OT
        updatedEntry.base_hours_rule = base;
        updatedEntry.ot_cap_rule = otCap;
        updatedEntry.final_ot_hours = finalOT;
        
        // Handle CPL (only on holidays)
        if (isHoliday || updatedEntry.is_holiday) {
            updatedEntry.cpl_earned = cplGrant;
            updatedEntry.cpl_expiry_date = calculateCPLExpiry(updatedEntry.date);
            updatedEntry.is_holiday = true;
            window.addDebugLog(`CPL earned: ${cplGrant} (expires: ${updatedEntry.cpl_expiry_date})`, 'info');
        } else {
            updatedEntry.cpl_earned = 0;
            updatedEntry.cpl_expiry_date = null;
        }
        
        updatedEntry.sync_status = 'pending';
        
        window.addDebugLog(`Recalculated - Base: ${base}, OT: ${finalOT}`, 'success');
        
        return updatedEntry;
    }

    // ==================== RECALCULATE AND SAVE ENTRY ====================
    async function recalculateAndSaveEntry(entry) {
        if (!entry || !entry.date || !appCurrentUser) return;
        
        const recalculated = await recalculateEntry(entry);
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(recalculated);
            window.addDebugLog(`Saved recalculated entry for ${entry.date}`, 'success');
        }
        
        return recalculated;
    }

    // ==================== GET OR CREATE ENTRY ====================
    async function getOrCreateEntry(date) {
        if (!appCurrentUser || !window.dbAPI) return null;
        
        // Try to get from local DB
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        let entry = entries.find(e => e.date === date);
        
        if (entry) {
            window.addDebugLog(`Found entry for ${date} in local DB`, 'info');
            return entry;
        }
        
        // Try to get from cloud
        window.addDebugLog(`Entry for ${date} not found locally, checking cloud...`, 'info');
        
        try {
            const response = await fetch(`/api/archive?date=${date}`, {
                headers: { 'Authorization': `Bearer ${appAuthToken}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.entry) {
                    const cloudEntry = data.entry;
                    // Fix date format
                    if (cloudEntry.date && cloudEntry.date.includes('T')) {
                        cloudEntry.date = cloudEntry.date.split('T')[0];
                    }
                    cloudEntry.user_id = appCurrentUser.id;
                    cloudEntry.sync_status = 'synced';
                    
                    // Save to local DB
                    await window.dbAPI.saveEntry(cloudEntry);
                    window.addDebugLog(`Imported entry for ${date} from cloud`, 'success');
                    return cloudEntry;
                }
            }
        } catch (error) {
            window.addDebugLog(`Error fetching from cloud: ${error.message}`, 'error');
        }
        
        // Create new entry
        window.addDebugLog(`Creating new entry for ${date}`, 'info');
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
            al_expiry_date: null,
            cpl_expiry_date: null,
            sync_status: 'pending'
        };
        
        return newEntry;
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
                await loadBalances();
                updateLastSyncTime();
                loadTemplateToUI();
                await loadAdjustments();
                await loadExpiryInfo();
                
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

    // ==================== CHANGE PASSWORD ====================
    function showChangePasswordModal() {
        document.getElementById('changePasswordModal').style.display = 'flex';
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('passwordError').textContent = '';
        window.addDebugLog('Change password modal shown', 'info');
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
            
            const data = await response.json();
            
            if (data.success) {
                window.addDebugLog('Password changed successfully', 'success');
                closeChangePasswordModal();
                alert('✅ Password changed successfully');
            } else {
                errorEl.textContent = data.message || 'Password change failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error';
            window.addDebugLog(`Password change error: ${error.message}`, 'error');
        }
    }

    // ==================== DELETE ACCOUNT ====================
    function showDeleteAccountModal() {
        document.getElementById('deleteAccountModal').style.display = 'flex';
        document.getElementById('deleteConfirm').value = '';
        document.getElementById('deleteError').textContent = '';
        window.addDebugLog('Delete account modal shown', 'warning');
    }

    function closeDeleteAccountModal() {
        document.getElementById('deleteAccountModal').style.display = 'none';
    }

    async function deleteAccount() {
        const confirm = document.getElementById('deleteConfirm').value;
        const errorEl = document.getElementById('deleteError');
        
        if (confirm !== 'DELETE') {
            errorEl.textContent = 'Please type DELETE to confirm';
            return;
        }
        
        if (!confirm('⚠️ WARNING: This will permanently delete ALL your data and account. This action cannot be undone!')) {
            return;
        }
        
        try {
            window.addDebugLog('Deleting account...', 'warning');
            
            const response = await fetch('/api/delete-account', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${appAuthToken}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Clear local data
                if (window.dbAPI) {
                    await window.dbAPI.clearAllData();
                    window.dbAPI.closeDatabase();
                }
                
                // Clear localStorage
                localStorage.removeItem('auth_token');
                localStorage.removeItem('auth_user');
                localStorage.removeItem('weeklyTemplate');
                
                appAuthToken = null;
                appCurrentUser = null;
                
                window.addDebugLog('Account deleted successfully', 'success');
                
                document.getElementById('deleteAccountModal').style.display = 'none';
                document.getElementById('appScreen').style.display = 'none';
                document.getElementById('loginScreen').style.display = 'block';
                
                alert('✅ Your account has been permanently deleted');
            } else {
                errorEl.textContent = data.message || 'Account deletion failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error';
            window.addDebugLog(`Account deletion error: ${error.message}`, 'error');
        }
    }

    // ==================== LOGOUT ====================
    function logout() {
        if (confirm('Logout?')) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            appAuthToken = null;
            appCurrentUser = null;
            
            if (window.dbAPI) {
                window.dbAPI.closeDatabase();
            }
            
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
        let entry = await getOrCreateEntry(today);
        
        if (entry && entry.check_in && !entry.check_out) {
            if (!confirm('You are already checked in. Check in again?')) {
                return;
            }
        }
        
        // Get local time
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const localDateTime = getLocalTimeForDB(now);
        
        document.getElementById('checkInDisplay').textContent = timeStr;
        
        // Update entry
        entry.check_in = localDateTime;
        entry.check_out = null;
        
        // Recalculate and save
        const updatedEntry = await recalculateAndSaveEntry(entry);
        
        window.addDebugLog(`Check-in recorded: ${timeStr}`, 'success');
        
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
        let entry = await getOrCreateEntry(today);
        
        if (!entry || !entry.check_in) {
            alert('You must check in first before checking out');
            window.addDebugLog('Check-out failed: no check-in found', 'error');
            return;
        }
        
        if (entry.check_out) {
            if (!confirm('Already checked out. Override?')) {
                return;
            }
        }
        
        // Get local time
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const localDateTime = getLocalTimeForDB(now);
        
        // Validate check out is after check in
        const checkInTime = entry.check_in;
        if (checkInTime && localDateTime <= checkInTime) {
            alert('Check out time must be after check in time');
            window.addDebugLog('Check-out failed: time not after check-in', 'error');
            return;
        }
        
        document.getElementById('checkOutDisplay').textContent = timeStr;
        
        // Update entry
        entry.check_out = localDateTime;
        
        // Recalculate and save
        const updatedEntry = await recalculateAndSaveEntry(entry);
        
        window.addDebugLog(`Check-out recorded: ${timeStr}`, 'success');
        
        // Auto sync after check-out
        setTimeout(() => syncToCloud(), 1000);
    }

    async function markLeave(type) {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        window.addDebugLog(`markLeave() called with type: ${type}`, 'info');
        
        // Get or create entry
        let entry = await getOrCreateEntry(today);
        
        if (entry && (entry.check_in || entry.check_out)) {
            if (!confirm('This day already has check-in/out. Override with leave?')) {
                return;
            }
        }
        
        // Update entry - set the leave type and clear work fields
        entry[`${type}_used`] = (entry[`${type}_used`] || 0) + 1;
        entry.check_in = null;
        entry.check_out = null;
        entry.is_off_day = false;
        entry.is_holiday = false;
        entry.final_ot_hours = 0;
        entry.cpl_earned = 0;
        entry.cpl_expiry_date = null;
        entry.sync_status = 'pending';
        
        window.addDebugLog(`Setting sync_status to pending for leave day`, 'info');
        
        // Save to local DB
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog(`${type} leave saved to local DB with pending sync`, 'success');
        }
        
        // Clear check displays
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
        
        await loadBalances();
        
        // Auto sync to cloud
        setTimeout(() => syncToCloud(), 1000);
    }

    async function markOffDay() {
        if (!appCurrentUser) return;
        
        const today = new Date().toISOString().split('T')[0];
        window.addDebugLog('markOffDay() called', 'info');
        
        // Get or create entry
        let entry = await getOrCreateEntry(today);
        
        // Update entry
        entry.is_off_day = true;
        entry.is_holiday = false;
        entry.check_in = null;
        entry.check_out = null;
        entry.al_used = 0;
        entry.sl_used = 0;
        entry.cl_used = 0;
        entry.cpl_used = 0;
        entry.final_ot_hours = 0;
        entry.cpl_earned = 0;
        entry.cpl_expiry_date = null;
        entry.sync_status = 'pending';
        
        window.addDebugLog(`Setting sync_status to pending for off day`, 'info');
        
        // Save to local DB
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog('Off day saved to local DB with pending sync', 'success');
        }
        
        // Clear check displays
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
        
        // Auto sync to cloud
        setTimeout(() => syncToCloud(), 1000);
    }

    async function loadTodayEntry() {
        if (!window.dbAPI || !appCurrentUser) {
            window.addDebugLog('loadTodayEntry: No user or DB', 'warning');
            return;
        }
        
        try {
            const today = new Date().toISOString().split('T')[0];
            window.addDebugLog(`loadTodayEntry() called for date: ${today}`, 'info');
            
            const entry = await getOrCreateEntry(today);
            
            if (entry) {
                window.addDebugLog('Found today entry:', 'success');
                window.addDebugLog(`Entry data: ${JSON.stringify(entry)}`, 'info');
                
                // Check if this is a leave day (with actual leave used)
                const isLeaveDay = (entry.al_used && entry.al_used > 0) || 
                                   (entry.sl_used && entry.sl_used > 0) || 
                                   (entry.cl_used && entry.cl_used > 0) || 
                                   (entry.cpl_used && entry.cpl_used > 0);
                
                if (isLeaveDay || entry.is_off_day) {
                    document.getElementById('checkInDisplay').textContent = '--:--';
                    document.getElementById('checkOutDisplay').textContent = '--:--';
                    window.addDebugLog('Leave/Off day detected - cleared displays', 'info');
                } else {
                    // Not a leave day, show check-in/out times
                    if (entry.check_in) {
                        // Parse local time string
                        const timePart = entry.check_in.split('T')[1] || '00:00:00';
                        const [hours, minutes] = timePart.split(':');
                        const hour12 = parseInt(hours) % 12 || 12;
                        const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
                        const timeStr = `${hour12}:${minutes}`;
                        
                        document.getElementById('checkInDisplay').textContent = timeStr;
                        appCurrentCheckIn = entry.check_in;
                        window.addDebugLog(`Check-in loaded: ${timeStr} ${ampm}`, 'success');
                    } else {
                        document.getElementById('checkInDisplay').textContent = '--:--';
                        window.addDebugLog('No check-in time found', 'info');
                    }
                    
                    if (entry.check_out) {
                        const timePart = entry.check_out.split('T')[1] || '00:00:00';
                        const [hours, minutes] = timePart.split(':');
                        const hour12 = parseInt(hours) % 12 || 12;
                        const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
                        const timeStr = `${hour12}:${minutes}`;
                        
                        document.getElementById('checkOutDisplay').textContent = timeStr;
                        appCurrentCheckOut = entry.check_out;
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
        
        if (!date) {
            alert('Please select date');
            return;
        }
        
        let entry = await getOrCreateEntry(date);
        
        // Reset fields based on type
        entry.al_used = 0;
        entry.sl_used = 0;
        entry.cl_used = 0;
        entry.cpl_used = 0;
        entry.is_off_day = false;
        entry.is_holiday = false;
        entry.cpl_earned = 0;
        entry.cpl_expiry_date = null;
        entry.sync_status = 'pending';
        
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
                window.addDebugLog('Validation failed: check-out <= check-in', 'error');
                return;
            }
            
        } else if (type === 'holiday') {
            entry.is_holiday = true;
            entry.check_in = null;
            entry.check_out = null;
            
            // Determine CPL based on day of week
            const entryDate = new Date(date);
            const dayName = entryDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            
            if (dayName === 'sunday') {
                const sundayWeek = getSundayWeekNumber(entryDate);
                entry.cpl_earned = (sundayWeek % 2 === 1) ? 1.0 : 0.5;
            } else {
                entry.cpl_earned = 1.0; // Default holiday CPL
            }
            
            entry.cpl_expiry_date = calculateCPLExpiry(date);
            window.addDebugLog(`Manual holiday with CPL: ${entry.cpl_earned} (expires: ${entry.cpl_expiry_date})`, 'info');
            
        } else if (type === 'off') {
            entry.is_off_day = true;
            entry.check_in = null;
            entry.check_out = null;
            window.addDebugLog('Manual off day', 'info');
        } else {
            entry[`${type}_used`] = 1;
            entry.check_in = null;
            entry.check_out = null;
            window.addDebugLog(`Manual ${type} leave`, 'info');
        }
        
        // Recalculate and save
        const updatedEntry = await recalculateAndSaveEntry(entry);
        
        window.addDebugLog(`Manual entry saved for ${date}`, 'success');
        closeManualEntry();
        
        setTimeout(() => syncToCloud(), 1000);
        
        if (date === new Date().toISOString().split('T')[0]) {
            await loadTodayEntry();
        }
        await loadBalances();
        await loadExpiryInfo();
    }

    // ==================== SYNC TO CLOUD ====================
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
            const pendingEntries = await window.dbAPI.getEntriesNeedingSync(100);
            
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
            
            // Process entries ONE BY ONE
            for (let i = 0; i < pendingEntries.length; i++) {
                const entry = pendingEntries[i];
                
                window.addDebugLog(`[${i+1}/${pendingEntries.length}] Syncing entry for ${entry.date}...`, 'info');
                
                syncOutBtn.innerHTML = `<span class="sync-icon">⏳</span> ${i+1}/${pendingEntries.length}`;
                
                const cleanEntry = {
                    date: entry.date,
                    check_in: entry.check_in || null,
                    check_out: entry.check_out || null,
                    base_hours_rule: entry.base_hours_rule !== undefined ? entry.base_hours_rule : 8,
                    ot_cap_rule: entry.ot_cap_rule !== undefined ? entry.ot_cap_rule : 1,
                    cpl_grant_rule: entry.cpl_grant_rule !== undefined ? entry.cpl_grant_rule : 0,
                    final_ot_hours: entry.final_ot_hours !== undefined ? entry.final_ot_hours : 0,
                    cpl_earned: entry.cpl_earned !== undefined ? entry.cpl_earned : 0,
                    al_used: entry.al_used || 0,
                    sl_used: entry.sl_used || 0,
                    cl_used: entry.cl_used || 0,
                    cpl_used: entry.cpl_used || 0,
                    is_off_day: entry.is_off_day || false,
                    is_holiday: entry.is_holiday || false,
                    al_accrued: entry.al_accrued || 0,
                    al_expiry_date: entry.al_expiry_date || null,
                    cpl_expiry_date: entry.cpl_expiry_date || null
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
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
                    }
                    
                    const data = await response.json();
                    
                    if (data.success && data.syncedIds && data.syncedIds.length > 0) {
                        await window.dbAPI.markAsSynced([entry.date]);
                        successCount++;
                        window.addDebugLog(`✅ Synced ${entry.date}`, 'success');
                    } else {
                        throw new Error(data.message || 'Sync failed');
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                } catch (err) {
                    window.addDebugLog(`❌ Failed to sync ${entry.date}: ${err.message}`, 'error');
                    errorCount++;
                    errors.push({ date: entry.date, error: err.message });
                }
            }
            
            updateLastSyncTime();
            
            const message = `✅ Synced ${successCount} entries\n❌ Failed: ${errorCount}`;
            window.addDebugLog(`Sync complete - Success: ${successCount}, Failed: ${errorCount}`, 'info');
            
            if (errors.length > 0) {
                window.addDebugLog(`Errors: ${JSON.stringify(errors)}`, 'error');
            }
            
            alert(message);
            
        } catch (error) {
            window.addDebugLog(`Sync error: ${error.message}`, 'error');
            alert('Sync failed: ' + error.message);
        } finally {
            syncOutBtn.innerHTML = originalText;
            syncOutBtn.disabled = false;
            window.addDebugLog('=== SYNC TO CLOUD ENDED ===', 'info');
        }
    }

    // ==================== SYNC FROM CLOUD ====================
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
                
                let imported = 0;
                for (const entry of data.entries) {
                    // Fix date format
                    if (entry.date && entry.date.includes('T')) {
                        entry.date = entry.date.split('T')[0];
                    }
                    
                    // Convert string numbers (allow 0)
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
                    
                    // Convert boolean fields
                    entry.is_off_day = entry.is_off_day === true || entry.is_off_day === 'true';
                    entry.is_holiday = entry.is_holiday === true || entry.is_holiday === 'true';
                    
                    // Add required fields
                    entry.user_id = appCurrentUser.id;
                    entry.sync_status = 'synced';
                    
                    await window.dbAPI.saveEntry(entry);
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

    // ==================== AL ACCRUAL FUNCTIONS ====================
    async function checkAndAddALAccrual(date) {
        if (!appCurrentUser || !window.dbAPI) return;
        
        const entryDate = new Date(date);
        const year = entryDate.getFullYear();
        const month = entryDate.getMonth();
        const day = entryDate.getDate();
        
        // Check if this is the last day of the month
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        
        if (day === lastDayOfMonth) {
            window.addDebugLog(`📅 ${date} is the last day of month ${month + 1} - adding AL accrual`, 'info');
            
            // Check if AL already added for this month
            const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
            const monthEndEntry = entries.find(e => 
                e.date && 
                new Date(e.date).getFullYear() === year && 
                new Date(e.date).getMonth() === month && 
                e.al_accrued > 0
            );
            
            if (monthEndEntry) {
                window.addDebugLog(`AL already added for ${month + 1}/${year}`, 'info');
                return;
            }
            
            // Calculate expiry date: end of next year (Dec 31 of year+1)
            const expiryDate = calculateALExpiry(date);
            
            // Check if there's already an entry for this date
            let entry = entries.find(e => e.date === date);
            
            if (entry) {
                // Update existing entry
                entry.al_accrued = (entry.al_accrued || 0) + 1.833;
                entry.al_expiry_date = expiryDate;
                entry.sync_status = 'pending';
                
                await window.dbAPI.saveEntry(entry);
                window.addDebugLog(`✅ Added AL accrual to existing entry for ${date} (expires: ${expiryDate})`, 'success');
            } else {
                // Create new accrual entry
                const accrualEntry = {
                    date: date,
                    user_id: appCurrentUser.id,
                    al_accrued: 1.833,
                    al_expiry_date: expiryDate,
                    is_holiday: false,
                    is_off_day: false,
                    sync_status: 'pending'
                };
                
                await window.dbAPI.saveEntry(accrualEntry);
                window.addDebugLog(`✅ Created AL accrual entry for ${date} (expires: ${expiryDate})`, 'success');
            }
            
            return true;
        }
        
        return false;
    }

    // ==================== RECALCULATE ALL MONTH ENDS ====================
    async function recalculateAllMonthEnds() {
        if (!appCurrentUser || !window.dbAPI) return;
        
        window.addDebugLog('🔄 Recalculating all month ends...', 'info');
        
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth();
        
        // Process current year up to current month
        for (let month = 0; month <= currentMonth; month++) {
            const lastDay = new Date(currentYear, month + 1, 0);
            const dateStr = lastDay.toISOString().split('T')[0];
            
            await checkAndAddALAccrual(dateStr);
        }
        
        // Also check previous year's December if we're in January
        if (currentMonth === 0) { // January
            const lastYear = currentYear - 1;
            const decLastDay = new Date(lastYear, 12, 0); // December 31
            const decDateStr = decLastDay.toISOString().split('T')[0];
            
            await checkAndAddALAccrual(decDateStr);
        }
        
        window.addDebugLog('✅ Month-end recalc complete', 'success');
        await loadBalances();
        await loadExpiryInfo();
    }

    // ==================== LOAD EXPIRY INFORMATION ====================
    async function loadExpiryInfo() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const now = new Date();
        
        // AL Expiry
        const alExpiring = [];
        const alEntries = entries.filter(e => e.al_accrued > 0 && e.al_expiry_date);
        
        for (const entry of alEntries) {
            const expiryDate = new Date(entry.al_expiry_date);
            if (expiryDate > now) {
                const daysUntil = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                alExpiring.push({
                    date: entry.date,
                    amount: entry.al_accrued,
                    expiryDate: entry.al_expiry_date,
                    daysUntil: daysUntil
                });
            }
        }
        
        // Sort by expiry date (soonest first)
        alExpiring.sort((a, b) => a.daysUntil - b.daysUntil);
        
        // CPL Expiry
        const cplExpiring = [];
        const cplEntries = entries.filter(e => e.cpl_earned > 0 && e.cpl_expiry_date);
        
        for (const entry of cplEntries) {
            const expiryDate = new Date(entry.cpl_expiry_date);
            if (expiryDate > now) {
                const daysUntil = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                cplExpiring.push({
                    date: entry.date,
                    amount: entry.cpl_earned,
                    expiryDate: entry.cpl_expiry_date,
                    daysUntil: daysUntil
                });
            }
        }
        
        // Sort by expiry date (soonest first)
        cplExpiring.sort((a, b) => a.daysUntil - b.daysUntil);
        
        // Update UI
        updateExpiryUI(alExpiring, cplExpiring);
    }

    function updateExpiryUI(alExpiring, cplExpiring) {
        const alExpiryDiv = document.getElementById('alExpiryInfo');
        const cplExpiryDiv = document.getElementById('cplExpiryInfo');
        
        if (alExpiryDiv) {
            if (alExpiring.length === 0) {
                alExpiryDiv.innerHTML = '<p>No AL expiring soon</p>';
            } else {
                let html = '<h4>AL Expiring</h4>';
                alExpiring.slice(0, 5).forEach(item => {
                    html += `<div class="expiry-item">
                        <span>${item.amount.toFixed(2)} days</span>
                        <span>expires ${item.expiryDate} (${item.daysUntil} days)</span>
                    </div>`;
                });
                alExpiryDiv.innerHTML = html;
            }
        }
        
        if (cplExpiryDiv) {
            if (cplExpiring.length === 0) {
                cplExpiryDiv.innerHTML = '<p>No CPL expiring soon</p>';
            } else {
                let html = '<h4>CPL Expiring</h4>';
                cplExpiring.slice(0, 5).forEach(item => {
                    html += `<div class="expiry-item">
                        <span>${item.amount.toFixed(2)} days</span>
                        <span>expires ${item.expiryDate} (${item.daysUntil} days)</span>
                    </div>`;
                });
                cplExpiryDiv.innerHTML = html;
            }
        }
    }

    // ==================== BALANCE FUNCTIONS WITH EXPIRY ====================
    async function loadBalances() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        window.addDebugLog('loadBalances() called', 'info');
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        window.addDebugLog(`Found ${entries.length} entries for balance calculation`, 'info');
        
        // Get current date
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        
        // Initialize balances
        let alBalance = 0;
        let slBalance = 10.0; // Default annual SL
        let clBalance = 10.0; // Default annual CL
        let cplBalance = 0;
        let otThisMonth = 0;
        let otLastMonth = 0;
        let totalOT = 0;
        let totalCPL = 0;
        let totalLeave = 0;
        
        // Track AL by year for expiry calculation
        const alByYear = {};
        const alUsedByYear = {};
        
        // Track SL/CL by year for reset
        let currentSLBalance = 10.0;
        let currentCLBalance = 10.0;
        let currentYearSL = currentYear;
        let currentYearCL = currentYear;
        
        // Sort entries by date
        const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const entryYear = entryDate.getFullYear();
            
            // ===== AL TRACKING =====
            // Track accrued AL by year
            if (entry.al_accrued && entry.al_accrued > 0) {
                if (!alByYear[entryYear]) {
                    alByYear[entryYear] = 0;
                }
                alByYear[entryYear] += entry.al_accrued;
                window.addDebugLog(`AL accrued for ${entryYear}: +${entry.al_accrued}`, 'info');
            }
            
            // Track AL used by year
            if (entry.al_used && entry.al_used > 0) {
                if (!alUsedByYear[entryYear]) {
                    alUsedByYear[entryYear] = 0;
                }
                alUsedByYear[entryYear] += entry.al_used;
                totalLeave += entry.al_used;
                window.addDebugLog(`AL used in ${entryYear}: -${entry.al_used}`, 'info');
            }
            
            // ===== SL/CL TRACKING =====
            // Reset SL/CL at start of each year
            if (entryYear > currentYearSL) {
                currentSLBalance = 10.0;
                currentYearSL = entryYear;
            }
            if (entryYear > currentYearCL) {
                currentCLBalance = 10.0;
                currentYearCL = entryYear;
            }
            
            if (entry.sl_used) {
                currentSLBalance -= entry.sl_used;
                totalLeave += entry.sl_used;
            }
            if (entry.cl_used) {
                currentCLBalance -= entry.cl_used;
                totalLeave += entry.cl_used;
            }
            
            // ===== CPL TRACKING =====
            // Only count CPL that hasn't expired
            if (entry.cpl_earned && entry.cpl_earned > 0 && entry.cpl_expiry_date) {
                const expiryDate = new Date(entry.cpl_expiry_date);
                if (expiryDate > now) {
                    cplBalance += entry.cpl_earned;
                    totalCPL += entry.cpl_earned;
                    window.addDebugLog(`CPL valid: +${entry.cpl_earned} (expires ${entry.cpl_expiry_date})`, 'info');
                } else {
                    window.addDebugLog(`CPL expired: ${entry.cpl_earned} from ${entry.date}`, 'info');
                }
            }
            
            if (entry.cpl_used) {
                cplBalance -= entry.cpl_used;
                totalLeave += entry.cpl_used;
            }
            
            // ===== OT TRACKING =====
            if (entry.final_ot_hours) {
                totalOT += entry.final_ot_hours;
                
                if (entryDate.getMonth() === currentMonth && entryYear === currentYear) {
                    otThisMonth += entry.final_ot_hours;
                } else if (entryDate.getMonth() === lastMonth && entryYear === lastMonthYear) {
                    otLastMonth += entry.final_ot_hours;
                }
            }
        }
        
        // ===== CALCULATE AL BALANCE WITH EXPIRY =====
        // AL expires after 2 years (end of year+1)
        const expiryCutoffYear = currentYear - 2; // Leaves from years before this have expired
        
        window.addDebugLog(`AL Expiry Cutoff: Years before ${expiryCutoffYear} have expired`, 'info');
        
        // Calculate available AL from each year
        for (let year = expiryCutoffYear; year <= currentYear; year++) {
            const accrued = alByYear[year] || 0;
            const used = alUsedByYear[year] || 0;
            const remaining = accrued - used;
            
            if (remaining > 0) {
                if (year <= expiryCutoffYear) {
                    // This year's leave has EXPIRED
                    window.addDebugLog(`❌ ${year} AL: ${remaining.toFixed(2)} days EXPIRED`, 'info');
                } else {
                    // This year's leave is still valid
                    alBalance += remaining;
                    window.addDebugLog(`✅ ${year} AL: +${remaining.toFixed(2)} days (still valid)`, 'info');
                }
            }
        }
        
        slBalance = currentSLBalance;
        clBalance = currentCLBalance;
        
        // Update UI
        document.getElementById('alBalance').textContent = alBalance.toFixed(2);
        document.getElementById('slBalance').textContent = slBalance.toFixed(2);
        document.getElementById('clBalance').textContent = clBalance.toFixed(2);
        document.getElementById('cplBalance').textContent = cplBalance.toFixed(2);
        document.getElementById('otMonth').textContent = otThisMonth.toFixed(1);
        document.getElementById('otLastMonth').textContent = otLastMonth.toFixed(1);
        
        // Update settings fields
        document.getElementById('setupAL').value = alBalance.toFixed(2);
        document.getElementById('setupSL').value = slBalance.toFixed(2);
        document.getElementById('setupCL').value = clBalance.toFixed(2);
        document.getElementById('setupCPL').value = cplBalance.toFixed(2);
        document.getElementById('setupOT').value = totalOT.toFixed(1);
        
        // Log year-by-year breakdown
        window.addDebugLog('=== AL Breakdown by Year ===', 'info');
        for (let year = expiryCutoffYear; year <= currentYear; year++) {
            const accrued = alByYear[year] || 0;
            const used = alUsedByYear[year] || 0;
            const remaining = accrued - used;
            const status = year <= expiryCutoffYear ? 'EXPIRED' : 'VALID';
            if (accrued > 0 || used > 0) {
                window.addDebugLog(`${year}: Accrued ${accrued.toFixed(2)}, Used ${used.toFixed(2)}, Remaining ${remaining.toFixed(2)} [${status}]`, 'info');
            }
        }
        
        window.addDebugLog(`Final AL balance: ${alBalance.toFixed(2)} days`, 'success');
        window.addDebugLog(`CPL balance: ${cplBalance.toFixed(2)} days`, 'success');
        window.addDebugLog(`OT - This month: ${otThisMonth.toFixed(1)}, Last month: ${otLastMonth.toFixed(1)}`, 'info');
        window.addDebugLog(`Totals - OT: ${totalOT.toFixed(1)}h, CPL: ${totalCPL.toFixed(2)} days, Leave: ${totalLeave.toFixed(2)} days`, 'info');
    }

    async function recalculateAll() {
        if (confirm('Recalculate all balances? This will re-evaluate all entries and add missing AL accruals.')) {
            window.addDebugLog('Recalculate all called', 'info');
            
            // First, recalculate all month ends
            await recalculateAllMonthEnds();
            
            // Then recalculate each entry's OT and CPL
            const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
            for (const entry of entries) {
                await recalculateAndSaveEntry(entry);
            }
            
            await loadBalances();
            await loadExpiryInfo();
            alert('✅ All balances recalculated and AL accruals added');
        }
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
        window.addDebugLog('Balance adjustment modal shown', 'info');
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
        
        window.addDebugLog(`Saving balance adjustment for ${date}`, 'info');
        
        // Get or create entry for this date
        let entry = await getOrCreateEntry(date);
        
        // Apply adjustments
        if (al !== 0) {
            entry.al_accrued = (entry.al_accrued || 0) + al;
            if (entry.al_accrued > 0 && !entry.al_expiry_date) {
                entry.al_expiry_date = calculateALExpiry(date);
            }
        }
        
        // For SL/CL, we'll use adjustment fields (need to add these to schema)
        // For now, we'll use a temporary approach
        if (sl !== 0) {
            // You might want to add sl_adjustment field to schema
            window.addDebugLog(`SL adjustment: ${sl}`, 'info');
        }
        
        if (cl !== 0) {
            window.addDebugLog(`CL adjustment: ${cl}`, 'info`);
        }
        
        if (cpl !== 0) {
            entry.cpl_earned = (entry.cpl_earned || 0) + cpl;
            if (entry.cpl_earned > 0 && !entry.cpl_expiry_date) {
                entry.cpl_expiry_date = calculateCPLExpiry(date);
            }
        }
        
        if (ot !== 0) {
            entry.final_ot_hours = (entry.final_ot_hours || 0) + ot;
        }
        
        entry.adjustment_note = note;
        entry.sync_status = 'pending';
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog('Balance adjustment saved', 'success');
        }
        
        closeBalanceAdjustmentModal();
        alert('✅ Balance adjustment saved');
        
        await loadBalances();
        await loadAdjustments();
        await loadExpiryInfo();
        setTimeout(() => syncToCloud(), 1000);
    }

    async function loadAdjustments() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        const adjustments = entries.filter(e => 
            (e.al_accrued && e.al_accrued > 0) ||
            (e.cpl_earned && e.cpl_earned > 0) ||
            e.adjustment_note
        );
        
        const list = document.getElementById('adjustmentList');
        if (!list) return;
        
        list.innerHTML = '<h4>Recent Adjustments</h4>';
        
        if (adjustments.length === 0) {
            list.innerHTML += '<p class="no-adjustments">No adjustments found</p>';
            return;
        }
        
        adjustments.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        adjustments.slice(0, 10).forEach(adj => {
            const item = document.createElement('div');
            item.className = 'adjustment-item';
            
            let details = [];
            if (adj.al_accrued) details.push(`AL: +${adj.al_accrued}`);
            if (adj.cpl_earned) details.push(`CPL: +${adj.cpl_earned}`);
            if (adj.final_ot_hours) details.push(`OT: +${adj.final_ot_hours}`);
            
            item.innerHTML = `
                <div class="adjustment-date">${adj.date}</div>
                <div class="adjustment-details">${details.join(' | ')}</div>
                ${adj.adjustment_note ? `<div class="adjustment-note">📝 ${adj.adjustment_note}</div>` : ''}
            `;
            
            list.appendChild(item);
        });
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
                cpl: parseFloat(document.getElementById('sunOddCPL').value) || 0,
                isHoliday: true
            },
            sundayEven: { 
                base: parseFloat(document.getElementById('sunEvenBase').value) || 0, 
                maxOT: parseFloat(document.getElementById('sunEvenOT').value) || 0, 
                cpl: parseFloat(document.getElementById('sunEvenCPL').value) || 0,
                isHoliday: true
            }
        };
        
        localStorage.setItem('weeklyTemplate', JSON.stringify(weeklyTemplate));
        alert('Template saved');
        window.addDebugLog('Template saved', 'success');
    }

    // ==================== SINGLE DATE OVERRIDE ====================
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
        const type = document.getElementById('singleType').value;
        const baseInput = document.getElementById('singleBase').value;
        const otInput = document.getElementById('singleOT').value;
        const cplInput = document.getElementById('singleCPL').value;
        
        window.addDebugLog(`saveSingleDateOverride() - date: ${date}, type: ${type}`, 'info');
        
        if (!date) {
            alert('Please select date');
            return;
        }
        
        let entry = await getOrCreateEntry(date);
        
        // Apply type-based rules
        if (type === 'work') {
            entry.is_holiday = false;
            entry.is_off_day = false;
            if (baseInput !== '') entry.base_hours_rule = parseFloat(baseInput);
            if (otInput !== '') entry.ot_cap_rule = parseFloat(otInput);
            if (cplInput !== '') entry.cpl_grant_rule = parseFloat(cplInput);
            window.addDebugLog('Set as work day', 'info');
        } 
        else if (type === 'holiday') {
            entry.is_holiday = true;
            entry.is_off_day = false;
            
            // Set CPL
            if (cplInput !== '') {
                entry.cpl_grant_rule = parseFloat(cplInput);
                entry.cpl_earned = parseFloat(cplInput);
            } else {
                entry.cpl_grant_rule = 1.0;
                entry.cpl_earned = 1.0;
            }
            
            entry.cpl_expiry_date = calculateCPLExpiry(date);
            
            if (baseInput !== '') entry.base_hours_rule = parseFloat(baseInput);
            if (otInput !== '') entry.ot_cap_rule = parseFloat(otInput);
            window.addDebugLog(`Set as holiday with CPL: ${entry.cpl_earned} (expires: ${entry.cpl_expiry_date})`, 'info');
        } 
        else if (type === 'off') {
            entry.is_off_day = true;
            entry.is_holiday = false;
            entry.base_hours_rule = 0;
            entry.ot_cap_rule = 0;
            entry.cpl_grant_rule = 0;
            entry.cpl_earned = 0;
            entry.cpl_expiry_date = null;
            window.addDebugLog('Set as off day', 'info');
        }
        
        // Recalculate and save
        const updatedEntry = await recalculateAndSaveEntry(entry);
        
        window.addDebugLog(`Single date override saved for ${date}`, 'success');
        closeSingleDateOverride();
        alert(`✅ Override saved for ${date}`);
        
        if (date === new Date().toISOString().split('T')[0]) {
            await loadTodayEntry();
        }
        
        await loadBalances();
        await loadExpiryInfo();
        setTimeout(() => syncToCloud(), 1000);
    }

    // ==================== APPLY TEMPLATE TO RANGE ====================
    async function applyTemplateToRange() {
        const from = document.getElementById('rangeFrom').value;
        const to = document.getElementById('rangeTo').value;
        
        if (!from || !to) {
            alert('Select date range');
            return;
        }
        
        window.addDebugLog(`applyTemplateToRange() called from ${from} to ${to}`, 'info');
        
        const applyBtn = document.querySelector('.apply-range-btn');
        const originalText = applyBtn.textContent;
        applyBtn.textContent = '⏳ Applying...';
        applyBtn.disabled = true;
        
        try {
            const start = new Date(from);
            const end = new Date(to);
            
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            window.addDebugLog(`Days in range: ${daysDiff}`, 'info');
            
            if (daysDiff > 30) {
                if (!confirm(`This will apply template to ${daysDiff} days. Continue?`)) {
                    applyBtn.textContent = originalText;
                    applyBtn.disabled = false;
                    return;
                }
            }
            
            let count = 0;
            
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                
                // Get or create entry
                let entry = await getOrCreateEntry(dateStr);
                
                const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                
                // Apply template rules
                if (dayName === 'sunday') {
                    const sundayWeek = getSundayWeekNumber(d);
                    entry.is_holiday = true;
                    
                    if (sundayWeek % 2 === 1) { // Odd Sundays
                        entry.base_hours_rule = weeklyTemplate.sundayOdd.base;
                        entry.ot_cap_rule = weeklyTemplate.sundayOdd.maxOT;
                        entry.cpl_grant_rule = weeklyTemplate.sundayOdd.cpl;
                        entry.cpl_earned = weeklyTemplate.sundayOdd.cpl;
                    } else { // Even Sundays
                        entry.base_hours_rule = weeklyTemplate.sundayEven.base;
                        entry.ot_cap_rule = weeklyTemplate.sundayEven.maxOT;
                        entry.cpl_grant_rule = weeklyTemplate.sundayEven.cpl;
                        entry.cpl_earned = weeklyTemplate.sundayEven.cpl;
                    }
                    
                    if (entry.cpl_earned > 0) {
                        entry.cpl_expiry_date = calculateCPLExpiry(dateStr);
                    }
                } else {
                    entry.base_hours_rule = weeklyTemplate[dayName]?.base || 8;
                    entry.ot_cap_rule = weeklyTemplate[dayName]?.maxOT || 1;
                    entry.cpl_grant_rule = weeklyTemplate[dayName]?.cpl || 0;
                    entry.is_holiday = false;
                    entry.cpl_earned = 0;
                    entry.cpl_expiry_date = null;
                }
                
                // Recalculate and save
                await recalculateAndSaveEntry(entry);
                
                count++;
                
                // Update progress
                applyBtn.textContent = `⏳ ${count}/${daysDiff}`;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            window.addDebugLog(`Applied template to ${count} days`, 'success');
            alert(`✅ Template applied to ${count} days`);
            
            await loadBalances();
            await loadExpiryInfo();
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
        
        window.addDebugLog(`Applying date range: ${from} to ${to}`, 'info');
        await loadHistory();
    }

    async function loadHistory() {
        if (!window.dbAPI || !appCurrentUser) return;
        
        window.addDebugLog('loadHistory() called', 'info');
        
        let entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        
        // Remove duplicates
        const uniqueEntries = {};
        entries.forEach(entry => {
            if (!uniqueEntries[entry.date] || new Date(entry.updated_at) > new Date(uniqueEntries[entry.date].updated_at)) {
                uniqueEntries[entry.date] = entry;
            }
        });
        
        entries = Object.values(uniqueEntries);
        
        // Apply date range
        if (currentHistoryFrom && currentHistoryTo) {
            entries = entries.filter(e => e.date >= currentHistoryFrom && e.date <= currentHistoryTo);
        }
        
        // Apply filter
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
        
        // Calculate totals
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
        
        // Add totals display
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
            } else if (e.is_holiday) {
                desc = 'HOLIDAY';
                if (e.cpl_earned > 0) details.push(`CPL: ${e.cpl_earned}`);
                if (e.cpl_expiry_date) details.push(`Expires: ${e.cpl_expiry_date}`);
            } else if (e.al_used > 0) {
                desc = `ANNUAL LEAVE (${e.al_used} day)`;
            } else if (e.sl_used > 0) {
                desc = `SICK LEAVE (${e.sl_used} day)`;
            } else if (e.cl_used > 0) {
                desc = `CASUAL LEAVE (${e.cl_used} day)`;
            } else if (e.cpl_used > 0) {
                desc = `CPL USED (${e.cpl_used} day)`;
            } else if (e.check_in && e.check_out) {
                const inTime = new Date(e.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const outTime = new Date(e.check_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                desc = `${inTime} - ${outTime}`;
                if (e.base_hours_rule !== undefined) details.push(`${e.base_hours_rule}h Base`);
                if (e.final_ot_hours > 0) details.push(`OT: ${e.final_ot_hours}h`);
                if (e.cpl_earned > 0) details.push(`CPL: ${e.cpl_earned}`);
            } else if (e.check_in) {
                const inTime = new Date(e.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                desc = `${inTime} - (open)`;
            }
            
            if (e.al_accrued > 0) {
                details.push(`AL Accrued: +${e.al_accrued}`);
                if (e.al_expiry_date) details.push(`AL Expires: ${e.al_expiry_date}`);
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
        
        window.addDebugLog(`Displayed ${entries.length} history entries`, 'success');
    }

    // ==================== INITIAL BALANCE SETUP ====================
    function showInitialBalanceModal() {
        document.getElementById('initialBalanceModal').style.display = 'flex';
        // Set default date to Jan 1 of current year
        const today = new Date();
        const janFirst = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
        document.getElementById('initialDate').value = janFirst;
        
        // Load current values from UI
        document.getElementById('initialAL').value = document.getElementById('alBalance').textContent;
        document.getElementById('initialSL').value = document.getElementById('slBalance').textContent;
        document.getElementById('initialCL').value = document.getElementById('clBalance').textContent;
        document.getElementById('initialCPL').value = document.getElementById('cplBalance').textContent;
        document.getElementById('initialOT').value = document.getElementById('otMonth').textContent;
        
        window.addDebugLog('Initial balance modal shown', 'info');
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
        
        window.addDebugLog(`Setting initial balances from ${date}`, 'info');
        
        // Create adjustment entry
        let entry = await getOrCreateEntry(date);
        
        entry.al_accrued = al;
        if (al > 0) {
            entry.al_expiry_date = calculateALExpiry(date);
        }
        
        entry.cpl_earned = cpl;
        if (cpl > 0) {
            entry.cpl_expiry_date = calculateCPLExpiry(date);
        }
        
        entry.final_ot_hours = ot;
        entry.adjustment_note = 'Initial balance setup';
        entry.sync_status = 'pending';
        
        if (window.dbAPI) {
            await window.dbAPI.saveEntry(entry);
            window.addDebugLog('Initial balance entry saved', 'success');
        }
        
        closeInitialBalanceModal();
        alert('✅ Initial balances set successfully');
        
        await loadBalances();
        await loadAdjustments();
        await loadExpiryInfo();
        setTimeout(() => syncToCloud(), 1000);
    }

    // ==================== RESET ALL DATA ====================
    async function resetAllData() {
        if (!confirm('⚠️ WARNING: This will DELETE ALL your local data. Cloud data will remain. Are you sure?')) {
            return;
        }
        
        window.addDebugLog('Resetting local data...', 'warning');
        
        // Clear all entries from local DB
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        for (const entry of entries) {
            await window.dbAPI.deleteEntry(entry.date);
        }
        
        // Clear localStorage
        localStorage.removeItem('weeklyTemplate');
        
        // Reinitialize with default template
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
        
        // Clear displays
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
        
        await loadBalances();
        loadTemplateToUI();
        await loadAdjustments();
        await loadExpiryInfo();
        
        alert('✅ Local data has been reset');
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
            document.getElementById('historyFrom').value = '';
            document.getElementById('historyTo').value = '';
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelector('.filter-btn').classList.add('active');
            loadHistory();
        }
        if (tabName === 'balance') {
            loadBalances();
            loadExpiryInfo();
        }
        if (tabName === 'schedule') loadTemplateToUI();
        if (tabName === 'settings') {
            document.getElementById('settingsUserEmail').textContent = appCurrentUser?.email || '';
            document.getElementById('settingsUserID').textContent = appCurrentUser?.id || '';
            loadAdjustments();
            loadExpiryInfo();
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
    window.showManualEntry = showManualEntry;
    window.closeManualEntry = closeManualEntry;
    window.saveManualEntry = saveManualEntry;
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

    window.addDebugLog('app.js: Loading complete', 'success');
})();