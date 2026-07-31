import { DeviceEventEmitter } from 'react-native';

export const IN_APP_TOAST_EVENT = 'in_app_toast_show';
export const SESSION_ACTIVITY_EVENT = 'session_user_activity';
/** While hold is true, session inactivity countdown is frozen (user is in a busy overlay). */
export const SESSION_IDLE_HOLD_EVENT = 'session_idle_hold';
/** Fired at the start of forced session logout — screens should unmount UI immediately. */
export const SESSION_FORCE_LOGOUT_EVENT = 'session_force_logout';

/** Throttled emit so scrolling/touches reset the inactivity deadline without spam. */
let lastActivityEmitMs = 0;
export function notifyUserActivity() {
  const now = Date.now();
  if (now - lastActivityEmitMs < 250) return;
  lastActivityEmitMs = now;
  DeviceEventEmitter.emit(SESSION_ACTIVITY_EVENT);
}

/** Pause (true) or resume (false) the logged-in inactivity timer. */
export function setSessionIdleHold(hold) {
  DeviceEventEmitter.emit(SESSION_IDLE_HOLD_EVENT, !!hold);
  if (!hold) notifyUserActivity();
}

/** Tell open screens (gallery fullscreen, etc.) to close before auth clears. */
export function emitSessionForceLogout() {
  DeviceEventEmitter.emit(SESSION_FORCE_LOGOUT_EVENT);
}

export const showInAppToast = (message, opts = {}) => {
  if (!message) return;

  let durationMs = 2000; // Default SHORT
  if (typeof opts.durationMs === 'number') {
    if (opts.durationMs === 1) durationMs = 3500; // LONG
    else if (opts.durationMs === 0) durationMs = 2000; // SHORT
    else durationMs = opts.durationMs;
  } else if (opts.duration === 1 || opts.duration === 'long') {
    durationMs = 3500;
  }

  let position = opts.position || 'bottom';
  // Map ToastAndroid numeric positions if passed
  if (typeof position === 'number') {
    if (position === 1) position = 'center';
    else if (position === 2) position = 'top';
    else position = 'bottom';
  }

  DeviceEventEmitter.emit(IN_APP_TOAST_EVENT, {
    message: String(message),
    durationMs,
    position,
  });
};

export const simpleToast = (textAlign) => {
  showInAppToast(textAlign, { position: 'bottom' });
};

export const toastForCapture = (textAlign) => {
  showInAppToast(`Image Captured! ${textAlign}`, { position: 'bottom' });
};
