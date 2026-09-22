/**
 * User-facing messages only. No technical details (backend, server, API, URLs).
 * Use these for alerts and toasts so users see clear, simple copy.
 */

export const UserMessages = {
  // Connection / network
  connectionUnavailable: 'Unable to connect. Please check your internet connection and try again.',
  connectionCheck: 'Checking…',
  connectionReady: 'Ready',
  connectionUnavailableShort: 'Unavailable',

  // Sign-in / login
  signInFailed: 'Incorrect email or password.',
  missingEmailPassword: 'Please enter your email and password.',
  invalidEmail: 'Please enter a valid email address.',

  // OTP / verification
  verificationCodeSent: 'A verification code has been sent to your email. Please enter it below.',
  verificationCodeNotSent: 'We couldn\'t send the code. Please check your email and connection, then try again.',
  invalidOrExpiredCode: 'That code is invalid or has expired. Please request a new one.',
  enterCode: 'Please enter the 6-digit code from your email.',

  // Registration
  registrationFailed: 'We couldn\'t create your account. Please try again or request a new code.',

  // Forgot password
  emailNotRegistered: 'No account was found with this email. Please check the address or sign up.',
  resetCodeNotSent: 'We couldn\'t send the reset code. Please check that this email is registered and your connection.',
  passwordUpdated: 'Your password has been updated. You can sign in with your new password.',

  // Change password (in settings)
  passwordChangeFailed: 'We couldn\'t update your password. Please check your current password and try again.',
  passwordChanged: 'Your password has been changed successfully.',

  // Logout
  logoutFailed: 'We couldn\'t sign you out. Please try again.',

  // Camera / capture
  captureFailed: 'We couldn\'t save the photo. Please try again.',
  captureOnlyFailed: 'Couldn\'t capture. Please try again.',
  cameraNotReady: 'Camera isn\'t ready. Tap Try again.',
  soundLoadFailed: 'We couldn\'t load the sound. Please try again.',

  // Updates
  updateDownloadFailed: 'We couldn\'t download the update. Please check your connection and try again.',

  // Generic
  somethingWrong: 'Something went wrong. Please try again.',
  tryAgain: 'Please try again.',
};

/**
 * Map technical error (message or response) to a user-friendly string.
 * Prefer returning a safe message; never expose URLs, status codes, or backend details.
 */
export function toUserMessage(error, fallback = UserMessages.somethingWrong) {
  if (!error) return fallback;
  const msg = (typeof error === 'string' ? error : error.message || '').toLowerCase();
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('reach')) {
    return UserMessages.connectionUnavailable;
  }
  if (msg.includes('401') || msg.includes('invalid') && msg.includes('password')) {
    return UserMessages.signInFailed;
  }
  if (msg.includes('404') || msg.includes('not found') || msg.includes('no account')) {
    return UserMessages.emailNotRegistered;
  }
  if (msg.includes('otp') || msg.includes('expired') || msg.includes('verification')) {
    return UserMessages.invalidOrExpiredCode;
  }
  // Don't pass through raw backend/technical messages
  return fallback;
}
