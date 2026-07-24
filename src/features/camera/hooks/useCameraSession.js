import { useCameraDevice, useCameraFormat, useCameraPermission } from 'react-native-vision-camera';

export function useCameraSession() {
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
  const maxZoom = UI_MAX_ZOOM;
  const HW_MAX_ZOOM = Math.max(HW_MIN_ZOOM, deviceMaxZoom);
  return {
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
  };
}
