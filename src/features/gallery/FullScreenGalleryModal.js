import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  BackHandler,
  useWindowDimensions,
  DeviceEventEmitter,
} from 'react-native';
import { GestureHandlerRootView, Gesture, GestureDetector, FlatList as GHFlatList } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, withDelay, useAnimatedReaction } from 'react-native-reanimated';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { BackButton } from '../../shared/ui';

import deleteIcon from '../../../assets/icon_delete.png';
import uploadIcon from '../../../assets/icon_upload.png';
import { notifyUserActivity, SESSION_FORCE_LOGOUT_EVENT } from '../../shared/utils/inAppToast';

const PRIMARY_BACKGROUND = '#000000';
const HEADER_FOOTER_BG = '#000000';
const PRIMARY_TEXT = '#FFFFFF';
const SECONDARY_TEXT = '#AAAAAA';
const ACCENT_TEAL = '#22B2A6';

const normalizePhotoPath = (p) => {
  if (!p) return '';
  if (typeof p === 'string') return p.replace(/^file:\/\//, '').split('?')[0];
  return (p.absolutePath || String(p.path || '').replace(/^file:\/\//, '')).split('?')[0];
};

/** Fit image inside the viewport the same way resizeMode="contain" would. */
function fitContain(imgW, imgH, viewW, viewH) {
  if (!imgW || !imgH || !viewW || !viewH) {
    return { width: viewW || 1, height: viewH || 1 };
  }
  const imageRatio = imgW / imgH;
  const viewRatio = viewW / viewH;
  if (imageRatio > viewRatio) {
    return { width: viewW, height: viewW / imageRatio };
  }
  return { width: viewH * imageRatio, height: viewH };
}

const ZoomableImage = ({ uri, version, viewWidth, viewHeight, onTap, onZoomChange }) => {
  const [imgDims, setImgDims] = useState({ w: viewWidth, h: viewHeight });
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
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => setImgDims({ w, h }),
      () => setImgDims({ w: viewWidth, h: viewHeight })
    );
    // Reset zoom when the underlying file is replaced with a watermarked version.
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [uri, version, viewWidth, viewHeight]);

  const notifyZoom = useCallback((zoomed) => {
    onZoomChange?.(zoomed);
  }, [onZoomChange]);

  useAnimatedReaction(
    () => scale.value > 1.01,
    (zoomed, prev) => {
      if (zoomed !== prev) {
        runOnJS(notifyZoom)(zoomed);
      }
    },
    [notifyZoom]
  );

  // fitContain returns { width, height } — rename for pan/zoom + layout.
  const { width: displayedWidth, height: displayedHeight } = useMemo(
    () => fitContain(imgDims.w, imgDims.h, viewWidth, viewHeight),
    [imgDims, viewWidth, viewHeight]
  );

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
        const tapX = e.x - viewWidth / 2;
        const tapY = e.y - viewHeight / 2;

        const maxTransX = Math.max(0, (displayedWidth * targetScale - viewWidth) / 2);
        const maxTransY = Math.max(0, (displayedHeight * targetScale - viewHeight) / 2);

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
      focalXStart.value = e.focalX - viewWidth / 2;
      focalYStart.value = e.focalY - viewHeight / 2;
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

      const currentFocalX = e.focalX - viewWidth / 2;
      const currentFocalY = e.focalY - viewHeight / 2;

      // Unscaled focal point relative to image coordinate space
      const p0x = (focalXStart.value - translateXStart.value) / scaleStart.value;
      const p0y = (focalYStart.value - translateYStart.value) / scaleStart.value;

      // Target translation to keep the image point under the fingers
      const targetTx = currentFocalX - newScale * p0x;
      const targetTy = currentFocalY - newScale * p0y;

      const maxTransX = Math.max(0, (displayedWidth * newScale - viewWidth) / 2);
      const maxTransY = Math.max(0, (displayedHeight * newScale - viewHeight) / 2);

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
    .manualActivation(true)
    .maxPointers(1)
    .onTouchesMove((_, state) => {
      if (scale.value > 1.01) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onStart(() => {
      prevTranslationX.value = 0;
      prevTranslationY.value = 0;
    })
    .onUpdate((e) => {
      if (scale.value > 1.01) {
        const dx = e.translationX - prevTranslationX.value;
        const dy = e.translationY - prevTranslationY.value;
        prevTranslationX.value = e.translationX;
        prevTranslationY.value = e.translationY;

        if (!isPinching.value && !justFinishedPinching.value) {
          const maxTransX = Math.max(0, (displayedWidth * scale.value - viewWidth) / 2);
          const maxTransY = Math.max(0, (displayedHeight * scale.value - viewHeight) / 2);

          translateX.value = Math.min(Math.max(translateX.value + dx, -maxTransX), maxTransX);
          translateY.value = Math.min(Math.max(translateY.value + dy, -maxTransY), maxTransY);
        }
      }
    })
    .onEnd(() => {
      if (scale.value > 1.01) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
    });

  // Native gesture lets the horizontal pager receive swipes when not zoomed.
  const scrollNative = Gesture.Native();

  const composed = Gesture.Simultaneous(
    scrollNative,
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Local file URI — guest and logged-in both use file:// paths here.
  const imageUri = useMemo(() => {
    if (!uri) return null;
    const raw = String(uri);
    if (raw.startsWith('file://') || raw.startsWith('content://') || raw.startsWith('http')) {
      return raw;
    }
    return `file://${raw}`;
  }, [uri]);

  // Transform a sized View, not Reanimated.Image: scaling a full-res ImageView
  // (up to 4096px) on Android often drops the hardware layer → solid black.
  return (
    <GestureDetector gesture={composed}>
      <View
        collapsable={false}
        style={{
          width: viewWidth,
          height: viewHeight,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: PRIMARY_BACKGROUND,
          overflow: 'hidden',
        }}
      >
        {imageUri ? (
          <Reanimated.View
            collapsable={false}
            renderToHardwareTextureAndroid={false}
            style={[
              {
                width: displayedWidth,
                height: displayedHeight,
              },
              animatedStyle,
            ]}
          >
            <Image
              key={`${imageUri}::${version || 0}`}
              source={{ uri: imageUri }}
              style={{ width: displayedWidth, height: displayedHeight }}
              resizeMode="cover"
              fadeDuration={0}
            />
          </Reanimated.View>
        ) : null}
      </View>
    </GestureDetector>
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
  powerMenuOpen,
  getShareLabel,
  onBluetoothShare
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [errorMsg, setErrorMsg] = useState(null);
  const errorTimerRef = useRef(null);
  const flatListRef = useRef(null);
  const currentPhotoIdRef = useRef(photos[initialIndex]?.absolutePath || photos[initialIndex]?.path);
  const wasVisibleRef = useRef(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [pagerScrollEnabled, setPagerScrollEnabled] = useState(true);
  // Latch paths that entered UPLOADING so a transient status flicker never flashes action buttons.
  const uploadingPathsRef = useRef(new Set());

  const overlaysVisible = showOverlays && !powerMenuOpen;

  // Stable identity of the photo list (ignore uploadStatus-only object churn).
  const photoPathsKey = useMemo(
    () => photos.map((p) => normalizePhotoPath(p)).join('|'),
    [photos]
  );

  const currentPhoto = useMemo(() => {
    if (!photos.length) return null;
    const target = currentPhotoIdRef.current
      ? normalizePhotoPath(currentPhotoIdRef.current)
      : null;
    if (target) {
      const found = photos.find((p) => normalizePhotoPath(p) === target);
      if (found) return found;
    }
    return photos[Math.min(currentIndex, photos.length - 1)];
  }, [photos, currentIndex, photoPathsKey]);

  // Keep upload latch in sync — queue / uploading stay on loader until UPLOADED/FAILED.
  useEffect(() => {
    let OptimisedUploadService = null;
    try {
      // eslint-disable-next-line global-require
      OptimisedUploadService = require('../upload/optimisedUploadQueue');
    } catch (_) { }

    for (const p of photos) {
      const path = normalizePhotoPath(p);
      if (!path) continue;
      const status = p.uploadStatus;
      if (status === 'UPLOADING' || status === 'PENDING' || status === 'CLOCK_SKEW') {
        uploadingPathsRef.current.add(path);
      } else if (status === 'UPLOADED' || status === 'FAILED') {
        uploadingPathsRef.current.delete(path);
      } else if (OptimisedUploadService?.isImageInQueue?.(path)) {
        uploadingPathsRef.current.add(path);
      }
    }
  }, [photos]);

  const isPhotoUploadInFlight = useCallback((photo) => {
    if (!photo) return false;
    const status = photo.uploadStatus;
    if (status === 'UPLOADING' || status === 'PENDING' || status === 'CLOCK_SKEW') return true;
    if (status === 'UPLOADED' || status === 'FAILED') return false;
    const path = normalizePhotoPath(photo);
    if (path && uploadingPathsRef.current.has(path)) return true;
    try {
      // eslint-disable-next-line global-require
      const OptimisedUploadService = require('../upload/optimisedUploadQueue');
      if (path && OptimisedUploadService.isImageInQueue?.(path)) return true;
    } catch (_) { }
    return false;
  }, []);

  const [legacyUploaded, setLegacyUploaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!currentPhoto) {
        if (!cancelled) setLegacyUploaded(false);
        return;
      }
      if (currentPhoto.uploadStatus === 'UPLOADED') {
        if (!cancelled) setLegacyUploaded(true);
        return;
      }
      if (['PENDING', 'UPLOADING', 'CLOCK_SKEW', 'FAILED'].includes(currentPhoto.uploadStatus)) {
        if (!cancelled) setLegacyUploaded(false);
        return;
      }
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const path = normalizePhotoPath(currentPhoto);
        const flag = await AsyncStorage.getItem(`uploaded_${path}`);
        if (!cancelled) setLegacyUploaded(flag === 'true');
      } catch (_) {
        if (!cancelled) setLegacyUploaded(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [currentPhoto]);

  // Guest mode never uploads — never show "Uploading..." for guest captures.
  const showUploadingFooter =
    overlaysVisible && !isGuest && isPhotoUploadInFlight(currentPhoto);
  const showUploadButton =
    overlaysVisible &&
    !isGuest &&
    !showUploadingFooter &&
    currentPhoto &&
    currentPhoto.uploadStatus !== 'UPLOADED' &&
    !legacyUploaded;

  const handleZoomChange = useCallback((zoomed) => {
    setPagerScrollEnabled(!zoomed);
  }, []);

  // When opened, reset to initial
  useEffect(() => {
    if (visible && !wasVisibleRef.current && photos.length > 0) {
      setCurrentIndex(initialIndex);
      currentPhotoIdRef.current = photos[initialIndex]?.absolutePath || photos[initialIndex]?.path;
      setShowOverlays(true);
      setPagerScrollEnabled(true);
      setTimeout(() => {
        if (flatListRef.current && photos.length > initialIndex) {
          try {
            flatListRef.current.scrollToIndex({ index: initialIndex, animated: false });
          } catch (e) { }
        }
      }, 50);
    }
    wasVisibleRef.current = visible;
  }, [visible, initialIndex, photos.length]);

  // Re-enable pager swipe after changing photo (zoom resets per item).
  useEffect(() => {
    setPagerScrollEnabled(true);
  }, [currentIndex]);

  // Hardware back closes fullscreen overlay (same window as power menu — no Modal flicker).
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose?.();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Allow inactivity timeout while viewing — close immediately on forced logout
  // so Gallery never flashes "No photos found" under this overlay.
  useEffect(() => {
    if (!visible) return undefined;
    notifyUserActivity();
    const sub = DeviceEventEmitter.addListener(SESSION_FORCE_LOGOUT_EVENT, () => {
      onClose?.();
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Handle deletion sync — only when the path set changes, not on upload badge updates.
  useEffect(() => {
    if (!visible || photos.length === 0) return;

    const targetId = currentPhotoIdRef.current
      ? normalizePhotoPath(currentPhotoIdRef.current)
      : null;
    if (!targetId) return;

    const newIndex = photos.findIndex((p) => normalizePhotoPath(p) === targetId);

    if (newIndex !== -1) {
      if (newIndex !== currentIndex) {
        setCurrentIndex(newIndex);
      }
    } else {
      const fallbackIndex = Math.min(currentIndex, photos.length - 1);
      setCurrentIndex(fallbackIndex);
      const nextPhoto = photos[fallbackIndex];
      if (nextPhoto) {
        currentPhotoIdRef.current = nextPhoto.absolutePath || nextPhoto.path;
      }
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
  }, [photoPathsKey, visible]);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      const idx = viewableItems[0].index;
      if (idx !== null && idx >= 0) {
        setCurrentIndex(idx);
        const item = viewableItems[0].item;
        currentPhotoIdRef.current = item.absolutePath || item.path;
      }
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 0,
  }).current;

  // Preload adjacent items and clear error on swipe
  useEffect(() => {
    if (photos[currentIndex - 1]) Image.prefetch(photos[currentIndex - 1].path).catch(() => { });
    if (photos[currentIndex + 1]) Image.prefetch(photos[currentIndex + 1].path).catch(() => { });

    setErrorMsg(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, [currentIndex, photoPathsKey]);

  const getItemLayout = useCallback((data, index) => (
    { length: windowWidth, offset: windowWidth * index, index }
  ), [windowWidth]);

  const toggleOverlays = useCallback(() => {
    setShowOverlays(prev => !prev);
  }, []);

  const renderItem = useCallback(({ item }) => {
    const uri = item?.path || (item?.absolutePath ? `file://${item.absolutePath}` : null);
    return (
      <View style={{ width: windowWidth, height: windowHeight, backgroundColor: PRIMARY_BACKGROUND }}>
        <ZoomableImage
          uri={uri}
          version={item.imageVersion || 0}
          viewWidth={windowWidth}
          viewHeight={windowHeight}
          onTap={toggleOverlays}
          onZoomChange={handleZoomChange}
        />
      </View>
    );
  }, [toggleOverlays, handleZoomChange, windowWidth, windowHeight]);

  if (!visible || photos.length === 0) return null;

  if (!currentPhoto) return null;

  // Absolute overlay (NOT RN Modal): power menu Modal can stack on top without
  // tearing down / flickering this image surface.
  return (
    <View
      style={styles.fullScreenOverlayRoot}
      pointerEvents="box-none"
      onTouchStart={notifyUserActivity}
      onTouchMove={notifyUserActivity}
    >
      <GestureHandlerRootView style={styles.fullScreenModalBackground}>

        <View style={styles.gestureContainer}>
          <GHFlatList
            ref={flatListRef}
            style={styles.pagerList}
            data={photos}
            keyExtractor={(item) => normalizePhotoPath(item)}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            scrollEnabled={pagerScrollEnabled}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex >= 0 && initialIndex < photos.length ? initialIndex : 0}
            getItemLayout={getItemLayout}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            decelerationRate="fast"
            snapToInterval={windowWidth}
            snapToAlignment="start"
            disableIntervalMomentum
            scrollEventThrottle={16}
            bounces={false}
            overScrollMode="never"
            directionalLockEnabled
            windowSize={5}
            maxToRenderPerBatch={3}
            initialNumToRender={3}
            removeClippedSubviews={false}
          />
        </View>

        {/* Header — same layout as gallery ScreenHeader (back + centered title + right slot) */}
        {overlaysVisible && (
          <View style={styles.fullscreenHeader}>
            <BackButton onPress={onClose} iconTint={PRIMARY_TEXT} />
            <Text
              style={styles.fullscreenTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {currentPhoto.timestamp
                ? currentPhoto.timestamp.toLocaleString([], {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </Text>
            <View style={styles.fullscreenHeaderRight}>
              <Text style={styles.fullscreenIndexText}>
                {currentIndex + 1} / {photos.length}
              </Text>
            </View>
          </View>
        )}

        {/* Sub-header (Filename only) */}
        {overlaysVisible && (
          <View style={styles.fullscreenMetadataSubHeader}>
            <Text style={styles.fullScreenPhotoNameSmall} numberOfLines={1}>
              {currentPhoto.name}
            </Text>
          </View>
        )}

        {/* Action buttons — Upload | Share | Delete; when uploaded, Share+Delete centered */}
        {overlaysVisible && (
          <View
            style={[
              styles.actionContainerFull,
              !showUploadingFooter && !showUploadButton && styles.actionContainerFullCentered,
            ]}
          >
            {showUploadingFooter ? (
              <View style={styles.loaderContainerFull}>
                <ActivityIndicator size="small" color={ACCENT_TEAL} />
                <Text style={[styles.btnText, { marginLeft: 10 }]}>Uploading...</Text>
              </View>
            ) : (
              <>
                {showUploadButton ? (
                  <TouchableOpacity
                    style={styles.footerAction}
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
                ) : null}

                <TouchableOpacity
                  style={styles.footerAction}
                  onPress={() => {
                    if (onBluetoothShare) {
                      onBluetoothShare(currentPhoto);
                    }
                  }}
                >
                  <MaterialCommunityIcons name="bluetooth" size={30} color={ACCENT_TEAL} style={{ marginBottom: 4 }} />
                  <Text style={styles.btnText}>Share</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.footerAction}
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
    </View>
  );
});

const styles = StyleSheet.create({
  gestureContainer: {
    flex: 1,
  },
  pagerList: {
    flex: 1,
  },
  fullScreenOverlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
    backgroundColor: PRIMARY_BACKGROUND,
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
    // Match gallery ScreenHeader — immersive kiosk has no status-bar inset.
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 20,
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  fullscreenTitle: {
    color: PRIMARY_TEXT,
    fontSize: 20,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.3,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  fullscreenHeaderRight: {
    minWidth: 40,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
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
    top: 60,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 4,
    paddingHorizontal: 20,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'center',
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
    fontSize: 14,
    fontWeight: '600',
  },
  actionContainerFull: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    height: 90,
    zIndex: 11,
    borderTopWidth: 1,
    borderTopColor: '#333333',
  },
  actionContainerFullCentered: {
    justifyContent: 'center',
  },
  footerAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
    marginHorizontal: 28,
  },
  footerSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  loaderContainerFull: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineErrorContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(211, 47, 47, 0.9)',
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
});

export default FullScreenGalleryModal;
