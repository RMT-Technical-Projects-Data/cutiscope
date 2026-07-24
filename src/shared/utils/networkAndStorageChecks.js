import { Alert } from 'react-native';
import { LIMIT_MB, CRITICAL_THRESHOLD_MB, LOW_THRESHOLD_MB } from './cameraAndStorageConstants';

export const checkNetworkConnection = async (NetInfo) => {
  const networkState = await NetInfo.fetch();
  if (!networkState.isConnected || networkState.type !== 'wifi') {
    console.error('No Wi-Fi connection detected. Please connect to Wi-Fi.');
    return false;
  }
  console.log('Wi-Fi connection detected. Proceeding with upload.');
  return true;
};

export const checkStorageSpace = async (RNFS) => {
  const freeSpace = await RNFS.getFSInfo();
  const usedSpaceMB = (freeSpace.totalSpace - freeSpace.freeSpace) / (1024 * 1024);
  const totalSpaceMB = freeSpace.totalSpace / (1024 * 1024);
  const freeSpaceMB = freeSpace.freeSpace / (1024 * 1024);

  console.log(`Total Space: ${totalSpaceMB} MB`);
  console.log(`Free Space: ${freeSpaceMB} MB`);
  console.log(`Used Space: ${usedSpaceMB} MB`);

  if (totalSpaceMB < LIMIT_MB) {
    Alert.alert(
      'Insufficient Storage',
      'Your device is near to full.',
      [{ text: 'OK' }],
    );
    return false;
  }

  if (freeSpaceMB <= CRITICAL_THRESHOLD_MB) {
    Alert.alert(
      'Memory Full',
      'Your device storage is full. Please free up some space to capture new images.',
      [{ text: 'OK' }],
    );
    return false;
  } else if (freeSpaceMB <= LOW_THRESHOLD_MB) {
    Alert.alert(
      'Low Storage',
      'Storage is running low! Please free up space soon.',
      [{ text: 'OK' }],
    );
  }

  return true;
};
