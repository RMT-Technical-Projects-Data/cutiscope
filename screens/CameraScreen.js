import React, { useState, useRef, useEffect, useCallback } from 'react';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import googleDriveService from '../services/googleDriveService';
import firebaseAuthService from '../services/firebaseAuthService';
import OptimisedUploadService from '../services/OptimisedUploadService';
import { registerAndEnqueue } from '../services/CapturePipeline';
import { recordPhotoCapture } from '../services/patientsService';
import {
  StyleSheet,
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
  Pressable,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  runOnJS,
  useAnimatedReaction,
  useAnimatedSensor,
  SensorType,
} from 'react-native-reanimated';
import { Camera, useCameraDevice, useCameraFormat, useCameraPermission } from 'react-native-vision-camera';
import { GestureHandlerRootView, PinchGestureHandler, GestureDetector, Gesture } from 'react-native-gesture-handler';
import NetInfo from '@react-native-community/netinfo';
import Sound from 'react-native-sound';
import { PermissionsAndroid } from 'react-native';
import { NativeModules } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useFocusEffect } from '@react-navigation/native';
import DeviceInfo from 'react-native-device-info';
import { UserMessages } from '../utils/userMessages';
import { ensureGuestPhotosDir, getGuestPhotosDir } from '../utils/guestPhotos';
import { showInAppToast } from '../utils/Helpers';

// Import Auth Context
import { useAuth } from '../context/AuthContext';

// Import components
import CustomStatusBar from '../Components/CustomStatusBar';
import ZoomControl, { ZoomRuler } from '../Components/ZoomControl';
import SettingsMenu from '../modals/SettingsMenu';
import { Skia, Canvas, Image as SkiaImage, ColorMatrix, FontStyle, ImageFormat } from '@shopify/react-native-skia';
import {
  DEFAULT_TEMPERATURE,
  DEFAULT_TINT,
  EXPOSURE_VALUES,
  FOCUS_DEPTH_VALUES
} from '../utils/Constants';

const ReanimatedCamera = Reanimated.createAnimatedComponent(Camera);
import WifiSettingsModal from '../modals/WiFiSettingsModal';
import ConfirmationModal from '../modals/ConfirmationModal';
import PowerOffModal from '../modals/PowerOffModal';
import PatientBoxModal from '../modals/PatientBoxModal';
import StandbyModal from '../modals/StandbyModal';
import BodyPartModal from '../modals/BodyPartModal';

// Import assets
import TitleImg from '../assets/dscope-app.png';
import settingsIcon from '../assets/icon_settings.png';
import focusIcon from '../assets/icon_brightness.png';
import PolIcon from '../assets/icon_linear_pol.png';
import CaptureBtn from '../assets/capture.png';
import CapturePressedBtn from '../assets/capture_pressed.png';
import GalleryBtn from '../assets/icon_gallery.png';
import torchOffIcon from '../assets/Dermscope_Torch_Icon_OFF_-removebg-preview.png';
import torchOnIcon from '../assets/Dermscope_Torch_Icon_ON_-removebg-preview.png';
import polarisedIcon from '../assets/Untitled_design-removebg-preview.png';
import nonPolarisedIcon from '../assets/Gemini_Generated_Image_w2zk1ow2zk1ow2zk-removebg-preview.png';
import KeyEvent from 'react-native-keyevent';
import VolumeManager from 'react-native-volume-manager';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const SCALE_BASE_MM = 20.0;
const SCALE_NUM_TICKS = 20;

const MillimeterScale = ({ zoom }) => {
  const numTicks = SCALE_NUM_TICKS;
  
  return (
    <View style={styles.mmScaleContainer}>
      <View style={styles.mmScaleLine} />
      {Array.from({ length: numTicks + 1 }).map((_, index) => {
        const isMajor = index % 5 === 0;
        const minMm = 10.0 / zoom;
        const maxMm = 20.0 / zoom;
        const val = minMm + ((numTicks - index) / numTicks) * (maxMm - minMm);
        const topPosition = `${(index / numTicks) * 100}%`;
        
        return (
          <View key={index} style={[styles.mmScaleTickRow, { top: topPosition }]}>
            <View style={isMajor ? styles.mmScaleTickMajor : styles.mmScaleTickMinor} />
            {isMajor && (
              <Text style={styles.mmScaleText}>
                {val.toFixed(1)}
              </Text>
            )}
          </View>
        );
      })}
      <Text style={styles.mmScaleUnit}>mm</Text>
    </View>
  );
};

