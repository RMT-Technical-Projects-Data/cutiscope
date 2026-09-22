import { useState, useRef, useEffect } from 'react';
import { Animated, Dimensions } from 'react-native';
import { useCameraPermission, useCameraDevice, useCameraFormat } from 'react-vision-camera';
import RNFS from 'react-native-fs';
import PermissionsAndroid from 'react-native-permissions';
import { CAMERA_DIR, INACTIVITY_TIMEOUT } from '../utils/Constants';
import { requestStoragePermission, requestLocationPermission } from '../utils/Helpers';
import { LockTaskModule } from '../utils/NativeModules';

const { width, height } = Dimensions.get('window');

export const useCameraState = () => {
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

  // Scroll refs
  const tapTimeout = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollXFocus = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef(null);
  const scrollExposureViewRef = useRef(null);
  const focusScrollViewRef = useRef(null);
  const exposureScrollViewRef = useRef(null);

  // Additional states
  const [camApi, setCamApi] = useState(true);
  const [showScale, setShowScale] = useState(false);
  const [showFocusScale, setShowFocusScale] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // Vision Camera Hooks
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1920, height: 1080 } },
  ]);

  // Initialize app
  useEffect(() => {
    requestLocationPermission(PermissionsAndroid);
    requestStoragePermission(PermissionsAndroid);
    loadImage();
    resetInactivityTimer();

    if (LockTaskModule && LockTaskModule.startLockTask) {
      setLockTask(true);
      LockTaskModule.startLockTask();
    } else {
      console.warn('LockTaskModule not available - running in normal mode');
    }

    const initializeCamera = async () => {
      try {
        await requestPermission();
      } catch (error) {
        console.error('Camera permission error:', error);
        setCameraError('Camera permission required');
      }
    };
    initializeCamera();
  }, [requestPermission]);

  useEffect(() => {
    loadImage();
  }, []);

  // Load latest image
  const loadImage = async () => {
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
  };

  // Reset inactivity timer
  const resetInactivityTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setStandby(true);
    }, INACTIVITY_TIMEOUT);
  };

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
    tapTimeout,
    scrollX,
    scrollXFocus,
    scrollViewRef,
    scrollExposureViewRef,
    focusScrollViewRef,
    exposureScrollViewRef,
    camApi,
    setCamApi,
    showScale,
    setShowScale,
    showFocusScale,
    setShowFocusScale,
    cameraError,
    setCameraError,
    hasPermission,
    device,
    format,

    // Functions
    loadImage,
    resetInactivityTimer,
    requestPermission,
  };
};
