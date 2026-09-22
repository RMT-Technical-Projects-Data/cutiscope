import { useState, useEffect, useRef, useCallback } from 'react';
import { Alert, Vibration, Platform, PermissionsAndroid, Dimensions, Animated, Linking } from 'react-native';
import RNFS from 'react-native-fs';
import NetInfo from '@react-native-community/netinfo';
import Sound from 'react-native-sound';
import { useCameraPermission, useCameraDevice, useCameraFormat } from 'react-vision-camera';
import {
  CAMERA_DIR,
  ZOOM_VALUES,
  EXPOSURE_VALUES,
  FOCUS_DEPTH_VALUES,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_SENSITIVITY,
  INERTIA_THRESHOLD,
  INACTIVITY_TIMEOUT
} from '../utils/Constants';
import {
  requestStoragePermission,
  requestLocationPermission,
  checkStorageSpace,
  generateFileName,
  simpleToast,
  toastForCapture,
  showInAppToast
} from '../utils/Helpers';
import { UserMessages } from '../utils/userMessages';
import UploadService from '../services/UploadService';

export const useCamera = () => {
  // Camera states
  const [showImage, setShowImage] = useState(true);
  const [showGallery, setShowGallery] = useState(false);
  const [zoom, setZoom] = useState(0.2);
  const [ratio, setRatio] = useState('4:3');
  const cameraRef = useRef(null);
  const scale = useRef(new Animated.Value(1)).current;
  const [menuVisible, setMenuVisible] = useState(false);
  const [settingsMenuVisible, setSettingsMenuVisible] = useState(false);
  const [menuWidth] = useState(new Animated.Value(0));
  const [wifiMenuVisible, setWifiMenuVisible] = useState(false);
  const [wifiState, setWifiState] = useState('unknown');
  const [exposure, setExposure] = useState(0.5);
  const [showSlider, setShowSlider] = useState(false);
  const [zoomBtnValue, setZoomBtnValue] = useState(0.0);
  const [exposureBtnValue, setExposureBtnValue] = useState(0.0);

  // Lock task and standby
  const [lockTask, setLockTask] = useState(false);
  const [standby, setStandby] = useState(false);
  const timeoutRef = useRef(null);

  // UI interaction states
  const [isPressed, setIsPressed] = useState(null);
  const [onCapturePress, setOnCapturePress] = useState(false);
  const [latestPhotoUri, setLatestPhotoUri] = useState(null);

  // Autofocus states
  const [focusMode, setFocusMode] = useState('auto');
  const [focusPoint, setFocusPoint] = useState(null);
  const [focusDepthValue, setFocusDepthValue] = useState(0.2);

  // Additional states
  const [showScale, setShowScale] = useState(false);
  const [showFocusScale, setShowFocusScale] = useState(false);
  const [camApi, setCamApi] = useState(true);
  const [isVibrating, setIsVibrating] = useState(false);
  const vibrationInterval = useRef(null);
  const [cameraError, setCameraError] = useState(null);

  // Polarization states
  const [isPolPressed, setIsPolPressed] = useState(null);

  const tapTimeout = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollXFocus = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef(null);
  const scrollExposureViewRef = useRef(null);
  const focusScrollViewRef = useRef(null);
  const exposureScrollViewRef = useRef(null);

  // Vision Camera Hooks
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1920, height: 1080 } },
  ]);

  // Permissions and initialization
  useEffect(() => {
    requestLocationPermission();
    requestStoragePermission();
    loadImage();
    resetInactivityTimer();

    const initializeCamera = async () => {
      try {
        await requestPermission();
      } catch (error) {
        console.error('Camera permission error:', error);
        setCameraError('Camera permission required');
      }
    };
    initializeCamera();
  }, [requestPermission, loadImage, resetInactivityTimer]);

  // Load latest image
  const loadImage = useCallback(async () => {
    try {
      const result = await RNFS.readDir(CAMERA_DIR);
      const imageFiles = result.filter(
        file => file.isFile() && file.name.match(/\.(jpg|jpeg|png)$/i),
      );

      if (imageFiles.length > 0) {
        const sortedImages = imageFiles.sort((a, b) => {
          return new Date(b.mtime) - new Date(a.mtime);
        });
        const latestImage = sortedImages[0];
        setLatestPhotoUri(latestImage);
        console.log('Latest image:', latestImage);
      } else {
        setLatestPhotoUri(null);
        console.log('No images found in the directory.');
      }
    } catch (error) {
      setLatestPhotoUri(null);
      console.error('Failed to read directory:', error);
    }
  }, []);

  // Inactivity timer
  const resetInactivityTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setStandby(true);
    }, INACTIVITY_TIMEOUT);
  }, []);

  // Focus functions
  const focus = useCallback((point) => {
    const c = cameraRef.current;
    if (c == null) return;

    c.focus(point)
      .then(() => {
        console.log('Focus set successfully at:', point);
        simpleToast("Focus Set");
        if (Platform.OS === 'android') {
          Vibration.vibrate(50);
        }
      })
      .catch((error) => {
        console.error('Failed to set focus:', error);
      });
  }, []);

  // Handle focus button
  const handleFocusBtn = useCallback(async () => {
    if (focusMode === 'auto') {
      setFocusMode('manual');
      setIsPressed(prevState => (prevState === 'focus' ? null : 'focus'));
      setCamApi(false);
      setShowFocusScale(prev => {
        const newShowFocusScale = !prev;

        if (!prev) {
          const index = Math.round(focusDepthValue * 20);
          console.log(`Scrolling to index: ${index}, Focus Depth: ${focusDepthValue}`);
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
      setShowScale(true);
      simpleToast("Manual Focus");
    } else {
      setFocusMode('auto');
      setShowFocusScale(true);
      setIsPressed(null);
      setFocusPoint(null);

      try {
        await cameraRef.current?.setFocusMode?.('auto');
        console.log("Auto focus re-enabled");
      } catch (err) {
        console.warn("Auto focus not supported or failed:", err);
      }

      simpleToast("Auto Focus");
    }
  }, [focusMode, focusDepthValue]);

  // Handle single tap
  const handleSingleTap = useCallback(() => {
    console.log('Tap Event');
    setCameraError(null);
    if (standby) {
      setStandby(false);
    }
    resetInactivityTimer();
  }, [standby, resetInactivityTimer]);

  // Handle capture press
  const handleCapturePress = useCallback(async () => {
    if (cameraRef.current && device) {
      try {
        setOnCapturePress(true);

        // Check storage space
        const hasSpace = await checkStorageSpace(RNFS);
        if (!hasSpace) return;

        // Take photo
        console.log('Taking photo with Vision Camera...');
        const photo = await cameraRef.current.takePhoto({
          qualityPrioritization: 'speed',
          flash: 'off',
          enableShutterSound: false,
        });

        console.log('Picture taken:', photo.path);
        toastForCapture("");

        const fileName = generateFileName();
        const directoryPath = CAMERA_DIR;
        const filePath = `${directoryPath}/${fileName}`;

        const directoryExists = await RNFS.exists(directoryPath);
        if (!directoryExists) {
          await RNFS.mkdir(directoryPath);
        }

        await RNFS.moveFile(photo.path, filePath);
        console.log('Image saved to:', filePath);
        setLatestPhotoUri({ path: filePath });

        loadImage();

        // Upload to cloud
        const uploadResult = await UploadService.uploadImage(filePath, fileName);
        if (uploadResult.success) {
          toastForCapture('Uploaded to Cloud Storage');
        } else {
          toastForCapture('Failed to upload to cloud');
        }

      } catch (error) {
        console.error('Failed to take picture, save, or upload:', error);
        Alert.alert('Error', UserMessages.captureFailed);
      } finally {
        setOnCapturePress(false);
      }
    } else {
      console.error('Camera not ready or device not available');
      Alert.alert('Error', UserMessages.cameraNotReady);
    }
  }, [device, loadImage]);

  // Handle gallery press
  const handleGalleryPress = useCallback(() => {
    setShowGallery(true);
    stopPolarization();
    setShowFocusScale(false);
    setShowScale(false);
    setIsPressed(null);
  }, [stopPolarization]);

  // Handle back to camera
  const handleBackToCamera = useCallback(() => {
    setShowGallery(false);
    loadImage();
  }, [loadImage]);

  // Handle zoom press
  const handleZoomPress = useCallback(() => {
    setShowFocusScale(false);
    setIsPressed('zoom');
    if (isPressed === 'zoom') {
      setIsPressed(null);
    }
    setShowScale(!showScale);
    console.log("showScale:", showScale);

    const index = ZOOM_VALUES.findIndex(value => {
      const zoomMapped = 10 + zoomBtnValue * 30;
      let zoomCeiled;

      if (zoomMapped >= 10 && zoomMapped < 12.5) {
        zoomCeiled = 10;
      } else if (zoomMapped >= 12.5 && zoomMapped < 17.5) {
        zoomCeiled = 15;
      } else {
        zoomCeiled = Math.ceil(zoomMapped / 5) * 5;
      }

      const zoomNormalized = (zoomCeiled - 10) / 30;
      const epsilon = 0.01;
      return Math.abs(parseFloat(value) - zoomNormalized) < epsilon;
    });

    console.log(index);

    if (index >= 0) {
      const contentOffsetX = index * 50;
      console.log('scrolling to x: ', contentOffsetX);

      setTimeout(() => {
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            x: contentOffsetX,
            animated: false,
          });
        }
      }, 100);

      Animated.timing(scrollX, {
        toValue: contentOffsetX,
        duration: 10,
        useNativeDriver: true,
      }).start();
    }
  }, [zoomBtnValue, isPressed, showScale, scrollX]);

  // Handle scroll
  const handleScroll = useCallback((event) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / 50);

    if (index >= 0 && index < ZOOM_VALUES.length) {
      const selectedZoom = parseFloat(ZOOM_VALUES[index]);
      console.log('Selected Zoom while scrolling: ', selectedZoom);
      setZoomBtnValue(selectedZoom);
    }
  }, []);

  // Handle exposure scroll
  const handleExposureScroll = useCallback((event) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / 50);

    if (index >= 0 && index < EXPOSURE_VALUES.length) {
      const selectedExposure = parseFloat(EXPOSURE_VALUES[index]);
      console.log('Selected Exposure while scrolling: ', selectedExposure);
      setExposureBtnValue(selectedExposure);
    }
  }, []);

  // Handle focus scroll
  const handleFocusScroll = useCallback((event) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / 50);
    const newFocusDepth = parseFloat(FOCUS_DEPTH_VALUES[index]);
    setFocusDepthValue(newFocusDepth);
  }, []);

  // Handle contrast press
  const handleContrastPress = useCallback(() => {
    console.log(`Focus Depth on handleFocusBtn: ${focusDepthValue}`);
    console.log(`Focus Depth on exposureBtnValue: ${exposureBtnValue}`);
    setShowSlider(!showSlider);
    if (showSlider == false) {
      setIsPressed('Exposure');
      setShowFocusScale(false);
      setShowScale(false);
      setCamApi(true);
    } else {
      setIsPressed(null);
    }
  }, [focusDepthValue, exposureBtnValue, showSlider]);

  // Handle tap to focus
  const handleTapToFocus = useCallback((event) => {
    const { x, y } = event.nativeEvent;
    if (focusMode === 'manual' && cameraRef.current && device) {
      console.log('Tap to focus at:', { x, y });
      focus({ x, y });
      setFocusPoint({ x: x / Dimensions.get('window').width, y: y / Dimensions.get('window').height });
    }
  }, [focusMode, device, focus]);

  // Handle camera mount error
  const handleCameraMountError = useCallback((error) => {
    console.error('Camera mount error:', error);
    setCameraError('An error occurred while accessing the camera. Please restart the device.');
  }, []);

  // Handle pinch events
  const onPinchEvent = useCallback((event) => {
    setShowSlider(false);
    setShowFocusScale(false);
    setShowScale(false);
    setIsPressed(null);

    const scaleFactor = event.nativeEvent.scale;

    const zoomDelta = (scaleFactor - 1) * ZOOM_SENSITIVITY;

    let newZoom = zoomBtnValue + zoomDelta;

    newZoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM));

    console.log('onPinchEvent - Optimized:', {
      scaleFactor,
      zoomDelta,
      currentZoom: zoomBtnValue,
      newZoom,
      min: MIN_ZOOM,
      max: MAX_ZOOM
    });

    setZoomBtnValue(newZoom);
  }, [zoomBtnValue]);

  const onPinchStateChange = useCallback((event) => {
    if (event.nativeEvent.state === 5) {
      const velocity = event.nativeEvent.velocity;
      if (Math.abs(velocity) > INERTIA_THRESHOLD) {
        const inertiaZoom = zoomBtnValue + (velocity * 0.1);
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(inertiaZoom, MAX_ZOOM));

        setZoomBtnValue(clampedZoom);
      }

      scale.setValue(1);
      console.log('Pinch gesture ended, final zoom:', zoomBtnValue);
    }
  }, [zoomBtnValue, scale]);

  // Handle tap
  const handleTap = useCallback(() => {
    if (tapTimeout.current) {
      clearTimeout(tapTimeout.current);
      tapTimeout.current = null;
    } else {
      tapTimeout.current = setTimeout(() => {
        handleSingleTap();
        tapTimeout.current = null;
      }, 300);
    }
  }, [handleSingleTap]);

  // Handle long press wifi
  const handleLongPressWifi = useCallback(() => {
    setWifiMenuVisible(true);
  }, []);

  // Handle wifi toggle
  const handleWifiToggle = useCallback(async () => {
    try {
      if (wifiState === 'enabled') {
        setWifiState('disabled');
      } else {
        setWifiState('enabled');
      }
    } catch (error) {
      console.error('Failed to toggle WiFi state', error);
    }
  }, [wifiState]);

  // Handle settings press
  const handleSettingsPress = useCallback(() => {
    console.log("Hi, I'm settings");
    setSettingsMenuVisible(true);
    setMenuVisible(true);
    stopPolarization();
    setShowFocusScale(false);
    setShowScale(false);
  }, [stopPolarization]);

  // Handle menu toggle
  const toggleMenu = useCallback(() => {
    if (menuVisible == true) {
      setMenuVisible(false);
    } else {
      setMenuVisible(true);
      setSettingsMenuVisible(false);
    }
    console.log('Menu Btn pressed!!', menuVisible);
    Animated.timing(menuWidth, {
      toValue: menuVisible ? 0 : 400,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [menuVisible, menuWidth]);

  // Handle scroll end
  const onScrollEnd = useCallback((event) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / 50);
    const selectedZoom = parseFloat(ZOOM_VALUES[index]);
    console.log('selectedZoom: ', selectedZoom);
  }, []);

  // Handle exposure scroll end
  const onExposureScrollEnd = useCallback((event) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / 50);
    const selectedExposure = parseFloat(EXPOSURE_VALUES[index]);
    console.log('selectedExposure: ', selectedExposure);
  }, []);

  // Handle focus scroll end
  const onFocusScrollEnd = useCallback(() => {
    console.log(`Focus Depth Selected: ${focusDepthValue}`);
  }, [focusDepthValue]);

  // Vibration functions
  const produceHighVibration = useCallback(() => {
    if (isVibrating) {
      console.log('Vibration is already active.');
      return;
    }

    if (Platform.OS === 'android') {
      console.log('Starting continuous vibration...');
      setIsVibrating(true);

      Vibration.vibrate(15000);
      vibrationInterval.current = setInterval(() => {
        console.log('Restarting vibration...');
        Vibration.vibrate(15000);
      }, 14500);
    } else {
      console.log('iOS does not support custom vibration durations.');
    }
  }, [isVibrating]);

  const stopVibration = useCallback(() => {
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
  }, [isVibrating]);

  // Sound functions
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const stopSound = useCallback(() => {
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
  }, [sound]);

  const playMp3FromAssets = useCallback(() => {
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
            console.log('Replaying Sound');
            playLoop();
          } else {
            console.log('Playback failed');
            stopSound();
          }
        });
      };

      playLoop();
    });
  }, [isPlaying, stopSound]);

  // Handle polarization button
  const handlePolarizationBtn = useCallback(() => {
    if (
      isPolPressed === null &&
      isPolPressed != 'Polarization' &&
      isPolPressed != 'CrossPolarization'
    ) {
      console.log('2nd condition called!');
      simpleToast("POLARIZATION")
      setIsPolPressed('CrossPolarization');
      produceHighVibration();
      playMp3FromAssets();
    }
    else if (isPolPressed === 'Polarization') {
      stopSound();
      produceHighVibration();
      console.log('1st condition called!');
      setIsPolPressed('Polarization');
      simpleToast("POLARIZATION")
    }
    else {
      console.log('2nd condition called!');
      produceHighVibration();
      simpleToast("POLARIZATION")
      setIsPolPressed('CrossPolarization');
    }
  }, [isPolPressed, produceHighVibration, playMp3FromAssets, stopSound]);

  // Stop polarization
  const stopPolarization = useCallback(() => {
    console.log('Polarization Deactivated!');
    if (isPolPressed !== null) {
      simpleToast("Switching OFF Polarization")
      setIsPolPressed(null);
      stopSound();
      stopVibration();
    }
    else {
      console.log("Already off!");
    }
  }, [isPolPressed, stopSound, stopVibration]);

  // Handle long press
  const handleLongPress = useCallback((label) => {
    showInAppToast(label, { durationMs: 2000 });
  }, []);

  // Handle accessibility settings
  const openAccessibilitySettings = useCallback(() => {
    if (Platform.OS === 'android') {
      Linking.openSettings();
    }
  }, []);

  return {
    // States
    showImage,
    setShowImage,
    showGallery,
    setShowGallery,
    zoom,
    setZoom,
    ratio,
    setRatio,
    cameraRef,
    scale,
    menuVisible,
    setMenuVisible,
    settingsMenuVisible,
    setSettingsMenuVisible,
    menuWidth,
    wifiMenuVisible,
    setWifiMenuVisible,
    wifiState,
    setWifiState,
    exposure,
    setExposure,
    showSlider,
    setShowSlider,
    zoomBtnValue,
    setZoomBtnValue,
    exposureBtnValue,
    setExposureBtnValue,
    lockTask,
    setLockTask,
    standby,
    setStandby,
    timeoutRef,
    isPressed,
    setIsPressed,
    onCapturePress,
    setOnCapturePress,
    latestPhotoUri,
    setLatestPhotoUri,
    focusMode,
    setFocusMode,
    focusPoint,
    setFocusPoint,
    focusDepthValue,
    setFocusDepthValue,
    showScale,
    setShowScale,
    showFocusScale,
    setShowFocusScale,
    camApi,
    setCamApi,
    isVibrating,
    setIsVibrating,
    vibrationInterval,
    cameraError,
    setCameraError,
    isPolPressed,
    setIsPolPressed,
    tapTimeout,
    scrollX,
    scrollXFocus,
    scrollViewRef,
    scrollExposureViewRef,
    focusScrollViewRef,
    exposureScrollViewRef,
    hasPermission,
    device,
    format,

    // Functions
    loadImage,
    resetInactivityTimer,
    focus,
    handleFocusBtn,
    handleSingleTap,
    handleCapturePress,
    handleGalleryPress,
    handleBackToCamera,
    handleZoomPress,
    handleScroll,
    handleExposureScroll,
    handleFocusScroll,
    handleContrastPress,
    handleTapToFocus,
    handleCameraMountError,
    onPinchEvent,
    onPinchStateChange,
    handleTap,
    handleLongPressWifi,
    handleWifiToggle,
    handleSettingsPress,
    toggleMenu,
    onScrollEnd,
    onExposureScrollEnd,
    onFocusScrollEnd,
    produceHighVibration,
    stopVibration,
    playMp3FromAssets,
    stopSound,
    handlePolarizationBtn,
    stopPolarization,
    handleLongPress,
    openAccessibilitySettings,
  };
};