const CameraScreen = ({ navigation }) => {
  const [showImage, setShowImage] = useState(false);

  // Use Auth Context
  const { userData, isGuest, getUsername, exitGuestMode, signOut } = useAuth();

  // Vision Camera Hooks (Moved up to be available for gesture logic)
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [
    { photoResolution: 'max' },
    { videoResolution: { width: 1920, height: 1080 } },
  ]);

  const UI_MIN_ZOOM = 1.0;
  const UI_MAX_ZOOM = 3.0;
  const HW_MIN_ZOOM = 1.4;
  const deviceMaxZoom = device?.maxZoom ?? 4.0;
  const maxZoom = UI_MAX_ZOOM; // Effective UI Max Zoom
  const HW_MAX_ZOOM = Math.max(HW_MIN_ZOOM, deviceMaxZoom);


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

  // ========== FLASHLIGHT STATE ==========
  const [isFlashOn, setIsFlashOn] = useState(false); // Start as OFF
  const [batteryLevel, setBatteryLevel] = useState(1.0);
  const [prevBatteryLevel, setPrevBatteryLevel] = useState(1.0);

  // ========== BATTERY MONITORING ==========
  useEffect(() => {
    const checkBattery = async () => {
      try {
        const level = await DeviceInfo.getBatteryLevel();
        if (level !== -1) {
          setPrevBatteryLevel((prev) => {
            // Logic: If battery drops from 21% to 20% (or lower)
            if (prev > 0.2 && level <= 0.2) {
              console.log('🔋 Battery dropped to 20% - Turning off flashlight');
              setIsLightOn(false);
              setIsFlashOn(false);
              if (Platform.OS === 'android' && NativeModules.DermascopeModule) {
                NativeModules.DermascopeModule.setPolarization(false, 0);
              }
              showInAppToast('Battery is low. Please charge the phone to use the flashlight.', { durationMs: 3500 });
            }
            return level;
          });
          setBatteryLevel(level);
        }
      } catch (e) {
        console.warn('Battery check error:', e);
      }
    };

    const interval = setInterval(checkBattery, 10000); // Check every 10s
    checkBattery(); // Initial check
    return () => clearInterval(interval);
  }, []);

  // ========== PATIENT / BOX (images saved to folder with this ID and name) ==========
  const [currentBox, setCurrentBox] = useState({ id: '', name: '' });
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

  // ========== STANDBY TIMEOUT ==========
  const [isStandby, setIsStandby] = useState(false);
  const timeoutRef = useRef(null);
  const isScreenFocusedRef = useRef(true);

  const resetInactivityTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    // Only set timer if not already in standby and screen is focused
    if (isScreenFocusedRef.current && !isStandby) {
      timeoutRef.current = setTimeout(() => {
        console.log('⏰ Inactivity timeout reached - Entering standby');
        setIsStandby(true);
        setIsLightOn(false); // Turn off torch on standby
      }, 120000); // 30 seconds
    }
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

  // ========== SCREEN OFF (e.g. power button lock): turn off torch, do not wake device ==========
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onScreenOff', () => {
      console.log('📴 Screen off - turning torch and polarization off');
      setIsFlashOn(false);
      setIsLightOn(false);
      if (Platform.OS === 'android' && NativeModules.DermascopeModule) {
        try {
          NativeModules.DermascopeModule.setPolarization(false, 0);
        } catch (e) {
          console.warn('DermascopeModule setPolarization off:', e);
        }
      }
    });
    return () => subscription.remove();
  }, []);


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

  // ========== ZOOM STATE MANAGEMENT ==========

  // Shared Value for smooth zoom (Reanimated)
  const zoom = useSharedValue(1.0);
  const startZoom = useSharedValue(1.0);

  // NOTE: zoomBtnValue is kept for synced UI elements (text, non-animated headers)
  // but the MAIN source of truth for Camera is now 'zoom' shared value.
  const zoomValues = Array.from({ length: 201 }, (_, i) => (1.0 + i * 0.01).toFixed(2));
  const exposureValues = EXPOSURE_VALUES;
  const focusDepthValues = FOCUS_DEPTH_VALUES;
  // Removed old pan/drag state refs as we use Gesture Handler and SharedValues now

  const minZoom = UI_MIN_ZOOM;
  // const maxZoom = UI_MAX_ZOOM; // Handled dynamically above

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      startZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      const newZoom = startZoom.value * event.scale;
      const clamped = Math.max(minZoom, Math.min(newZoom, maxZoom));
      zoom.value = clamped;
      runOnJS(resetInactivityTimer)();
    })
    .onEnd(() => {
      runOnJS(setZoomBtnValue)(zoom.value);
      runOnJS(resetInactivityTimer)();
    });

  // Sync SharedValue -> State (for UI updates like text)
  // We use useAnimatedReaction to throttle updates to JS thread (e.g., every ~60ms) to keep UI responsive
  // but not flood the bridge.
  useAnimatedReaction(
    () => zoom.value,
    (currentZoom, previousZoom) => {
      if (previousZoom !== null && Math.abs(currentZoom - previousZoom) > 0.05) {
        runOnJS(setZoomBtnValue)(currentZoom);
      }
    },
    [zoom]
  );

  // Animated Props for Camera
  const animatedCameraProps = useAnimatedProps(() => {
    // Map UI zoom (1.0 to 3.0) to hardware zoom (1.4 to HW_MAX_ZOOM)
    const uiRatio = (zoom.value - UI_MIN_ZOOM) / (UI_MAX_ZOOM - UI_MIN_ZOOM);
    const hwZoom = HW_MIN_ZOOM + uiRatio * (HW_MAX_ZOOM - HW_MIN_ZOOM);

    return {
      zoom: hwZoom,
      // If the library supports 'focus' prop via reanimated, we add it here.
      // However, usually 'focus' expects { x, y } for tap point or a specific float for depth.
      // Using a specialized approach: React Native Vision Camera V3+ often uses a ref function `.focus({ x, y })`
      // For manual focus depth (0.0 - 1.0), let's try passing it if supported, 
      // but standard approach often requires checking documentation.
      // Assuming 'focus' prop accepts a value [0,1] for manual focus distance in some setups,
      // OR we just use it in the component render if it's not animatable.
    };
  }, [zoom, HW_MIN_ZOOM, HW_MAX_ZOOM, UI_MIN_ZOOM, UI_MAX_ZOOM]);

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
  const [onCapturePress, setOnCapturePress] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [latestPhotoUri, setLatestPhotoUri] = useState(null);
  const [isLightOn, setIsLightOn] = useState(false);
  const isLightOnRef = useRef(false);

  // Wrapped toggle to check battery
  const toggleLight = useCallback(() => {
    if (batteryLevel <= 0.2) {
      showInAppToast('Battery too low. Please charge the phone to use the flashlight.', { durationMs: 2000 });
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

  // Effect 1: Handle screen focus/blur for ALL navigation
  useEffect(() => {
    console.log('Setting up navigation focus listeners with delay...');
    let blurTimeout = null;

    // When screen comes into focus
    const unsubscribeFocus = navigation.addListener('focus', () => {
      console.log('📸 CameraScreen FOCUSED');

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

  // Effect 1b: Handle AppState for Lock/Background (Aggressive torch off)
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      console.log('📱 AppState changed to:', nextAppState);
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        console.log('🔒 Device locked or app backgrounded - Force Turning Torch OFF');
        setIsScreenFocused(false);
        setIsLightOn(false);
      } else if (nextAppState === 'active') {
        // Only restore focus, don't auto-turn light back on for safety
        setIsScreenFocused(true);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  // Effect 1c: Handle Physical Power Button Event
  useEffect(() => {
    console.log('🔌 Setting up power button event listener');
    const subscription = DeviceEventEmitter.addListener('onPowerButtonPressed', () => {
      console.log('🔌 Physical Power Button Pressed - Handling in JS');
      ignoreKeysRef.current = true;
      setIsLightOn(false); // Turn off torch for safety/logic
      // Modal is opened by App.js listener
    });

    const subClose = DeviceEventEmitter.addListener('onPowerMenuClosed', () => {
      console.log('🔙 Power Menu closed - recovery in CameraScreen');
      handleReturnToCamera();
    });

    return () => {
      console.log('🔌 Removing power button event listener');
      subscription.remove();
      subClose.remove();
    };
  }, [handleReturnToCamera]);

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
    };
  }, []);

  // Effect 4b: Turn off torch when phone is locked (power button) or app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        setIsFlashOn(false);
        setIsLightOn(false);
      }
    });
    return () => subscription.remove();
  }, []);

  // Effect 4c: Standby Timer Management
  useEffect(() => {
    const anyModalVisible =
      menuVisible ||
      patientBoxModalVisible ||
      wifiMenuVisible ||
      exitModalVisible ||
      powerOffModalVisible;

    if (!isScreenFocused || isStandby || anyModalVisible) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      resetInactivityTimer();
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isScreenFocused, isStandby, menuVisible, patientBoxModalVisible, wifiMenuVisible, exitModalVisible, powerOffModalVisible, resetInactivityTimer]);



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

  useEffect(() => {
    // Works only on Android
    if (Platform.OS === 'android') {
      console.log('🔧 Setting up volume button listeners for polarization...');

      // Safety check: Only proceed if VolumeManager is available
      if (VolumeManager && typeof VolumeManager.showNativeVolumeUI === 'function') {
        // Ensure volume UI is hidden when setting up listeners
        VolumeManager.showNativeVolumeUI({ enabled: false }).catch(e => {
          console.warn('Failed to hide volume UI:', e);
        });
      }

      // Remove any existing listeners first
      try {
        KeyEvent.removeKeyDownListener();
        KeyEvent.removeKeyUpListener();
        KeyEvent.removeKeyMultipleListener();
      } catch (e) {
        console.log('No existing listeners to remove:', e);
      }

      // Key Down: Turn ON color and immediately hide volume UI
      const keyDownListener = KeyEvent.onKeyDownListener(keyEvent => {
        console.log('🔑 KeyEvent DOWN received - keyCode:', keyEvent.keyCode, 'action:', keyEvent.action);

        const key = keyEvent.keyCode;

        // Only process volume buttons
        if (key !== 24 && key !== 25) return;

        console.log(`[POL_KEY_DOWN] Key DOWN received: ${key}. Before set: ${!!pressedKeysRef.current[key]}`);

        // Heal dropped KeyUp events: allow updating state even if already pressed
        pressedKeysRef.current[key] = true;

        // Immediately hide volume UI
        if (VolumeManager?.showNativeVolumeUI) {
          VolumeManager.showNativeVolumeUI({ enabled: false }).catch(() => { });
        }

        // Trigger unified sync instantly for UI, debounced for hardware
        syncPolarizationState();

        // Reset inactivity timer on volume key press
        resetInactivityTimer();

        // Visual feedback
        if (isLightOnRef.current) {
          // Animation removed as per user request
        }
      });

      // Key Up: Turn OFF color
      const keyUpListener = KeyEvent.onKeyUpListener(keyEvent => {
        const key = keyEvent.keyCode;

        // Only process volume buttons
        if (key !== 24 && key !== 25) return;

        console.log(`[POL_KEY_UP] Key UP received: ${key}. Current state: ${!!pressedKeysRef.current[key]}`);

        if (pressedKeysRef.current[key]) {
          pressedKeysRef.current[key] = false;
        }

        // Avoid visual pop if transferring focus (LOG ONLY - No longer blocks sync)
        if (ignoreKeysRef.current) {
          console.log('[POL_SYNC] Key released during transition, performing sync anyway to avoid stuck icon');
        }

        // Immediately hide volume UI on release
        if (VolumeManager?.showNativeVolumeUI) {
          VolumeManager.showNativeVolumeUI({ enabled: false }).catch(() => { });
        }

        // Trigger unified sync instantly for UI, debounced for hardware
        syncPolarizationState();
      });

      // Also set up a general key listener as backup
      try {
        KeyEvent.onKeyMultipleListener((keyEvent) => {
          console.log('🔑 KeyEvent MULTIPLE - keyCode:', keyEvent.keyCode);
        });
      } catch (e) {
        console.log('KeyEvent multiple listener not available:', e);
      }

      console.log('✅ Volume button listeners set up successfully');

      return () => {
        console.log('🧹 Cleaning up volume button listeners...');
        try {
          KeyEvent.removeKeyDownListener();
          KeyEvent.removeKeyUpListener();
          KeyEvent.removeKeyMultipleListener();
        } catch (e) {
          console.warn('Error removing listeners:', e);
        }
        clearTimeout(polTimeoutRef.current);
        if (polTouchHoldTimerRef.current) {
          clearTimeout(polTouchHoldTimerRef.current);
          polTouchHoldTimerRef.current = null;
        }
      };

    } else {
      // Android-only: no iOS volume handling fallback.
      return undefined;
    }
  }, []); // Set up once on mount

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

  // ========== SAVE IMAGE LOCALLY FUNCTION ==========
  const sanitizeFolderName = (s) => {
    if (!s || typeof s !== 'string') return '';
    return s.replace(/[\s/\\:*?"<>|]/g, '_').replace(/_+/g, '_').trim().slice(0, 80);
  };

  const saveImageLocallyOnly = async (sourcePath, fileName = null, options = {}) => {
    const { forGuest = false } = options;
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const targetFileName = fileName || (currentBox?.id
        ? `Cutiscope_${currentBox.id}_${ts}.jpg`
        : `Cutiscope_${ts}.jpg`);

      let directoryPath;
      let targetPath;

      if (forGuest) {
        // Guest: cache-only, app-private, auto-cleaned on exit
        directoryPath = await ensureGuestPhotosDir();
      } else {
        // Logged-in user: per-user, per-patient, year/month/week hierarchy
        const userSegment =
          userData?.id != null
            ? String(userData.id)
            : sanitizeFolderName(getUsername() || 'user');

        const year = String(now.getFullYear());
        const month = pad(now.getMonth() + 1);
        const day = pad(now.getDate());
        const dateSegment = `${day}-${month}-${year}`;

        const patientSegment = currentBox?.id
          ? `${currentBox.id}__${sanitizeFolderName(currentBox.name || '')}`
          : 'Unassigned';

        if (Platform.OS === 'android') {
          directoryPath = `${RNFS.ExternalStorageDirectoryPath}/DCIM/Camera/${userSegment}/${patientSegment}/${year}/${dateSegment}`;
        } else {
          directoryPath = `${RNFS.DocumentDirectoryPath}/Dermscope/${userSegment}/${patientSegment}/${year}/${dateSegment}`;
        }

        // Ensure nested folders exist (idempotent)
        await RNFS.mkdir(directoryPath);
      }

      targetPath = `${directoryPath}/${targetFileName}`;

      const sourceExists = await RNFS.exists(sourcePath);
      if (!sourceExists) {
        throw new Error(`Source file does not exist: ${sourcePath}`);
      }

      // Prefer move (single stored copy). If move fails, fall back to copy+delete source.
      try {
        await RNFS.moveFile(sourcePath, targetPath);
      } catch (moveErr) {
        await RNFS.copyFile(sourcePath, targetPath);
      }

      // Best-effort cleanup: ensure the original temp file doesn't remain.
      // If it remains, the Gallery can show duplicates if it scans cache/other dirs.
      try {
        const stillExists = await RNFS.exists(sourcePath);
        if (stillExists) {
          await RNFS.unlink(sourcePath);
        }
      } catch (_) { }

      // Do not scan guest photos into MediaStore — they stay app-private (cache + .nomedia).
      if (Platform.OS === 'android' && !forGuest) {
        try {
          await RNFS.scanFile(targetPath);
        } catch (scannerError) {
          console.log('Scanner error:', scannerError.message);
        }
      }

      const fileExists = await RNFS.exists(targetPath);
      if (!fileExists) {
        throw new Error(`File was not created at: ${targetPath}`);
      }

      const fileInfo = await RNFS.stat(targetPath);

      return {
        success: true,
        path: targetPath,
        fileName: targetFileName,
        localUrl: `file://${targetPath}`,
        size: fileInfo.size,
        modified: fileInfo.mtime
      };

    } catch (error) {
      console.error('Local save failed:', error);

      // Try Pictures directory as fallback
      try {
        const picturesDir = `${RNFS.ExternalStorageDirectoryPath}/Pictures`;
        const picturesPath = `${picturesDir}/${fileName || `Cutiscope_${Date.now()}.jpg`}`;

        const picturesExists = await RNFS.exists(picturesDir);
        if (!picturesExists) {
          await RNFS.mkdir(picturesDir);
        }

        await RNFS.copyFile(sourcePath, picturesPath);

        if (Platform.OS === 'android') {
          await RNFS.scanFile(picturesPath);
        }

        return {
          success: true,
          path: picturesPath,
          fileName: targetFileName,
          localUrl: `file://${picturesPath}`,
          isFallback: true,
        };
      } catch (picturesError) {
        console.error('Pictures directory also failed:', picturesError);

        // FINAL FALLBACK: Cache directory
        try {
          const fallbackDir = RNFS.CachesDirectoryPath;
          const fallbackPath = `${fallbackDir}/${fileName || `Cutiscope_${Date.now()}.jpg`}`;

          await RNFS.copyFile(sourcePath, fallbackPath);

          return {
            success: true,
            path: fallbackPath,
            fileName: targetFileName,
            localUrl: `file://${fallbackPath}`,
            isCache: true,
          };
        } catch (fallbackError) {
          console.error('All save attempts failed:', fallbackError);
          throw new Error(`Could not save image: ${fallbackError.message}`);
        }
      }
    }
  };


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
  // ========== LOAD IMAGE FUNCTION ==========
  // ========== LOAD IMAGE FUNCTION ==========
  const loadImage = useCallback(async () => {
    try {
      console.log('Loading latest image for gallery icon...');
      const hasPermission = await requestStoragePermission();
      if (!hasPermission) {
        setLatestPhotoUri(null);
        return;
      }

      // Only app folders – no OS gallery. When all photos deleted, thumbnail shows default (empty).
      const directoriesToCheck = isGuest
        ? [getGuestPhotosDir()]
        : [`${RNFS.ExternalStorageDirectoryPath}/DCIM/Camera`];

      let latestImage = null;
      let latestImageTime = 0;

      // Load deleted files list to filter them out
      let deletedFilesSet = new Set();
      try {
        const deletedFilesJson = await AsyncStorage.getItem('deleted_gallery_files_v2');
        if (deletedFilesJson) {
          const deletedFilesArray = JSON.parse(deletedFilesJson);
          deletedFilesSet = new Set(deletedFilesArray);
        }
      } catch (error) {
        console.log('Error loading deleted files for camera screen:', error);
      }

      // Recursive function to find the latest image
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
                const stat = await RNFS.stat(file.path);
                const modifiedTime = stat.mtime ? new Date(stat.mtime).getTime() : 0;

                if (modifiedTime > latestImageTime) {
                  latestImageTime = modifiedTime;
                  latestImage = {
                    ...file,
                    mtime: stat.mtime,
                    size: stat.size
                  };
                }
              } catch (statError) {
                // Ignore stat errors
              }
            }
          }
        } catch (err) {
          // Ignore read errors
        }
      };

      for (const directory of directoriesToCheck) {
        await findLatestImageRecursive(directory);
      }

      if (latestImage) {
        console.log('Setting latest photo URI:', latestImage.path);
        setLatestPhotoUri(latestImage);
      } else {
        console.log('No latest image found');
        setLatestPhotoUri(null);
      }
    } catch (error) {
      console.error('Failed to load images:', error);
      setLatestPhotoUri(null);
    }
  }, [requestStoragePermission, isGuest]);

  // Add this useEffect to refresh when returning from Gallery
  useFocusEffect(
    useCallback(() => {
      // Refresh gallery icon when screen comes into focus
      console.log('CameraScreen focused - refreshing gallery icon');
      loadImage();

      return () => {
        // Optional cleanup
      };
    }, [loadImage])
  );
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



  const onLightButtonPressIn = () => {
    lightPressStartRef.current = Date.now();
    clearPolTouchHoldTimer();
  };

  const onLightButtonLongPress = () => {
    if (!isLightOn) return;

    // Toggle the non-polarization state persistently
    touchPolHoldRef.current = !touchPolHoldRef.current;
    syncPolarizationState();

    // Provide a small haptic vibration for feedback
    if (Platform.OS === 'android') {
      Vibration.vibrate(40);
    }
  };

  const onLightButtonPressOut = () => {
    clearPolTouchHoldTimer();
  };

  const onLightButtonPress = () => {
    clearPolTouchHoldTimer();
    if (skipNextTorchToggleRef.current) {
      skipNextTorchToggleRef.current = false;
      return;
    }

    // Determine the intended resulting state by checking the same condition as toggleLight
    const nextLightState = batteryLevel > 0.2 ? !isLightOn : isLightOn;

    // Reset toggle cleanly when they directly tap the torch
    touchPolHoldRef.current = false;
    toggleLight();

    // Sync immediately with the predicted next state to avoid icon lag
    syncPolarizationState(false, nextLightState);
  };

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
        showInAppToast('Please wait, saving photo...', { durationMs: 2000, position: 'center' });
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
    if (isCapturingRef.current) {
      if (Platform.OS === 'android') {
        showInAppToast('Please wait, saving photo...', { durationMs: 2000, position: 'center' });
      }
      return;
    }
    ignoreKeysRef.current = true;
    console.log('🖼️ Going to Gallery screen');

    forceTorchOffUntilUserTaps();
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
        await requestStoragePermission();
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
    handleSingleTap();
  };

  const handleCameraMountError = (error) => {
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

  // ========== CAPTURE FUNCTION ==========
  // Guest: rapid capture like normal OS camera (short throttle + non-blocking save). Logged-in: 1s throttle + 500ms settle.
  const CAPTURE_THROTTLE_MS_GUEST = 800;
  const CAPTURE_THROTTLE_MS_LOGGED_IN = 1500;
  const CAPTURE_UNLOCK_DELAY_MS_LOGGED_IN = 280;

  const processImage = async (uri, zoomVal = 1.0, patientName = '', part = '') => {
    try {
      console.log('🖼️ processImage: Starting Skia processing for', uri, 'Zoom:', zoomVal);

      const exists = await RNFS.exists(uri);
      if (!exists) {
        console.error('❌ processImage: Source file does not exist:', uri);
        return uri;
      }

      const data = await RNFS.readFile(uri, 'base64');
      const skData = Skia.Data.fromBase64(data);
      const image = Skia.Image.MakeImageFromEncoded(skData);
      
      if (!image) {
        console.error('❌ processImage: Failed to decode image with Skia');
        return uri;
      }

      // Calculate Color Matrix for White Balance
      const temp = DEFAULT_TEMPERATURE || 6500;
      const tint = DEFAULT_TINT || 0;

      // Simple approximation for Temperature and Tint
      // Temperature: scales Red and Blue
      // Tint: scales Green
      const tempRatio = temp / 6500;
      const rScale = tempRatio < 1 ? 1 : 1 / tempRatio;
      const bScale = tempRatio > 1 ? 1 : tempRatio;
      const gScale = 1.0 - (tint * 0.1);

      const matrix = [
        rScale, 0, 0, 0, 0,
        0, gScale, 0, 0, 0,
        0, 0, bScale, 0, 0,
        0, 0, 0, 1, 0,
      ];

      const imgW = image.width();
      const imgH = image.height();

      const surface = Skia.Surface.MakeOffscreen(imgW, imgH);
      if (!surface) {
        console.error('❌ processImage: Failed to create Skia surface');
        return uri;
      }

      const canvas = surface.getCanvas();
      const paint = Skia.Paint();
      paint.setColorFilter(Skia.ColorFilter.MakeMatrix(matrix));
      canvas.drawImage(image, 0, 0, paint);

      // --- Draw Millimeter Scale Watermark ---
      try {
        console.log('📏 processImage: Drawing scale watermark...');
        const scaleX = imgW * 0.04;
        const scaleTop = imgH * 0.1;
        const scaleHeight = imgH * 0.8;
        
        const scalePaint = Skia.Paint();
        scalePaint.setColor(Skia.Color('#ffffff'));
        scalePaint.setStrokeWidth(Math.max(4, imgW / 300));
        scalePaint.setAntiAlias(true);

        canvas.drawLine(scaleX, scaleTop, scaleX, scaleTop + scaleHeight, scalePaint);

        const minMm = 10.0 / zoomVal;
        const maxMm = 20.0 / zoomVal;
        const numTicks = SCALE_NUM_TICKS;
        
        let font = null;
        try {
          const typeface = Skia.FontMgr.System().matchFamilyStyle("sans-serif", FontStyle.Normal);
          font = Skia.Font(typeface, Math.max(30, imgH / 40));
        } catch (fontErr) {
          console.warn('⚠️ processImage: Font creation failed', fontErr);
        }

        for (let i = 0; i <= numTicks; i++) {
          const isMajor = i % 5 === 0;
          const y = scaleTop + (i / numTicks) * scaleHeight;
          const tickWidth = isMajor ? (imgW * 0.04) : (imgW * 0.02);
          
          canvas.drawLine(scaleX, y, scaleX + tickWidth, y, scalePaint);
          
          if (isMajor && font) {
            const val = minMm + ((numTicks - i) / numTicks) * (maxMm - minMm);
            const text = val.toFixed(1);
            const textX = scaleX + tickWidth + (imgW * 0.015);
            canvas.drawText(text, textX, y + (font.getSize() / 3), scalePaint, font);
          }
        }
        
        if (font) {
          canvas.drawText('mm', scaleX, scaleTop + scaleHeight + font.getSize() + 10, scalePaint, font);
        }
        console.log('✅ processImage: Scale watermark drawn successfully');
      } catch (scaleDrawErr) {
        console.error('❌ processImage: Scale watermark error:', scaleDrawErr);
      }
      
      // --- Draw Patient Info Bar ---
      if (patientName || part) {
        try {
          console.log('📝 processImage: Drawing patient info bar...');
          const label = `Patient: ${patientName}${patientName && part ? ' | ' : ''}${part ? `Body Part: ${part}` : ''}`;
          
          const fontSize = Math.max(40, imgW / 25);
          const barHeight = fontSize * 2;
          
          const barPaint = Skia.Paint();
          barPaint.setColor(Skia.Color('rgba(0, 0, 0, 0.7)'));
          canvas.drawRect({ x: 0, y: 0, width: imgW, height: barHeight }, barPaint);
          
          const textPaint = Skia.Paint();
          textPaint.setColor(Skia.Color('#ffffff'));
          textPaint.setAntiAlias(true);
          
          const typeface = Skia.FontMgr.System().matchFamilyStyle("sans-serif", FontStyle.Bold);
          const font = Skia.Font(typeface, fontSize);
          
          const textWidth = font.measureText(label).width;
          const x = (imgW - textWidth) / 2;
          const y = (barHeight + fontSize * 0.8) / 2; // Center vertically
          
          canvas.drawText(label, x, y, textPaint, font);
          console.log('✅ processImage: Patient info bar drawn successfully');
        } catch (infoDrawErr) {
          console.error('❌ processImage: Patient info bar error:', infoDrawErr);
        }
      }

      const snapshot = surface.makeImageSnapshot();
      const encoded = snapshot.encodeToBase64(ImageFormat.JPEG, 90);
      const path = `${RNFS.TemporaryDirectoryPath}/processed_${Date.now()}.jpg`;
      await RNFS.writeFile(path, encoded, 'base64');
      console.log('✅ processImage: Done, path:', path);
      return path;
    } catch (err) {
      console.error('❌ Skia processImage error:', err);
      return uri;
    }
  };

  const handleCapturePress = async () => {
    resetInactivityTimer();
    // resetInactivityTimer();
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // For logged-in users: require a selected patient box before capturing.
    // Guests can always capture without selecting a patient.
    if (!isGuest && !currentBox?.id) {
      if (Platform.OS === 'android') {
        showInAppToast('Please select a patient to capture image', { durationMs: 2000, position: 'center' });
      }
      return;
    }

    // Also require a selected body part
    if (!isGuest && !bodyPart) {
      if (Platform.OS === 'android') {
        showInAppToast('Please select Patients body part to capture image', { durationMs: 2000, position: 'center' });
      }
      return;
    }

    const now = Date.now();
    const throttleMs = isGuest ? CAPTURE_THROTTLE_MS_GUEST : CAPTURE_THROTTLE_MS_LOGGED_IN;
    if (isCapturingRef.current || (now - lastCaptureTimeRef.current < throttleMs)) {
      return;
    }

    isCapturingRef.current = true;
    lastCaptureTimeRef.current = now;

    if (cameraRef.current && device) {
      try {
        setOnCapturePress(true);
        setIsCapturing(true);

        const hasStoragePermission = await requestStoragePermission();
        if (!hasStoragePermission) {
          Alert.alert(
            'Storage Permission Required',
            'Please grant storage permission to save images.',
            [{ text: 'OK' }]
          );
          setOnCapturePress(false);
          isCapturingRef.current = false; // Reset lock early
          resetInactivityTimer(); // Restart timer
          return;
        }

        const photo = await cameraRef.current.takePhoto({
          qualityPrioritization: 'quality',
          flash: 'off',
          enableShutterSound: false,
        });

        // Apply White Balance Correction & Watermarking
        const patientName = currentBox?.name || '';
        const processedPath = await processImage(photo.path, zoomBtnValue, patientName, bodyPart);
        console.log('📸 handleCapturePress: processedPath =', processedPath);
        const finalPhotoPath = processedPath.startsWith('file://') ? processedPath.slice(7) : processedPath;

        const now = new Date();
        const pad = num => num.toString().padStart(2, '0');
        const year = now.getFullYear();
        const month = pad(now.getMonth() + 1);
        const day = pad(now.getDate());
        const hours = pad(now.getHours());
        const minutes = pad(now.getMinutes());
        const seconds = pad(now.getSeconds());

        const cleanBodyPart = bodyPart ? sanitizeFolderName(bodyPart) : '';
        const bodyPartSuffix = cleanBodyPart ? `_BP-${cleanBodyPart}` : '';

        const fileName = currentBox?.id
          ? `Cutiscope_${currentBox.id}${bodyPartSuffix}_${year}${month}${day}_${hours}${minutes}${seconds}.jpg`
          : `Cutiscope${bodyPartSuffix}_${year}${month}${day}_${hours}${minutes}${seconds}.jpg`;

        const metadata = {
          zoom: zoomBtnValue,
          exposure: exposureBtnValue,
          focusDepth: focusDepthValue,
          deviceId: 'Dev_005',
          timestamp: new Date().toISOString(),
          userId: userData?.id || 'guest',
          username: userData?.username || 'guest'
        };

        if (isGuest) {
          const guestPhotoPath = finalPhotoPath;
          const guestFileName = fileName;
          (async () => {
            try {
              const localResult = await saveImageLocallyOnly(guestPhotoPath, guestFileName, { forGuest: true });
              setLatestPhotoUri({ path: localResult.path });
              loadImage();
            } catch (e) {
              if (Platform.OS === 'android') showInAppToast('Failed', { durationMs: 2000 });
            }
          })();
        } else {
          const username = getUsername();
          try {
            const localResult = await saveImageLocallyOnly(finalPhotoPath, fileName);
            setLatestPhotoUri({ path: localResult.path });
            loadImage();

            await registerAndEnqueue({
              localPath: localResult.path,
              fileName: localResult.fileName,
              username,
              userData,
              currentBox,
            });

            // Update patient photo counts
            if (currentBox?.id) {
              recordPhotoCapture(currentBox.id);
            }

            if (Platform.OS === 'android') {
              showInAppToast('Uploading', { position: 'bottom', durationMs: 1200 });
            }
            try {
              await AsyncStorage.setItem(`uploaded_${localResult.path}`, 'pending');
            } catch (_) { }

            (async () => {
              const pathKey = localResult.path;
              try {
                const accessToken = await firebaseAuthService.getValidAccessToken();
                if (accessToken) {
                  await googleDriveService.uploadPhotoToDrive(
                    accessToken,
                    `file://${localResult.path}`,
                    fileName
                  );
                  await AsyncStorage.setItem(`uploaded_${pathKey}`, 'true');
                } else {
                  await AsyncStorage.setItem(`uploaded_${pathKey}`, 'pending');
                }
              } catch (e) {
                await AsyncStorage.setItem(`uploaded_${pathKey}`, 'failed');
              }
            })();
          } catch (error) {
            if (Platform.OS === 'android') showInAppToast('Failed', { durationMs: 2000 });
          }
        }

      } catch (error) {
        console.error('Failed to take picture:', error);
        Alert.alert('Error', UserMessages.captureFailed);
      } finally {
        setOnCapturePress(false);
        setIsCapturing(false);
        if (isGuest) {
          // Unlock immediately for rapid capture like normal OS camera
          isCapturingRef.current = false;
        } else {
          setTimeout(() => {
            isCapturingRef.current = false;
          }, CAPTURE_UNLOCK_DELAY_MS_LOGGED_IN);
        }
        resetInactivityTimer(); // Restart auto-lock timer
      }
    } else {
      console.error('Camera not ready or device not available');
      setCameraError(UserMessages.cameraNotReady);
      isCapturingRef.current = false; // Reset lock
      resetInactivityTimer();
    }
  };

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
  const renderCamera = () => {
    if (cameraError) {
      return (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{cameraError}</Text>
          <TouchableOpacity
            style={styles.statusButton}
            onPress={handleTap}
          >
            <Text style={styles.statusButtonText}>Wake Up</Text>
          </TouchableOpacity>
        </View>
      );
    }



    if (!device) {
      return (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>Camera Not Ready</Text>
          <Text style={styles.statusSubText}>Camera device not found or still initializing...</Text>
          <ActivityIndicator size="large" color="#22B2A6" style={{ marginTop: 20 }} />
        </View>
      );
    }

    if (!hasPermission) {
      const handleGrantPermission = () => {
        InteractionManager.runAfterInteractions(() => {
          requestPermission().catch((e) => console.warn('Camera permission request error:', e));
        });
      };
      return (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>Permission Required</Text>
          <Text style={styles.statusSubText}>We need camera access to capture images</Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={handleGrantPermission}
            activeOpacity={0.85}
            delayPressIn={0}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <GestureHandlerRootView style={styles.cameraContainer}>
        <View style={{ flex: 1 }} {...panResponder.panHandlers}>
          <GestureDetector gesture={pinchGesture}>
            <View style={styles.cameraWrapper}>
              <TouchableOpacity
                ref={previewTouchableRef}
                style={styles.previewTouchable}
                activeOpacity={1}
                onPress={handleCameraTouch}
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  setViewDimensions({ width, height });

                  // Capture the preview's on-screen position for accurate tap-to-focus mapping.
                  // This is important when the preview does not start at y=0 (e.g., paddingTop)
                  // or when other absolute-positioned UI overlaps the preview.
                  requestAnimationFrame(() => {
                    previewTouchableRef.current?.measureInWindow?.((x, y, w, h) => {
                      previewLayoutInWindowRef.current = { x, y, width: w, height: h };
                    });
                  });
                }}
              >
                <ReanimatedCamera
                  ref={cameraRef}
                  style={styles.preview}
                  device={device}
                  isActive={isScreenFocused && !wifiMenuVisible && !isStandby} // Pause camera when modals are open or in standby to prevent bleed
                  photo={true}
                  animatedProps={animatedCameraProps}
                  format={format}
                  torch={isFlashOn ? 'on' : 'off'} // FLASHLIGHT CONTROL
                  photoQualityBalance="quality"
                  enableZoomGesture={false}
                  enableFpsGraph={false}
                  orientation="portrait"
                  // Add explicit focus prop check. 
                  // If showSlider is true (Manual Focus Mode), pass the focus value.
                  // Otherwise, it defaults to auto-focus (or whatever tap-to-focus set).
                  {...(showSlider ? { focus: focusDepthValue } : {})}

                  onInitialized={() => {
                    console.log('📱 Camera initialized, flash state:', isFlashOn ? 'ON' : 'OFF');
                  }}
                  onError={(error) => {
                    console.error('Camera Error:', error);
                    setCameraError('Tap On the Button to Use Camera');
                  }}
                />

                {/* Overlay Zoom Ruler (Interactive on Zoom) */}
                <View
                  style={{ position: 'absolute', bottom: 18, width: '100%', alignItems: 'center', zIndex: 110 }}
                >
                  <ZoomRuler
                    zoom={zoom}
                    minZoom={minZoom}
                    maxZoom={maxZoom}
                    onZoomChange={setZoomBtnValue}
                  />
                </View>

                {/* Millimeter Scale Overlay */}
                <MillimeterScale zoom={zoomBtnValue} />


                {showFocusStatus && (
                  <View style={styles.focusStatusContainer}>
                    <Text style={styles.focusStatusText}>Focus Set</Text>
                  </View>
                )}

                {showFocusIndicator && focusPoint && (
                  <Animated.View
                    style={[
                      styles.focusIndicator,
                      {
                        left: focusPoint.x - 60,
                        top: focusPoint.y - 60,
                        opacity: focusAnimation,
                        transform: [
                          {
                            scale: focusAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.8, 1.1]
                            })
                          }
                        ]
                      },
                    ]}
                  >
                    <View style={styles.focusOuterRing} />
                    <View style={styles.focusInnerCrosshair} />
                    <View style={styles.focusCorners}>
                      <View style={[styles.focusCorner, styles.cornerTL]} />
                      <View style={[styles.focusCorner, styles.cornerTR]} />
                      <View style={[styles.focusCorner, styles.cornerBL]} />
                      <View style={[styles.focusCorner, styles.cornerBR]} />
                    </View>
                  </Animated.View>
                )}
              </TouchableOpacity>
            </View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    );
  };

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
        <CustomStatusBar />

        {!isGuest && (currentBox?.name || bodyPart) ? (
          <View style={styles.patientNameTopBar}>
            <Text style={styles.patientNameText} numberOfLines={1}>
              {currentBox?.name ? <Text>Patient: <Text style={{fontFamily: 'ProductSans-Bold'}}>{currentBox.name}</Text></Text> : null}
              {currentBox?.name && bodyPart ? ' | ' : ''}
              {bodyPart ? <Text>Body Part: <Text style={{fontFamily: 'ProductSans-Bold'}}>{bodyPart}</Text></Text> : null}
            </Text>
          </View>
        ) : null}

        {renderCamera()}

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
        <PatientBoxModal
          visible={patientBoxModalVisible}
          onClose={() => {
            setPatientBoxModalVisible(false);
            resetInactivityTimer();
          }}
          initialId={currentBox?.id || ''}
          initialName={currentBox?.name || ''}
          onSet={async (box) => {
            setCurrentBox(box);
            try {
              await AsyncStorage.setItem('@patient_box', JSON.stringify(box));
            } catch (e) {
              console.warn('Save patient box:', e);
            }
          }}
          onInteraction={resetInactivityTimer}
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

        {/* ========== BLACK BACKGROUND WITH SETTINGS AND POLARIZATION ========== */}
        <View style={styles.blackBackground}>
          <TouchableOpacity
            style={[styles.menuItemSettings]}
            onPress={handleSettingsPress}
            onLongPress={() => {
              console.log('🔌 UI Request: Opening PowerOff modal via event');
              ignoreKeysRef.current = true;
              setIsLightOn(false);
              DeviceEventEmitter.emit('requestPowerMenu');
            }}
            activeOpacity={0.7}
          >
            <Image
              source={settingsIcon}
              style={[styles.icon]}
            />
          </TouchableOpacity>

          {/* ========== LIGHT TOGGLE BUTTON ========== */}
          {/* ========== LIGHT TOGGLE BUTTON ========== */}
          <Pressable
            style={[styles.menuItemLight]}
            onPressIn={onLightButtonPressIn}
            onPressOut={onLightButtonPressOut}
            // onLongPress={onLightButtonLongPress}
            delayLongPress={300}
            onPress={onLightButtonPress}
          >
            <View>
              <Image
                source={
                  !isLightOn
                    ? torchOffIcon
                    : showTorchOnly  // During the torch-only phase (500ms)
                      ? torchOffIcon   // Show torchOnIcon
                      : polIconColor === 'nonPolarised'
                        ? nonPolarisedIcon
                        : polarisedIcon
                }
                style={[
                  styles.icon,
                  // Only apply size modifiers when NOT in torch-only phase AND light is on
                  isLightOn && !showTorchOnly && polIconColor === 'nonPolarised' && styles.smallerIcon,
                  isLightOn && !showTorchOnly && polIconColor === 'polarised' && styles.widerPolarisedIcon,
                ]}
              />
            </View>
          </Pressable>

          {/* ========== BOX / PATIENT (hidden in guest mode; set ID & name; images save to that folder) ========== */}
          {!isGuest && (
            <TouchableOpacity
              style={[styles.menuItemLight, styles.boxButtonWrapper]}
              onPress={() => setPatientBoxModalVisible(true)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="folder-account"
                size={40}
                color={currentBox?.id ? '#22B2A6' : '#fff'}
              />
            </TouchableOpacity>
          )}

          {/* ========== BODY PART ICON ========== */}
          {!isGuest && (
            <TouchableOpacity
              style={[styles.menuItemLight, styles.boxButtonWrapper]}
              onPress={() => setBodyPartModalVisible(true)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="human"
                size={40}
                color={bodyPart ? '#22B2A6' : '#fff'}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* ========== UNIFIED BOTTOM CONTROLS ========== */}
        <View style={styles.bottomControlsContainer}>
          {/* LEFT: Gallery */}
          <View style={styles.leftContainer}>
            <TouchableOpacity
              style={styles.galleryButtonWrapper}
              onPress={handleGalleryPress}>
              <Image
                source={
                  latestPhotoUri
                    ? { uri: `file://${latestPhotoUri.path}` }
                    : GalleryBtn
                }
                style={styles.galleryIcon}
                defaultSource={GalleryBtn}
              />
            </TouchableOpacity>
          </View>

          {/* CENTER: Capture – enabled even when no patient selected (logged-in users only) to show toast */}
          <View style={styles.centerContainer}>
            <TouchableOpacity
              style={styles.captureButtonWrapper}
              onPress={handleCapturePress}
              onPressIn={() => setOnCapturePress(true)}
              onPressOut={() => setOnCapturePress(false)}
              activeOpacity={0.6}
            >
              {isCapturing ? (
                <ActivityIndicator size="large" color="#22B2A6" />
              ) : (
                <Image
                  source={onCapturePress ? CapturePressedBtn : CaptureBtn}
                  style={styles.captureIcon}
                />
              )}
            </TouchableOpacity>
          </View>

          {/* RIGHT: Zoom Control */}
          <View style={styles.rightContainer}>
            <View style={styles.zoomControlBoxWrapper}>
              <ZoomControl
                zoom={zoom}
                minZoom={minZoom}
                maxZoom={maxZoom}
                onZoomChange={(val) => {
                  setZoomBtnValue(val);
                  resetInactivityTimer();
                }}
                isCompact={true}
                currentZoom={zoomBtnValue}
              />
            </View>
          </View>
        </View>

        {/* ========== CONTROLS ========== */}
        <>
          {showSlider && (
            <View style={styles.scaleContainer}>
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
            <View style={styles.scaleContainer}>
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
            <View style={styles.scaleContainer}>
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
              setCurrentBox(next);
              await AsyncStorage.setItem('@patient_box', JSON.stringify(next));
            } catch (e) {
              console.warn('Save patient box:', e);
            }
          }}
          onInteraction={resetInactivityTimer}
        />

        {/* ========== STANDBY MODAL ========== */}
        <StandbyModal
          visible={isStandby}
          onActivate={() => {
            setIsStandby(false);
            resetInactivityTimer();
          }}
        />
      </View>
    </>
  );
};

