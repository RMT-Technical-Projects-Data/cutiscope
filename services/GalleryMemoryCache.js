/**
 * In-memory gallery snapshot for instant open.
 * Camera writes new shots here immediately; Gallery paints from cache first,
 * then refreshes from disk in the background. Upload status is irrelevant here.
 */
import { DeviceEventEmitter } from 'react-native';

export const GALLERY_PHOTO_ADDED = 'GALLERY_PHOTO_ADDED';
export const GALLERY_PHOTO_UPDATED = 'GALLERY_PHOTO_UPDATED';

let snapshot = {
  albumPathKey: '',
  albumItems: [],
  capturedPhotos: [],
  ts: 0,
};

const pathKey = (albumPath = []) => (Array.isArray(albumPath) ? albumPath.join('/') : String(albumPath || ''));

export function getGallerySnapshot(albumPath = []) {
  const key = pathKey(albumPath);
  if (snapshot.albumPathKey === key && (snapshot.albumItems.length > 0 || snapshot.capturedPhotos.length > 0)) {
    return snapshot;
  }
  // Also useful: root photo list from recent captures even if path key differs slightly
  if (key === snapshot.albumPathKey) return snapshot;
  return null;
}

export function setGallerySnapshot(albumPath = [], albumItems = [], capturedPhotos = []) {
  snapshot = {
    albumPathKey: pathKey(albumPath),
    albumItems: albumItems || [],
    capturedPhotos: capturedPhotos || [],
    ts: Date.now(),
  };
}

export function prependGalleryPhoto(photo) {
  if (!photo?.path && !photo?.absolutePath) return;
  const absolutePath = (photo.absolutePath || String(photo.path || '').replace(/^file:\/\//, ''));
  const normalized = {
    id: photo.id || `${absolutePath}_${Date.now()}`,
    path: photo.path?.startsWith('file://') ? photo.path : `file://${absolutePath}`,
    absolutePath,
    name: photo.name || absolutePath.split('/').pop(),
    timestamp: photo.timestamp || new Date(),
    mtime: photo.mtime || new Date().toISOString(),
    directory: photo.directory || '',
    patientFolder: photo.patientFolder || '',
    clinicianFolder: photo.clinicianFolder || '',
    uploadStatus: photo.uploadStatus ?? 'PENDING',
  };

  snapshot = {
    ...snapshot,
    capturedPhotos: [
      normalized,
      ...snapshot.capturedPhotos.filter(
        (p) => (p.absolutePath || p.path?.replace(/^file:\/\//, '')) !== absolutePath
      ),
    ],
    ts: Date.now(),
  };

  try {
    DeviceEventEmitter.emit(GALLERY_PHOTO_ADDED, normalized);
  } catch (_) {}

  return normalized;
}

export function notifyGalleryPhotoUpdated(absolutePath) {
  try {
    DeviceEventEmitter.emit(GALLERY_PHOTO_UPDATED, { absolutePath });
  } catch (_) {}
}

export default {
  getGallerySnapshot,
  setGallerySnapshot,
  prependGalleryPhoto,
  notifyGalleryPhotoUpdated,
  GALLERY_PHOTO_ADDED,
  GALLERY_PHOTO_UPDATED,
};
