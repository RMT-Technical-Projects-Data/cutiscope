import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, ActivityIndicator, DeviceEventEmitter, NativeModules, AppState, Platform, Modal, StyleSheet } from 'react-native';
import CustomKeyboard from '../shared/ui/CustomKeyboard';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import NetInfo from '@react-native-community/netinfo';
import WelcomeScreen from '../features/auth/WelcomeScreen';
import CameraScreen from '../features/camera/CameraScreen';
import GalleryScreen from '../features/gallery/GalleryScreen';
import SettingsMenu from '../features/settings/SettingsMenu';
import { AuthProvider } from '../features/auth/authSessionContext';
import { CustomKeyboardProvider } from '../shared/ui/CustomKeyboardContext';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import WifiOnboardingScreen from '../features/wifi/WifiOnboardingScreen';
import Orientation from 'react-native-orientation-locker';
import SystemSetting from 'react-native-system-setting';
import CustomStatusBar, {
  APP_STATUS_BAR_SUPPRESS_EVENT,
} from '../shared/ui/CustomStatusBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SerialNumberModal from '../features/device/SerialNumberModal';
import UpdateModal from '../features/device/UpdateModal';
import PowerOffModal from '../features/device/PowerOffModal';
import KioskMode from '../shared/native/KioskMode';
import { SESSION_ACTIVITY_EVENT, showInAppToast } from '../shared/utils/inAppToast';
import firebaseAuthService from '../features/upload/firebaseAuthService';
import { getBaseUrl } from '../features/auth/authService';
import InAppToastHost from './inAppToastHost';
import SessionManager from './appSessionTimeoutManager';
import DeveloperPinModal from './DeveloperPinModal';
import BluetoothNative from '../shared/native/BluetoothNative';

const Stack = createNativeStackNavigator();

