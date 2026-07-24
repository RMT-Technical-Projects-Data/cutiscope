/**
 * Register image in DB and enqueue S3 upload. Call after saving file locally.
 * Fast path: minimal work so UI can show preview immediately.
 *
 * Toasts: "Uploading" / "Uploaded" / "Failed" come from OptimisedUploadService / S3.
 */
import ImageDatabase from './localImageDatabase';
import OptimisedUploadService from './optimisedUploadQueue';

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
