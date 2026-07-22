import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, Image, StatusBar } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import BackgroundTimer from 'react-native-background-timer';
import WifiManager from 'react-native-wifi-reborn';
import AsyncStorage from '@react-native-async-storage/async-storage';
import fullBattery from '../assets/icon_fullBattery.png';
import belowfullBattery from '../assets/icon_below90Battery.png';
import halfBattery from '../assets/icon_halfBattery.png';
import belowHalfBattery from '../assets/icon_belowHalfBattery.png';
import lowBattery from '../assets/icon_lowBattery.png';
import emptyBattery from '../assets/icon_emptyBattery.png';
import chargingBattery from '../assets/icon_chargingBattery.png';
import connectedWifi from '../assets/icon_wifi.png';
import { DeviceEventEmitter } from 'react-native';
import SystemSetting from 'react-native-system-setting';
import bluetoothIcon from '../assets/icons8-bluetooth-100.png';


// Simple event emitter for custom events
class SimpleEventEmitter {
  constructor() {
    this.listeners = {};
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  emit(event, ...args) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(...args));
    }
  }

  removeAllListeners(event) {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
  }
}

const eventEmitter = new SimpleEventEmitter();

// Global state to persist custom time across component remounts
let globalCustomTime = null;
let globalIsCustomTimeSet = false;

