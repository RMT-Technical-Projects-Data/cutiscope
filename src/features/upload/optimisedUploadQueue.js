// features/upload/OptimisedUploadService.js — in-memory S3 upload queue
import RNFS from 'react-native-fs';
import { Platform, DeviceEventEmitter } from 'react-native';
import { showInAppToast } from '../../shared/utils/inAppToast';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import S3 service
import { uploadToUserS3Folder, uploadWithImageRecord } from './S3UploadService';
import ImageDatabase from './localImageDatabase';
import {
  ensureS3ClockOk,
  isClockSkewError,
  isUploadPausedForClockSkew,
  CLOCK_SKEW_EVENT,
} from './s3ClockSkew';

// ========== UPLOAD QUEUE SYSTEM ==========
let uploadQueue = [];
let isUploading = false;
let networkResumeSub = null;

const getItemCaptureSeq = (item) => {
  const seq = item?.metadata?.captureSeq ?? item?.captureSeq;
  const n = Number(seq);
  return Number.isFinite(n) ? n : null;
};

/** Keep FIFO by capture order when captureSeq is present. */
const insertSortedByCaptureSeq = (item) => {
  const seq = getItemCaptureSeq(item);
  if (seq == null) {
    uploadQueue.push(item);
    return;
  }
  let insertAt = uploadQueue.length;
  for (let i = uploadQueue.length - 1; i >= 0; i -= 1) {
    const prevSeq = getItemCaptureSeq(uploadQueue[i]);
    if (prevSeq == null || prevSeq <= seq) {
      insertAt = i + 1;
      break;
    }
    insertAt = i;
  }
  uploadQueue.splice(insertAt, 0, item);
};

// ========== HELPER FUNCTIONS ==========

/**
 * Emit event to notify UI about queue changes
 */
const notifyQueueChange = () => {
  DeviceEventEmitter.emit('UPLOAD_QUEUE_CHANGE', getQueueStatus());
};

/**
 * Generate unique filename with timestamp
 */
const generateFileName = () => {
  const now = new Date();
  const pad = num => num.toString().padStart(2, '0');
  
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  const milliseconds = pad(now.getMilliseconds());
  
  return `Dermscope_${year}${month}${day}_${hours}${minutes}${seconds}_${milliseconds}.jpg`;
};

/**
 * Check available storage space
 */
const checkStorageSpace = async () => {
  try {
    const freeSpace = await RNFS.getFSInfo();
    const freeSpaceMB = freeSpace.freeSpace / (1024 * 1024);
    
    if (freeSpaceMB <= 100) {
      throw new Error('Storage critically low (< 100MB)');
    }
    
    return freeSpaceMB;
  } catch (error) {
    console.error('Storage check failed:', error);
    throw error;
  }
};

/**
 * Check network connectivity
 */
const checkNetworkConnection = async () => {
  try {
    const networkState = await NetInfo.fetch();
    
    if (!networkState.isConnected) {
      throw new Error('No internet connection');
    }
    
    return networkState;
  } catch (error) {
    console.error('Network check failed:', error);
    throw error;
  }
};

/**
 * Fast local save (non-blocking)
 */
const saveImageLocally = async (sourcePath, fileName = null) => {
  try {
    const targetFileName = fileName || generateFileName();
    const directoryPath = `${RNFS.ExternalStorageDirectoryPath}/DCIM/Camera`;
    
    // Create directory if it doesn't exist
    const directoryExists = await RNFS.exists(directoryPath);
    if (!directoryExists) {
      await RNFS.mkdir(directoryPath);
    }
    
    const targetPath = `${directoryPath}/${targetFileName}`;
    
    // Move file (fast operation)
    await RNFS.moveFile(sourcePath, targetPath);
    
    
    return {
      success: true,
      path: targetPath,
      fileName: targetFileName,
      localUrl: `file://${targetPath}`,
    };
  } catch (error) {
    console.error('Local save failed:', error);
    throw error;
  }
};

const ensureNetworkResumeListener = () => {
  if (networkResumeSub) return;
  networkResumeSub = NetInfo.addEventListener((state) => {
    if (state?.isConnected && uploadQueue.length > 0 && !isUploading) {
      console.log('🔌 [Queue] Network restored — resuming uploads');
      processUploadQueue();
    }
  });
};

// ========== QUEUE MANAGEMENT ==========

