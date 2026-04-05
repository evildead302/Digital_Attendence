// ==================== OTP FUNCTIONS WITH DEBUG LOGS ====================

// Show OTP verification modal
function showOTPModal(otpData, purpose, email) {
    window.addDebugLog(`========== SHOW OTP MODAL START ==========`, 'info');
    window.addDebugLog(`Purpose: ${purpose}, Email: ${email}`, 'info');
    window.addDebugLog(`OTP Data received: ${JSON.stringify({
        otpCode: otpData.otpCode,
        appEmail: otpData.appEmail,
        expiry: otpData.expiry
    })}`, 'debug');
    
    currentOTPData = otpData;
    verificationPurpose = purpose;
    pendingEmail = email;
    
    document.getElementById('appEmailDisplay').textContent = otpData.appEmail;
    document.getElementById('otpCodeDisplay').textContent = otpData.otpCode;
    
    // Calculate remaining time
    const expiry = new Date(otpData.expiry);
    const now = new Date();
    const remainingSeconds = Math.max(0, Math.floor((expiry - now) / 1000));
    window.addDebugLog(`OTP expiry: ${expiry.toISOString()}, remaining: ${remainingSeconds} seconds`, 'info');
    
    startOTPTimer(expiry);
    
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
            window.addDebugLog(`OTP timer expired at: ${now.toISOString()}`, 'warning');
            document.getElementById('otpTimer').textContent = '00:00';
            document.getElementById('otpTimer').classList.add('expired');
            document.getElementById('verifyOtpBtn').disabled = true;
            document.getElementById('verifyOtpBtn').style.opacity = '0.5';
            clearInterval(otpTimerInterval);
            window.addDebugLog('OTP expired, verification button disabled', 'warning');
            return;
        }
        
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        document.getElementById('otpTimer').textContent = timeStr;
        document.getElementById('otpTimer').classList.remove('expired');
        document.getElementById('verifyOtpBtn').disabled = false;
        document.getElementById('verifyOtpBtn').style.opacity = '1';
        
        if (seconds % 10 === 0) {
            window.addDebugLog(`OTP timer: ${timeStr} remaining`, 'debug');
        }
    }
    
    updateTimer();
    otpTimerInterval = setInterval(updateTimer, 1000);
}

// Close OTP modal
function closeOTPModal() {
    window.addDebugLog(`Closing OTP modal - Purpose: ${verificationPurpose}, Email: ${pendingEmail}`, 'info');
    document.getElementById('otpModal').style.display = 'none';
    if (otpTimerInterval) {
        clearInterval(otpTimerInterval);
        otpTimerInterval = null;
        window.addDebugLog('OTP timer cleared', 'info');
    }
    currentOTPData = null;
    verificationPurpose = null;
    pendingEmail = null;
    document.getElementById('otpError').textContent = '';
}

// Copy to clipboard
function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    const text = element.textContent;
    
    window.addDebugLog(`Copying to clipboard: ${text} (case-insensitive)`, 'info');
    
    navigator.clipboard.writeText(text).then(() => {
        window.addDebugLog(`Successfully copied OTP to clipboard`, 'success');
        alert('Copied to clipboard! (OTP is case-insensitive)');
    }).catch(err => {
        window.addDebugLog(`Failed to copy to clipboard: ${err.message}`, 'error');
        alert('Failed to copy. Please select and copy manually.');
    });
}

// Open email client with pre-filled subject
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
    window.addDebugLog('Email client opened', 'success');
}

