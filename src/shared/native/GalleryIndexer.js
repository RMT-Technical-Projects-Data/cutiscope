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

  async listDirectory(path, deletedPaths = [], includeCovers = false) {
    if (!this.isAvailable()) return noopListing;
    const result = await GalleryIndexerModule.listDirectory(
      path,
      deletedPaths,
      includeCovers
    );
    return normalizeListing(result);
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
