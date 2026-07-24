/**
 * Guest Mode photo storage: cache-only, auto-cleanup on logout/app start.
 * - Storage: app cache/guest_photos (not DCIM, not visible to other apps by default).
 * - .nomedia in folder so system gallery does not show these photos.
 * - Cleanup on Exit Guest Mode and on app start if previous session was guest.
 */
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearGallerySnapshot } from './gallerySnapshotCache';
import CaptureQueue from '../camera/captureJobQueue';
import GalleryIndexer from '../../shared/native/GalleryIndexer';

const GUEST_PHOTOS_DIR_NAME = 'guest_photos';
const NOMEDIA_FILE = '.nomedia';
const CAPTURE_QUEUE_DIR = 'capture_queue';

/**
 * Returns the absolute path for guest photos (cache directory).
 * Android: getCacheDir()/guest_photos
 * iOS: CachesDirectory/guest_photos
 */
export function getGuestPhotosDir() {
  return `${RNFS.CachesDirectoryPath}/${GUEST_PHOTOS_DIR_NAME}`;
}

/**
 * Ensures guest_photos directory exists and contains .nomedia so system gallery
 * does not show these photos. Call before saving the first guest photo.
 */
export async function ensureGuestPhotosDir() {
  const dir = getGuestPhotosDir();
  const exists = await RNFS.exists(dir);
  if (!exists) {
    await RNFS.mkdir(dir);
  }
  const nomediaPath = `${dir}/${NOMEDIA_FILE}`;
  if (!(await RNFS.exists(nomediaPath))) {
    await RNFS.writeFile(nomediaPath, '', 'utf8');
  }
  return dir;
}

async function deleteDirContents(dir) {
  const exists = await RNFS.exists(dir);
  if (!exists) return;
  const items = await RNFS.readDir(dir);
  for (const item of items) {
    try {
      if (item.isDirectory()) {
        await deleteDirContents(item.path);
      }
      await RNFS.unlink(item.path);
    } catch (e) {
      console.warn('Guest cleanup: could not delete:', item.path, e?.message);
    }
  }
  try {
    await RNFS.unlink(dir);
  } catch (e) {
    console.warn('Guest cleanup: could not remove dir:', dir, e?.message);
  }
}

/**
 * Deletes all guest photos, staged capture-queue files, and in-memory gallery cache.
 * Safe to call when directories do not exist or are empty.
 */
export async function deleteGuestPhotos() {
  try {
    // Stop any in-flight guest processing so files are not re-created after delete.
    try {
      await CaptureQueue.clearGuestJobs?.();
    } catch (_) {}

    await deleteDirContents(getGuestPhotosDir());

    // Staged raws for guest captures live here and are not under guest_photos.
    const queueDir = `${RNFS.DocumentDirectoryPath}/${CAPTURE_QUEUE_DIR}`;
    await deleteDirContents(queueDir);

    // Also wipe any guest leftovers that landed in cache root (save fallback).
    try {
      const cacheItems = await RNFS.readDir(RNFS.CachesDirectoryPath);
      for (const item of cacheItems) {
        if (item.isFile() && /^Cutiscope_.*\.jpg$/i.test(item.name)) {
          try { await RNFS.unlink(item.path); } catch (_) {}
        }
      }
    } catch (_) {}

    try {
      clearGallerySnapshot();
    } catch (_) {}

    try {
      if (GalleryIndexer.isAvailable?.()) {
        GalleryIndexer.invalidate?.(getGuestPhotosDir());
      }
    } catch (_) {}

    try {
      await AsyncStorage.removeItem('capture_queue_pending_v1');
    } catch (_) {}
  } catch (e) {
    console.warn('deleteGuestPhotos failed:', e?.message || e);
  }
}
