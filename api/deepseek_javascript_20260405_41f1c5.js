// ==================== OTP VARIABLES ====================
let otpTimerInterval = null;
let currentOTPData = null;
let verificationPurpose = null; // 'register' or 'reset'
let pendingEmail = null;

// ==================== OTP FUNCTIONS ====================

// Show OTP verification modal
function showOTPModal(otpData, purpose, email) {
    window.addDebugLog(`========== SHOW OTP MODAL START ==========`, 'info');
    window.addDebugLog(`Purpose: ${purpose}, Email: ${email}`, 'info');
    window.addDebugLog(`OTP Data:`, 'debug');
    window.addDebugLog(`  otpCode: ${otpData.otpCode}`, 'debug');
    window.addDebugLog(`  appEmail: ${otpData.appEmail}`, 'debug');
    window.addDebugLog(`  expiry: ${otpData.expiry}`, 'debug');
    
    currentOTPData = otpData;
    verificationPurpose = purpose;
    pendingEmail = email;
    
    // Update modal content
    document.getElementById('appEmailDisplay').textContent = otpData.appEmail;
    document.getElementById('otpCodeDisplay').textContent = otpData.otpCode;
    
    // Calculate remaining time
    const expiry = new Date(otpData.expiry);
    const now = new Date();
    const remainingSeconds = Math.max(0, Math.floor((expiry - now) / 1000));
    window.addDebugLog(`OTP expiry: ${expiry.toISOString()}, remaining: ${remainingSeconds} seconds`, 'info');
    
    startOTPTimer(expiry);
    
    // Show modal
    document.getElementById('otpModal').style.display = 'flex';
    window.addDebugLog(`OTP modal shown for purpose: ${purpose}`, 'success');
    window.addDebugLog(`========== SHOW OTP MODAL END ==========`, 'info');
}

// Start OTP countdown timer
function startOTPTimer(expiryDate) {
    if (otpTimerInterval) clearInterval(otpTimerInterval);
    
    window.addDebugLog(`Starting OTP timer, expires at: ${expiryDate.toISOString()}`, 'info');
    
    function updateTimer() {
        const now = new Date();
        const diff = expiryDate - now;
        
        if (diff <= 0) {
            window.addDebugLog(`OTP timer expired`, 'warning');
            const timerEl = document.getElementById('otpTimer');
            const verifyBtn = document.getElementById('verifyOtpBtn');
            if (timerEl) {
                timerEl.textContent = '00:00';
                timerEl.classList.add('expired');
            }
            if (verifyBtn) {
                verifyBtn.disabled = true;
                verifyBtn.style.opacity = '0.5';
            }
            clearInterval(otpTimerInterval);
            return;
        }
        
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        const timerEl = document.getElementById('otpTimer');
        const verifyBtn = document.getElementById('verifyOtpBtn');
        
        if (timerEl) {
            timerEl.textContent = timeStr;
            timerEl.classList.remove('expired');
        }
        if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.style.opacity = '1';
        }
    }
    
    updateTimer();
    otpTimerInterval = setInterval(updateTimer, 1000);
}

// Close OTP modal
function closeOTPModal() {
    window.addDebugLog(`Closing OTP modal - Purpose: ${verificationPurpose}, Email: ${pendingEmail}`, 'info');
    
    const modal = document.getElementById('otpModal');
    if (modal) modal.style.display = 'none';
    
    if (otpTimerInterval) {
        clearInterval(otpTimerInterval);
        otpTimerInterval = null;
        window.addDebugLog('OTP timer cleared', 'info');
    }
    
    // Clear global variables
    currentOTPData = null;
    verificationPurpose = null;
    pendingEmail = null;
    
    const errorEl = document.getElementById('otpError');
    if (errorEl) errorEl.textContent = '';
}

// Copy OTP to clipboard
function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const text = element.textContent;
    window.addDebugLog(`Copying to clipboard: ${text}`, 'info');
    
    navigator.clipboard.writeText(text).then(() => {
        window.addDebugLog(`Successfully copied to clipboard`, 'success');
        alert('OTP copied to clipboard!');
    }).catch(err => {
        window.addDebugLog(`Failed to copy: ${err.message}`, 'error');
        alert('Failed to copy. Please select and copy manually.');
    });
}