/**
 * Add upload to queue (for logged-in users only)
 */
const addToUploadQueue = (fileData, username, metadata = {}) => {
  ensureNetworkResumeListener();
  const queueItem = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    filePath: fileData.path,
    fileName: fileData.fileName,
    username: username,
    status: 'pending',
    retryCount: 0,
    maxRetries: 3,
    metadata: metadata,
    createdAt: new Date().toISOString(),
  };
  
  insertSortedByCaptureSeq(queueItem);
  console.log(`📝 Added to upload queue for ${username}: ${queueItem.fileName}`);
  
  notifyQueueChange();
  
  // Start processing if not already
  if (!isUploading) {
    processUploadQueue();
  }
  
  DeviceEventEmitter.emit('IMAGE_UPLOAD_STATUS_CHANGED', { filePath: queueItem.filePath, status: 'PENDING' });
  
  return queueItem.id;
};

/**
 * Add an already-saved local file to upload queue (does NOT touch filesystem).
 * Use this when capture flow already stored the file exactly once.
 */
export const enqueueExistingFileUpload = (filePath, fileName, username, metadata = {}) => {
  ensureNetworkResumeListener();
  const queueItem = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    filePath,
    fileName,
    username,
    status: 'pending',
    retryCount: 0,
    maxRetries: 3,
    metadata: { silent: true, ...metadata },
    createdAt: new Date().toISOString(),
  };

  insertSortedByCaptureSeq(queueItem);
  console.log(`📝 Enqueued existing file for ${username}: ${queueItem.fileName}`);

  notifyQueueChange();

  if (!isUploading) {
    processUploadQueue();
  }

  DeviceEventEmitter.emit('IMAGE_UPLOAD_STATUS_CHANGED', { filePath: queueItem.filePath, status: 'PENDING' });

  return queueItem.id;
};

/**
 * Process upload queue (only for logged-in users)
 */
