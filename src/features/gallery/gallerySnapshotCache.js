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
export const GALLERY_PENDING_CHANGED = 'GALLERY_PENDING_CHANGED';

let snapshot = {
  ownerKey: '',
  albumPathKey: '',
  albumItems: [],
  capturedPhotos: [],
  /** In-flight captures not yet on DCIM (placeholders). */
  pendingPhotos: [],
  /** Pending patient album hints at root: { id, idLabel, nameLabel, type, _coverDir, pending: true }. */
  pendingAlbums: [],
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
  const hasPending =
    (snapshot.pendingPhotos?.length || 0) > 0 || (snapshot.pendingAlbums?.length || 0) > 0;
  if (
    snapshot.albumPathKey === key &&
    (snapshot.albumItems.length > 0 ||
      snapshot.capturedPhotos.length > 0 ||
      (key === '' && hasPending))
  ) {
    return snapshot;
  }
  if (key === snapshot.albumPathKey) return snapshot;
  // Root with pending albums always usable even if albumPathKey was set elsewhere.
  if (key === '' && hasPending && (!ownerKey || !snapshot.ownerKey || snapshot.ownerKey === ownerKey)) {
    return snapshot;
  }
  return null;
}

export function setGallerySnapshot(albumPath = [], albumItems = [], capturedPhotos = [], ownerKey = '') {
  snapshot = {
    ownerKey: ownerKey || snapshot.ownerKey || '',
    albumPathKey: pathKey(albumPath),
    albumItems: albumItems || [],
    capturedPhotos: capturedPhotos || [],
    pendingPhotos: snapshot.pendingPhotos || [],
    pendingAlbums: snapshot.pendingAlbums || [],
    ts: Date.now(),
  };
}

/**
 * Register an in-flight capture so Gallery never paints empty during burst.
 * @param {{ captureSeq, fileName, stagedPath?, directory, patientSegment, year, dateSegment, ownerKey, coverPath? }} hint
 */
