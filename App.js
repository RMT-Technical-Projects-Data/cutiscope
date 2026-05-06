import React, { useState, useEffect, useRef } from 'react';
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
import KioskMode from './utils/KioskMode';
import { IN_APP_TOAST_EVENT } from './utils/Helpers';

const Stack = createNativeStackNavigator();

const KIOSK_EXIT_PIN = '2621';
const TAP_RESET_MS = 2500;
const TAPS_TO_SHOW_PIN = 100;

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#000',
  },
};

const positionToContainerStyle = (position) => {
  // All positions map to bottom to mimic native Android system toasts
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

  // Check initial auth state
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await AsyncStorage.getItem('userToken');
        setIsLoggedIn(!!token);
      } catch (e) {
        console.error('Error checking auth:', e);
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
      } catch (e) {
        console.error('Kiosk mode on launch:', e);
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

  const handleKioskPinSubmit = async () => {
    if (kioskPinValue !== KIOSK_EXIT_PIN) {
      setKioskPinError('Incorrect PIN');
      return;
    }
    setKioskPinError('');
    try {
      await KioskMode.stopKioskMode();
      setKioskPinModalVisible(false);
      setKioskPinValue('');
    } catch (e) {
      setKioskPinError(e?.message || 'Failed to exit kiosk mode');
    }
  };

  const handleKioskPinClose = () => {
    setKioskPinModalVisible(false);
    setKioskPinValue('');
    setKioskPinError('');
  };

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

  // Orientation lock: portrait only; re-lock when app becomes active
  useEffect(() => {
    Orientation.lockToPortrait();

    // Listen for power button events (Hardware or JS Request)
    const handleShowPowerMenu = () => {
      console.log('🔌 Toggling Power Menu Modal');
      setIsPowerModalVisible(prev => !prev);
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

    return () => {
      Orientation.unlockAllOrientations();
      subPhysical.remove();
      subRequest.remove();
    };
  }, []);

  // Re-lock orientation to portrait when app becomes active (e.g. after background)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        Orientation.lockToPortrait();
      }
    });
    return () => subscription.remove();
  }, []);

  // Close power modal when app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        console.log('📱 App going to background/inactive, hiding Power Modal');
        setIsPowerModalVisible(false);
      }
    });

    return () => {
      subscription.remove();
    };
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
  };

  const handleGuestContinue = () => {
    setIsGuestMode(true);
  };

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
            <SafeAreaView style={{ flex: 1, paddingTop: 0, backgroundColor: '#000' }}>
              <View
                style={styles.kioskTapOverlay}
                onStartShouldSetResponder={() => Platform.OS === 'android'}
                onResponderTerminationRequest={() => true}
                onResponderGrant={handleKioskTapCount}
                collapsable={false}
              >
                <CustomStatusBar />
                {showWifiScreen ? (
                  <WifiOnboardingScreen
                    onContinue={handleWifiContinue}
                    onSkip={handleWifiSkip}
                  />
                ) : (
                  <NavigationContainer theme={navTheme}>
                    <Stack.Navigator
                      initialRouteName={isLoggedIn ? 'Camera' : 'Welcome'}
                      screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: '#000' },
                        screenOrientation: 'portrait',
                      }}
                    >
                      <Stack.Screen name="Welcome">
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
                <SerialNumberModal
                  visible={!hasSerialNumber}
                  onComplete={() => setHasSerialNumber(true)}
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
                      </View>
                    </View>
                    {/* Custom keyboard must be inside Modal on Android (Modal is separate window). */}
                    <CustomKeyboard />
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