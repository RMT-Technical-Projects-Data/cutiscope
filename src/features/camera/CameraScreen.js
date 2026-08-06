import React, { useState, useRef, useEffect, useCallback } from 'react';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Image,
  TouchableOpacity,
  Text,
  Alert,
  Dimensions,
  Animated,
  Vibration,
  Platform,
  ToastAndroid,
  LogBox,
  StatusBar,
  Linking,
  PanResponder,
  Easing,
  BackHandler,
  ActivityIndicator,
  DeviceEventEmitter,
  AppState,
  InteractionManager,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import NetInfo from '@react-native-community/netinfo';
import Sound from 'react-native-sound';
import { PermissionsAndroid } from 'react-native';
import { NativeModules } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { UserMessages } from '../../shared/utils/userMessages';
import { getGuestPhotosDir } from '../gallery/guestPhotoStorage';
import { notifyUserActivity, setSessionIdleHold, showInAppToast } from '../../shared/utils/inAppToast';
import GalleryIndexer from '../../shared/native/GalleryIndexer';
import { DELETED_FILES_KEY } from '../gallery/utils/galleryPathUtils';
import { sanitizeFolderName, buildUserGalleryBase } from '../gallery/utils/albumPathBuilder';
import Orientation from 'react-native-orientation-locker';

// Import Auth Context
import { useAuth } from '../auth/authSessionContext';

// Import components
import CustomStatusBar from '../../shared/ui/CustomStatusBar';
import { ZoomRuler } from './cameraZoomRuler';
import MillimeterScale from './components/millimeterScale';
import CameraPreview from './components/cameraPreview';
import { styles } from './styles/cameraScreenStyles';
import CameraChrome from './components/cameraBottomControls';
import { useCameraSession } from './hooks/useCameraSession';
import { useBatteryStatus } from './hooks/useBatteryStatus';
import { useVolumePolarization } from './hooks/useVolumePolarization';
import { useStandbyAndScreenOff } from './hooks/useStandbyAndScreenOff';
import { useCameraCapture } from './hooks/useCameraCapture';
import { useCameraZoomControls } from './hooks/useCameraZoomControls';
import { useCameraTorch } from './hooks/useCameraTorch';
import SettingsMenu from '../settings/SettingsMenu';

import WifiSettingsModal from '../wifi/WiFiSettingsModal';
import ConfirmationModal from '../../shared/ui/ConfirmationModal';
import PowerOffModal from '../device/PowerOffModal';
import PatientBoxModal from '../patients/patientSelectModal';
import StandbyModal from '../device/StandbyModal';
import BodyPartModal from '../patients/BodyPartModal';
import { reconcileSelectedPatient } from '../patients/patientsService';

import TitleImg from '../../../assets/dscope-app.png';
import VolumeManager from 'react-native-volume-manager';

