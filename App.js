import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, ActivityIndicator, DeviceEventEmitter, NativeModules, AppState, Platform, Modal, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import KioskTextInput from './Components/KioskTextInput';
import CustomKeyboard from './Components/CustomKeyboard';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import NetInfo from '@react-native-community/netinfo';
import WelcomeScreen from './screens/WelcomeScreen';
import CameraScreen from './screens/CameraScreen';
import GalleryScreen from './screens/GalleryScreen';
import SettingsMenu from './modals/SettingsMenu';
import { AuthProvider } from './context/AuthContext';
import { CustomKeyboardProvider } from './context/CustomKeyboardContext';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import WifiOnboardingScreen from './screens/WifiOnboardingScreen';
import Orientation from 'react-native-orientation-locker';
import CustomStatusBar from './Components/CustomStatusBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SerialNumberModal from './modals/SerialNumberModal';
import UpdateModal from './modals/UpdateModal';
import PowerOffModal from './modals/PowerOffModal';
import SessionTimeoutModal from './modals/SessionTimeoutModal';
import KioskMode from './utils/KioskMode';
import { IN_APP_TOAST_EVENT, SESSION_ACTIVITY_EVENT, showInAppToast } from './utils/Helpers';
import { useAuth } from './context/AuthContext';
import firebaseAuthService from './services/firebaseAuthService';
import {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_CHANGED_EVENT,
  SESSION_TIMEOUT_OPTIONS,
  getSessionTimeoutMinutes,
} from './utils/sessionSettings';

const Stack = createNativeStackNavigator();

const KIOSK_EXIT_PIN = '1801';
const TAP_RESET_MS = 2500;
const TAPS_TO_SHOW_PIN = 100;
const SESSION_LOGOUT_COUNTDOWN_SECONDS = 10;
const SESSION_WARNING_MS = SESSION_LOGOUT_COUNTDOWN_SECONDS * 1000;

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#000',
  },
};

const positionToContainerStyle = (position) => {
  // Capture status must stay above the 150px camera control bar.
  if (position === 'aboveCapture') {
    return { top: undefined, bottom: 170, justifyContent: 'flex-end' }; 
  }
  // Other notifications retain the native Android-style bottom position.
  return { top: undefined, bottom: 80, justifyContent: 'flex-end' };
};

const InAppToastHost = () => {
  const [toast, setToast] = useState(null); // { message, durationMs, position }
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(IN_APP_TOAST_EVENT, (payload) => {
      const next = {
        message: payload?.message ?? '',
        durationMs: payload?.durationMs ?? 1400,
        position: payload?.position ?? 'bottom',
      };

      setToast(next);

      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

      opacity.stopAnimation();
      translateY.stopAnimation();
      opacity.setValue(0);
      translateY.setValue(6);

      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 120, useNativeDriver: true }),
      ]).start();

      hideTimerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 6, duration: 180, useNativeDriver: true }),
        ]).start(({ finished }) => {
          if (finished) setToast(null);
        });
      }, Math.max(600, Number(next.durationMs) || 1400));
    });

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      sub.remove();
    };
  }, [opacity, translateY]);

  if (!toast) return null;

  const containerPos = positionToContainerStyle(toast.position);

  return (
    <View pointerEvents="none" style={[toastStyles.container, containerPos]}>
      <Animated.View style={[toastStyles.toast, { opacity, transform: [{ translateY }] }]}>
        <Text style={toastStyles.text}>{toast.message}</Text>
      </Animated.View>
    </View>
  );
};

