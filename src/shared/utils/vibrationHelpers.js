import { Vibration, Platform } from 'react-native';
import { VIBRATION_DURATION, VIBRATION_INTERVAL } from './cameraAndStorageConstants';

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
