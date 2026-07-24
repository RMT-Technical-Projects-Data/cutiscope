const fs = require('fs');
const t = fs.readFileSync('c:/cutiscope/src/features/camera/CameraScreen.js', 'utf8');
const names = [
  'OptimisedUploadService', 'Buffer', 'CaptureQueue', 'recordPhotoCapture',
  'prependGalleryPhoto', 'notifyGalleryPhotoUpdated', 'getGalleryOwnerKey',
  'Alert', 'ToastAndroid', 'LogBox', 'StatusBar', 'Linking', 'Easing',
  'InteractionManager', 'useSharedValue', 'useAnimatedProps', 'runOnJS',
  'useAnimatedReaction', 'useAnimatedSensor', 'SensorType', 'PinchGestureHandler',
  'Gesture', 'NetInfo', 'Sound', 'ensureGuestPhotosDir', 'getGuestPhotosDir',
  'CustomStatusBar', 'ZoomRuler', 'MillimeterScale', 'saveImageLocallyOnly',
  'processCaptureWithScale', 'startContinuousCaptureLoop', 'stopContinuousCaptureLoop',
  'takePhotoWithRetry', 'useCapturePipeline', 'Skia', 'DEFAULT_TEMPERATURE',
  'DEFAULT_TINT', 'EXPOSURE_VALUES', 'FOCUS_DEPTH_VALUES', 'ReanimatedCamera',
  'TitleImg', 'VolumeManager', 'SCALE_BASE_MM',
];
for (const n of names) {
  const re = new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  const count = (t.match(re) || []).length;
  if (count <= 1) console.log('LIKELY_UNUSED', n, count);
}
