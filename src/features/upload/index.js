/**
 * Upload feature facade.
 *
 * Pipeline stages (do not merge):
 * 1. captureJobQueue (camera) — local watermark / process jobs
 * 2. registerImageAndEnqueueUpload — localImageDatabase row + optimised upload queue
 * 3. optimisedUploadQueue — serial cloud upload queue
 * 4. S3UploadService — S3 transport
 * 5. googleDriveService — parallel Drive destination (via firebaseAuthService tokens)
 */
export { default as OptimisedUploadService } from './optimisedUploadQueue';
export {
  uploadToUserS3Folder,
  uploadWithImageRecord,
  buildS3PathFromImage,
  deleteObjectFromS3,
} from './S3UploadService';
export { default as ImageDatabase } from './localImageDatabase';
export { default as googleDriveService } from './googleDriveService';
export { default as firebaseAuthService } from './firebaseAuthService';
export { registerAndEnqueue } from './registerImageAndEnqueueUpload';
