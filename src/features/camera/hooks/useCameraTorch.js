import { useCallback, useEffect } from 'react';
import { Platform, Vibration } from 'react-native';
import { showInAppToast } from '../../../shared/utils/inAppToast';

/**
 * Light-button / polarization press handlers for CameraScreen.
 * State and refs stay on the screen (hardware sync is tightly coupled there);
 * this module owns the press-handler behavior in a named place.
 */
export function useCameraTorch({
  batteryLevel,
  isLightOn,
  resetInactivityTimer,
  toggleLight,
  syncPolarizationState,
  touchPolHoldRef,
  skipNextTorchToggleRef,
  lightPressStartRef,
  clearPolTouchHoldTimer,
}) {
  const onLightButtonPressIn = useCallback(() => {
    if (lightPressStartRef) lightPressStartRef.current = Date.now();
    clearPolTouchHoldTimer?.();
  }, [lightPressStartRef, clearPolTouchHoldTimer]);

  const onLightButtonLongPress = useCallback(() => {
    if (!isLightOn) return;
    if (touchPolHoldRef) {
      touchPolHoldRef.current = !touchPolHoldRef.current;
    }
    syncPolarizationState?.();
    if (Platform.OS === 'android') {
      Vibration.vibrate(40);
    }
  }, [isLightOn, syncPolarizationState, touchPolHoldRef]);

  const onLightButtonPressOut = useCallback(() => {
    clearPolTouchHoldTimer?.();
  }, [clearPolTouchHoldTimer]);

  const onLightButtonPress = useCallback(() => {
    clearPolTouchHoldTimer?.();
    if (skipNextTorchToggleRef?.current) {
      skipNextTorchToggleRef.current = false;
      return;
    }

    const nextLightState = batteryLevel > 0.2 ? !isLightOn : isLightOn;
    if (touchPolHoldRef) touchPolHoldRef.current = false;

    if (toggleLight) {
      toggleLight();
    } else if (batteryLevel <= 0.2) {
      showInAppToast('Battery is low. Please charge the device to use the polarized leds.', { durationMs: 2000 });
      resetInactivityTimer?.();
      return;
    }

    syncPolarizationState?.(false, nextLightState);
  }, [
    batteryLevel,
    isLightOn,
    toggleLight,
    syncPolarizationState,
    touchPolHoldRef,
    skipNextTorchToggleRef,
    clearPolTouchHoldTimer,
    resetInactivityTimer,
  ]);

  useEffect(() => () => {
    clearPolTouchHoldTimer?.();
  }, [clearPolTouchHoldTimer]);

  return {
    onLightButtonPressIn,
    onLightButtonLongPress,
    onLightButtonPressOut,
    onLightButtonPress,
  };
}