// Open email client
function openMailClient() {
    if (!currentOTPData) {
        window.addDebugLog('openMailClient: No OTP data available', 'error');
        return;
    }
    
    const subject = encodeURIComponent(currentOTPData.otpCode);
    const to = currentOTPData.appEmail;
    const body = encodeURIComponent(
        `Please verify my email for Attendance Diary App.\n\n` +
        `OTP: ${currentOTPData.otpCode}\n\n` +
        `Sent from my Attendance Diary account.`
    );
    
    window.addDebugLog(`Opening mail client to: ${to}, subject: ${currentOTPData.otpCode}`, 'info');
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
}

// ==================== VERIFY OTP - MAIN FUNCTION ====================
async function verifyOTP() {
    window.addDebugLog(`========== VERIFY OTP START ==========`, 'info');
    window.addDebugLog(`Current OTP Data exists: ${!!currentOTPData}`, 'info');
    window.addDebugLog(`Pending Email: ${pendingEmail}`, 'info');
    window.addDebugLog(`Verification Purpose: ${verificationPurpose}`, 'info');
    
    // Validate
    if (!currentOTPData || !pendingEmail || !verificationPurpose) {
        const errorMsg = !currentOTPData ? 'Missing OTP data' : (!pendingEmail ? 'Missing email' : 'Missing purpose');
        window.addDebugLog(`Validation failed: ${errorMsg}`, 'error');
        const errorEl = document.getElementById('otpError');
        if (errorEl) errorEl.textContent = 'Verification data missing. Please try again.';
        return;
    }
    
    // Clear error and disable button
    const errorEl = document.getElementById('otpError');
    const verifyBtn = document.getElementById('verifyOtpBtn');
    if (errorEl) errorEl.textContent = '';
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
    }
    
    window.addDebugLog(`Sending verification request...`, 'info');
    window.addDebugLog(`  Email: ${pendingEmail}`, 'debug');
    window.addDebugLog(`  OTP: ${currentOTPData.otpCode}`, 'debug');
    window.addDebugLog(`  Purpose: ${verificationPurpose}`, 'debug');
    
    try {
        const response = await fetch('/api/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: pendingEmail,
                otpCode: currentOTPData.otpCode,
                purpose: verificationPurpose
            })
        });
        
        window.addDebugLog(`Response status: ${response.status}`, 'info');
        const data = await response.json();
        window.addDebugLog(`Response data: ${JSON.stringify(data)}`, 'debug');
        
        if (data.success) {
            // CRITICAL: Save values BEFORE closing modal
            const verifiedEmail = pendingEmail;
            const verifiedPurpose = verificationPurpose;
            
            window.addDebugLog(`✅ OTP verified successfully for ${verifiedEmail}`, 'success');
            window.addDebugLog(`Purpose: ${verifiedPurpose}`, 'info');
            
            // Close OTP modal (this clears globals)
            closeOTPModal();
            
            // Handle based on purpose
            if (verifiedPurpose === 'register') {
                window.addDebugLog('Registration verified - showing login screen', 'success');
                alert('✅ Email verified successfully! You can now login.');
                showLogin();
            } 
            else if (verifiedPurpose === 'reset') {
                window.addDebugLog('Password reset verified - showing reset password modal', 'success');
                setTimeout(() => {
                    showResetPasswordModal(verifiedEmail);
                }, 200);
            }
            else {
                window.addDebugLog(`Unknown purpose: ${verifiedPurpose}`, 'warning');
                alert('Verification successful!');
            }
        } 
        else {
            // Handle verification failure
            let errorMsg = data.message || 'Verification failed. Please try again.';
            window.addDebugLog(`❌ Verification failed: ${errorMsg}`, 'error');
            if (errorEl) errorEl.textContent = errorMsg;
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.textContent = "I've Sent the Email";
            }
        }
    } 
    catch (error) {
        window.addDebugLog(`❌ Verification error: ${error.message}`, 'error');
        if (errorEl) errorEl.textContent = 'Network error. Please check your connection and try again.';
        if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.textContent = "I've Sent the Email";
        }
    }
    
    window.addDebugLog(`========== VERIFY OTP END ==========`, 'info');
}