const CameraScreen = ({ navigation }) => {
  const isFocused = useIsFocused();
  const [showImage, setShowImage] = useState(false);

  // Use Auth Context
  const { userData, isGuest, getUsername, exitGuestMode, signOut } = useAuth();

  // Vision Camera session (device / permission / format / zoom bounds)
  const {
    hasPermission,
    requestPermission,
    device,
    format,
    UI_MIN_ZOOM,
    UI_MAX_ZOOM,
    HW_MIN_ZOOM,
    HW_MAX_ZOOM,
    maxZoom,
    deviceMaxZoom,
  } = useCameraSession();


  const cameraRef = useRef(null);
  const scale = useRef(new Animated.Value(1)).current;
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuWidth] = useState(new Animated.Value(0));
  const [wifiMenuVisible, setWifiMenuVisible] = useState(false);
  const [wifiState, setWifiState] = useState('unknown');
  const [showSlider, setShowSlider] = useState(false);
  const [zoomBtnValue, setZoomBtnValue] = useState(1.0);
  const [exposureBtnValue, setExposureBtnValue] = useState(0.0);
  const [showTopScaleBar, setShowTopScaleBar] = useState(false); // Start hidden, show only when zoomed in
  const [exitModalVisible, setExitModalVisible] = useState(false); // Exit confirmation modal
  const [powerOffModalVisible, setPowerOffModalVisible] = useState(false);
  // Global App.js power menu is open — hide StandbyModal so it cannot cover it.
  const [globalPowerMenuOpen, setGlobalPowerMenuOpen] = useState(false);

  // ========== FLASHLIGHT STATE ==========
  const [isFlashOn, setIsFlashOn] = useState(false); // Start as OFF
  const [isLightOn, setIsLightOn] = useState(false);
  const { batteryLevel } = useBatteryStatus({
    onLowBattery: () => {
      setIsLightOn(false);
      setIsFlashOn(false);
      if (Platform.OS === 'android' && NativeModules.DermascopeModule) {
        NativeModules.DermascopeModule.setPolarization(false, 0);
      }
      showInAppToast('Battery is low. Please charge the device to use the polarized leds.', { durationMs: 3500 });
    },
  });

  // ========== PATIENT / BOX (images saved to folder with this ID and name) ==========
  const [currentBox, setCurrentBox] = useState({ id: '', name: '' });
  const currentBoxRef = useRef(currentBox);
  currentBoxRef.current = currentBox;
  const [patientBoxModalVisible, setPatientBoxModalVisible] = useState(false);
  const [bodyPart, setBodyPart] = useState('');
  const [bodyPartModalVisible, setBodyPartModalVisible] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const boxSaved = await AsyncStorage.getItem('@patient_box');
        if (boxSaved) {
          const parsed = JSON.parse(boxSaved);
          if (parsed?.id != null && parsed?.name != null) {
            setCurrentBox({ id: String(parsed.id), name: String(parsed.name) });
          }
        }
      } catch (e) {
        console.warn('Load patient box:', e);
      }
    })();
  }, []);

  // Keep selected patient in sync with portal edits (same id, updated name → new folder).
  const syncSelectedPatientFromServer = useCallback(async () => {
    if (isGuest) return;
    const box = currentBoxRef.current;
    if (!box?.id) return;
    try {
      const updated = await reconcileSelectedPatient(box);
      if (!updated) return;
      setCurrentBox(updated);
      await AsyncStorage.setItem('@patient_box', JSON.stringify(updated));
      console.log('Synced patient from portal:', updated.id, updated.name);
    } catch (e) {
      console.warn('Patient sync failed:', e?.message || e);
    }
  }, [isGuest]);

  // When patient picker opens, refresh selected patient from server immediately.
  useEffect(() => {
    if (patientBoxModalVisible && !isGuest) {
      syncSelectedPatientFromServer();
    }
  }, [patientBoxModalVisible, isGuest, syncSelectedPatientFromServer]);

  // While camera is open, periodically pull portal renames so new captures
  // use the updated {id}__{name} folder without requiring a manual re-tap.
  useEffect(() => {
    if (!isFocused || isGuest) return undefined;
    syncSelectedPatientFromServer();
    const intervalId = setInterval(() => {
      syncSelectedPatientFromServer();
    }, 30000);
    return () => clearInterval(intervalId);
  }, [isFocused, isGuest, syncSelectedPatientFromServer]);

  // ========== CAMERA STANDBY (separate from session inactivity / logout) ==========
  // Standby: 2 min idle on Camera → StandbyModal.
  // Session logout: Settings "Inactivity Timer" via appSessionTimeoutManager + notifyUserActivity.
  const CAMERA_STANDBY_MS = 120000;
  const [isStandby, setIsStandby] = useState(false);
  const timeoutRef = useRef(null);
  const isScreenFocusedRef = useRef(true);
  const isStandbyRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const resumingFromLockRef = useRef(false);
  const resumeClearTimerRef = useRef(null);

  const isTransientCameraError = useCallback((error) => {
    if (appStateRef.current !== 'active') return true;
    const code = String(error?.code ?? '');
    const msg = String(error?.message ?? error ?? '').toLowerCase();
    return /session|interrupted|not-ready|not ready|closed|disconnected|recoverable|was interrupted|camera-is-restarting|in-use|invalid-output-configuration/.test(`${code} ${msg}`);
  }, []);

  /** Restart only the camera standby countdown (does not touch session logout). */
  const resetStandbyTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (isScreenFocusedRef.current && !isStandbyRef.current) {
      timeoutRef.current = setTimeout(() => {
        console.log('⏰ Camera standby timeout — showing StandbyModal');
        isStandbyRef.current = true;
        setIsStandby(true);
        setIsLightOn(false);
      }, CAMERA_STANDBY_MS);
    }
  }, []);

  /**
   * Camera UI interaction: ping session inactivity and restart standby as two steps.
   * Alias kept as resetInactivityTimer for existing call sites / child props.
   */
  const resetInactivityTimer = useCallback(() => {
    notifyUserActivity();
    resetStandbyTimer();
  }, [resetStandbyTimer]);

  // Freeze session logout while StandbyModal is visible so it cannot cover standby.
  useEffect(() => {
    setSessionIdleHold(!!isStandby);
    return () => {
      if (isStandby) setSessionIdleHold(false);
    };
  }, [isStandby]);

  // Create a global PanResponder to catch any touches on the screen and reset the timer
  const panResponder = useRef(
    PanResponder.create({
      // CRITICAL: Never claim ownership of touches
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => {
        resetInactivityTimer();
        return false; // Don't block other touch events
      },
      onMoveShouldSetPanResponderCapture: () => {
        resetInactivityTimer();
        return false; // Don't block other touch events
      },
    })
  ).current;


  // Handle Android Hardware Back Button
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        setIsLightOn(false);
        setIsFlashOn(false);
        setPolIconColor('polarised');
        // Force hardware turn-off for immediate feedback before the modal render
        if (NativeModules.DermascopeModule) {
          try {
            NativeModules.DermascopeModule.setPolarization(false, 0);
          } catch (e) {
            console.warn('Hardware sync error on back press:', e);
          }
        }
        setExitModalVisible(true);
        return true; // Stop default behavior (exit)
      };

      const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => backHandler.remove();
    }, [])
  );

  useStandbyAndScreenOff({
    isStandbyRef,
    setIsStandby,
    timeoutRef,
    setIsFlashOn,
    setIsLightOn,
  });


  // ========== VOLUME BUTTON POLARIZATION FUNCTIONALITY ==========
  const [polIconColor, setPolIconColor] = useState('polarised');
  const [scaleAnim] = useState(new Animated.Value(1));
  const polTimeoutRef = useRef(null);
  const pressedKeysRef = useRef({}); // Track held keys to prevent auto-repeat
  /** True while user holds the on-screen pol/torch icon (same as vol-down held). */
  const touchPolHoldRef = useRef(false);
  const polTouchHoldTimerRef = useRef(null);
  const lightPressStartRef = useRef(0);
  const POL_ICON_HOLD_MS = 280; // hold before non-polarised; quick tap still toggles torch off
  const skipNextTorchToggleRef = useRef(false);
  const syncTimeoutRef = useRef(null);

  // ========== ZOOM STATE MANAGEMENT (useCameraZoomControls) ==========
  const {
    zoom,
    startZoom,
    zoomValues,
    exposureValues,
    focusDepthValues,
    minZoom,
    pinchGesture,
    animatedCameraProps,
  } = useCameraZoomControls({
    UI_MIN_ZOOM,
    UI_MAX_ZOOM,
    HW_MIN_ZOOM,
    HW_MAX_ZOOM,
    maxZoom,
    resetInactivityTimer,
    setZoomBtnValue,
  });


  const [isPressingCapture, setIsPressingCapture] = useState(false);
  const currentZoomRef = useRef(1.0);

  // SAFE NATIVE MODULES WITH NULL CHECKS
  const nativeModules = NativeModules || {};
  const { LockTaskModule = {} } = nativeModules;

  // State variables
  const [isPressed, setIsPressed] = useState(null);
  const [isPolPressed, setIsPolPressed] = useState(null);
  const isCapturingRef = useRef(false); // Synchronous lock for capture
  const lastCaptureTimeRef = useRef(0); // Debounce for rapid clicks
  // Cache storage permission so we don't do a native permission round-trip on
  // every shot (that was adding latency to the capture path).
  const hasStoragePermissionRef = useRef(false);
  // Tracks whether the camera screen is focused, so the background queue can
  // process freely when the user is NOT on the camera (and hold off when they are).
  const isFocusedRef = useRef(true);
  // Monotonic capture counter. The gallery thumbnail must always reflect the most
  // recent shot; the background queue drains FIFO (oldest first), so it must only
  // update the thumbnail when the job it just finished is still the latest one.
  const latestCaptureSeqRef = useRef(0);
  // Background pipeline (CaptureQueue): the actual per-job work is injected via
  // this ref so the queue always calls the freshest closures without stale state.
  const captureProcessorRef = useRef(null);
  // After the last shot, briefly wait before watermark so continuous capture
  // stays snappy — but keep this short so gallery always gets scaled images soon.
  const CAPTURE_PROCESS_DEFER_MS = 400;
  // Hold-to-burst: true while finger is down on the capture button.
  const continuousCaptureRef = useRef(false);
  const [onCapturePress, setOnCapturePress] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [latestPhotoUri, setLatestPhotoUri] = useState(null);
  const latestPhotoUriRef = useRef(null);
  const isLightOnRef = useRef(false);

  useEffect(() => {
    latestPhotoUriRef.current = latestPhotoUri;
  }, [latestPhotoUri]);

  // Guest ↔ user switch: never keep the previous session's corner thumbnail.
  useEffect(() => {
    setLatestPhotoUri(null);
    latestCaptureSeqRef.current = 0;
  }, [isGuest, userData?.id]);

  // Wrapped toggle to check battery
  const toggleLight = useCallback(() => {
    if (batteryLevel <= 0.2) {
      showInAppToast('Battery is low. Please charge the device to use the polarized leds.', { durationMs: 2000 });
      return;
    }
    setIsLightOn(prev => !prev);
    resetInactivityTimer();
  }, [batteryLevel, resetInactivityTimer]);

  useEffect(() => {
    isLightOnRef.current = isLightOn;
  }, [isLightOn]);

  const syncPolarizationState = useCallback(async (isFocusSync = false, overrideIsLightOn = null) => {
    if (isFocusSync && Platform.OS === 'android' && NativeModules.DermascopeModule?.getPolarizationState) {
      try {
        await NativeModules.DermascopeModule.getPolarizationState();
      } catch (err) {
        console.warn('Sync hardware fetch error:', err);
      }
    }

    // Use override state if provided, otherwise fall back to the current ref value
    const lightIsOn = overrideIsLightOn !== null ? overrideIsLightOn : isLightOnRef.current;

    // Non-polarised while vol-down held OR while user holds the on-screen pol icon
    const wantNonPol =
      !!pressedKeysRef.current[25] || (!!lightIsOn && touchPolHoldRef.current);

    const targetColor = wantNonPol ? 'nonPolarised' : 'polarised';
    const targetMode = wantNonPol ? 2 : 1;

    // Update UI INSTANTLY
    console.log(`[POL_SYNC] UI updated to: ${targetColor} (wantNonPol: ${wantNonPol})`);
    setPolIconColor(targetColor);

    // Force hardware to match our truth (Debounced)
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      if (Platform.OS === 'android' && NativeModules.DermascopeModule) {
        try {
          if (lightIsOn) {
            NativeModules.DermascopeModule.setPolarization(true, targetMode);
          } else {
            NativeModules.DermascopeModule.setPolarization(false, 0);
          }
        } catch (err) {
          console.warn('Hardware apply error:', err);
        }
      }
    }, 150); // Debounce hardware sync to avoid overloading bridge
  }, []);

  const { height, width } = Dimensions.get('window');
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [showFocusScale, setShowFocusScale] = useState(false);

  // FOCUS STATES
  const [focusPoint, setFocusPoint] = useState(null);
  const [showFocusIndicator, setShowFocusIndicator] = useState(false);
  const [isFocusing, setIsFocusing] = useState(false);
  const [viewDimensions, setViewDimensions] = useState({ width: Dimensions.get('screen').width, height: Dimensions.get('screen').height });
  const previewTouchableRef = useRef(null);
  const previewLayoutInWindowRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const [focusDepthValue, setFocusDepthValue] = useState(0.2);
  const [focusAnimation] = useState(new Animated.Value(0));
  const [showFocusStatus, setShowFocusStatus] = useState(false);
  // Add this state near your other state declarations
  const [showTorchOnly, setShowTorchOnly] = useState(false);
  const tapTimeout = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [isDraggingZoom, setIsDraggingZoom] = useState(false);
  const scrollViewRef = useRef(null);
  const scrollExposureViewRef = useRef(null);
  const focusScrollViewRef = useRef(null);

  const [camApi, setCamApi] = useState(true);
  const [isVibrating, setIsVibrating] = useState(false);
  const vibrationInterval = useRef(null);
  const [cameraError, setCameraError] = useState(null);

  useEffect(() => {
    console.log(`[WakeUpDebug] [${Date.now()}] cameraError state changed to: ${cameraError}`);
  }, [cameraError]);

  useEffect(() => {
    const calculatedIsActive = !!(
      isScreenFocused
      && !wifiMenuVisible
      && !isStandby
    );
    console.log(`[WakeUpDebug] [${Date.now()}] Camera state variables status:`, {
      calculatedIsActive,
      isScreenFocused,
      wifiMenuVisible,
      isStandby,
      patientBoxModalVisible,
      bodyPartModalVisible,
      hasDevice: !!device,
      deviceModel: device?.name || 'unknown'
    });
  }, [isScreenFocused, wifiMenuVisible, isStandby, patientBoxModalVisible, bodyPartModalVisible, device]);

  // Vision Camera Hooks (Moved to top)
  // const { hasPermission, requestPermission } = useCameraPermission();
  // const device = useCameraDevice('back');
  // const format = useCameraFormat(device, [
  //   { videoResolution: { width: 1920, height: 1080 } },
  // ]);

  // ========== FLASHLIGHT CONTROL - FIXED VERSION ==========

  // Track if screen is focused
  const [isScreenFocused, setIsScreenFocused] = useState(true);

  useEffect(() => {
    isScreenFocusedRef.current = isScreenFocused;
  }, [isScreenFocused]);

  // Ref to ignore UP events that fire during OS window focus transitions
  const ignoreKeysRef = useRef(false);
  /** True after navigating away (e.g. Gallery); next focus forces torch off until user taps. */
  const cameraWasBlurredRef = useRef(false);

  // Called when returning from Gallery or Modals
  const handleReturnToCamera = useCallback(() => {
    console.log('🔄 Returning to camera - syncing state');
    ignoreKeysRef.current = false;

    // Force immediate sync based on physical button state and hardware
    syncPolarizationState(true);

    // Backup sync after 300ms to catch any late hardware updates
    setTimeout(() => {
      syncPolarizationState(true);
    }, 300);
  }, [syncPolarizationState]);

  const forceTorchOffUntilUserTaps = useCallback(() => {
    if (polTouchHoldTimerRef.current) {
      clearTimeout(polTouchHoldTimerRef.current);
      polTouchHoldTimerRef.current = null;
    }
    touchPolHoldRef.current = false;
    skipNextTorchToggleRef.current = false;
    setIsLightOn(false);
    setIsFlashOn(false);
    setPolIconColor('polarised');
    pressedKeysRef.current[24] = false;
    pressedKeysRef.current[25] = false;
    if (Platform.OS === 'android' && NativeModules.DermascopeModule) {
      try {
        NativeModules.DermascopeModule.setPolarization(false, 0);
      } catch (e) {
        console.warn('Polarization off (leave/return):', e);
      }
    }
  }, []);

  const resumeCameraAfterUnlock = useCallback(() => {
    if (!navigation.isFocused()) return;

    console.log('📸 Resuming camera after device unlock');
    resumingFromLockRef.current = true;
    if (resumeClearTimerRef.current) {
      clearTimeout(resumeClearTimerRef.current);
    }
    resumeClearTimerRef.current = setTimeout(() => {
      resumingFromLockRef.current = false;
      resumeClearTimerRef.current = null;
    }, 3000);

    isStandbyRef.current = false;
    isScreenFocusedRef.current = true;
    setIsStandby(false);
    setCameraError(null);
    setIsScreenFocused(true);
    handleReturnToCamera();
    resetInactivityTimer();
  }, [navigation, handleReturnToCamera, resetInactivityTimer]);

  const pauseCameraForLock = useCallback(() => {
    console.log('🔒 Device locked - pausing camera without standby overlay');
    isStandbyRef.current = false;
    setIsStandby(false);
    setCameraError(null);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    isScreenFocusedRef.current = false;
    setIsScreenFocused(false);
    setIsFlashOn(false);
    setIsLightOn(false);
  }, []);

  // Effect 1: Handle screen focus/blur for ALL navigation
  useEffect(() => {
    console.log('Setting up navigation focus listeners with delay...');
    let blurTimeout = null;

    // When screen comes into focus
    const unsubscribeFocus = navigation.addListener('focus', () => {
      console.log('📸 CameraScreen FOCUSED');
      Orientation.lockToPortrait();

      // Cancel any pending blur timeout if we quickly returned
      if (blurTimeout) {
        clearTimeout(blurTimeout);
        blurTimeout = null;
      }

      if (cameraWasBlurredRef.current) {
        cameraWasBlurredRef.current = false;
        forceTorchOffUntilUserTaps();
      }

      isScreenFocusedRef.current = true;
      setIsScreenFocused(true);
      handleReturnToCamera();

      // Stop any active Bluetooth discovery scan to prevent CameraX configuration timeout
      if (Platform.OS === 'android') {
        try {
          const BluetoothNative = require('../../shared/native/BluetoothNative').default;
          if (BluetoothNative.isAvailable()) {
            // Opportunistic — may lack BLUETOOTH_SCAN until user opens BT settings.
            Promise.resolve(BluetoothNative.stopBluetoothScan()).catch(() => {});
          }
        } catch (e) {
          // ignore
        }
      }

      // Hide volume UI when screen comes into focus
      if (Platform.OS === 'android' && VolumeManager?.showNativeVolumeUI) {
        VolumeManager.showNativeVolumeUI({ enabled: false }).catch(() => { });
      }
    });

    // When screen loses focus (going to ANY other screen)
    const unsubscribeBlur = navigation.addListener('blur', () => {
      cameraWasBlurredRef.current = true;
      console.log('📸 CameraScreen BLURRED - Scheduling delayed deactivation');

      // PREEMPTIVE RESET: Instantly wipe the state exactly when starting the transition away
      // This guarantees that when the user returns, the screen mounts with state strictly at 1.0!
      zoom.value = 1.0;
      startZoom.value = 1.0;
      setZoomBtnValue(1.0);
      setShowSlider(false);

      // PREEMPTIVE FOCUS RESET: Immediately mark as unfocused to block any pending inactivity timers.
      // This prevents a 30s timer started just before blur from locking the Gallery screen.
      isScreenFocusedRef.current = false;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Delay disabling the camera to allow transition animation to finish smoothly
      // This prevents the visual "jerk" or white splash by keeping the camera frame active
      // until the new screen (Gallery) is likely fully covered.
      blurTimeout = setTimeout(() => {
        console.log('📸 Executing delayed BLUR (camera off)');
        setIsScreenFocused(false);
      }, 500); // Increased to 500ms for even smoother transitions
    });

    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
      if (blurTimeout) clearTimeout(blurTimeout);
    };
  }, [navigation, handleReturnToCamera, forceTorchOffUntilUserTaps]);

  // Effect 1b: Handle AppState for lock/unlock — always resume live camera, never standby/wake UI
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      const prevAppState = appStateRef.current;
      appStateRef.current = nextAppState;
      console.log('📱 AppState changed:', prevAppState, '→', nextAppState);

      if (nextAppState === 'background' || nextAppState === 'inactive') {
        pauseCameraForLock();
        return;
      }

      if (nextAppState === 'active' && (prevAppState === 'background' || prevAppState === 'inactive')) {
        resumeCameraAfterUnlock();
      }
    };

    appStateRef.current = AppState.currentState;
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      if (resumeClearTimerRef.current) {
        clearTimeout(resumeClearTimerRef.current);
        resumeClearTimerRef.current = null;
      }
    };
  }, [pauseCameraForLock, resumeCameraAfterUnlock]);

  // Effect 1c: Handle Physical Power Button Event / global power menu
  useEffect(() => {
    console.log('🔌 Setting up power button event listener');
    const subscription = DeviceEventEmitter.addListener('onPowerButtonPressed', () => {
      console.log('🔌 Physical Power Button Pressed - Handling in JS');
      ignoreKeysRef.current = true;
      setIsLightOn(false);
      setGlobalPowerMenuOpen(true);
    });

    const subOpen = DeviceEventEmitter.addListener('onPowerMenuOpened', () => {
      console.log('🔌 Power Menu opened - hiding standby overlay');
      setGlobalPowerMenuOpen(true);
      setIsLightOn(false);
    });

    const subClose = DeviceEventEmitter.addListener('onPowerMenuClosed', () => {
      console.log('🔙 Power Menu closed - recovery in CameraScreen');
      setGlobalPowerMenuOpen(false);
      // Keep standby if already in standby; only re-enable key handling + sync pol.
      ignoreKeysRef.current = false;
      syncPolarizationState(true);
    });

    return () => {
      console.log('🔌 Removing power button event listener');
      subscription.remove();
      subOpen.remove();
      subClose.remove();
    };
  }, [syncPolarizationState]);

  // Effect 2: MAIN FLASHLIGHT CONTROL - Simple and reliable
  // NOTE: Flashlight works the SAME for both guest and logged-in users
  // No isGuest check - functionality is identical for all users
  useEffect(() => {
    console.log('🔦 Flashlight decision:', {
      isLightOn,
      screenFocused: isScreenFocused,
      device: !!device,
      permission: hasPermission,
      shouldBeOn: isLightOn && isScreenFocused && device && hasPermission,
      currentState: isFlashOn
    });

    // Flash should be ON when ALL conditions are met:
    // 1. Light switch is ON (Manual control)
    // 1b. Battery is > 20%
    // 2. Screen is focused (not in Gallery/Settings)

    const shouldFlashBeOn = isLightOn && batteryLevel > 0.2 && isScreenFocused && device && hasPermission;

    let timeoutId;

    // Only update if state needs to change
    if (shouldFlashBeOn !== isFlashOn) {
      console.log(shouldFlashBeOn ? '✅ Turning flashlight ON (Delayed)' : '❌ Turning flashlight OFF');

      if (shouldFlashBeOn) {
        // Delay turning the torch ON by 500ms to allow Camera components to re-initialize completely
        // from paused states (like returning from Settings Menu)
        timeoutId = setTimeout(() => {
          setIsFlashOn(true);
        }, 500);
      } else {
        setIsFlashOn(false);
      }
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLightOn, isScreenFocused, device, hasPermission, isFlashOn]);

  // Effect 4: Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 Cleaning up - turning flashlight OFF and restoring brightness');
      setIsFlashOn(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (resumeClearTimerRef.current) {
        clearTimeout(resumeClearTimerRef.current);
      }
    };
  }, []);

  // Effect 4c: Camera standby timer only (not session logout).
  useEffect(() => {
    const anyModalVisible =
      menuVisible ||
      patientBoxModalVisible ||
      bodyPartModalVisible ||
      wifiMenuVisible ||
      exitModalVisible ||
      powerOffModalVisible ||
      globalPowerMenuOpen;

    if (!isScreenFocused || isStandby || anyModalVisible) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      resetStandbyTimer();
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isScreenFocused, isStandby, menuVisible, patientBoxModalVisible, bodyPartModalVisible, wifiMenuVisible, exitModalVisible, powerOffModalVisible, globalPowerMenuOpen, resetStandbyTimer]);



  // ========== VOLUME BUTTON FUNCTIONS ==========
  // Effect 3: Sync polarization whenever flash turns ON
  // This handles returning from Gallery AND closing Modals (Settings/WiFi)
  useEffect(() => {
    if (isFlashOn) {
      console.log('🔦 Flash turned ON - Scheduling polarization sync');

      // 1. Immediate UI Sync (Trust JS tracking first)
      syncPolarizationState(true);

      // 2. Hardware Truth Sync (Trust native hardware after it settles)
      // On some devices, hardware needs ~200-300ms to recover polarization mode after torch-off
      const timer = setTimeout(() => {
        syncPolarizationState(true);
      }, 400);

      return () => clearTimeout(timer);
    }
  }, [isFlashOn, syncPolarizationState]);

  useEffect(() => {
    // Safety check: Only proceed if VolumeManager is available
    if (!VolumeManager || typeof VolumeManager.showNativeVolumeUI !== 'function') {
      console.warn('VolumeManager is not available, skipping volume UI hiding');
      return;
    }

    const hideVolumeUI = async () => {
      try {
        // Hide volume UI immediately
        await VolumeManager.showNativeVolumeUI({ enabled: false });
        console.log('✅ Volume UI hidden');
      } catch (e) {
        console.warn('VolumeManager error:', e);
      }
    };

    // Hide volume UI on mount
    hideVolumeUI();

    // Also hide when screen comes into focus (in case it was re-enabled)
    const unsubscribeFocus = navigation.addListener('focus', () => {
      hideVolumeUI();
    });

    // Periodically ensure volume UI stays hidden (some devices re-enable it)
    const volumeCheckInterval = setInterval(() => {
      hideVolumeUI();
    }, 2000); // Check every 2 seconds

    return () => {
      unsubscribeFocus();
      clearInterval(volumeCheckInterval);
    };
  }, [navigation]);

  const animatePolIcon = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.2,
        duration: 150,
        easing: Easing.ease,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 150,
        easing: Easing.ease,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const animateTorchOnIcon = useCallback(() => {
    scaleAnim.stopAnimation();
    scaleAnim.setValue(0.92);
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.12,
        duration: 140,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 160,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim]);

  // ========== MODIFIED: REMOVED TIMEOUT TO PREVENT BLINKING ==========
  const handlePolIconColorChange = color => {
    setPolIconColor(prev => {
      if (prev !== color) {
        return color;
      }
      return prev;
    });
  };

  useVolumePolarization({
    pressedKeysRef,
    ignoreKeysRef,
    polTimeoutRef,
    polTouchHoldTimerRef,
    isLightOnRef,
    resetInactivityTimer,
    syncPolarizationState,
  });

  // ========== ZOOM TO DISPLAY MAPPING ==========
  const mapZoomToDisplay = (zoomValue) => {
    const displayValue = Math.round(((zoomValue - 1.0) * 10 + 10) * 10) / 10;
    return displayValue;
  };

  // ========== STORAGE PERMISSION FUNCTION ==========
  const requestStoragePermission = useCallback(async () => {
    try {
      if (Platform.OS === 'android') {
        if (Platform.Version >= 33) {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          );
          return granted === PermissionsAndroid.RESULTS.GRANTED;
        } else if (Platform.Version >= 29) {
          const granted = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          ]);
          return (
            granted[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] ===
            PermissionsAndroid.RESULTS.GRANTED &&
            granted[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] ===
            PermissionsAndroid.RESULTS.GRANTED
          );
        } else {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          );
          return granted === PermissionsAndroid.RESULTS.GRANTED;
        }
      }
      return true;
    } catch (err) {
      console.warn('Storage permission error:', err);
      return false;
    }
  }, []);

  // ========== LEGACY ZOOM REMOVED ==========
  // Zoom is now handled by Reanimated SharedValue 'zoom' and ZoomControl component.

  // Sync scroll position when zoom changes externally
  useEffect(() => {
    if (!isDraggingZoom && scrollViewRef.current) {
      const closestIndex = zoomValues.reduce((closestIdx, value, idx) => {
        const currentDiff = Math.abs(parseFloat(value) - zoomBtnValue);
        const closestDiff = Math.abs(parseFloat(zoomValues[closestIdx]) - zoomBtnValue);
        return currentDiff < closestDiff ? idx : closestIdx;
      }, 0);

      const contentOffsetX = closestIndex * 20;

      setTimeout(() => {
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            x: contentOffsetX,
            animated: true,
          });
        }
      }, 100);
    }
  }, [zoomBtnValue, isDraggingZoom, zoomValues]);

  // ========== SHOW/HIDE ZOOM BAR BASED ON ZOOM LEVEL ==========
  useEffect(() => {
    // Show zoom bar only when zoomed in (zoom > 1.0)
    // Hide it when at default zoom (1.0)
    if (zoomBtnValue > 1.0) {
      setShowTopScaleBar(true);
    } else {
      setShowTopScaleBar(false);
    }
  }, [zoomBtnValue]);

  // ========== ZOOM MARKER PRESS ==========
  const handleZoomMarkerPress = (zoomLevel) => {
    resetInactivityTimer();
    const targetZoom = 1.0 + (zoomLevel - 10) * 0.1;
    setZoomBtnValue(targetZoom);

    console.log('Zoom marker pressed:', targetZoom);
  };

  // ========== SCROLL HANDLER ==========
  const handleScroll = Animated.event(
    [
      {
        nativeEvent: {
          contentOffset: { x: scrollX },
        },
      },
    ],
    {
      useNativeDriver: false,
      listener: (event) => {
        if (isDraggingZoom) return;

        const contentOffsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(contentOffsetX / 20);

        if (index >= 0 && index < zoomValues.length) {
          const selectedZoom = parseFloat(zoomValues[index]);
          setZoomBtnValue(selectedZoom);
          resetInactivityTimer();
        }
      },
    }
  );

  // ========== SCROLL END HANDLER ==========
  const onScrollEnd = event => {
    resetInactivityTimer();
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / 20);

    if (index >= 0 && index < zoomValues.length) {
      const selectedZoom = parseFloat(zoomValues[index]);

      setZoomBtnValue(selectedZoom);

      const currentScrollPos = index * 20;
      const actualScrollPos = contentOffsetX;

      if (Math.abs(currentScrollPos - actualScrollPos) > 10) {
        setTimeout(() => {
          if (scrollViewRef.current) {
            scrollViewRef.current.scrollTo({
              x: currentScrollPos,
              animated: true,
            });
          }
        }, 50);
      }
    }
  };

  // ========== ZOOM PRESS HANDLER ==========
  const handleZoomPress = () => {
    setShowFocusScale(false);
    setIsPressed('zoom');
    if (isPressed === 'zoom') {
      setIsPressed(null);
    }
    setShowScale(!showScale);

    const closestIndex = zoomValues.reduce((closestIdx, value, idx) => {
      const currentDiff = Math.abs(parseFloat(value) - zoomBtnValue);
      const closestDiff = Math.abs(parseFloat(zoomValues[closestIdx]) - zoomBtnValue);
      return currentDiff < closestDiff ? idx : closestIdx;
    }, 0);

    if (closestIndex >= 0) {
      const contentOffsetX = closestIndex * 20;

      setTimeout(() => {
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            x: contentOffsetX,
            animated: true,
          });
        }
      }, 100);
    }
  };

  // ========== LOAD IMAGE FUNCTION ==========
  // Loads camera-corner gallery thumbnail. Never overwrite a newer capture with
  // an older disk walk result; prefer native findLatestUnder when available.
  const loadImage = useCallback(async () => {
    const seqAtStart = latestCaptureSeqRef.current;
    try {
      console.log('Loading latest image for gallery icon...');
      const hasPermission = await requestStoragePermission();
      if (!hasPermission) {
        // Don't clear an in-session capture thumb on permission flicker.
        return;
      }

      let basePath;
      if (isGuest) {
        basePath = getGuestPhotosDir();
      } else {
        const userSegment =
          userData?.id != null
            ? String(userData.id)
            : sanitizeFolderName(getUsername() || 'user');
        basePath =
          Platform.OS === 'android'
            ? `${RNFS.ExternalStorageDirectoryPath}/DCIM/Camera/${userSegment}`
            : `${RNFS.DocumentDirectoryPath}/Dermscope/${userSegment}`;
      }

      let deletedFilesSet = new Set();
      let deletedArr = [];
      try {
        const deletedFilesJson = await AsyncStorage.getItem('deleted_gallery_files_v2');
        if (deletedFilesJson) {
          deletedArr = JSON.parse(deletedFilesJson);
          deletedFilesSet = new Set(deletedArr);
        }
      } catch (error) {
        console.log('Error loading deleted files for camera screen:', error);
      }

      let latestImage = null;

      if (GalleryIndexer.isAvailable() && typeof GalleryIndexer.findLatestUnder === 'function') {
        try {
          const found = await GalleryIndexer.findLatestUnder(basePath, deletedArr);
          if (found?.path) {
            latestImage = {
              path: found.path,
              name: found.name,
              mtime: found.mtime,
            };
          }
        } catch (nativeErr) {
          console.warn('findLatestUnder failed, falling back:', nativeErr?.message || nativeErr);
        }
      }

      if (!latestImage) {
        let latestImageTime = 0;
        const findLatestImageRecursive = async (dirPath) => {
          try {
            const exists = await RNFS.exists(dirPath);
            if (!exists) return;

            const files = await RNFS.readDir(dirPath);
            for (const file of files) {
              if (file.isDirectory()) {
                await findLatestImageRecursive(file.path);
              } else if (
                file.isFile() &&
                file.name.match(/\.(jpg|jpeg|png|JPG|JPEG|PNG)$/i) &&
                !file.name.startsWith('compressed_')
              ) {
                if (deletedFilesSet.has(file.path)) continue;

                try {
                  const stillThere = await RNFS.exists(file.path);
                  if (!stillThere) continue;

                  const stat = await RNFS.stat(file.path);
                  const modifiedTime = stat.mtime ? new Date(stat.mtime).getTime() : 0;

                  if (modifiedTime > latestImageTime) {
                    latestImageTime = modifiedTime;
                    latestImage = {
                      ...file,
                      mtime: stat.mtime,
                      size: stat.size,
                    };
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        };

        await findLatestImageRecursive(basePath);
      }

      // A newer capture landed while we walked disk — keep its thumbnail.
      if (seqAtStart !== latestCaptureSeqRef.current) {
        return;
      }

      if (latestImage?.path && (await RNFS.exists(String(latestImage.path).replace(/^file:\/\//, '')))) {
        const clean = String(latestImage.path).replace(/^file:\/\//, '');
        const foundMtime = latestImage.mtime
          ? new Date(latestImage.mtime).getTime()
          : 0;
        console.log('Setting latest photo URI:', clean);
        setLatestPhotoUri((prev) => {
          // Never replace a thumb from a newer capture seq with an older disk walk.
          if (prev?.captureSeq != null && prev.captureSeq > seqAtStart) {
            return prev;
          }
          const prevMtime = prev?.mtime ? new Date(prev.mtime).getTime() : 0;
          if (prev?.path && prevMtime > foundMtime) {
            return prev;
          }
          const prevPath = (prev?.path || '').replace(/^file:\/\//, '').split('?')[0];
          if (prevPath === clean && (prev?.captureSeq || 0) >= seqAtStart) {
            return prev;
          }
          return {
            path: clean,
            name: latestImage.name,
            mtime: foundMtime || Date.now(),
            captureSeq: seqAtStart,
          };
        });
      } else if (seqAtStart === latestCaptureSeqRef.current) {
        // Gallery base is empty — clear corner thumb unless an in-flight staged
        // file still exists outside this base (optimistic capture path).
        const prevPath = String(latestPhotoUriRef.current?.path || '')
          .replace(/^file:\/\//, '')
          .split('?')[0];
        if (!prevPath) {
          setLatestPhotoUri(null);
        } else {
          const underBase =
            prevPath === basePath || prevPath.startsWith(`${basePath}/`);
          let stillExists = false;
          try {
            stillExists = await RNFS.exists(prevPath);
          } catch (_) {
            stillExists = false;
          }
          if (!stillExists || underBase) {
            if (seqAtStart === latestCaptureSeqRef.current) {
              console.log('No latest image found — clearing gallery thumb');
              setLatestPhotoUri(null);
            }
          }
        }
      }
    } catch (error) {
      console.error('loadImage error:', error);
      // Don't wipe a good thumb on load errors.
    }
  }, [isGuest, userData, getUsername, requestStoragePermission]);

  // Add this useEffect to refresh when returning from Gallery
  useFocusEffect(
    useCallback(() => {
      // Refresh gallery icon when screen comes into focus
      console.log('CameraScreen focused - refreshing gallery icon');
      loadImage();
      // Pull latest patient name from server so portal renames apply before next capture.
      syncSelectedPatientFromServer();

      return () => {
        // Optional cleanup
      };
    }, [loadImage, syncSelectedPatientFromServer])
  );

  // After guest/user switch, reload thumb for the new base path.
  useEffect(() => {
    loadImage();
  }, [isGuest, userData?.id, loadImage]);
  // ========== TAP-TO-FOCUS FUNCTION ==========
  // ========== TAP-TO-FOCUS FUNCTION - ROBUST ==========
  const handleTapToFocus = useCallback(async (locationX, locationY) => {
    resetInactivityTimer();
    if (!cameraRef.current || !device) return;

    // Interrupt existing focus animation
    focusAnimation.stopAnimation();
    focusAnimation.setValue(0);

    // Turn off Manual Focus Mode (Slider) if active to let Auto Focus work
    if (showSlider) {
      setShowSlider(false);
    }

    // Get current dimensions for relative point calculation
    const width = viewDimensions.width > 0 ? viewDimensions.width : Dimensions.get('window').width;
    const height = viewDimensions.height > 0 ? viewDimensions.height : Dimensions.get('window').height;

    // Set focus point for UI indicator - CLAMPED to stay within view bounds
    // Focus indicator is 120x120 (60px radius)
    const clampedX = Math.max(60, Math.min(width - 60, locationX));
    const clampedY = Math.max(60, Math.min(height - 60, locationY));
    setFocusPoint({ x: clampedX, y: clampedY });

    // UI Feedback: Start animation immediately for responsiveness
    setIsFocusing(true);
    setShowFocusIndicator(true);
    setShowFocusStatus(true);

    Animated.sequence([
      Animated.timing(focusAnimation, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(focusAnimation, {
        toValue: 0.9,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(focusAnimation, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Vision Camera focus() expects point in the Camera VIEW coordinate system (points/dp).
    // (0,0) = top-left, (width, height) = bottom-right. Android native uses these as dp.
    const pointX = Math.max(0, Math.min(width, locationX));
    const pointY = Math.max(0, Math.min(height, locationY));
    const focusPointForApi = { x: pointX, y: pointY };

    console.log(`🎯 Requesting Focus at: (${pointX.toFixed(0)}, ${pointY.toFixed(0)}) dp`);

    try {
      // Check if focus is supported
      if (!device.supportsFocus) {
        console.warn('⚠️ Focus not supported on this device');
        throw new Error('Focus not supported');
      }

      // Execute focus call (view coordinates in points - Android native uses dp)
      await cameraRef.current.focus(focusPointForApi);

      console.log('✅ Focus locked at point');

      if (Platform.OS === 'android') {
        Vibration.vibrate(50);
      }

      // Cleanup indicator after success
      setTimeout(() => {
        Animated.timing(focusAnimation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setShowFocusIndicator(false);
          setIsFocusing(false);
        });

        // Hide "Focus Set" text after extra delay
        setTimeout(() => setShowFocusStatus(false), 1500);
      }, 2000);

    } catch (error) {
      console.error('❌ Focus failed:', error);
      setTimeout(() => {
        setShowFocusIndicator(false);
        setIsFocusing(false);
        setShowFocusStatus(false);
      }, 800);
    }
  }, [device, focusAnimation, viewDimensions, showSlider]);

  // SIMPLE TOUCH HANDLER
  const handleCameraTouch = (event) => {
    resetInactivityTimer();
    if (!device) return;
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;

    const layout = previewLayoutInWindowRef.current;
    const hasMeasuredLayout = layout && layout.width > 0 && layout.height > 0;

    // Prefer window-relative coordinates (pageX/pageY) converted into preview-local space.
    // This avoids offsets caused by padding, absolute overlays, or safe-area insets.
    if (hasMeasuredLayout && typeof pageX === 'number' && typeof pageY === 'number') {
      const relX = Math.max(0, Math.min(layout.width, pageX - layout.x));
      const relY = Math.max(0, Math.min(layout.height, pageY - layout.y));
      handleTapToFocus(relX, relY);
      return;
    }

    // Fallback: use locationX/locationY (already relative to the pressed view)
    handleTapToFocus(locationX, locationY);
  };

  // ========== EXPOSURE SCROLL HANDLER ==========
  const handleExposureScroll = Animated.event(
    [
      {
        nativeEvent: {
          contentOffset: { x: new Animated.Value(0) }, // Temporary value as we rely on the listener
        },
      },
    ],
    {
      useNativeDriver: false,
      listener: (event) => {
        resetInactivityTimer();
        const contentOffsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(contentOffsetX / 50);
        if (index >= 0 && index < exposureValues.length) {
          const selectedExposure = parseFloat(exposureValues[index]);
          setExposureBtnValue(selectedExposure);
        }
      },
    }
  );

  const onExposureScrollEnd = () => {
    resetInactivityTimer();
    console.log(`Exposure Selected: ${exposureBtnValue}`);
  };

  // ========== FOCUS BUTTON HANDLER ==========
  const handleFocusBtn = () => {
    resetInactivityTimer();
    setShowFocusScale(prev => {
      const newShowFocusScale = !prev;

      if (newShowFocusScale) {
        const index = Math.round(focusDepthValue * 20);
        setTimeout(() => {
          if (focusScrollViewRef.current) {
            focusScrollViewRef.current.scrollTo({
              x: index * 50,
              animated: false,
            });
          }
        }, 100);
      }

      return newShowFocusScale;
    });

    setShowSlider(false);
    setShowScale(false);
  };

  const handleSingleTap = () => {
    console.log(`[WakeUpDebug] [${Date.now()}] handleSingleTap executing. Clearing camera error.`);
    setCameraError(null);
  };

  // ========== POLARIZATION BUTTON HANDLER ==========
  const handlePolarizationBtn = () => {
    console.log('Polarization button is now controlled by volume buttons only');
    return;
  };

  const clearPolTouchHoldTimer = useCallback(() => {
    if (polTouchHoldTimerRef.current) {
      clearTimeout(polTouchHoldTimerRef.current);
      polTouchHoldTimerRef.current = null;
    }
  }, []);



  const {
    onLightButtonPressIn,
    onLightButtonLongPress,
    onLightButtonPressOut,
    onLightButtonPress,
  } = useCameraTorch({
    batteryLevel,
    isLightOn,
    resetInactivityTimer,
    toggleLight,
    syncPolarizationState,
    touchPolHoldRef,
    skipNextTorchToggleRef,
    lightPressStartRef,
    clearPolTouchHoldTimer,
  });

  const stopPolarization = () => {
    console.log('Polarization Deactivated!');
    if (isPolPressed !== null || polIconColor !== 'polarised') {
      setIsPolPressed(null);
      setPolIconColor('polarised');
      if (NativeModules.DermascopeModule) {
        NativeModules.DermascopeModule.setPolarization(false, 0);
      }
      stopSound();
      stopVibration();
    } else {
      console.log('Already off!');
    }
  };

  // ========== UPDATED NAVIGATION HANDLERS ==========
  const handleSettingsPress = () => {
    resetInactivityTimer();
    if (isCapturingRef.current) {
      if (Platform.OS === 'android') {
        showInAppToast(UserMessages.photoSaveInProgress, { durationMs: 2000, position: 'center' });
      }
      return;
    }
    ignoreKeysRef.current = true;
    console.log('⚙️ Going to Settings screen');

    forceTorchOffUntilUserTaps();

    navigation.navigate('Settings');
    setMenuVisible(true);
    setShowFocusScale(false);
    setShowScale(false);
  };

  const handleGalleryPress = () => {
    resetInactivityTimer();
    if (isCapturingRef.current || isPhotoSavePending?.()) {
      if (Platform.OS === 'android') {
        showInAppToast(UserMessages.photoSaveInProgress, { durationMs: 2000, position: 'center' });
      }
      return;
    }
    ignoreKeysRef.current = true;
    console.log('🖼️ Going to Gallery screen');

    forceTorchOffUntilUserTaps();

    // Warm native gallery index before the screen mounts (non-blocking).
    try {
      const basePath = isGuest
        ? getGuestPhotosDir()
        : buildUserGalleryBase({
            userId: userData?.id,
            username: getUsername() || 'user',
          });
      AsyncStorage.getItem(DELETED_FILES_KEY)
        .then((j) => {
          const deleted = j ? JSON.parse(j) : [];
          return GalleryIndexer.prefetch(basePath, Array.isArray(deleted) ? deleted : []);
        })
        .catch(() => GalleryIndexer.prefetch(basePath, []));
    } catch (_) {}

    navigation.navigate('Gallery');
  };

  // ========== OTHER FUNCTIONS ==========


  const requestLocationPermission = async () => {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        return true;
      } else {
        return false;
      }
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  // FIXED USEEFFECT DEPENDENCIES
  useEffect(() => {
    syncPolarizationState();
    const initializePermissions = async () => {
      try {
        await requestPermission();
        const storageOk = await requestStoragePermission();
        // Prime the cache so the first capture doesn't pay a permission round-trip.
        hasStoragePermissionRef.current = !!storageOk;
        await requestLocationPermission();
      } catch (error) {
        console.error('Permission initialization error:', error);
      }
    };

    initializePermissions();
    loadImage();
    // resetInactivityTimer();

    if (LockTaskModule && LockTaskModule.startLockTask) {
      LockTaskModule.startLockTask();
    }
  }, [LockTaskModule, loadImage, requestPermission, requestStoragePermission]);

  // useEffect(() => {
  //   const timer = setTimeout(() => {
  //     setShowImage(false);
  //   }, 1000);
  //   return () => clearTimeout(timer);
  // }, []);

  const toggleMenu = () => {
    if (menuVisible === true) {
      setMenuVisible(false);
    } else {
      setMenuVisible(true);
    }
    Animated.timing(menuWidth, {
      toValue: menuVisible ? 0 : 400,
      duration: 180,
      useNativeDriver: false,
    }).start();
  };

  const onPinchEvent = event => {
    setShowSlider(false);
    setShowFocusScale(false);
    setShowScale(false);
    setIsPressed(null);

    const scaleFactor = event.nativeEvent.scale;
    // Ultra-smooth sensitivity for pinch-to-zoom
    const zoomSensitivity = 0.75; // Increased from 0.6 for ultra-smooth response
    const zoomDelta = (scaleFactor - 1) * zoomSensitivity;

    // Use ref for smoother updates during pinch with smooth interpolation
    let newZoom = currentZoomRef.current + zoomDelta;

    const MIN_ZOOM = 1.0;
    const MAX_ZOOM = 3.0;

    newZoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM));

    // Apply smooth interpolation for ultra-smooth feel
    const smoothedZoom = currentZoomRef.current + (newZoom - currentZoomRef.current) * 0.3; // Smooth interpolation factor

    currentZoomRef.current = smoothedZoom;
    setZoomBtnValue(smoothedZoom);
  };

  const onPinchStateChange = event => {
    if (event.nativeEvent.state === 5) {
      const velocity = event.nativeEvent.velocity;
      // Ultra-smooth inertia with lower threshold and higher multiplier
      if (Math.abs(velocity) > 0.2) { // Lowered from 0.3 for more responsive inertia
        const inertiaZoom = currentZoomRef.current + (velocity * 0.2); // Increased from 0.15 for smoother momentum
        const MIN_ZOOM = 1.0;
        const MAX_ZOOM = 3.0;
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(inertiaZoom, MAX_ZOOM));

        // Apply inertia with smooth spring animation
        currentZoomRef.current = clampedZoom;
        setZoomBtnValue(clampedZoom);
      } else {
        // Even if no inertia, update smoothly
        currentZoomRef.current = zoomBtnValue;
      }

      scale.setValue(1);
    }
  };

  const handleTap = () => {
    console.log(`[WakeUpDebug] [${Date.now()}] handleTap (Wake Up button press) triggered. Current cameraError: ${cameraError}`);
    handleSingleTap();
  };

  const handleCameraMountError = (error) => {
    console.log(`[WakeUpDebug] [${Date.now()}] handleCameraMountError triggered. Error:`, error);
    console.error('Camera mount error:', error);
    setCameraError('An error occurred while accessing the camera. Please restart the device.');
  };

  const handleContrastPress = () => {
    resetInactivityTimer();
    setShowSlider(!showSlider);
    if (showSlider === false) {
      setIsPressed('Exposure');
      setShowFocusScale(false);
      setShowScale(false);
      setCamApi(true);
    } else {
      setIsPressed(null);
    }
  };

  const {
    handleCapturePress,
    startContinuousCapture,
    stopContinuousCapture,
    isPhotoSavePending,
  } = useCameraCapture({
    cameraRef,
    device,
    isGuest,
    currentBox,
    bodyPart,
    userData,
    getUsername,
    zoomBtnValue,
    cameraError,
    isFocused,
    resetInactivityTimer,
    timeoutRef,
    captureProcessorRef,
    isFocusedRef,
    continuousCaptureRef,
    isCapturingRef,
    lastCaptureTimeRef,
    CAPTURE_PROCESS_DEFER_MS,
    latestCaptureSeqRef,
    setLatestPhotoUri,
    setOnCapturePress,
    setIsCapturing,
    hasStoragePermissionRef,
    requestStoragePermission,
    setCameraError,
  });

  const handleFocusScroll = event => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / 50);
    const newFocusDepth = parseFloat(focusDepthValues[index]);
    setFocusDepthValue(newFocusDepth);
    resetInactivityTimer();
  };

  const onFocusScrollEnd = () => {
    console.log(`Focus Depth Selected: ${focusDepthValue}`);
  };

  const handleLongPressWifi = () => {
    ignoreKeysRef.current = true;
    setWifiMenuVisible(true);
  };

  const handleWifiToggle = async () => {
    try {
      if (wifiState === 'enabled') {
        setWifiState('disabled');
      } else {
        setWifiState('enabled');
      }
    } catch (error) {
      console.error('Failed to toggle WiFi state', error);
    }
  };

  const simpleToast = textAlign => {
    // Removed polarization toast messages - no longer showing any polarization-related toasts
    // Filter out all variations: polarization, mode on/off, etc.
    if (textAlign) {
      const lowerText = textAlign.toLowerCase();
      const isPolarizationMessage =
        lowerText.includes('polarization') ||
        lowerText.includes('mode off') ||
        lowerText.includes('mode on') ||
        lowerText.includes('polarization on') ||
        lowerText.includes('polarization off') ||
        lowerText.includes('linear polarization') ||
        lowerText.includes('circular polarization') ||
        lowerText === 'polarization';

      if (!isPolarizationMessage) {
        showInAppToast(textAlign, { durationMs: 3500, position: 'top' });
      } else {
        // Just log polarization messages, don't show toast
        console.log('Polarization action (toast suppressed):', textAlign);
      }
    }
  };

  const toastForCapture = textAlign => {
    showInAppToast(`Image Captured! ${textAlign}`, { durationMs: 2000, position: 'center' });
  };

  const produceHighVibration = () => {
    if (isVibrating) {
      console.log('Vibration is already active.');
      return;
    }

    if (Platform.OS === 'android') {
      console.log('Starting continuous vibration...');
      setIsVibrating(true);

      Vibration.vibrate(15000);
      vibrationInterval.current = setInterval(() => {
        Vibration.vibrate(15000);
      }, 14500);
    } else {
      console.log('iOS does not support custom vibration durations.');
    }
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

  const playMp3FromAssets = () => {
    if (isPlaying) {
      console.log('Sound is already playing.');
      return;
    }

    const soundFilePath = 'high_pitched_ringing.wav';
    console.log('Playing Sound in Infinite Loop');

    const newSound = new Sound(soundFilePath, Sound.MAIN_BUNDLE, error => {
      if (error) {
        Alert.alert('Error', UserMessages.soundLoadFailed);
        return;
      }

      setSound(newSound);
      setIsPlaying(true);

      const playLoop = () => {
        newSound.play(success => {
          if (success) {
            playLoop();
          } else {
            console.log('Playback failed');
            stopSound();
          }
        });
      };

      playLoop();
    });
  };

  const stopSound = () => {
    if (sound) {
      sound.stop(() => {
        console.log('Sound stopped');
        sound.release();
        setSound(null);
        setIsPlaying(false);
      });
    } else {
      console.log('No sound is playing.');
    }
  };

  const handleLongPress = label => {
    showInAppToast(label, { durationMs: 2000 });
  };

  LogBox.ignoreLogs(['new NativeEventEmitter']);
  LogBox.ignoreAllLogs();

  // RENDER CAMERA FUNCTION
  if (showImage) {
    return (
      <View style={styles.container}>
        <StatusBar hidden={true} />
        <Image source={TitleImg} style={styles.preview} />
      </View>
    );
  }

  return (
    <>
      <View style={styles.container}>
        {/* <CustomStatusBar /> */}

        {!isGuest && (currentBox?.name || bodyPart) ? (
          <View style={styles.patientNameTopBar}>
            <Text style={styles.patientNameText} numberOfLines={1}>
              {[currentBox?.name, bodyPart].filter(Boolean).join(' | ')}
            </Text>
          </View>
        ) : null}

        <CameraPreview {...{cameraError,handleTap,device,hasPermission,requestPermission,panResponder,pinchGesture,previewTouchableRef,handleCameraTouch,setViewDimensions,previewLayoutInWindowRef,cameraRef,isScreenFocused,wifiMenuVisible,isStandby,animatedCameraProps,format,isFlashOn,showSlider,focusDepthValue,resumingFromLockRef,setCameraError,isTransientCameraError,zoom,minZoom,maxZoom,setZoomBtnValue,zoomBtnValue,showFocusStatus,showFocusIndicator,focusPoint,focusAnimation}} />

        <WifiSettingsModal
          visible={wifiMenuVisible}
          onClose={() => {
            setWifiMenuVisible(false);
            handleReturnToCamera();
          }}
        />
        <PowerOffModal
          visible={powerOffModalVisible}
          onClose={() => setPowerOffModalVisible(false)}
        />

        <BodyPartModal
          visible={bodyPartModalVisible}
          initialValue={bodyPart}
          onClose={() => {
            setBodyPartModalVisible(false);
            resetInactivityTimer();
          }}
          onSave={(val) => {
            setBodyPart(val);
          }}
        />

        <ConfirmationModal
          visible={exitModalVisible}
          onClose={() => setExitModalVisible(false)}
          title={isGuest ? "Exit" : "Logout"}
          message={isGuest ? "Do you want to exit?" : "Are you sure you want to logout?"}
          confirmText={isGuest ? "Exit" : "Logout"}
          isDestructive={true}
          onConfirm={async () => {
            setExitModalVisible(false);
            if (isGuest) {
              // Cleanup first so CaptureQueue / gallery cache cannot recreate files.
              await exitGuestMode();
            } else {
              await signOut();
            }
            navigation.reset({
              index: 0,
              routes: [{ name: 'Welcome' }],
            });
          }}
        />

        {/* Mid-screen Zoom Slider Removed */}

        <CameraChrome
          handleSettingsPress={handleSettingsPress}
          ignoreKeysRef={ignoreKeysRef}
          setIsLightOn={setIsLightOn}
          cameraError={cameraError}
          onLightButtonPressIn={onLightButtonPressIn}
          onLightButtonPressOut={onLightButtonPressOut}
          onLightButtonPress={onLightButtonPress}
          isLightOn={isLightOn}
          showTorchOnly={showTorchOnly}
          polIconColor={polIconColor}
          isGuest={isGuest}
          forceTorchOffUntilUserTaps={forceTorchOffUntilUserTaps}
          setPatientBoxModalVisible={setPatientBoxModalVisible}
          setBodyPartModalVisible={setBodyPartModalVisible}
          currentBox={currentBox}
          bodyPart={bodyPart}
          handleGalleryPress={handleGalleryPress}
          latestPhotoUri={latestPhotoUri}
          startContinuousCapture={startContinuousCapture}
          stopContinuousCapture={stopContinuousCapture}
          isCapturing={isCapturing}
          onCapturePress={onCapturePress}
          zoom={zoom}
          minZoom={minZoom}
          maxZoom={maxZoom}
          setZoomBtnValue={setZoomBtnValue}
          resetInactivityTimer={resetInactivityTimer}
          zoomBtnValue={zoomBtnValue}
        />

        {/* ========== CONTROLS ========== */}
        <>
          {showSlider && (
            <View
              style={[styles.scaleContainer, cameraError && { opacity: 0.5 }]}
              pointerEvents={cameraError ? 'none' : 'auto'}
            >
              <ScrollView
                ref={scrollExposureViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleExposureScroll}
                scrollEventThrottle={16}
                snapToInterval={50}
                onMomentumScrollEnd={onExposureScrollEnd}
                contentContainerStyle={styles.scaleContentContainer}
              >
                {exposureValues
                  .filter((_, index) => index % 2 === 0)
                  .map((value, index) => (
                    <View key={index} style={styles.tick}>
                      <Text style={styles.tickText}>
                        {index % 1 === 0
                          ? `${mapExposureToDisplay(parseFloat(value))}`
                          : ''}
                      </Text>
                      <View style={styles.tickLine} />
                    </View>
                  ))}
              </ScrollView>
              <View style={[styles.centerLine]} />
            </View>
          )}

          {showFocusScale && (
            <View
              style={[styles.scaleContainer, cameraError && { opacity: 0.5 }]}
              pointerEvents={cameraError ? 'none' : 'auto'}
            >
              <ScrollView
                ref={focusScrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleFocusScroll}
                scrollEventThrottle={12}
                snapToInterval={50}
                onMomentumScrollEnd={onFocusScrollEnd}
                contentContainerStyle={styles.scaleFocusContentContainer}>
                {focusDepthValues
                  .filter((_, index) => index % 2 === 0)
                  .map((value, index) => (
                    <View key={index} style={styles.tick}>
                      <Text style={styles.tickFocusText}>
                        {index % 1 === 0 ? value : ' '}
                      </Text>
                      {index % 1 === 0 && (
                        <View
                          style={[
                            styles.tickLine,
                            focusDepthValue === parseFloat(value)
                              ? styles.activeTick
                              : {},
                          ]}
                        />
                      )}
                    </View>
                  ))}
              </ScrollView>
              <View style={styles.centerLine} />
            </View>
          )}

          {showScale && (
            <View
              style={[styles.scaleContainer, cameraError && { opacity: 0.5 }]}
              pointerEvents={cameraError ? 'none' : 'auto'}
            >
              <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={32}
                decelerationRate="normal"
                snapToInterval={20}
                onMomentumScrollEnd={onScrollEnd}
                onScrollEndDrag={onScrollEnd}
                contentContainerStyle={styles.scaleZoomContentContainer}
              >
                {zoomValues
                  .filter((_, index) => index % 10 === 0)
                  .map((value, index) => {
                    const displayIndex = index * 10;
                    const displayValue = mapZoomToDisplay(parseFloat(value));
                    const isMajorTick = displayValue % 5 === 0;

                    return (
                      <TouchableOpacity
                        key={displayIndex}
                        style={styles.tick}
                        onPress={() => handleZoomMarkerPress(displayIndex)}
                      >
                        <Text style={[
                          styles.tickText,
                          isMajorTick && styles.majorTickText
                        ]}>
                          {isMajorTick ? `${displayValue}x` : ''}
                        </Text>
                        <View style={[
                          styles.tickLine,
                          isMajorTick ? styles.majorTickLine : styles.minorTickLine,
                          Math.abs(mapZoomToDisplay(zoomBtnValue) - displayValue) <= 0.5 && styles.activeTick
                        ]} />
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
              <View style={styles.centerLine} />

              <View style={styles.currentZoomDisplay}>
                <Text style={styles.currentZoomText}>
                  {mapZoomToDisplay(zoomBtnValue)}x
                </Text>
              </View>
            </View>
          )}
        </>

        {/* ========== PATIENT BOX MODAL ========== */}
        <PatientBoxModal
          visible={patientBoxModalVisible}
          initialId={currentBox?.id || ''}
          initialName={currentBox?.name || ''}
          onClose={() => {
            setPatientBoxModalVisible(false);
            resetInactivityTimer();
          }}
          onSet={async (patient) => {
            try {
              const next = {
                id: String(patient.id || ''),
                name: String(patient.name || ''),
              };
              // Clearing is always allowed — capture already snapshotted patient before
              // takePhoto, so in-flight saves keep the correct association. Blocking clear
              // closed the modal but left the selection, which felt like a UI jerk.
              setCurrentBox(next);
              currentBoxRef.current = next;
              if (!next.id) {
                setBodyPart('');
              }
              await AsyncStorage.setItem('@patient_box', JSON.stringify(next));
            } catch (e) {
              console.warn('Save patient box:', e);
            }
          }}
          onInteraction={resetInactivityTimer}
        />

        {/* ========== STANDBY MODAL ========== */}
        <StandbyModal
          visible={isStandby && isScreenFocused && !globalPowerMenuOpen}
          onActivate={() => {
            isStandbyRef.current = false;
            setIsStandby(false);
            resetInactivityTimer();
          }}
        />
      </View>
    </>
  );
};


export default CameraScreen;
