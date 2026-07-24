import { useEffect } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

export function useStandbyAndScreenOff({
  isStandbyRef,
  setIsStandby,
  timeoutRef,
  setIsFlashOn,
  setIsLightOn,
}) {
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onScreenOff', () => {
      console.log('📴 Screen off - turning torch and polarization off');
      isStandbyRef.current = false;
      setIsStandby(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setIsFlashOn(false);
      setIsLightOn(false);
      if (Platform.OS === 'android' && NativeModules.DermascopeModule) {
        try {
          NativeModules.DermascopeModule.setPolarization(false, 0);
        } catch (error) {
          console.warn('DermascopeModule setPolarization off:', error);
        }
      }
    });
    return () => subscription.remove();
  }, []);
}
