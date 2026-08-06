import { NativeModules, Platform } from 'react-native';

const { UploadQueueModule } = NativeModules;

export const UploadQueueNative = {
  isAvailable() {
    return Platform.OS === 'android' && !!UploadQueueModule;
  },

  async upsertImage(params) {
    if (!this.isAvailable()) throw new Error('UploadQueueModule unavailable');
    return UploadQueueModule.upsertImage(params);
  },

  async getImageByFilePath(filePath) {
    if (!this.isAvailable()) return null;
    return UploadQueueModule.getImageByFilePath(filePath);
  },

  async getPendingCount() {
    if (!this.isAvailable() || !UploadQueueModule.getPendingCount) return 0;
    return UploadQueueModule.getPendingCount();
  },

  async getPendingImages() {
    if (!this.isAvailable()) return [];
    return UploadQueueModule.getPendingImages();
  },

  async updateStatus(filePath, status, awsUrl = null) {
    if (!this.isAvailable()) return false;
    return UploadQueueModule.updateStatus(filePath, status, awsUrl);
  },

  async removeByFilePath(filePath) {
    if (!this.isAvailable()) return false;
    return UploadQueueModule.removeByFilePath(filePath);
  },

  async removeByFilePaths(paths) {
    if (!this.isAvailable()) return false;
    return UploadQueueModule.removeByFilePaths(paths || []);
  },

  async updateFilePath(oldPath, newPath) {
    if (!this.isAvailable()) return false;
    return UploadQueueModule.updateFilePath(oldPath, newPath);
  },

  async getUploadStatusMap() {
    if (!this.isAvailable()) return {};
    return UploadQueueModule.getUploadStatusMap();
  },

  async compressForUpload(filePath) {
    if (!this.isAvailable()) return null;
    return UploadQueueModule.compressForUpload(filePath);
  },
};

export default UploadQueueNative;
