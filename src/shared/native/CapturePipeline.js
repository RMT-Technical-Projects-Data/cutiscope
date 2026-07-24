import { NativeModules, Platform } from 'react-native';

const { CapturePipelineModule } = NativeModules;

export const CapturePipeline = {
  isAvailable() {
    return Platform.OS === 'android' && !!CapturePipelineModule;
  },

  async saveImage(options) {
    if (!this.isAvailable()) {
      throw new Error('CapturePipelineModule not available');
    }
    return CapturePipelineModule.saveImage(options);
  },

  async processAndSave(options) {
    if (!this.isAvailable()) {
      throw new Error('CapturePipelineModule not available');
    }
    return CapturePipelineModule.processAndSave(options);
  },

  async replaceFile(sourcePath, destPath) {
    if (!this.isAvailable()) {
      throw new Error('CapturePipelineModule not available');
    }
    return CapturePipelineModule.replaceFile(sourcePath, destPath);
  },

  async persistQueue(json) {
    if (!this.isAvailable()) return false;
    try {
      await CapturePipelineModule.persistQueue(
        typeof json === 'string' ? json : JSON.stringify(json)
      );
      return true;
    } catch (_) {
      return false;
    }
  },

  async loadQueue() {
    if (!this.isAvailable()) return [];
    try {
      const raw = await CapturePipelineModule.loadQueue();
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  },

  async setDeferBusy(busy) {
    if (!this.isAvailable()) return;
    try {
      await CapturePipelineModule.setDeferBusy(!!busy);
    } catch (_) {}
  },
};

export default CapturePipeline;