const SessionManager = ({ active, navigationRef, onLoggedOut }) => {
  const { signOut, userData } = useAuth();
  const sessionActive = active && !!userData;
  const [promptVisible, setPromptVisible] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(SESSION_LOGOUT_COUNTDOWN_SECONDS);
  const [inactivityMinutes, setInactivityMinutes] = useState(DEFAULT_SESSION_TIMEOUT_MINUTES);
  const inactivityDeadlineRef = useRef(0);
  const logoutDeadlineRef = useRef(0);
  const promptVisibleRef = useRef(false);
  const logoutInProgressRef = useRef(false);
  const inactivityMsRef = useRef(DEFAULT_SESSION_TIMEOUT_MINUTES * 60 * 1000);

  const startFreshSessionWindow = useCallback(() => {
    promptVisibleRef.current = false;
    setPromptVisible(false);
    setSecondsRemaining(SESSION_LOGOUT_COUNTDOWN_SECONDS);
    logoutDeadlineRef.current = 0;
    // 10s logout modal only starts AFTER this inactivity window expires.
    inactivityDeadlineRef.current = Date.now() + inactivityMsRef.current;
  }, []);

  const applyInactivityMinutes = useCallback((minutes) => {
    const next = SESSION_TIMEOUT_OPTIONS.includes(Number(minutes))
      ? Number(minutes)
      : DEFAULT_SESSION_TIMEOUT_MINUTES;
    setInactivityMinutes(next);
    inactivityMsRef.current = next * 60 * 1000;
    startFreshSessionWindow();
  }, [startFreshSessionWindow]);

  const performLogout = useCallback(async () => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;
    promptVisibleRef.current = false;
    setPromptVisible(false);

    // Navigate to login first so Settings/Camera never flash guest-mode UI mid-logout.
    onLoggedOut();
    navigationRef.current?.resetRoot?.({
      index: 0,
      routes: [{ name: 'Welcome' }],
    });

    try {
      await signOut();
      await AsyncStorage.multiRemove([
        'userId',
        '@patient_box',
        'userInfo',
        'accessToken',
        'refreshToken',
        'firebaseIdToken',
      ]);
      try {
        await firebaseAuthService.signOut();
      } catch (cloudError) {
        // Ignore expected no-user cases during forced logout.
        const msg = String(cloudError?.message || cloudError || '');
        if (!/no-current-user|No user currently signed in/i.test(msg)) {
          console.warn('Cloud sign-out during session expiry failed:', msg);
        }
      }
    } catch (error) {
      console.error('Session logout failed:', error);
      // Security-first fallback: remove local credentials even if a service sign-out fails.
      await AsyncStorage.multiRemove([
        'userToken',
        'userEmail',
        'username',
        'userId',
        '@patient_box',
      ]).catch(() => {});
    } finally {
      logoutInProgressRef.current = false;
    }
  }, [navigationRef, onLoggedOut, signOut]);

  const checkDeadlines = useCallback(() => {
    if (!sessionActive || logoutInProgressRef.current) return;
    const now = Date.now();

    // Phase 2: 10s logout modal countdown (only after inactivity expired).
    if (promptVisibleRef.current) {
      const remaining = Math.max(0, Math.ceil((logoutDeadlineRef.current - now) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) performLogout();
      return;
    }

    // Phase 1: wait for Settings inactivity timer (30/60/90/120 minutes).
    if (now >= inactivityDeadlineRef.current) {
      promptVisibleRef.current = true;
      logoutDeadlineRef.current = now + SESSION_WARNING_MS;
      setSecondsRemaining(SESSION_LOGOUT_COUNTDOWN_SECONDS);
      setPromptVisible(true);
    }
  }, [performLogout, sessionActive]);

  useEffect(() => {
    if (sessionActive) {
      // Hold deadline until persisted inactivity minutes are loaded.
      inactivityDeadlineRef.current = Number.MAX_SAFE_INTEGER;
      let cancelled = false;
      getSessionTimeoutMinutes().then((minutes) => {
        if (cancelled) return;
        applyInactivityMinutes(minutes);
      });
      return () => {
        cancelled = true;
      };
    }

    promptVisibleRef.current = false;
    setPromptVisible(false);
    inactivityDeadlineRef.current = 0;
    logoutDeadlineRef.current = 0;
    return undefined;
  }, [applyInactivityMinutes, sessionActive]);

  useEffect(() => {
    if (!sessionActive) return undefined;

    const activitySub = DeviceEventEmitter.addListener(SESSION_ACTIVITY_EVENT, () => {
      // Once the 10s warning is open, only Stay Logged In renews the session.
      if (!promptVisibleRef.current) {
        inactivityDeadlineRef.current = Date.now() + inactivityMsRef.current;
      }
    });
    const timeoutChangedSub = DeviceEventEmitter.addListener(
      SESSION_TIMEOUT_CHANGED_EVENT,
      (minutes) => {
        applyInactivityMinutes(minutes);
      }
    );
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') checkDeadlines();
    });
    const interval = setInterval(checkDeadlines, 250);

    return () => {
      activitySub.remove();
      timeoutChangedSub.remove();
      appStateSub.remove();
      clearInterval(interval);
    };
  }, [applyInactivityMinutes, checkDeadlines, sessionActive]);

  return (
    <SessionTimeoutModal
      visible={sessionActive && promptVisible}
      secondsRemaining={secondsRemaining}
      inactivityMinutes={inactivityMinutes}
      onStayLoggedIn={startFreshSessionWindow}
      onLogout={performLogout}
    />
  );
};

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(null);
  const [showWifiScreen, setShowWifiScreen] = useState(false);
  const [hasSerialNumber, setHasSerialNumber] = useState(true);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [isPowerModalVisible, setIsPowerModalVisible] = useState(false);
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
  const serialInputRef = useRef(null);
  const navigationRef = useRef(null);

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

  // Check network connectivity
  const checkNetworkConnection = async () => {
    try {
      const state = await NetInfo.fetch();
      const connected = state.isConnected && (state.isInternetReachable !== false);
      setIsConnected(connected);
    } catch (error) {
      console.error('Error checking network:', error);
      setIsConnected(false);
    }
  };

  useEffect(() => {
    checkNetworkConnection();
    const unsubscribeNetInfo = NetInfo.addEventListener(state => {
      const connected = state.isConnected && (state.isInternetReachable !== false);
      setIsConnected(connected);
    });
    return () => unsubscribeNetInfo();
  }, []);

  // Check for serial number on launch
  useEffect(() => {
    const checkSerialNumber = async () => {
      try {
        const value = await AsyncStorage.getItem('serial_number');
        if (value === null) {
          setHasSerialNumber(false);
        } else {
          if (NativeModules.SystemTimeModule?.setBluetoothName) {
            try {
              await NativeModules.SystemTimeModule.setBluetoothName(value);
            } catch (err) {
              console.error('Failed to sync Bluetooth name on launch:', err);
            }
          }
        }
      } catch (e) {
        console.error('Error checking serial number:', e);
      }
    };
    checkSerialNumber();
  }, []);

  // Start kiosk mode on app launch (Android only)
  useEffect(() => {
    const startKioskMode = async () => {
      if (Platform.OS !== 'android') return;
      try {
        const result = await KioskMode.startKioskMode();
        console.log('Kiosk mode on launch:', result);
        setIsKioskActive(true);
      } catch (e) {
        console.error('Kiosk mode on launch:', e);
        setIsKioskActive(false);
      }
    };
    startKioskMode();
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

      if (NativeModules.SystemTimeModule?.setBluetoothName) {
        try {
          await NativeModules.SystemTimeModule.setBluetoothName(serialNum);
        } catch (err) {
          console.error('Failed to update Bluetooth name on save:', err);
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

  // Autofocus serial number input when shown
  useEffect(() => {
    if (showSerialInput) {
      const t = setTimeout(() => {
        try {
          serialInputRef.current?.focus?.();
        } catch (e) { }
      }, 80);
      return () => clearTimeout(t);
    }
  }, [showSerialInput]);

  // When kiosk PIN modal opens, auto-focus the input so CustomKeyboard shows.
  useEffect(() => {
    if (!kioskPinModalVisible) return;
    const t = setTimeout(() => {
      try {
        kioskPinInputRef.current?.focus?.();
      } catch (e) { }
    }, 80);
    return () => clearTimeout(t);
  }, [kioskPinModalVisible]);

  const lastPowerPressRef = useRef(0);

  // Orientation lock: portrait only; re-lock when app becomes active
  useEffect(() => {
    Orientation.lockToPortrait();

    // Listen for power button events (Hardware or JS Request)
    const handleShowPowerMenu = () => {
      const now = Date.now();
      if (now - lastPowerPressRef.current < 500) {
        console.log('🔌 Power Menu trigger debounced');
        return;
      }
      lastPowerPressRef.current = now;
      console.log('🔌 Showing Power Menu Modal');
      // Notify Camera to hide StandbyModal so it cannot cover this menu.
      DeviceEventEmitter.emit('onPowerMenuOpened');
      // Keep the menu in the existing app window so opening it cannot resize or
      // shift the screen underneath it.
      setIsPowerModalVisible(true);
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

    const subPhysical = DeviceEventEmitter.addListener('onPowerButtonPressed', handleShowPowerMenu);
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
  }, []);

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
                <CustomStatusBar />
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
                      if (NativeModules.SystemTimeModule?.setBluetoothName) {
                        try {
                          await NativeModules.SystemTimeModule.setBluetoothName(sn);
                        } catch (e) {
                          console.error('Failed to set bluetooth name on complete:', e);
                        }
                      }
                    }
                  }}
                />
                <PowerOffModal
                  visible={isPowerModalVisible}
                  onClose={() => {
                    console.log('🔌 Power Menu Modal Closed');
                    setIsPowerModalVisible(false);
                    DeviceEventEmitter.emit('onPowerMenuClosed');
                  }}
                />
                <Modal
                  visible={kioskPinModalVisible}
                  transparent
                  animationType="fade"
                  onRequestClose={handleKioskPinClose}
                >
                  <View style={styles.kioskPinOverlay}>
                    <View style={styles.kioskPinContent}>
                      <View style={styles.kioskPinBox}>
                        {!isDeveloperUnlocked ? (
                          <>
                            <Text style={styles.kioskPinTitle}>Enter Developer Mode</Text>
                            <Text style={styles.kioskPinSubtitle}>Enter PIN</Text>
                            <KioskTextInput
                              ref={kioskPinInputRef}
                              style={[styles.kioskPinInput, kioskPinError ? styles.kioskPinInputError : null]}
                              value={kioskPinValue}
                              onChangeText={(t) => { setKioskPinValue(t.replace(/\D/g, '').slice(0, 4)); setKioskPinError(''); }}
                              maxLength={4}
                              placeholder="••••"
                              placeholderTextColor="#666"
                              secureTextEntry
                              keyboardType="numeric"
                              hostKeyboardLocally
                            />
                            {kioskPinError ? <Text style={styles.kioskPinErrorText}>{kioskPinError}</Text> : null}
                            <View style={styles.kioskPinButtons}>
                              <TouchableOpacity style={styles.kioskPinCancelBtn} onPress={handleKioskPinClose}>
                                <Text style={styles.kioskPinCancelText}>Cancel</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.kioskPinUnlockBtn} onPress={handleKioskPinSubmit}>
                                <Text style={styles.kioskPinUnlockText}>Unlock</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        ) : showSerialInput ? (
                          <>
                            <Text style={styles.kioskPinTitle}>Set Serial Number</Text>
                            <Text style={styles.kioskPinSubtitle}>Enter device serial number</Text>
                            <KioskTextInput
                              ref={serialInputRef}
                              style={[styles.kioskPinInput, serialInputError ? styles.kioskPinInputError : null]}
                              value={serialInputValue}
                              onChangeText={(t) => { setSerialInputValue(t); setSerialInputError(''); }}
                              // placeholder="Serial Number"
                              placeholderTextColor="#666"
                              autoCapitalize="characters"
                              autoCorrect={false}
                              hostKeyboardLocally
                            />
                            {serialInputError ? <Text style={styles.kioskPinErrorText}>{serialInputError}</Text> : null}
                            <View style={styles.kioskPinButtons}>
                              <TouchableOpacity style={styles.kioskPinCancelBtn} onPress={() => { setShowSerialInput(false); setSerialInputError(''); }}>
                                <Text style={styles.kioskPinCancelText}>Cancel</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.kioskPinUnlockBtn} onPress={handleSaveSerialNumber}>
                                <Text style={styles.kioskPinUnlockText}>Save</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        ) : (
                          <>
                            <Text style={styles.kioskPinTitle}>Developer Options</Text>
                            <Text style={styles.kioskPinSubtitle}>
                              Serial Number: {currentSerialNumber || 'Not Set'}
                            </Text>

                            <TouchableOpacity
                              style={styles.devMenuOptionBtn}
                              onPress={() => {
                                setSerialInputValue(currentSerialNumber);
                                setShowSerialInput(true);
                              }}
                            >
                              <Text style={styles.devMenuOptionText}>Set Serial Number</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[
                                styles.devMenuOptionBtn,
                                isKioskActive ? styles.devMenuKioskOnBtn : styles.devMenuKioskOffBtn
                              ]}
                              onPress={handleToggleKioskMode}
                            >
                              <Text style={styles.devMenuOptionText}>
                                {isKioskActive ? 'Turn Kiosk Mode OFF' : 'Turn Kiosk Mode ON'}
                              </Text>
                            </TouchableOpacity>

                            {kioskPinError ? <Text style={styles.kioskPinErrorText}>{kioskPinError}</Text> : null}

                            <View style={styles.kioskPinButtons}>
                              <TouchableOpacity style={styles.kioskPinCancelBtn} onPress={handleKioskPinClose}>
                                <Text style={styles.kioskPinCancelText}>Close</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        )}
                      </View>
                    </View>
                    {/* Custom keyboard must be inside Modal on Android (Modal is separate window). */}
                    <CustomKeyboard localHost />
                  </View>
                </Modal>
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
  kioskPinOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  kioskPinContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  kioskPinBox: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  kioskPinTitle: {
    fontSize: 20,
    fontFamily: 'ProductSans-Bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  kioskPinSubtitle: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 16,
  },
  kioskPinInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 24,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  kioskPinInputError: {
    borderColor: '#d32f2f',
  },
  kioskPinErrorText: {
    fontSize: 13,
    color: '#ff5252',
    textAlign: 'center',
    marginBottom: 12,
  },
  kioskPinButtons: {
    flexDirection: 'row',
    marginTop: 8,
  },
  kioskPinCancelBtn: {
    flex: 1,
    marginRight: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#333',
    alignItems: 'center',
  },
  kioskPinCancelText: {
    color: '#aaa',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  kioskPinUnlockBtn: {
    flex: 1,
    marginLeft: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#22B2A6',
    alignItems: 'center',
  },
  kioskPinUnlockText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  devMenuOptionBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
    marginBottom: 12,
  },
  devMenuOptionText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  devMenuKioskOnBtn: {
    borderColor: '#22B2A6',
    backgroundColor: '#1b3a36',
  },
  devMenuKioskOffBtn: {
    borderColor: '#ff5252',
    backgroundColor: '#3a1b1b',
  },
});

const toastStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toast: {
    maxWidth: 360,
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    fontFamily: 'ProductSans-Regular',
  },
});

export default App;