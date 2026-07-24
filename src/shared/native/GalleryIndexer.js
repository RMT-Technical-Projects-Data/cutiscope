import { NativeModules, Platform } from 'react-native';

const { GalleryIndexerModule } = NativeModules;

const noopListing = { exists: false, dirs: [], photos: [], covers: {} };

/**
 * Thin bridge to GalleryIndexerModule — filesystem walks run in Kotlin.
 */
export const GalleryIndexer = {
  isAvailable() {
    return Platform.OS === 'android' && !!GalleryIndexerModule;
  },

  async listDirectory(path, deletedPaths = [], includeCovers = false, albumsOnly = false) {
    if (!this.isAvailable()) return noopListing;
    const result = await GalleryIndexerModule.listDirectory(
      path,
      deletedPaths,
      includeCovers,
      !!albumsOnly
    );
    return normalizeListing(result);
  },

  async listPhotosInFolder(path, deletedPaths = []) {
    if (!this.isAvailable()) return noopListing;
    if (typeof GalleryIndexerModule.listPhotosInFolder === 'function') {
      const result = await GalleryIndexerModule.listPhotosInFolder(path, deletedPaths);
      return normalizeListing(result);
    }
    return this.listDirectory(path, deletedPaths, false, false);
  },

  async listImagesRecursive(path, deletedPaths = []) {
    if (!this.isAvailable()) return { exists: false, photos: [] };
    const result = await GalleryIndexerModule.listImagesRecursive(path, deletedPaths);
    return {
      exists: !!result?.exists,
      photos: Array.isArray(result?.photos) ? result.photos : [],
    };
  },

  async findLatestCovers(dirPaths, deletedPaths = []) {
    if (!this.isAvailable() || !dirPaths?.length) return {};
    const result = await GalleryIndexerModule.findLatestCovers(dirPaths, deletedPaths);
    return result && typeof result === 'object' ? result : {};
  },

  async findLatestUnder(basePath, deletedPaths = []) {
    if (!this.isAvailable() || !basePath) return null;
    try {
      const result = await GalleryIndexerModule.findLatestUnder(basePath, deletedPaths);
      if (!result?.path) return null;
      return {
        name: result.name,
        path: result.path,
        mtime: result.mtime,
        directory: result.directory || '',
      };
    } catch (_) {
      return null;
    }
  },

  async notifyPhotoSaved(absolutePath) {
    if (!this.isAvailable() || !absolutePath) return false;
    try {
      await GalleryIndexerModule.notifyPhotoSaved(String(absolutePath).replace(/^file:\/\//, ''));
      return true;
    } catch (_) {
      return false;
    }
  },

  async prefetch(basePath, deletedPaths = []) {
    if (!this.isAvailable() || !basePath) return false;
    try {
      await GalleryIndexerModule.prefetch(basePath, deletedPaths);
      return true;
    } catch (_) {
      return false;
    }
  },

  async getCachedListing(path) {
    if (!this.isAvailable() || !path) return null;
    const result = await GalleryIndexerModule.getCachedListing(path);
    return result ? normalizeListing(result) : null;
  },

  async invalidate(path = null) {
    if (!this.isAvailable()) return false;
    try {
      await GalleryIndexerModule.invalidate(path);
      return true;
    } catch (_) {
      return false;
    }
  },

  async deletePaths(paths) {
    if (!this.isAvailable()) return false;
    const cleaned = (paths || [])
      .map((p) => String(p || '').replace(/^file:\/\//, ''))
      .filter(Boolean);
    if (cleaned.length === 0) return true;
    return GalleryIndexerModule.deletePaths(cleaned);
  },
};

function normalizeListing(result) {
  if (!result) return noopListing;
  const covers =
    result.covers && typeof result.covers === 'object' && !Array.isArray(result.covers)
      ? result.covers
      : {};
  return {
    exists: !!result.exists,
    dirs: Array.isArray(result.dirs) ? result.dirs : [],
    photos: Array.isArray(result.photos) ? result.photos : [],
    covers,
  };
}

export default GalleryIndexer;
