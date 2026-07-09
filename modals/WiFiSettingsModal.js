import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  VirtualizedList,
  PermissionsAndroid,
  Dimensions,
  Keyboard,
  Platform,
  ActivityIndicator,
  NativeModules,
  AppState,
  ScrollView,
  SectionList,
  DeviceEventEmitter,
} from 'react-native';
import { showInAppToast } from '../utils/Helpers';
import KioskTextInput from '../Components/KioskTextInput';
import CustomKeyboard from '../Components/CustomKeyboard';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

import WifiManager from 'react-native-wifi-reborn';
const { SystemTimeModule } = NativeModules;
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CustomStatusBar from '../Components/CustomStatusBar';
import VerticalDivider from '../Components/VerticalDivider';
import backIcon from '../assets/icon_back.png';
import menuIcon from '../assets/icon_back.png';
import ToggleSwitch from 'toggle-switch-react-native';
import {
  normalizeSSID,
  ssidsMatch,
  getPasswordForSSID,
  removeAllPasswordVariants,
  normalizePasswordMap,
  getAdaptiveScanInterval,
  getScanFailureBackoffMs,
  getNetworkListFingerprint,
} from '../utils/wifiHelpers';

const { width, height } = Dimensions.get('window');
const WIFI_ICON = require('../assets/icon_wifi.png');
const settingsIcon = require('../assets/icon_settings.png');

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

