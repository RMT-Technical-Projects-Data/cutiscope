import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  FlatList,
  PermissionsAndroid,
  Dimensions,
  ActivityIndicator,
  Modal,
  VirtualizedList,
  NativeModules,
  AppState,
  Platform,
  SectionList,
  ScrollView,
} from 'react-native';
import { showInAppToast } from '../utils/Helpers';
import KioskTextInput from '../Components/KioskTextInput';
import CustomKeyboard from '../Components/CustomKeyboard';
import WifiManager from 'react-native-wifi-reborn';
const { SystemTimeModule } = NativeModules;
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import VerticalDivider from '../Components/VerticalDivider';
import {
  normalizeSSID,
  getPasswordForSSID,
  normalizePasswordMap,
  getAdaptiveScanInterval,
  getScanFailureBackoffMs,
  getNetworkListFingerprint,
  persistSavedNetworkSSID,
  removePersistedSavedNetworkSSID,
} from '../utils/wifiHelpers';

const WIFI_ICON = require('../assets/icon_wifi.png');

const { width, height } = Dimensions.get('window');

// Debounce utility function
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timeoutRef = useRef();

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay]);

  return debouncedValue;
};

const WifiOnboardingScreen = ({ route, onContinue, onSkip }) => {
  const isIntentional = route?.params?.isIntentional || false;
  const [hasUserSuccessfullyConnected, setHasUserSuccessfullyConnected] = useState(false);
  const [wifiEnabled, setWifiEnabled] = useState(true);
  const [networks, setNetworks] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [password, setPassword] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState(null);
  const [connectedNetworks, setConnectedNetworks] = useState({});
  const [isConnecting, setIsConnecting] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [lastScanTime, setLastScanTime] = useState(0);
  const [scanAttemptCount, setScanAttemptCount] = useState(0);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [networkPasswords, setNetworkPasswords] = useState({});

  // Refs for managing intervals and timeouts
  const scanTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  const networksCacheRef = useRef([]);
  const scanRetryCountRef = useRef(0);
  const shouldForceScanRef = useRef(false);
  const lastNetworkCountRef = useRef(0);
  const scanInProgressRef = useRef(false);
  const lastNetworksUpdateRef = useRef(0);
  const scanSessionStartRef = useRef(0);
  const isConnectingRef = useRef(false);
  const lastNetworkFingerprintRef = useRef('');
  const scanNetworksRef = useRef(null);

  // Debounced networks to prevent flickering
  const debouncedNetworks = useDebounce(networks, 500);

  // === PERSISTENCE FUNCTIONS ===
  const loadSavedPasswords = async () => {
    try {
      const saved = await AsyncStorage.getItem('@wifi_passwords');
      if (saved) {
        const parsedPasswords = JSON.parse(saved);
        setNetworkPasswords(normalizePasswordMap(parsedPasswords));
        console.log('Loaded saved passwords:', Object.keys(normalizePasswordMap(parsedPasswords)).length);
      }
    } catch (error) {
      console.warn('Error loading saved passwords:', error);
    }
  };

  const savePasswordToStorage = async (ssid, password) => {
    try {
      const normalizedSSID = normalizeSSID(ssid);
      if (!normalizedSSID) return;
      await persistSavedNetworkSSID(normalizedSSID);
      setNetworkPasswords(prev => {
        const updated = { ...prev, [normalizedSSID]: password };
        AsyncStorage.setItem('@wifi_passwords', JSON.stringify(updated))
          .catch(err => console.warn('Error saving to AsyncStorage:', err));
        return updated;
      });
      console.log('Password updated in state and storage for:', normalizedSSID);
    } catch (error) {
      console.warn('Error in savePasswordToStorage:', error);
    }
  };

  const removePasswordFromStorage = async (ssid) => {
    try {
      await removePersistedSavedNetworkSSID(ssid);
      setNetworkPasswords(prev => {
        const updated = { ...prev };
        delete updated[ssid];
        AsyncStorage.setItem('@wifi_passwords', JSON.stringify(updated))
          .catch(err => console.warn('Error saving to AsyncStorage:', err));
        return updated;
      });
      console.log('Password removed from state and storage for:', ssid);
    } catch (error) {
      console.warn('Error in removePasswordFromStorage:', error);
    }
  };

  // Initialize/cleanup
  useEffect(() => {
    isMountedRef.current = true;
    shouldForceScanRef.current = false;

    // Load saved passwords on mount
    loadSavedPasswords();

    // Immediately check if already connected to WiFi
    fetchCurrentNetwork();

    // Setup app state listener
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isMountedRef.current = false;
      clearAllTimeouts();
      subscription.remove();
    };
  }, []);

  // Handle app state changes (foreground/background)
  const handleAppStateChange = useCallback((nextAppState) => {
    setAppState(nextAppState);

    if (nextAppState === 'active') {
      // App came back to foreground, reset and scan
      console.log('App resumed, resetting scan state');
      shouldForceScanRef.current = true;
      setScanAttemptCount(0);
      scanRetryCountRef.current = 0;
      if (wifiEnabled) {
        scanNetworksRef.current?.(true);
      }
    }
  }, [wifiEnabled]);

  // Clear all timeouts
  const clearAllTimeouts = () => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
  };

  const pauseScanning = useCallback(() => {
    clearAllTimeouts();
  }, []);

  const scheduleNextScan = useCallback((options = {}) => {
    const {
      resetAdaptive = false,
      useFailureBackoff = false,
    } = options;

    clearAllTimeouts();

    if (!isMountedRef.current || isConnectingRef.current || !wifiEnabled) {
      return;
    }

    if (resetAdaptive) {
      scanSessionStartRef.current = Date.now();
      scanRetryCountRef.current = 0;
    }

    if (scanRetryCountRef.current >= 3 && useFailureBackoff) {
      console.log('Too many scan failures, stopping auto-scan');
      showInAppToast('WiFi scanning stopped due to failures', { durationMs: 3500 });
      return;
    }

    const interval = useFailureBackoff && scanRetryCountRef.current > 0
      ? getScanFailureBackoffMs(scanRetryCountRef.current)
      : getAdaptiveScanInterval(scanSessionStartRef.current, false);

    scanTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current && !isConnectingRef.current) {
        scanNetworksRef.current?.();
      }
    }, interval);
  }, [wifiEnabled]);

  const resumeScanning = useCallback((resetAdaptive = false) => {
    scheduleNextScan({ resetAdaptive });
  }, [scheduleNextScan]);

  // Check internet connection
  const checkInternetConnection = useCallback(async () => {
    setCheckingConnection(true);
    try {
      const state = await NetInfo.fetch();
      // On Android, isInternetReachable can be null or unreliable
      const connected = state.isConnected && (state.isInternetReachable !== false);
      console.log('WifiOnboardingScreen - Initial connection check:', {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
        connected
      });
      setIsConnected(connected);
      if (connected && connectionStatus !== 'verifying' && connectionStatus !== 'connecting') {
        setConnectionStatus('connected');
      }
    } catch (error) {
      console.error('Error checking internet:', error);
      setIsConnected(false);
    } finally {
      setCheckingConnection(false);
    }
  }, [connectionStatus]);

  useEffect(() => {
    checkInternetConnection();

    const unsubscribe = NetInfo.addEventListener(state => {
      // On Android, isInternetReachable can be null or unreliable
      const connected = state.isConnected && (state.isInternetReachable !== false);
      console.log('WifiOnboardingScreen - NetInfo state changed:', {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
        connected
      });
      setIsConnected(connected);
      if (connected) {
        setConnectionStatus('connected');
      }
    });

    return () => unsubscribe();
  }, [checkInternetConnection]);

  // Auto-navigate to WelcomeScreen when connected
  useEffect(() => {
    console.log('Auto-navigation check:', {
      isConnected,
      currentNetwork: currentNetwork?.SSID,
      connectionStatus,
      isIntentional,
      hasUserSuccessfullyConnected
    });

    if (isConnected && currentNetwork && (!isIntentional || hasUserSuccessfullyConnected)) {
      console.log('WiFi connected with internet, auto-navigating to WelcomeScreen');
      showInAppToast('Connected! Proceeding to app...', { durationMs: 2000 });

      // Delay navigation slightly for smooth UX
      const navigationTimer = setTimeout(() => {
        console.log('Calling onContinue() to navigate away from WiFi screen');
        onContinue();
      }, 1500);

      return () => clearTimeout(navigationTimer);
    }
  }, [isConnected, currentNetwork, onContinue, isIntentional, hasUserSuccessfullyConnected]);

  // Helper functions
  const getSignalStrengthLabel = (level) => {
    const signalLevel = Math.abs(level);
    if (signalLevel <= 50) return 'Excellent';
    if (signalLevel <= 60) return 'Good';
    if (signalLevel <= 70) return 'Fair';
    return 'Weak';
  };

  const getSecurityType = (capabilities) => {
    if (!capabilities || capabilities === '') return 'Open';
    if (capabilities.includes('WEP')) return 'Secured';
    if (capabilities.includes('PSK') || capabilities.includes('RSN')) return 'Secured';
    return 'Secured';
  };

  const requestLocationPermission = async () => {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'This app needs location permission to scan for WiFi networks.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  // Request NEARBY_WIFI_DEVICES permission for Android 13+ (API 33+)
  const requestNearbyWifiPermission = async () => {
    try {
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        const hasPermission = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES
        );

        if (hasPermission) {
          return true;
        }

        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
          {
            title: 'WiFi Permission',
            message: 'This app needs WiFi permission to connect to networks.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      return true;
    } catch (err) {
      console.warn('Error requesting NEARBY_WIFI_DEVICES permission:', err);
      return true;
    }
  };

  // Check WiFi state
  const checkWifiState = async () => {
    try {
      const isEnabled = await WifiManager.isEnabled();
      if (isMountedRef.current) {
        setWifiEnabled(isEnabled);
      }
      return isEnabled;
    } catch (error) {
      console.warn('Error checking WiFi state:', error);
      if (isMountedRef.current) {
        setWifiEnabled(false);
      }
      return false;
    }
  };

  // Toggle WiFi on/off
  const toggleWifi = async (enable) => {
    try {
      if (enable) {
        await WifiManager.setEnabled(true);
        if (isMountedRef.current) {
          setWifiEnabled(true);
        }

        // Wait for WiFi to enable
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Force fresh scan
        shouldForceScanRef.current = true;
        scanRetryCountRef.current = 0;
        await scanNetworks(true);
      } else {
        await WifiManager.setEnabled(false);
        if (isMountedRef.current) {
          setWifiEnabled(false);
          setNetworks([]);
          setCurrentNetwork(null);
        }
        clearAllTimeouts();
      }
    } catch (error) {
      console.warn('Error toggling WiFi:', error);
      showInAppToast('Failed to toggle WiFi', { durationMs: 2000 });
    }
  };

  // Fetch currently connected network with IP validation
  const fetchCurrentNetwork = useCallback(async () => {
    try {
      const currentSSID = await WifiManager.getCurrentWifiSSID();
      if (currentSSID && currentSSID !== '<unknown ssid>' && currentSSID !== '0x') {
        const cleanSSID = currentSSID.replace(/^"|"$/g, '');
        if (isMountedRef.current) {
          setCurrentNetwork({ SSID: cleanSSID });
        }

        // Check for valid IP to confirm true connection (authenticated)
        const ip = await WifiManager.getIP();
        if (ip && ip !== '0.0.0.0' && ip !== '0:0:0:0:0:0:0:0') {
          if (isMountedRef.current) {
            setConnectionStatus('connected');
          }
          await persistSavedNetworkSSID(cleanSSID);
        } else {
          // Associated with AP but not yet authenticated/DHCP assigned
          if (isMountedRef.current) {
            setConnectionStatus('verifying');
          }
        }
      } else {
        if (isMountedRef.current) {
          setCurrentNetwork(null);
          if (connectionStatus !== 'connecting' && connectionStatus !== 'verifying') {
            setConnectionStatus('disconnected');
          }
        }
      }
    } catch {
      if (isMountedRef.current) {
        setCurrentNetwork(null);
        setConnectionStatus('disconnected');
      }
    }
  }, [connectionStatus]);

  const verifyConnection = useCallback(async (networkSSID) => {
    try {
      // Shorter initial wait for responsive feeling
      await new Promise(resolve => setTimeout(resolve, 1500));

      const maxAttempts = 15;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const currentSSID = await WifiManager.getCurrentWifiSSID();
          const cleanSSID = (currentSSID || '').replace(/^"|"$/g, '');
          const targetSSID = networkSSID.replace(/^"|"$/g, '');

          if (cleanSSID === targetSSID) {
            // SSID matches, now check for IP to confirm authentication/DHCP
            const ip = await WifiManager.getIP();
            if (ip && ip !== '0.0.0.0' && ip !== '0:0:0:0:0:0:0:0') {
              console.log('Successfully connected with valid IP:', ip);
              return true;
            }
          }
        } catch (err) {
          console.warn(`Connection verify loop attempt ${i + 1} failed:`, err);
        }
        // Poll every 1 second for a faster response
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return false;
    } catch (error) {
      console.error('Verification error:', error);
      return false;
    }
  }, []);

  const connectToNetwork = useCallback(
    async (network, enteredPassword, isRetry = false) => {
      const finalPassword = enteredPassword || password;

      try {
        const isProtected = getSecurityType(network.capabilities) === 'Secured';
        if (isProtected && !finalPassword) {
          showInAppToast('Password required', { durationMs: 2000 });
          return;
        }

        isConnectingRef.current = true;
        pauseScanning();
        setPasswordModalVisible(false);
        setIsConnecting(true);
        setConnectionStatus('connecting');

        if (isProtected && finalPassword && finalPassword.trim() !== '') {
          await savePasswordToStorage(network.SSID, finalPassword);
        }

        try {
          const securityType = getSecurityType(network.capabilities);

          // Try root connection first
          try {
            await SystemTimeModule.connectToWifi(network.SSID, finalPassword || '', securityType);
            console.log("Root WiFi Connection Successful");
          } catch (rootError) {
            console.warn("Root WiFi Connection failed, falling back to standard:", rootError);
            await WifiManager.connectToProtectedSSID(network.SSID, finalPassword || '', false, false);
          }

          setConnectionStatus('verifying');
          showInAppToast(`Verifying connection to ${network.SSID}...`, { durationMs: 3500 });

          const isConnected = await verifyConnection(network.SSID);

          if (isConnected) {
            setConnectionStatus('connected');
            showInAppToast(`Successfully connected to ${network.SSID}`, { durationMs: 2000 });
            setHasUserSuccessfullyConnected(true);
            setPasswordError(false);
            await fetchCurrentNetwork();
            setIsConnected(true);
            shouldForceScanRef.current = true;
            scheduleNextScan({ resetAdaptive: true });
          } else {
            const securityType = getSecurityType(network.capabilities);
            if (securityType === 'Secured') {
              throw new Error('AUTHENTICATION_FAILED: Incorrect password or authentication error.');
            } else {
              throw new Error('Connection timed out. Please check signal strength.');
            }
          }
        } catch (connectionError) {
          console.error('Connection error:', connectionError);
          setConnectionStatus('disconnected');

          let errorMessage = 'Failed to connect. Please check your password or signal strength.';
          const msg = (connectionError.message || '').toLowerCase();
          if (msg.includes('password') ||
            msg.includes('incorrect') ||
            msg.includes('authentication') ||
            msg.includes('auth') ||
            msg.includes('verify')
          ) {
            errorMessage = 'Incorrect password. Please try again.';
          } else if (msg.includes('timeout')) {
            errorMessage = 'Connection timed out. Please check signal strength.';
          }

          showInAppToast(errorMessage, { durationMs: 3500, position: 'center' });
          setSelectedNetwork(network);
          resumeScanning(true);
        }
      } catch (processError) {
        console.error('Connection process error:', processError);
        showInAppToast('Connection failed', { durationMs: 3500 });
        setConnectionStatus('disconnected');
        resumeScanning(true);
      } finally {
        setIsConnecting(false);
        isConnectingRef.current = false;
      }
    },
    [password, fetchCurrentNetwork, verifyConnection, savePasswordToStorage, pauseScanning, scheduleNextScan, resumeScanning]
  );

  // Improved scanNetworks function
  const scanNetworks = useCallback(async (forceScan = false) => {
    if (scanInProgressRef.current) {
      console.log('Scan already in progress, skipping');
      return;
    }

    if (!isMountedRef.current || isConnectingRef.current) {
      return;
    }

    clearAllTimeouts();

    const now = Date.now();
    const timeSinceLastScan = now - lastScanTime;
    const minScanInterval = forceScan || shouldForceScanRef.current || isManualRefresh
      ? (isManualRefresh ? 3000 : 0)
      : getAdaptiveScanInterval(scanSessionStartRef.current, false);

    if (!forceScan && !shouldForceScanRef.current && timeSinceLastScan < minScanInterval) {
      console.log(`Skipping scan - ${Math.ceil((minScanInterval - timeSinceLastScan) / 1000)}s remaining`);

      scanTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current && !isConnectingRef.current) {
          scanNetworks();
        }
      }, minScanInterval - timeSinceLastScan);
      return;
    }

    // Reset force scan flag
    shouldForceScanRef.current = false;

    // Update scan attempt count
    setScanAttemptCount(prev => prev + 1);

    // Check WiFi state
    const wifiState = await checkWifiState();
    if (!wifiState) {
      if (isMountedRef.current) {
        setNetworks([]);
        setIsScanning(false);
        setIsRefreshing(false);
      }
      showInAppToast('WiFi is turned off', { durationMs: 2000 });
      return;
    }

    // Start scanning
    scanInProgressRef.current = true;
    if (isMountedRef.current) {
      setIsScanning(true);
      if (networks.length > 0) {
        setIsRefreshing(true);
      }
      // Removed setNetworks([]) to prevent blinking
    }

    try {
      // Request permissions
      const locationPermission = await requestLocationPermission();
      if (!locationPermission) {
        showInAppToast('Location permission required', { durationMs: 2000 });
        return;
      }

      // Request WiFi permission for Android 13+
      await requestNearbyWifiPermission();

      console.log(`Starting WiFi scan (attempt ${scanAttemptCount + 1})...`);

      // Add delay to ensure stable scanning
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Try to scan networks
      let results = [];
      let scanError = null;

      try {
        // Use reScanAndLoadWifiList for better results on Android
        if (Platform.OS === 'android') {
          await WifiManager.reScanAndLoadWifiList();
          results = await WifiManager.loadWifiList();
        } else {
          results = await WifiManager.loadWifiList();
        }
      } catch (error) {
        scanError = error;
        console.warn('Primary scan failed:', error);

        // Try alternative method
        try {
          results = await WifiManager.loadWifiList();
        } catch (fallbackError) {
          console.warn('Fallback scan also failed:', fallbackError);
          results = [];
        }
      }

      if (Array.isArray(results) && results.length > 0) {
        console.log(`Found ${results.length} networks in scan`);

        // Filter valid networks
        const validResults = results.filter(network =>
          network && network.SSID && network.SSID.trim() !== '' &&
          network.SSID !== '<unknown ssid>' && network.SSID !== '0x'
        );

        if (validResults.length > 0) {
          // Sort by signal strength (strongest first)
          const sortedResults = validResults.sort((a, b) => {
            const levelA = Math.abs(a.level || -100);
            const levelB = Math.abs(b.level || -100);
            return levelA - levelB;
          });

          // Remove duplicates by SSID
          const uniqueNetworks = [];
          const seenSSIDs = new Set();

          sortedResults.forEach(network => {
            if (network.SSID && !seenSSIDs.has(network.SSID)) {
              seenSSIDs.add(network.SSID);
              uniqueNetworks.push({
                ...network,
                SSID: network.SSID,
                BSSID: network.BSSID || `bssid_${network.SSID}_${Date.now()}`,
                level: network.level || -75,
                capabilities: network.capabilities || '',
                timestamp: Date.now()
              });
            }
          });

          if (isMountedRef.current) {
            const nextFingerprint = getNetworkListFingerprint(uniqueNetworks);
            const networksChanged = nextFingerprint !== lastNetworkFingerprintRef.current;
            lastNetworkFingerprintRef.current = nextFingerprint;

            setNetworks(uniqueNetworks);
            setLastScanTime(Date.now());
            scanRetryCountRef.current = 0;
            lastNetworkCountRef.current = uniqueNetworks.length;
            networksCacheRef.current = uniqueNetworks;
            lastNetworksUpdateRef.current = Date.now();

            if (uniqueNetworks.length > 0 && (forceScan || isManualRefresh)) {
              showInAppToast(`Found ${uniqueNetworks.length} networks`, { durationMs: 2000 });
            }

            if (!isConnectingRef.current) {
              scheduleNextScan({ resetAdaptive: networksChanged });
            }
          }
        } else {
          console.log('No valid networks found');
          if (isMountedRef.current) {
            // Only clear if we really have no networks at all
            if (networksCacheRef.current.length === 0) {
              setNetworks([]);
            }
            setLastScanTime(Date.now());

            // If we had networks before but now don't, increment retry count
            if (lastNetworkCountRef.current > 0) {
              scanRetryCountRef.current++;
              if (scanRetryCountRef.current <= 3) {
                showInAppToast('No networks found, retrying...', { durationMs: 2000 });
              }
            }

            if (!isConnectingRef.current) {
              scheduleNextScan({ useFailureBackoff: scanRetryCountRef.current > 0 });
            }
          }
        }
      } else {
        console.log('No networks found in scan results');
        if (isMountedRef.current) {
          if (networksCacheRef.current.length === 0) {
            setNetworks([]);
          }
          setLastScanTime(Date.now());

          scanRetryCountRef.current++;
          if (scanRetryCountRef.current <= 3) {
            showInAppToast('Scan failed, retrying...', { durationMs: 2000 });
          }

          if (!isConnectingRef.current) {
            scheduleNextScan({ useFailureBackoff: true });
          }
        }
      }

      await fetchCurrentNetwork();

    } catch (error) {
      console.warn('Scan error:', error);
      showInAppToast('Failed to scan networks', { durationMs: 2000 });
      scanRetryCountRef.current++;

      if (networksCacheRef.current.length > 0 && isMountedRef.current) {
        setNetworks(networksCacheRef.current);
      } else if (isMountedRef.current) {
        setNetworks([]);
      }

      if (isMountedRef.current && !isConnectingRef.current) {
        scheduleNextScan({ useFailureBackoff: true });
      }
    } finally {
      if (isMountedRef.current) {
        setIsScanning(false);
        setIsRefreshing(false);
        setIsManualRefresh(false);
        scanInProgressRef.current = false;
      }
    }
  }, [lastScanTime, scanAttemptCount, isManualRefresh, fetchCurrentNetwork, networks, scheduleNextScan]);

  scanNetworksRef.current = scanNetworks;

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || isScanning) return;

    try {
      setIsManualRefresh(true);
      setIsRefreshing(true);
      showInAppToast('Scanning for networks...', { durationMs: 2000 });

      // Reset retry count for manual refresh
      scanRetryCountRef.current = 0;

      // Force a fresh scan
      shouldForceScanRef.current = true;
      await scanNetworks(true);

    } catch (error) {
      console.warn('Refresh error:', error);
      showInAppToast('Failed to refresh networks', { durationMs: 2000 });
      setIsRefreshing(false);
      setIsManualRefresh(false);
    }
  }, [isRefreshing, isScanning, scanNetworks]);

  // Setup initial scan when component mounts
  useEffect(() => {
    scanSessionStartRef.current = Date.now();
    const initialScanTimeout = setTimeout(() => {
      if (isMountedRef.current) {
        scanNetworks(true);
      }
    }, 1000);

    return () => {
      clearTimeout(initialScanTimeout);
      clearAllTimeouts();
    };
  }, []);

  // Reset showPassword when modal opens/closes
  useEffect(() => {
    if (!passwordModalVisible) {
      setShowPassword(false);
    }
  }, [passwordModalVisible]);

  const handleNetworkPress = (network) => {
    if (isConnecting) return;

    // Guard: Do nothing if clicking on an already connected network
    const isActuallyConnected = currentNetwork?.SSID === network.SSID && connectionStatus === 'connected';
    if (isActuallyConnected) {
      console.log('Already connected to:', network.SSID);
      return;
    }

    setSelectedNetwork(network);
    const securityType = getSecurityType(network.capabilities);

    // Check for saved password first (from AsyncStorage)
    const savedPassword = getPasswordForSSID(networkPasswords, network.SSID);

    if (securityType === 'Secured' && savedPassword) {
      // Auto-connect with saved password
      showInAppToast(`Connecting with saved password to ${network.SSID}...`, { durationMs: 2500 });
      connectToNetwork(network, savedPassword);
    } else if (securityType === 'Secured') {
      // No saved password, ask for it
      setPasswordModalVisible(true);
      setShowPassword(false); // Always default to hidden when opening
      setPassword('');
      setPasswordError(false);
    } else {
      // Open network
      connectToNetwork(network, '');
    }
  };

  const renderNetworkItem = ({ item }) => {
    const isActuallyConnected = currentNetwork?.SSID === item.SSID && connectionStatus === 'connected';
    const isConnectingToThis = selectedNetwork?.SSID === item.SSID && isConnecting;
    const signalStrengthLabel = getSignalStrengthLabel(item.level);
    const securityType = getSecurityType(item.capabilities);
    const isSaved = getPasswordForSSID(networkPasswords, item.SSID) && !isActuallyConnected;

    return (
      <TouchableOpacity
        style={[
          styles.networkItem,
          isActuallyConnected && styles.connectedNetworkItem,
          isConnectingToThis && styles.connectingNetworkItem,
          selectedNetwork?.SSID === item.SSID && !isConnecting && !isActuallyConnected && styles.selectedNetworkItem
        ]}
        onPress={() => handleNetworkPress(item)}
        activeOpacity={0.8}
        disabled={isConnecting}
      >
        <View style={[
          styles.wifiIconContainer,
          isActuallyConnected && styles.connectedWifiIconContainer
        ]}>
          <Image source={WIFI_ICON} style={[
            styles.wifiIcon,
            isActuallyConnected && styles.connectedWifiIcon
          ]} />
        </View>
        <View style={styles.networkInfo}>
          <Text style={[
            styles.networkName,
            isActuallyConnected && styles.connectedNetworkName,
            isConnectingToThis && styles.connectingNetworkName
          ]}>
            {item.SSID}
          </Text>
          {isActuallyConnected ? (
            <Text style={styles.connectedText}>Connected</Text>
          ) : isConnectingToThis ? (
            <Text style={[styles.connectingText, { color: '#22B2A6' }]}>
              {connectionStatus === 'verifying' ? 'Verifying...' : 'Connecting...'}
            </Text>
          ) : (
            <View style={styles.networkDetails}>
              <Text style={styles.signalStrength}>{signalStrengthLabel}</Text>
              <VerticalDivider color="#555555" />
              <Text style={styles.securityText}>{securityType}</Text>
              {isSaved && (
                <>
                  <VerticalDivider color="#555555" />
                  <Text style={styles.savedText}>Saved</Text>
                </>
              )}
            </View>
          )}
        </View>
        <View style={styles.arrowContainer}>
          <Text style={[
            styles.arrow,
            isConnected && styles.connectedArrow
          ]}>›</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderConnectedStatus = () => {
    if (!wifiEnabled) return null;

    // Show dynamic status during connection/verification
    if (connectionStatus === 'connecting' || connectionStatus === 'verifying') {
      return (
        <View style={[styles.connectedContainer, { borderColor: '#22B2A6' }]}>
          <View style={styles.connectedHeader}>
            <ActivityIndicator size="small" color="#22B2A6" style={{ marginRight: 12 }} />
            <View style={styles.connectedInfo}>
              <Text style={[styles.connectedLabel, { color: '#22B2A6' }]}>
                {connectionStatus === 'verifying' ? 'Verifying connection...' : 'Connecting...'}
              </Text>
              <Text style={styles.connectedSSID}>
                {selectedNetwork?.SSID || 'Please wait'}
              </Text>
            </View>
          </View>
        </View>
      );
    }

    if (currentNetwork && connectionStatus === 'connected') {
      return (
        <View style={styles.connectedContainer}>
          <View style={styles.connectedHeader}>
            <View style={styles.iconContainer}>
              <Image source={WIFI_ICON} style={styles.connectedIcon} />
            </View>
            <View style={styles.connectedInfo}>
              <Text style={styles.connectedLabel}>Connected to</Text>
              <Text style={styles.connectedSSID}>{currentNetwork.SSID}</Text>
            </View>
            <View style={styles.connectedStatus}>
              {isConnected && (
                <TouchableOpacity
                  style={styles.continueButton}
                  onPress={onContinue}
                  activeOpacity={0.8}
                >
                  <Text style={styles.continueButtonText}>Continue</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      );
    }

    return null;
  };



  if (checkingConnection) {
    return (
      <View style={styles.loadingContainer}>
        {/* <CustomStatusBar /> */}

        <ActivityIndicator size="large" color="#22B2A6" />
        <Text style={styles.loadingText}>Checking connection...</Text>
      </View>
    );
  }

  // Calculate time until next scan
  const timeUntilNextScan = Math.max(
    0,
    Math.ceil((getAdaptiveScanInterval(scanSessionStartRef.current, false) - (Date.now() - lastScanTime)) / 1000)
  );

  return (
    <View style={styles.container}>

      <View style={styles.headerContainer}>
        <Text style={styles.title}>Connect to WiFi</Text>
        <Text style={styles.subtitle}>
          Please connect to WiFi to continue using the app
        </Text>

      </View>

      <View style={styles.networksSection}>
        {!wifiEnabled ? (
          <View style={styles.wifiOffContainer}>
            <Image source={WIFI_ICON} style={styles.wifiOffIcon} />
            <Text style={styles.wifiOffMessage}>WiFi is turned off</Text>
            <Text style={styles.wifiOffSubmessage}>
              Turn on WiFi to see available networks
            </Text>
            <TouchableOpacity
              style={styles.turnOnButton}
              onPress={() => toggleWifi(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.turnOnButtonText}>Turn WiFi On</Text>
            </TouchableOpacity>
          </View>
        ) : isScanning && scanAttemptCount <= 1 ? (
          <View style={styles.scanningContainer}>
            <View style={styles.loadingDotsContainer}>
              <View style={[styles.loadingDot, styles.loadingDot1]} />
              <View style={[styles.loadingDot, styles.loadingDot2]} />
              <View style={[styles.loadingDot, styles.loadingDot3]} />
            </View>
            <Text style={styles.searchingText}>Scanning for networks...</Text>
          </View>
        ) : debouncedNetworks.length > 0 ? (
          <SectionList
            sections={[
              {
                title: 'Connected Network',
                data: debouncedNetworks.filter(net => currentNetwork?.SSID === net.SSID)
              },
              {
                title: 'Saved Networks',
                data: debouncedNetworks.filter(net => getPasswordForSSID(networkPasswords, net.SSID) && currentNetwork?.SSID !== net.SSID)
              },
              {
                title: 'Available Networks',
                data: debouncedNetworks.filter(net => !getPasswordForSSID(networkPasswords, net.SSID) && currentNetwork?.SSID !== net.SSID)
              }
            ].filter(section => section.data.length > 0 || (section.title === 'Available Networks' && debouncedNetworks.length > 0))}
            keyExtractor={(item) => item.BSSID + item.SSID + (item.timestamp || '')}
            renderItem={renderNetworkItem}
            renderSectionHeader={({ section: { title } }) => (
              <View style={styles.sectionHeaderContainer}>
                <Text style={styles.sectionHeading}>{title}</Text>
                {title === 'Available Networks' && (isScanning || isRefreshing) && (
                  <ActivityIndicator
                    size="small"
                    color="#22B2A6"
                    style={[styles.sectionLoader, { marginLeft: 128, marginRight: 0 }]}
                  />
                )}
              </View>
            )}
            contentContainerStyle={styles.networksListContent}
            stickySectionHeadersEnabled={false}
            keyboardShouldPersistTaps="handled"
          />
        ) : (
          <View style={styles.noNetworksContainer}>
            <Image source={WIFI_ICON} style={styles.noNetworksIcon} />
            <Text style={styles.noNetworksMessage}>No networks found</Text>
            <Text style={styles.noNetworksSubmessage}>
              {scanRetryCountRef.current > 0
                ? 'WiFi scanning having issues. Try refreshing.'
                : 'Try moving closer to a router or refreshing'
              }
            </Text>
            <TouchableOpacity
              style={[styles.refreshButton, (isRefreshing || isScanning) && styles.refreshButtonDisabled]}
              onPress={handleRefresh}
              activeOpacity={0.8}
              disabled={isRefreshing || isScanning}
            >
              <Text style={styles.refreshButtonText}>
                {isRefreshing || isScanning ? 'Scanning...' : 'Refresh Networks'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {(!isConnected || isIntentional) && (
        <TouchableOpacity
          style={styles.skipButton}
          onPress={onSkip}
          activeOpacity={0.7}
        >
          <Text style={styles.skipButtonText}>{isIntentional ? 'Go Back' : 'Skip for now'}</Text>
        </TouchableOpacity>
      )}

      {passwordModalVisible && (
        <Modal visible={passwordModalVisible} transparent={true} animationType="fade">
          <View style={styles.passwordModalOverlay}>
            <View style={styles.passwordModalContentWrapper}>
              <View style={styles.passwordModalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Enter Password</Text>
                  <Text style={styles.networkNameText}>
                    {selectedNetwork?.SSID}
                  </Text>
                  {passwordError && (
                    <Text style={styles.passwordErrorText}>
                      Incorrect password. Please try again.
                    </Text>
                  )}
                </View>

                <View style={styles.passwordInputContainer}>
                  <View style={[styles.inputContainer, passwordError && styles.inputContainerError]}>
                    <KioskTextInput
                      style={styles.input}
                      value={password}
                      onChangeText={(text) => {
                        setPassword(text);
                        setPasswordError(false);
                      }}
                      placeholder="Enter password"
                      secureTextEntry={!showPassword}
                      placeholderTextColor="#888888"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus={true}
                      showDismiss={true}
                    />
                    <TouchableOpacity
                      style={styles.eyeIconContainer}
                      onPress={() => setShowPassword(!showPassword)}
                    >
                      <Text style={{ color: '#22B2A6', fontFamily: 'ProductSans-Bold' }}>{showPassword ? "Hide" : "Show"}</Text>
                    </TouchableOpacity>
                  </View>
                  {(password || '').trim().length > 0 && (password || '').trim().length < 8 && (
                    <Text style={styles.passwordHintText}>Password must be at least 8 characters</Text>
                  )}
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    onPress={() => {
                      setPasswordModalVisible(false);
                      setPassword('');
                      setSelectedNetwork(null);
                      setPasswordError(false);
                    }}
                    style={[styles.modalButton, styles.cancelButton]}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => connectToNetwork(selectedNetwork, password, passwordError)}
                    style={[
                      styles.modalButton,
                      styles.connectButton,
                      (isConnecting || (password || '').trim().length < 8) && styles.connectButtonDisabled
                    ]}
                    activeOpacity={0.8}
                    disabled={isConnecting || (password || '').trim().length < 8}
                  >
                    <Text style={styles.connectButtonText}>
                      {isConnecting ? 'Connecting...' : 'Connect'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
          <CustomKeyboard />
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#fff',
    fontWeight: '400',
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 32,
    fontFamily: 'ProductSans-Bold',
    color: '#FFFFFF',
    marginBottom: 8,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
    color: '#AAAAAA',
    lineHeight: 22,
  },
  nextScanText: {
    fontSize: 12,
    color: '#888888',
    fontFamily: 'ProductSans-Regular',
    marginTop: 4,
  },
  connectedContainer: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#30D158',
  },
  connectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(48, 209, 88, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  connectedIcon: {
    width: 24,
    height: 24,
    tintColor: '#30D158',
  },
  connectedInfo: {
    flex: 1,
  },
  connectedLabel: {
    fontSize: 12,
    color: '#30D158',
    marginBottom: 2,
    fontWeight: '600',
  },
  connectedSSID: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  connectedStatus: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueButton: {
    backgroundColor: '#2a241a',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#22B2A6',
    marginLeft: 12,
  },
  continueButtonText: {
    color: '#22B2A6',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'ProductSans-Bold',
  },
  networksSection: {
    flex: 1,
    marginBottom: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
    color: '#666666',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  networkCount: {
    fontSize: 12,
    fontFamily: 'ProductSans-Regular',
    color: '#888888',
  },
  smallRefreshButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#41403D',
    borderWidth: 1,
    borderColor: '#333333',
  },
  smallRefreshButtonDisabled: {
    opacity: 0.5,
  },
  refreshIconText: {
    fontSize: 26,
    color: '#22B2A6',
    fontFamily: 'ProductSans-Bold',
    lineHeight: 26,
    textAlign: 'center',
    includeFontPadding: false,
  },
  refreshIconTextDisabled: {
    color: '#888888',
  },
  wifiOffContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    backgroundColor: 'rgba(26, 26, 26, 0.8)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#222222',
    marginHorizontal: 20,
  },
  wifiOffIcon: {
    width: 60,
    height: 60,
    tintColor: '#555555',
    marginBottom: 20,
    opacity: 0.5,
  },
  wifiOffMessage: {
    fontSize: 18,
    fontFamily: 'ProductSans-Bold',
    color: '#888888',
    marginBottom: 8,
  },
  wifiOffSubmessage: {
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
    color: '#666666',
    textAlign: 'center',
    paddingHorizontal: 40,
    marginBottom: 20,
  },
  turnOnButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#2a241a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#22B2A6',
  },
  turnOnButtonText: {
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
    color: '#22B2A6',
    letterSpacing: 0.5,
  },
  scanningContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    backgroundColor: 'rgba(26, 26, 26, 0.8)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#222222',
    marginHorizontal: 20,
  },
  loadingDotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22B2A6',
    marginHorizontal: 4,
  },
  loadingDot1: {
    opacity: 0.4,
  },
  loadingDot2: {
    opacity: 0.7,
  },
  loadingDot3: {
    opacity: 1.0,
  },
  searchingText: {
    color: '#888888',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
  },
  networkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#41403D',
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333333',
  },
  connectedNetworkItem: {
    borderColor: '#2aff2a',
    backgroundColor: '#1a2a1a',
  },
  selectedNetworkItem: {
    borderColor: '#22B2A6',
  },
  wifiIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  connectedWifiIconContainer: {
    backgroundColor: 'rgba(42, 255, 42, 0.1)',
  },
  wifiIcon: {
    width: 20,
    height: 20,
    tintColor: '#FFFFFF',
  },
  connectedWifiIcon: {
    tintColor: '#2aff2a',
  },
  networkInfo: {
    flex: 1,
  },
  networkName: {
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  connectedNetworkName: {
    color: '#2aff2a',
  },
  networkDetails: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signalStrength: {
    fontSize: 12,
    color: '#AAAAAA',
    fontFamily: 'ProductSans-Regular',
  },
  securityText: {
    fontSize: 12,
    color: '#AAAAAA',
    fontFamily: 'ProductSans-Regular',
  },
  connectedText: {
    fontSize: 12,
    color: '#2aff2a',
    fontFamily: 'ProductSans-Bold',
  },
  savedText: {
    fontSize: 12,
    color: '#22B2A6',
    fontFamily: 'ProductSans-Bold',
  },
  arrowContainer: {
    width: 24,
    alignItems: 'center',
  },
  arrow: {
    fontSize: 24,
    color: '#666666',
    fontWeight: '300',
  },
  connectedArrow: {
    color: '#2aff2a',
  },
  noNetworksContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  noNetworksIcon: {
    width: 50,
    height: 50,
    tintColor: '#333333',
    marginBottom: 16,
  },
  noNetworksMessage: {
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    color: '#666666',
    marginBottom: 8,
  },
  noNetworksSubmessage: {
    fontSize: 14,
    color: '#444444',
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: 'ProductSans-Regular',
  },
  refreshButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#41403D',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333333',
  },
  refreshButtonDisabled: {
    opacity: 0.5,
  },
  refreshButtonText: {
    color: '#22B2A6',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'ProductSans-Bold',
  },
  passwordModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 24,
  },
  passwordModalContentWrapper: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  passwordModalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1e1e1e',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333333',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 20,
    },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 20,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'ProductSans-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  networkNameText: {
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
    color: '#AAAAAA',
    marginBottom: 8,
  },
  passwordErrorText: {
    color: '#ff4444',
    fontSize: 13,
    marginTop: 10,
    fontFamily: 'ProductSans-Bold',
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333333',
    marginBottom: 24,
    height: 56,
  },
  inputContainerError: {
    borderColor: '#ff4444',
    backgroundColor: 'rgba(255, 68, 68, 0.05)',
  },
  passwordInputContainer: {
    marginBottom: 18,
  },
  passwordHintText: {
    fontSize: 12,
    color: '#AAAAAA',
    marginTop: 0,
    textAlign: 'center',
    width: '100%',
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    paddingHorizontal: 16,
    fontFamily: 'ProductSans-Regular',
  },
  eyeIconContainer: {
    padding: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#333333',
  },
  connectButton: {
    backgroundColor: '#22B2A6',
  },
  connectButtonDisabled: {
    opacity: 0.6,
  },
  cancelButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'ProductSans-Bold',
  },
  connectButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'ProductSans-Bold',
  },
  skipButton: {
    alignSelf: 'center',
    paddingVertical: 15,
    paddingHorizontal: 20,
    marginBottom: 30,
    marginTop: 10,
  },
  skipButtonText: {
    color: '#666666',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
    textDecorationLine: 'underline',
  },
  networksListContent: {
    paddingTop: 15,
    paddingBottom: 80,
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 40,
    marginBottom: 10,
  },
  sectionHeading: {
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
    color: '#22B2A6',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionLoader: {
    marginLeft: 0,
  },
});

export default WifiOnboardingScreen;