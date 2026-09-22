import { useState, useRef } from 'react';
import { Vibration } from 'react-native';
import { VIBRATION_DURATION, VIBRATION_INTERVAL } from '../utils/Constants';

export const useVibration = () => {
  const [isVibrating, setIsVibrating] = useState(false);
  const vibrationInterval = useRef(null);

  const produceHighVibration = () => {
    if (isVibrating) {
      console.log('Vibration is already active.');
      return;
    }

    console.log('Starting continuous vibration...');
    setIsVibrating(true);

    Vibration.vibrate(VIBRATION_DURATION);
    vibrationInterval.current = setInterval(() => {
      console.log('Restarting vibration...');
      Vibration.vibrate(VIBRATION_DURATION);
    }, VIBRATION_INTERVAL);
  };

  const stopVibration = () => {
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

  return {
    isVibrating,
    produceHighVibration,
    stopVibration
  };
};
