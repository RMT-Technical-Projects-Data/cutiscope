import { useSharedValue, useAnimatedProps, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { EXPOSURE_VALUES, FOCUS_DEPTH_VALUES } from '../../../shared/utils/cameraAndStorageConstants';

/**
 * Zoom shared values, pinch gesture, and animated camera zoom props.
 */
export function useCameraZoomControls({
  UI_MIN_ZOOM,
  UI_MAX_ZOOM,
  HW_MIN_ZOOM,
  HW_MAX_ZOOM,
  maxZoom,
  resetInactivityTimer,
  setZoomBtnValue,
}) {
  const setZoomBtn = setZoomBtnValue;

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
      runOnJS(setZoomBtn)(zoom.value);
      runOnJS(resetInactivityTimer)();
    });

  // Sync SharedValue -> State (for UI updates like text)
  // We use useAnimatedReaction to throttle updates to JS thread (e.g., every ~60ms) to keep UI responsive
  // but not flood the bridge.
  useAnimatedReaction(
    () => zoom.value,
    (currentZoom, previousZoom) => {
      if (previousZoom !== null && Math.abs(currentZoom - previousZoom) > 0.05) {
        runOnJS(setZoomBtn)(currentZoom);
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

  return {
    zoom,
    startZoom,
    zoomValues,
    exposureValues,
    focusDepthValues,
    minZoom,
    pinchGesture,
    animatedCameraProps,
  };
}
