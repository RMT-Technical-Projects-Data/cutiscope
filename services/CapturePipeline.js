/**
 * Smooth capture → upload pipeline.
 * Registers image in DB and enqueues upload so UI can return immediately.
 * Toasts: only "Uploading" (when enqueued), "Uploaded" / "Failed" (from upload services).
 */

import ImageDatabase from './ImageDatabase';
import OptimisedUploadService from './OptimisedUploadService';

/**
 * Register image in DB and enqueue S3 upload. Call after saving file locally.
 * Fast path: minimal work so UI can show preview immediately.
 */
export async function registerAndEnqueue({ localPath, fileName, username, userData, currentBox }) {
  const imageId = ImageDatabase.generateImageId();
  await ImageDatabase.saveImage({
    id: imageId,
    userId: userData?.id || username || 'user',
    userName: username || (userData?.username || '') || 'user',
    patientId: currentBox?.id || '',
    patientName: currentBox?.name || '',
    filePath: localPath,
    createdAt: new Date().toISOString(),
    uploadStatus: 'PENDING',
  });

  OptimisedUploadService.enqueueExistingFileUpload(localPath, fileName, username, {
    directUpload: false,
    imageId,
  });

  return { imageId };
}

export default { registerAndEnqueue };