export function prependPendingCapture(hint, ownerKey = '') {
  if (!hint?.fileName && !hint?.stagedPath) return null;
  const nextOwner = ownerKey || snapshot.ownerKey || '';
  const ownerChanged = nextOwner && snapshot.ownerKey && snapshot.ownerKey !== nextOwner;
  const seq = hint.captureSeq != null ? String(hint.captureSeq) : `${Date.now()}`;
  const abs =
    (hint.stagedPath || hint.absolutePath || '').replace(/^file:\/\//, '') ||
    `pending://${seq}`;
  const patientSegment = hint.patientSegment || 'Unassigned';
  const [idPart, namePart] = patientSegment.split('__');

  const pendingPhoto = {
    id: `pending_${seq}`,
    path: abs.startsWith('file://') ? abs : abs.startsWith('pending://') ? abs : `file://${abs}`,
    absolutePath: abs,
    name: hint.fileName || `pending_${seq}.jpg`,
    timestamp: new Date(),
    mtime: new Date().toISOString(),
    directory: hint.directory || '',
    patientFolder: patientSegment,
    uploadStatus: 'PENDING',
    pending: true,
    captureSeq: hint.captureSeq,
    albumSegments: hint.albumSegments || [patientSegment, hint.year, hint.dateSegment].filter(Boolean),
  };

  // Guest / flat captures use albumSegments: [] — no patient album placeholder.
  const skipPendingAlbum =
    Array.isArray(hint.albumSegments) && hint.albumSegments.length === 0;

  const pendingAlbum = skipPendingAlbum
    ? null
    : {
        id: patientSegment,
        idLabel: patientSegment.includes('__') ? idPart || patientSegment : patientSegment,
        nameLabel:
          patientSegment.includes('__') && namePart ? namePart.replace(/_/g, ' ') : '',
        count: 0,
        cover: hint.coverPath
          ? { path: hint.coverPath.startsWith('file://') ? hint.coverPath : `file://${hint.coverPath}` }
          : null,
        type: 'album',
        _coverDir: hint.userBase ? `${hint.userBase}/${patientSegment}` : '',
        pending: true,
      };

  const prevPending = ownerChanged ? [] : snapshot.pendingPhotos || [];
  const prevAlbums = ownerChanged ? [] : snapshot.pendingAlbums || [];

  snapshot = {
    ownerKey: nextOwner,
    albumPathKey: ownerChanged ? '' : snapshot.albumPathKey,
    albumItems: ownerChanged ? [] : snapshot.albumItems,
    capturedPhotos: ownerChanged ? [] : snapshot.capturedPhotos,
    pendingPhotos: [
      pendingPhoto,
      ...prevPending.filter((p) => String(p.captureSeq) !== seq && p.absolutePath !== abs),
    ],
    pendingAlbums: skipPendingAlbum
      ? prevAlbums
      : [
          pendingAlbum,
          ...prevAlbums.filter((a) => a.id !== patientSegment),
        ],
    ts: Date.now(),
  };

  try {
    DeviceEventEmitter.emit(GALLERY_PENDING_CHANGED, { pendingPhoto, pendingAlbum });
  } catch (_) {}

  return pendingPhoto;
}

/** Remove pending placeholder after final DCIM save (by captureSeq or staged path). */
export function resolvePendingCapture({ captureSeq, stagedPath, finalPath } = {}) {
  const seq = captureSeq != null ? String(captureSeq) : null;
  const staged = stagedPath ? String(stagedPath).replace(/^file:\/\//, '') : null;
  const before = snapshot.pendingPhotos?.length || 0;
  snapshot = {
    ...snapshot,
    pendingPhotos: (snapshot.pendingPhotos || []).filter((p) => {
      if (seq != null && String(p.captureSeq) === seq) return false;
      if (staged && (p.absolutePath === staged || p.path?.includes(staged))) return false;
      return true;
    }),
    ts: Date.now(),
  };
  // Drop pending album if no remaining pending photos for that patient.
  const remainingPatients = new Set(
    (snapshot.pendingPhotos || []).map((p) => p.patientFolder).filter(Boolean)
  );
  snapshot.pendingAlbums = (snapshot.pendingAlbums || []).filter(
    (a) => remainingPatients.has(a.id)
  );
  if (before !== (snapshot.pendingPhotos?.length || 0)) {
    try {
      DeviceEventEmitter.emit(GALLERY_PENDING_CHANGED, { resolved: true, finalPath });
    } catch (_) {}
  }
}

export function getPendingPhotos() {
  return snapshot.pendingPhotos || [];
}

export function getPendingAlbums() {
  return snapshot.pendingAlbums || [];
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
    hasScale: photo.hasScale,
    imageVersion: photo.imageVersion,
    pending: false,
    captureSeq: photo.captureSeq,
  };

  const nextOwner = ownerKey || snapshot.ownerKey || '';
  const ownerChanged = nextOwner && snapshot.ownerKey && snapshot.ownerKey !== nextOwner;

  if (photo.captureSeq != null || photo.stagedPath) {
    resolvePendingCapture({
      captureSeq: photo.captureSeq,
      stagedPath: photo.stagedPath,
      finalPath: absolutePath,
    });
  }

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
    pendingPhotos: ownerChanged ? [] : snapshot.pendingPhotos || [],
    pendingAlbums: ownerChanged ? [] : snapshot.pendingAlbums || [],
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

/**
 * Immediately drop deleted albums / pending placeholders from the in-memory snapshot
 * so a refresh cannot resurrect them from stale cache.
 * @param {string[]} albumIds folder segment names (e.g. patientId__Name)
 */
export function removeAlbumsFromSnapshot(albumIds = []) {
  const ids = new Set((albumIds || []).filter(Boolean).map(String));
  if (ids.size === 0) return;
  snapshot = {
    ...snapshot,
    albumItems: (snapshot.albumItems || []).filter((a) => !ids.has(String(a.id))),
    pendingAlbums: (snapshot.pendingAlbums || []).filter((a) => !ids.has(String(a.id))),
    pendingPhotos: (snapshot.pendingPhotos || []).filter(
      (p) => !ids.has(String(p.patientFolder || (p.albumSegments && p.albumSegments[0]) || ''))
    ),
    ts: Date.now(),
  };
}

/** Wipe in-memory gallery (logout, guest switch, exit guest). */
export function clearGallerySnapshot() {
  snapshot = {
    ownerKey: '',
    albumPathKey: '',
    albumItems: [],
    capturedPhotos: [],
    pendingPhotos: [],
    pendingAlbums: [],
    ts: Date.now(),
  };
}

export default {
  getGallerySnapshot,
  setGallerySnapshot,
  prependGalleryPhoto,
  prependPendingCapture,
  resolvePendingCapture,
  getPendingPhotos,
  getPendingAlbums,
  removeAlbumsFromSnapshot,
  notifyGalleryPhotoUpdated,
  clearGallerySnapshot,
  getGalleryOwnerKey,
  GALLERY_PHOTO_ADDED,
  GALLERY_PHOTO_UPDATED,
  GALLERY_PENDING_CHANGED,
};
