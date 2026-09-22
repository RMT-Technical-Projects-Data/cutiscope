import { NativeModules } from 'react-native';

// SAFE NATIVE MODULES WITH NULL CHECKS
const nativeModules = NativeModules || {};
export const {
  LockTaskModule = {},
  KioskMode = {},
  MyDirectBootModule = {},
  ScreenLock = {}
} = nativeModules;

// SAFE NATIVE MODULE FUNCTIONS
export const startLockTask = () => {
  if (LockTaskModule && LockTaskModule.startLockTask) {
    LockTaskModule.startLockTask();
  } else {
    console.warn('LockTaskModule not available');
  }
};

export const stopLockTask = () => {
  if (LockTaskModule && LockTaskModule.stopLockTask) {
    LockTaskModule.stopLockTask();
  } else {
    console.warn('LockTaskModule not available');
  }
};

export const handleSleepMode = () => {
  if (ScreenLock && ScreenLock.lockScreen) {
    ScreenLock.lockScreen();
  } else {
    console.warn('ScreenLock not available');
  }
};
