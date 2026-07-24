import { useEffect, useRef, useState } from 'react';
import DeviceInfo from 'react-native-device-info';

export function useBatteryStatus({ onLowBattery }) {
  const [batteryLevel, setBatteryLevel] = useState(1.0);
  const previousLevelRef = useRef(1.0);
  const onLowBatteryRef = useRef(onLowBattery);
  onLowBatteryRef.current = onLowBattery;

  useEffect(() => {
    const checkBattery = async () => {
      try {
        const level = await DeviceInfo.getBatteryLevel();
        if (level === -1) return;

        if (previousLevelRef.current > 0.2 && level <= 0.2) {
          console.log('🔋 Battery dropped to 20% - Turning off flashlight');
          onLowBatteryRef.current?.();
        }

        previousLevelRef.current = level;
        setBatteryLevel(level);
      } catch (error) {
        console.warn('Battery check error:', error);
      }
    };

    const interval = setInterval(checkBattery, 10000);
    checkBattery();
    return () => clearInterval(interval);
  }, []);

  return { batteryLevel };
}