// End of CameraScreen
const styles = StyleSheet.create({
  patientNameTopBar: {
    position: 'absolute',
    top: '8%',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  patientNameText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 4,
    overflow: 'hidden',
  },
  container: {
    justifyContent: 'flex-start',
    paddingTop: '12%',
    alignItems: 'center',
    backgroundColor: '#000',
    width: '100%',
    height: '100%',
  },
  blackBackground: {
    width: '100%',
    height: '10%',
    backgroundColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'center', // Center group of icons
    alignItems: 'center',
    position: 'absolute',
    bottom: '27%',
    gap: 40, // Space between the two centered icons
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 24,
    backgroundColor: 'transparent',
    zIndex: 9999,
  },
  cameraContainer: {
    height: '65%',
    width: '100%',
    backgroundColor: '#000',
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#000',
  },
  previewTouchable: {
    flex: 1,
  },
  preview: {
    flex: 1,
    marginTop: '0%',
    width: '100%',
    height: '100%',
  },
  // ========== UNIFIED BOTTOM CONTROLS STYLES ==========
  // ========== UNIFIED BOTTOM CONTROLS STYLES ==========
  // ========== UNIFIED BOTTOM CONTROLS STYLES ==========
  bottomControlsContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 150, // Fixed height area
    flexDirection: 'row',
    alignItems: 'center', // Vertically center all columns
    justifyContent: 'center',
    zIndex: 100,
    paddingBottom: 40, // More bottom padding as requested
  },
  leftContainer: {
    flex: 1,
    alignItems: 'flex-start', // Push content to Left
    paddingLeft: 30, // Extreme Left spacing
  },
  centerContainer: {
    width: 120, // Fixed width for center button area
    alignItems: 'center',
  },
  rightContainer: {
    flex: 1,
    alignItems: 'flex-end', // Push content to Right
    paddingRight: 30, // Extreme Right spacing
  },
  galleryButtonWrapper: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryIcon: {
    width: 55,
    height: 55,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  captureButtonWrapper: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureIcon: {
    width: 90,
    height: 90,
    resizeMode: 'contain',
  },
  zoomControlBoxWrapper: {
    width: 80, // Increased from 60
    height: 80, // Increased from 60
    justifyContent: 'center',
    alignItems: 'center',
    // Transparent background as requested
    borderRadius: 12,
  },

  // Legacy styles (keeping if needed but overrides prevent usage)
  captureButton: { width: 100, height: 100 },
  galleryButton: { width: 50, height: 55 },
  focusStatusContainer: {
    position: 'absolute',
    top: '10%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    zIndex: 1000,
  },
  focusStatusText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    textAlign: 'center',
  },
  quitButton: {
    position: 'absolute',
    top: 0,
    bottom: 2,
    right: 10,
    width: 60,
    height: 60,
    borderRadius: 50,
  },
  // captureButton: {
  //   position: 'absolute',
  //   bottom: '10%',
  //   alignSelf: 'center',
  //   width: 100,
  //   height: 100,
  //   justifyContent: 'center',
  //   alignItems: 'center',
  //   borderRadius: 30,
  // },
  // galleryButton: {
  //   position: 'absolute',
  //   bottom: '13.5%',
  //   left: 20,
  //   width: 50,
  //   height: 55,
  //   justifyContent: 'center',
  //   alignItems: 'center',
  //   borderRadius: 10,
  // },
  menuButton: {
    position: 'absolute',
    bottom: 97,
    right: 5,
    width: 30,
    height: 30,
    borderRadius: 50,
  },
  menu: {
    flexDirection: 'row-reverse',
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    marginBottom: 150,
    alignItems: 'center',
    bottom: 20,
  },
  menuItemSettings: {
    width: 45,
    height: 45,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
  },
  menuItemPol: {
    position: 'absolute',
    bottom: '15%',
    right: '25%', // Adjusted for 3 buttons
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuItemLight: {
    width: 45,
    height: 45,
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  boxButtonWrapper: {
    marginLeft: 8,
  },
  polIconContainer: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 20,
    shadowColor: '#000',
  },
  polIconImage: {
    width: 45,
    height: 45,
  },
  icon: {
    width: 45,
    height: 45,
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
  },
  smallerIcon: {
    width: 53,
    height: 53,
  },
  widerPolarisedIcon: {
    width: 57,
    height: 40,
  },
  iconButtonPressed: {
    backgroundColor: '#0D94FF',
    borderRadius: 100,
  },
  sliderContainer: {
    position: 'absolute',
    top: '5%',
    left: 35,
  },
  blocker: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 50,
    backgroundColor: 'transparent',
  },
  //========== EXACT ZOOM BAR STYLES FROM SCREENSHOT ==========
  exactZoomBar: {
    position: 'absolute',
    top: '62.5%',
    left: '5%',
    right: '5%',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    zIndex: 1000,
    overflow: 'hidden', // Important for the moving scale
  },
  exactZoomBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  zoomValueDisplay: {
    backgroundColor: 'rgba(255, 175, 32, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 50,
    alignItems: 'center',
  },
  zoomValueText: {
    color: '#000000',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
  },
  exactZoomTrack: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
    position: 'relative',
    marginLeft: 12,
    overflow: 'hidden', // Important for the moving scale
  },
  exactZoomTrackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    top: '50%',
    transform: [{ translateY: -1 }],
    zIndex: 1,
  },
  exactZoomTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    transform: [{ translateY: -1 }],
    zIndex: 2,
  },
  exactZoomTickContainer: {
    alignItems: 'center',
  },
  exactZoomTick: {
    width: 2,
    height: 8,
    backgroundColor: '#ffffff',
    marginBottom: 12,
  },
  exactZoomTickText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: 'ProductSans-Regular',
    marginTop: 2,
  },

  // NEW MOVING SCALE STYLES - EXTENDED
  // Update the moving scale styles
  exactZoomMovingScale: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 3,
  },
  exactZoomMovingTicks: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    minWidth: '400%', // Ensure enough width for smooth movement
  },
  exactZoomMovingTickContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '1%', // Use percentage for consistent spacing
  },
  exactZoomMovingTick: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  exactZoomMovingTickMajor: {
    height: 15, // Taller for major ticks (whole numbers)
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  exactZoomMovingTickMedium: {
    height: 10, // Medium for half numbers
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  exactZoomMovingTickMinor: {
    height: 6, // Shorter for quarter numbers
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },

  // FIXED CENTER INDICATOR (no left positioning)
  exactZoomIndicator: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    zIndex: 10,
    transform: [{ translateX: -1 }], // Center the indicator
  },
  exactZoomIndicatorLine: {
    width: 2,
    height: 15,
    backgroundColor: '#ffaf20',
  },
  exactZoomIndicatorDot: {
    width: 8,
    height: 8,
    backgroundColor: '#ffaf20',
    borderRadius: 4,
    marginTop: 2,
  },
  // ========== 100x100 ZOOM BOX STYLES ==========
  zoomBoxContainer: {
    position: 'absolute',
    bottom: '13.5%',
    right: 20,
    width: 100, // 100px width
    height: 100, // 100px height
    backgroundColor: 'rgba(30, 30, 30, 0.95)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
  },

  zoomBoxCurrentDisplay: {
    alignSelf: 'center',
    backgroundColor: 'rgba(60, 60, 60, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 8,
    minWidth: 40,
    alignItems: 'center',
  },

  zoomBoxCurrentText: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
    textAlign: 'center',
  },

  zoomBoxTrack: {
    width: '100%',
    height: 25,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginBottom: 8,
  },
  zoomBoxTrackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    top: '50%',
    transform: [{ translateY: -1 }],
    borderRadius: 1,
  },

  zoomBoxScaleBarsContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 25,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  zoomBoxScaleBars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'flex-end',
    position: 'relative',
    zIndex: 2,
  },
  zoomBoxScaleBarContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
    height: 25,
  },
  zoomBoxScaleBar: {
    width: 2,
    borderRadius: 1,
    marginBottom: 2,
  },
  zoomBoxScaleBarMajor: {
    height: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  zoomBoxScaleBarMinor: {
    height: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },

  zoomBoxFixedIndicator: {
    position: 'absolute',
    bottom: -2,
    left: '50%',
    width: 5,
    height: 25,
    backgroundColor: '#FFD700',
    borderRadius: 3,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 3,
    zIndex: 10,
    transform: [{ translateX: -3 }],
  },

  zoomBoxTouchArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -15,
    bottom: -15,
    backgroundColor: 'transparent',
    zIndex: 5,
  },

  scaleContainer: {
    position: 'absolute',
    bottom: 230,
    backgroundColor: 'rgba(0,0,0,0.5)',
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 13,
    marginBottom: 22,
  },
  scaleFocusContainer: {
    position: 'absolute',
    bottom: 185,
    backgroundColor: 'rgba(0,0,0,0.5)',
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 13,
    marginBottom: 22,
  },
  scaleContentContainer: {
    paddingHorizontal: '44%',
  },
  scaleFocusContentContainer: {
    paddingHorizontal: '44%',
  },
  scaleZoomContentContainer: {
    paddingHorizontal: '45%',
    alignItems: 'center',
  },
  tick: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 20, // INCREASED for less sensitivity
  },
  tickText: {
    color: 'white',
    marginBottom: 5,
  },
  tickFocusText: {
    color: 'white',
    marginBottom: 5,
    marginLeft: 6,
  },
  tickLine: {
    width: 2,
    height: 25,
    backgroundColor: 'white',
    bottom: 0,
  },
  majorTickText: {
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'ProductSans-Bold',
  },
  majorTickLine: {
    width: 2,
    height: 25,
    backgroundColor: '#ffffff',
  },
  minorTickLine: {
    width: 1,
    height: 15,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  activeTick: {
    backgroundColor: '#ffaf20',
    shadowColor: '#ffaf20',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    elevation: 2,
  },
  centerLine: {
    position: 'absolute',
    height: 40,
    width: 3,
    backgroundColor: '#f9b039',
    top: '50%',
  },
  currentZoomDisplay: {
    position: 'absolute',
    top: -30,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  currentZoomText: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
    padding: 20,
  },
  errorText: {
    color: '#ffffff',
    fontSize: 18,
    fontFamily: 'ProductSans-Bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  statusContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
    padding: 24,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 20,
    fontFamily: 'ProductSans-Bold',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 28,
  },
  statusSubText: {
    color: '#AAAAAA',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 22,
  },
  statusButton: {
    backgroundColor: '#2a241a',
    borderColor: '#22B2A6',
    borderWidth: 1.5,
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 200,
    shadowColor: '#22B2A6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  statusButtonText: {
    color: '#22B2A6',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  permissionButton: {
    backgroundColor: '#22B2A6',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 220,
    shadowColor: '#22B2A6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  permissionButtonText: {
    color: '#000000',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.5,
  },

  focusIndicator: {
    position: 'absolute',
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  focusOuterRing: {
    width: 100,
    height: 100,
    borderWidth: 2,
    borderColor: '#FFD700',
    backgroundColor: 'transparent',
    borderRadius: 8,
    position: 'absolute',
  },
  focusInnerCrosshair: {
    width: 60,
    height: 60,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#FFD700',
    position: 'absolute',
  },
  focusCorners: {
    position: 'absolute',
    width: 100,
    height: 100,
  },
  focusCorner: {
    position: 'absolute',
    width: 15,
    height: 15,
    borderColor: '#FFD700',
    backgroundColor: 'transparent',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderTopWidth: 0,
    borderRightWidth: 0,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderTopWidth: 0,
    borderLeftWidth: 0,
  },
  mmScaleContainer: {
    position: 'absolute',
    left: 15,
    top: '10%',
    height: '80%',
    zIndex: 110,
  },
  mmScaleTickRow: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    transform: [{ translateY: -10 }],
    height: 20,
  },
  mmScaleTickMajor: {
    width: 16,
    height: 2,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    elevation: 2,
  },
  mmScaleTickMinor: {
    width: 8,
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    elevation: 2,
  },
  mmScaleText: {
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'ProductSans-Bold',
    marginLeft: 6,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  mmScaleLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    elevation: 2,
  },
  mmScaleUnit: {
    position: 'absolute',
    bottom: -25,
    left: 0,
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'ProductSans-Bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  }
});

export default CameraScreen;