const CustomStatusBar = ({
  backgroundColor = 'transparent',
  barStyle = 'light-content',
  hidden = true,
  translucent = true
}) => {
  const [time, setTime] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [batteryPercentage, setBatteryPercentage] = useState(null);
  const [batteryState, setBatteryState] = useState('');
  const [wifiEnabled, setWifiEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [isCustomTimeSet, setIsCustomTimeSet] = useState(globalIsCustomTimeSet); // Flag to track custom time setting
  const [customTime, setCustomTime] = useState(globalCustomTime); // Track custom time


  const renderBatteryImage = () => {
    const pct = batteryPercentage != null ? batteryPercentage : 0;
    const isCharging = batteryState === 'charging' || batteryState === 'full';
    if (isCharging) {
      return <Image source={chargingBattery} style={styles.batteryImage} />;
    }
    if (pct >= 90) return <Image source={fullBattery} style={styles.batteryImage} />;
    if (pct >= 80) return <Image source={belowfullBattery} style={styles.batteryImage} />;
    if (pct >= 50) return <Image source={halfBattery} style={styles.batteryImage} />;
    if (pct >= 20) return <Image source={belowHalfBattery} style={styles.batteryImage} />;
    if (pct >= 1) return <Image source={lowBattery} style={styles.batteryImage} />;
    return <Image source={emptyBattery} style={styles.batteryImage} />;
  };

  const renderWifiIcon = () => {
    if (!wifiEnabled) {
      return null; // Don't show anything if WiFi is off
    }
    // console.log(connected);

    // Show different icons based on connection status
    return (
      <Image
        style={styles.wifiIcon}
        source={connected && connectedWifi}
      />
    );
  };

  const renderBluetoothIcon = () => {
    if (!bluetoothEnabled) {
      return null; // Don't show anything if Bluetooth is off
    }
    return (
      <Image
        style={styles.bluetoothIcon}
        source={bluetoothIcon}
      />
    );
  };

  // Function to load timezone from AsyncStorage
  const loadTimezone = async () => {
    try {
      const savedTimezone = await AsyncStorage.getItem('selectedTimezone');
      if (savedTimezone) {
        setTimezone(savedTimezone);
      }
    } catch (error) {
      console.error('Failed to load timezone from AsyncStorage:', error);
    }
  };

  // Function to update the displayed time
  const updateTime = useCallback((currentTime = null) => {
    const now = currentTime || new Date();
    const timeOptions = {
      hour: '2-digit',
      minute: '2-digit',
      // second: '2-digit',
      hour12: true,
      // timeZone: timezone,
    };

    const formattedTime = now.toLocaleTimeString(undefined, timeOptions);
    setTime(formattedTime);
  }, [timezone]);

  const checkWifiStatus = useCallback(async () => {
    try {
      // Check if WiFi is enabled
      const isEnabled = await WifiManager.isEnabled();
      setWifiEnabled(isEnabled);

      if (isEnabled) {
        // Check if connected to a network
        const isConnected = await WifiManager.connectionStatus();
        // console.log("is Connected: ",isConnected);

        setConnected(isConnected);
      }
    } catch (error) {
      console.error('Error checking WiFi status: ', error);
    }
  }, []);

  const checkBluetoothStatus = useCallback(async () => {
    try {
      const isEnabled = await SystemSetting.isBluetoothEnabled();
      setBluetoothEnabled(isEnabled);
    } catch (error) {
      console.error('Error checking Bluetooth status: ', error);
    }
  }, []);



  // Effect to handle loading timezone and time updates
  useEffect(() => {
    loadTimezone();

    // Initial fetch to prevent 1-second UI layout shift/flicker
    if (isCustomTimeSet && customTime) updateTime(customTime);
    else updateTime();

    DeviceInfo.getPowerState().then(powerState => {
      setBatteryPercentage(Math.round(powerState.batteryLevel * 100));
      setBatteryState(powerState.batteryState);
    });
    checkWifiStatus();
    checkBluetoothStatus();

    // Set interval using BackgroundTimer to update time every second
    const interval = BackgroundTimer.setInterval(() => {
      // If custom time is set, increment it by 1 second every interval
      if (isCustomTimeSet && customTime) {
        const updatedCustomTime = new Date(customTime.getTime() + 1000);
        setCustomTime(updatedCustomTime);
        updateTime(updatedCustomTime);
      } else {
        updateTime(); // Use the current system time if no custom time is set
      }
      // Get battery information
      DeviceInfo.getPowerState().then(powerState => {
        setBatteryPercentage(Math.round(powerState.batteryLevel * 100)); // Set battery percentage
        setBatteryState(powerState.batteryState); // Set battery status (charging, discharging, full, etc.)
      });
      checkWifiStatus();
      checkBluetoothStatus();
      // console.log(batteryPercentage);
    }, 1000);

    // Listen for the 'timeChange' event
    eventEmitter.on('timeChange', newTime => {
      // Update global state
      globalIsCustomTimeSet = true;
      globalCustomTime = newTime;

      // Update local state
      setIsCustomTimeSet(true);
      setCustomTime(newTime);
      updateTime(newTime);
    });



    // Cleanup the interval and event listener when component unmounts
    return () => {
      BackgroundTimer.clearInterval(interval);
      eventEmitter.removeAllListeners('timeChange');

    };
  }, [timezone, isCustomTimeSet, customTime, updateTime, checkWifiStatus, checkBluetoothStatus]);

  return (
    <View style={styles.container}>
      <StatusBar
        backgroundColor={backgroundColor}
        hidden={hidden}
        barStyle={barStyle}
        translucent={translucent}
      />
      <View style={styles.leftContainer}>
        <Text style={styles.time}>{time}</Text>

      </View>
      {/* <Text style={{color: 'white', alignSelf: 'center'}}>Dermscope v4</Text> */}
      <View style={styles.rightContainer}>
        {renderWifiIcon()}
        {renderBluetoothIcon()}
        <View style={styles.batteryContainer}>
          <Text style={styles.info}>{batteryPercentage != null ? `${batteryPercentage}%` : '--%'}</Text>
          {renderBatteryImage()}
        </View>
      </View>
    </View>
  );
};

// Example function to emit time changes from another component
export const changeTime = newTime => {
  eventEmitter.emit('timeChange', newTime);
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    backgroundColor: '#000',
    alignItems: 'center',
    height: 40,
    paddingTop: Platform.OS === 'android' ? 0 : 0,
    position: 'absolute',
    top: 3.5,
    left: 0,
    right: 0,
    zIndex: 9999,
  },
  time: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'ProductSans-Regular',
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    color: '#fff',
    marginLeft: 5,
    fontFamily: 'ProductSans-Regular',
    fontSize: 18,
  },
  batteryImage: {
    width: 29,
    height: 29,
    transform: [{ rotate: '90deg' }],
  },
  wifiIcon: {
    width: 24,
    height: 24,
    marginRight: 8,
  },
  bluetoothIcon: {
    width: 18,
    height: 18,
    tintColor: 'white',
    marginRight: 8,
  },
});

export default CustomStatusBar;