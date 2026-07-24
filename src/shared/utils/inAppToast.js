import { DeviceEventEmitter } from 'react-native';

export const IN_APP_TOAST_EVENT = 'in_app_toast_show';
export const SESSION_ACTIVITY_EVENT = 'session_user_activity';

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
