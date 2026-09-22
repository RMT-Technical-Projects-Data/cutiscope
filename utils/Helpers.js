import { Vibration, Platform, Alert, DeviceEventEmitter } from 'react-native';
import { VIBRATION_DURATION, VIBRATION_INTERVAL } from './Constants';

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

// Vibration helpers
export const produceHighVibration = (isVibrating, setIsVibrating, vibrationInterval) => {
  if (isVibrating) {
    console.log('Vibration is already active.');
    return;
  }

  if (Platform.OS === 'android') {
    console.log('Starting continuous vibration...');
    setIsVibrating(true);

    Vibration.vibrate(VIBRATION_DURATION);
    vibrationInterval.current = setInterval(() => {
      console.log('Restarting vibration...');
      Vibration.vibrate(VIBRATION_DURATION);
    }, VIBRATION_INTERVAL);
  } else {
    console.log('iOS does not support custom vibration durations.');
  }
};

export const stopVibration = (isVibrating, setIsVibrating, vibrationInterval) => {
  if (!isVibrating) {
    console.log('Vibration is not active.');
    return;
  }

  console.log('Stopping vibration...');
  if (vibrationInterval.current) {
    clearInterval(vibrationInterval.current);
    vibrationInterval.current = null;
  }
  Vibration.cancel();
  setIsVibrating(false);
  console.log('Vibration stopped.');
};

// Toast helpers
export const simpleToast = (textAlign) => {
  showInAppToast(textAlign, { position: 'bottom' });
};

export const toastForCapture = (textAlign) => {
  showInAppToast(`Image Captured! ${textAlign}`, { position: 'bottom' });
};

// File helpers
export const pad = (num) => num.toString().padStart(2, '0');

export const generateFileName = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  return `Dermscope_${year}${month}${day}_${hours}${minutes}${seconds}.jpg`;
};

// Permission helpers
const requestStoragePermission = async () => {
  try {
    if (Platform.OS === 'android') {
      // For Android 13+ (API level 33+)
      if (Platform.Version >= 33) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      // For Android 10-12
      else if (Platform.Version >= 29) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        ]);
        return (
          granted[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] ===
          PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] ===
          PermissionsAndroid.RESULTS.GRANTED
        );
      }
      // For Android 5-9
      else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true; // iOS doesn't need this permission
  } catch (err) {
    console.warn('Storage permission error:', err);
    return false;
  }
};
let galleryStoragePermissionGranted = false;

export const requestStoragePermissionForGallery = async (PermissionsAndroid) => {
  try {
    if (galleryStoragePermissionGranted) return true;

    const permissions = [];

    // Check Android version for appropriate permissions
    const { Platform } = require('react-native');
    const isAndroid13OrHigher = Platform.Version >= 33;

    if (isAndroid13OrHigher) {
      // Android 13+ requires granular permissions
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    } else {
      // Older Android versions
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
    }

    // Fast path: already granted — avoid request dialog / IPC on every gallery open
    try {
      const checks = await Promise.all(
        permissions.map((p) => PermissionsAndroid.check(p))
      );
      if (checks.every(Boolean)) {
        galleryStoragePermissionGranted = true;
        return true;
      }
    } catch (_) {}

    // Request permissions
    const results = await PermissionsAndroid.requestMultiple(permissions);

    // Check if all permissions are granted
    const allGranted = Object.values(results).every(
      result => result === PermissionsAndroid.RESULTS.GRANTED
    );

    if (allGranted) {
      galleryStoragePermissionGranted = true;
      console.log('All storage permissions granted for gallery access');
      return true;
    } else {
      console.log('Some storage permissions denied:', results);
      return false;
    }
  } catch (err) {
    console.warn('Error requesting storage permissions for gallery:', err);
    return false;
  }
};

export const requestLocationPermission = async (PermissionsAndroid) => {
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      console.log('Location permission granted');
      return true;
    } else {
      console.log('Location permission denied');
      return false;
    }
  } catch (err) {
    console.warn(err);
    return false;
  }
};

// Network helpers
export const checkNetworkConnection = async (NetInfo) => {
  const networkState = await NetInfo.fetch();
  if (!networkState.isConnected || networkState.type !== 'wifi') {
    console.error('No Wi-Fi connection detected. Please connect to Wi-Fi.');
    return false;
  }
  console.log('Wi-Fi connection detected. Proceeding with upload.');
  return true;
};

// Storage helpers
export const checkStorageSpace = async (RNFS) => {
  const freeSpace = await RNFS.getFSInfo();
  const usedSpaceMB = (freeSpace.totalSpace - freeSpace.freeSpace) / (1024 * 1024);
  const totalSpaceMB = freeSpace.totalSpace / (1024 * 1024);
  const freeSpaceMB = freeSpace.freeSpace / (1024 * 1024);

  const limitMB = 15360;
  const criticalThresholdMB = 100;
  const lowThresholdMB = 500;

  console.log(`Total Space: ${totalSpaceMB} MB`);
  console.log(`Free Space: ${freeSpaceMB} MB`);
  console.log(`Used Space: ${usedSpaceMB} MB`);

  if (totalSpaceMB < limitMB) {
    Alert.alert(
      'Insufficient Storage',
      'Your device is near to full.',
      [{ text: 'OK' }],
    );
    return false;
  }

  if (freeSpaceMB <= criticalThresholdMB) {
    Alert.alert(
      'Memory Full',
      'Your device storage is full. Please free up some space to capture new images.',
      [{ text: 'OK' }],
    );
    return false;
  } else if (freeSpaceMB <= lowThresholdMB) {
    Alert.alert(
      'Low Storage',
      'Storage is running low! Please free up space soon.',
      [{ text: 'OK' }],
    );
  }

  return true;
};