// ==================== RESET PASSWORD MODAL FUNCTIONS ====================

// Show reset password modal
function showResetPasswordModal(email) {
    window.addDebugLog(`========== SHOW RESET PASSWORD MODAL START ==========`, 'info');
    window.addDebugLog(`Email for password reset: ${email}`, 'info');
    
    if (!email) {
        window.addDebugLog('ERROR: No email provided', 'error');
        alert('Error: No email found. Please try again.');
        return;
    }
    
    // Remove existing modal if present
    const existingModal = document.getElementById('resetPasswordModal');
    if (existingModal) {
        existingModal.remove();
        window.addDebugLog('Removed existing modal', 'debug');
    }
    
    // Create modal HTML
    const modalHtml = `
        <div id="resetPasswordModal" class="modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001;">
            <div class="modal-content" style="background: white; border-radius: 16px; padding: 24px; max-width: 400px; width: 90%; margin: auto; position: relative; top: 50%; transform: translateY(-50%);">
                <h3 style="margin: 0 0 8px 0; color: #333; font-size: 20px;">🔐 Reset Password</h3>
                <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
                    Set a new password for<br>
                    <strong style="color: #667eea; word-break: break-all;">${escapeHtml(email)}</strong>
                </p>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; color: #555; font-size: 14px; font-weight: 500;">New Password</label>
                    <input type="password" id="resetNewPassword" placeholder="Enter new password (min 6 characters)" style="width: 100%; padding: 14px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 15px; box-sizing: border-box;">
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; color: #555; font-size: 14px; font-weight: 500;">Confirm Password</label>
                    <input type="password" id="resetConfirmPassword" placeholder="Re-enter new password" style="width: 100%; padding: 14px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 15px; box-sizing: border-box;">
                </div>
                
                <div id="resetError" style="color: #e74c3c; font-size: 13px; margin-bottom: 16px; min-height: 20px; text-align: center;"></div>
                
                <div style="display: flex; gap: 12px; margin-top: 20px;">
                    <button onclick="closeResetPasswordModal()" style="flex: 1; padding: 14px; background: #e0e0e0; color: #666; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 15px;">Cancel</button>
                    <button onclick="submitNewPassword('${escapeHtml(email)}')" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 15px;">Reset Password</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    window.addDebugLog('Reset password modal HTML injected', 'success');
    
    // Focus on password field
    setTimeout(() => {
        const passwordField = document.getElementById('resetNewPassword');
        if (passwordField) {
            passwordField.focus();
            window.addDebugLog('Password field focused', 'debug');
        }
    }, 100);
    
    window.addDebugLog(`Reset password modal shown for ${email}`, 'success');
    window.addDebugLog(`========== SHOW RESET PASSWORD MODAL END ==========`, 'info');
}

// Close reset password modal
function closeResetPasswordModal() {
    window.addDebugLog('closeResetPasswordModal() called', 'info');
    const modal = document.getElementById('resetPasswordModal');
    if (modal) {
        modal.remove();
        window.addDebugLog('Reset password modal removed', 'success');
    }
}

// Submit new password
async function submitNewPassword(email) {
    window.addDebugLog(`========== SUBMIT NEW PASSWORD START ==========`, 'info');
    window.addDebugLog(`Email: ${email}`, 'info');
    
    const newPassword = document.getElementById('resetNewPassword')?.value;
    const confirmPassword = document.getElementById('resetConfirmPassword')?.value;
    const errorEl = document.getElementById('resetError');
    
    // Validation
    if (!newPassword || !confirmPassword) {
        const errorMsg = 'Please fill in both password fields';
        window.addDebugLog(`Validation failed: ${errorMsg}`, 'warning');
        if (errorEl) errorEl.textContent = errorMsg;
        return;
    }
    
    if (newPassword.length < 6) {
        const errorMsg = 'Password must be at least 6 characters';
        window.addDebugLog(`Validation failed: ${errorMsg}`, 'warning');
        if (errorEl) errorEl.textContent = errorMsg;
        return;
    }
    
    if (newPassword !== confirmPassword) {
        const errorMsg = 'Passwords do not match';
        window.addDebugLog(`Validation failed: ${errorMsg}`, 'warning');
        if (errorEl) errorEl.textContent = errorMsg;
        return;
    }
    
    // Disable submit button
    const submitBtn = document.querySelector('#resetPasswordModal button:last-child');
    const originalText = submitBtn ? submitBtn.textContent : 'Reset Password';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Resetting...';
        submitBtn.style.opacity = '0.6';
    }
    
    try {
        window.addDebugLog(`Sending password reset request...`, 'info');
        const response = await fetch('/api/account?action=reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, newPassword })
        });
        
        window.addDebugLog(`Response status: ${response.status}`, 'info');
        const data = await response.json();
        window.addDebugLog(`Response: ${JSON.stringify(data)}`, 'debug');
        
        if (data.success) {
            window.addDebugLog(`✅ Password reset successful for ${email}`, 'success');
            alert('✅ Password reset successfully! You can now login with your new password.');
            closeResetPasswordModal();
            showLogin();
        } else {
            const errorMsg = data.message || 'Password reset failed';
            window.addDebugLog(`❌ Reset failed: ${errorMsg}`, 'error');
            if (errorEl) errorEl.textContent = errorMsg;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                submitBtn.style.opacity = '1';
            }
        }
    } 
    catch (error) {
        window.addDebugLog(`❌ Reset error: ${error.message}`, 'error');
        if (errorEl) errorEl.textContent = 'Network error. Please try again.';
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            submitBtn.style.opacity = '1';
        }
    }
    
    window.addDebugLog(`========== SUBMIT NEW PASSWORD END ==========`, 'info');
}

// Helper function to escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==================== FORGOT PASSWORD FLOW ====================

// Show forgot password prompt
function showForgotPassword() {
    window.addDebugLog('showForgotPassword() called', 'info');
    const email = prompt('Enter your email address:');
    if (!email) {
        window.addDebugLog('Forgot password cancelled - no email entered', 'info');
        return;
    }
    
    window.addDebugLog(`Forgot password requested for email: ${email}`, 'info');
    initiateForgotPassword(email);
}

// Initiate forgot password flow
async function initiateForgotPassword(email) {
    window.addDebugLog(`========== INITIATE FORGOT PASSWORD START ==========`, 'info');
    window.addDebugLog(`Email: ${email}`, 'info');
    
    try {
        const response = await fetch('/api/account?action=forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        window.addDebugLog(`Response status: ${response.status}`, 'info');
        const data = await response.json();
        window.addDebugLog(`Response data: ${JSON.stringify(data)}`, 'debug');
        
        if (data.success && data.requiresVerification) {
            window.addDebugLog(`Password reset requires OTP verification`, 'info');
            window.addDebugLog(`OTP Code: ${data.otpCode}`, 'debug');
            window.addDebugLog(`App Email: ${data.appEmail}`, 'info');
            
            // Show OTP modal for password reset
            showOTPModal({
                appEmail: data.appEmail,
                otpCode: data.otpCode,
                expiry: data.expiry
            }, 'reset', email);
        } 
        else if (data.success && !data.requiresVerification) {
            window.addDebugLog(`No OTP required: ${data.message}`, 'info');
            alert(data.message);
        }
        else {
            const errorMsg = data.message || 'Failed to process request';
            window.addDebugLog(`Failed: ${errorMsg}`, 'error');
            alert(errorMsg);
        }
    } 
    catch (error) {
        window.addDebugLog(`Error: ${error.message}`, 'error');
        alert('Failed to process request. Please try again.');
    }
    
    window.addDebugLog(`========== INITIATE FORGOT PASSWORD END ==========`, 'info');
}