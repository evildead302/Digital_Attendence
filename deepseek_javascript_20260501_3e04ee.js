// ==================== APP-CORE.JS - CORE FUNCTIONS (MUST LOAD FIRST) ====================
// This file contains: globals, debug, auth, DB init, fetchOrCreateEntry, saveAndSync, strictOverrider, user settings

(function() {
    if (typeof window.addDebugLog !== 'function') {
        window.addDebugLog = function(msg, type) {
            console.log(`[${type}] ${msg}`);
        };
    }
    
    window.addDebugLog('app-core.js: Loading started...', 'info');

    // ==================== GLOBAL VARIABLES ====================
    let appCurrentUser = null;
    let appAuthToken = null;
    let appCurrentCheckIn = null;
    let appCurrentCheckOut = null;

    // OTP Variables
    let otpTimerInterval = null;
    let currentOTPData = null;
    let verificationPurpose = null;
    let pendingEmail = null;
    
    // Alarm Variables
    let currentAlarmSettings = {
        enabled: false,
        checkinTime: '09:00',
        checkoutTime: '18:00',
        tzOffset: null
    };
    
    let notificationInterval = null;
    
    // User Settings
    let userSettings = {
        has_ot: true,
        has_cpl: true,
        limit_annual: 22,
        limit_casual: 10,
        limit_sick: 10
    };

    // Template data
    let weeklyTemplate = {
        monday: { base: 8, maxOT: 1, cpl: 0 },
        tuesday: { base: 8, maxOT: 1, cpl: 0 },
        wednesday: { base: 8, maxOT: 1, cpl: 0 },
        thursday: { base: 8, maxOT: 1, cpl: 0 },
        friday: { base: 8.5, maxOT: 1, cpl: 0 },
        saturday: { base: 8, maxOT: 1, cpl: 1 },
        sundayOdd: { base: 8, maxOT: 0, cpl: 1.0, isHoliday: true },
        sundayEven: { base: 6, maxOT: 0, cpl: 0.5, isHoliday: true }
    };

    // ==================== EXPORT CORE FUNCTIONS ====================
    window.__core = {
        getCurrentUser: () => appCurrentUser,
        getAuthToken: () => appAuthToken,
        setCurrentUser: (user) => { appCurrentUser = user; },
        setAuthToken: (token) => { appAuthToken = token; },
        getUserSettings: () => userSettings,
        setUserSettings: (settings) => { userSettings = settings; },
        getWeeklyTemplate: () => weeklyTemplate,
        setWeeklyTemplate: (template) => { weeklyTemplate = template; },
        getCurrentAlarmSettings: () => currentAlarmSettings,
        setCurrentAlarmSettings: (settings) => { currentAlarmSettings = settings; },
        getOtpTimerInterval: () => otpTimerInterval,
        setOtpTimerInterval: (interval) => { otpTimerInterval = interval; },
        getCurrentOTPData: () => currentOTPData,
        setCurrentOTPData: (data) => { currentOTPData = data; },
        getVerificationPurpose: () => verificationPurpose,
        setVerificationPurpose: (purpose) => { verificationPurpose = purpose; },
        getPendingEmail: () => pendingEmail,
        setPendingEmail: (email) => { pendingEmail = email; },
        getNotificationInterval: () => notificationInterval,
        setNotificationInterval: (interval) => { notificationInterval = interval; }
    };

    // ==================== HELPER FUNCTIONS ====================
    function getLocalTimeForDB(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    function calculateCPLExpiry(earnedDate) {
        const date = new Date(earnedDate);
        date.setDate(date.getDate() + 180);
        return date.toISOString().split('T')[0];
    }

    function calculateALExpiry(earnedDate) {
        const date = new Date(earnedDate);
        const year = date.getFullYear();
        const expiryDate = new Date(year + 1, 11, 31);
        return expiryDate.toISOString().split('T')[0];
    }

    function getSundayWeekNumber(date) {
        return Math.ceil(date.getDate() / 7);
    }

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

    // ==================== STRICT OVERRIDER ====================
    function applyUserPermissionOverrides(entry) {
        if (!entry) return entry;
        const result = { ...entry };
        if (!userSettings.has_ot) {
            result.final_ot_hours = null;
            result.ot_cap_rule = 0;
            result.ot_adjustment = 0;
        }
        if (!userSettings.has_cpl) {
            result.cpl_earned = null;
            result.cpl_grant_rule = 0;
            result.cpl_adjustment = 0;
            result.cpl_used = 0;
            result.cpl_expiry_date = null;
        }
        return result;
    }

    async function strictOverrider(entry, isActiveEdit = false) {
        if (!entry || !entry.date) return entry;
        
        entry = applyUserPermissionOverrides(entry);
        
        if (entry.is_manual_adjustment === true) {
            const cplAdjustment = parseFloat(entry.cpl_adjustment) || 0;
            if (cplAdjustment > 0 && !entry.cpl_expiry_date && userSettings.has_cpl) {
                entry.cpl_expiry_date = calculateCPLExpiry(entry.date);
            }
            const alAdjustment = parseFloat(entry.al_adjustment) || 0;
            if (alAdjustment > 0 && !entry.al_expiry_date) {
                entry.al_expiry_date = calculateALExpiry(entry.date);
            }
            return entry;
        }
        
        const updatedEntry = { ...entry };
        const entryDate = new Date(updatedEntry.date + 'T12:00:00');
        const dayName = entryDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const sundayWeek = dayName === 'sunday' ? getSundayWeekNumber(entryDate) : null;
        
        if (updatedEntry.base_hours_rule === undefined || updatedEntry.base_hours_rule === null) {
            if (dayName === 'sunday') {
                if (sundayWeek % 2 === 1) {
                    updatedEntry.base_hours_rule = weeklyTemplate.sundayOdd.base;
                    updatedEntry.ot_cap_rule = weeklyTemplate.sundayOdd.maxOT;
                    updatedEntry.cpl_grant_rule = weeklyTemplate.sundayOdd.cpl;
                } else {
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
        
        updatedEntry.base_hours_rule = updatedEntry.base_hours_rule !== null ? Number(updatedEntry.base_hours_rule) : 8;
        updatedEntry.ot_cap_rule = updatedEntry.ot_cap_rule !== null ? Number(updatedEntry.ot_cap_rule) : 1;
        updatedEntry.cpl_grant_rule = updatedEntry.cpl_grant_rule !== null ? Number(updatedEntry.cpl_grant_rule) : 0;
        
        updatedEntry.is_holiday = determineIsHoliday(updatedEntry, dayName);
        
        const isLeaveDay = (updatedEntry.al_used && updatedEntry.al_used > 0) || 
                           (updatedEntry.sl_used && updatedEntry.sl_used > 0) || 
                           (updatedEntry.cl_used && updatedEntry.cl_used > 0) || 
                           (updatedEntry.cpl_used && updatedEntry.cpl_used > 0);
        
        if (updatedEntry.is_off_day || isLeaveDay) {
            updatedEntry.final_ot_hours = null;
            updatedEntry.cpl_earned = null;
            updatedEntry.cpl_expiry_date = null;
            updatedEntry.sync_status = 'pending';
            return updatedEntry;
        }
        
        let hoursWorked = 0;
        if (updatedEntry.check_in && updatedEntry.check_out) {
            let checkInStr = updatedEntry.check_in;
            let checkOutStr = updatedEntry.check_out;
            if (checkInStr.includes('T')) checkInStr = checkInStr.replace('T', ' ');
            if (checkOutStr.includes('T')) checkOutStr = checkOutStr.replace('T', ' ');
            
            const [inDatePart, inTimePart] = checkInStr.split(' ');
            const [outDatePart, outTimePart] = checkOutStr.split(' ');
            const [inHours, inMinutes, inSeconds] = inTimePart.split(':').map(Number);
            const [outHours, outMinutes, outSeconds] = outTimePart.split(':').map(Number);
            
            const checkInDate = new Date();
            checkInDate.setHours(inHours, inMinutes, inSeconds || 0);
            const checkOutDate = new Date();
            checkOutDate.setHours(outHours, outMinutes, outSeconds || 0);
            hoursWorked = (checkOutDate - checkInDate) / (1000 * 60 * 60);
            if (hoursWorked < 0) hoursWorked = 0;
        }
        
        const rawOT = hoursWorked - updatedEntry.base_hours_rule;
        const cappedOT = Math.min(Math.max(rawOT, 0), updatedEntry.ot_cap_rule || 0);
        const floorOT = Math.floor(cappedOT);
        
        if (floorOT > 0 && userSettings.has_ot) {
            updatedEntry.final_ot_hours = floorOT;
        } else {
            updatedEntry.final_ot_hours = null;
        }
        
        if (userSettings.has_cpl && updatedEntry.cpl_grant_rule > 0 && hoursWorked >= updatedEntry.base_hours_rule) {
            updatedEntry.cpl_earned = updatedEntry.cpl_grant_rule;
            updatedEntry.cpl_expiry_date = calculateCPLExpiry(updatedEntry.date);
        } else {
            updatedEntry.cpl_earned = null;
            updatedEntry.cpl_expiry_date = null;
        }
        
        const cplAdjustment = parseFloat(updatedEntry.cpl_adjustment) || 0;
        if (userSettings.has_cpl && cplAdjustment > 0 && !updatedEntry.cpl_expiry_date) {
            updatedEntry.cpl_expiry_date = calculateCPLExpiry(updatedEntry.date);
        }
        
        const alAdjustment = parseFloat(updatedEntry.al_adjustment) || 0;
        if (alAdjustment > 0 && !updatedEntry.al_expiry_date) {
            updatedEntry.al_expiry_date = calculateALExpiry(updatedEntry.date);
        }
        
        const lastDayOfMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
        const isMonthEnd = (entryDate.getDate() === lastDayOfMonth);
        
        if (isActiveEdit && isMonthEnd) {
            const monthlyAccrual = userSettings.limit_annual / 12;
            updatedEntry.al_accrued = parseFloat(monthlyAccrual.toFixed(3));
            updatedEntry.al_expiry_date = calculateALExpiry(updatedEntry.date);
        } else if (isActiveEdit && !isMonthEnd) {
            if (updatedEntry.al_accrued && updatedEntry.al_accrued > 0) {
                updatedEntry.al_accrued = 0;
                updatedEntry.al_expiry_date = null;
            }
        }
        
        updatedEntry.sync_status = 'pending';
        return updatedEntry;
    }

    function determineIsHoliday(entry, dayName) {
        if (dayName === 'sunday') return true;
        if (entry.cpl_grant_rule && entry.cpl_grant_rule > 0) return true;
        return false;
    }

    // ==================== DATABASE OPERATIONS ====================
    async function fetchOrCreateEntry(date) {
        if (!appCurrentUser || !window.dbAPI) return null;
        
        const entries = await window.dbAPI.getAllEntriesForUser(appCurrentUser.id);
        let entry = entries.find(e => e.date === date);
        
        if (entry) return entry;
        
        if (!navigator.onLine) {
            return new Promise((resolve) => {
                const onlineHandler = async () => {
                    window.removeEventListener('online', onlineHandler);
                    const cloudEntry = await fetchFromCloud(date);
                    resolve(cloudEntry);
                };
                window.addEventListener('online', onlineHandler);
            });
        }
        
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
                    if (cloudEntry.date && cloudEntry.date.includes('T')) cloudEntry.date = cloudEntry.date.split('T')[0];
                    
                    if (cloudEntry.check_in && cloudEntry.check_in.includes('T')) {
                        const utcDate = new Date(cloudEntry.check_in);
                        cloudEntry.check_in = `${utcDate.getFullYear()}-${String(utcDate.getMonth()+1).padStart(2,'0')}-${String(utcDate.getDate()).padStart(2,'0')} ${String(utcDate.getHours()).padStart(2,'0')}:${String(utcDate.getMinutes()).padStart(2,'0')}:${String(utcDate.getSeconds()).padStart(2,'0')}`;
                    }
                    if (cloudEntry.check_out && cloudEntry.check_out.includes('T')) {
                        const utcDate = new Date(cloudEntry.check_out);
                        cloudEntry.check_out = `${utcDate.getFullYear()}-${String(utcDate.getMonth()+1).padStart(2,'0')}-${String(utcDate.getDate()).padStart(2,'0')} ${String(utcDate.getHours()).padStart(2,'0')}:${String(utcDate.getMinutes()).padStart(2,'0')}:${String(utcDate.getSeconds()).padStart(2,'0')}`;
                    }
                    
                    cloudEntry.user_id = appCurrentUser.id;
                    cloudEntry.sync_status = 'synced';
                    cloudEntry.al_adjustment = cloudEntry.al_adjustment !== undefined ? parseFloat(cloudEntry.al_adjustment) : 0;
                    cloudEntry.sl_adjustment = cloudEntry.sl_adjustment !== undefined ? parseFloat(cloudEntry.sl_adjustment) : 0;
                    cloudEntry.cl_adjustment = cloudEntry.cl_adjustment !== undefined ? parseFloat(cloudEntry.cl_adjustment) : 0;
                    cloudEntry.cpl_adjustment = cloudEntry.cpl_adjustment !== undefined ? parseFloat(cloudEntry.cpl_adjustment) : 0;
                    cloudEntry.ot_adjustment = cloudEntry.ot_adjustment !== undefined ? parseFloat(cloudEntry.ot_adjustment) : 0;
                    
                    const overriddenEntry = await strictOverrider(cloudEntry, false);
                    await window.dbAPI.saveEntry(overriddenEntry);
                    return overriddenEntry;
                }
            }
        } catch (error) {}
        
        const newEntry = {
            date: date, user_id: appCurrentUser.id, check_in: null, check_out: null,
            base_hours_rule: null, ot_cap_rule: null, cpl_grant_rule: null,
            final_ot_hours: null, cpl_earned: null, al_used: 0, sl_used: 0, cl_used: 0, cpl_used: 0,
            is_off_day: false, is_holiday: false, is_manual_adjustment: false,
            al_accrued: 0, al_adjustment: 0, sl_adjustment: 0, cl_adjustment: 0,
            al_expiry_date: null, cpl_adjustment: 0, cpl_expiry_date: null,
            ot_adjustment: 0, adjustment_note: '', sync_status: 'pending'
        };
        
        return await strictOverrider(newEntry, true);
    }

    async function saveAndSync(entry, skipSync = false, isActiveEdit = true) {
        if (!entry || !entry.date || !appCurrentUser) return;
        
        const overriddenEntry = await strictOverrider(entry, isActiveEdit);
        
        if (window.dbAPI) await window.dbAPI.saveEntry(overriddenEntry);
        
        const today = new Date().toISOString().split('T')[0];
        if (entry.date === today && overriddenEntry.check_in && !overriddenEntry.check_out) {
            if (typeof window.recalculateCheckoutAlarm === 'function') {
                await window.recalculateCheckoutAlarm(today);
            }
        }
        
        if (!skipSync && navigator.onLine && typeof window.syncToCloud === 'function') {
            setTimeout(() => window.syncToCloud(), 500);
        }
        
        if (typeof window.updateTargetTimeDisplay === 'function') await window.updateTargetTimeDisplay();
        
        return overriddenEntry;
    }

    // ==================== USER SETTINGS ====================
    async function loadUserSettings() {
        if (!appCurrentUser) return;
        
        if (appCurrentUser.has_ot !== undefined) {
            userSettings.has_ot = appCurrentUser.has_ot;
            userSettings.has_cpl = appCurrentUser.has_cpl;
            userSettings.limit_annual = appCurrentUser.limit_annual || 22;
            userSettings.limit_casual = appCurrentUser.limit_casual || 10;
            userSettings.limit_sick = appCurrentUser.limit_sick || 10;
        }
        
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
                        appCurrentUser.has_ot = userSettings.has_ot;
                        appCurrentUser.has_cpl = userSettings.has_cpl;
                        appCurrentUser.limit_annual = userSettings.limit_annual;
                        appCurrentUser.limit_casual = userSettings.limit_casual;
                        appCurrentUser.limit_sick = userSettings.limit_sick;
                        localStorage.setItem('auth_user', JSON.stringify(appCurrentUser));
                    }
                }
            } catch (error) {}
        }
        
        if (typeof window.applyUserPermissions === 'function') window.applyUserPermissions();
        if (typeof window.updateSettingsUI === 'function') window.updateSettingsUI();
    }

    // ==================== SERVICE WORKER ====================
    async function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return false;
        try {
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            await navigator.serviceWorker.ready;
            return true;
        } catch (error) {
            return false;
        }
    }

    async function storeAuthInServiceWorker() {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'STORE_AUTH',
                token: appAuthToken,
                userId: appCurrentUser.id
            });
        }
    }

    async function clearAuthFromServiceWorker() {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_AUTH' });
        }
    }

    function setupNetworkListeners() {
        window.addEventListener('online', function() {
            if (typeof window.syncToCloud === 'function') window.syncToCloud();
            if (typeof window.checkNotificationsManually === 'function') window.checkNotificationsManually();
        });
        window.addEventListener('offline', function() {});
    }

    // ==================== AUTHENTICATION ====================
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
                
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                }
                
                await loadUserSettings();
                
                if (typeof window.loadAlarmSettings === 'function') await window.loadAlarmSettings();
                if (typeof window.resetDailyAlarms === 'function') await window.resetDailyAlarms();
                if (typeof window.startNotificationScheduler === 'function') window.startNotificationScheduler();
                
                await storeAuthInServiceWorker();
                if (typeof window.syncPushSubscription === 'function') await window.syncPushSubscription(0);
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                if (typeof window.loadTodayEntry === 'function') await window.loadTodayEntry();
                if (typeof window.loadBalances === 'function') await window.loadBalances();
                if (typeof window.updateLastSyncTime === 'function') window.updateLastSyncTime();
                if (typeof window.loadTemplateToUI === 'function') window.loadTemplateToUI();
                if (typeof window.loadAdjustments === 'function') await window.loadAdjustments();
                if (typeof window.loadExpiryInfo === 'function') await window.loadExpiryInfo();
                
                if (typeof window.syncFromCloud === 'function') setTimeout(() => window.syncFromCloud(), 2000);
                if (typeof window.checkNotificationsManually === 'function') setTimeout(() => window.checkNotificationsManually(), 5000);
                
            } catch (error) {
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
            const response = await fetch('/api/auth?action=login', {
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
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appScreen').style.display = 'block';
                
                if (window.dbAPI) {
                    window.dbAPI.setCurrentUserId(appCurrentUser.id);
                    await window.dbAPI.initDatabaseForUser(appCurrentUser.id);
                }
                
                await loadUserSettings();
                if (typeof window.loadTodayEntry === 'function') await window.loadTodayEntry();
                if (typeof window.loadBalances === 'function') await window.loadBalances();
                if (typeof window.loadTemplateToUI === 'function') window.loadTemplateToUI();
                if (typeof window.updateLastSyncTime === 'function') window.updateLastSyncTime();
                
                if (typeof window.syncFromCloud === 'function') setTimeout(() => window.syncFromCloud(), 2000);
                if (typeof window.checkNotificationsManually === 'function') setTimeout(() => window.checkNotificationsManually(), 5000);
                
                errorEl.textContent = '';
            } else {
                if (data.requiresVerification && data.otpCode && typeof window.showOTPModal === 'function') {
                    if (confirm('Your email is not verified. Would you like to verify now?')) {
                        window.showOTPModal({
                            appEmail: data.appEmail,
                            otpCode: data.otpCode,
                            expiry: data.expiry
                        }, 'register', data.email);
                    }
                } else if (response.status === 404) {
                    errorEl.textContent = 'Account not found. Please register first.';
                } else {
                    errorEl.textContent = data.message || 'Login failed';
                }
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
            errorEl.textContent = 'Password too short (min 6 characters)';
            return;
        }
        
        try {
            const response = await fetch('/api/auth?action=register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name })
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (data.requiresVerification && data.otpCode && typeof window.showOTPModal === 'function') {
                    window.showOTPModal({
                        appEmail: data.appEmail,
                        otpCode: data.otpCode,
                        expiry: data.expiry
                    }, 'register', email);
                } else {
                    alert('Registration successful! Please check your email for verification instructions.');
                    showLogin();
                }
            } else {
                errorEl.textContent = data.message || 'Registration failed';
            }
        } catch (error) {
            errorEl.textContent = 'Connection error: ' + error.message;
        }
    }

    function logout() {
        if (confirm('Logout?')) {
            if (typeof window.stopNotificationScheduler === 'function') window.stopNotificationScheduler();
            if (window.dbAPI) window.dbAPI.closeDatabase();
            clearAuthFromServiceWorker();
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            localStorage.removeItem('weeklyTemplate');
            localStorage.removeItem('lastAlarmReset');
            localStorage.removeItem('push_subscription_status');
            appAuthToken = null;
            appCurrentUser = null;
            document.getElementById('appScreen').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'block';
        }
    }

    // ==================== INITIALIZATION ====================
    document.addEventListener('DOMContentLoaded', function() {
        updateDateTime();
        setInterval(updateDateTime, 1000);
        
        const savedTemplate = localStorage.getItem('weeklyTemplate');
        if (savedTemplate) {
            try {
                weeklyTemplate = JSON.parse(savedTemplate);
                window.__core.setWeeklyTemplate(weeklyTemplate);
            } catch (e) {}
        }
        
        registerServiceWorker();
        checkAuth();
        setupNetworkListeners();
    });

    // ==================== EXPOSE GLOBALLY ====================
    window.appCore = window.__core;
    window.getLocalTimeForDB = getLocalTimeForDB;
    window.calculateCPLExpiry = calculateCPLExpiry;
    window.calculateALExpiry = calculateALExpiry;
    window.getSundayWeekNumber = getSundayWeekNumber;
    window.updateDateTime = updateDateTime;
    window.strictOverrider = strictOverrider;
    window.fetchOrCreateEntry = fetchOrCreateEntry;
    window.fetchFromCloud = fetchFromCloud;
    window.saveAndSync = saveAndSync;
    window.loadUserSettings = loadUserSettings;
    window.registerServiceWorker = registerServiceWorker;
    window.storeAuthInServiceWorker = storeAuthInServiceWorker;
    window.clearAuthFromServiceWorker = clearAuthFromServiceWorker;
    window.login = login;
    window.register = register;
    window.logout = logout;
    window.showRegister = showRegister;
    window.showLogin = showLogin;
    window.checkAuth = checkAuth;
    
    window.addDebugLog('app-core.js: Loading complete', 'success');
})();