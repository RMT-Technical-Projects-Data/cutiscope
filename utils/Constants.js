import RNFS from 'react-native-fs';
import { ToastAndroid } from 'react-native';
import Config from 'react-native-config';

// App Constants
export const CAMERA_DIR = `${RNFS.ExternalStorageDirectoryPath}/DCIM/Camera`;
const API_BASE = (Config.API_BASE_URL || 'http://35.154.32.201:4040').replace(/\/$/, '');
export const SERVER_URL = `${API_BASE}/savefile`;
export const DEVICE_ID = 'Dev 005';
export const CHUNK_SIZE = 35000;

// Zoom and Focus Constants
export const ZOOM_VALUES = [...Array(3).keys()].map(i => (i * 0.1667).toFixed(2));
export const EXPOSURE_VALUES = Array.from({ length: 21 }, (_, i) => (i * 0.05).toFixed(1));
export const FOCUS_DEPTH_VALUES = Array.from({ length: 21 }, (_, i) => (i * 0.05).toFixed(1));

// White Balance Constants
export const DEFAULT_TEMPERATURE = 6500; // Kelvin
export const DEFAULT_TINT = 0.0;

// UI Constants
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const ZOOM_SENSITIVITY = 0.5;
export const INERTIA_THRESHOLD = 0.5;
export const INACTIVITY_TIMEOUT = 30000; // 30 minutes

// Vibration Constants
export const VIBRATION_DURATION = 15000;
export const VIBRATION_INTERVAL = 14500;

// Toast Constants
export const TOAST_DURATION_SHORT = ToastAndroid.SHORT;
export const TOAST_DURATION_LONG = ToastAndroid.LONG;
export const TOAST_OFFSET_BOTTOM = 550;
export const TOAST_OFFSET_BOTTOM_SHORT = 100;

// Storage Limits
export const LIMIT_MB = 15360;
export const CRITICAL_THRESHOLD_MB = 100;
export const LOW_THRESHOLD_MB = 500;
