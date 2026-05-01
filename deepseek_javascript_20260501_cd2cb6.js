// ==================== APP-EXTENDED.JS - EXTENDED FUNCTIONALITY (LOAD AFTER CORE) ====================
// This file contains: FIFO matchmaker, balance calculations, history, schedule, manual entry,
// check-in/out, leave, OTP flows, push notifications, alarms, adjustments, and all UI functions

(function() {
    window.addDebugLog('app-extended.js: Loading started...', 'info');

    // ==================== HELPER ACCESSORS ====================
    function getCurrentUser() { return window.appCore?.getCurrentUser() || null; }
    function getAuthToken() { return window.appCore?.getAuthToken() || null; }
    function setCurrentUser(user) { if (window.appCore) window.appCore.setCurrentUser(user); }
    function setAuthToken(token) { if (window.appCore) window.appCore.setAuthToken(token); }
    function getUserSettings() { return window.appCore?.getUserSettings() || { has_ot: true, has_cpl: true, limit_annual: 22, limit_casual: 10, limit_sick: 10 }; }
    function setUserSettings(settings) { if (window.appCore) window.appCore.setUserSettings(settings); }
    function getWeeklyTemplate() { return window.appCore?.getWeeklyTemplate() || {}; }
    function setWeeklyTemplate(template) { if (window.appCore) window.appCore.setWeeklyTemplate(template); }
    function getCurrentAlarmSettings() { return window.appCore?.getCurrentAlarmSettings() || { enabled: false, checkinTime: '09:00', checkoutTime: '18:00', tzOffset: null }; }
    function setCurrentAlarmSettings(settings) { if (window.appCore) window.appCore.setCurrentAlarmSettings(settings); }
    function getOtpTimerInterval() { return window.appCore?.getOtpTimerInterval(); }
    function setOtpTimerInterval(interval) { if (window.appCore) window.appCore.setOtpTimerInterval(interval); }
    function getCurrentOTPData() { return window.appCore?.getCurrentOTPData(); }
    function setCurrentOTPData(data) { if (window.appCore) window.appCore.setCurrentOTPData(data); }
    function getVerificationPurpose() { return window.appCore?.getVerificationPurpose(); }
    function setVerificationPurpose(purpose) { if (window.appCore) window.appCore.setVerificationPurpose(purpose); }
    function getPendingEmail() { return window.appCore?.getPendingEmail(); }
    function setPendingEmail(email) { if (window.appCore) window.appCore.setPendingEmail(email); }
    function getNotificationInterval() { return window.appCore?.getNotificationInterval(); }
    function setNotificationInterval(interval) { if (window.appCore) window.appCore.setNotificationInterval(interval); }

    let userSettings = getUserSettings();
    let weeklyTemplate = getWeeklyTemplate();
    let currentAlarmSettings = getCurrentAlarmSettings();

    function refreshSettings() {
        userSettings = getUserSettings();
        weeklyTemplate = getWeeklyTemplate();
        currentAlarmSettings = getCurrentAlarmSettings();
    }

    // ==================== UPDATE LAST SYNC TIME ====================
    window.updateLastSyncTime = function() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        const timeStr = `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        const lastSyncEl = document.getElementById('lastSyncTime');
        if (lastSyncEl) lastSyncEl.textContent = `Last sync: ${timeStr}`;
    };

    // ==================== APPLY USER PERMISSIONS TO UI ====================
    window.applyUserPermissions = function() {
        refreshSettings();
        
        const otCards = document.querySelectorAll('.ot-card');
        const otValues = document.querySelectorAll('#otMonth, #otLastMonth');
        const otCols = document.querySelectorAll('.ot-col');
        
        if (!userSettings.has_ot) {
            otCards.forEach(card => { if (card) card.style.display = 'none'; });
            otValues.forEach(val => { if (val && val.parentElement) val.parentElement.style.display = 'none'; });
            otCols.forEach(col => { if (col) col.style.display = 'none'; });
        } else {
            otCards.forEach(card => { if (card) card.style.display = ''; });
            otValues.forEach(val => { if (val && val.parentElement) val.parentElement.style.display = ''; });
            otCols.forEach(col => { if (col) col.style.display = ''; });
        }
        
        const cplButtons = document.querySelectorAll('.leave-btn.cpl');
        const cplBalance = document.getElementById('cplBalance');
        const cplCols = document.querySelectorAll('.cpl-col');
        
        if (!userSettings.has_cpl) {
            cplButtons.forEach(btn => { if (btn) btn.style.display = 'none'; });
            if (cplBalance && cplBalance.parentElement) cplBalance.parentElement.style.display = 'none';
            cplCols.forEach(col => { if (col) col.style.display = 'none'; });
        } else {
            cplButtons.forEach(btn => { if (btn) btn.style.display = ''; });
            if (cplBalance && cplBalance.parentElement) cplBalance.parentElement.style.display = '';
            cplCols.forEach(col => { if (col) col.style.display = ''; });
        }
        
        const annualBtn = document.querySelector('.leave-btn.annual');
        const sickBtn = document.querySelector('.leave-btn.sick');
        const casualBtn = document.querySelector('.leave-btn.casual');
        
        if (userSettings.limit_annual === 0 && annualBtn) annualBtn.style.display = 'none';
        else if (annualBtn) annualBtn.style.display = '';
        if (userSettings.limit_sick === 0 && sickBtn) sickBtn.style.display = 'none';
        else if (sickBtn) sickBtn.style.display = '';
        if (userSettings.limit_casual === 0 && casualBtn) casualBtn.style.display = 'none';
        else if (casualBtn) casualBtn.style.display = '';
        
        updateLeaveTypeDropdowns();
    };

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
            if (options.some(opt => opt.value === currentValue)) select.value = currentValue;
        });
    }

    window.updateSettingsUI = function() {
        refreshSettings();
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
    };

    // ==================== FIFO MATCHMAKER ====================
    function calculateFIFOBalance(entries, targetDate) {
        refreshSettings();
        targetDate.setHours(23, 59, 59, 999);
        
        const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        const alPackets = [];
        const cplPackets = [];
        const alUsage = [];
        const cplUsage = [];
        let totalOTAdjustment = 0;
        let totalSLAdjustment = 0;
        let totalCLAdjustment = 0;
        const alByYear = {};
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const year = entryDate.getFullYear();
            
            const alAdjustment = entry.al_adjustment !== undefined && entry.al_adjustment !== null ? parseFloat(entry.al_adjustment) : 0;
            const slAdjustment = entry.sl_adjustment !== undefined && entry.sl_adjustment !== null ? parseFloat(entry.sl_adjustment) : 0;
            const clAdjustment = entry.cl_adjustment !== undefined && entry.cl_adjustment !== null ? parseFloat(entry.cl_adjustment) : 0;
            const cplAdjustment = entry.cpl_adjustment !== undefined && entry.cpl_adjustment !== null ? parseFloat(entry.cpl_adjustment) : 0;
            const otAdjustment = entry.ot_adjustment !== undefined && entry.ot_adjustment !== null ? parseFloat(entry.ot_adjustment) : 0;
            
            if (otAdjustment !== 0 && userSettings.has_ot) totalOTAdjustment += otAdjustment;
            if (slAdjustment !== 0) totalSLAdjustment += slAdjustment;
            if (clAdjustment !== 0) totalCLAdjustment += clAdjustment;
            
            if (entry.al_accrued && entry.al_accrued > 0) {
                alPackets.push({
                    date: entry.date,
                    amount: entry.al_accrued,
                    expiryDate: entry.al_expiry_date ? new Date(entry.al_expiry_date) : null,
                    type: 'accrual'
                });
                alByYear[year] = (alByYear[year] || 0) + entry.al_accrued;
            }
            
            if (alAdjustment !== 0) {
                alPackets.push({
                    date: entry.date,
                    amount: alAdjustment,
                    expiryDate: entry.al_expiry_date ? new Date(entry.al_expiry_date) : null,
                    type: 'adjustment'
                });
                alByYear[year] = (alByYear[year] || 0) + alAdjustment;
            }
            
            if (userSettings.has_cpl && entry.cpl_earned && entry.cpl_earned > 0 && entry.cpl_expiry_date) {
                cplPackets.push({
                    date: entry.date,
                    amount: entry.cpl_earned,
                    expiryDate: new Date(entry.cpl_expiry_date)
                });
            }
            
            if (userSettings.has_cpl && cplAdjustment !== 0) {
                cplPackets.push({
                    date: entry.date,
                    amount: cplAdjustment,
                    expiryDate: entry.cpl_expiry_date ? new Date(entry.cpl_expiry_date) : null,
                    type: 'adjustment'
                });
            }
            
            if (entry.al_used && parseFloat(entry.al_used) > 0) {
                alUsage.push({ date: entry.date, amount: parseFloat(entry.al_used) });
            }
            
            if (userSettings.has_cpl && entry.cpl_used && parseFloat(entry.cpl_used) > 0) {
                cplUsage.push({ date: entry.date, amount: parseFloat(entry.cpl_used) });
            }
        }
        
        alPackets.sort((a, b) => new Date(a.date) - new Date(b.date));
        cplPackets.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        let alPacketsCopy = [...alPackets];
        for (const usage of alUsage) {
            const usageDate = new Date(usage.date);
            let remainingToUse = usage.amount;
            const validPackets = [];
            for (let i = 0; i < alPacketsCopy.length; i++) {
                const packet = alPacketsCopy[i];
                if (packet.amount <= 0) continue;
                const packetDate = new Date(packet.date);
                const expiryDate = packet.expiryDate;
                if (packetDate <= usageDate && (!expiryDate || expiryDate > usageDate)) {
                    validPackets.push({ index: i, packet });
                }
            }
            validPackets.sort((a, b) => new Date(a.packet.date) - new Date(b.packet.date));
            for (const { index, packet } of validPackets) {
                if (remainingToUse <= 0) break;
                const available = packet.amount;
                if (available <= remainingToUse) {
                    remainingToUse -= available;
                    alPacketsCopy[index] = { ...packet, amount: 0 };
                } else {
                    alPacketsCopy[index] = { ...packet, amount: available - remainingToUse };
                    remainingToUse = 0;
                }
            }
        }
        
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
                    if (packetDate <= usageDate && expiryDate > usageDate) {
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
                        cplPacketsCopy[index] = { ...packet, amount: available - remainingToUse };
                        remainingToUse = 0;
                    }
                }
            }
        }
        
        let alBalance = 0;
        let cplBalance = 0;
        
        for (const packet of alPacketsCopy) {
            if (packet.amount > 0 && (!packet.expiryDate || packet.expiryDate > targetDate)) {
                alBalance += packet.amount;
            }
        }
        
        if (userSettings.limit_annual > 0 && alBalance > userSettings.limit_annual) {
            alBalance = userSettings.limit_annual;
        }
        
        if (userSettings.has_cpl) {
            for (const packet of cplPacketsCopy) {
                if (packet.amount > 0 && packet.expiryDate > targetDate) {
                    cplBalance += packet.amount;
                }
            }
        }
        
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
        refreshSettings();
        if (!window.dbAPI || !getCurrentUser()) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(getCurrentUser().id);
        const today = new Date();
        const pastEntries = entries.filter(e => new Date(e.date) <= today);
        
        const fifoResult = calculateFIFOBalance(pastEntries, today);
        
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        
        let otThisMonth = 0;
        let otLastMonth = 0;
        let totalOT = 0;
        let slBalance = userSettings.limit_sick > 0 ? userSettings.limit_sick : 0;
        let clBalance = userSettings.limit_casual > 0 ? userSettings.limit_casual : 0;
        let currentYearSL = currentYear;
        let currentYearCL = currentYear;
        
        const sortedEntries = [...pastEntries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const entryYear = entryDate.getFullYear();
            
            if (userSettings.limit_sick > 0 && entryYear > currentYearSL) {
                slBalance = userSettings.limit_sick;
                currentYearSL = entryYear;
            }
            if (userSettings.limit_casual > 0 && entryYear > currentYearCL) {
                clBalance = userSettings.limit_casual;
                currentYearCL = entryYear;
            }
            
            if (entry.sl_used && userSettings.limit_sick > 0) slBalance -= parseFloat(entry.sl_used) || 0;
            if (entry.cl_used && userSettings.limit_casual > 0) clBalance -= parseFloat(entry.cl_used) || 0;
            if (entry.al_used) totalOT += parseFloat(entry.al_used) || 0;
            
            if (userSettings.has_ot && entry.final_ot_hours && entry.final_ot_hours > 0) {
                const otHours = parseFloat(entry.final_ot_hours) || 0;
                totalOT += otHours;
                if (entryDate.getMonth() === currentMonth && entryYear === currentYear) otThisMonth += otHours;
                else if (entryDate.getMonth() === lastMonth && entryYear === lastMonthYear) otLastMonth += otHours;
            }
        }
        
        if (userSettings.has_ot) {
            for (const entry of sortedEntries) {
                const otAdjustment = entry.ot_adjustment || 0;
                if (otAdjustment !== 0) {
                    totalOT += otAdjustment;
                    const entryDate = new Date(entry.date);
                    if (entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear) otThisMonth += otAdjustment;
                    else if (entryDate.getMonth() === lastMonth && entryDate.getFullYear() === lastMonthYear) otLastMonth += otAdjustment;
                }
            }
        }
        
        slBalance += fifoResult.slAdjustmentTotal || 0;
        clBalance += fifoResult.clAdjustmentTotal || 0;
        if (slBalance < 0) slBalance = 0;
        if (clBalance < 0) clBalance = 0;
        
        let finalALBalance = fifoResult.alBalance;
        if (userSettings.limit_annual === 0) finalALBalance = 0;
        
        let finalCPLBalance = userSettings.has_cpl ? fifoResult.cplBalance : 0;
        
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
        
        const alBalanceNote = document.querySelector('.al-card .balance-note');
        if (alBalanceNote && userSettings.limit_annual > 0) {
            alBalanceNote.textContent = `${userSettings.limit_annual} days carry forward per year`;
        }
        
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
    }

    window.loadBalances = loadBalances;

    // ==================== LOAD EXPIRY INFO ====================
    async function loadExpiryInfo() {
        refreshSettings();
        if (!window.dbAPI || !getCurrentUser()) return;
        
        const entries = await window.dbAPI.getAllEntriesForUser(getCurrentUser().id);
        const now = new Date();
        const fifoResult = calculateFIFOBalance(entries, now);
        
        const alExpiryDiv = document.getElementById('alExpiryInfo');
        const cplExpiryDiv = document.getElementById('cplExpiryInfo');
        
        if (alExpiryDiv) alExpiryDiv.innerHTML = '';
        if (cplExpiryDiv) cplExpiryDiv.innerHTML = '';
        
        const cplExpirySection = document.querySelector('.expiry-section');
        if (cplExpirySection && !userSettings.has_cpl) cplExpirySection.style.display = 'none';
        else if (cplExpirySection) cplExpirySection.style.display = '';
        
        if (userSettings.has_cpl && cplExpiryDiv) {
            const cplExpiring = [];
            for (const packet of fifoResult.cplPackets || []) {
                if (packet.amount > 0 && packet.expiryDate) {
                    const daysUntil = Math.ceil((packet.expiryDate - now) / (1000 * 60 * 60 * 24));
                    if (daysUntil > 0 && daysUntil <= 180) {
                        cplExpiring.push({
                            date: packet.date,
                            amount: packet.amount,
                            daysUntil: daysUntil,
                            expiryDate: packet.expiryDate.toISOString().split('T')[0]
                        });
                    }
                }
            }
            cplExpiring.sort((a, b) => a.daysUntil - b.daysUntil);
            if (cplExpiring.length === 0) {
                cplExpiryDiv.innerHTML = '<p>No CPL expiring soon</p>';
            } else {
                let html = '<h4>CPL Expiring Soon</h4>';
                cplExpiring.slice(0, 5).forEach(item => {
                    html += `<div class="expiry-item"><div>${item.amount.toFixed(2)} days from ${item.date}</div><div>Expires in ${item.daysUntil} days (${item.expiryDate})</div></div>`;
                });
                cplExpiryDiv.innerHTML = html;
            }
        }
        
        if (userSettings.limit_annual > 0 && alExpiryDiv) {
            const currentYear = now.getFullYear();
            let alExpiringThisYear = 0;
            for (const packet of fifoResult.alPackets || []) {
                if (packet.amount > 0 && packet.expiryDate && packet.expiryDate.getFullYear() === currentYear && packet.expiryDate > now) {
                    alExpiringThisYear += packet.amount;
                }
            }
            if (alExpiringThisYear <= 0) {
                alExpiryDiv.innerHTML = '<p>No AL expiring this year</p>';
            } else {
                alExpiryDiv.innerHTML = `<h4>AL Expiring This Year</h4><div class="expiry-item"><div><strong>${alExpiringThisYear.toFixed(2)} days</strong> will expire on Dec 31, ${currentYear}</div><div>(Balance above ${userSettings.limit_annual}-day carryover limit)</div></div>`;
            }
        }
    }

    window.loadExpiryInfo = loadExpiryInfo;

    // ==================== HISTORY FUNCTIONS ====================
    let currentHistoryFilter = 'all';
    let currentHistoryFrom = '';
    let currentHistoryTo = '';

    async function filterHistory(type) {
        refreshSettings();
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');
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
        refreshSettings();
        if (!window.dbAPI || !getCurrentUser()) return;
        
        let entries = await window.dbAPI.getAllEntriesForUser(getCurrentUser().id);
        
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
                entries = userSettings.has_ot ? entries.filter(e => e.final_ot_hours && e.final_ot_hours > 0) : [];
                break;
            case 'cpl':
                entries = userSettings.has_cpl ? entries.filter(e => e.cpl_earned && e.cpl_earned > 0) : [];
                break;
            case 'leave':
                entries = entries.filter(e => e.al_used > 0 || e.sl_used > 0 || e.cl_used > 0 || e.cpl_used > 0);
                break;
            default:
                break;
        }
        
        displayHistory(entries);
    }

    function displayHistory(entries) {
        refreshSettings();
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
            totalsHTML += `<div class="totals-row"><span class="total-label">Total OT:</span><span class="total-value">${totalOT.toFixed(1)} hours</span></div>`;
        }
        if (userSettings.has_cpl) {
            totalsHTML += `<div class="totals-row"><span class="total-label">Total CPL:</span><span class="total-value">${totalCPL.toFixed(2)} days</span></div>`;
        }
        totalsHTML += `<div class="totals-row"><span class="total-label">Total Leave:</span><span class="total-value">${totalLeave.toFixed(2)} days</span></div>`;
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
                let checkInStr = e.check_in;
                let checkOutStr = e.check_out;
                if (checkInStr.includes('T')) checkInStr = checkInStr.replace('T', ' ');
                if (checkOutStr.includes('T')) checkOutStr = checkOutStr.replace('T', ' ');
                const inTimePart = checkInStr.split(' ')[1] || '00:00:00';
                const outTimePart = checkOutStr.split(' ')[1] || '00:00:00';
                const [inHours, inMinutes] = inTimePart.split(':');
                const [outHours, outMinutes] = outTimePart.split(':');
                desc = `${inHours}:${inMinutes} - ${outHours}:${outMinutes}`;
                if (e.base_hours_rule !== null) details.push(`${e.base_hours_rule}h Base`);
                if (userSettings.has_ot && e.final_ot_hours && e.final_ot_hours > 0) details.push(`OT: ${e.final_ot_hours}h`);
            }
            
            if (e.al_accrued > 0) details.push(`AL Accrued: +${e.al_accrued}`);
            if (e.al_adjustment && e.al_adjustment !== 0) details.push(`AL Adjustment: ${e.al_adjustment > 0 ? '+' : ''}${e.al_adjustment}`);
            if (e.sl_adjustment && e.sl_adjustment !== 0) details.push(`SL Adjustment: ${e.sl_adjustment > 0 ? '+' : ''}${e.sl_adjustment}`);
            if (e.cl_adjustment && e.cl_adjustment !== 0) details.push(`CL Adjustment: ${e.cl_adjustment > 0 ? '+' : ''}${e.cl_adjustment}`);
            if (userSettings.has_cpl && e.cpl_adjustment && e.cpl_adjustment !== 0) details.push(`CPL Adjustment: ${e.cpl_adjustment > 0 ? '+' : ''}${e.cpl_adjustment}`);
            if (userSettings.has_ot && e.ot_adjustment && e.ot_adjustment !== 0) details.push(`OT Adjustment: ${e.ot_adjustment > 0 ? '+' : ''}${e.ot_adjustment}`);
            
            if (details.length > 0) desc += ` | ${details.join(' | ')}`;
            
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `<div class="history-item-date">${date}:</div><div class="history-item-desc">${desc}</div>`;
            list.appendChild(item);
        });
    }

    window.loadHistory = loadHistory;
    window.filterHistory = filterHistory;
    window.applyDateRange = applyDateRange;

    // ==================== SCHEDULE/TEMPLATE FUNCTIONS ====================
    function loadTemplateToUI() {
        refreshSettings();
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setVal('monBase', weeklyTemplate.monday?.base);
        setVal('monOT', weeklyTemplate.monday?.maxOT);
        setVal('monCPL', weeklyTemplate.monday?.cpl);
        setVal('tueBase', weeklyTemplate.tuesday?.base);
        setVal('tueOT', weeklyTemplate.tuesday?.maxOT);
        setVal('tueCPL', weeklyTemplate.tuesday?.cpl);
        setVal('wedBase', weeklyTemplate.wednesday?.base);
        setVal('wedOT', weeklyTemplate.wednesday?.maxOT);
        setVal('wedCPL', weeklyTemplate.wednesday?.cpl);
        setVal('thuBase', weeklyTemplate.thursday?.base);
        setVal('thuOT', weeklyTemplate.thursday?.maxOT);
        setVal('thuCPL', weeklyTemplate.thursday?.cpl);
        setVal('friBase', weeklyTemplate.friday?.base);
        setVal('friOT', weeklyTemplate.friday?.maxOT);
        setVal('friCPL', weeklyTemplate.friday?.cpl);
        setVal('satBase', weeklyTemplate.saturday?.base);
        setVal('satOT', weeklyTemplate.saturday?.maxOT);
        setVal('satCPL', weeklyTemplate.saturday?.cpl);
        setVal('sunOddBase', weeklyTemplate.sundayOdd?.base);
        setVal('sunOddOT', weeklyTemplate.sundayOdd?.maxOT);
        setVal('sunOddCPL', weeklyTemplate.sundayOdd?.cpl);
        setVal('sunEvenBase', weeklyTemplate.sundayEven?.base);
        setVal('sunEvenOT', weeklyTemplate.sundayEven?.maxOT);
        setVal('sunEvenCPL', weeklyTemplate.sundayEven?.cpl);
    }

    window.loadTemplateToUI = loadTemplateToUI;

    function saveTemplate() {
        const getVal = (id) => parseFloat(document.getElementById(id)?.value) || 0;
        const newTemplate = {
            monday: { base: getVal('monBase'), maxOT: getVal('monOT'), cpl: getVal('monCPL') },
            tuesday: { base: getVal('tueBase'), maxOT: getVal('tueOT'), cpl: getVal('tueCPL') },
            wednesday: { base: getVal('wedBase'), maxOT: getVal('wedOT'), cpl: getVal('wedCPL') },
            thursday: { base: getVal('thuBase'), maxOT: getVal('thuOT'), cpl: getVal('thuCPL') },
            friday: { base: getVal('friBase'), maxOT: getVal('friOT'), cpl: getVal('friCPL') },
            saturday: { base: getVal('satBase'), maxOT: getVal('satOT'), cpl: getVal('satCPL') },
            sundayOdd: { base: getVal('sunOddBase'), maxOT: getVal('sunOddOT'), cpl: getVal('sunOddCPL'), isHoliday: true },
            sundayEven: { base: getVal('sunEvenBase'), maxOT: getVal('sunEvenOT'), cpl: getVal('sunEvenCPL'), isHoliday: true }
        };
        weeklyTemplate = newTemplate;
        setWeeklyTemplate(newTemplate);
        localStorage.setItem('weeklyTemplate', JSON.stringify(newTemplate));
        alert('Template saved');
    }

    window.saveTemplate = saveTemplate;

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
        refreshSettings();
        const date = document.getElementById('singleDate').value;
        const type = document.getElementById('singleType').value;
        const baseInput = document.getElementById('singleBase').value;
        const otInput = document.getElementById('singleOT').value;
        const cplInput = document.getElementById('singleCPL').value;
        
        if (!date) { alert('Please select date'); return; }
        
        let entry = await window.fetchOrCreateEntry(date);
        entry.is_manual_adjustment = false;
        
        if (type === 'work') {
            entry.is_holiday = false;
            entry.is_off_day = false;
            if (baseInput !== '') entry.base_hours_rule = parseFloat(baseInput);
            if (otInput !== '' && userSettings.has_ot) entry.ot_cap_rule = parseFloat(otInput);
            if (cplInput !== '' && userSettings.has_cpl) entry.cpl_grant_rule = parseFloat(cplInput);
        } else if (type === 'holiday') {
            entry.is_holiday = true;
            entry.is_off_day = false;
            if (cplInput !== '' && userSettings.has_cpl) entry.cpl_grant_rule = parseFloat(cplInput);
            if (baseInput !== '') entry.base_hours_rule = parseFloat(baseInput);
            if (otInput !== '' && userSettings.has_ot) entry.ot_cap_rule = parseFloat(otInput);
        } else if (type === 'off') {
            entry.is_off_day = true;
            entry.is_holiday = false;
            entry.base_hours_rule = null;
            entry.ot_cap_rule = null;
            entry.cpl_grant_rule = null;
        }
        
        await window.saveAndSync(entry, false, true);
        closeSingleDateOverride();
        alert(`✅ Override saved for ${date}`);
        if (date === new Date().toISOString().split('T')[0]) await loadTodayEntry();
        await loadBalances();
        await loadExpiryInfo();
    }

    window.showSingleDateOverride = showSingleDateOverride;
    window.closeSingleDateOverride = closeSingleDateOverride;
    window.saveSingleDateOverride = saveSingleDateOverride;

    async function applyTemplateToRange() {
        refreshSettings();
        const from = document.getElementById('rangeFrom').value;
        const to = document.getElementById('rangeTo').value;
        
        if (!from || !to) { alert('Select date range'); return; }
        
        const start = new Date(from);
        const end = new Date(to);
        const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        
        if (daysDiff > 30 && !confirm(`This will apply template to ${daysDiff} days. Continue?`)) return;
        
        let count = 0;
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            let entry = await window.fetchOrCreateEntry(dateStr);
            entry.is_manual_adjustment = false;
            const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            
            if (dayName === 'sunday') {
                const sundayWeek = window.getSundayWeekNumber(d);
                if (sundayWeek % 2 === 1) {
                    entry.base_hours_rule = weeklyTemplate.sundayOdd?.base;
                    if (userSettings.has_ot) entry.ot_cap_rule = weeklyTemplate.sundayOdd?.maxOT;
                    if (userSettings.has_cpl) entry.cpl_grant_rule = weeklyTemplate.sundayOdd?.cpl;
                } else {
                    entry.base_hours_rule = weeklyTemplate.sundayEven?.base;
                    if (userSettings.has_ot) entry.ot_cap_rule = weeklyTemplate.sundayEven?.maxOT;
                    if (userSettings.has_cpl) entry.cpl_grant_rule = weeklyTemplate.sundayEven?.cpl;
                }
            } else {
                entry.base_hours_rule = weeklyTemplate[dayName]?.base !== undefined ? weeklyTemplate[dayName].base : 8;
                if (userSettings.has_ot) entry.ot_cap_rule = weeklyTemplate[dayName]?.maxOT !== undefined ? weeklyTemplate[dayName].maxOT : 1;
                if (userSettings.has_cpl) entry.cpl_grant_rule = weeklyTemplate[dayName]?.cpl !== undefined ? weeklyTemplate[dayName].cpl : 0;
            }
            
            await window.saveAndSync(entry, true, true);
            count++;
        }
        
        if (navigator.onLine && typeof batchSyncToCloud === 'function') await batchSyncToCloud();
        alert(`✅ Template applied to ${count} days`);
        await loadBalances();
        await loadExpiryInfo();
    }

    window.applyTemplateToRange = applyTemplateToRange;

    // ==================== HOME FUNCTIONS ====================
    async function loadTodayEntry() {
        if (!window.dbAPI || !getCurrentUser()) return;
        
        const today = new Date().toISOString().split('T')[0];
        const entry = await window.fetchOrCreateEntry(today);
        
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
                    let checkInStr = entry.check_in;
                    if (checkInStr.includes('T')) checkInStr = checkInStr.replace('T', ' ');
                    const timePart = checkInStr.split(' ')[1] || '00:00:00';
                    const [hours, minutes] = timePart.split(':');
                    const hour12 = parseInt(hours) % 12 || 12;
                    const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
                    document.getElementById('checkInDisplay').textContent = `${hour12}:${minutes}`;
                } else {
                    document.getElementById('checkInDisplay').textContent = '--:--';
                }
                
                if (entry.check_out) {
                    let checkOutStr = entry.check_out;
                    if (checkOutStr.includes('T')) checkOutStr = checkOutStr.replace('T', ' ');
                    const timePart = checkOutStr.split(' ')[1] || '00:00:00';
                    const [hours, minutes] = timePart.split(':');
                    const hour12 = parseInt(hours) % 12 || 12;
                    const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
                    document.getElementById('checkOutDisplay').textContent = `${hour12}:${minutes}`;
                } else {
                    document.getElementById('checkOutDisplay').textContent = '--:--';
                }
            }
        }
        await updateTargetTimeDisplay();
    }

    window.loadTodayEntry = loadTodayEntry;

    async function checkIn() {
        refreshSettings();
        if (!getCurrentUser()) { alert('Please login first'); return; }
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await window.fetchOrCreateEntry(today);
        
        if (entry && entry.check_in && !entry.check_out && !confirm('You are already checked in. Check in again?')) return;
        
        const now = new Date();
        const localDateTime = window.getLocalTimeForDB(now);
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        document.getElementById('checkInDisplay').textContent = timeStr;
        entry.check_in = localDateTime;
        entry.check_out = null;
        entry.is_manual_adjustment = false;
        
        await window.saveAndSync(entry, false, true);
        
        const updatedEntry = await window.fetchOrCreateEntry(today);
        const checkoutTimeLocal = calculateCheckoutTimeFromEntry(updatedEntry, localDateTime);
        await updateTargetTimeDisplay();
        await updateAlarmsAfterAction('checkin', timeStr, checkoutTimeLocal);
    }

    async function checkOut() {
        refreshSettings();
        if (!getCurrentUser()) { alert('Please login first'); return; }
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await window.fetchOrCreateEntry(today);
        
        if (!entry || !entry.check_in) { alert('You must check in first before checking out'); return; }
        if (entry.check_out && !confirm('Already checked out. Override?')) return;
        
        const now = new Date();
        const localDateTime = window.getLocalTimeForDB(now);
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        let checkInStr = entry.check_in;
        if (checkInStr.includes('T')) checkInStr = checkInStr.replace('T', ' ');
        const [inDatePart, inTimePart] = checkInStr.split(' ');
        const [inHours, inMinutes] = inTimePart.split(':').map(Number);
        const [outDatePart, outTimePart] = localDateTime.split(' ');
        const [outHours, outMinutes] = outTimePart.split(':').map(Number);
        
        if (outHours < inHours || (outHours === inHours && outMinutes <= inMinutes)) {
            alert('Check out time must be after check in time');
            return;
        }
        
        document.getElementById('checkOutDisplay').textContent = timeStr;
        entry.check_out = localDateTime;
        entry.is_manual_adjustment = false;
        
        await window.saveAndSync(entry, false, true);
        await updateTargetTimeDisplay();
        await updateAlarmsAfterAction('checkout', timeStr);
    }

    async function markLeave(type) {
        refreshSettings();
        if (!getCurrentUser()) return;
        
        let isEnabled = true;
        switch(type) {
            case 'annual': isEnabled = userSettings.limit_annual > 0; break;
            case 'sick': isEnabled = userSettings.limit_sick > 0; break;
            case 'casual': isEnabled = userSettings.limit_casual > 0; break;
            case 'cpl': isEnabled = userSettings.has_cpl; break;
        }
        if (!isEnabled) {
            alert(`⚠️ ${type.toUpperCase()} leave is disabled for your account.`);
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await window.fetchOrCreateEntry(today);
        
        if (entry && (entry.check_in || entry.check_out) && !confirm('This day already has check-in/out. Override with leave?')) return;
        
        entry.check_in = null;
        entry.check_out = null;
        entry.is_off_day = false;
        entry.is_holiday = false;
        entry.is_manual_adjustment = false;
        entry.al_used = entry.sl_used = entry.cl_used = entry.cpl_used = 0;
        entry[`${type}_used`] = 1;
        
        await window.saveAndSync(entry, false, true);
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
        await loadBalances();
        await updateTargetTimeDisplay();
    }

    async function markOffDay() {
        if (!getCurrentUser()) return;
        
        const today = new Date().toISOString().split('T')[0];
        let entry = await window.fetchOrCreateEntry(today);
        
        entry.is_off_day = true;
        entry.is_holiday = false;
        entry.check_in = null;
        entry.check_out = null;
        entry.al_used = entry.sl_used = entry.cl_used = entry.cpl_used = 0;
        entry.is_manual_adjustment = false;
        
        await window.saveAndSync(entry, false, true);
        document.getElementById('checkInDisplay').textContent = '--:--';
        document.getElementById('checkOutDisplay').textContent = '--:--';
        await updateTargetTimeDisplay();
    }

    window.checkIn = checkIn;
    window.checkOut = checkOut;
    window.markLeave = markLeave;
    window.markOffDay = markOffDay;

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
        refreshSettings();
        const date = document.getElementById('manualDate').value;
        const checkIn = document.getElementById('manualIn').value;
        const checkOut = document.getElementById('manualOut').value;
        const type = document.getElementById('manualType').value;
        
        if (!date) { alert('Please select date'); return; }
        
        let entry = await window.fetchOrCreateEntry(date);
        entry.al_used = entry.sl_used = entry.cl_used = entry.cpl_used = 0;
        entry.is_off_day = false;
        entry.is_holiday = false;
        entry.is_manual_adjustment = false;
        
        if (type === 'work') {
            if (checkIn) entry.check_in = `${date} ${checkIn}:00`;
            else entry.check_in = null;
            if (checkOut) entry.check_out = `${date} ${checkOut}:00`;
            else entry.check_out = null;
        } else if (type === 'holiday') {
            entry.is_holiday = true;
            if (checkIn) entry.check_in = `${date} ${checkIn}:00`;
            else entry.check_in = null;
            if (checkOut) entry.check_out = `${date} ${checkOut}:00`;
            else entry.check_out = null;
        } else if (type === 'off') {
            entry.is_off_day = true;
            entry.check_in = null;
            entry.check_out = null;
        } else {
            let isEnabled = true;
            switch(type) {
                case 'annual': isEnabled = userSettings.limit_annual > 0; break;
                case 'sick': isEnabled = userSettings.limit_sick > 0; break;
                case 'casual': isEnabled = userSettings.limit_casual > 0; break;
                case 'cpl': isEnabled = userSettings.has_cpl; break;
            }
            if (!isEnabled) {
                alert(`⚠️ ${type.toUpperCase()} leave is disabled for your account.`);
                return;
            }
            entry[`${type}_used`] = 1;
            entry.check_in = null;
            entry.check_out = null;
        }
        
        await window.saveAndSync(entry, false, true);
        closeManualEntry();
        if (date === new Date().toISOString().split('T')[0]) await loadTodayEntry();
        await loadBalances();
        await loadExpiryInfo();
    }

    window.showManualEntry = showManualEntry;
    window.closeManualEntry = closeManualEntry;
    window.saveManualEntry = saveManualEntry;

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
        refreshSettings();
        const fromDate = document.getElementById('bulkFromDate').value;
        const toDate = document.getElementById('bulkToDate').value;
        const checkIn = document.getElementById('bulkCheckIn').value;
        const checkOut = document.getElementById('bulkCheckOut').value;
        const type = document.getElementById('bulkType').value;
        
        if (!fromDate || !toDate) { alert('Please select both FROM and TO dates'); return; }
        if (fromDate > toDate) { alert('FROM date must be before TO date'); return; }
        
        const start = new Date(fromDate);
        const end = new Date(toDate);
        const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        
        if (daysDiff > 30 && !confirm(`This will apply to ${daysDiff} days. Continue?`)) return;
        
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
                let entry = await window.fetchOrCreateEntry(dateStr);
                entry.al_used = entry.sl_used = entry.cl_used = entry.cpl_used = 0;
                entry.is_off_day = false;
                entry.is_holiday = false;
                entry.is_manual_adjustment = false;
                
                if (type === 'work') {
                    if (checkIn) entry.check_in = `${dateStr} ${checkIn}:00`;
                    else entry.check_in = null;
                    if (checkOut) entry.check_out = `${dateStr} ${checkOut}:00`;
                    else entry.check_out = null;
                } else if (type === 'holiday') {
                    entry.is_holiday = true;
                    entry.check_in = checkIn ? `${dateStr} ${checkIn}:00` : null;
                    entry.check_out = checkOut ? `${dateStr} ${checkOut}:00` : null;
                } else if (type === 'off') {
                    entry.is_off_day = true;
                    entry.check_in = null;
                    entry.check_out = null;
                } else {
                    let isEnabled = true;
                    switch(type) {
                        case 'annual': isEnabled = userSettings.limit_annual > 0; break;
                        case 'sick': isEnabled = userSettings.limit_sick > 0; break;
                        case 'casual': isEnabled = userSettings.limit_casual > 0; break;
                        case 'cpl': isEnabled = userSettings.has_cpl; break;
                    }
                    if (!isEnabled) {
                        errorCount++;
                        continue;
                    }
                    entry[`${type}_used`] = 1;
                    entry.check_in = null;
                    entry.check_out = null;
                }
                
                await window.saveAndSync(entry, true, true);
                successCount++;
            } catch (error) {
                errorCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        progressDiv.innerHTML = `Complete! Success: ${successCount}, Failed: ${errorCount}`;
        
        if (navigator.onLine && successCount > 0 && typeof batchSyncToCloud === 'function') {
            progressDiv.innerHTML = 'Syncing to cloud...';
            await batchSyncToCloud();
        }
        
        alert(`✅ Bulk entry complete\nSuccess: ${successCount} days\nFailed: ${errorCount} days`);
        closeBulkManualEntry();
        await loadBalances();
        await loadExpiryInfo();
    }

    window.showBulkManualEntry = showBulkManualEntry;
    window.closeBulkManualEntry = closeBulkManualEntry;
    window.saveBulkManualEntry = saveBulkManualEntry;

    // ==================== ALARM & NOTIFICATION FUNCTIONS ====================
    function calculateCheckoutTimeFromEntry(entry, checkinTime) {
        if (!entry || !checkinTime) return null;
        
        let checkinTimeStr = checkinTime;
        if (checkinTimeStr.includes('T')) checkinTimeStr = checkinTimeStr.replace('T', ' ');
        const [datePart, timePart] = checkinTimeStr.split(' ');
        const [hours, minutes, seconds] = timePart.split(':').map(Number);
        
        const checkinDate = new Date();
        checkinDate.setHours(hours, minutes, seconds || 0);
        
        const baseHours = entry.base_hours_rule || 8;
        const maxOtHours = entry.ot_cap_rule || (userSettings.has_ot ? 1 : 0);
        const totalWorkHours = baseHours + maxOtHours;
        
        const checkoutDate = new Date(checkinDate.getTime() + (totalWorkHours * 60 * 60 * 1000));
        const checkoutHours = checkoutDate.getHours();
        const checkoutMinutes = checkoutDate.getMinutes();
        return `${String(checkoutHours).padStart(2, '0')}:${String(checkoutMinutes).padStart(2, '0')}`;
    }

    async function recalculateCheckoutAlarm(date) {
        if (!getAuthToken() || !getCurrentUser()) return;
        
        const entry = await window.fetchOrCreateEntry(date);
        if (!entry || !entry.check_in) return;
        
        let checkinTimeStr = entry.check_in;
        if (checkinTimeStr.includes('T')) checkinTimeStr = checkinTimeStr.replace('T', ' ');
        const [datePart, timePart] = checkinTimeStr.split(' ');
        const [hours, minutes, seconds] = timePart.split(':').map(Number);
        
        const checkinDate = new Date();
        checkinDate.setHours(hours, minutes, seconds || 0);
        
        const baseHours = entry.base_hours_rule || 8;
        const maxOtHours = entry.ot_cap_rule || (userSettings.has_ot ? 1 : 0);
        const totalWorkHours = baseHours + maxOtHours;
        
        const checkoutTime = new Date(checkinDate.getTime() + (totalWorkHours * 60 * 60 * 1000));
        const checkoutTimeLocal = `${String(checkoutTime.getHours()).padStart(2, '0')}:${String(checkoutTime.getMinutes()).padStart(2, '0')}`;
        
        const tzOffset = new Date().getTimezoneOffset();
        const [localHour, localMinute] = checkoutTimeLocal.split(':').map(Number);
        let localTotalMinutes = (localHour * 60) + localMinute;
        let utcTotalMinutes = localTotalMinutes + tzOffset;
        if (utcTotalMinutes < 0) utcTotalMinutes += 1440;
        if (utcTotalMinutes >= 1440) utcTotalMinutes -= 1440;
        const utcHour = Math.floor(utcTotalMinutes / 60);
        const utcMinute = utcTotalMinutes % 60;
        const checkoutTimeUTC = `${String(utcHour).padStart(2, '0')}:${String(utcMinute).padStart(2, '0')}`;
        
        try {
            const response = await fetch('/api/notifications?action=update-checkout-alarm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
                body: JSON.stringify({ checkout_time_local: checkoutTimeLocal, tz_offset: tzOffset })
            });
            if (response.ok) await loadAlarmSettings();
        } catch (error) {}
    }

    window.recalculateCheckoutAlarm = recalculateCheckoutAlarm;

    async function updateAlarmsAfterAction(action, checkinTimeLocal, customCheckoutTime = null) {
        if (!getAuthToken() || !getCurrentUser()) return;
        const tzOffset = new Date().getTimezoneOffset();
        
        try {
            const response = await fetch('/api/notifications?action=update-alarms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
                body: JSON.stringify({ action: action, currentTimeLocal: checkinTimeLocal, checkoutTimeLocal: customCheckoutTime, tz_offset: tzOffset })
            });
            if (response.ok) await loadAlarmSettings();
        } catch (error) {}
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    }

    async function syncPushSubscription(retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 5000;
        
        if (!getAuthToken() || !getCurrentUser()) return false;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
        if (Notification.permission !== 'granted') return false;
        
        try {
            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();
            
            let vapidPublicKey = null;
            try {
                const vapidResponse = await fetch('/api/notifications?action=get-vapid-key');
                if (vapidResponse.ok) {
                    const vapidData = await vapidResponse.json();
                    if (vapidData.success && vapidData.vapidPublicKey) vapidPublicKey = vapidData.vapidPublicKey;
                }
            } catch (e) {}
            
            if (!subscription && vapidPublicKey) {
                const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
                const rawSubscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
                
                let p256dhKey = null, authKey = null;
                if (rawSubscription.getKey) {
                    const p256dhBuffer = rawSubscription.getKey('p256dh');
                    const authBuffer = rawSubscription.getKey('auth');
                    if (p256dhBuffer && authBuffer) {
                        const p256dhArray = new Uint8Array(p256dhBuffer);
                        const authArray = new Uint8Array(authBuffer);
                        let p256dhBinary = '', authBinary = '';
                        for (let i = 0; i < p256dhArray.length; i++) p256dhBinary += String.fromCharCode(p256dhArray[i]);
                        for (let i = 0; i < authArray.length; i++) authBinary += String.fromCharCode(authArray[i]);
                        p256dhKey = btoa(p256dhBinary);
                        authKey = btoa(authBinary);
                    }
                }
                if (!p256dhKey && rawSubscription.toJSON) {
                    const json = rawSubscription.toJSON();
                    if (json && json.keys) {
                        p256dhKey = json.keys.p256dh;
                        authKey = json.keys.auth;
                    }
                }
                if (!p256dhKey) return false;
                
                subscription = { endpoint: rawSubscription.endpoint, keys: { p256dh: p256dhKey, auth: authKey } };
            }
            
            if (subscription && subscription.endpoint && subscription.keys) {
                const response = await fetch('/api/notifications?action=subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
                    body: JSON.stringify(subscription)
                });
                if (response.ok) {
                    localStorage.setItem('push_subscription_status', 'active');
                    return true;
                }
            }
            
            if (retryCount < MAX_RETRIES) {
                setTimeout(() => syncPushSubscription(retryCount + 1), RETRY_DELAY);
            }
            return false;
        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                setTimeout(() => syncPushSubscription(retryCount + 1), RETRY_DELAY);
            }
            return false;
        }
    }

    window.syncPushSubscription = syncPushSubscription;

    async function loadAlarmSettings() {
        if (!getAuthToken()) return;
        
        try {
            const response = await fetch('/api/notifications?action=get', {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    const currentTzOffset = new Date().getTimezoneOffset();
                    const cloudTzOffset = data.settings.tz_offset || 0;
                    const offsetDiffMinutes = currentTzOffset - cloudTzOffset;
                    
                    let localCheckinTime = data.settings.checkin_time || '09:00';
                    if (localCheckinTime && offsetDiffMinutes !== 0) {
                        const [hours, minutes] = localCheckinTime.split(':').map(Number);
                        let totalMinutes = (hours * 60) + minutes - offsetDiffMinutes;
                        if (totalMinutes < 0) totalMinutes += 1440;
                        if (totalMinutes >= 1440) totalMinutes -= 1440;
                        localCheckinTime = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
                    }
                    
                    let localCheckoutTime = data.settings.checkout_time || '18:00';
                    if (localCheckoutTime && offsetDiffMinutes !== 0) {
                        const [hours, minutes] = localCheckoutTime.split(':').map(Number);
                        let totalMinutes = (hours * 60) + minutes - offsetDiffMinutes;
                        if (totalMinutes < 0) totalMinutes += 1440;
                        if (totalMinutes >= 1440) totalMinutes -= 1440;
                        localCheckoutTime = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
                    }
                    
                    currentAlarmSettings = {
                        enabled: data.settings.is_alarm_enabled,
                        checkinTime: localCheckinTime,
                        checkoutTime: localCheckoutTime,
                        tzOffset: currentTzOffset
                    };
                    setCurrentAlarmSettings(currentAlarmSettings);
                    
                    const alarmEnabledCheckbox = document.getElementById('alarmEnabled');
                    const alarmTimeInput = document.getElementById('checkinAlarmTime');
                    if (alarmEnabledCheckbox) alarmEnabledCheckbox.checked = currentAlarmSettings.enabled;
                    if (alarmTimeInput) alarmTimeInput.value = currentAlarmSettings.checkinTime;
                }
            }
        } catch (error) {}
        await updateTargetTimeDisplay();
        updateNotificationStatus();
    }

    window.loadAlarmSettings = loadAlarmSettings;

    async function saveAlarmSettings() {
        const isEnabled = document.getElementById('alarmEnabled')?.checked || false;
        const checkinTime = document.getElementById('checkinAlarmTime')?.value || '09:00';
        
        if (!checkinTime && isEnabled) { alert('Please select a check-in time'); return; }
        
        const tzOffset = new Date().getTimezoneOffset();
        const today = new Date();
        const dayName = today.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        let baseHours = 8, maxOT = 1;
        if (dayName === 'sunday') {
            const sundayWeek = window.getSundayWeekNumber(today);
            if (sundayWeek % 2 === 1) {
                baseHours = weeklyTemplate.sundayOdd?.base || 8;
                maxOT = weeklyTemplate.sundayOdd?.maxOT || 0;
            } else {
                baseHours = weeklyTemplate.sundayEven?.base || 6;
                maxOT = weeklyTemplate.sundayEven?.maxOT || 0;
            }
        } else {
            baseHours = weeklyTemplate[dayName]?.base || 8;
            maxOT = weeklyTemplate[dayName]?.maxOT || 1;
        }
        
        const totalWorkHours = baseHours + maxOT;
        const [checkinHour, checkinMinute] = checkinTime.split(':').map(Number);
        let checkoutHour = checkinHour + totalWorkHours;
        let checkoutMinute = checkinMinute;
        if (checkoutHour >= 24) checkoutHour -= 24;
        const localCheckoutTime = `${String(checkoutHour).padStart(2, '0')}:${String(checkoutMinute).padStart(2, '0')}`;
        
        try {
            const response = await fetch('/api/notifications?action=save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
                body: JSON.stringify({ is_alarm_enabled: isEnabled, checkin_time_local: checkinTime, checkout_time_local: localCheckoutTime, tz_offset: tzOffset })
            });
            const data = await response.json();
            if (data.success) {
                currentAlarmSettings = { enabled: isEnabled, checkinTime: checkinTime, checkoutTime: localCheckoutTime, tzOffset: tzOffset };
                setCurrentAlarmSettings(currentAlarmSettings);
                alert('✅ Alarm settings saved!');
                await updateTargetTimeDisplay();
                if (Notification.permission === 'granted') await syncPushSubscription(0);
            } else {
                alert('Failed to save: ' + data.message);
            }
        } catch (error) {
            alert('Failed to save alarm settings');
        }
    }

    window.saveAlarmSettings = saveAlarmSettings;

    async function updateTargetTimeDisplay() {
        if (!getCurrentUser()) return;
        
        const today = new Date().toISOString().split('T')[0];
        const todayEntry = await window.fetchOrCreateEntry(today);
        
        const baseHours = todayEntry?.base_hours_rule || 8;
        const maxOtHours = userSettings.has_ot ? (todayEntry?.ot_cap_rule || 1) : 0;
        const totalWorkHours = baseHours + maxOtHours;
        
        const targetDisplay = document.getElementById('targetTimeDisplay');
        const calculationDisplay = document.getElementById('targetCalculation');
        
        if (!targetDisplay || !calculationDisplay) return;
        
        if (todayEntry?.check_in && !todayEntry?.check_out) {
            let checkinTimeStr = todayEntry.check_in;
            if (checkinTimeStr.includes('T')) checkinTimeStr = checkinTimeStr.replace('T', ' ');
            const [datePart, timePart] = checkinTimeStr.split(' ');
            const [hours, minutes, seconds] = timePart.split(':').map(Number);
            
            const checkinDate = new Date();
            checkinDate.setHours(hours, minutes, seconds || 0);
            const targetTime = new Date(checkinDate.getTime() + (totalWorkHours * 60 * 60 * 1000));
            
            const targetHours = targetTime.getHours();
            const targetMinutes = targetTime.getMinutes();
            const ampm = targetHours >= 12 ? 'PM' : 'AM';
            const hour12 = targetHours % 12 || 12;
            const targetTimeStr = `${hour12}:${String(targetMinutes).padStart(2, '0')} ${ampm}`;
            
            targetDisplay.textContent = targetTimeStr;
        } else if (currentAlarmSettings.checkinTime && currentAlarmSettings.enabled) {
            const [hours, minutes] = currentAlarmSettings.checkinTime.split(':').map(Number);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const hour12 = hours % 12 || 12;
            const checkinDisplay = `${hour12}:${String(minutes).padStart(2, '0')} ${ampm}`;
            
            const baseDate = new Date();
            baseDate.setHours(hours, minutes, 0, 0);
            const targetDate = new Date(baseDate.getTime() + (totalWorkHours * 60 * 60 * 1000));
            const targetHours = targetDate.getHours();
            const targetMinutes = targetDate.getMinutes();
            const targetAmpm = targetHours >= 12 ? 'PM' : 'AM';
            const targetHour12 = targetHours % 12 || 12;
            const targetTimeStr = `${targetHour12}:${String(targetMinutes).padStart(2, '0')} ${targetAmpm}`;
            
            targetDisplay.textContent = targetTimeStr;
            calculationDisplay.innerHTML = `📅 Planned: ${checkinDisplay} + ${baseHours}h Base + ${maxOtHours}h OT (max) = ${targetTimeStr}`;
        } else {
            targetDisplay.textContent = '--:--';
            calculationDisplay.innerHTML = 'Enable alarms and set check-in time to see target calculation';
        }
    }

    window.updateTargetTimeDisplay = updateTargetTimeDisplay;

    function updateNotificationStatus() {
        const notifStatus = document.getElementById('notifStatus');
        if (!notifStatus) return;
        const pushStatus = localStorage.getItem('push_subscription_status');
        
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                if (pushStatus === 'active') notifStatus.innerHTML = '✅ Notifications: Enabled & Synced';
                else if (pushStatus === 'attempting') notifStatus.innerHTML = '⏳ Notifications: Syncing...';
                else notifStatus.innerHTML = '✅ Notifications: Enabled (Syncing)';
            } else if (Notification.permission === 'denied') {
                notifStatus.innerHTML = '❌ Notifications: Blocked - Please enable in browser settings';
            } else {
                notifStatus.innerHTML = '🔔 Notifications: Click Enable to receive reminders';
            }
        } else {
            notifStatus.innerHTML = '⚠️ Notifications not supported in this browser';
        }
    }

    async function requestNotificationPermission() {
        if (!('Notification' in window)) { alert('This browser does not support notifications'); return; }
        
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            updateNotificationStatus();
            alert('✅ Notifications enabled! You will receive check-in reminders.');
            startBrowserAlarmChecker();
            await syncPushSubscription(0);
        } else {
            updateNotificationStatus();
            alert('❌ Notifications blocked. You can enable them in browser settings.');
        }
    }

    window.requestNotificationPermission = requestNotificationPermission;

    function startBrowserAlarmChecker() {
        setInterval(async () => {
            if (!getCurrentUser() || !currentAlarmSettings.enabled) return;
            if (!getAuthToken()) return;
            
            const now = new Date();
            const userOffset = currentAlarmSettings.tzOffset || 0;
            const [alarmHour, alarmMinute] = currentAlarmSettings.checkinTime.split(':').map(Number);
            let alarmUtcHour = alarmHour - (userOffset / 60);
            if (alarmUtcHour < 0) alarmUtcHour += 24;
            if (alarmUtcHour >= 24) alarmUtcHour -= 24;
            
            const currentUtcHour = now.getUTCHours();
            const currentUtcMinute = now.getUTCMinutes();
            
            const alarmTotal = alarmUtcHour * 60 + alarmMinute;
            const currentTotal = currentUtcHour * 60 + currentUtcMinute;
            let diff = alarmTotal - currentTotal;
            if (diff < 0 && diff > -12 * 60) diff += 24 * 60;
            
            if (diff >= 0 && diff <= 15) {
                const today = now.toISOString().split('T')[0];
                const entry = await window.fetchOrCreateEntry(today);
                if (!entry.check_in && Notification.permission === 'granted') {
                    new Notification('⏰ Time to Check In!', {
                        body: `It's ${currentAlarmSettings.checkinTime} - time to check in for work.`,
                        icon: '/icon-192.png', tag: 'checkin-reminder', requireInteraction: true
                    });
                }
            }
        }, 60000);
    }

    // ==================== NOTIFICATION SCHEDULER ====================
    function startNotificationScheduler() {
        if (getNotificationInterval()) clearInterval(getNotificationInterval());
        const interval = setInterval(async () => {
            if (getAuthToken() && document.visibilityState === 'visible') await checkNotificationsManually();
        }, 5 * 60 * 1000);
        setNotificationInterval(interval);
        setTimeout(() => checkNotificationsManually(), 10000);
    }

    function stopNotificationScheduler() {
        if (getNotificationInterval()) {
            clearInterval(getNotificationInterval());
            setNotificationInterval(null);
        }
    }

    window.startNotificationScheduler = startNotificationScheduler;
    window.stopNotificationScheduler = stopNotificationScheduler;

    async function resetDailyAlarms() {
        if (!getAuthToken()) return;
        const lastResetDate = localStorage.getItem('lastAlarmReset');
        const today = new Date().toISOString().split('T')[0];
        if (lastResetDate === today) return;
        
        try {
            const response = await fetch('/api/notifications?action=reset-daily-alarms', {
                method: 'POST', headers: { 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                localStorage.setItem('lastAlarmReset', today);
                await loadAlarmSettings();
            }
        } catch (error) {}
    }

    window.resetDailyAlarms = resetDailyAlarms;

    async function checkNotificationsManually() {
        if (!getAuthToken() || !getCurrentUser()) return;
        try {
            const response = await fetch('/api/notifications?action=client-check', {
                method: 'POST', headers: { 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ tz_offset: new Date().getTimezoneOffset() })
            });
            const data = await response.json();
            if (data.success && data.notificationsSent && data.notificationsSent.length > 0) {
                await window.loadTodayEntry();
                await loadBalances();
            }
        } catch (error) {}
    }

    window.checkNotificationsManually = checkNotificationsManually;

    // ==================== OTP FUNCTIONS ====================
    function showOTPModal(otpData, purpose, email) {
        setCurrentOTPData(otpData);
        setVerificationPurpose(purpose);
        setPendingEmail(email);
        
        document.getElementById('appEmailDisplay').textContent = otpData.appEmail;
        document.getElementById('otpCodeDisplay').textContent = otpData.otpCode;
        
        const expiry = new Date(otpData.expiry);
        startOTPTimer(expiry);
        document.getElementById('otpModal').style.display = 'flex';
    }

    window.showOTPModal = showOTPModal;

    function startOTPTimer(expiryDate) {
        if (getOtpTimerInterval()) clearInterval(getOtpTimerInterval());
        
        function updateTimer() {
            const now = new Date();
            const diff = expiryDate - now;
            if (diff <= 0) {
                document.getElementById('otpTimer').textContent = '00:00';
                document.getElementById('otpTimer').classList.add('expired');
                const verifyBtn = document.getElementById('verifyOtpBtn');
                if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.style.opacity = '0.5'; }
                if (getOtpTimerInterval()) clearInterval(getOtpTimerInterval());
                return;
            }
            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            document.getElementById('otpTimer').textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        updateTimer();
        setOtpTimerInterval(setInterval(updateTimer, 1000));
    }

    function closeOTPModal() {
        document.getElementById('otpModal').style.display = 'none';
        if (getOtpTimerInterval()) { clearInterval(getOtpTimerInterval()); setOtpTimerInterval(null); }
        document.getElementById('otpError').textContent = '';
    }

    window.closeOTPModal = closeOTPModal;

    function copyToClipboard(elementId) {
        const element = document.getElementById(elementId);
        navigator.clipboard.writeText(element.textContent);
        alert('Copied to clipboard! (OTP is case-insensitive)');
    }

    window.copyToClipboard = copyToClipboard;

    function openMailClient() {
        const otpData = getCurrentOTPData();
        if (!otpData) return;
        const subject = encodeURIComponent(otpData.otpCode);
        const to = otpData.appEmail;
        window.location.href = `mailto:${to}?subject=${subject}`;
    }

    window.openMailClient = openMailClient;

    async function verifyOTP() {
        const otpData = getCurrentOTPData();
        const email = getPendingEmail();
        const purpose = getVerificationPurpose();
        
        if (!otpData || !email) { document.getElementById('otpError').textContent = 'Missing verification data'; return; }
        
        const verifyBtn = document.getElementById('verifyOtpBtn');
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
        
        try {
            const response = await fetch('/api/verify-otp', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otpCode: otpData.otpCode, purpose })
            });
            const data = await response.json();
            
            if (data.success) {
                const savedPurpose = purpose;
                const savedEmail = email;
                closeOTPModal();
                
                if (savedPurpose === 'register') {
                    alert('Email verified successfully! You can now login.');
                    window.showLogin();
                } else if (savedPurpose === 'reset') {
                    showResetPasswordModal(savedEmail);
                }
                setCurrentOTPData(null);
                setVerificationPurpose(null);
                setPendingEmail(null);
            } else {
                document.getElementById('otpError').textContent = data.message || 'Verification failed';
                verifyBtn.disabled = false;
                verifyBtn.textContent = "I've Sent the Email";
            }
        } catch (error) {
            document.getElementById('otpError').textContent = 'Verification failed. Please try again.';
            verifyBtn.disabled = false;
            verifyBtn.textContent = "I've Sent the Email";
        }
    }

    window.verifyOTP = verifyOTP;

    // ==================== FORGOT PASSWORD ====================
    function showForgotPassword() {
        const email = prompt('Enter your email address:');
        if (!email) return;
        initiateForgotPassword(email);
    }

    window.showForgotPassword = showForgotPassword;

    async function initiateForgotPassword(email) {
        try {
            const response = await fetch('/api/account?action=forgot-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();
            if (data.success && data.requiresVerification) {
                showOTPModal({ appEmail: data.appEmail, otpCode: data.otpCode, expiry: data.expiry }, 'reset', email);
            } else {
                alert(data.message || 'Failed to process request');
            }
        } catch (error) {
            alert('Failed to process request. Please try again.');
        }
    }

    function showResetPasswordModal(email) {
        const modal = document.createElement('div');
        modal.id = 'resetPasswordModal';
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <h3>🔐 Reset Password</h3>
                <p style="color: #666; margin-bottom: 20px;">Set a new password for<br><strong>${escapeHtml(email)}</strong></p>
                <div class="input-group"><input type="password" id="resetNewPassword" placeholder="New password (min 6 chars)" class="modal-input"></div>
                <div class="input-group"><input type="password" id="resetConfirmPassword" placeholder="Confirm password" class="modal-input"></div>
                <div id="resetError" class="error-message"></div>
                <div class="modal-buttons">
                    <button onclick="window.closeResetPasswordModal()" class="modal-cancel">Cancel</button>
                    <button onclick="window.submitNewPassword('${escapeHtml(email)}')" class="modal-save">Reset Password</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    window.showResetPasswordModal = showResetPasswordModal;

    function closeResetPasswordModal() {
        const modal = document.getElementById('resetPasswordModal');
        if (modal) modal.remove();
    }

    window.closeResetPasswordModal = closeResetPasswordModal;

    function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, function(m) { if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m; }); }

    async function submitNewPassword(email) {
        const newPassword = document.getElementById('resetNewPassword')?.value;
        const confirmPassword = document.getElementById('resetConfirmPassword')?.value;
        const errorEl = document.getElementById('resetError');
        
        if (!newPassword || !confirmPassword) { errorEl.textContent = 'Please fill in both password fields'; return; }
        if (newPassword.length < 6) { errorEl.textContent = 'Password must be at least 6 characters'; return; }
        if (newPassword !== confirmPassword) { errorEl.textContent = 'Passwords do not match'; return; }
        
        const submitBtn = document.querySelector('#resetPasswordModal .modal-save');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Resetting...'; }
        
        try {
            const response = await fetch('/api/account?action=reset-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, newPassword })
            });
            const data = await response.json();
            if (data.success) {
                alert('✅ Password reset successfully! You can now login with your new password.');
                closeResetPasswordModal();
                window.showLogin();
            } else {
                errorEl.textContent = data.message || 'Password reset failed';
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Reset Password'; }
            }
        } catch (error) {
            errorEl.textContent = 'Failed to reset password. Please try again.';
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Reset Password'; }
        }
    }

    window.submitNewPassword = submitNewPassword;

    // ==================== CHANGE PASSWORD ====================
    function showChangePasswordModal() {
        document.getElementById('changePasswordModal').style.display = 'flex';
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('passwordError').textContent = '';
    }

    function closeChangePasswordModal() { document.getElementById('changePasswordModal').style.display = 'none'; }

    async function changePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const errorEl = document.getElementById('passwordError');
        
        if (!currentPassword || !newPassword || !confirmPassword) { errorEl.textContent = 'All fields required'; return; }
        if (newPassword !== confirmPassword) { errorEl.textContent = 'New passwords do not match'; return; }
        if (newPassword.length < 6) { errorEl.textContent = 'Password must be at least 6 characters'; return; }
        
        try {
            const response = await fetch('/api/account?action=change-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const data = await response.json();
            if (data.success) { closeChangePasswordModal(); alert('✅ Password changed successfully'); }
            else { errorEl.textContent = data.message || 'Password change failed'; }
        } catch (error) { errorEl.textContent = 'Connection error: ' + error.message; }
    }

    window.showChangePasswordModal = showChangePasswordModal;
    window.closeChangePasswordModal = closeChangePasswordModal;
    window.changePassword = changePassword;

    // ==================== DELETE ACCOUNT ====================
    function showDeleteAccountModal() {
        document.getElementById('deleteAccountModal').style.display = 'flex';
        document.getElementById('deleteConfirm').value = '';
        document.getElementById('deleteError').textContent = '';
    }

    function closeDeleteAccountModal() { document.getElementById('deleteAccountModal').style.display = 'none'; }

    async function deleteAccount() {
        const confirmText = document.getElementById('deleteConfirm').value;
        const errorEl = document.getElementById('deleteError');
        if (confirmText !== 'DELETE') { errorEl.textContent = 'Please type DELETE to confirm'; return; }
        if (!confirm('⚠️ WARNING: This will permanently delete ALL your data and account!')) return;
        
        try {
            const response = await fetch('/api/account?action=delete-account', {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            });
            const data = await response.json();
            if (data.success) {
                stopNotificationScheduler();
                localStorage.removeItem('push_subscription_status');
                await window.clearAuthFromServiceWorker();
                if (window.dbAPI) await window.dbAPI.clearAllData();
                localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user');
                localStorage.removeItem('weeklyTemplate'); localStorage.removeItem('lastAlarmReset');
                setAuthToken(null); setCurrentUser(null);
                document.getElementById('deleteAccountModal').style.display = 'none';
                document.getElementById('appScreen').style.display = 'none';
                document.getElementById('loginScreen').style.display = 'block';
                alert('✅ Your account has been permanently deleted');
            } else { errorEl.textContent = data.message || 'Account deletion failed'; }
        } catch (error) { errorEl.textContent = 'Connection error: ' + error.message; }
    }

    window.showDeleteAccountModal = showDeleteAccountModal;
    window.closeDeleteAccountModal = closeDeleteAccountModal;
    window.deleteAccount = deleteAccount;

    // ==================== BALANCE ADJUSTMENTS ====================
    function showBalanceAdjustmentModal() {
        document.getElementById('balanceAdjustmentModal').style.display = 'flex';
        document.getElementById('adjustmentDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('adjustmentAL').value = '';
        document.getElementById('adjustmentSL').value = '';
        document.getElementById('adjustmentCL').value = '';
        document.getElementById('adjustmentCPL').value = '';
        document.getElementById('adjustmentOT').value = '';
        document.getElementById('adjustmentNote').value = '';
    }

    function closeBalanceAdjustmentModal() { document.getElementById('balanceAdjustmentModal').style.display = 'none'; }

    async function saveBalanceAdjustment() {
        const date = document.getElementById('adjustmentDate').value;
        let al = document.getElementById('adjustmentAL').value;
        let sl = document.getElementById('adjustmentSL').value;
        let cl = document.getElementById('adjustmentCL').value;
        let cpl = document.getElementById('adjustmentCPL').value;
        let ot = document.getElementById('adjustmentOT').value;
        const note = document.getElementById('adjustmentNote').value;
        
        al = al === '' ? 0 : parseFloat(al);
        sl = sl === '' ? 0 : parseFloat(sl);
        cl = cl === '' ? 0 : parseFloat(cl);
        cpl = cpl === '' ? 0 : parseFloat(cpl);
        ot = ot === '' ? 0 : parseFloat(ot);
        
        if (!date) { alert('Please select a date'); return; }
        if (ot !== 0 && !userSettings.has_ot) { alert('OT adjustments are disabled'); return; }
        if (cpl !== 0 && !userSettings.has_cpl) { alert('CPL adjustments are disabled'); return; }
        
        let entry = await window.fetchOrCreateEntry(date);
        entry.is_manual_adjustment = true;
        entry.check_in = null; entry.check_out = null;
        entry.base_hours_rule = null; entry.ot_cap_rule = null; entry.cpl_grant_rule = null;
        entry.final_ot_hours = null; entry.cpl_earned = null;
        entry.is_off_day = false; entry.is_holiday = false;
        
        entry.al_adjustment = (entry.al_adjustment || 0) + al;
        entry.sl_adjustment = (entry.sl_adjustment || 0) + sl;
        entry.cl_adjustment = (entry.cl_adjustment || 0) + cl;
        if (userSettings.has_cpl) entry.cpl_adjustment = (entry.cpl_adjustment || 0) + cpl;
        if (userSettings.has_ot) entry.ot_adjustment = (entry.ot_adjustment || 0) + ot;
        
        if (al > 0) entry.al_expiry_date = window.calculateALExpiry(date);
        else if (al <= 0) entry.al_expiry_date = null;
        
        if (userSettings.has_cpl && cpl > 0) entry.cpl_expiry_date = window.calculateCPLExpiry(date);
        else if (userSettings.has_cpl && cpl <= 0) entry.cpl_expiry_date = null;
        
        entry.adjustment_note = note;
        
        await window.saveAndSync(entry, false, true);
        closeBalanceAdjustmentModal();
        await loadBalances();
        await loadAdjustments();
        await loadExpiryInfo();
        alert('✅ Balance adjustment saved');
    }

    window.showBalanceAdjustmentModal = showBalanceAdjustmentModal;
    window.closeBalanceAdjustmentModal = closeBalanceAdjustmentModal;
    window.saveBalanceAdjustment = saveBalanceAdjustment;

    async function loadAdjustments() {
        if (!window.dbAPI || !getCurrentUser()) return;
        const entries = await window.dbAPI.getAllEntriesForUser(getCurrentUser().id);
        
        const adjustments = entries.filter(e => {
            const al = parseFloat(e.al_adjustment) || 0, sl = parseFloat(e.sl_adjustment) || 0;
            const cl = parseFloat(e.cl_adjustment) || 0, cpl = parseFloat(e.cpl_adjustment) || 0;
            const ot = parseFloat(e.ot_adjustment) || 0;
            return (e.adjustment_note && e.adjustment_note.length > 0) || al !== 0 || sl !== 0 || cl !== 0 || cpl !== 0 || ot !== 0;
        });
        
        const list = document.getElementById('adjustmentList');
        if (!list) return;
        list.innerHTML = '<h4>Manual Adjustments</h4>';
        
        if (adjustments.length === 0) { list.innerHTML += '<p class="no-adjustments">No manual adjustments found</p>'; return; }
        
        adjustments.sort((a, b) => new Date(b.date) - new Date(a.date));
        adjustments.slice(0, 20).forEach(adj => {
            const al = parseFloat(adj.al_adjustment) || 0, sl = parseFloat(adj.sl_adjustment) || 0;
            const cl = parseFloat(adj.cl_adjustment) || 0, cpl = parseFloat(adj.cpl_adjustment) || 0;
            const ot = parseFloat(adj.ot_adjustment) || 0;
            
            const details = [];
            if (al !== 0) details.push(`AL: ${al > 0 ? '+' : ''}${al.toFixed(2)}`);
            if (sl !== 0) details.push(`SL: ${sl > 0 ? '+' : ''}${sl.toFixed(2)}`);
            if (cl !== 0) details.push(`CL: ${cl > 0 ? '+' : ''}${cl.toFixed(2)}`);
            if (userSettings.has_cpl && cpl !== 0) details.push(`CPL: ${cpl > 0 ? '+' : ''}${cpl.toFixed(2)}`);
            if (userSettings.has_ot && ot !== 0) details.push(`OT: ${ot > 0 ? '+' : ''}${ot.toFixed(1)}`);
            
            const item = document.createElement('div');
            item.className = 'adjustment-item';
            item.innerHTML = `
                <div class="adjustment-date">${adj.date}</div>
                <div class="adjustment-details">${details.join(' | ')}</div>
                ${adj.adjustment_note ? `<div class="adjustment-note">📝 ${adj.adjustment_note}</div>` : ''}
                <div style="margin-top: 8px; display: flex; gap: 8px;">
                    <button class="edit-adjustment" data-date="${adj.date}" style="background: #667eea; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer;">Edit</button>
                    <button class="delete-adjustment" data-date="${adj.date}" style="background: #f44336; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer;">Delete</button>
                </div>
            `;
            
            item.querySelector('.edit-adjustment').onclick = () => {
                document.getElementById('adjustmentDate').value = adj.date;
                document.getElementById('adjustmentAL').value = al !== 0 ? al : '';
                document.getElementById('adjustmentSL').value = sl !== 0 ? sl : '';
                document.getElementById('adjustmentCL').value = cl !== 0 ? cl : '';
                document.getElementById('adjustmentCPL').value = cpl !== 0 ? cpl : '';
                document.getElementById('adjustmentOT').value = ot !== 0 ? ot : '';
                document.getElementById('adjustmentNote').value = adj.adjustment_note || '';
                document.getElementById('balanceAdjustmentModal').style.display = 'flex';
            };
            
            item.querySelector('.delete-adjustment').onclick = async () => {
                if (confirm(`Delete adjustment for ${adj.date}?`)) {
                    adj.al_adjustment = 0; adj.sl_adjustment = 0; adj.cl_adjustment = 0;
                    adj.cpl_adjustment = 0; adj.ot_adjustment = 0; adj.adjustment_note = '';
                    adj.is_manual_adjustment = true;
                    await window.saveAndSync(adj, false, true);
                    await loadAdjustments();
                    await loadBalances();
                    await loadExpiryInfo();
                }
            };
            list.appendChild(item);
        });
    }

    window.loadAdjustments = loadAdjustments;

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

    function closeInitialBalanceModal() { document.getElementById('initialBalanceModal').style.display = 'none'; }

    async function saveInitialBalances() {
        const date = document.getElementById('initialDate').value;
        const al = parseFloat(document.getElementById('initialAL').value) || 0;
        const sl = parseFloat(document.getElementById('initialSL').value) || 0;
        const cl = parseFloat(document.getElementById('initialCL').value) || 0;
        const cpl = parseFloat(document.getElementById('initialCPL').value) || 0;
        const ot = parseFloat(document.getElementById('initialOT').value) || 0;
        
        if (!date) { alert('Please select a start date'); return; }
        
        let entry = await window.fetchOrCreateEntry(date);
        entry.is_manual_adjustment = true;
        entry.check_in = null; entry.check_out = null;
        entry.base_hours_rule = null; entry.ot_cap_rule = null; entry.cpl_grant_rule = null;
        entry.final_ot_hours = null; entry.cpl_earned = null;
        entry.is_off_day = false; entry.is_holiday = false;
        
        if (al !== 0) entry.al_adjustment = (entry.al_adjustment || 0) + al;
        if (sl !== 0) entry.sl_adjustment = (entry.sl_adjustment || 0) + sl;
        if (cl !== 0) entry.cl_adjustment = (entry.cl_adjustment || 0) + cl;
        if (cpl !== 0 && userSettings.has_cpl) entry.cpl_adjustment = (entry.cpl_adjustment || 0) + cpl;
        if (ot !== 0 && userSettings.has_ot) entry.ot_adjustment = (entry.ot_adjustment || 0) + ot;
        
        if (al > 0) entry.al_expiry_date = window.calculateALExpiry(date);
        if (cpl > 0 && userSettings.has_cpl) entry.cpl_expiry_date = window.calculateCPLExpiry(date);
        
        entry.adjustment_note = 'Initial balance setup';
        await window.saveAndSync(entry, false, true);
        closeInitialBalanceModal();
        alert('✅ Initial balances set successfully');
        await loadBalances();
        await loadAdjustments();
        await loadExpiryInfo();
    }

    window.showInitialBalanceModal = showInitialBalanceModal;
    window.closeInitialBalanceModal = closeInitialBalanceModal;
    window.saveInitialBalances = saveInitialBalances;

    // ==================== RESET ALL DATA ====================
    async function resetAllData() {
        if (!confirm('⚠️ WARNING: This will DELETE ALL your data from both local device AND cloud. Are you absolutely sure?')) return;
        const confirmText = prompt('Type "RESET" to confirm permanent deletion of all your data:');
        if (confirmText !== 'RESET') { alert('Reset cancelled'); return; }
        
        try {
            if (getAuthToken() && navigator.onLine) {
                const response = await fetch('/api/account?action=reset-data', {
                    method: 'DELETE', headers: { 'Authorization': `Bearer ${getAuthToken()}` }
                });
                if (!response.ok) throw new Error('Failed to delete cloud data');
            }
            if (window.dbAPI) await window.dbAPI.clearAllData();
            localStorage.removeItem('weeklyTemplate');
            localStorage.removeItem('lastAlarmReset');
            localStorage.removeItem('push_subscription_status');
            
            const defaultTemplate = {
                monday: { base: 8, maxOT: 1, cpl: 0 }, tuesday: { base: 8, maxOT: 1, cpl: 0 },
                wednesday: { base: 8, maxOT: 1, cpl: 0 }, thursday: { base: 8, maxOT: 1, cpl: 0 },
                friday: { base: 8.5, maxOT: 1, cpl: 0 }, saturday: { base: 8, maxOT: 1, cpl: 1 },
                sundayOdd: { base: 8, maxOT: 0, cpl: 1.0, isHoliday: true },
                sundayEven: { base: 6, maxOT: 0, cpl: 0.5, isHoliday: true }
            };
            weeklyTemplate = defaultTemplate;
            setWeeklyTemplate(defaultTemplate);
            
            document.getElementById('checkInDisplay').textContent = '--:--';
            document.getElementById('checkOutDisplay').textContent = '--:--';
            const today = new Date().toISOString().split('T')[0];
            await window.fetchOrCreateEntry(today);
            await loadBalances();
            await loadAdjustments();
            await loadExpiryInfo();
            alert('✅ All data has been reset (local + cloud)');
        } catch (error) { alert('Error resetting data: ' + error.message); }
    }

    window.resetAllData = resetAllData;

    // ==================== RECALCULATE ALL ====================
    async function recalculateAll() {
        if (!confirm('This will HARD RESET all calculations and re-run the Strict Overrider on every entry. Continue?')) return;
        if (!getCurrentUser() || !window.dbAPI) { alert('Please login first'); return; }
        if (!navigator.onLine) { alert('You need to be online to fetch cloud data for recalculation'); return; }
        
        try {
            const progressDiv = document.createElement('div');
            progressDiv.className = 'progress-bar';
            progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;padding:20px;background:white;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.2);';
            document.body.appendChild(progressDiv);
            
            progressDiv.innerHTML = 'Fetching all cloud entries...';
            const response = await fetch('/api/sync?direction=from&recalc=true', {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            });
            const data = await response.json();
            
            if (data.success && data.entries) {
                progressDiv.innerHTML = `Downloaded ${data.entries.length} cloud entries. Processing...`;
                for (const entry of data.entries) {
                    if (entry.date && entry.date.includes('T')) entry.date = entry.date.split('T')[0];
                    if (entry.check_in && entry.check_in.includes('T')) {
                        const utcDate = new Date(entry.check_in);
                        entry.check_in = `${utcDate.getFullYear()}-${String(utcDate.getMonth()+1).padStart(2,'0')}-${String(utcDate.getDate()).padStart(2,'0')} ${String(utcDate.getHours()).padStart(2,'0')}:${String(utcDate.getMinutes()).padStart(2,'0')}:${String(utcDate.getSeconds()).padStart(2,'0')}`;
                    }
                    if (entry.check_out && entry.check_out.includes('T')) {
                        const utcDate = new Date(entry.check_out);
                        entry.check_out = `${utcDate.getFullYear()}-${String(utcDate.getMonth()+1).padStart(2,'0')}-${String(utcDate.getDate()).padStart(2,'0')} ${String(utcDate.getHours()).padStart(2,'0')}:${String(utcDate.getMinutes()).padStart(2,'0')}:${String(utcDate.getSeconds()).padStart(2,'0')}`;
                    }
                    entry.user_id = getCurrentUser().id;
                    entry.sync_status = 'synced';
                    await window.dbAPI.saveEntry(entry);
                }
            }
            
            const entries = await window.dbAPI.getAllEntriesForUser(getCurrentUser().id);
            let count = 0;
            for (const entry of entries) {
                count++;
                progressDiv.innerHTML = `Processing ${count}/${entries.length}<br>Entry: ${entry.date}`;
                const overriddenEntry = await window.strictOverrider(entry, false);
                await window.dbAPI.saveEntry(overriddenEntry);
                if (count % 10 === 0) await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            progressDiv.innerHTML = 'Running FIFO Matchmaker...';
            const allEntries = await window.dbAPI.getAllEntriesForUser(getCurrentUser().id);
            calculateFIFOBalance(allEntries, new Date());
            
            if (navigator.onLine && typeof batchSyncToCloud === 'function') {
                progressDiv.innerHTML = 'Syncing to cloud...';
                await batchSyncToCloud();
            }
            
            document.body.removeChild(progressDiv);
            await loadBalances();
            await loadExpiryInfo();
            await loadAdjustments();
            alert('✅ All entries have been recalculated with cloud data and synced');
        } catch (error) {
            alert('Error recalculating: ' + error.message);
            const progressDiv = document.querySelector('.progress-bar');
            if (progressDiv) progressDiv.remove();
        }
    }

    window.recalculateAll = recalculateAll;

    // ==================== BATCH SYNC ====================
    async function batchSyncToCloud() {
        if (!getAuthToken() || !getCurrentUser()) { alert('Please login first'); return; }
        if (!navigator.onLine) { window.addDebugLog('Offline - cannot sync to cloud', 'warning'); return; }
        
        const syncOutBtn = document.querySelector('.sync-out');
        const originalText = syncOutBtn ? syncOutBtn.innerHTML : 'SYNC OUT';
        if (syncOutBtn) { syncOutBtn.innerHTML = '<span class="sync-icon">⏳</span> SYNCING...'; syncOutBtn.disabled = true; }
        
        try {
            const pendingEntries = await window.dbAPI.getEntriesNeedingSync(100);
            if (pendingEntries.length === 0) return;
            
            for (let i = 0; i < pendingEntries.length; i++) {
                const entry = pendingEntries[i];
                if (syncOutBtn) syncOutBtn.innerHTML = `<span class="sync-icon">⏳</span> ${i+1}/${pendingEntries.length}`;
                
                let checkInUTC = null, checkOutUTC = null;
                if (entry.check_in) {
                    let checkInStr = entry.check_in;
                    if (checkInStr.includes('T')) checkInStr = checkInStr.replace('T', ' ');
                    const [datePart, timePart] = checkInStr.split(' ');
                    const [hours, minutes, seconds] = timePart.split(':').map(Number);
                    const [year, month, day] = datePart.split('-').map(Number);
                    const localDate = new Date(year, month - 1, day, hours, minutes, seconds || 0);
                    checkInUTC = localDate.toISOString();
                }
                if (entry.check_out) {
                    let checkOutStr = entry.check_out;
                    if (checkOutStr.includes('T')) checkOutStr = checkOutStr.replace('T', ' ');
                    const [datePart, timePart] = checkOutStr.split(' ');
                    const [hours, minutes, seconds] = timePart.split(':').map(Number);
                    const [year, month, day] = datePart.split('-').map(Number);
                    const localDate = new Date(year, month - 1, day, hours, minutes, seconds || 0);
                    checkOutUTC = localDate.toISOString();
                }
                
                const cleanEntry = {
                    date: entry.date, check_in: checkInUTC, check_out: checkOutUTC,
                    base_hours_rule: entry.is_manual_adjustment ? null : (entry.base_hours_rule || null),
                    ot_cap_rule: entry.is_manual_adjustment ? null : (entry.ot_cap_rule || null),
                    cpl_grant_rule: entry.is_manual_adjustment ? null : (entry.cpl_grant_rule || null),
                    final_ot_hours: entry.final_ot_hours || null, cpl_earned: entry.cpl_earned || null,
                    al_used: parseFloat(entry.al_used) || 0, sl_used: parseFloat(entry.sl_used) || 0,
                    cl_used: parseFloat(entry.cl_used) || 0, cpl_used: parseFloat(entry.cpl_used) || 0,
                    is_off_day: entry.is_off_day || false, is_holiday: entry.is_holiday || false,
                    al_accrued: entry.al_accrued || 0, al_adjustment: parseFloat(entry.al_adjustment) || 0,
                    sl_adjustment: parseFloat(entry.sl_adjustment) || 0, cl_adjustment: parseFloat(entry.cl_adjustment) || 0,
                    al_expiry_date: entry.al_expiry_date || null, cpl_adjustment: parseFloat(entry.cpl_adjustment) || 0,
                    cpl_expiry_date: entry.cpl_expiry_date || null, ot_adjustment: parseFloat(entry.ot_adjustment) || 0,
                    adjustment_note: entry.adjustment_note || ''
                };
                
                const response = await fetch('/api/sync?direction=to', {
                    method: 'POST', headers: { 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entries: [cleanEntry] })
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.syncedIds && data.syncedIds.length > 0) {
                        await window.dbAPI.markAsSynced([entry.date]);
                    }
                }
            }
            window.updateLastSyncTime();
        } catch (error) {
            window.addDebugLog(`Batch sync error: ${error.message}`, 'error');
        } finally {
            if (syncOutBtn) { syncOutBtn.innerHTML = originalText; syncOutBtn.disabled = false; }
        }
    }

    window.batchSyncToCloud = batchSyncToCloud;

    async function syncToCloud() { try { await batchSyncToCloud(); } catch (error) { alert('Sync failed: ' + error.message); } }
    async function syncFromCloud() { alert('Sync from cloud: Use Recalculate All button for full sync'); }

    window.syncToCloud = syncToCloud;
    window.syncFromCloud = syncFromCloud;

    // ==================== TAB NAVIGATION ====================
    function switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');
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
        if (tabName === 'balance') { loadBalances(); loadExpiryInfo(); }
        if (tabName === 'schedule') loadTemplateToUI();
        if (tabName === 'settings') {
            const settingsUserEmail = document.getElementById('settingsUserEmail');
            const settingsUserID = document.getElementById('settingsUserID');
            if (settingsUserEmail && getCurrentUser()) settingsUserEmail.textContent = getCurrentUser().email || '';
            if (settingsUserID && getCurrentUser()) settingsUserID.textContent = getCurrentUser().id || '';
            loadAdjustments();
            loadExpiryInfo();
            setupCollapsibleSections();
        }
    }

    window.switchTab = switchTab;

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

    window.setupCollapsibleSections = setupCollapsibleSections;

    // ==================== USER SETTINGS SAVE ====================
    async function saveUserSettingsAndApply() {
        const statusEl = document.getElementById('settingsSaveStatus');
        if (statusEl) { statusEl.textContent = 'Saving settings...'; statusEl.style.color = '#666'; }
        
        userSettings.has_ot = document.getElementById('userHasOT')?.checked || false;
        userSettings.has_cpl = document.getElementById('userHasCPL')?.checked || false;
        userSettings.limit_annual = parseInt(document.getElementById('userLimitAnnual')?.value) || 0;
        userSettings.limit_casual = parseInt(document.getElementById('userLimitCasual')?.value) || 0;
        userSettings.limit_sick = parseInt(document.getElementById('userLimitSick')?.value) || 0;
        setUserSettings(userSettings);
        
        if (getAuthToken() && navigator.onLine) {
            try {
                const response = await fetch('/api/account?action=update-settings', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
                    body: JSON.stringify(userSettings)
                });
                if (response.ok) {
                    const currentUser = getCurrentUser();
                    if (currentUser) {
                        currentUser.has_ot = userSettings.has_ot;
                        currentUser.has_cpl = userSettings.has_cpl;
                        currentUser.limit_annual = userSettings.limit_annual;
                        currentUser.limit_casual = userSettings.limit_casual;
                        currentUser.limit_sick = userSettings.limit_sick;
                        setCurrentUser(currentUser);
                        localStorage.setItem('auth_user', JSON.stringify(currentUser));
                    }
                }
            } catch (error) {}
        }
        
        window.applyUserPermissions();
        if (statusEl) { statusEl.textContent = '✓ Settings saved successfully!'; statusEl.style.color = '#4caf50'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
        await loadBalances();
        await loadExpiryInfo();
        alert('Settings saved successfully!');
    }

    function resetUserSettingsToDefault() {
        if (confirm('Reset all customization to default values? (OT: ON, CPL: ON, AL:22, CL:10, SL:10)')) {
            userSettings = { has_ot: true, has_cpl: true, limit_annual: 22, limit_casual: 10, limit_sick: 10 };
            setUserSettings(userSettings);
            window.updateSettingsUI();
            saveUserSettingsAndApply();
        }
    }

    window.saveUserSettingsAndApply = saveUserSettingsAndApply;
    window.resetUserSettingsToDefault = resetUserSettingsToDefault;

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

    window.toggleEntryOptions = toggleEntryOptions;

    window.addDebugLog('app-extended.js: Loading complete', 'success');
})();