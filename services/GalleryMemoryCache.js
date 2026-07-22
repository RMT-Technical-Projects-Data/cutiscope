/**
 * In-memory gallery snapshot for instant open.
 * Camera writes new shots here immediately; Gallery paints from cache first,
 * then refreshes from disk in the background. Upload status is irrelevant here.
 *
 * Snapshot is scoped by ownerKey (guest vs logged-in user) so switching
 * accounts / guest mode never shows another session's albums or photos.
 */
import { DeviceEventEmitter } from 'react-native';

export const GALLERY_PHOTO_ADDED = 'GALLERY_PHOTO_ADDED';
export const GALLERY_PHOTO_UPDATED = 'GALLERY_PHOTO_UPDATED';

let snapshot = {
  ownerKey: '',
  albumPathKey: '',
  albumItems: [],
  capturedPhotos: [],
  ts: 0,
};

const pathKey = (albumPath = []) => (Array.isArray(albumPath) ? albumPath.join('/') : String(albumPath || ''));

/** Stable cache owner for the current auth session. */
export function getGalleryOwnerKey({ isGuest, userId, username } = {}) {
  if (isGuest) return 'guest';
  if (userId != null && String(userId).trim() !== '') return `user:${userId}`;
  const name = (username && String(username).trim()) || 'unknown';
  return `user:${name}`;
}

export function getGallerySnapshot(albumPath = [], ownerKey = '') {
  if (ownerKey && snapshot.ownerKey && snapshot.ownerKey !== ownerKey) {
    return null;
  }
  const key = pathKey(albumPath);
  if (snapshot.albumPathKey === key && (snapshot.albumItems.length > 0 || snapshot.capturedPhotos.length > 0)) {
    return snapshot;
  }
  if (key === snapshot.albumPathKey) return snapshot;
  return null;
}

export function setGallerySnapshot(albumPath = [], albumItems = [], capturedPhotos = [], ownerKey = '') {
  snapshot = {
    ownerKey: ownerKey || snapshot.ownerKey || '',
    albumPathKey: pathKey(albumPath),
    albumItems: albumItems || [],
    capturedPhotos: capturedPhotos || [],
    ts: Date.now(),
  };
}

export function prependGalleryPhoto(photo, ownerKey = '') {
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

  const nextOwner = ownerKey || snapshot.ownerKey || '';
  const ownerChanged = nextOwner && snapshot.ownerKey && snapshot.ownerKey !== nextOwner;

  snapshot = {
    ownerKey: nextOwner,
    albumPathKey: ownerChanged ? '' : snapshot.albumPathKey,
    albumItems: ownerChanged ? [] : snapshot.albumItems,
    capturedPhotos: [
      normalized,
      ...(ownerChanged
        ? []
        : snapshot.capturedPhotos.filter(
            (p) => (p.absolutePath || p.path?.replace(/^file:\/\//, '')) !== absolutePath
          )),
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

/** Wipe in-memory gallery (logout, guest switch, exit guest). */
export function clearGallerySnapshot() {
  snapshot = {
    ownerKey: '',
    albumPathKey: '',
    albumItems: [],
    capturedPhotos: [],
    ts: Date.now(),
  };
}

export default {
  getGallerySnapshot,
  setGallerySnapshot,
  prependGalleryPhoto,
  notifyGalleryPhotoUpdated,
  clearGallerySnapshot,
  getGalleryOwnerKey,
  GALLERY_PHOTO_ADDED,
  GALLERY_PHOTO_UPDATED,
};
