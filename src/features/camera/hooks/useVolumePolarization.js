import { useEffect } from 'react';
import { Platform } from 'react-native';
import KeyEvent from 'react-native-keyevent';
import VolumeManager from 'react-native-volume-manager';

export function useVolumePolarization({
  pressedKeysRef,
  ignoreKeysRef,
  polTimeoutRef,
  polTouchHoldTimerRef,
  isLightOnRef,
  resetInactivityTimer,
  syncPolarizationState,
}) {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    console.log('🔧 Setting up volume button listeners for polarization...');
    if (VolumeManager?.showNativeVolumeUI) {
      VolumeManager.showNativeVolumeUI({ enabled: false }).catch((error) => {
        console.warn('Failed to hide volume UI:', error);
      });
    }

    try {
      KeyEvent.removeKeyDownListener();
      KeyEvent.removeKeyUpListener();
      KeyEvent.removeKeyMultipleListener();
    } catch (error) {
      console.log('No existing listeners to remove:', error);
    }

    KeyEvent.onKeyDownListener((keyEvent) => {
      const key = keyEvent.keyCode;
      console.log('🔑 KeyEvent DOWN received - keyCode:', key, 'action:', keyEvent.action);
      if (key !== 24 && key !== 25) return;

      console.log(`[POL_KEY_DOWN] Key DOWN received: ${key}. Before set: ${!!pressedKeysRef.current[key]}`);
      pressedKeysRef.current[key] = true;
      VolumeManager?.showNativeVolumeUI?.({ enabled: false }).catch(() => {});
      syncPolarizationState();
      resetInactivityTimer();

      if (isLightOnRef.current) {
        // Animation intentionally remains disabled.
      }
    });

    KeyEvent.onKeyUpListener((keyEvent) => {
      const key = keyEvent.keyCode;
      if (key !== 24 && key !== 25) return;

      console.log(`[POL_KEY_UP] Key UP received: ${key}. Current state: ${!!pressedKeysRef.current[key]}`);
      if (pressedKeysRef.current[key]) pressedKeysRef.current[key] = false;
      if (ignoreKeysRef.current) {
        console.log('[POL_SYNC] Key released during transition, performing sync anyway to avoid stuck icon');
      }
      VolumeManager?.showNativeVolumeUI?.({ enabled: false }).catch(() => {});
      syncPolarizationState();
    });

    try {
      KeyEvent.onKeyMultipleListener((keyEvent) => {
        console.log('🔑 KeyEvent MULTIPLE - keyCode:', keyEvent.keyCode);
      });
    } catch (error) {
      console.log('KeyEvent multiple listener not available:', error);
    }

    return () => {
      console.log('🧹 Cleaning up volume button listeners...');
      try {
        KeyEvent.removeKeyDownListener();
        KeyEvent.removeKeyUpListener();
        KeyEvent.removeKeyMultipleListener();
      } catch (error) {
        console.warn('Error removing listeners:', error);
      }
      clearTimeout(polTimeoutRef.current);
      if (polTouchHoldTimerRef.current) {
        clearTimeout(polTouchHoldTimerRef.current);
        polTouchHoldTimerRef.current = null;
      }
    };
  }, []);
}
