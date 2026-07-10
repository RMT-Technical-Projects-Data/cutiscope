import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Dimensions,
  Modal,
  FlatList,
  StatusBar,
  ActivityIndicator,
  Platform,
  LayoutAnimation,
  UIManager,
  NativeModules,
  DeviceEventEmitter,
  Animated,
  PanResponder,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import NetInfo from '@react-native-community/netinfo';
import ImageViewer from 'react-native-image-zoom-viewer';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, withDelay, useAnimatedReaction } from 'react-native-reanimated';
import { requestStoragePermissionForGallery } from '../utils/Helpers';
import { getGuestPhotosDir } from '../utils/guestPhotos';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import googleDriveService from '../services/googleDriveService';
import firebaseAuthService from '../services/firebaseAuthService';
import { uploadToUserS3Folder, uploadWithImageRecord, buildS3PathFromImage, deleteObjectFromS3 } from '../services/S3UploadService';
import OptimisedUploadService from '../services/OptimisedUploadService';
import ImageDatabase from '../services/ImageDatabase';
import ConfirmationModal from '../modals/ConfirmationModal';
import BluetoothShareModal from '../modals/BluetoothShareModal';
import { showInAppToast } from '../utils/Helpers';
import CustomStatusBar from '../Components/CustomStatusBar';

// Import your icons (make sure these paths are correct)
import backIcon from '../assets/icon_back.png';
import deleteIcon from '../assets/icon_delete.png';
import uploadIcon from '../assets/icon_upload.png';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const { width, height: screenHeight } = Dimensions.get('window');
const HORIZONTAL_PADDING = 16;
const ALBUM_GAP = 10;
const ALBUM_CARD_SIZE = Math.floor((width - HORIZONTAL_PADDING * 2 - ALBUM_GAP) / 2);

// Album hierarchy: patient → year → month → week → photos
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Enable LayoutAnimation on Android
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Theme Colors
const PRIMARY_BACKGROUND = '#22B2A6';
const HEADER_FOOTER_BG = '#000000';
const PRIMARY_TEXT = '#FFFFFF';
const SECONDARY_TEXT = '#AAAAAA';
const ACCENT_TEAL = '#22B2A6';

// Safe area padding
const STATUS_BAR_HEIGHT = Platform.OS === 'ios' ? 44 : StatusBar.currentHeight || 0;
const EXTRA_HEADER_PADDING = 40;

