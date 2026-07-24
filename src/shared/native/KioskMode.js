import { NativeModules, Platform } from 'react-native';

const { KioskModeModule } = NativeModules;

/**
 * Kiosk mode (Android Lock Task Mode) API.
 * Only available on Android; no-op on iOS.
 */
export const KioskMode = {
  /**
   * Start kiosk mode: app stays in foreground, user cannot leave (no recents/home).
   * When app is device owner, only this app is allowed in lock task.
   * @returns {Promise<string>} Success message or rejects with error.
   */
  async startKioskMode() {
    if (Platform.OS !== 'android') {
      return Promise.resolve('Kiosk mode is Android only');
    }
    if (!KioskModeModule) {
      return Promise.reject(new Error('KioskModeModule is not available'));
    }
    return KioskModeModule.startKioskMode();
  },

  /**
   * Stop kiosk mode: normal navigation (recents, home) is restored.
   * @returns {Promise<string>} Success message or rejects with error.
   */
  async stopKioskMode() {
    if (Platform.OS !== 'android') {
      return Promise.resolve('Kiosk mode is Android only');
    }
    if (!KioskModeModule) {
      return Promise.reject(new Error('KioskModeModule is not available'));
    }
    return KioskModeModule.stopKioskMode();
  },
};

export default KioskMode;
