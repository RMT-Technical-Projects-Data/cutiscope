import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

export const SESSION_TIMEOUT_KEY = 'session_inactivity_timeout_minutes';
export const SESSION_TIMEOUT_CHANGED_EVENT = 'session_timeout_changed';
export const SESSION_TIMEOUT_OPTIONS = [2, 30, 60, 90, 120];
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 60;

export async function getSessionTimeoutMinutes() {
  try {
    const stored = Number(await AsyncStorage.getItem(SESSION_TIMEOUT_KEY));
    return SESSION_TIMEOUT_OPTIONS.includes(stored)
      ? stored
      : DEFAULT_SESSION_TIMEOUT_MINUTES;
  } catch (_) {
    return DEFAULT_SESSION_TIMEOUT_MINUTES;
  }
}

export async function setSessionTimeoutMinutes(minutes) {
  const value = Number(minutes);
  if (!SESSION_TIMEOUT_OPTIONS.includes(value)) {
    throw new Error('Invalid session timeout');
  }
  await AsyncStorage.setItem(SESSION_TIMEOUT_KEY, String(value));
  DeviceEventEmitter.emit(SESSION_TIMEOUT_CHANGED_EVENT, value);
  return value;
}