const ZoomableImage = ({ uri, onTap }) => {
  const [imgDims, setImgDims] = useState({ w: width, h: screenHeight });
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Shared values for tracking pinch starting states
  const isPinching = useSharedValue(false);
  const justFinishedPinching = useSharedValue(false);
  const scaleStart = useSharedValue(1);
  const translateXStart = useSharedValue(0);
  const translateYStart = useSharedValue(0);
  const focalXStart = useSharedValue(0);
  const focalYStart = useSharedValue(0);
  const lastFocalX = useSharedValue(0);
  const lastFocalY = useSharedValue(0);

  // Track incremental pan translation
  const prevTranslationX = useSharedValue(0);
  const prevTranslationY = useSharedValue(0);

  useEffect(() => {
    if (uri) {
      Image.getSize(uri, (w, h) => {
        setImgDims({ w, h });
      }, () => {
        setImgDims({ w: width, h: screenHeight });
      });
    }
  }, [uri]);

  const { displayedWidth, displayedHeight } = useMemo(() => {
    const screenRatio = width / screenHeight;
    const imageRatio = imgDims.w / imgDims.h;

    let dWidth, dHeight;
    if (imageRatio > screenRatio) {
      dWidth = width;
      dHeight = width / imageRatio;
    } else {
      dHeight = screenHeight;
      dWidth = screenHeight * imageRatio;
    }
    return { displayedWidth: dWidth, displayedHeight: dHeight };
  }, [imgDims]);

  // Double-tap to zoom in (to 3x) at tapped point, or zoom back out to 1x
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDeltaX(15)
    .maxDeltaY(15)
    .onEnd((e) => {
      if (scale.value > 1.0) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        const targetScale = 3.0;
        const tapX = e.x - width / 2;
        const tapY = e.y - screenHeight / 2;

        const maxTransX = Math.max(0, (displayedWidth * targetScale - width) / 2);
        const maxTransY = Math.max(0, (displayedHeight * targetScale - screenHeight) / 2);

        const targetTx = Math.min(Math.max(tapX * (1 - targetScale), -maxTransX), maxTransX);
        const targetTy = Math.min(Math.max(tapY * (1 - targetScale), -maxTransY), maxTransY);

        scale.value = withTiming(targetScale);
        translateX.value = withTiming(targetTx);
        translateY.value = withTiming(targetTy);
        savedScale.value = targetScale;
        savedTranslateX.value = targetTx;
        savedTranslateY.value = targetTy;
      }
    });

  // Single tap to toggle overlay visibility
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDeltaX(15)
    .maxDeltaY(15)
    .onEnd(() => {
      if (onTap) {
        runOnJS(onTap)();
      }
    });

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      isPinching.value = true;
      scaleStart.value = scale.value;
      translateXStart.value = translateX.value;
      translateYStart.value = translateY.value;
      focalXStart.value = e.focalX - width / 2;
      focalYStart.value = e.focalY - screenHeight / 2;
      lastFocalX.value = e.focalX;
      lastFocalY.value = e.focalY;
    })
    .onUpdate((e) => {
      const dfx = e.focalX - lastFocalX.value;
      const dfy = e.focalY - lastFocalY.value;
      lastFocalX.value = e.focalX;
      lastFocalY.value = e.focalY;

      // Ignore updates if the pointer count is not 2 OR if there is an abrupt jump in focal point
      // (a jump > 40px in a single frame indicates a finger release/addition transition)
      if (e.numberOfPointers !== 2 || Math.abs(dfx) > 40 || Math.abs(dfy) > 40) {
        return;
      }

      const newScale = Math.min(Math.max(1, scaleStart.value * e.scale), 6);
      scale.value = newScale;

      const currentFocalX = e.focalX - width / 2;
      const currentFocalY = e.focalY - screenHeight / 2;

      // Unscaled focal point relative to image coordinate space
      const p0x = (focalXStart.value - translateXStart.value) / scaleStart.value;
      const p0y = (focalYStart.value - translateYStart.value) / scaleStart.value;

      // Target translation to keep the image point under the fingers
      const targetTx = currentFocalX - newScale * p0x;
      const targetTy = currentFocalY - newScale * p0y;

      const maxTransX = Math.max(0, (displayedWidth * newScale - width) / 2);
      const maxTransY = Math.max(0, (displayedHeight * newScale - screenHeight) / 2);

      translateX.value = Math.min(Math.max(targetTx, -maxTransX), maxTransX);
      translateY.value = Math.min(Math.max(targetTy, -maxTransY), maxTransY);
    })
    .onEnd(() => {
      isPinching.value = false;
      justFinishedPinching.value = true;
      justFinishedPinching.value = withDelay(100, withTiming(false, { duration: 0 }));

      if (scale.value <= 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
    })
    .onFinalize(() => {
      isPinching.value = false;
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onTouchesMove((e, state) => {
      if (scale.value <= 1.0) {
        state.fail();
      }
    })
    .onStart(() => {
      prevTranslationX.value = 0;
      prevTranslationY.value = 0;
    })
    .onUpdate((e) => {
      if (scale.value > 1.0) {
        const dx = e.translationX - prevTranslationX.value;
        const dy = e.translationY - prevTranslationY.value;
        prevTranslationX.value = e.translationX;
        prevTranslationY.value = e.translationY;

        if (!isPinching.value && !justFinishedPinching.value) {
          const maxTransX = Math.max(0, (displayedWidth * scale.value - width) / 2);
          const maxTransY = Math.max(0, (displayedHeight * scale.value - screenHeight) / 2);

          translateX.value = Math.min(Math.max(translateX.value + dx, -maxTransX), maxTransX);
          translateY.value = Math.min(Math.max(translateY.value + dy, -maxTransY), maxTransY);
        }
      }
    })
    .onEnd(() => {
      if (scale.value > 1.0) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
    });

  // Compose all gestures simultaneously so pinch/pan are not blocked or delayed
  const composed = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ]
  }));

  return (
    <GestureDetector gesture={composed}>
      <Reanimated.View style={{ flex: 1, width, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
        <Reanimated.Image
          source={{ uri }}
          style={[{ width: '100%', height: '100%' }, animatedStyle]}
          resizeMode="contain"
          fadeDuration={0}
        />
      </Reanimated.View>
    </GestureDetector>
  );
};



// Performance constants
const THUMBNAIL_SIZE = (Dimensions.get('window').width / 3) - 6;
const IMAGE_CACHE = new Map(); // Simple in-memory cache
const DELETED_FILES_KEY = 'deleted_gallery_files_v2'; // Key for storing deleted files

// Optimized Upload Animation Component
const UploadAnimation = ({ progress, total }) => {
  let message;
  if (total <= 1) {
    message = 'Uploading Image...';
  } else {
    message = `Uploading Images... (${progress} out of ${total})`;
  }
  return (
    <View style={styles.uploadContainer}>
      <ActivityIndicator size="large" color={ACCENT_TEAL} />
      <Text style={styles.uploadText}>{message}</Text>
      {total > 1 && (
        <View style={styles.progressBarBackground}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${Math.round((progress / total) * 100)}%` }
            ]}
          />
        </View>
      )}
    </View>
  );
};

// Deletion Loader - uses a full-screen Modal for guaranteed coverage
const DeletionLoader = ({ visible }) => (
  <Modal
    visible={visible}
    transparent={true}
    animationType="fade"
    statusBarTranslucent={true}
    onRequestClose={() => { }}
  >
    <View style={{
      flex: 1,
      marginTop: 10,
      backgroundColor: 'rgba(0,0,0,0.92)',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <ActivityIndicator size="large" color={ACCENT_TEAL} />
      <Text style={{
        color: ACCENT_TEAL,
        fontSize: 18,
        marginTop: 20,
        fontWeight: 'bold',
        textAlign: 'center',
      }}>Deleting... Please wait.</Text>
    </View>
  </Modal>
);

// Optimized Thumbnail Component
const ThumbnailItem = React.memo(({
  photo,
  isSelected,
  isSelectionMode,
  isGuest,
  onPress,
  onLongPress
}) => {
  const [imageUri, setImageUri] = useState(null);
  const [isUploaded, setIsUploaded] = useState(false);

  // Load image with caching
  useEffect(() => {
    if (imageUri) return;

    const loadCachedImage = async () => {
      if (IMAGE_CACHE.has(photo.path)) {
        setImageUri(IMAGE_CACHE.get(photo.path));
        return;
      }

      try {
        IMAGE_CACHE.set(photo.path, photo.path);
        setImageUri(photo.path);
      } catch (error) {
        console.log('Error loading thumbnail:', error);
      }
    };

    loadCachedImage();
  }, [photo.path, imageUri]);

  // Check upload status (DB first, then legacy AsyncStorage)
  useEffect(() => {
    if (photo.uploadStatus === 'UPLOADED') {
      setIsUploaded(true);
      return;
    }
    if (photo.uploadStatus === 'PENDING' || photo.uploadStatus === 'FAILED') {
      setIsUploaded(false);
      return;
    }
    const checkUploadStatus = async () => {
      try {
        const cleanPath = photo.path.replace('file://', '');
        const status = await AsyncStorage.getItem(`uploaded_${cleanPath}`);
        setIsUploaded(status === 'true');
      } catch (error) {
        console.log('Error checking upload status:', error);
      }
    };
    checkUploadStatus();
  }, [photo.path, photo.uploadStatus]);

  return (
    <TouchableOpacity
      style={styles.thumbnailContainer}
      onPress={() => onPress(photo)}
      onLongPress={() => onLongPress(photo.path)}
      delayLongPress={300}
      activeOpacity={0.7}
    >
      {imageUri && (
        <Image
          source={{ uri: imageUri }}
          style={[
            styles.thumbnail,
            isSelectionMode && isSelected && styles.photoImageSelected
          ]}
          resizeMode="cover"
          fadeDuration={0}
        />
      )}
      {isSelectionMode && isSelected && (
        <View style={styles.selectedOverlay}>
          <Text style={styles.selectedText}>✓</Text>
        </View>
      )}
      {!isGuest && isUploaded && (
        <View style={styles.uploadedIndicator}>
          <View style={styles.greenDot} />
        </View>
      )}
      {!isGuest && !isUploaded && (
        <View style={styles.uploadedIndicator}>
          <View style={styles.grayDot} />
        </View>
      )}
      {!isGuest && photo.timestamp && (
        <Text style={styles.photoTimestamp} numberOfLines={1}>
          {photo.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
    </TouchableOpacity>
  );
});

const GalleryScreen = ({ route, navigation }) => {
  const { userData, isGuest, getUsername } = useAuth();
  const [capturedPhotos, setCapturedPhotos] = useState([]);
  const capturedPhotosRef = React.useRef(capturedPhotos);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [fullScreenPhoto, setFullScreenPhoto] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [deletedFiles, setDeletedFiles] = useState(new Set());
  const [forceRefreshCounter, setForceRefreshCounter] = useState(0);
  const [albumPath, setAlbumPath] = useState([]);
  const [albumItems, setAlbumItems] = useState([]);
  const [selectedAlbumPaths, setSelectedAlbumPaths] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Confirmation Modal State
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({
    title: '',
    message: '',
    confirmText: '',
    cancelText: 'Cancel',
    isDestructive: false,
    onConfirm: () => { },
  });

  // Bluetooth Custom Share Modal State
  const [bluetoothShareVisible, setBluetoothShareVisible] = useState(false);
  const [bluetoothShareFiles, setBluetoothShareFiles] = useState([]);
  const [bluetoothShareLabels, setBluetoothShareLabels] = useState([]);

  const handleBluetoothShareSuccess = useCallback(() => {
    setSelectedPhotos([]);
    setIsSelectionMode(false);
    setFullScreenPhoto(null);
  }, []);

  // Sync ref with state
  useEffect(() => {
    capturedPhotosRef.current = capturedPhotos;
  }, [capturedPhotos]);

  // Listen for background uploads
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('IMAGE_UPLOADED', (filePath) => {
      const cleanPath = filePath.replace('file://', '');
      setCapturedPhotos((prev) => prev.map((p) =>
      ((p.absolutePath || p.path?.replace('file://', '')) === cleanPath
        ? { ...p, uploadStatus: 'UPLOADED' }
        : p
      )
      ));
    });

    const statusSub = DeviceEventEmitter.addListener('IMAGE_UPLOAD_STATUS_CHANGED', ({ filePath, status }) => {
      const cleanPath = filePath.replace('file://', '');
      setCapturedPhotos((prev) => prev.map((p) =>
      ((p.absolutePath || p.path?.replace('file://', '')) === cleanPath
        ? { ...p, uploadStatus: status }
        : p
      )
      ));
    });

    return () => {
      subscription.remove();
      statusSub.remove();
    };
  }, []);

  // Load deleted files from AsyncStorage
  useEffect(() => {
    const loadDeletedFiles = async () => {
      try {
        const deletedFilesJson = await AsyncStorage.getItem(DELETED_FILES_KEY);
        if (deletedFilesJson) {
          const deletedFilesArray = JSON.parse(deletedFilesJson);
          setDeletedFiles(new Set(deletedFilesArray));
        }
      } catch (error) {
        console.log('Error loading deleted files:', error);
      }
    };

    loadDeletedFiles();
  }, []);

  // Save deleted files to AsyncStorage
  useEffect(() => {
    const saveDeletedFiles = async () => {
      try {
        const deletedFilesArray = Array.from(deletedFiles);
        await AsyncStorage.setItem(DELETED_FILES_KEY, JSON.stringify(deletedFilesArray));
      } catch (error) {
        console.log('Error saving deleted files:', error);
      }
    };

    saveDeletedFiles();
  }, [deletedFiles]);

  const handleBackPress = useCallback(() => {
    if (albumPath.length > 0) {
      setAlbumPath((prev) => prev.slice(0, -1));
      setIsSelectionMode(false);
      setSelectedPhotos([]);
      setSelectedAlbumPaths([]);
      return;
    }
    if (isSelectionMode) {
      setSelectedPhotos([]);
      setSelectedAlbumPaths([]);
      setIsSelectionMode(false);
    } else {
      navigation?.goBack?.() || navigation?.navigate?.('Camera');
    }
  }, [albumPath.length, isSelectionMode, navigation]);

  // Function to delete file with proper cleanup (local + S3 when uploaded)
  const deleteFileWithCleanup = useCallback(async (filePath) => {
    const cleanPath = filePath.replace('file://', '');

    try {
      // 0. If this image was uploaded to S3, delete it from S3 too
      try {
        const image = await ImageDatabase.getImageByFilePath(cleanPath);
        if (image && image.uploadStatus === 'UPLOADED') {
          const { fullKey } = buildS3PathFromImage(image);
          await deleteObjectFromS3(fullKey);
        }
      } catch (s3DeleteErr) {
        console.warn('S3 delete during cleanup:', s3DeleteErr);
      }

      // 1. Try Root Deletion First (Most Reliable for System Apps/Rooted Devices)
      try {
        const { SystemTimeModule } = NativeModules;
        if (SystemTimeModule && SystemTimeModule.deleteFileRoot) {
          await SystemTimeModule.deleteFileRoot(cleanPath);
          // Root deletion successful

          // If root deletion works, we can return early after updating local state
          // But we'll fall through to update lists just in case
        }
      } catch (rootError) {
        console.warn('Root deletion failed, falling back to standard deletion:', rootError);
      }

      // 1. Check if file exists (Standard Check)
      const fileExists = await RNFS.exists(cleanPath);
      if (!fileExists) return true;

      // 2. Delete the file
      await RNFS.unlink(cleanPath);

      // 3. Force Android to update its media store
      if (Platform.OS === 'android') {
        try {
          // Method 1: Use RNFS.scanFile (most reliable)
          await RNFS.scanFile(cleanPath);

          // Method 2: Access parent directory to trigger refresh
          const parentDir = cleanPath.substring(0, cleanPath.lastIndexOf('/'));
          try {
            await RNFS.readDir(parentDir);
          } catch (e) {
            // Ignore errors
          }

          // Method 3: Small delay and rescan
          setTimeout(async () => {
            try {
              await RNFS.scanFile(cleanPath);
            } catch (e) {
              // Ignore
            }
          }, 100);
        } catch (error) {
          console.warn('Error updating media store:', error);
        }
      }

      // 4. Add to deleted files list
      setDeletedFiles(prev => {
        const newSet = new Set(prev);
        newSet.add(cleanPath);
        return newSet;
      });

      // 5. Clear from memory cache
      IMAGE_CACHE.delete(filePath);

      // 6. Clear upload status from AsyncStorage
      try {
        await AsyncStorage.removeItem(`uploaded_${cleanPath}`);
      } catch (e) {
        console.warn('Error clearing upload status:', e);
      }
      // 7. Remove from image registry (DB)
      try {
        await ImageDatabase.removeImageByFilePath(cleanPath);
      } catch (e) {
        console.warn('Error removing from image registry:', e);
      }
      return true;
    } catch (error) {
      console.error(`Error deleting file ${cleanPath}:`, error);
      throw error;
    }
  }, []);

  const getBasePath = useCallback(() => {
    if (isGuest) {
      return getGuestPhotosDir();
    }

    const userSegment =
      userData?.id != null
        ? String(userData.id)
        : sanitizeFolderName(getUsername() || 'user');

    if (Platform.OS === 'android') {
      return `${RNFS.ExternalStorageDirectoryPath}/DCIM/Camera/${userSegment}`;
    }
    return `${RNFS.DocumentDirectoryPath}/Dermscope/${userSegment}`;
  }, [isGuest, userData, getUsername]);

  const deleteFolderRecursive = useCallback(async (dirPath) => {
    let list;
    try {
      list = await RNFS.readDir(dirPath);
    } catch (e) {
      console.warn('Could not read dir for delete:', dirPath, e);
      return;
    }
    for (const item of list) {
      const fullPath = item.path;
      if (item.isDirectory()) {
        await deleteFolderRecursive(fullPath);
        try {
          await RNFS.unlink(fullPath);
        } catch (e) {
          if (Platform.OS === 'android') {
            try {
              const { SystemTimeModule } = NativeModules;
              if (SystemTimeModule && SystemTimeModule.deleteFileRoot) {
                await SystemTimeModule.deleteFileRoot(fullPath);
              }
            } catch (rootE) {
              console.log('Could not remove dir:', fullPath, e);
            }
          } else {
            console.log('Could not remove dir:', fullPath, e);
          }
        }
      } else {
        try {
          await RNFS.unlink(fullPath);
        } catch (e) {
          if (Platform.OS === 'android') {
            try {
              const { SystemTimeModule } = NativeModules;
              if (SystemTimeModule && SystemTimeModule.deleteFileRoot) {
                await SystemTimeModule.deleteFileRoot(fullPath);
              }
            } catch (rootE) {
              console.log('Could not remove file:', fullPath, e);
            }
          } else {
            console.log('Could not remove file:', fullPath, e);
          }
        }
      }
    }
  }, []);

  const deleteAlbumWithAllImages = useCallback(async (pathSegments) => {
    const base = getBasePath();
    const fullPath = pathSegments.length === 0 ? base : `${base}/${pathSegments.join('/')}`;
    const exists = await RNFS.exists(fullPath);
    if (!exists) return;

    const getAllImageFilesRecursive = async (dirPath) => {
      let results = [];
      try {
        const list = await RNFS.readDir(dirPath);
        for (const item of list) {
          if (item.isDirectory()) {
            results = results.concat(await getAllImageFilesRecursive(item.path));
          } else if (item.isFile() && item.name.match(/\.(jpg|jpeg|png|gif|bmp)$/i) && !item.name.startsWith('compressed_')) {
            results.push(item);
          }
        }
      } catch (_) { }
      return results;
    };

    const imageFiles = await getAllImageFilesRecursive(fullPath);
    for (const file of imageFiles) {
      try {
        await deleteFileWithCleanup(`file://${file.path}`);
      } catch (e) {
        console.log('Error deleting image:', file.path, e);
      }
    }

    await deleteFolderRecursive(fullPath);

    const unlinkAlbumDir = async () => {
      try {
        await RNFS.unlink(fullPath);
      } catch (e) {
        if (Platform.OS === 'android') {
          try {
            const { SystemTimeModule } = NativeModules;
            if (SystemTimeModule && SystemTimeModule.deleteFileRoot) {
              await SystemTimeModule.deleteFileRoot(fullPath);
            }
          } catch (rootE) {
            console.log('Could not remove album dir:', fullPath, e);
          }
        } else {
          console.log('Could not remove album dir:', fullPath, e);
        }
      }
    };
    await unlinkAlbumDir();
  }, [getBasePath, deleteFileWithCleanup, deleteFolderRecursive]);

  const toggleAlbumSelection = useCallback((pathKey) => {
    setSelectedAlbumPaths(prev =>
      prev.includes(pathKey) ? prev.filter(k => k !== pathKey) : [...prev, pathKey]
    );
  }, []);

  const handleSelectAllAlbums = useCallback(() => {
    const pathKeys = albumItems.map(item => (albumPath.length === 0 ? item.id : [...albumPath, item.id].join('/')));
    const allSelected = pathKeys.length > 0 && pathKeys.every(k => selectedAlbumPaths.includes(k));
    if (allSelected) {
      setSelectedAlbumPaths([]);
      setIsSelectionMode(false);
    } else {
      setSelectedAlbumPaths(pathKeys);
      setIsSelectionMode(true);
    }
  }, [albumItems, albumPath, selectedAlbumPaths]);

  const handleDeleteSelectedAlbums = useCallback(() => {
    if (selectedAlbumPaths.length === 0) {
      showInAppToast('No albums selected', { durationMs: 2000, position: 'bottom' });
      return;
    }
    const count = selectedAlbumPaths.length;
    const isTopLevel = albumPath.length === 0;
    setConfirmConfig({
      title: isTopLevel ? 'Delete Album(s)' : 'Delete Album(s)',
      message: `Delete ${count} album(s) and all images inside permanently?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: async () => {
        try {
          setIsDeleting(true);
          for (const pathKey of selectedAlbumPaths) {
            const pathSegments = pathKey.split('/').filter(Boolean);
            await deleteAlbumWithAllImages(pathSegments);
          }
          setSelectedAlbumPaths([]);
          setIsSelectionMode(false);
          setForceRefreshCounter(c => c + 1);
          showInAppToast(
            `${count} album(s) deleted`,
            { durationMs: 2000, position: 'bottom' }
          );
        } catch (error) {
          console.error('Failed to delete albums:', error);
          showInAppToast('Delete failed', { durationMs: 2000, position: 'bottom' });
        } finally {
          setIsDeleting(false);
        }
      }
    });
    setConfirmModalVisible(true);
  }, [selectedAlbumPaths, albumPath.length, deleteAlbumWithAllImages]);

  const sanitizeFolderName = (s) => {
    if (!s || typeof s !== 'string') return '';
    return s.replace(/[\s/\\:*?"<>|]/g, '_').replace(/_+/g, '_').trim().slice(0, 80);
  };

  const loadAlbumContent = useCallback(async (path, isSilent = false) => {
    try {
      if (!isSilent) setIsLoading(true);
      const base = getBasePath();
      const currentDir = path.length === 0 ? base : `${base}/${path.join('/')}`;
      const exists = await RNFS.exists(currentDir);
      if (!exists) {
        setAlbumItems([]);
        setCapturedPhotos([]);
        if (!isSilent) setIsLoading(false);
        return;
      }

      let deletedFilesSet = new Set();
      try {
        const j = await AsyncStorage.getItem(DELETED_FILES_KEY);
        if (j) deletedFilesSet = new Set(JSON.parse(j));
      } catch (_) { }

      const statusMap = await ImageDatabase.getUploadStatusMap();
      const enrichFormatted = (formatted) =>
        formatted.map((p) => ({
          ...p,
          uploadStatus: statusMap[(p.absolutePath || p.path.replace('file://', ''))] ?? null,
        }));

      const getAllImageFilesRecursive = async (dirPath) => {
        let results = [];
        try {
          const list = await RNFS.readDir(dirPath);
          for (const item of list) {
            if (item.isDirectory()) {
              results = results.concat(await getAllImageFilesRecursive(item.path));
            } else if (item.isFile() && item.name.match(/\.(jpg|jpeg|png|gif|bmp)$/i) && !item.name.startsWith('compressed_')) {
              results.push({ ...item, directory: dirPath });
            }
          }
        } catch (_) { }
        return results;
      };

      // Returns the single latest image (by mtime) in dir recursively, or null. For album cover.
      const getLatestImageInDir = async (dirPath) => {
        try {
          const files = await getAllImageFilesRecursive(dirPath);
          const valid = files.filter((f) => !deletedFilesSet.has(f.path));
          if (valid.length === 0) return null;
          const latest = valid.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())[0];
          return latest ? { path: `file://${latest.path}` } : null;
        } catch (_) {
          return null;
        }
      };

      const formatPhoto = (file) => {
        const segments = (file.directory || '').split('/').filter(Boolean);
        const patientFolder = segments.length > 0 ? segments[segments.length - 1] : '';
        const clinicianFolder = segments.length > 1 ? segments[segments.length - 2] : '';
        return {
          id: `${file.path}_${file.mtime}`,
          path: `file://${file.path}`,
          timestamp: new Date(file.mtime),
          name: file.name,
          mtime: file.mtime,
          directory: file.directory,
          absolutePath: file.path,
          patientFolder,
          clinicianFolder,
        };
      };

      const enrichWithAsyncStorage = async (photos) => {
        const enriched = enrichFormatted(photos);
        return await Promise.all(enriched.map(async (p) => {
          if (p.uploadStatus === 'UPLOADED') return p;
          try {
            const cleanPath = (p.absolutePath || p.path.replace('file://', ''));
            const status = await AsyncStorage.getItem(`uploaded_${cleanPath}`);
            if (status === 'true') return { ...p, uploadStatus: 'UPLOADED' };
          } catch (_) { }
          return p;
        }));
      };

      if (path.length === 0) {
        const list = await RNFS.readDir(currentDir);
        const dirs = list.filter((i) => i.isDirectory());
        if (dirs.length > 0) {
          const items = await Promise.all(
            dirs.map(async (d) => {
              let idLabel = d.name;
              let nameLabel = '';
              if (d.name.includes('__')) {
                const [idPart, namePart] = d.name.split('__');
                idLabel = idPart || d.name;
                nameLabel = namePart ? namePart.replace(/_/g, ' ') : '';
              }
              const cover = await getLatestImageInDir(d.path);
              return { id: d.name, idLabel, nameLabel, count: 0, cover, type: 'album' };
            })
          );
          setAlbumItems(items.sort((a, b) => (a.nameLabel || a.idLabel).localeCompare(b.nameLabel || b.idLabel)));
          setCapturedPhotos([]);
        } else {
          // No subfolders (e.g. guest DCIM/Guest): show all photos at root
          const files = await getAllImageFilesRecursive(currentDir);
          const filtered = files.filter((f) => !deletedFilesSet.has(f.path));
          const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
          const formatted = [];
          for (const file of sorted) {
            try {
              if (await RNFS.exists(file.path)) formatted.push(formatPhoto(file));
            } catch (_) { }
          }
          setAlbumItems([]);
          setCapturedPhotos(await enrichWithAsyncStorage(formatted));
        }
        if (!isSilent) setIsLoading(false);
        return;
      }

      if (path.length === 1) {
        const list = await RNFS.readDir(currentDir);
        const subdirs = list.filter((i) => i.isDirectory());
        const yearDirs = subdirs.filter((d) => /^\d{4}$/.test(d.name));
        if (yearDirs.length > 0) {
          const sortedYears = yearDirs.sort((a, b) => b.name.localeCompare(a.name));
          const items = await Promise.all(
            sortedYears.map(async (d) => {
              const cover = await getLatestImageInDir(d.path);
              return {
                id: d.name,
                idLabel: d.name,
                nameLabel: d.name,
                count: 0,
                cover,
                type: 'year',
              };
            })
          );
          setAlbumItems(items);
          setCapturedPhotos([]);
        } else {
          const files = await getAllImageFilesRecursive(currentDir);
          const filtered = files.filter((f) => !deletedFilesSet.has(f.path));
          const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
          const formatted = [];
          for (const file of sorted) {
            try {
              if (await RNFS.exists(file.path)) formatted.push(formatPhoto(file));
            } catch (_) { }
          }
          setAlbumItems([]);
          setCapturedPhotos(await enrichWithAsyncStorage(formatted));
        }
        if (!isSilent) setIsLoading(false);
        return;
      }

      if (path.length === 2) {
        const list = await RNFS.readDir(currentDir);
        const dirs = list.filter((i) => i.isDirectory());
        const items = await Promise.all(
          dirs.map(async (d) => {
            const isDateFolder = /^\d{2}-\d{2}-\d{4}$/.test(d.name);
            const isMonthFolder = /^\d{2}$/.test(d.name);
            let label = d.name;
            let type = isDateFolder ? 'date' : (isMonthFolder ? 'month' : 'folder');

            if (isMonthFolder) {
              const num = parseInt(d.name, 10);
              label = num >= 1 && num <= 12 ? MONTH_NAMES[num] : d.name;
            }
            const cover = await getLatestImageInDir(d.path);
            return { id: d.name, idLabel: d.name, nameLabel: label, count: 0, cover, type };
          })
        );
        setAlbumItems(
          items.sort((a, b) => {
            if (a.type === 'date' && b.type === 'date') {
              try {
                const [da, ma, ya] = a.id.split('-').map(Number);
                const [db, mb, yb] = b.id.split('-').map(Number);
                return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
              } catch (_) { }
            }
            return b.id.localeCompare(a.id);
          })
        );
        setCapturedPhotos([]);
        if (!isSilent) setIsLoading(false);
        return;
      }

      if (path.length === 3) {
        const list = await RNFS.readDir(currentDir);
        const imageFiles = list.filter(
          (i) => i.isFile() && i.name.match(/\.(jpg|jpeg|png|gif|bmp)$/i) && !i.name.startsWith('compressed_')
        );

        if (imageFiles.length > 0) {
          const filtered = imageFiles.filter((f) => !deletedFilesSet.has(f.path));
          const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
          const formatted = [];
          for (const file of sorted) {
            try {
              if (await RNFS.exists(file.path)) formatted.push(formatPhoto({ ...file, directory: currentDir }));
            } catch (_) { }
          }
          setAlbumItems([]);
          setCapturedPhotos(await enrichWithAsyncStorage(formatted));
        } else {
          const dirs = list.filter((i) => i.isDirectory());
          const items = await Promise.all(
            dirs.map(async (d) => {
              const cover = await getLatestImageInDir(d.path);
              return {
                id: d.name,
                idLabel: d.name,
                nameLabel: d.name.startsWith('W') ? `Week ${d.name.slice(1)}` : d.name,
                count: 0,
                cover,
                type: 'week',
              };
            })
          );
          setAlbumItems(items.sort((a, b) => a.id.localeCompare(b.id)));
          setCapturedPhotos([]);
        }
        if (!isSilent) setIsLoading(false);
        return;
      }

      if (path.length === 4) {
        const list = await RNFS.readDir(currentDir);
        const imageFiles = list.filter(
          (i) => i.isFile() && i.name.match(/\.(jpg|jpeg|png|gif|bmp)$/i) && !i.name.startsWith('compressed_')
        );
        const filtered = imageFiles.filter((f) => !deletedFilesSet.has(f.path));
        const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
        const formatted = [];
        for (const file of sorted) {
          try {
            if (await RNFS.exists(file.path)) formatted.push(formatPhoto({ ...file, directory: currentDir }));
          } catch (_) { }
        }
        setAlbumItems([]);
        setCapturedPhotos(await enrichWithAsyncStorage(formatted));
      }

      if (!isSilent) setIsLoading(false);
    } catch (error) {
      console.error('Failed to load album:', error);
      setAlbumItems([]);
      setCapturedPhotos([]);
      if (!isSilent) setIsLoading(false);
      showInAppToast('Failed to load gallery', { durationMs: 2000, position: 'bottom' });
    }
  }, [getBasePath]);

  const loadImages = useCallback(async (isSilent = false) => {
    const granted = await requestStoragePermissionForGallery(require('react-native').PermissionsAndroid);
    if (!granted) {
      showInAppToast('Storage permission required to load gallery', { durationMs: 3500, position: 'bottom' });
      if (!isSilent) setIsLoading(false);
      return;
    }
    loadAlbumContent(albumPath, isSilent);
  }, [albumPath, loadAlbumContent]);

  useEffect(() => {
    loadImages(forceRefreshCounter > 0);
  }, [loadImages, forceRefreshCounter]);

  useFocusEffect(
    useCallback(() => {
      loadImages(true);
    }, [loadImages])
  );

  // Selection handlers
  const togglePhotoSelection = useCallback((photoId) => {
    setSelectedPhotos(prev => {
      const newSelection = prev.includes(photoId)
        ? prev.filter(id => id !== photoId)
        : [...prev, photoId];

      if (newSelection.length === 0) {
        setIsSelectionMode(false);
      }
      return newSelection;
    });
  }, []);

  const handlePhotoPress = useCallback((photo) => {
    if (isSelectionMode) {
      togglePhotoSelection(photo.path);
    } else {
      setFullScreenPhoto(photo);
    }
  }, [isSelectionMode, togglePhotoSelection]);

  const handlePhotoLongPress = useCallback((photoId) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
    }
    togglePhotoSelection(photoId);
  }, [isSelectionMode, togglePhotoSelection]);

  // Delete single image
  const handleDeleteCurrentImage = useCallback(async (photoObj) => {
    const targetPhoto = photoObj && photoObj.path ? photoObj : fullScreenPhoto;
    if (!targetPhoto) return;

    setConfirmConfig({
      title: "Delete Image",
      message: "Delete this image permanently?",
      confirmText: "Delete",
      cancelText: "Cancel",
      isDestructive: true,
      onConfirm: async () => {
        try {
          setIsDeleting(true);
          await deleteFileWithCleanup(targetPhoto.path);

          // Remove the deleted photo from local state — no full gallery reload needed
          setCapturedPhotos(prev => {
            const nextPhotos = prev.filter(img => img.path !== targetPhoto.path);
            if (nextPhotos.length === 0) setFullScreenPhoto(null);
            return nextPhotos;
          });

          showInAppToast(
            "Image deleted!",
            { durationMs: 2000, position: 'bottom' }
          );
        } catch (error) {
          console.error('Failed to delete image:', error);
          showInAppToast(
            "Delete failed!",
            { durationMs: 2000, position: 'bottom' }
          );
        } finally {
          setIsDeleting(false);
        }
      }
    });
    setConfirmModalVisible(true);
  }, [fullScreenPhoto, deleteFileWithCleanup]);

  // Delete multiple images
  const handleDeleteSelected = useCallback(() => {
    if (selectedPhotos.length === 0) {
      showInAppToast(
        "No images selected!",
        { durationMs: 2000, position: 'bottom' }
      );
      return;
    }

    setConfirmConfig({
      title: "Delete Images",
      message: `Delete ${selectedPhotos.length} image(s) permanently?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      isDestructive: true,
      onConfirm: async () => {
        try {
          setIsDeleting(true);
          const deletedPaths = [];

          for (const path of selectedPhotos) {
            try {
              await deleteFileWithCleanup(path);
              deletedPaths.push(path);
            } catch (error) {
              console.error(`Failed to delete ${path}:`, error);
            }
          }

          // Remove deleted photos from local state — no full gallery reload needed
          setCapturedPhotos(prev => {
            const nextPhotos = prev.filter(img => !deletedPaths.includes(img.path));
            if (nextPhotos.length === 0) setFullScreenPhoto(null);
            return nextPhotos;
          });
          setSelectedPhotos([]);
          setIsSelectionMode(false);

          showInAppToast(
            `${deletedPaths.length} image(s) deleted!`,
            { durationMs: 2000, position: 'bottom' }
          );
        } catch (error) {
          console.error("Failed to delete images:", error);
          showInAppToast(
            "Delete failed!",
            { durationMs: 2000, position: 'bottom' }
          );
        } finally {
          setIsDeleting(false);
        }
      }
    });
    setConfirmModalVisible(true);
  }, [selectedPhotos, fullScreenPhoto, deleteFileWithCleanup]);

  const getShareLabel = useCallback((photo) => {
    if (!photo || !photo.name) return '';
    let patientText = '';
    let bodyPartText = '';

    const bpIndex = photo.name.indexOf('_BP-');
    if (bpIndex !== -1) {
      if (bpIndex > 9) {
        patientText = photo.name.substring(10, bpIndex);
      }
      const matchBody = photo.name.match(/_BP-(.*?)_\d+_\d+\.jpg/);
      if (matchBody) {
        bodyPartText = matchBody[1].replace(/_/g, ' ');
      }
    } else {
      const matchPatientNoBody = photo.name.match(/^Cutiscope_(.*?)_\d{8}_\d{6}\.jpg/);
      if (matchPatientNoBody) {
        patientText = matchPatientNoBody[1];
      }
    }

    const label = [patientText, bodyPartText].filter(Boolean).join(' | ');
    return label;
  }, []);

  const handleBluetoothShareSelected = useCallback(() => {
    if (selectedPhotos.length === 0) {
      showInAppToast("No images selected!", { durationMs: 2000, position: 'bottom' });
      return;
    }

    const labels = selectedPhotos.map(path => {
      const photo = activePhotos.find(p => p.path === path || p.absolutePath === path.replace('file://', ''));
      return photo ? getShareLabel(photo) : '';
    });

    setBluetoothShareFiles(selectedPhotos);
    setBluetoothShareLabels(labels);
    setBluetoothShareVisible(true);
  }, [selectedPhotos, activePhotos, getShareLabel]);

  // Core upload logic – uses image record when available so upload always goes to correct patient
  const uploadImageToAWS = useCallback(async (filePath, fileName) => {
    const cleanPath = filePath.replace('file://', '');

    if (isGuest) {
      throw new Error('Sign in to upload');
    }

    // 防御性的重复上传检查 (AsyncStorage + Database)
    try {
      const isUploadedAsync = await AsyncStorage.getItem(`uploaded_${cleanPath}`);
      if (isUploadedAsync === 'true') {
        console.log('Skipping upload, already uploaded (AsyncStorage)');
        return;
      }
    } catch (_) { }

    const netInfo = await NetInfo.fetch();
    const hasInternet = netInfo.isConnected && (netInfo.type === 'wifi' || netInfo.type === 'cellular');
    if (!hasInternet) {
      throw new Error('No internet');
    }

    const image = await ImageDatabase.getImageByFilePath(cleanPath);
    if (image) {
      if (image.uploadStatus === 'UPLOADED') {
        console.log('Skipping upload, already uploaded (Database)');
        await AsyncStorage.setItem(`uploaded_${cleanPath}`, 'true');
        return;
      }
      const result = await uploadWithImageRecord(cleanPath, image);
      await ImageDatabase.updateUploadStatus(image.id, ImageDatabase.UPLOAD_STATUS.UPLOADED, result?.url);
      await AsyncStorage.setItem(`uploaded_${cleanPath}`, 'true');
      return;
    }

    // Legacy: no image record (e.g. old file) – use current selected patient
    const username = getUsername();
    let patientFolder = null;
    try {
      const boxSaved = await AsyncStorage.getItem('@patient_box');
      if (boxSaved) {
        const box = JSON.parse(boxSaved);
        if (box?.id || box?.name) patientFolder = box.id || box.name;
      }
    } catch (_) { }
    await uploadToUserS3Folder(cleanPath, fileName, username, {}, patientFolder);
    await AsyncStorage.setItem(`uploaded_${cleanPath}`, 'true');
  }, [isGuest, getUsername]);

  // Legacy: upload to Google Drive (kept for compatibility)
  const uploadImageToDrive = useCallback(async (filePath, fileName) => {
    const cleanPath = filePath.replace('file://', '');

    if (isGuest) {
      const fileExists = await RNFS.exists(cleanPath);
      if (!fileExists) throw new Error('File not found');
      showInAppToast(
        'Image saved locally (Guest Mode)',
        { durationMs: 2000, position: 'bottom' }
      );
      return;
    }

    const netInfo = await NetInfo.fetch();
    const hasInternet = netInfo.isConnected && (netInfo.type === 'wifi' || netInfo.type === 'cellular');

    if (!hasInternet) {
      throw new Error('No internet');
    }

    const accessToken = await firebaseAuthService.getValidAccessToken();
    if (accessToken) {
      const photoUri = `file://${cleanPath}`;
      await googleDriveService.uploadPhotoToDrive(accessToken, photoUri, fileName);
      await AsyncStorage.setItem(`uploaded_${cleanPath}`, 'true');
    } else {
      await AsyncStorage.setItem(`uploaded_${cleanPath}`, 'pending');
      throw new Error('No Google account');
    }
  }, [isGuest]);

  // Single image upload handler (called from fullscreen view) – upload to AWS
  const handleUploadImage = useCallback(async (filePath, fileName) => {
    try {
      const cleanPath = filePath.replace('file://', '');
      if (isGuest) throw new Error('Sign in to upload');

      // 1. Check for internet connectivity
      const netInfo = await NetInfo.fetch();
      const hasInternet = netInfo.isConnected && (netInfo.type === 'wifi' || netInfo.type === 'cellular');
      if (!hasInternet) {
        return false; // Return false to indicate network failure
      }

      // 2. Check if already in queue
      if (OptimisedUploadService.isImageInQueue(cleanPath)) {
        showInAppToast('Already in upload queue', { position: 'bottom', durationMs: 1500 });
        return;
      }

      showInAppToast('Enqueued for upload', { position: 'bottom', durationMs: 1200 });

      // 3. Update local state to UPLOADING instantly
      setCapturedPhotos((prev) => prev.map((p) =>
      ((p.absolutePath || p.path?.replace('file://', '')) === cleanPath
        ? { ...p, uploadStatus: 'UPLOADING' }
        : p
      )
      ));

      const username = getUsername();
      const image = await ImageDatabase.getImageByFilePath(cleanPath);

      let patientFolder = null;
      if (!image) {
        try {
          const boxSaved = await AsyncStorage.getItem('@patient_box');
          if (boxSaved) {
            const box = JSON.parse(boxSaved);
            if (box?.id || box?.name) patientFolder = box.id || box.name;
          }
        } catch (_) { }
      }

      setCapturedPhotos((prev) => prev.map((p) =>
      ((p.absolutePath || p.path?.replace('file://', '')) === cleanPath
        ? { ...p, uploadStatus: 'PENDING' }
        : p
      )
      ));

      let uploadPath = cleanPath;
      const label = image ? getShareLabel(image) : '';
      if (label) {
        try {
          const watermarkedPath = await NativeModules.SystemTimeModule.getWatermarkedImage(cleanPath, label);
          if (watermarkedPath) {
            uploadPath = watermarkedPath;
          }
        } catch (err) {
          console.warn('Watermarking failed for upload, using original:', err);
        }
      }

      OptimisedUploadService.enqueueExistingFileUpload(uploadPath, fileName, username, {
        source: 'gallery',
        imageId: image?.id,
        patientFolder,
        isTemp: uploadPath !== cleanPath,
      });

    } catch (error) {
      showInAppToast(error.message || 'Upload failed', { durationMs: 2000, position: 'center' });
    }
  }, [isGuest, getUsername]);

  const handleUploadSelectedImages = useCallback(async () => {
    if (selectedPhotos.length === 0) {
      showInAppToast(
        'No images selected!', { durationMs: 2000, position: 'center' }
      );
      return;
    }

    const netInfo = await NetInfo.fetch();
    const hasInternet = netInfo.isConnected && (netInfo.type === 'wifi' || netInfo.type === 'cellular');

    if (!hasInternet) {
      showInAppToast('no internet connect to internet', { position: 'bottom', durationMs: 2000 });
      return;
    }

    setConfirmConfig({
      title: 'Upload to Cloud',
      message: `Upload ${selectedPhotos.length} image(s) to Cloud?`,
      confirmText: 'Upload',
      cancelText: 'Cancel',
      isDestructive: false,
      onConfirm: async () => {
        try {
          // Pre-filter: identify which ones ACTUALLY need uploading
          const needingUpload = [];
          let skippedCount = 0;
          for (const path of selectedPhotos) {
            const cleanPath = path.replace('file://', '');

            // 1. Check AsyncStorage (legacy)
            try {
              const status = await AsyncStorage.getItem(`uploaded_${cleanPath}`);
              if (status === 'true') continue;
            } catch (_) { }

            // 2. Check Database / Component State
            const photo = activePhotos.find(p => p.path === path || (p.absolutePath || p.path?.replace('file://', '')) === cleanPath);
            if (photo && photo.uploadStatus === 'UPLOADED') continue;

            // 3. Check if already in queue
            if (OptimisedUploadService.isImageInQueue(cleanPath)) {
              skippedCount++;
              continue;
            }

            needingUpload.push({ path, fileName: path.substring(path.lastIndexOf('/') + 1) });
          }

          if (needingUpload.length === 0) {
            setSelectedPhotos([]);
            setIsSelectionMode(false);
            if (skippedCount > 0) {
              showInAppToast(`${skippedCount} image(s) already in queue`, { position: 'bottom', durationMs: 2000 });
            } else {
              showInAppToast('Already Uploaded', { position: 'bottom', durationMs: 1200 });
            }
            return;
          }

          const username = getUsername();

          // Get patient box once for legacy items
          let globalPatientFolder = null;
          try {
            const boxSaved = await AsyncStorage.getItem('@patient_box');
            if (boxSaved) {
              const box = JSON.parse(boxSaved);
              if (box?.id || box?.name) globalPatientFolder = box.id || box.name;
            }
          } catch (_) { }

          // Enqueue all selected photos
          // 4. Update local state to UPLOADING instantly
          const needingPaths = needingUpload.map(n => n.path);
          setCapturedPhotos((prev) => prev.map((p) =>
            needingPaths.includes(p.path) || needingPaths.includes(p.absolutePath)
              ? { ...p, uploadStatus: 'UPLOADING' }
              : p
          ));

          for (const item of needingUpload) {
            const cleanPath = item.path.replace('file://', '');
            const image = await ImageDatabase.getImageByFilePath(cleanPath);

            const label = image ? getShareLabel(image) : '';
            let uploadPath = cleanPath;
            if (label) {
              try {
                const watermarkedPath = await NativeModules.SystemTimeModule.getWatermarkedImage(cleanPath, label);
                if (watermarkedPath) {
                  uploadPath = watermarkedPath;
                }
              } catch (err) {
                console.warn('Watermarking failed for multi-upload, using original:', err);
              }
            }

            OptimisedUploadService.enqueueExistingFileUpload(uploadPath, item.fileName, username, {
              source: 'gallery',
              imageId: image?.id,
              patientFolder: image ? null : globalPatientFolder,
              isTemp: uploadPath !== cleanPath,
            });
          }

          if (skippedCount > 0) {
            showInAppToast(`Enqueued ${needingUpload.length} uploads (${skippedCount} already in queue)`, { position: 'bottom', durationMs: 2000 });
          } else {
            showInAppToast(`Enqueued ${needingUpload.length} uploads`, { position: 'bottom', durationMs: 1500 });
          }
          setSelectedPhotos([]);
          setIsSelectionMode(false);
        } catch (error) {
          showInAppToast('Failed to enqueue', { durationMs: 2000, position: 'center' });
        }
      }
    });
    setConfirmModalVisible(true);
  }, [selectedPhotos, activePhotos, getUsername]);

  // Select all handler
  const handleSelectAll = useCallback(() => {
    if (selectedPhotos.length === activePhotos.length && activePhotos.length > 0) {
      setSelectedPhotos([]);
      setIsSelectionMode(false);
    } else {
      const allPhotoPaths = activePhotos.map(img => img.path);
      setSelectedPhotos(allPhotoPaths);
      setIsSelectionMode(true);
    }
  }, [selectedPhotos.length, activePhotos]);

  // Clear deleted files (for debugging)
  const clearDeletedFilesList = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(DELETED_FILES_KEY);
      setDeletedFiles(new Set());
      showInAppToast(
        "Deleted files list cleared",
        { durationMs: 2000, position: 'bottom' }
      );
      setForceRefreshCounter(prev => prev + 1);
    } catch (error) {
      console.log('Error clearing deleted files list:', error);
    }
  }, []);

  // Optimized render functions
  const renderPhotoItem = useCallback(({ item: photo }) => (
    <ThumbnailItem
      photo={photo}
      isSelected={selectedPhotos.includes(photo.path)}
      isSelectionMode={isSelectionMode}
      isGuest={isGuest}
      onPress={handlePhotoPress}
      onLongPress={handlePhotoLongPress}
    />
  ), [selectedPhotos, isSelectionMode, isGuest, handlePhotoPress, handlePhotoLongPress]);

  const activePhotos = useMemo(() => capturedPhotos, [capturedPhotos]);
  const isPhotoLevel = activePhotos.length > 0;
  const isFolderLevel = albumItems.length > 0 && !isPhotoLevel;

  const canUploadSelection = useMemo(() => {
    if (selectedPhotos.length === 0) return false;
    return selectedPhotos.every(path => {
      const cleanPath = path.replace('file://', '');
      const photo = activePhotos.find(p => p.path === path || (p.absolutePath || p.path?.replace('file://', '')) === cleanPath);
      return photo && photo.uploadStatus !== 'UPLOADED';
    });
  }, [selectedPhotos, activePhotos]);

  // Initial index for full-screen viewer: derive from clicked photo so we always open on the image that was tapped
  const fullScreenInitialIndex = useMemo(() => {
    if (!fullScreenPhoto || activePhotos.length === 0) return 0;
    let i = activePhotos.findIndex((p) => p.id === fullScreenPhoto.id);
    if (i === -1) i = activePhotos.findIndex((p) => p.path === fullScreenPhoto.path);
    return i >= 0 ? i : 0;
  }, [fullScreenPhoto, activePhotos]);

  // Memoized image URLs for ImageViewer - include width/height so viewer skips async getSize and switching is instant
  const fullScreenImageUrls = useMemo(
    () =>
      activePhotos.map((photo) => ({
        url: photo.path,
        width: width,
        height: screenHeight,
        props: {
          source: { uri: photo.path },
          fadeDuration: 0,
          resizeMode: 'contain',
        },
      })),
    [activePhotos, width, screenHeight]
  );

  // Key extractor for FlatList
  const keyExtractor = useCallback((item) => item.id, []);

  const renderFolderItem = useCallback(
    ({ item }) => {
      const coverUri = item.cover?.path;
      const pathKey = albumPath.length === 0 ? item.id : [...albumPath, item.id].join('/');
      const isSelected = selectedAlbumPaths.includes(pathKey);
      return (
        <TouchableOpacity
          style={[styles.folderTile, isSelectionMode && isSelected && styles.folderTileSelected]}
          onPress={() => {
            if (isSelectionMode) {
              toggleAlbumSelection(pathKey);
            } else {
              setAlbumPath((prev) => [...prev, item.id]);
              setIsSelectionMode(false);
              setSelectedPhotos([]);
              setSelectedAlbumPaths([]);
            }
          }}
          onLongPress={() => {
            if (isGuest) return; // Disable selection mode for guests
            if (!isSelectionMode) {
              setIsSelectionMode(true);
              setSelectedAlbumPaths([pathKey]);
            } else {
              toggleAlbumSelection(pathKey);
            }
          }}
          delayLongPress={300}
          activeOpacity={0.7}
        >
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.folderImage} resizeMode="cover" />
          ) : (
            <View style={[styles.folderImage, styles.folderPlaceholder]} />
          )}
          {isSelectionMode && isSelected && (
            <View style={styles.folderSelectedOverlay}>
              <Text style={styles.folderSelectedText}>✓</Text>
            </View>
          )}
          <Text style={styles.folderName} numberOfLines={1}>
            {item.nameLabel || item.idLabel}
          </Text>
          <Text style={styles.folderCount}>{item.count > 0 ? `${item.count} photos` : ''}</Text>
        </TouchableOpacity>
      );
    },
    [albumPath, isSelectionMode, selectedAlbumPaths, toggleAlbumSelection]
  );

  // if (isDeleting) {
  //   return <DeletionLoader />;
  // }

  // if (isUploading) {
  //   return <UploadAnimation progress={uploadProgress} total={uploadTotal} />;
  // }

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* <CustomStatusBar /> */}

      <View
        style={styles.container}
        onStartShouldSetResponder={() => {
          DeviceEventEmitter.emit('userActivity');
          return false;
        }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButtonContainer}
            onPress={handleBackPress}
            activeOpacity={0.7}
          >
            <Image source={backIcon} style={styles.backButtonIcon} />
          </TouchableOpacity>

          <View style={[
            styles.titleContainer,
            {
              left: 75,
              right: isSelectionMode ? 125 : 75
            }
          ]}>
            <Text
              style={styles.galleryTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {albumPath.length === 0
                ? 'Gallery'
                : isSelectionMode && activePhotos.length > 0
                  ? `Photos (${selectedPhotos.length} selected)`
                  : isSelectionMode && isFolderLevel
                    ? `Albums (${selectedAlbumPaths.length} selected)`
                    : (() => {
                      const lastId = albumPath[albumPath.length - 1];
                      const item = albumItems.find((f) => f.id === lastId);
                      if (item) return item.nameLabel || item.idLabel;
                      if (lastId && lastId.startsWith('W')) return `Week ${lastId.slice(1)}`;
                      return lastId || 'Gallery';
                    })()}
            </Text>
          </View>

          {isSelectionMode && isPhotoLevel && activePhotos.length > 0 && (
            <TouchableOpacity
              style={[
                styles.selectAllButton,
                selectedPhotos.length === activePhotos.length && styles.unselectAllButton
              ]}
              onPress={handleSelectAll}
            >
              <Text style={styles.selectAllText}>
                {selectedPhotos.length === activePhotos.length ? 'Unselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          )}
          {isSelectionMode && isFolderLevel && albumItems.length > 0 && (
            <TouchableOpacity
              style={[
                styles.selectAllButton,
                selectedAlbumPaths.length === albumItems.length && styles.unselectAllButton
              ]}
              onPress={handleSelectAllAlbums}
            >
              <Text style={styles.selectAllText}>
                {selectedAlbumPaths.length === albumItems.length ? 'Unselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {isGuest && albumPath.length === 0 && (
          <View style={styles.guestHintBanner}>
            <Text style={styles.guestHintText} selectable={false}>
              Temporary storage. Photos will be deleted when you exit guest mode.
            </Text>
          </View>
        )}

        {/* Folder grid or photos grid */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={ACCENT_TEAL} />
            <Text style={styles.loadingText}>Loading Images...</Text>
          </View>
        ) : !isFolderLevel && !isPhotoLevel ? (
          <View style={styles.emptyMemories}>
            <Text style={styles.emptyMemoriesText}>
              {isGuest ? 'No photos in guest mode' : 'No photos found'}
            </Text>
            <Text style={styles.emptyMemoriesSubText}>
              {isGuest
                ? 'Capture images to get started. They will be removed when you exit guest mode.'
                : 'Images will appear here from your camera gallery'}
            </Text>
          </View>
        ) : isFolderLevel ? (
          <FlatList
            key={`folders_grid_${isSelectionMode}_${selectedAlbumPaths.length}`}
            data={albumItems}
            renderItem={renderFolderItem}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={[
              styles.foldersContainer,
              isSelectionMode && selectedAlbumPaths.length > 0 && { paddingBottom: 100 }
            ]}
            columnWrapperStyle={styles.folderRow}
            showsVerticalScrollIndicator={false}
            extraData={[selectedAlbumPaths, isSelectionMode, albumItems]}
          />
        ) : (
          <FlatList
            key="photos_grid"
            data={activePhotos}
            renderItem={renderPhotoItem}
            keyExtractor={keyExtractor}
            numColumns={3}
            contentContainerStyle={[
              styles.photosContainer,
              isSelectionMode && selectedPhotos.length > 0 && { paddingBottom: 100 }
            ]}
            showsVerticalScrollIndicator={false}
            initialNumToRender={12}
            maxToRenderPerBatch={6}
            windowSize={7}
            removeClippedSubviews={false}
            extraData={[selectedPhotos, isSelectionMode, activePhotos]}
          />
        )}

        {/* Full Screen Gallery Modal */}
        <FullScreenGalleryModal
          visible={!!fullScreenPhoto}
          photos={activePhotos}
          imageUrls={fullScreenImageUrls}
          initialIndex={fullScreenInitialIndex}
          onClose={() => setFullScreenPhoto(null)}
          onDelete={handleDeleteCurrentImage}
          onUpload={handleUploadImage}
          isGuest={isGuest}
          getShareLabel={getShareLabel}
          onBluetoothShare={(photo) => {
            const label = getShareLabel ? getShareLabel(photo) : '';
            setBluetoothShareFiles([photo.path]);
            setBluetoothShareLabels([label]);
            setBluetoothShareVisible(true);
          }}
        />

        {/* Bottom Action Bar - Photo selection */}
        {isSelectionMode && selectedPhotos.length > 0 && (
          <View style={styles.actionContainer}>
            {!isGuest && canUploadSelection && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleUploadSelectedImages}
              >
                <Image source={uploadIcon} style={[styles.actionIcon, { tintColor: ACCENT_TEAL }]} />
                <Text style={styles.btnText}>Upload</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleDeleteSelected}
            >
              <Image source={deleteIcon} style={[styles.actionIcon, { tintColor: ACCENT_TEAL }]} />
              <Text style={styles.btnText}>Delete</Text>
            </TouchableOpacity>

            {/* Bluetooth Share Selected Button */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleBluetoothShareSelected}
            >
              <MaterialCommunityIcons name="bluetooth" size={30} color={ACCENT_TEAL} style={{ marginBottom: 4 }} />
              <Text style={styles.btnText}>Share</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Bottom Action Bar - Album selection (delete album and all images inside) */}
        {isSelectionMode && selectedAlbumPaths.length > 0 && (
          <View style={styles.actionContainer}>
            {!isGuest && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={handleDeleteSelectedAlbums}
              >
                <Image source={deleteIcon} style={[styles.actionIcon, { tintColor: ACCENT_TEAL }]} />
                <Text style={styles.btnText}>
                  Delete {selectedAlbumPaths.length} Album(s)
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <ConfirmationModal
          visible={confirmModalVisible}
          onClose={() => setConfirmModalVisible(false)}
          title={confirmConfig.title}
          message={confirmConfig.message}
          confirmText={confirmConfig.confirmText}
          cancelText={confirmConfig.cancelText}
          isDestructive={confirmConfig.isDestructive}
          onConfirm={() => {
            confirmConfig.onConfirm();
            setConfirmModalVisible(false);
          }}
        />

        <BluetoothShareModal
          visible={bluetoothShareVisible}
          onClose={() => setBluetoothShareVisible(false)}
          selectedFiles={bluetoothShareFiles}
          selectedLabels={bluetoothShareLabels}
          onShareSuccess={handleBluetoothShareSuccess}
        />
      </View>

      {/* Deletion Modal — self-contained full-screen loader */}
      <DeletionLoader visible={isDeleting} />

      {isUploading && (
        <View style={styles.fullScreenLoaderOverlay} pointerEvents="box-only">
          <UploadAnimation progress={uploadProgress} total={uploadTotal} />
        </View>
      )}
    </GestureHandlerRootView>
  );
};

const FullScreenGalleryModal = React.memo(({
  visible,
  photos,
  imageUrls,
  initialIndex,
  onClose,
  onDelete,
  onUpload,
  isGuest,
  getShareLabel,
  onBluetoothShare
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [errorMsg, setErrorMsg] = useState(null);
  const errorTimerRef = useRef(null);
  const flatListRef = useRef(null);
  const currentPhotoIdRef = useRef(photos[initialIndex]?.path);
  const wasVisibleRef = useRef(false);
  const [showOverlays, setShowOverlays] = useState(true);

  // When opened, reset to initial
  useEffect(() => {
    if (visible && !wasVisibleRef.current && photos.length > 0) {
      setCurrentIndex(initialIndex);
      currentPhotoIdRef.current = photos[initialIndex]?.path;
      setShowOverlays(true);
      // Scroll to the initial index, if flatList is mounted
      setTimeout(() => {
        if (flatListRef.current && photos.length > initialIndex) {
          try {
            flatListRef.current.scrollToIndex({ index: initialIndex, animated: false });
          } catch (e) { }
        }
      }, 50);
    }
    wasVisibleRef.current = visible;
  }, [visible, initialIndex]);

  // Handle deletion sync robustly
  useEffect(() => {
    if (!visible || photos.length === 0) return;

    const targetId = currentPhotoIdRef.current;
    if (!targetId) return;

    const newIndex = photos.findIndex(p => p.path === targetId);

    if (newIndex !== -1) {
      // The currently viewed item still exists. It might have shifted index.
      if (newIndex !== currentIndex) {
        setCurrentIndex(newIndex);
      }
    } else {
      // The currently viewed item WAS DELETED.
      // Show the NEXT image instead of PREV to prevent the instant flash, since arrays naturally shift left.
      const fallbackIndex = Math.min(currentIndex, photos.length - 1);

      // Update state
      setCurrentIndex(fallbackIndex);
      const nextPhoto = photos[fallbackIndex];
      if (nextPhoto) {
        currentPhotoIdRef.current = nextPhoto.path;
      }

      // Force flatlist to stay at the new index seamlessly
      // Use setTimeout to ensure the FlatList has processed the updated 'data' prop (photos)
      setTimeout(() => {
        if (flatListRef.current && photos.length > fallbackIndex) {
          try {
            flatListRef.current.scrollToIndex({ index: fallbackIndex, animated: false });
          } catch (e) {
            console.warn('scrollToIndex failed in deletion sync:', e);
          }
        }
      }, 0);
    }
  }, [photos, visible]); // intentionally responding to photos array changing

  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      const idx = viewableItems[0].index;
      if (idx !== null && idx >= 0) {
        setCurrentIndex(idx);
        currentPhotoIdRef.current = viewableItems[0].item.path;
      }
    }
  }, []);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 50,
  }).current;

  // Preload adjacent items and clear error on swipe
  useEffect(() => {
    if (photos[currentIndex - 1]) Image.prefetch(photos[currentIndex - 1].path).catch(() => { });
    if (photos[currentIndex + 1]) Image.prefetch(photos[currentIndex + 1].path).catch(() => { });

    // Clear error message when swiping to a new image
    setErrorMsg(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, [currentIndex, photos]);

  const getItemLayout = useCallback((data, index) => (
    { length: width, offset: width * index, index }
  ), []);

  const toggleOverlays = useCallback(() => {
    setShowOverlays(prev => !prev);
  }, []);

  const renderItem = useCallback(({ item }) => (
    <ZoomableImage uri={item.path} onTap={toggleOverlays} />
  ), [toggleOverlays]);

  if (!visible || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex];
  if (!currentPhoto) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      onRequestClose={onClose}
      animationType="fade"
      statusBarTranslucent={true}
    >
      <GestureHandlerRootView style={styles.fullScreenModalBackground}>
        {showOverlays && <CustomStatusBar />}

        <View style={styles.gestureContainer}>
          <FlatList
            ref={flatListRef}
            data={photos}
            keyExtractor={(item) => item.path}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex >= 0 && initialIndex < photos.length ? initialIndex : 0}
            getItemLayout={getItemLayout}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            windowSize={5}
            maxToRenderPerBatch={3}
            initialNumToRender={3}
            removeClippedSubviews={false}
          />
        </View>

        {/* Header (Back button, Date and Index) */}
        {showOverlays && (
          <View style={styles.fullscreenHeader}>
            <TouchableOpacity
              style={styles.backButtonContainer}
              onPress={onClose}
            >
              <Image source={backIcon} style={[styles.backButtonIcon, { tintColor: PRIMARY_TEXT }]} />
            </TouchableOpacity>

            <View style={styles.fullscreenHeaderCenter}>
              <Text style={styles.fullscreenDateText}>
                {currentPhoto.timestamp ? currentPhoto.timestamp.toLocaleString([], {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                }) : ''}
              </Text>
            </View>

            <Text style={styles.fullscreenIndexText}>
              {currentIndex + 1} / {photos.length}
            </Text>
          </View>
        )}

        {/* 
        (() => {
          let patientText = '';
          let bodyPartText = '';
          
          const bpIndex = currentPhoto.name.indexOf('_BP-');
          if (bpIndex !== -1) {
            if (bpIndex > 9) {
              patientText = currentPhoto.name.substring(10, bpIndex);
            }
            const matchBody = currentPhoto.name.match(/_BP-(.*?)_\d+_\d+\.jpg/);
            if (matchBody) {
              bodyPartText = matchBody[1].replace(/_/g, ' ');
            }
          } else {
            const matchPatientNoBody = currentPhoto.name.match(/^Cutiscope_(.*?)_\d{8}_\d{6}\.jpg/);
            if (matchPatientNoBody) {
              patientText = matchPatientNoBody[1];
            }
          }

          if (patientText || bodyPartText) {
            return (
              <View style={{
                position: 'absolute',
                top: '25%',
                width: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                pointerEvents: 'none',
              }}>
                <Text style={{
                  color: '#ffffff',
                  fontSize: 16,
                  fontFamily: 'ProductSans-Regular',
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  paddingHorizontal: 16,
                  paddingVertical: 6,
                  borderRadius: 4,
                  overflow: 'hidden',
                }} numberOfLines={1}>
                  {patientText ? <Text style={{fontFamily: 'ProductSans-Bold'}}>{patientText}</Text> : null}
                  {patientText && bodyPartText ? ' | ' : ''}
                  {bodyPartText ? <Text style={{fontFamily: 'ProductSans-Bold'}}>{bodyPartText}</Text> : null}
                </Text>
              </View>
            );
          }
          return null;
        })()
        */}

        {/* Sub-header (Filename only) - Small, above the image */}
        {showOverlays && (
          <View style={styles.fullscreenMetadataSubHeader}>
            <Text style={styles.fullScreenPhotoNameSmall} numberOfLines={1}>
              {currentPhoto.name}
            </Text>
          </View>
        )}

        {/* Action buttons (Footer Area) */}
        {showOverlays && (
          <View style={styles.actionContainerFull}>
            {/* Status Indicator / Loader */}
            {(currentPhoto.uploadStatus === 'PENDING' || currentPhoto.uploadStatus === 'UPLOADING') ? (
              <View style={styles.loaderContainerFull}>
                <ActivityIndicator size="small" color={ACCENT_TEAL} />
                <Text style={[styles.btnText, { marginLeft: 10 }]}>Uploading...</Text>
              </View>
            ) : (
              <>
                {/* Upload / Retry Button */}
                {!isGuest && currentPhoto.uploadStatus !== 'UPLOADED' && (
                  <TouchableOpacity
                    style={styles.uploadButtonFull}
                    onPress={async () => {
                      const result = await onUpload(currentPhoto.path, currentPhoto.name);
                      if (result === false) {
                        setErrorMsg('No internet connection');
                        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
                        errorTimerRef.current = setTimeout(() => setErrorMsg(null), 3500);
                      } else {
                        setErrorMsg(null);
                      }
                    }}
                  >
                    <Image source={uploadIcon} style={[styles.actionIconFull, { tintColor: ACCENT_TEAL }]} />
                    <Text style={styles.btnText}>
                      {currentPhoto.uploadStatus === 'FAILED' ? 'Retry' : 'Upload'}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Bluetooth Share Button */}
                <TouchableOpacity
                  style={styles.uploadButtonFull}
                  onPress={() => {
                    if (onBluetoothShare) {
                      onBluetoothShare(currentPhoto);
                    }
                  }}
                >
                  <MaterialCommunityIcons name="bluetooth" size={30} color={ACCENT_TEAL} style={{ marginBottom: 4 }} />
                  <Text style={styles.btnText}>Share</Text>
                </TouchableOpacity>

                {/* Delete Button */}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    onDelete(currentPhoto);
                  }}
                >
                  <Image source={deleteIcon} style={[styles.actionIconFull, { tintColor: ACCENT_TEAL }]} />
                  <Text style={styles.btnText}>Delete</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Inline Error Message Overlay */}
        {errorMsg && (
          <View style={styles.inlineErrorContainer}>
            <Text style={styles.inlineErrorText}>{errorMsg}</Text>
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  gestureContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: PRIMARY_BACKGROUND,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 15,
    paddingBottom: 15,
    paddingTop: STATUS_BAR_HEIGHT + EXTRA_HEADER_PADDING,
    backgroundColor: HEADER_FOOTER_BG,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  backButtonContainer: {
    height: 44,
    width: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#41403D',
    borderWidth: 1,
    borderColor: '#333333',
    marginRight: 6,
  },
  backButtonIcon: {
    height: 22,
    width: 22,
    tintColor: '#FFFFFF',
  },
  titleContainer: {
    position: 'absolute',
    top: STATUS_BAR_HEIGHT + EXTRA_HEADER_PADDING,
    left: 0,
    right: 0,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: -1,
  },
  galleryTitle: {
    color: PRIMARY_TEXT,
    fontSize: 26,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 1,
    textAlign: 'center',
    marginRight: 0,
  },
  selectAllButton: {
    marginLeft: 'auto',
    backgroundColor: '#41403D',
    paddingHorizontal: 13,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333333',
  },
  unselectAllButton: {
    backgroundColor: '#333333',
  },
  selectAllText: {
    color: PRIMARY_TEXT,
    fontSize: 11,
    fontWeight: '500',
  },
  emptyMemories: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyMemoriesText: {
    color: PRIMARY_TEXT,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  emptyMemoriesSubText: {
    color: SECONDARY_TEXT,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  guestHintBanner: {
    backgroundColor: 'rgba(34, 178, 166, 0.15)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
  },
  guestHintText: {
    color: SECONDARY_TEXT,
    fontSize: 12,
    textAlign: 'center',
  },
  refreshButton: {
    backgroundColor: ACCENT_TEAL,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  refreshButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  photosContainer: {
    padding: 4,
  },
  foldersContainer: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 14,
    paddingBottom: 24,
  },
  folderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: ALBUM_GAP,
  },
  folderTile: {
    width: ALBUM_CARD_SIZE,
    borderRadius: 12,
    backgroundColor: '#1a1a1a', // Darker background for card prominence
    overflow: 'hidden',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: '#474343ff', // Visible border
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  folderImage: {
    width: ALBUM_CARD_SIZE,
    height: ALBUM_CARD_SIZE,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  folderPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  folderName: {
    color: PRIMARY_TEXT,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 6,
  },
  folderPatientName: {
    color: SECONDARY_TEXT,
    fontSize: 12,
    paddingHorizontal: 12,
  },
  folderCount: {
    color: SECONDARY_TEXT,
    fontSize: 11,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  folderTileSelected: {
    borderWidth: 2,
    borderColor: ACCENT_TEAL,
  },
  folderSelectedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent', // Fully transparent to keep the folder cover 100% visible
    justifyContent: 'center',
    alignItems: 'center',
  },
  folderSelectedText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
    backgroundColor: ACCENT_TEAL,
    width: 44,
    height: 44,
    borderRadius: 22,
    textAlign: 'center',
    lineHeight: 44,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  thumbnailContainer: {
    position: 'relative',
    margin: 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#41403D',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent', // Transparent to keep the photo 100% visible while selected
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
    backgroundColor: ACCENT_TEAL,
    width: 44,
    height: 44,
    borderRadius: 22,
    textAlign: 'center',
    lineHeight: 44,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  photoImageSelected: {
    borderWidth: 3,
    borderColor: ACCENT_TEAL,
  },
  photoTimestamp: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    color: PRIMARY_TEXT,
    fontSize: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
  },
  fullScreenModalBackground: {
    flex: 1,
    backgroundColor: PRIMARY_BACKGROUND,
  },
  fullscreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: HEADER_FOOTER_BG,
    height: 90 + STATUS_BAR_HEIGHT,
    paddingTop: 20 + STATUS_BAR_HEIGHT,
    paddingHorizontal: 15,
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  fullscreenHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 10,
  },
  fullscreenDateText: {
    color: SECONDARY_TEXT,
    fontSize: 15,
    textAlign: 'center',
  },
  fullscreenMetadataSubHeader: {
    position: 'absolute',
    top: 90 + STATUS_BAR_HEIGHT,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 6,
    paddingHorizontal: 15,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
  },
  fullScreenPhotoNameSmall: {
    color: PRIMARY_TEXT,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    textAlign: 'center',
  },
  fullScreenDateSmall: {
    color: SECONDARY_TEXT,
    fontSize: 11,
  },
  fullscreenIndexText: {
    color: PRIMARY_TEXT,
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 'auto',
  },
  actionContainerFull: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    height: 90,
    zIndex: 11,
  },
  uploadButtonFull: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconFull: {
    width: 28,
    height: 28,
    marginBottom: 4,
  },
  footerBtnText: {
    color: PRIMARY_TEXT,
    fontSize: 12,
    fontWeight: '500',
  },
  inlineErrorContainer: {
    position: 'absolute',
    bottom: 100, // Just above the footer
    left: 20,
    right: 20,
    backgroundColor: 'rgba(211, 47, 47, 0.9)', // Professional dark red/amber
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  inlineErrorText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'space-around',
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 20,
    backgroundColor: HEADER_FOOTER_BG,
    height: 90,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    paddingVertical: 3,
    fontSize: 14,
    fontWeight: '500',
    color: PRIMARY_TEXT,
    textAlign: 'center',
  },
  actionIcon: {
    width: 30,
    height: 30,
    marginBottom: 5,
  },
  uploadContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: PRIMARY_BACKGROUND,
  },
  uploadText: {
    color: ACCENT_TEAL,
    fontSize: 18,
    marginTop: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  progressBarBackground: {
    width: '70%',
    height: 8,
    backgroundColor: '#333333',
    borderRadius: 4,
    marginTop: 20,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: ACCENT_TEAL,
    borderRadius: 4,
  },
  uploadedIndicator: {
    position: 'absolute',
    top: 5,
    right: 5,
    zIndex: 10,
  },
  greenDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  grayDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#9E9E9E',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  fullScreenLoaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: PRIMARY_BACKGROUND,
  },
  loadingText: {
    marginTop: 10,
    color: SECONDARY_TEXT,
    fontSize: 16,
  },
});

export default GalleryScreen;