const WifiSettingsModal = ({ visible, onClose }) => {
  const [wifiEnabled, setWifiEnabled] = useState(true);
  const [networks, setNetworks] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [password, setPassword] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [savedPasswordModalVisible, setSavedPasswordModalVisible] = useState(false);
  const [savedPassword, setSavedPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSavedPassword, setShowSavedPassword] = useState(false);
  const [networkPasswords, setNetworkPasswords] = useState({});
  const [savedNetworkSSIDs, setSavedNetworkSSIDs] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSavedNetworks, setShowSavedNetworks] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [scanAttemptCount, setScanAttemptCount] = useState(0);
  const [lastScanTime, setLastScanTime] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [appState, setAppState] = useState(AppState.currentState);

  // Refs for robust scanning
  const isMountedRef = useRef(true);
  const scanRetryCountRef = useRef(0);
  const shouldForceScanRef = useRef(false);
  const lastNetworkCountRef = useRef(0);
  const scanInProgressRef = useRef(false);
  const scanTimeoutRef = useRef(null);
  const missedScanCountsRef = useRef({}); // Track consecutive missed scans for aging
  const scanSessionStartRef = useRef(0);
  const isConnectingRef = useRef(false);
  const lastNetworkFingerprintRef = useRef('');
  const scanNetworksRef = useRef(null);
  // Use a very short debounce so new networks appear almost immediately,
  // while still avoiding excessive re-renders.
  const debouncedNetworks = useDebounce(networks, 100);

  const inputRef = useRef(null);
  const savedInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  const { hasPermission: cameraHasPermission, requestPermission: requestCameraPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // === PERSISTENCE FUNCTIONS ===
  useEffect(() => {
    if (visible) {
      loadSavedPasswords();
    }
  }, [visible]);

  const loadSavedPasswords = async () => {
    try {
      const [passwordsRaw, savedNetworksRaw] = await Promise.all([
        AsyncStorage.getItem('@wifi_passwords'),
        AsyncStorage.getItem('@wifi_saved_networks'),
      ]);

      let normalizedPasswords = {};
      if (passwordsRaw) {
        normalizedPasswords = normalizePasswordMap(JSON.parse(passwordsRaw));
        setNetworkPasswords(normalizedPasswords);
      }

      let storedSSIDs = [];
      if (savedNetworksRaw) {
        const parsed = JSON.parse(savedNetworksRaw);
        if (Array.isArray(parsed)) {
          storedSSIDs = parsed.map(normalizeSSID).filter(Boolean);
        }
      }

      const mergedSSIDs = [...new Set([
        ...storedSSIDs,
        ...Object.keys(normalizedPasswords),
      ])];

      setSavedNetworkSSIDs(mergedSSIDs);

      if (mergedSSIDs.length !== storedSSIDs.length) {
        await AsyncStorage.setItem('@wifi_saved_networks', JSON.stringify(mergedSSIDs));
      }

      console.log('Loaded saved networks:', mergedSSIDs.length);
    } catch (error) {
      console.warn('Error loading saved passwords:', error);
    }
  };

  const saveNetworkToSavedList = useCallback(async (ssid) => {
    const normalizedSSID = normalizeSSID(ssid);
    if (!normalizedSSID) return;

    setSavedNetworkSSIDs((prev) => {
      if (prev.some((entry) => ssidsMatch(entry, normalizedSSID))) {
        return prev;
      }
      const updated = [...prev, normalizedSSID];
      AsyncStorage.setItem('@wifi_saved_networks', JSON.stringify(updated))
        .catch((err) => console.warn('Error saving saved networks list:', err));
      return updated;
    });
  }, []);

  const removeNetworkFromSavedList = useCallback(async (ssid) => {
    const normalizedSSID = normalizeSSID(ssid);
    if (!normalizedSSID) return;

    setSavedNetworkSSIDs((prev) => {
      const updated = prev.filter((entry) => !ssidsMatch(entry, normalizedSSID));
      AsyncStorage.setItem('@wifi_saved_networks', JSON.stringify(updated))
        .catch((err) => console.warn('Error saving saved networks list:', err));
      return updated;
    });
  }, []);

  const savePasswordToStorage = async (ssid, password) => {
    try {
      const normalizedSSID = normalizeSSID(ssid);
      if (!normalizedSSID) return;
      await saveNetworkToSavedList(normalizedSSID);
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

  const isNetworkSaved = useCallback((ssid) => {
    const normalized = normalizeSSID(ssid);
    if (!normalized) return false;
    return savedNetworkSSIDs.some((entry) => ssidsMatch(entry, normalized))
      || Boolean(getPasswordForSSID(networkPasswords, normalized));
  }, [savedNetworkSSIDs, networkPasswords]);

  const removePasswordFromStorage = async (ssid) => {
    try {
      await removeNetworkFromSavedList(ssid);
      setNetworkPasswords(prev => {
        const updated = removeAllPasswordVariants(prev, ssid);
        AsyncStorage.setItem('@wifi_passwords', JSON.stringify(updated))
          .catch(err => console.warn('Error saving to AsyncStorage:', err));
        return updated;
      });
      console.log('Password removed from state and storage for:', normalizeSSID(ssid));
    } catch (error) {
      console.warn('Error in removePasswordFromStorage:', error);
    }
  };

  // Helper for security type
  const getSecurityType = (capabilities) => {
    if (!capabilities || capabilities === '') return 'Open';
    if (capabilities.includes('WEP')) return 'Secured';
    if (capabilities.includes('PSK') || capabilities.includes('RSN')) return 'Secured';
    return 'Secured';
  };

  // Auto-connect to saved networks when they become available
  const autoConnectToSavedNetworks = useCallback(async () => {
    if (!wifiEnabled || isConnecting || Object.keys(networkPasswords).length === 0) {
      return;
    }

    try {
      // Check if we're already connected to a network
      const currentSSID = await WifiManager.getCurrentWifiSSID();
      if (currentSSID && currentSSID !== '<unknown ssid>' && currentSSID !== '0x') {
        return;
      }

      // Find saved networks that are currently available
      const availableSavedNetworks = networks.filter(network =>
        getPasswordForSSID(networkPasswords, network.SSID) &&
        !ssidsMatch(network.SSID, currentSSID)
      );

      if (availableSavedNetworks.length > 0) {
        // Sort by signal strength (highest first)
        availableSavedNetworks.sort((a, b) => Math.abs(b.level) - Math.abs(a.level));

        const bestNetwork = availableSavedNetworks[0];
        const savedPassword = getPasswordForSSID(networkPasswords, bestNetwork.SSID);

        console.log(`Auto-connecting to saved network: ${bestNetwork.SSID}`);

        setIsConnecting(true);
        isConnectingRef.current = true;
        pauseScanning();
        setConnectionStatus('connecting');
        setSelectedNetwork(bestNetwork);

        try {
          const securityType = getSecurityType(bestNetwork.capabilities);

          // Try root connection
          try {
            await SystemTimeModule.connectToWifi(bestNetwork.SSID, savedPassword || '', securityType);
            console.log("Root Auto-connect Successful");
          } catch (rootError) {
            console.warn("Root auto-connect failed, fallback to standard:", rootError);
            await WifiManager.connectToProtectedSSID(bestNetwork.SSID, savedPassword || '', false, false);
          }

          setConnectionStatus('verifying');
          const isConnected = await verifyConnection(bestNetwork.SSID);

          if (isConnected) {
            setConnectionStatus('connected');
            showInAppToast(`Auto-connected to ${bestNetwork.SSID}`, { durationMs: 2000 });
            await fetchCurrentNetwork();
            shouldForceScanRef.current = true;
            scheduleNextScan({ resetAdaptive: true });
          } else {
            console.log(`Auto-connect verification failed for ${bestNetwork.SSID}`);
            setConnectionStatus('disconnected');
            resumeScanning(true);
          }
        } catch (error) {
          console.warn(`Auto-connect process failed for ${bestNetwork.SSID}:`, error);
          setConnectionStatus('disconnected');
          resumeScanning(true);
        } finally {
          setIsConnecting(false);
          isConnectingRef.current = false;
        }
      }
    } catch (error) {
      console.warn('Auto-connect error:', error);
      setIsConnecting(false);
      setConnectionStatus('disconnected');
    }
  }, [wifiEnabled, networks, networkPasswords, isConnecting, verifyConnection, fetchCurrentNetwork, pauseScanning, scheduleNextScan, resumeScanning]);

  // QR Code Scanner setup
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (codes.length > 0 && codes[0].value) {
        handleQRCodeScanned(codes[0].value);
      }
    },
  });

  // Password Input Component
  const PasswordInput = React.memo(({
    initialPassword = '',
    onSubmit,
    placeholder = "Password",
    editable = true,
    inputRefProp
  }) => {
    const [localPassword, setLocalPassword] = useState(initialPassword);
    const [localShowPassword, setLocalShowPassword] = useState(false);

    useEffect(() => {
      setLocalPassword(initialPassword);
      setLocalShowPassword(false); // Default to hidden when reopened/reused
    }, [initialPassword]);

    return (
      <View style={styles.passwordInputContainer}>
        <KioskTextInput
          ref={inputRefProp}
          style={[styles.input, !editable && styles.disabledInput]}
          value={localPassword}
          onChangeText={setLocalPassword}
          placeholder={placeholder}
          secureTextEntry={!localShowPassword}
          placeholderTextColor="#888"
          editable={editable}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
          showDismiss={true}
        />

        <TouchableOpacity
          style={styles.eyeIcon}
          onPress={() => setLocalShowPassword(!localShowPassword)}
        >
          <Text style={styles.eyeIconText}>{localShowPassword ? "Hide" : "Show"}</Text>
        </TouchableOpacity>

        {editable && onSubmit && (
          <TouchableOpacity
            onPress={() => onSubmit(localPassword)}
            style={{ display: 'none' }}
          />
        )}
      </View>
    );
  });

  // Location permission
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

        if (hasPermission) return true;

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
      hasFadingNetworks = false,
    } = options;

    clearAllTimeouts();

    if (!isMountedRef.current || isConnectingRef.current || !wifiEnabled) {
      return;
    }

    if (resetAdaptive) {
      scanSessionStartRef.current = Date.now();
      scanRetryCountRef.current = 0;
    }

    const interval = useFailureBackoff && scanRetryCountRef.current > 0
      ? getScanFailureBackoffMs(scanRetryCountRef.current)
      : getAdaptiveScanInterval(scanSessionStartRef.current, hasFadingNetworks);

    scanTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current && !isConnectingRef.current) {
        scanNetworksRef.current?.();
      }
    }, interval);
  }, [wifiEnabled]);

  const resumeScanning = useCallback((resetAdaptive = false) => {
    if (!visible || !wifiEnabled) return;
    scheduleNextScan({ resetAdaptive });
  }, [visible, wifiEnabled, scheduleNextScan]);

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
              console.log('Successfully connected with valid IP in Modal:', ip);
              return true;
            }
          }
        } catch (err) {
          console.warn(`Connection verify loop attempt ${i + 1} failed in Modal:`, err);
        }
        // Poll every 1 second for a faster response
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return false;
    } catch (error) {
      console.error('Verification error in Modal:', error);
      return false;
    }
  }, []);

  // Fetch currently connected network with IP validation
  const fetchCurrentNetwork = useCallback(async () => {
    if (!wifiEnabled) {
      setCurrentNetwork(null);
      setConnectionStatus('disconnected');
      return;
    }

    try {
      const ssid = await WifiManager.getCurrentWifiSSID();
      if (ssid && ssid !== '<unknown ssid>' && ssid !== '0x') {
        const cleanSSID = ssid.replace(/^"|"$/g, '');
        setCurrentNetwork({ SSID: cleanSSID });

        // Check for valid IP to confirm true connection (authenticated)
        const ip = await WifiManager.getIP();
        if (ip && ip !== '0.0.0.0' && ip !== '0:0:0:0:0:0:0:0') {
          setConnectionStatus('connected');
          saveNetworkToSavedList(cleanSSID);
        } else {
          // Associated with AP but not yet authenticated/DHCP assigned
          setConnectionStatus('verifying');
        }
      } else {
        setCurrentNetwork(null);
        if (connectionStatus !== 'connecting' && connectionStatus !== 'verifying') {
          setConnectionStatus('disconnected');
        }
      }
    } catch (error) {
      console.warn('Error fetching current network:', error);
      setCurrentNetwork(null);
    }
  }, [wifiEnabled, connectionStatus, saveNetworkToSavedList]);

  // Parse Wi-Fi QR code
  const parseWifiQRCode = (qrContent) => {
    try {
      if (!qrContent.startsWith('WIFI:')) {
        throw new Error('Not a Wi-Fi QR code');
      }

      const content = qrContent.substring(5);
      const parts = content.split(';');
      let ssid = '', password = '', encryption = '';

      parts.forEach(part => {
        if (part.startsWith('S:')) ssid = part.substring(2);
        else if (part.startsWith('T:')) encryption = part.substring(2);
        else if (part.startsWith('P:')) password = part.substring(2);
      });

      // Handle URL-encoded values
      ssid = decodeURIComponent(ssid);
      password = decodeURIComponent(password);

      if (!ssid) throw new Error('SSID not found');

      return {
        ssid,
        password,
        encryption,
        requiresPassword: !!password || (encryption && encryption !== 'nopass')
      };
    } catch (error) {
      console.warn('QR parsing error:', error);
      throw new Error('Invalid Wi-Fi QR code format');
    }
  };

  // Handle QR scan
  const handleQRCodeScanned = useCallback(async (qrContent) => {
    try {
      setShowCamera(false);

      if (qrContent.startsWith('WIFI:')) {
        const wifiInfo = parseWifiQRCode(qrContent);

        isConnectingRef.current = true;
        pauseScanning();

        await WifiManager.connectToProtectedSSID(
          wifiInfo.ssid,
          wifiInfo.password || '',
          false,
          false
        );

        if (wifiInfo.password) {
          await savePasswordToStorage(wifiInfo.ssid, wifiInfo.password);
        } else {
          await saveNetworkToSavedList(wifiInfo.ssid);
        }

        showInAppToast(`Connecting to ${wifiInfo.ssid}...`, { durationMs: 2000 });

        setTimeout(() => {
          fetchCurrentNetwork();
          isConnectingRef.current = false;
          if (isMountedRef.current && wifiEnabled) {
            scheduleNextScan({ resetAdaptive: true });
          }
        }, 3000);
      } else {
        showInAppToast('This is not a Wi-Fi QR code', { durationMs: 3500 });
      }
    } catch (error) {
      console.warn('QR connection error:', error);
      isConnectingRef.current = false;
      resumeScanning(true);
      showInAppToast('Failed to connect from QR code', { durationMs: 3500 });
    }
  }, [fetchCurrentNetwork, wifiEnabled, pauseScanning, scheduleNextScan, resumeScanning]);

  // Improved Connect to network with root fallback
  const connectToNetwork = useCallback(async (network, enteredPassword, skipConnectCheck = false) => {
    if (isConnecting && !skipConnectCheck) return;

    isConnectingRef.current = true;
    pauseScanning();
    setIsConnecting(true);
    setConnectionStatus('connecting');
    setPasswordModalVisible(false);
    const finalPassword = enteredPassword || password;

    try {
      const securityType = network.capabilities &&
        (network.capabilities.includes('PSK') ||
          network.capabilities.includes('RSN') ||
          network.capabilities.includes('WEP')) ? 'Secured' : 'Open';

      if (securityType === 'Secured' && (!finalPassword || finalPassword.trim() === '')) {
        showInAppToast('Password is required', { durationMs: 2000 });
        setIsConnecting(false);
        isConnectingRef.current = false;
        setConnectionStatus('disconnected');
        setShowPassword(false); // Default to hidden when reopening
        setPasswordModalVisible(true);
        resumeScanning();
        return;
      }

      // Persist password before connecting so retries do not re-prompt if the router is offline
      if (securityType === 'Secured' && finalPassword && finalPassword.trim() !== '') {
        await savePasswordToStorage(network.SSID, finalPassword);
      }

      showInAppToast(`Connecting to ${network.SSID}...`, { durationMs: 2500 });

      // Try root connection first
      try {
        let cleanSSID = network.SSID;
        if (cleanSSID.startsWith('"') && cleanSSID.endsWith('"')) {
          cleanSSID = cleanSSID.substring(1, cleanSSID.length - 1);
        }

        await SystemTimeModule.connectToWifi(cleanSSID, finalPassword || '', securityType);
        console.log("Root WiFi Connection Successful in Modal");
      } catch (rootError) {
        console.warn("Root connection failed in Modal, fallback to standard:", rootError);
        let cleanSSID = network.SSID;
        if (cleanSSID.startsWith('"') && cleanSSID.endsWith('"')) {
          cleanSSID = cleanSSID.substring(1, cleanSSID.length - 1);
        }
        await WifiManager.connectToProtectedSSID(cleanSSID, finalPassword || '', false, false);
      }

      setConnectionStatus('verifying');

      // Verify connection
      let cleanSSID = network.SSID;
      if (cleanSSID.startsWith('"') && cleanSSID.endsWith('"')) {
        cleanSSID = cleanSSID.substring(1, cleanSSID.length - 1);
      }
      const isConnected = await verifyConnection(cleanSSID);

      if (isConnected) {
        setConnectionStatus('connected');
        showInAppToast(`Successfully connected to ${cleanSSID}`, { durationMs: 2000 });
        await saveNetworkToSavedList(cleanSSID);

        await fetchCurrentNetwork();
        shouldForceScanRef.current = true;
        scheduleNextScan({ resetAdaptive: true });
      } else {
        // Specifically check if security was required to provide a better error message
        if (securityType === 'Secured') {
          throw new Error('AUTHENTICATION_FAILED: Incorrect password or authentication error.');
        } else {
          throw new Error('Connection timed out. Please check signal strength.');
        }
      }
    } catch (error) {
      console.warn('Connection error in Modal:', error);
      setConnectionStatus('disconnected');

      let errorMessage = 'Failed to connect. Please check your password or signal strength.';
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('password') ||
        msg.includes('incorrect') ||
        msg.includes('authentication') ||
        msg.includes('auth') ||
        msg.includes('verify')
      ) {
        errorMessage = 'Incorrect password. Please try again.';
      }

      showInAppToast(errorMessage, { durationMs: 3500, position: 'center' });
      setSelectedNetwork(network);
      resumeScanning(true);
    } finally {
      setIsConnecting(false);
      isConnectingRef.current = false;
    }
  }, [password, fetchCurrentNetwork, verifyConnection, savePasswordToStorage, saveNetworkToSavedList, pauseScanning, resumeScanning, scheduleNextScan, isConnecting]);

  // Disconnect from network
  const disconnectFromNetwork = async () => {
    try {
      // Release system-wide WiFi binding
      try {
        await WifiManager.forceWifiUsage(false);
      } catch (e) {
        console.warn('Error releasing WiFi usage:', e);
      }

      await WifiManager.disconnect();

      showInAppToast("Disconnected", { durationMs: 2000 });

      setCurrentNetwork(null);
      setConnectionStatus('disconnected');
      setSavedPasswordModalVisible(false);
      scanNetworks();
    } catch (error) {
      console.warn("Disconnect error:", error);
      showInAppToast("Failed to disconnect", { durationMs: 2000 });
    }
  };

  // Ported improved scanNetworks from WifiOnboardingScreen
  const scanNetworks = useCallback(async (forceScan = false) => {
    if (scanInProgressRef.current || !isMountedRef.current || isConnectingRef.current) return;

    clearAllTimeouts();

    const now = Date.now();
    const timeSinceLastScan = now - lastScanTime;
    const minScanInterval = forceScan || shouldForceScanRef.current
      ? 0
      : getAdaptiveScanInterval(scanSessionStartRef.current, false);

    if (!forceScan && !shouldForceScanRef.current && timeSinceLastScan < minScanInterval) {
      scanTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current && !isConnectingRef.current) scanNetworks();
      }, minScanInterval - timeSinceLastScan);
      return;
    }

    shouldForceScanRef.current = false;
    setScanAttemptCount(prev => prev + 1);

    const wifiState = await checkWifiState();
    if (!wifiState) {
      if (isMountedRef.current) {
        setNetworks([]);
        setIsScanning(false);
        setIsRefreshing(false);
      }
      return;
    }

    scanInProgressRef.current = true;
    if (isMountedRef.current) {
      setIsScanning(true);
      if (networks.length > 0) {
        setIsRefreshing(true);
      }
    }

    let scanSucceeded = false;
    let hasFadingNetworks = false;

    try {
      const locationPermission = await requestLocationPermission();
      if (!locationPermission) {
        showInAppToast('Location permission required', { durationMs: 2000 });
        return;
      }

      await requestNearbyWifiPermission();

      console.log(`Starting WiFi scan in Modal (attempt ${scanAttemptCount + 1})...`);

      let results = [];
      try {
        if (Platform.OS === 'android') {
          await WifiManager.reScanAndLoadWifiList();
          results = await WifiManager.loadWifiList();
        } else {
          results = await WifiManager.loadWifiList();
        }
        scanSucceeded = true;
      } catch (error) {
        console.warn('Primary scan failed in Modal:', error);
        try {
          results = await WifiManager.loadWifiList();
          scanSucceeded = Array.isArray(results);
        } catch (fallbackError) {
          results = [];
        }
      }

      const scanNow = Date.now();

      const validScanResults = (Array.isArray(results) ? results : []).filter(network =>
        network && network.SSID && network.SSID.trim() !== '' &&
        network.SSID !== '<unknown ssid>' && network.SSID !== '0x'
      );

      const latestScanMap = new Map();
      validScanResults.forEach(network => {
        const ssid = network.SSID;
        const currentBest = latestScanMap.get(ssid);
        if (!currentBest || Math.abs(network.level || -100) < Math.abs(currentBest.level || -100)) {
          latestScanMap.set(ssid, {
            ...network,
            BSSID: network.BSSID || `ssid_${ssid}_${scanNow}`,
            level: network.level || -75,
            capabilities: network.capabilities || '',
            timestamp: scanNow,
            isFading: false,
            missCount: 0
          });
        }
      });

      const nextMissedScanCounts = { ...missedScanCountsRef.current };
      const seenSSIDs = new Set(latestScanMap.keys());
      const agedNetworks = [];

      networks.forEach(oldNet => {
        const ssid = oldNet.SSID;
        if (seenSSIDs.has(ssid)) {
          // Network still visible: latestScanMap version will be used
        } else {
          const missCount = (nextMissedScanCounts[ssid] || 0) + 1;
          const firstMissedAt = oldNet.firstMissedAt || scanNow;
          const timeSinceFirstMiss = scanNow - firstMissedAt;

          if (missCount <= 3 && timeSinceFirstMiss < 15000) {
            agedNetworks.push({
              ...oldNet,
              isFading: true,
              missCount: missCount,
              firstMissedAt: firstMissedAt
            });
            nextMissedScanCounts[ssid] = missCount;
            hasFadingNetworks = true;
          } else {
            delete nextMissedScanCounts[ssid];
          }
        }
      });

      latestScanMap.forEach((net, ssid) => {
        agedNetworks.push(net);
        nextMissedScanCounts[ssid] = 0;
      });

      const finalUniqueMap = new Map();
      agedNetworks.forEach(net => {
        const ssid = net.SSID;
        const existing = finalUniqueMap.get(ssid);
        if (!existing || (!net.isFading && existing.isFading) ||
          (net.isFading === existing.isFading && Math.abs(net.level || -100) < Math.abs(existing.level || -100))) {
          finalUniqueMap.set(ssid, net);
        }
      });

      const finalSortedList = Array.from(finalUniqueMap.values()).sort((a, b) =>
        Math.abs(a.level || -100) - Math.abs(b.level || -100)
      );

      if (isMountedRef.current) {
        const nextFingerprint = getNetworkListFingerprint(finalSortedList);
        const networksChanged = nextFingerprint !== lastNetworkFingerprintRef.current;
        lastNetworkFingerprintRef.current = nextFingerprint;

        setNetworks(finalSortedList);
        missedScanCountsRef.current = nextMissedScanCounts;
        setLastScanTime(scanNow);
        lastNetworkCountRef.current = finalSortedList.length;

        if (scanSucceeded) {
          scanRetryCountRef.current = 0;
        } else {
          scanRetryCountRef.current += 1;
        }

        await fetchCurrentNetwork();

        if (wifiEnabled && !isConnectingRef.current) {
          scheduleNextScan({
            resetAdaptive: networksChanged,
            useFailureBackoff: !scanSucceeded,
            hasFadingNetworks,
          });
        }
      }
    } catch (error) {
      console.warn('Scan error in Modal:', error);
      scanRetryCountRef.current += 1;
      if (isMountedRef.current) {
        const errorMissCounts = { ...missedScanCountsRef.current };
        networks.forEach(net => {
          errorMissCounts[net.SSID] = (errorMissCounts[net.SSID] || 0) + 1;
        });
        missedScanCountsRef.current = errorMissCounts;

        if (wifiEnabled && !isConnectingRef.current) {
          scheduleNextScan({ useFailureBackoff: true });
        }
      }
    } finally {
      if (isMountedRef.current) {
        scanInProgressRef.current = false;
        setIsScanning(false);
        setIsRefreshing(false);
      }
    }
  }, [lastScanTime, scanAttemptCount, fetchCurrentNetwork, networks, wifiEnabled, scheduleNextScan]);

  scanNetworksRef.current = scanNetworks;

  // QR scan press
  const handleQRScanPress = async () => {
    setShowDropdown(false);
    if (!cameraHasPermission) {
      const granted = await requestCameraPermission();
      if (!granted) {
        showInAppToast('Camera permission required', { durationMs: 2000 });
        return;
      }
    }
    const locationGranted = await requestLocationPermission();
    if (!locationGranted) {
      showInAppToast('Location permission required for Wi-Fi', { durationMs: 2000 });
      return;
    }
    setShowCamera(true);
  };

  // Ensure Wi-Fi is on
  const turnWifiOn = async () => {
    try {
      await WifiManager.setEnabled(true);
      setWifiEnabled(true);
      setIsScanning(true);
      showInAppToast("Enabling WiFi...", { durationMs: 2000 });

      // Wait for hardware
      await new Promise(resolve => setTimeout(resolve, 3000));

      shouldForceScanRef.current = true;
      scanRetryCountRef.current = 0;
      await scanNetworks(true);
      await fetchCurrentNetwork();
    } catch (error) {
      console.warn("Error enabling WiFi:", error);
      showInAppToast("Failed to enable WiFi", { durationMs: 2000 });
    }
  };

  // Handle network press
  const handleNetworkPress = async (network) => {
    if (isConnecting) return;

    const isConnected = ssidsMatch(currentNetwork?.SSID, network.SSID);

    // Do nothing when tapping the currently connected network
    if (isConnected && connectionStatus === 'connected') {
      return;
    }

    setSelectedNetwork(network);
    setConnectionStatus('connecting');

    const lookupSSID = normalizeSSID(network.SSID);

    const requiresPassword =
      network.capabilities &&
      (network.capabilities.includes('PSK') ||
        network.capabilities.includes('RSN') ||
        network.capabilities.includes('WEP'));

    if (requiresPassword) {
      const savedPwd = getPasswordForSSID(networkPasswords, lookupSSID);

      if (savedPwd) {
        showInAppToast(`Connecting to ${lookupSSID}...`, { durationMs: 2500 });
        connectToNetwork(network, savedPwd);
      } else {
        // Clear password and show modal
        setConnectionStatus('disconnected');
        setPassword('');
        setShowPassword(false); // Always default to hidden when opening
        setPasswordModalVisible(true);

        setTimeout(() => {
          if (passwordInputRef.current) {
            passwordInputRef.current.focus();
          }
        }, 300);
      }
    } else {
      connectToNetwork(network, '');
    }
  };

  // Get saved networks (persisted SSIDs, passwords, and active connection)
  const getSavedNetworks = () => {
    const savedBySSID = new Map();

    const addEntry = (ssid) => {
      const normalized = normalizeSSID(ssid);
      if (!normalized) return;

      savedBySSID.set(normalized, {
        SSID: normalized,
        isSaved: true,
        hasPassword: Boolean(getPasswordForSSID(networkPasswords, normalized)),
        isConnected: ssidsMatch(currentNetwork?.SSID, normalized) && connectionStatus === 'connected',
        isAvailable: networks.some((net) => ssidsMatch(net.SSID, normalized)),
      });
    };

    savedNetworkSSIDs.forEach(addEntry);
    Object.keys(networkPasswords).forEach(addEntry);
    if (currentNetwork?.SSID) {
      addEntry(currentNetwork.SSID);
    }

    return Array.from(savedBySSID.values());
  };

  const getConnectedNetworkEntries = () => {
    if (!currentNetwork?.SSID) return [];

    const normalized = normalizeSSID(currentNetwork.SSID);
    const fromScan = networks.filter((net) => ssidsMatch(net.SSID, normalized));
    if (fromScan.length > 0) return fromScan;

    if (connectionStatus === 'connected' || connectionStatus === 'verifying') {
      return [{
        SSID: normalized,
        BSSID: `connected_${normalized}`,
        level: -50,
        capabilities: '[ESS]',
      }];
    }

    return [];
  };

  const getSavedNetworksForMainList = () => {
    return getSavedNetworks().map((item) => {
      const scanned = networks.find((net) => ssidsMatch(net.SSID, item.SSID));
      return scanned || {
        SSID: item.SSID,
        level: -100,
        capabilities: '[ESS]',
        BSSID: `saved_${item.SSID}`,
      };
    });
  };

  // Handle saved network press
  const handleSavedNetworkPress = async (savedNetwork) => {
    if (isConnecting) return;

    // If this saved network is already the current one, do nothing on tap
    const isCurrentlyConnected =
      ssidsMatch(currentNetwork?.SSID, savedNetwork.SSID) && connectionStatus === 'connected';

    if (isCurrentlyConnected) {
      return;
    }

    const lookupSSID = normalizeSSID(savedNetwork.SSID);

    setIsConnecting(true);
    isConnectingRef.current = true;
    pauseScanning();
    setConnectionStatus('connecting');
    showInAppToast(`Searching for ${lookupSSID}...`, { durationMs: 2000 });

    try {
      const maxScanAttempts = 3;
      let availableNetwork = null;

      for (let attempt = 1; attempt <= maxScanAttempts; attempt++) {
        if (!isMountedRef.current) return;

        console.log(`Scan attempt ${attempt} for saved network: ${lookupSSID}`);

        try {
          if (Platform.OS === 'android') {
            await WifiManager.reScanAndLoadWifiList();
          }
          const freshResults = await WifiManager.loadWifiList();

          if (Array.isArray(freshResults)) {
            const matches = freshResults.filter(net => ssidsMatch(net.SSID, savedNetwork.SSID));

            if (matches.length > 0) {
              matches.sort((a, b) => Math.abs(a.level || -100) - Math.abs(b.level || -100));
              availableNetwork = matches[0];
              break;
            }
          }
        } catch (scanError) {
          console.warn(`Scan attempt ${attempt} failed:`, scanError);
        }

        if (attempt < maxScanAttempts) {
          // Wait 2 seconds before the next scan attempt
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (availableNetwork) {
        // Network found, proceed to connect
        const savedPwd = getPasswordForSSID(networkPasswords, lookupSSID);
        setSelectedNetwork(availableNetwork);
        showInAppToast(`Connecting to ${lookupSSID}...`, { durationMs: 2500 });

        // Pass the network directly to connectToNetwork
        // Note: connectToNetwork handles setIsConnecting(false) and connectionStatus resets
        await connectToNetwork(availableNetwork, savedPwd, true);
      } else {
        // Network still not found after all attempts
        showInAppToast(`${savedNetwork.SSID} is not in range`, { durationMs: 3000 });
        setIsConnecting(false);
        isConnectingRef.current = false;
        setConnectionStatus('disconnected');
        resumeScanning(true);
      }
    } catch (error) {
      console.warn('Error in handleSavedNetworkPress:', error);
      setIsConnecting(false);
      isConnectingRef.current = false;
      setConnectionStatus('disconnected');
      resumeScanning(true);
    }
  };

  // Forget saved network
  const forgetSavedNetwork = async (ssid) => {
    try {
      const normalizedSSID = normalizeSSID(ssid);
      if (!normalizedSSID) return;

      // 1. Remove from app storage (all SSID variants)
      await removePasswordFromStorage(normalizedSSID);

      // 2. Remove from OS
      try {
        await SystemTimeModule.forgetNetwork(normalizedSSID);
        console.log('Forgot network from OS via saved list:', normalizedSSID);
      } catch (e) {
        console.warn('Error forgetting network from OS via saved list:', e);
      }

      if (ssidsMatch(currentNetwork?.SSID, normalizedSSID)) {
        setCurrentNetwork(null);
        setConnectionStatus('disconnected');
      }

      showInAppToast(`Forgot network: ${normalizedSSID}`, { durationMs: 2000 });
    } catch (error) {
      console.warn('Error forgetting network:', error);
      showInAppToast('Failed to forget network', { durationMs: 2000 });
    }
  };

  // Get sorted networks with connected network first
  const getSortedNetworks = () => {
    const activeNetworks = debouncedNetworks.length > 0 ? debouncedNetworks : networks;
    if (!activeNetworks.length) return [];

    const connectedNetwork = activeNetworks.find(net => ssidsMatch(currentNetwork?.SSID, net.SSID));
    const otherNetworks = activeNetworks.filter(net => !ssidsMatch(currentNetwork?.SSID, net.SSID));

    if (connectedNetwork) {
      return [connectedNetwork, ...otherNetworks];
    }

    return activeNetworks;
  };

  // Render network item
  const renderNetworkItem = ({ item }) => {
    const isActuallyConnected = ssidsMatch(currentNetwork?.SSID, item.SSID) && connectionStatus === 'connected';
    const isConnectingToThis = ssidsMatch(selectedNetwork?.SSID, item.SSID) && isConnecting;

    const isSecure = item.capabilities &&
      (item.capabilities.includes('PSK') ||
        item.capabilities.includes('RSN') ||
        item.capabilities.includes('WEP'));
    const isSaved = isNetworkSaved(item.SSID) && !isActuallyConnected;

    // Signal strength label from onboarding logic
    const getSignalStrengthLabel = (level) => {
      const signalLevel = Math.abs(level);
      if (signalLevel <= 50) return 'Excellent';
      if (signalLevel <= 60) return 'Good';
      if (signalLevel <= 70) return 'Fair';
      return 'Weak';
    };

    return (
      <TouchableOpacity
        style={[
          styles.networkItem,
          isActuallyConnected && styles.connectedNetworkItem,
          isConnectingToThis && styles.connectingNetworkItem,
          selectedNetwork?.SSID === item.SSID && !isConnecting && !isActuallyConnected && styles.selectedNetworkItem
        ]}
        onPress={() => handleNetworkPress(item)}
        disabled={isConnecting}
        activeOpacity={0.8}
      >
        <View style={styles.wifiIconContainer}>
          <Image
            source={WIFI_ICON}
            style={[
              styles.originalWifiIcon,
              isActuallyConnected && styles.connectedWifiIcon,
              isConnectingToThis && styles.connectingWifiIcon
            ]}
          />
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
              <Text style={[styles.signalStrength, item.isFading && { color: '#FFA000' }]}>
                {item.isFading ? 'Signal weak' : getSignalStrengthLabel(item.level)}
              </Text>
              <VerticalDivider color="#555555" />
              <Text style={styles.securityText}>
                {isSecure ? 'Secured' : 'Open'}
              </Text>
              {isSaved && (
                <>
                  <VerticalDivider color="#555555" />
                  <Text style={styles.savedText}>Saved</Text>
                </>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Render saved network item (for saved networks view)
  const renderSavedNetworkItem = ({ item }) => {
    const isActuallyConnected = ssidsMatch(currentNetwork?.SSID, item.SSID) && connectionStatus === 'connected';
    const isConnectingToThis = ssidsMatch(selectedNetwork?.SSID, item.SSID) && isConnecting;
    const isAvailable = networks.some((net) => ssidsMatch(net.SSID, item.SSID));

    return (
      <TouchableOpacity
        style={[
          styles.networkItem,
          isActuallyConnected && styles.connectedNetworkItem,
          !isAvailable && styles.unavailableNetworkItem,
          isConnectingToThis && styles.connectingNetworkItem
        ]}
        onPress={() => handleSavedNetworkPress(item)}
        disabled={isConnecting}
      >
        <Image
          source={WIFI_ICON}
          style={[
            styles.originalWifiIcon,
            isActuallyConnected && styles.connectedWifiIcon,
            !isAvailable && styles.unavailableWifiIcon,
            isConnectingToThis && styles.connectingWifiIcon
          ]}
        />
        <View style={styles.networkInfo}>
          <Text style={[
            styles.networkName,
            isActuallyConnected && styles.connectedNetworkName,
            !isAvailable && styles.unavailableNetworkName,
            isConnectingToThis && styles.connectingNetworkName
          ]}>
            {item.SSID}
          </Text>
          <View style={styles.networkDetails}>
            {isActuallyConnected ? (
              <Text style={styles.connectedText}>Connected</Text>
            ) : isConnectingToThis ? (
              <Text style={[styles.connectingText, { color: '#22B2A6' }]}>
                {connectionStatus === 'verifying' ? 'Verifying...' : 'Connecting...'}
              </Text>
            ) : isAvailable ? (
              <Text style={[styles.availableText, item.isFading && { color: '#FFA000' }]}>
                {item.isFading ? 'Signal weak - Tap to connect' : 'Available - Tap to connect'}
              </Text>
            ) : (
              <Text style={styles.unavailableText}>Not in range</Text>
            )}
            <VerticalDivider />
            <Text style={styles.savedText}>Saved</Text>
            <VerticalDivider />
            <TouchableOpacity
              onPress={() => forgetSavedNetwork(item.SSID)}
              style={styles.forgetButton}
            >
              <Text style={styles.forgetText}>Forget</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Toggle dropdown menu
  const toggleDropdown = () => {
    setShowDropdown(!showDropdown);
  };

  // Handle menu option selection
  const handleMenuSelect = (option) => {
    setShowDropdown(false);

    switch (option) {
      case 'scanner':
        handleQRScanPress();
        break;
      case 'saved':
        setShowSavedNetworks(true);
        break;
      default:
        break;
    }
  };

  // Effect for initial load and visibility changes
  useEffect(() => {
    isMountedRef.current = true;

    if (visible) {
      scanSessionStartRef.current = Date.now();
      lastNetworkFingerprintRef.current = '';
      scanRetryCountRef.current = 0;
      // Reset view states when opening
      setShowSavedNetworks(false);
      setShowDropdown(false);

      const init = async () => {
        await requestLocationPermission();
        await requestNearbyWifiPermission();
        const isEnabled = await checkWifiState();
        if (isEnabled) {
          scanNetworks(true);
          fetchCurrentNetwork();
        } else {
          await turnWifiOn();
        }
      };
      init();
    }

    return () => {
      isMountedRef.current = false;
      clearAllTimeouts();
    };
  }, [visible]);

  // Handle AppState changes
  useEffect(() => {
    const handleStateChange = (nextState) => {
      if (appState.match(/inactive|background/) && nextState === 'active') {
        if (visible) {
          loadSavedPasswords();
          if (wifiEnabled) {
            shouldForceScanRef.current = true;
            scanNetworks(true);
            fetchCurrentNetwork();
          }
        }
      }
      setAppState(nextState);
    };

    const subscription = AppState.addEventListener('change', handleStateChange);
    return () => subscription.remove();
  }, [appState, visible, wifiEnabled]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={true}
      transparent={true}
    >
      <View
        style={styles.fullScreenContainer}
        onStartShouldSetResponder={() => {
          DeviceEventEmitter.emit('userActivity');
          return false;
        }}
      >
        <View style={styles.innerFullScreen}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => {
              if (showSavedNetworks) {
                setShowSavedNetworks(false);
              } else {
                onClose();
              }
            }}>
              <Image source={backIcon} style={styles.backButtonIcon} />
            </TouchableOpacity>
            <Text style={styles.title}>
              {showSavedNetworks ? 'Saved Networks' : 'Wi-Fi'}
            </Text>

            {!showSavedNetworks && (
              <View style={styles.headerRight}>
                <TouchableOpacity onPress={toggleDropdown}>
                  <MaterialCommunityIcons name="dots-vertical" size={28} color="#FFFFFF" style={{ padding: 6, right: -30 }} />
                </TouchableOpacity>

                {/* Dropdown Menu */}
                {showDropdown && (
                  <View style={styles.dropdownMenu}>
                    <TouchableOpacity
                      style={styles.dropdownItem}
                      onPress={() => handleMenuSelect('saved')}
                    >
                      <Text style={styles.dropdownText}>Saved Networks</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Body */}
          <View style={styles.content}>
            <View style={styles.networksContainer}>
              {showSavedNetworks ? (
                // Saved Networks View - Show only saved networks
                getSavedNetworks().length > 0 ? (
                  <VirtualizedList
                    data={getSavedNetworks()}
                    getItemCount={(data) => data.length}
                    getItem={(data, index) => data[index]}
                    keyExtractor={(item) => item.SSID}
                    renderItem={renderSavedNetworkItem}
                    contentContainerStyle={{ paddingTop: 15, paddingBottom: 100 }}
                    keyboardShouldPersistTaps="handled"
                  />
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.noNetworks}>No saved networks</Text>
                    <Text style={styles.emptyStateSubtitle}>
                      Networks you connect to will be saved here automatically
                    </Text>
                  </View>
                )
              ) : !wifiEnabled ? (
                <View style={styles.wifiOffContainer}>
                  <Image source={WIFI_ICON} style={styles.wifiOffIcon} />
                  <Text style={styles.wifiOffMessage}>WiFi is turned off</Text>
                  <Text style={styles.wifiOffSubmessage}>
                    Turn on WiFi to see available networks
                  </Text>
                  <TouchableOpacity
                    style={styles.turnOnButton}
                    onPress={turnWifiOn}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.turnOnButtonText}>Turn WiFi On</Text>
                  </TouchableOpacity>
                </View>
              ) : isScanning && networks.length === 0 ? (
                <View style={styles.scanningContainer}>
                  <View style={styles.loadingDotsContainer}>
                    <View style={[styles.loadingDot, styles.loadingDot1]} />
                    <View style={[styles.loadingDot, styles.loadingDot2]} />
                    <View style={[styles.loadingDot, styles.loadingDot3]} />
                  </View>
                  <Text style={styles.searchingText}>Scanning for networks...</Text>
                </View>
              ) : (networks.length > 0 || getConnectedNetworkEntries().length > 0 || getSavedNetworks().length > 0) ? (
                <SectionList
                  sections={[
                    {
                      title: 'Connected Network',
                      data: getConnectedNetworkEntries()
                    },
                    {
                      title: 'Saved Networks',
                      data: getSavedNetworksForMainList()
                    },
                    {
                      title: 'Available Networks',
                      data: networks.filter(net =>
                        !isNetworkSaved(net.SSID) &&
                        !ssidsMatch(currentNetwork?.SSID, net.SSID)
                      )
                    }
                  ].filter(section => section.data.length > 0 || section.title === 'Available Networks')}
                  keyExtractor={(item) => item.BSSID + item.SSID}
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
                  contentContainerStyle={{ paddingTop: 15, paddingBottom: 100 }}
                  keyboardShouldPersistTaps="handled"
                  stickySectionHeadersEnabled={false}
                />
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.noNetworks}>No networks found</Text>
                  {scanAttemptCount > 0 && (
                    <Text style={[styles.emptyStateSubtitle, { marginTop: 5 }]}>
                      (After {scanAttemptCount} {scanAttemptCount === 1 ? 'attempt' : 'attempts'})
                    </Text>
                  )}
                  <TouchableOpacity onPress={() => scanNetworks(true)} style={{ marginTop: 15 }}>
                    <Text style={{ color: '#22B2A6', fontFamily: 'ProductSans-Bold' }}>Try Again</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* QR Camera Modal */}
          <Modal
            visible={showCamera}
            animationType="slide"
            onRequestClose={() => setShowCamera(false)}
            statusBarTranslucent={true}
          >
            <View style={styles.cameraContainer}>
              {device && (
                <Camera
                  style={StyleSheet.absoluteFill}
                  device={device}
                  isActive={showCamera}
                  codeScanner={codeScanner}
                  audio={false}
                />
              )}
              <View style={styles.cameraOverlay}>
                <View style={styles.cameraHeader}>
                  <TouchableOpacity style={styles.cameraBackButton} onPress={() => setShowCamera(false)}>
                    <Image source={backIcon} style={styles.cameraBackIcon} />
                  </TouchableOpacity>
                  <Text style={styles.cameraTitle}>Scan Wi-Fi QR Code</Text>
                  <View style={styles.placeholder} />
                </View>
                <View style={styles.scanFrame}>
                  <View style={styles.scanFrameBorder} />
                </View>
                <Text style={styles.scanInstructions}>
                  Position a Wi-Fi QR code within the frame{'\n'}
                  Format: WIFI:S:SSID;T:TYPE;P:PASSWORD;;
                </Text>
              </View>
            </View>
          </Modal>

          {/* Password Modal */}
          <Modal
            visible={passwordModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (!isConnecting) {
                setPasswordModalVisible(false);
                setPassword('');
                setShowPassword(false);
                Keyboard.dismiss();
              }
            }}
            statusBarTranslucent={true}
          >
            <TouchableOpacity
              style={styles.passwordModalOverlay}
              activeOpacity={1}
              onPress={() => {
                if (!isConnecting) {
                  setPasswordModalVisible(false);
                  setPassword('');
                  setShowPassword(false);
                  Keyboard.dismiss();
                }
              }}
            >
              <TouchableOpacity activeOpacity={1} style={{ width: '100%', alignItems: 'center' }}>
                <View style={styles.passwordModalContent}>
                  <Text style={styles.modalTitle}>Enter Password for</Text>
                  <Text style={styles.modalSubTitle}>{selectedNetwork?.SSID}</Text>

                  <View style={styles.passwordInputContainer}>
                    <View style={styles.passwordInputRow}>
                      <KioskTextInput
                        ref={passwordInputRef}
                        style={styles.input}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Enter Password"
                        secureTextEntry={!showPassword}
                        placeholderTextColor="#888"
                        editable={!isConnecting}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={() => (password || '').trim().length >= 8 && connectToNetwork(selectedNetwork, password)}
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
                        if (!isConnecting) {
                          setPasswordModalVisible(false);
                          setPassword('');
                          setShowPassword(false);
                          Keyboard.dismiss();
                        }
                      }}
                      style={[styles.modalButton, styles.cancelButton, isConnecting && styles.disabledButton]}
                      disabled={isConnecting}
                    >
                      <Text style={styles.modalButtonText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => connectToNetwork(selectedNetwork, password)}
                      style={[
                        styles.modalButton,
                        styles.connectButton,
                        (isConnecting || (password || '').trim().length < 8) && styles.disabledButton
                      ]}
                      disabled={isConnecting || (password || '').trim().length < 8}
                    >
                      <Text style={styles.modalButtonText}>
                        {isConnecting ? 'Connecting...' : 'Connect'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
            <CustomKeyboard />
          </Modal>

          {/* Saved Password Modal */}
          <Modal
            visible={savedPasswordModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => {
              setSavedPasswordModalVisible(false);
              setShowSavedPassword(false);
            }}
            statusBarTranslucent={true}
          >
            <TouchableOpacity
              style={styles.passwordModalOverlay}
              activeOpacity={1}
              onPress={() => {
                setSavedPasswordModalVisible(false);
                setShowSavedPassword(false);
              }}
            >
              <TouchableOpacity activeOpacity={1} style={{ width: '100%', alignItems: 'center' }}>
                <View style={styles.passwordModalContent}>
                  <Text style={styles.modalTitle}>
                    {currentNetwork?.SSID === selectedNetwork?.SSID ? 'Connected Network' : 'Saved Network'}
                  </Text>
                  <Text style={styles.modalSubTitle}>{selectedNetwork?.SSID}</Text>

                  <View style={styles.passwordInputContainer}>
                    <KioskTextInput
                      ref={savedInputRef}
                      style={[styles.input, styles.disabledInput]}
                      value={savedPassword}
                      onChangeText={setSavedPassword}
                      placeholder="Password"
                      secureTextEntry={!showSavedPassword}
                      placeholderTextColor="#888"
                      editable={false}
                      autoCapitalize="none"
                      autoCorrect={false}
                      showDismiss={true}
                    />
                    <TouchableOpacity
                      style={styles.eyeIcon}
                      onPress={() => setShowSavedPassword(!showSavedPassword)}
                    >
                      <Text style={styles.eyeIconText}>{showSavedPassword ? "Hide" : "Show"}</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      onPress={() => {
                        setSavedPasswordModalVisible(false);
                        setShowSavedPassword(false);
                      }}
                      style={[styles.modalButton, { backgroundColor: '#9e9e9e' }]}
                    >
                      <Text style={styles.modalButtonText}>Close</Text>
                    </TouchableOpacity>

                    {currentNetwork?.SSID === selectedNetwork?.SSID && (
                      <TouchableOpacity
                        onPress={disconnectFromNetwork}
                        style={[styles.modalButton, { backgroundColor: '#d32f2f' }]}
                      >
                        <Text style={styles.modalButtonText}>Disconnect</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
            <CustomKeyboard />
          </Modal>

          {/* Custom keyboard for main WiFi settings view (e.g. saved network password field) */}
          <CustomKeyboard />
        </View>
      </View>
    </Modal >
  );
};

const styles = StyleSheet.create({
  fullScreenContainer: {
    width: Dimensions.get('screen').width,
    height: Dimensions.get('screen').height,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  innerFullScreen: {
    flex: 1,
    backgroundColor: '#000000',
    marginTop: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    backgroundColor: 'transparent',
  },
  backButton: {
    height: 44,
    width: 44,
    left: 1,
    top: 0,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#41403D',
    borderWidth: 1,
    borderColor: '#333333',
  },
  backButtonIcon: { width: 25, height: 25, tintColor: '#FFFFFF' },
  title: {
    fontSize: 24,
    fontFamily: 'ProductSans-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  menuIcon: {
    width: 40,
    height: 40,
    tintColor: '#FFFFFF'
  },
  dropdownMenu: {
    position: 'absolute',
    top: 50,
    right: 0,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    minWidth: 160,
    zIndex: 1000,
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  dropdownText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  content: { flex: 1 },
  label: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
    fontFamily: 'ProductSans-Bold'
  },
  networksContainer: { flex: 1 },
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
  searching: {
    textAlign: 'center',
    marginTop: 20,
    color: '#888888',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular'
  },
  noNetworks: {
    textAlign: 'center',
    marginTop: 20,
    color: '#888888',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular'
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyStateSubtitle: {
    textAlign: 'center',
    marginTop: 10,
    color: '#666666',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'ProductSans-Regular'
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
    borderColor: '#30D158',
    backgroundColor: '#1a2a1a',
  },
  unavailableNetworkItem: {
    opacity: 0.5,
  },
  connectingNetworkItem: {
    borderColor: '#22B2A6',
    opacity: 0.8,
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
  originalWifiIcon: {
    width: 20,
    height: 20,
    tintColor: '#FFFFFF'
  },
  connectedWifiIcon: {
    tintColor: '#30D158',
  },
  unavailableWifiIcon: {
    tintColor: '#666666',
  },
  connectingWifiIcon: {
    tintColor: '#22B2A6',
  },
  networkInfo: {
    marginLeft: 12,
    flex: 1
  },
  networkName: {
    fontSize: 16,
    color: '#FFFFFF',
    fontFamily: 'ProductSans-Bold',
    marginBottom: 4,
  },
  connectedNetworkName: {
    color: '#30D158',
  },
  unavailableNetworkName: {
    color: '#888888',
  },
  connectingNetworkName: {
    color: '#22B2A6',
  },
  connectedText: {
    color: '#30D158',
    fontWeight: 'bold',
    fontSize: 12,
    fontFamily: 'ProductSans-Bold'
  },
  availableText: {
    color: '#22B2A6',
    fontSize: 12,
    fontFamily: 'ProductSans-Regular'
  },
  unavailableText: {
    color: '#666666',
    fontSize: 12,
    fontFamily: 'ProductSans-Regular'
  },
  networkDetails: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signalStrength: {
    color: '#AAAAAA',
    fontSize: 12,
    fontFamily: 'ProductSans-Regular'
  },
  securityText: {
    color: '#AAAAAA',
    fontSize: 12,
    marginLeft: 5,
    fontFamily: 'ProductSans-Regular'
  },
  savedText: {
    color: '#22B2A6',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 5,
    fontFamily: 'ProductSans-Bold'
  },
  forgetButton: {
    marginLeft: 5,
  },
  forgetText: {
    color: '#ff4444',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'ProductSans-Bold'
  },
  lockIcon: {
    marginLeft: 8,
  },
  // Scanning Component Styles
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
  loadingDot1: { opacity: 0.4 },
  loadingDot2: { opacity: 0.7 },
  loadingDot3: { opacity: 1.0 },
  searchingText: {
    color: '#888888',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
  },
  // Camera Styles
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
    marginTop: 40,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  cameraHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  eyeIconContainer: {
    padding: 16,
  },
  cameraBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
  },
  cameraBackIcon: {
    width: 20,
    height: 20,
    tintColor: '#ffffff',
    marginRight: 8,
  },
  cameraTitle: {
    fontSize: 18,
    color: '#ffffff',
    fontFamily: 'ProductSans-Bold',
  },
  placeholder: {
    width: 35,
  },
  scanFrame: {
    alignSelf: 'center',
    width: 250,
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrameBorder: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#22B2A6',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  scanInstructions: {
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 100,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 20,
    lineHeight: 24,
    fontFamily: 'ProductSans-Regular',
  },
  // Modal Styles
  passwordModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    marginTop: 40,
  },
  passwordModalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1e1e1e',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333333',
    elevation: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'ProductSans-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  modalSubTitle: {
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
    color: '#AAAAAA',
    textAlign: 'center',
    marginBottom: 20,
  },
  passwordInputContainer: {
    marginBottom: 24,
  },
  passwordInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333333',
    height: 56,
  },
  passwordHintText: {
    fontSize: 12,
    color: '#AAAAAA',
    marginTop: 6,
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
  disabledInput: {
    opacity: 0.6,
  },
  eyeIcon: {
    padding: 16,
  },
  eyeIconText: {
    color: '#22B2A6',
    fontFamily: 'ProductSans-Bold',
    fontSize: 14,
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
  disabledButton: {
    opacity: 0.6,
  },
  cancelButton: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#333333',
  },
  connectButton: {
    backgroundColor: '#22B2A6',
  },
  modalButtonText: {
    color: '#ffffffff',
    fontWeight: 'bold',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  networksScrollView: {
    flex: 1,
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
    marginLeft: 10,
  },
});

export default WifiSettingsModal;