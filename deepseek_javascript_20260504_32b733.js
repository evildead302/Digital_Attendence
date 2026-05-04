// ==================== EXPORT.JS - ATTENDANCE DATA EXPORT UTILITY ====================
(function() {
    'use strict';
    
    window.addDebugLog = window.addDebugLog || function(msg, type) {
        console.log(`[${type}] ${msg}`);
    };
    
    // ==================== EXPORT ATTENDANCE DATA TO CSV ====================
    window.exportAttendanceToCSV = async function(year) {
        if (!year) {
            window.addDebugLog('[Export] No year specified for export', 'error');
            alert('Please select a year to export');
            return;
        }
        
        window.addDebugLog(`[Export] Exporting attendance data for year: ${year}`, 'info');
        
        try {
            // Get auth token from localStorage
            const authToken = localStorage.getItem('auth_token');
            const userStr = localStorage.getItem('auth_user');
            
            if (!authToken || !userStr) {
                window.addDebugLog('[Export] User not authenticated', 'error');
                alert('Please login first');
                return;
            }
            
            const user = JSON.parse(userStr);
            
            // Fetch entries from local database first
            let entries = [];
            if (window.dbAPI && user.id) {
                try {
                    const allEntries = await window.dbAPI.getAllEntriesForUser(user.id);
                    entries = allEntries.filter(e => {
                        const entryYear = new Date(e.date).getFullYear();
                        return entryYear === parseInt(year);
                    });
                    window.addDebugLog(`[Export] Found ${entries.length} entries for year ${year} in local DB`, 'success');
                } catch (dbError) {
                    window.addDebugLog(`[Export] Error reading from local DB: ${dbError.message}`, 'warning');
                }
            }
            
            // If no entries found locally, try cloud API
            if (entries.length === 0) {
                window.addDebugLog(`[Export] No local entries, fetching from cloud API...`, 'info');
                
                const response = await fetch(`/api/export?year=${year}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.success && data.csv) {
                    // Download the CSV directly from server
                    downloadCSV(data.csv, `attendance_${year}_${user.email}.csv`);
                    window.addDebugLog(`[Export] CSV exported successfully from cloud for year ${year}`, 'success');
                    alert(`✅ Attendance data for ${year} exported successfully!`);
                    return;
                } else {
                    throw new Error(data.message || 'No data found for the selected year');
                }
            }
            
            // Generate CSV from local entries
            const csvContent = generateCSVFromEntries(entries, user);
            downloadCSV(csvContent, `attendance_${year}_${user.email}.csv`);
            
            window.addDebugLog(`[Export] CSV generated and downloaded from local data for year ${year}`, 'success');
            alert(`✅ Attendance data for ${year} exported successfully!`);
            
        } catch (error) {
            window.addDebugLog(`[Export] Export failed: ${error.message}`, 'error');
            alert('Failed to export data: ' + error.message);
        }
    };
    
    // ==================== GENERATE CSV FROM ENTRIES ====================
    function generateCSVFromEntries(entries, user) {
        window.addDebugLog(`[Export] Generating CSV from ${entries.length} entries`, 'info');
        
        // Define CSV headers
        const headers = [
            'Date',
            'Day of Week',
            'Check In',
            'Check Out',
            'Base Hours',
            'OT Hours (Final)',
            'OT Cap Rule',
            'CPL Earned',
            'CPL Grant Rule',
            'Annual Leave Used',
            'Sick Leave Used',
            'Casual Leave Used',
            'CPL Used',
            'Is Holiday',
            'Is Off Day',
            'Is Manual Adjustment',
            'AL Accrued',
            'AL Adjustment',
            'SL Adjustment',
            'CL Adjustment',
            'CPL Adjustment',
            'OT Adjustment',
            'AL Expiry Date',
            'CPL Expiry Date',
            'Adjustment Note',
            'Sync Status'
        ];
        
        // Create CSV rows
        const rows = [];
        rows.push(headers.join(','));
        
        // Sort entries by date
        const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (const entry of sortedEntries) {
            const entryDate = new Date(entry.date);
            const dayOfWeek = entryDate.toLocaleDateString('en-US', { weekday: 'long' });
            
            // Format times for CSV (remove timezone info)
            let checkIn = entry.check_in || '';
            let checkOut = entry.check_out || '';
            
            if (checkIn) {
                checkIn = checkIn.replace('T', ' ').split('.')[0];
            }
            if (checkOut) {
                checkOut = checkOut.replace('T', ' ').split('.')[0];
            }
            
            const row = [
                escapeCSV(entry.date),
                escapeCSV(dayOfWeek),
                escapeCSV(checkIn),
                escapeCSV(checkOut),
                entry.base_hours_rule !== null ? entry.base_hours_rule : '',
                entry.final_ot_hours !== null ? entry.final_ot_hours : '',
                entry.ot_cap_rule !== null ? entry.ot_cap_rule : '',
                entry.cpl_earned !== null ? entry.cpl_earned : '',
                entry.cpl_grant_rule !== null ? entry.cpl_grant_rule : '',
                entry.al_used || 0,
                entry.sl_used || 0,
                entry.cl_used || 0,
                entry.cpl_used || 0,
                entry.is_holiday ? 'Yes' : 'No',
                entry.is_off_day ? 'Yes' : 'No',
                entry.is_manual_adjustment ? 'Yes' : 'No',
                entry.al_accrued || 0,
                entry.al_adjustment || 0,
                entry.sl_adjustment || 0,
                entry.cl_adjustment || 0,
                entry.cpl_adjustment || 0,
                entry.ot_adjustment || 0,
                entry.al_expiry_date || '',
                entry.cpl_expiry_date || '',
                escapeCSV(entry.adjustment_note || ''),
                entry.sync_status || ''
            ];
            
            rows.push(row.join(','));
        }
        
        // Add summary section
        rows.push('');
        rows.push('"=== SUMMARY ==="');
        rows.push(`"User Email",${escapeCSV(user?.email || '')}`);
        rows.push(`"User Name",${escapeCSV(user?.name || '')}`);
        rows.push(`"Export Date",${escapeCSV(new Date().toLocaleString())}`);
        rows.push(`"Total Entries",${entries.length}`);
        
        // Calculate summary statistics
        let totalOT = 0;
        let totalCPL = 0;
        let totalAnnualLeave = 0;
        let totalSickLeave = 0;
        let totalCasualLeave = 0;
        let totalCPLUsed = 0;
        let totalALAccrued = 0;
        let totalALAdjustment = 0;
        let totalCPLAdjustment = 0;
        let totalOTAdjustment = 0;
        let daysWorked = 0;
        
        for (const entry of entries) {
            if (entry.final_ot_hours) totalOT += parseFloat(entry.final_ot_hours);
            if (entry.cpl_earned) totalCPL += parseFloat(entry.cpl_earned);
            if (entry.al_used) totalAnnualLeave += parseFloat(entry.al_used);
            if (entry.sl_used) totalSickLeave += parseFloat(entry.sl_used);
            if (entry.cl_used) totalCasualLeave += parseFloat(entry.cl_used);
            if (entry.cpl_used) totalCPLUsed += parseFloat(entry.cpl_used);
            if (entry.al_accrued) totalALAccrued += parseFloat(entry.al_accrued);
            if (entry.al_adjustment) totalALAdjustment += parseFloat(entry.al_adjustment);
            if (entry.cpl_adjustment) totalCPLAdjustment += parseFloat(entry.cpl_adjustment);
            if (entry.ot_adjustment) totalOTAdjustment += parseFloat(entry.ot_adjustment);
            
            // Count days worked (has check-in OR is holiday with work)
            if (entry.check_in && !entry.is_off_day && !(entry.al_used > 0 || entry.sl_used > 0 || entry.cl_used > 0)) {
                daysWorked++;
            }
        }
        
        rows.push(`"Total Days Worked",${daysWorked}`);
        rows.push(`"Total OT Hours",${totalOT.toFixed(1)}`);
        rows.push(`"Total OT Adjustment",${totalOTAdjustment.toFixed(1)}`);
        rows.push(`"Total CPL Earned",${totalCPL.toFixed(2)}`);
        rows.push(`"Total CPL Adjustment",${totalCPLAdjustment.toFixed(2)}`);
        rows.push(`"Total Annual Leave Used",${totalAnnualLeave.toFixed(2)}`);
        rows.push(`"Total Sick Leave Used",${totalSickLeave.toFixed(2)}`);
        rows.push(`"Total Casual Leave Used",${totalCasualLeave.toFixed(2)}`);
        rows.push(`"Total CPL Used",${totalCPLUsed.toFixed(2)}`);
        rows.push(`"Total AL Accrued",${totalALAccrued.toFixed(2)}`);
        rows.push(`"Total AL Adjustment",${totalALAdjustment.toFixed(2)}`);
        
        return rows.join('\n');
    }
    
    // ==================== DOWNLOAD CSV FILE ====================
    function downloadCSV(csvContent, filename) {
        // Add UTF-8 BOM for proper Unicode support
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        window.addDebugLog(`[Export] File downloaded: ${filename}`, 'success');
    }
    
    // ==================== ESCAPE CSV FIELD ====================
    function escapeCSV(field) {
        if (field === undefined || field === null) {
            return '';
        }
        
        const stringField = String(field);
        
        // If field contains comma, newline, or double quote, wrap in double quotes
        if (stringField.includes(',') || stringField.includes('\n') || stringField.includes('"')) {
            // Replace double quotes with two double quotes
            return '"' + stringField.replace(/"/g, '""') + '"';
        }
        
        return stringField;
    }
    
    // ==================== GET AVAILABLE YEARS FOR EXPORT ====================
    window.getAvailableYearsForExport = async function() {
        window.addDebugLog('[Export] Getting available years for export', 'info');
        
        try {
            const authToken = localStorage.getItem('auth_token');
            const userStr = localStorage.getItem('auth_user');
            
            if (!authToken || !userStr) {
                return [];
            }
            
            const user = JSON.parse(userStr);
            const years = new Set();
            const currentYear = new Date().getFullYear();
            
            // Add current year and previous 5 years
            for (let i = -5; i <= 1; i++) {
                years.add(currentYear + i);
            }
            
            // Try to get actual years from data
            if (window.dbAPI && user.id) {
                try {
                    const allEntries = await window.dbAPI.getAllEntriesForUser(user.id);
                    for (const entry of allEntries) {
                        const entryYear = new Date(entry.date).getFullYear();
                        years.add(entryYear);
                    }
                } catch (dbError) {
                    window.addDebugLog(`[Export] Error reading years from DB: ${dbError.message}`, 'warning');
                }
            }
            
            const sortedYears = Array.from(years).sort((a, b) => b - a);
            window.addDebugLog(`[Export] Available years: ${sortedYears.join(', ')}`, 'info');
            
            return sortedYears;
            
        } catch (error) {
            window.addDebugLog(`[Export] Error getting available years: ${error.message}`, 'error');
            return [new Date().getFullYear()];
        }
    };
    
    // ==================== POPULATE YEAR DROPDOWN ====================
    window.populateExportYearDropdown = async function() {
        window.addDebugLog('[Export] Populating year dropdown', 'info');
        
        const yearSelect = document.getElementById('exportYear');
        if (!yearSelect) {
            window.addDebugLog('[Export] Year select element not found', 'warning');
            return;
        }
        
        try {
            const years = await window.getAvailableYearsForExport();
            const currentYear = new Date().getFullYear();
            
            yearSelect.innerHTML = '';
            for (const year of years) {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                option.selected = (year === currentYear);
                yearSelect.appendChild(option);
            }
            
            window.addDebugLog(`[Export] Year dropdown populated with ${years.length} years`, 'success');
        } catch (error) {
            window.addDebugLog(`[Export] Failed to populate year dropdown: ${error.message}`, 'error');
            
            // Fallback: add current year only
            yearSelect.innerHTML = '';
            const option = document.createElement('option');
            option.value = currentYear;
            option.textContent = currentYear;
            yearSelect.appendChild(option);
        }
    };
    
    // ==================== EXPORT MONTHLY REPORT ====================
    window.exportMonthlyReport = async function(year, month) {
        window.addDebugLog(`[Export] Exporting monthly report for ${year}-${month}`, 'info');
        
        try {
            const authToken = localStorage.getItem('auth_token');
            const userStr = localStorage.getItem('auth_user');
            
            if (!authToken || !userStr) {
                alert('Please login first');
                return;
            }
            
            const user = JSON.parse(userStr);
            
            // Get entries for the specific month
            let entries = [];
            if (window.dbAPI && user.id) {
                const allEntries = await window.dbAPI.getAllEntriesForUser(user.id);
                entries = allEntries.filter(e => {
                    const entryDate = new Date(e.date);
                    return entryDate.getFullYear() === parseInt(year) && 
                           entryDate.getMonth() === parseInt(month);
                });
            }
            
            if (entries.length === 0) {
                alert(`No data found for ${year}-${parseInt(month) + 1}`);
                return;
            }
            
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthName = monthNames[parseInt(month)];
            const csvContent = generateCSVFromEntries(entries, user);
            downloadCSV(csvContent, `attendance_${year}_${monthName}_${user.email}.csv`);
            
            window.addDebugLog(`[Export] Monthly report exported successfully`, 'success');
            alert(`✅ Monthly report for ${monthName} ${year} exported successfully!`);
            
        } catch (error) {
            window.addDebugLog(`[Export] Monthly export failed: ${error.message}`, 'error');
            alert('Failed to export monthly report: ' + error.message);
        }
    };
    
    window.addDebugLog('[Export] expense.js loaded successfully', 'success');
})();