// ==================== VERIFY OTP - UPDATED VERSION ====================
async function verifyOTP() {
    window.addDebugLog(`========== VERIFY OTP START ==========`, 'info');
    window.addDebugLog(`Current OTP Data exists: ${!!currentOTPData}`, 'info');
    window.addDebugLog(`Pending Email: ${pendingEmail}`, 'info');
    window.addDebugLog(`Verification Purpose: ${verificationPurpose}`, 'info');
    
    // Validate required data
    if (!currentOTPData || !pendingEmail || !verificationPurpose) {
        const errorMsg = !currentOTPData ? 'Missing OTP data' : (!pendingEmail ? 'Missing email' : 'Missing purpose');
        window.addDebugLog(`Verify OTP failed: ${errorMsg}`, 'error');
        const errorEl = document.getElementById('otpError');
        if (errorEl) errorEl.textContent = 'Missing verification data. Please try again.';
        return;
    }
    
    // Clear previous error and disable button
    const errorEl = document.getElementById('otpError');
    const verifyBtn = document.getElementById('verifyOtpBtn');
    if (errorEl) errorEl.textContent = '';
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
    }
    
    window.addDebugLog(`Sending verification request for email: ${pendingEmail}, OTP: ${currentOTPData.otpCode}, purpose: ${verificationPurpose}`, 'info');
    
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
        
        window.addDebugLog(`Verify OTP response status: ${response.status}`, 'info');
        const data = await response.json();
        window.addDebugLog(`Verify OTP response data: ${JSON.stringify(data)}`, 'debug');
        
        if (data.success) {
            // CRITICAL: Save to local variables BEFORE closing modal
            const verifiedEmail = pendingEmail;
            const verifiedPurpose = verificationPurpose;
            
            window.addDebugLog(`✅ OTP verified successfully for ${verifiedEmail} (Purpose: ${verifiedPurpose})`, 'success');
            
            // Close the OTP modal (this clears global variables)
            closeOTPModal();
            
            // Handle based on the saved purpose
            if (verifiedPurpose === 'register') {
                window.addDebugLog('Registration verification complete - redirecting to login', 'success');
                alert('✅ Email verified successfully! You can now login.');
                showLogin();
            } 
            else if (verifiedPurpose === 'reset') {
                window.addDebugLog('Reset password verification complete - showing reset password modal', 'success');
                // Small delay to ensure modal is closed and DOM is ready
                setTimeout(() => {
                    showResetPasswordModal(verifiedEmail);
                }, 300);
            }
            else {
                window.addDebugLog(`Unknown purpose: ${verifiedPurpose}`, 'warning');
                alert('Verification successful!');
            }
        } else {
            // Handle failed verification
            const errorMsg = data.message || 'Verification failed. Please try again.';
            window.addDebugLog(`❌ OTP verification failed: ${errorMsg}`, 'error');
            if (errorEl) errorEl.textContent = errorMsg;
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.textContent = "I've Sent the Email";
            }
        }
    } catch (error) {
        window.addDebugLog(`❌ OTP verification error: ${error.message}`, 'error');
        if (errorEl) errorEl.textContent = 'Verification failed. Please check your connection and try again.';
        if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.textContent = "I've Sent the Email";
        }
    }
    window.addDebugLog(`========== VERIFY OTP END ==========`, 'info');
}

