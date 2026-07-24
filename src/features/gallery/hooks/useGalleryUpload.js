import { useCallback, useState } from 'react';
import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import googleDriveService from '../../upload/googleDriveService';
import firebaseAuthService from '../../upload/firebaseAuthService';
import { uploadToUserS3Folder, uploadWithImageRecord } from '../../upload/S3UploadService';
import OptimisedUploadService from '../../upload/optimisedUploadQueue';
import ImageDatabase from '../../upload/localImageDatabase';
import { showInAppToast } from '../../../shared/utils/inAppToast';

const useGalleryUpload = ({
  isGuest,
  getUsername,
  selectedPhotos,
  activePhotos,
  getShareLabel,
  setCapturedPhotos,
  setSelectedPhotos,
  setIsSelectionMode,
  setConfirmConfig,
  setConfirmModalVisible,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(1);

  // Core upload logic — uses image record when available so upload always goes to correct patient
  const uploadImageToAWS = useCallback(async (filePath, fileName) => {
    const cleanPath = filePath.replace('file://', '');

    if (isGuest) {
      throw new Error('Sign in to upload');
    }

    // Defensive duplicate-upload check (AsyncStorage + Database)
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

    // Legacy: no image record (e.g. old file) — use current selected patient
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

  // Single image upload handler (called from fullscreen view) — upload to AWS
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

      // Keep UPLOADING until the upload service reports UPLOADED/FAILED.
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

      let uploadPath = cleanPath;
      const label = image ? getShareLabel(image) : '';
      if (label) {
        try {
          const watermarkedPath = await require('../../../shared/native/BluetoothNative').default.getWatermarkedImage(cleanPath, label);
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
                const watermarkedPath = await require('../../../shared/native/BluetoothNative').default.getWatermarkedImage(cleanPath, label);
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

  return {
    isUploading,
    setIsUploading,
    uploadProgress,
    setUploadProgress,
    uploadTotal,
    setUploadTotal,
    uploadImageToAWS,
    uploadImageToDrive,
    handleUploadImage,
    handleUploadSelectedImages,
  };
};

export default useGalleryUpload;
