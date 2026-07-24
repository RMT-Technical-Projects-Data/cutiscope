import { Platform } from 'react-native';

let galleryStoragePermissionGranted = false;

export const requestStoragePermissionForGallery = async (PermissionsAndroid) => {
  try {
    if (galleryStoragePermissionGranted) return true;

    const permissions = [];

    const isAndroid13OrHigher = Platform.Version >= 33;

    if (isAndroid13OrHigher) {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    } else {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
    }

    // Fast path: already granted — avoid request dialog / IPC on every gallery open
    try {
      const checks = await Promise.all(
        permissions.map((p) => PermissionsAndroid.check(p))
      );
      if (checks.every(Boolean)) {
        galleryStoragePermissionGranted = true;
        return true;
      }
    } catch (_) {}

    const results = await PermissionsAndroid.requestMultiple(permissions);

    const allGranted = Object.values(results).every(
      result => result === PermissionsAndroid.RESULTS.GRANTED
    );

    if (allGranted) {
      galleryStoragePermissionGranted = true;
      console.log('All storage permissions granted for gallery access');
      return true;
    } else {
      console.log('Some storage permissions denied:', results);
      return false;
    }
  } catch (err) {
    console.warn('Error requesting storage permissions for gallery:', err);
    return false;
  }
};

export const requestLocationPermission = async (PermissionsAndroid) => {
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      console.log('Location permission granted');
      return true;
    } else {
      console.log('Location permission denied');
      return false;
    }
  } catch (err) {
    console.warn(err);
    return false;
  }
};