// Helper function to escape HTML (for security)
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Show reset password modal
function showResetPasswordModal(email) {
    window.addDebugLog(`========== SHOW RESET PASSWORD MODAL START ==========`, 'info');
    window.addDebugLog(`Email for password reset: ${email}`, 'info');
    
    if (!email) {
        window.addDebugLog('ERROR: No email provided for password reset', 'error');
        alert('Error: No email found. Please try the forgot password process again.');
        return;
    }
    
    // Remove existing modal if any
    const existingModal = document.getElementById('resetPasswordModal');
    if (existingModal) {
        window.addDebugLog('Removing existing reset password modal', 'debug');
        existingModal.remove();
    }
    
    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'resetPasswordModal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    modal.style.zIndex = '10001';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.backgroundColor = 'white';
    modalContent.style.borderRadius = '16px';
    modalContent.style.padding = '24px';
    modalContent.style.maxWidth = '400px';
    modalContent.style.width = '90%';
    modalContent.style.margin = 'auto';
    modalContent.style.position = 'relative';
    modalContent.style.top = '50%';
    modalContent.style.transform = 'translateY(-50%)';
    
    modalContent.innerHTML = `
        <h3 style="margin: 0 0 8px 0; color: #333; font-size: 20px;">🔐 Reset Password</h3>
        <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
            Set a new password for<br>
            <strong style="color: #667eea; word-break: break-all;">${escapeHtml(email)}</strong>
        </p>
        
        <div class="input-group" style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; color: #555; font-size: 14px; font-weight: 500;">New Password</label>
            <input type="password" id="resetNewPassword" class="modal-input" placeholder="Enter new password (min 6 characters)" style="width: 100%; padding: 14px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 15px; box-sizing: border-box;">
        </div>
        
        <div class="input-group" style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; color: #555; font-size: 14px; font-weight: 500;">Confirm Password</label>
            <input type="password" id="resetConfirmPassword" class="modal-input" placeholder="Re-enter new password" style="width: 100%; padding: 14px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 15px; box-sizing: border-box;">
        </div>
        
        <div id="resetError" class="error-message" style="color: #e74c3c; font-size: 13px; margin-bottom: 16px; min-height: 20px; text-align: center;"></div>
        
        <div class="modal-buttons" style="display: flex; gap: 12px; margin-top: 20px;">
            <button onclick="closeResetPasswordModal()" class="modal-cancel" style="flex: 1; padding: 14px; background: #e0e0e0; color: #666; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 15px;">Cancel</button>
            <button onclick="submitNewPassword('${escapeHtml(email)}')" class="modal-save" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 15px;">Reset Password</button>
        </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Focus on password field
    setTimeout(() => {
        const passwordField = document.getElementById('resetNewPassword');
        if (passwordField) {
            passwordField.focus();
            window.addDebugLog('Password field focused', 'debug');
        } else {
            window.addDebugLog('WARNING: Could not find resetNewPassword element', 'warning');
        }
    }, 100);
    
    window.addDebugLog(`Reset password modal shown for ${email}`, 'success');
    window.addDebugLog(`========== SHOW RESET PASSWORD MODAL END ==========`, 'info');
}

// Close reset password modal
function closeResetPasswordModal() {
    window.addDebugLog('Closing reset password modal', 'info');
    const modal = document.getElementById('resetPasswordModal');
    if (modal) {
        modal.remove();
        window.addDebugLog('Reset password modal removed', 'success');
    } else {
        window.addDebugLog('Reset password modal not found', 'warning');
    }
}

// Submit new password after reset
async function submitNewPassword(email) {
    window.addDebugLog(`========== SUBMIT NEW PASSWORD START ==========`, 'info');
    window.addDebugLog(`Email: ${email}`, 'info');
    
    const newPassword = document.getElementById('resetNewPassword')?.value;
    const confirmPassword = document.getElementById('resetConfirmPassword')?.value;
    const errorEl = document.getElementById('resetError');
    
    if (!newPassword || !confirmPassword) {
        const errorMsg = 'Please fill in both password fields';
        window.addDebugLog(`Password validation failed: ${errorMsg}`, 'warning');
        if (errorEl) errorEl.textContent = errorMsg;
        return;
    }
    
    window.addDebugLog(`Password length: ${newPassword.length} chars`, 'debug');
    
    // Validate passwords
    if (newPassword.length < 6) {
        const errorMsg = 'Password must be at least 6 characters';
        window.addDebugLog(`Password validation failed: ${errorMsg}`, 'warning');
        if (errorEl) errorEl.textContent = errorMsg;
        return;
    }
    
    if (newPassword !== confirmPassword) {
        const errorMsg = 'Passwords do not match';
        window.addDebugLog(`Password validation failed: ${errorMsg}`, 'warning');
        if (errorEl) errorEl.textContent = errorMsg;
        return;
    }
    
    // Disable button to prevent double submission
    const submitBtn = document.querySelector('#resetPasswordModal .modal-save');
    const originalText = submitBtn ? submitBtn.textContent : 'Reset Password';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Resetting...';
        submitBtn.style.opacity = '0.6';
        submitBtn.style.cursor = 'not-allowed';
    }
    
    try {
        window.addDebugLog(`Sending password reset request for ${email}`, 'info');
        const response = await fetch('/api/account?action=reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, newPassword })
        });
        
        window.addDebugLog(`Reset password response status: ${response.status}`, 'info');
        const data = await response.json();
        window.addDebugLog(`Reset password response: ${JSON.stringify(data)}`, 'debug');
        
        if (data.success) {
            window.addDebugLog(`✅ Password reset successful for ${email}`, 'success');
            alert('✅ Password reset successfully! You can now login with your new password.');
            closeResetPasswordModal();
            showLogin();
        } else {
            const errorMsg = data.message || 'Password reset failed';
            window.addDebugLog(`❌ Password reset failed: ${errorMsg}`, 'error');
            if (errorEl) errorEl.textContent = errorMsg;
            
            // Re-enable button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            }
        }
    } catch (error) {
        window.addDebugLog(`Password reset error: ${error.message}`, 'error');
        if (errorEl) errorEl.textContent = 'Failed to reset password. Please try again.';
        
        // Re-enable button
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
        }
    }
    window.addDebugLog(`========== SUBMIT NEW PASSWORD END ==========`, 'info');
}