const KIOSK_EXIT_PIN = '1801';
const TAP_RESET_MS = 2500;
const TAPS_TO_SHOW_PIN = 100;

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#000',
  },
};

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(null);
  const [showWifiScreen, setShowWifiScreen] = useState(false);
  const [hasSerialNumber, setHasSerialNumber] = useState(true);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [isPowerModalVisible, setIsPowerModalVisible] = useState(false);
  const [isBlackScreenVisible, setIsBlackScreenVisible] = useState(false);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [kioskPinModalVisible, setKioskPinModalVisible] = useState(false);
  const [kioskPinValue, setKioskPinValue] = useState('');
  const [kioskPinError, setKioskPinError] = useState('');
  const kioskPinInputRef = useRef(null);
  const tapCountRef = useRef(0);
  const tapResetTimerRef = useRef(null);
  const [isDeveloperUnlocked, setIsDeveloperUnlocked] = useState(false);
  const [showSerialInput, setShowSerialInput] = useState(false);
  const [serialInputValue, setSerialInputValue] = useState('');
  const [serialInputError, setSerialInputError] = useState('');
  const [currentSerialNumber, setCurrentSerialNumber] = useState('');
  const [isKioskActive, setIsKioskActive] = useState(Platform.OS === 'android');
  const [suppressAppStatusBar, setSuppressAppStatusBar] = useState(false);
  const serialInputRef = useRef(null);
  const navigationRef = useRef(null);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      APP_STATUS_BAR_SUPPRESS_EVENT,
      (suppressed) => setSuppressAppStatusBar(!!suppressed)
    );
    return () => sub.remove();
  }, []);

  // Security requirement: every cold app start/device restart begins logged out.
  // Clear the previous local session before mounting AuthProvider/navigation.
  useEffect(() => {
    const checkAuth = async () => {
      try {
        await AsyncStorage.multiRemove([
          'userToken',
          'userEmail',
          'username',
          'userId',
          '@patient_box',
          'userInfo',
          'accessToken',
          'refreshToken',
          'firebaseIdToken',
        ]);
        // Best-effort cloud clear; no-current-user is normal when never signed into Google.
        await firebaseAuthService.signOut().catch(() => {});
        setIsLoggedIn(false);
        setIsGuestMode(false);
      } catch (e) {
        console.error('Error clearing previous session on startup:', e);
        // Never restore a session when startup cleanup is uncertain.
        setIsLoggedIn(false);
        setIsGuestMode(false);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  // Prefer native ConnectivityModule over NetInfo — Android "Limited" is often a false negative.
  const internetLossTimerRef = useRef(null);
  const isConnectedRef = useRef(isConnected);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const probeInternet = useCallback(async () => {
    const { ConnectivityModule } = NativeModules;
    if (Platform.OS === 'android' && ConnectivityModule?.forceValidateNetwork) {
      try {
        // Ensure captive-portal checks are off, then probe backend + Google 204.
        if (ConnectivityModule.disableCaptivePortalChecks) {
          await ConnectivityModule.disableCaptivePortalChecks();
        }
        const status = await ConnectivityModule.forceValidateNetwork(
          `${getBaseUrl()}/api/health`
        );
        console.log('App - ConnectivityModule status:', status);
        return status === 'WIFI_INTERNET' || status === 'CELLULAR_INTERNET';
      } catch (error) {
        console.warn('App - ConnectivityModule probe failed, falling back to NetInfo:', error);
      }
    }

    const state = await NetInfo.fetch();
    return !!(state?.isConnected && state.isInternetReachable !== false);
  }, []);

  const checkNetworkConnection = useCallback(async () => {
    try {
      const reachable = await probeInternet();
      console.log('App - Internet reachable:', reachable);
      if (reachable) {
        if (internetLossTimerRef.current) {
          clearTimeout(internetLossTimerRef.current);
          internetLossTimerRef.current = null;
        }
        setIsConnected(true);
        return;
      }

      const state = await NetInfo.fetch();
      // Truly offline — fail fast.
      if (!state?.isConnected || state.type === 'none') {
        if (internetLossTimerRef.current) {
          clearTimeout(internetLossTimerRef.current);
          internetLossTimerRef.current = null;
        }
        setIsConnected(false);
        return;
      }

      // Linked but probe failed. Cold start 鈫?onboarding. Was online 鈫?short grace.
      if (isConnectedRef.current !== true) {
        setIsConnected(false);
        return;
      }

      if (internetLossTimerRef.current) {
        return;
      }

      internetLossTimerRef.current = setTimeout(async () => {
        internetLossTimerRef.current = null;
        try {
          const ok = await probeInternet();
          console.log('App - Internet grace expired, reachable:', ok);
          setIsConnected(ok);
        } catch (error) {
          console.error('Error rechecking network after grace:', error);
          setIsConnected(false);
        }
      }, 10000);
    } catch (error) {
      console.error('Error checking network:', error);
      setIsConnected(false);
    }
  }, [probeInternet]);

  useEffect(() => {
    checkNetworkConnection();
    let debounceTimer = null;
    const unsubscribeNetInfo = NetInfo.addEventListener(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        checkNetworkConnection();
      }, 2000);
    });
    return () => {
      unsubscribeNetInfo();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (internetLossTimerRef.current) {
        clearTimeout(internetLossTimerRef.current);
      }
    };
  }, [checkNetworkConnection]);

  // Check for serial number on launch
  useEffect(() => {
    const checkSerialNumber = async () => {
      try {
        const value = await AsyncStorage.getItem('serial_number');
        if (value === null) {
          setHasSerialNumber(false);
        } else {
          if (BluetoothNative.isAvailable()) {
            try {
              await BluetoothNative.setBluetoothName(value);
            } catch (err) {
              console.warn('Bluetooth name sync skipped:', err?.message || err);
            }
          }
        }
      } catch (e) {
        console.error('Error checking serial number:', e);
      }
    };
    checkSerialNumber();
  }, []);

  // Start kiosk mode on app launch (Android only).
  // MainActivity may already start lock-task; JS reinforces once Activity is attached.
  // Bridgeless can race getCurrentActivity() — retry briefly; don't flip active→false on that race.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;

    const startKioskMode = async () => {
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (cancelled) return;
        try {
          const result = await KioskMode.startKioskMode();
          if (cancelled) return;
          console.log('Kiosk mode on launch:', result);
          setIsKioskActive(true);
          return;
        } catch (e) {
          const msg = e?.message || String(e);
          const activityNull = /Current Activity is null|ACTIVITY_NULL/i.test(msg);
          if (activityNull && attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 200 * attempt));
            continue;
          }
          // Native MainActivity often already enabled lock-task; keep optimistic Android default.
          console.warn('Kiosk mode on launch:', msg);
          if (!activityNull) setIsKioskActive(false);
          return;
        }
      }
    };

    const t = setTimeout(startKioskMode, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // 10-tap detector to show exit kiosk PIN modal (Android only)
  const handleKioskTapCount = () => {
    if (Platform.OS !== 'android') return;
    if (tapResetTimerRef.current) {
      clearTimeout(tapResetTimerRef.current);
      tapResetTimerRef.current = null;
    }
    tapCountRef.current += 1;
    if (tapCountRef.current >= TAPS_TO_SHOW_PIN) {
      tapCountRef.current = 0;
      setKioskPinValue('');
      setKioskPinError('');
      setKioskPinModalVisible(true);
    } else {
      tapResetTimerRef.current = setTimeout(() => {
        tapCountRef.current = 0;
        tapResetTimerRef.current = null;
      }, TAP_RESET_MS);
    }
  };

  const fetchCurrentSerialNumber = async () => {
    try {
      const sn = await AsyncStorage.getItem('serial_number');
      setCurrentSerialNumber(sn || '');
    } catch (e) {
      console.error('Failed to fetch serial number:', e);
    }
  };

  const handleKioskPinSubmit = async () => {
    if (kioskPinValue !== KIOSK_EXIT_PIN) {
      setKioskPinError('Incorrect PIN');
      return;
    }
    setKioskPinError('');
    await fetchCurrentSerialNumber();
    setIsDeveloperUnlocked(true);
  };

  const handleToggleKioskMode = async () => {
    try {
      if (isKioskActive) {
        await KioskMode.stopKioskMode();
        setIsKioskActive(false);
      } else {
        await KioskMode.startKioskMode();
        setIsKioskActive(true);
      }
      setKioskPinError('');
    } catch (e) {
      setKioskPinError(e?.message || 'Failed to toggle kiosk mode');
    }
  };

  const handleSaveSerialNumber = async () => {
    if (!serialInputValue.trim()) {
      setSerialInputError('Please enter a serial number');
      return;
    }
    try {
      const serialNum = serialInputValue.trim();
      await AsyncStorage.setItem('serial_number', serialNum);
      setCurrentSerialNumber(serialNum);
      setHasSerialNumber(true);
      setShowSerialInput(false);
      setSerialInputError('');

      if (BluetoothNative.isAvailable()) {
        try {
          const { PermissionsAndroid, Platform } = require('react-native');
          if (Platform.OS === 'android' && Platform.Version >= 31) {
            await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
            );
          }
          await BluetoothNative.setBluetoothName(serialNum);
        } catch (err) {
          console.warn('Bluetooth name update skipped:', err?.message || err);
        }
      }
    } catch (e) {
      setSerialInputError('Failed to save serial number');
    }
  };

  const handleKioskPinClose = () => {
    setKioskPinModalVisible(false);
    setKioskPinValue('');
    setKioskPinError('');
    setIsDeveloperUnlocked(false);
    setShowSerialInput(false);
    setSerialInputValue('');
    setSerialInputError('');
  };

  const lastPowerPressRef = useRef(0);
  const isBlackScreenVisibleRef = useRef(false);
  const usedRootBacklightRef = useRef(false);
   
  // "Lock" simulation: instead of really sleeping the device (which lets Android
  // kill this kiosk process and crash on resume), cover the screen with a full
  // black overlay AND kill the backlight for a true "screen off" look.
  //
  // For the backlight we write the hardware sysfs node via root (blackoutScreen),
  // which is INSTANT and bypasses DisplayPowerController's ramp animation — that
  // ramp is what caused the slow fade with setAppBrightness. Only if root/sysfs
  // is unavailable do we fall back to setAppBrightness (which fades).
  const handleSimulatedLock = useCallback(() => {
    isBlackScreenVisibleRef.current = true;
    setIsBlackScreenVisible(true);
    setIsPowerModalVisible(false);
    DeviceEventEmitter.emit('onPowerMenuClosed');

    const pm = NativeModules?.SystemPowerModule;
    if (pm?.blackoutScreen) {
      pm.blackoutScreen()
        .then((ok) => {
          usedRootBacklightRef.current = !!ok;
          // Only touch window brightness if the instant root path failed and
          // the overlay is still up (user hasn't already unlocked).
          if (!ok && isBlackScreenVisibleRef.current) {
            try { SystemSetting.setAppBrightness(0); } catch (e) {}
          }
        })
        .catch(() => {
          usedRootBacklightRef.current = false;
          if (isBlackScreenVisibleRef.current) {
            try { SystemSetting.setAppBrightness(0); } catch (e) {}
          }
        });
    } else {
      usedRootBacklightRef.current = false;
      try { SystemSetting.setAppBrightness(0); } catch (e) {}
    }
  }, []);

  const handleDismissBlackScreen = useCallback(() => {
    // Swallow follow-up power events so unlock never also opens the power menu.
    lastPowerPressRef.current = Date.now();

    const finishUnlock = () => {
      isBlackScreenVisibleRef.current = false;
      setIsBlackScreenVisible(false);
      DeviceEventEmitter.emit(SESSION_ACTIVITY_EVENT);
      // After CameraScreen's sync power handlers run, clear any transient menu state.
      setTimeout(() => {
        DeviceEventEmitter.emit('onPowerMenuClosed');
      }, 0);
    };

    const pm = NativeModules?.SystemPowerModule;
    const usedRoot = usedRootBacklightRef.current;
    usedRootBacklightRef.current = false;

    // Always restore window brightness immediately (covers non-root path).
    try { SystemSetting.setAppBrightness(-1); } catch (e) {}

    // Keep the black overlay up until backlight is restored, otherwise unlock
    // briefly shows a black panel (backlight still 0) before the UI appears.
    if (usedRoot && typeof pm?.restoreScreenAsync === 'function') {
      const timeout = setTimeout(finishUnlock, 400);
      pm.restoreScreenAsync()
        .catch(() => false)
        .then(() => {
          clearTimeout(timeout);
          finishUnlock();
        });
      return;
    }
    if (usedRoot && pm?.restoreScreen) {
      pm.restoreScreen();
      setTimeout(finishUnlock, 60);
      return;
    }
    finishUnlock();
  }, []);

  // Orientation lock: portrait only (matches Camera outputOrientation="preview")
  useEffect(() => {
    Orientation.lockToPortrait();

    // Listen for power button events (Hardware or JS Request)
    const handleShowPowerMenu = () => {
      const now = Date.now();
      // Physical + accessibility + JS request can all fire close together — one open only.
      if (now - lastPowerPressRef.current < 1200) {
        console.log('Power Menu trigger debounced');
        return;
      }
      lastPowerPressRef.current = now;
      console.log('Showing Power Menu Modal');
      // Notify Camera to hide StandbyModal so it cannot cover this menu.
      DeviceEventEmitter.emit('onPowerMenuOpened');
      // PowerOffModal uses a native Modal window so it stacks above
      // gallery fullscreen (and other) Modals.
      setIsPowerModalVisible(true);
    };

    const handlePhysicalPowerButton = () => {
      if (isBlackScreenVisibleRef.current) {
        handleDismissBlackScreen();
        return;
      }
      handleShowPowerMenu();
    };

    // Ensure native power module is instantiated and its receiver is registered.
    // On newer RN / lazy module initialization, the module may not be created
    // until JS accesses it, which would prevent POWER_BUTTON_PRESSED broadcasts
    // from reaching JS.
    try {
      const powerModule = NativeModules?.SystemPowerModule;
      powerModule?.initializeModule?.();
    } catch (e) {
      console.warn('SystemPowerModule initializeModule failed:', e);
    }

    const subPhysical = DeviceEventEmitter.addListener('onPowerButtonPressed', handlePhysicalPowerButton);
    const subRequest = DeviceEventEmitter.addListener('requestPowerMenu', handleShowPowerMenu);

    const shareSub = DeviceEventEmitter.addListener('onBluetoothShareStatusChanged', (event) => {
      if (event.status === 'accepted') {
        showInAppToast("File transfer request sent to other device", { durationMs: 3000 });
      }
    });

    return () => {
      Orientation.unlockAllOrientations();
      subPhysical.remove();
      subRequest.remove();
      shareSub.remove();
    };
  }, [handleDismissBlackScreen]);

  // Orientation lock: portrait only; re-lock when app becomes active
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        Orientation.lockToPortrait();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (isConnected === false) {
      if (!isLoggedIn && !isGuestMode) {
        setShowWifiScreen(true);
      }
    } else if (isConnected === true) {
      setShowWifiScreen(false);
    }
  }, [isConnected, isLoggedIn, isGuestMode]);

  const handleLoginSuccess = () => {
    setIsLoggedIn(true);
    setIsGuestMode(false);
  };

  const handleGuestContinue = () => {
    setIsGuestMode(true);
    setIsLoggedIn(false);
  };

  const handleSessionLoggedOut = useCallback(() => {
    setIsLoggedIn(false);
    setIsGuestMode(false);
    setShowWifiScreen(false);
  }, []);

  const handleWifiContinue = () => {
    setShowWifiScreen(false);
  };

  const handleWifiSkip = () => {
    setShowWifiScreen(false);
    setIsGuestMode(true);
  };

  // Automatic Update Check
  useEffect(() => {
    const checkUpdates = async () => {
      try {
        const result = await NativeModules.AppUpdateModule.checkForUpdate();
        if (result && result.isAvailable) {
          setUpdateInfo({
            versionName: result.versionName || "New Version",
            releaseNotes: result.releaseNotes || "Performance improvements and bug fixes.",
            downloadUrl: result.downloadUrl || "",
            forceUpdate: false
          });
          setIsUpdateModalVisible(true);
        }
      } catch (e) {
        console.error("Update check failed:", e);
      }
    };

    if (isConnected) {
      checkUpdates();
    }

    // Listen for download completion from native module
    const downloadSub = DeviceEventEmitter.addListener('onUpdateDownloaded', () => {
      setUpdateInfo(prev => prev ? { ...prev, downloadComplete: true, progress: 100 } : prev);
    });

    // Listen for download progress
    const progressSub = DeviceEventEmitter.addListener('onUpdateDownloadProgress', (data) => {
      setUpdateInfo(prev => prev ? { ...prev, progress: data.progress } : prev);
    });

    return () => {
      downloadSub.remove();
      progressSub.remove();
    };
  }, [isConnected]);

  if (isLoading || isConnected === null) {
    return (
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000'
      }}>
        <ActivityIndicator size="large" color="#22B2A6" />
      </View>
    );
  }

  return (
    <AuthProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <CustomKeyboardProvider>
          <SafeAreaProvider>
            <SafeAreaView edges={[]} style={{ flex: 1, paddingTop: 0, backgroundColor: '#000' }}>
              <View
                style={styles.kioskTapOverlay}
                onStartShouldSetResponder={() => Platform.OS === 'android'}
                onResponderTerminationRequest={() => true}
                onResponderGrant={() => {
                  handleKioskTapCount();
                  DeviceEventEmitter.emit(SESSION_ACTIVITY_EVENT);
                }}
                onTouchStart={() => DeviceEventEmitter.emit(SESSION_ACTIVITY_EVENT)}
                collapsable={false}
              >
                {/* Relative status bar must be first so it stays at the top. */}
                {!suppressAppStatusBar && <CustomStatusBar />}
                {showWifiScreen ? (
                  <WifiOnboardingScreen
                    onContinue={handleWifiContinue}
                    onSkip={handleWifiSkip}
                  />
                ) : (
                  <NavigationContainer
                    ref={navigationRef}
                    theme={navTheme}
                    onStateChange={() => DeviceEventEmitter.emit(SESSION_ACTIVITY_EVENT)}
                  >
                    <Stack.Navigator
                      initialRouteName={isLoggedIn ? 'Camera' : 'Welcome'}
                      screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: '#000' },
                        screenOrientation: 'portrait',
                        statusBarHidden: true,
                        statusBarTranslucent: true,
                        statusBarBackgroundColor: 'transparent',
                      }}
                    >
                      <Stack.Screen
                        name="Welcome"
                        options={{ animation: 'none' }}
                      >
                        {(props) => (
                          <WelcomeScreen
                            {...props}
                            onLoginSuccess={handleLoginSuccess}
                            onGuestContinue={handleGuestContinue}
                          />
                        )}
                      </Stack.Screen>
                      <Stack.Screen
                        name="WifiOnboarding"
                        options={{ animation: 'none' }}
                      >
                        {(props) => (
                          <WifiOnboardingScreen
                            {...props}
                            onContinue={() => props.navigation.goBack()}
                            onSkip={() => props.navigation.goBack()}
                          />
                        )}
                      </Stack.Screen>
                      <Stack.Screen name="Camera" component={CameraScreen} />
                      <Stack.Screen name="Gallery" component={GalleryScreen} />
                      <Stack.Screen name="Settings" component={SettingsMenu} />
                    </Stack.Navigator>
                  </NavigationContainer>
                )}
                <SessionManager
                  active={isLoggedIn}
                  navigationRef={navigationRef}
                  onLoggedOut={handleSessionLoggedOut}
                />
                <SerialNumberModal
                  visible={!hasSerialNumber}
                  onComplete={async (sn) => {
                    setHasSerialNumber(true);
                    if (sn) {
                      setCurrentSerialNumber(sn);
                      if (BluetoothNative.isAvailable()) {
                        try {
                          // Android 12+ needs BLUETOOTH_CONNECT; request then set name.
                          const { PermissionsAndroid, Platform } = require('react-native');
                          if (Platform.OS === 'android' && Platform.Version >= 31) {
                            await PermissionsAndroid.request(
                              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
                            );
                          }
                          await BluetoothNative.setBluetoothName(sn);
                        } catch (e) {
                          // Non-fatal — serial is saved; BT name can be set later from settings.
                          console.warn('Bluetooth name not set (permission or adapter):', e?.message || e);
                        }
                      }
                    }
                  }}
                />
                <PowerOffModal
                  visible={isPowerModalVisible}
                  onLock={handleSimulatedLock}
                  onClose={() => {
                    console.log('馃攲 Power Menu Modal Closed');
                    setIsPowerModalVisible(false);
                    DeviceEventEmitter.emit('onPowerMenuClosed');
                  }}
                />
                {isBlackScreenVisible && (
                  <Modal
                    visible
                    transparent
                    animationType="none"
                    statusBarTranslucent
                    hardwareAccelerated
                    onRequestClose={() => {}}
                  >
                    <View
                      style={styles.blackScreenOverlay}
                      onStartShouldSetResponder={() => true}
                      onMoveShouldSetResponder={() => true}
                      onResponderTerminationRequest={() => false}
                      collapsable={false}
                    />
                  </Modal>
                )}
                <DeveloperPinModal
                  visible={kioskPinModalVisible}
                  onClose={handleKioskPinClose}
                  pinValue={kioskPinValue}
                  pinError={kioskPinError}
                  onPinChange={(t) => { setKioskPinValue(t.replace(/\D/g, '').slice(0, 4)); setKioskPinError(''); }}
                  onPinSubmit={handleKioskPinSubmit}
                  pinInputRef={kioskPinInputRef}
                  isDeveloperUnlocked={isDeveloperUnlocked}
                  showSerialInput={showSerialInput}
                  serialValue={serialInputValue}
                  serialError={serialInputError}
                  onSerialChange={(t) => { setSerialInputValue(t); setSerialInputError(''); }}
                  onSaveSerial={handleSaveSerialNumber}
                  onCancelSerial={() => { setShowSerialInput(false); setSerialInputError(''); }}
                  onShowSerialInput={() => {
                    setSerialInputValue(currentSerialNumber);
                    setShowSerialInput(true);
                  }}
                  serialInputRef={serialInputRef}
                  currentSerialNumber={currentSerialNumber}
                  isKioskActive={isKioskActive}
                  onToggleKiosk={handleToggleKioskMode}
                />
                <CustomKeyboard />
                <UpdateModal
                  isVisible={isUpdateModalVisible}
                  updateInfo={updateInfo}
                  onClose={() => setIsUpdateModalVisible(false)}
                />
                <InAppToastHost />

              </View>
            </SafeAreaView>
          </SafeAreaProvider>
        </CustomKeyboardProvider>
      </GestureHandlerRootView>
    </AuthProvider>
  );
};

const styles = StyleSheet.create({
  kioskTapOverlay: {
    flex: 1,
  },
  blackScreenOverlay: {
    flex: 1,
    backgroundColor: '#000',
  },
});

export default App;