const processUploadQueue = async () => {
  if (isUploading || uploadQueue.length === 0) {
    return;
  }
  
  isUploading = true;
  ensureNetworkResumeListener();
  
  while (uploadQueue.length > 0 && isUploading) {
    const item = uploadQueue[0];
    
    try {
      if (isUploadPausedForClockSkew()) {
        try {
          await ensureS3ClockOk();
        } catch (skewErr) {
          console.warn('⏸️ Upload queue paused for clock skew:', skewErr?.message || skewErr);
          isUploading = false;
          notifyQueueChange();
          return;
        }
      }

      console.log(`🔄 Processing S3 upload: ${item.username}/${item.fileName}`);
      console.log('🧾 Queue item details:', {
        id: item.id,
        filePath: item.filePath,
        fileName: item.fileName,
        username: item.username,
        retryCount: item.retryCount,
        maxRetries: item.maxRetries,
        captureSeq: getItemCaptureSeq(item),
        hasPatientFolder: !!item.metadata?.patientFolder,
      });
      item.status = 'uploading';
      notifyQueueChange();
      DeviceEventEmitter.emit('IMAGE_UPLOAD_STATUS_CHANGED', { filePath: item.filePath, status: 'UPLOADING' });
      
      // Check network before upload
      await checkNetworkConnection();
      
      let result;
      const imageId = item.metadata?.imageId;
      if (imageId) {
        // Use image record so path is always correct (user/patient from capture time)
        const image = await ImageDatabase.getImage(imageId);
        if (!image) {
          console.warn('☁️ [Queue] imageId not found in DB, falling back to legacy upload');
          const patientFolder = item.metadata?.patientFolder ?? null;
          result = await uploadToUserS3Folder(
            item.filePath,
            item.fileName,
            item.username,
            item.metadata,
            patientFolder
          );
        } else {
          try {
            await ImageDatabase.updateUploadStatus(imageId, ImageDatabase.UPLOAD_STATUS.UPLOADING);
          } catch (_) { }
          result = await uploadWithImageRecord(item.filePath, image);
          await ImageDatabase.updateUploadStatus(imageId, ImageDatabase.UPLOAD_STATUS.UPLOADED, result?.url);
        }
      } else {
        const patientFolder = item.metadata?.patientFolder ?? null;
        console.log('☁️ [Queue] Uploading to S3 with patientFolder =', patientFolder);
        result = await uploadToUserS3Folder(
          item.filePath,
          item.fileName,
          item.username,
          item.metadata,
          patientFolder
        );
      }
      
      // Mark as completed
      item.status = 'completed';
      item.completedAt = new Date().toISOString();
      item.result = result;

      // Persist success status for UI indicators (Gallery green dot)
      try {
        await AsyncStorage.setItem(`uploaded_${item.filePath}`, 'true');
      } catch (_) { }

      // Emit event so GalleryScreen can update UI instantly if open
      DeviceEventEmitter.emit('IMAGE_UPLOADED', item.filePath);
      DeviceEventEmitter.emit('IMAGE_UPLOAD_STATUS_CHANGED', { filePath: item.filePath, status: 'UPLOADED' });

      // Remove from queue
      uploadQueue.shift();
      notifyQueueChange();

      // CLEANUP: If this was a temporary watermarked file, delete it
      if (item.metadata?.isTemp) {
        try {
          const tempPath = item.filePath.replace('file://', '');
          await RNFS.unlink(tempPath);
          console.log(`🧹 Cleaned up temporary watermarked file: ${item.fileName}`);
        } catch (cleanupErr) {
          console.warn('⚠️ Failed to clean up temp watermarked file:', cleanupErr.message);
        }
      }

      console.log(`✅ Uploaded to AWS – ${item.username}/${item.fileName} (key: ${result?.s3Key || 'n/a'})`);
      
    } catch (error) {
      console.error(`❌ Upload failed for ${item.fileName}:`, error);

      // Clock skew: do NOT burn retries or drop the item — pause queue until clock is fixed.
      if (isClockSkewError(error)) {
        item.status = 'paused_clock';
        item.error = error.message;
        DeviceEventEmitter.emit('IMAGE_UPLOAD_STATUS_CHANGED', {
          filePath: item.filePath,
          status: 'CLOCK_SKEW',
        });
        const imageId = item.metadata?.imageId;
        if (imageId) {
          try {
            await ImageDatabase.updateUploadStatus(imageId, ImageDatabase.UPLOAD_STATUS.CLOCK_SKEW || 'CLOCK_SKEW');
          } catch (_) { }
        }
        if (Platform.OS === 'android') {
          showInAppToast('Fix device date/time to resume uploads', { durationMs: 3500, position: 'center' });
        }
        isUploading = false;
        notifyQueueChange();
        return;
      }

      // Offline: park as pending — do NOT burn retries. Resume when network returns.
      let offline = false;
      try {
        const netState = await NetInfo.fetch();
        offline = !netState.isConnected;
      } catch (_) { }

      if (offline || /no internet|network request failed|network error/i.test(String(error?.message || ''))) {
        console.log(`🔌 [Queue] Offline — parking ${item.fileName} until network returns`);
        item.status = 'waiting_network';
        item.error = 'No internet connection';
        DeviceEventEmitter.emit('IMAGE_UPLOAD_STATUS_CHANGED', {
          filePath: item.filePath,
          status: 'PENDING',
        });
        const imageId = item.metadata?.imageId;
        if (imageId) {
          try {
            await ImageDatabase.updateUploadStatus(imageId, ImageDatabase.UPLOAD_STATUS.PENDING || 'PENDING');
          } catch (_) { }
        }
        // Leave item at front; stop worker until NetInfo resume.
        isUploading = false;
        notifyQueueChange();
        return;
      }

      item.status = 'failed';
      item.error = error.message;
      DeviceEventEmitter.emit('IMAGE_UPLOAD_STATUS_CHANGED', { filePath: item.filePath, status: 'FAILED' });
      item.retryCount++;
      
      // Update DB so image stays FAILED and can be retried from gallery
      const imageId = item.metadata?.imageId;
      if (imageId) {
        try {
          await ImageDatabase.updateUploadStatus(imageId, ImageDatabase.UPLOAD_STATUS.FAILED);
        } catch (_) { }
      }
      
      if (item.retryCount >= item.maxRetries) {
        // Max retries reached, remove from queue
        console.log(`🗑️ Removing ${item.fileName} after ${item.maxRetries} retries`);
        uploadQueue.shift();
        notifyQueueChange();

        // Persist failure so UI doesn't incorrectly mark as uploaded
        try {
          await AsyncStorage.setItem(`uploaded_${item.filePath}`, 'failed');
        } catch (_) { }
        
        if (Platform.OS === 'android') {
          // Silent queue failures for background — avoid gallery toast spam.
          if (!item.metadata?.silent) {
            showInAppToast('Failed', { durationMs: 2000 });
          }
        }
      } else {
        // Retry after delay — must restart the worker when the timer fires.
        console.log(`🔄 Retrying ${item.fileName} (${item.retryCount}/${item.maxRetries})`);
        
        const failedItem = uploadQueue.shift();
        const delayMs = item.retryCount * 5000;
        setTimeout(() => {
          failedItem.status = 'pending';
          insertSortedByCaptureSeq(failedItem);
          notifyQueueChange();
          if (!isUploading) {
            processUploadQueue();
          }
        }, delayMs);
      }
    }
    
    // Small delay between uploads
    if (uploadQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  isUploading = false;
  notifyQueueChange();
  console.log('📊 Queue processing completed');
};

// Resume queue when clock skew is resolved (Settings sync or auto-correct).
DeviceEventEmitter.addListener(CLOCK_SKEW_EVENT, ({ ok }) => {
  if (ok && uploadQueue.length > 0 && !isUploading) {
    processUploadQueue();
  }
});

ensureNetworkResumeListener();

// ========== MAIN EXPORTED FUNCTIONS ==========

/**
 * Fast capture and upload flow for LOGGED-IN USERS ONLY
 * For guest users, use simple local save in CameraScreen
 */
export const fastCaptureAndUpload = async (photoPath, username, metadata = {}) => {
  try {
    console.time('TotalCaptureUploadTime');
    
    // 1. Quick local save
    const saveResult = await saveImageLocally(photoPath);
    
    // 2. Add to upload queue (returns immediately)
    const queueId = addToUploadQueue(saveResult, username, {
      ...metadata,
      deviceId: 'Dev_005',
      timestamp: new Date().toISOString(),
    });
    
    console.timeEnd('TotalCaptureUploadTime');
    
    return {
      success: true,
      message: 'Image saved and queued for S3 upload',
      localPath: saveResult.path,
      fileName: saveResult.fileName,
      queueId,
      username: username,
      timestamp: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('Capture/upload failed:', error);
    
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
};

/**
 * Simple local save for guest users
 */
export const saveImageForGuest = async (photoPath) => {
  try {
    const saveResult = await saveImageLocally(photoPath);
    
    return {
      success: true,
      message: 'Image saved locally (Guest Mode)',
      localPath: saveResult.path,
      fileName: saveResult.fileName,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Guest save failed:', error);
    throw error;
  }
};

/**
 * Check if image is already in queue
 */
export const isImageInQueue = (filePath) => {
  const cleanPath = filePath.replace('file://', '');
  return uploadQueue.some(item => 
    item.filePath.replace('file://', '') === cleanPath && 
    (item.status === 'pending' || item.status === 'uploading' || item.status === 'waiting_network')
  );
};

/**
 * Get queue status
 */
export const getQueueStatus = () => {
  return {
    total: uploadQueue.length,
    pending: uploadQueue.filter(item => item.status === 'pending' || item.status === 'waiting_network').length,
    uploading: uploadQueue.filter(item => item.status === 'uploading').length,
    completed: uploadQueue.filter(item => item.status === 'completed').length,
    failed: uploadQueue.filter(item => item.status === 'failed').length,
    galleryCount: uploadQueue.filter(item => item.metadata?.source === 'gallery').length,
    items: [...uploadQueue],
  };
};

/**
 * Check if uploads are in progress
 */
export const isUploadInProgress = () => {
  return isUploading || uploadQueue.length > 0;
};

/** Kick the worker (e.g. after manual Retry when Wi‑Fi returns). */
export const resumeUploadQueue = () => {
  if (uploadQueue.length > 0 && !isUploading) {
    processUploadQueue();
  }
};

// Export everything
export default {
  // Core functions
  fastCaptureAndUpload,
  saveImageForGuest,
  enqueueExistingFileUpload,
  
  // Queue management
  getQueueStatus,
  isUploadInProgress,
  isImageInQueue,
  resumeUploadQueue,
  
  // Utilities
  generateFileName,
  checkStorageSpace,
  checkNetworkConnection,
  
  // Local save for both guest and logged-in
  saveImageLocally,
};
