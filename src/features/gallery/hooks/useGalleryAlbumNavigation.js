import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, Image, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { requestStoragePermissionForGallery } from '../../../shared/utils/storagePermissions';
import { getGuestPhotosDir } from '../guestPhotoStorage';
import ImageDatabase from '../../upload/localImageDatabase';
import {
  getGallerySnapshot,
  setGallerySnapshot,
  GALLERY_PHOTO_ADDED,
  GALLERY_PHOTO_UPDATED,
  GALLERY_PENDING_CHANGED,
  getPendingPhotos,
  getPendingAlbums,
  removeAlbumsFromSnapshot,
} from '../gallerySnapshotCache';
import { DELETED_FILES_KEY } from '../utils/galleryPathUtils';
import {
  buildMonthAlbumItems,
  buildPatientAlbumItems,
  buildWeekAlbumItems,
  buildYearAlbumItems,
} from '../utils/galleryAlbumHierarchy';
import { imageCache as IMAGE_CACHE } from '../components/galleryThumbnailItem';
import { showInAppToast } from '../../../shared/utils/inAppToast';
import GalleryIndexer from '../../../shared/native/GalleryIndexer';
import { sanitizeFolderName } from '../utils/albumPathBuilder';
import { getPatients } from '../../patients/patientsService';
import { consolidateDuplicatePatientFolders } from '../../patients/patientFolderSync';

export { sanitizeFolderName } from '../utils/albumPathBuilder';

const toRnfsLikeDir = (d) => ({
  name: d.name,
  path: d.path,
  mtime: new Date(d.mtime),
  isDirectory: () => true,
  isFile: () => false,
});

const mergeAlbumItems = (diskItems = [], pendingAlbums = []) => {
  const byId = new Map();
  for (const item of diskItems) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const pending of pendingAlbums) {
    if (!pending?.id) continue;
    if (!byId.has(pending.id)) {
      byId.set(pending.id, pending);
    } else if (pending.cover && !byId.get(pending.id).cover) {
      byId.set(pending.id, { ...byId.get(pending.id), cover: pending.cover });
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    (a.nameLabel || a.idLabel || '').localeCompare(b.nameLabel || b.idLabel || '')
  );
};

/** Drop folders with no images (empty shells). Keep in-flight pending albums. */
const filterNonEmptyAlbums = (items = []) =>
  (items || []).filter((item) => item?.pending || item?.cover?.path);

const mergePhotos = (diskPhotos = [], pendingPhotos = [], albumPath = []) => {
  const relevantPending = (pendingPhotos || []).filter((p) => {
    if (p.pending === false) return false;
    if (!albumPath.length) return true;
    const segs = p.albumSegments || [];
    return albumPath.every((seg, i) => segs[i] === seg);
  });
  // At patient/year/date leaf (length 3), show pending placeholders mixed in.
  if (albumPath.length > 0 && albumPath.length < 3) {
    return diskPhotos;
  }
  const byAbs = new Map();
  for (const p of diskPhotos) {
    const abs = (p.absolutePath || p.path?.replace(/^file:\/\//, '') || '').split('?')[0];
    if (abs) byAbs.set(abs, p);
  }
  const pendingFirst = [];
  for (const p of relevantPending) {
    const abs = (p.absolutePath || '').split('?')[0];
    if (abs && byAbs.has(abs)) continue;
    pendingFirst.push(p);
  }
  return [...pendingFirst, ...diskPhotos];
};

/** Prefetch every thumb so the grid paints as one complete batch. */
const prefetchPhotoBatch = async (photos) => {
  const list = (photos || []).filter((p) => p?.path && !String(p.path).startsWith('pending://'));
  if (list.length === 0) return;
  const CONCURRENCY = 8;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const chunk = list.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map((p) => {
        const uri = p.path.startsWith('file://') ? p.path : `file://${p.path}`;
        IMAGE_CACHE.set(`${uri}::${p.imageVersion || 0}`, uri);
        return Image.prefetch(uri).catch(() => false);
      })
    );
  }
};

const useGalleryAlbumNavigation = ({
  isGuest,
  userData,
  getUsername,
  galleryOwnerKey,
  initialCache,
  setCapturedPhotos,
  capturedPhotosRef,
}) => {
  const [albumPath, setAlbumPath] = useState([]);
  const [albumItems, setAlbumItems] = useState(() => initialCache?.albumItems || []);
  const hasInitialContent = !!(
    initialCache &&
    (initialCache.albumItems?.length > 0 || initialCache.capturedPhotos?.length > 0)
  );
  // Only show spinner when a load is actually slow — empty galleries skip it.
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(hasInitialContent);
  const [forceRefreshCounter, setForceRefreshCounter] = useState(0);
  const loadGenRef = useRef(0);
  const galleryOwnerKeyRef = useRef(galleryOwnerKey);
  const albumPathRef = useRef(albumPath);
  const refreshTimerRef = useRef(null);
  const photoBatchTimerRef = useRef(null);
  const pendingPhotoBatchRef = useRef([]);
  const loadingDelayRef = useRef(null);
  /** Once a photo-leaf folder has been revealed, never flash loading again for that path. */
  const photoLeafReadyPathRef = useRef('');
  const patientFolderConsolidateRef = useRef(0);

  albumPathRef.current = albumPath;

  const clearLoadingDelay = useCallback(() => {
    if (loadingDelayRef.current) {
      clearTimeout(loadingDelayRef.current);
      loadingDelayRef.current = null;
    }
  }, []);

  /** Show spinner only if the load takes longer than a short grace period. */
  const beginLoadIndicator = useCallback((isSilent = false) => {
    clearLoadingDelay();
    if (isSilent) return;
    loadingDelayRef.current = setTimeout(() => {
      loadingDelayRef.current = null;
      setIsLoading(true);
    }, 280);
  }, [clearLoadingDelay]);

  const endLoadIndicator = useCallback(() => {
    clearLoadingDelay();
    setIsLoading(false);
    setHasLoaded(true);
  }, [clearLoadingDelay]);

  const scheduleAlbumRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      setForceRefreshCounter((c) => c + 1);
    }, 700);
  }, []);

  // Drop previous session UI when switching user ↔ guest.
  // Skip empty/logout owner keys so inactivity logout does not flash "No photos found".
  useEffect(() => {
    if (!galleryOwnerKey) return;
    if (galleryOwnerKeyRef.current === galleryOwnerKey) return;
    galleryOwnerKeyRef.current = galleryOwnerKey;
    setAlbumPath([]);
    setAlbumItems([]);
    setCapturedPhotos([]);
    setHasLoaded(false);
    beginLoadIndicator(false);
    setForceRefreshCounter((c) => c + 1);
  }, [galleryOwnerKey, setCapturedPhotos, beginLoadIndicator]);

  // Coalesce upload status quietly — never thrash album covers or remount grids.
  useEffect(() => {
    const pendingStatuses = new Map();
    let flushTimer = null;

    const flushStatuses = () => {
      flushTimer = null;
      if (pendingStatuses.size === 0) return;
      // Album hierarchy screens have no photo grid — ignore upload chatter entirely.
      if (!isGuest && albumPathRef.current.length < 3) {
        pendingStatuses.clear();
        return;
      }
      const updates = new Map(pendingStatuses);
      pendingStatuses.clear();
      setCapturedPhotos((prev) => {
        if (!prev.length) return prev;
        let changed = false;
        const next = prev.map((p) => {
          const clean = (p.absolutePath || p.path?.replace('file://', '') || '').split('?')[0];
          const status = updates.get(clean);
          if (!status || p.uploadStatus === status) return p;
          changed = true;
          // Keep same path/id so the Image does not remount — only the status dot updates.
          return { ...p, uploadStatus: status };
        });
        return changed ? next : prev;
      });
    };

    const queueStatus = (filePath, status) => {
      const cleanPath = String(filePath || '').replace('file://', '').split('?')[0];
      if (!cleanPath || !status) return;
      pendingStatuses.set(cleanPath, status);
      if (!flushTimer) {
        flushTimer = setTimeout(flushStatuses, 800);
      }
    };

    const subscription = DeviceEventEmitter.addListener('IMAGE_UPLOADED', (filePath) => {
      queueStatus(filePath, 'UPLOADED');
    });

    const statusSub = DeviceEventEmitter.addListener('IMAGE_UPLOAD_STATUS_CHANGED', ({ filePath, status, previousPath }) => {
      if (previousPath) {
        const oldClean = String(previousPath).replace('file://', '').split('?')[0];
        pendingStatuses.delete(oldClean);
      }
      queueStatus(filePath, status);
    });

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      subscription.remove();
      statusSub.remove();
    };
  }, [setCapturedPhotos, isGuest]);

  const getBasePath = useCallback(() => {
    if (isGuest) {
      return getGuestPhotosDir();
    }
    const userSegment =
      userData?.id != null
        ? String(userData.id)
        : sanitizeFolderName(getUsername() || 'user');
    if (Platform.OS === 'android') {
      return `${RNFS.ExternalStorageDirectoryPath}/DCIM/Camera/${userSegment}`;
    }
    return `${RNFS.DocumentDirectoryPath}/Dermscope/${userSegment}`;
  }, [isGuest, userData, getUsername]);

  const maybeConsolidateDuplicatePatientFolders = useCallback(async () => {
    if (isGuest) return false;
    const now = Date.now();
    if (now - patientFolderConsolidateRef.current < 60000) return false;
    patientFolderConsolidateRef.current = now;
    try {
      const patients = await getPatients();
      const { groupsMerged } = await consolidateDuplicatePatientFolders({
        userId: userData?.id,
        username: getUsername?.(),
        patients,
      });
      return groupsMerged > 0;
    } catch (e) {
      console.warn('Gallery patient folder consolidate:', e?.message || e);
      return false;
    }
  }, [isGuest, userData?.id, getUsername]);

  // Entering a folder: clear previous level tiles so we never flash the wrong albums.
  // Mark not-loaded immediately so Gallery shows "Fetching…" instead of a black body.
  useEffect(() => {
    setCapturedPhotos([]);
    setAlbumItems([]);
    setHasLoaded(false);
    setIsLoading(true);
    photoLeafReadyPathRef.current = '';
  }, [albumPath.join('/'), isGuest, setCapturedPhotos]);

  const loadAlbumContent = useCallback(async (path, isSilent = false) => {
    const gen = ++loadGenRef.current;
    const ownerKey = galleryOwnerKey;
    const base = getBasePath();
    try {
      const albumsOnlyLevel = !isGuest && path.length < 3;

      const cached = getGallerySnapshot(path, ownerKey);
      const pendingAlbums = getPendingAlbums();
      const pendingPhotos = getPendingPhotos();
      const pendingUnderPath = (p) => {
        const segs = p.albumSegments || [];
        return path.every((seg, i) => segs[i] === seg);
      };
      const hasPending =
        (path.length === 0 &&
          (pendingAlbums.length > 0 || (isGuest && pendingPhotos.length > 0))) ||
        (!isGuest && path.length >= 1 && path.length <= 2 &&
          pendingPhotos.some((p) => pendingUnderPath(p) && (p.albumSegments || []).length > path.length)) ||
        (path.length >= 3 && pendingPhotos.some(pendingUnderPath));

      const cacheBelongsHere = (entries) => {
        if (!entries?.length) return false;
        return entries.every((p) => {
          const abs = (p.absolutePath || String(p.path || '').replace(/^file:\/\//, '')).split('?')[0];
          return !abs || abs.startsWith('pending://') || abs.startsWith(base);
        });
      };
      const usableCache =
        cached &&
        (
          (cached.albumItems.length > 0 && ownerKey && cached.ownerKey === ownerKey) ||
          (!albumsOnlyLevel && cacheBelongsHere(cached.capturedPhotos)) ||
          hasPending
        );

      const isPhotoLeaf = !isGuest && path.length >= 3;
      if (albumsOnlyLevel) {
        if (!isSilent) beginLoadIndicator(false);
        setCapturedPhotos([]);
      } else if (isPhotoLeaf) {
        if (!isSilent) beginLoadIndicator(false);
        setAlbumItems([]);
      } else if (usableCache && (cached.albumItems.length > 0 || cached.capturedPhotos.length > 0 || hasPending)) {
        const diskPhotos = cached.capturedPhotos || [];
        const mergedPhotos = mergePhotos(diskPhotos, pendingPhotos, path);
        setAlbumItems([]);
        setCapturedPhotos(mergedPhotos);
        endLoadIndicator();
      } else if (!isSilent) {
        beginLoadIndicator(false);
      }

      const currentDir = path.length === 0 ? base : `${base}/${path.join('/')}`;

      let deletedFilesSet = new Set();
      let deletedArr = [];
      try {
        const j = await AsyncStorage.getItem(DELETED_FILES_KEY);
        if (j) {
          deletedArr = JSON.parse(j);
          deletedFilesSet = new Set(deletedArr);
        }
      } catch (_) { }

      const formatPhoto = (file) => {
        const directory = file.directory || currentDir;
        const segments = (directory || '').split('/').filter(Boolean);
        const patientFolder = segments.length > 0 ? segments[segments.length - 1] : '';
        const clinicianFolder = segments.length > 1 ? segments[segments.length - 2] : '';
        const filePath = file.path;
        const mtimeMs = typeof file.mtime === 'number' ? file.mtime : new Date(file.mtime).getTime();
        return {
          id: `${filePath}_${mtimeMs}`,
          path: `file://${filePath}`,
          timestamp: new Date(mtimeMs),
          name: file.name,
          mtime: mtimeMs,
          directory,
          absolutePath: filePath,
          patientFolder,
          clinicianFolder,
        };
      };

      const applyPhotos = async (formatted) => {
        if (gen !== loadGenRef.current) return;
        // Hard guard: never paint a flat photo grid on patient/year/date folder levels.
        if (!isGuest && path.length < 3) {
          console.warn('[Gallery] blocked flat photo paint at album level', path.length);
          return;
        }
        const pathKey = Array.isArray(path) ? path.join('/') : String(path || '');
        const alreadyReady = photoLeafReadyPathRef.current === pathKey;
        const merged = mergePhotos(formatted, getPendingPhotos(), path);
        setAlbumItems([]);
        await prefetchPhotoBatch(merged);
        if (gen !== loadGenRef.current) return;

        // Merge upload statuses before first paint so queue / uploaded show correctly.
        let withStatus = merged;
        try {
          const statusMap = await ImageDatabase.getUploadStatusMap();
          const AsyncStorage = require('@react-native-async-storage/async-storage').default;
          const OptimisedUploadService = require('../../upload/optimisedUploadQueue');
          const keys = merged.map((p) =>
            (p.absolutePath || p.path?.replace('file://', '') || '').split('?')[0]
          ).filter(Boolean);
          const flagPairs = keys.length
            ? await AsyncStorage.multiGet(keys.map((k) => `uploaded_${k}`))
            : [];
          const uploadedFlags = new Map(
            flagPairs.map(([k, v]) => [String(k).replace(/^uploaded_/, ''), v === 'true'])
          );

          withStatus = merged.map((p) => {
            const key = (p.absolutePath || p.path?.replace('file://', '') || '').split('?')[0];
            let status = statusMap[key] || p.uploadStatus || null;
            if (uploadedFlags.get(key) || status === 'UPLOADED') {
              status = 'UPLOADED';
            } else {
              try {
                if (OptimisedUploadService.isImageInQueue?.(key)) {
                  if (!status || status === 'FAILED') status = 'PENDING';
                }
              } catch (_) { }
            }
            return status ? { ...p, uploadStatus: status } : p;
          });
        } catch (_) { }

        if (gen !== loadGenRef.current) return;
        setCapturedPhotos(withStatus);
        setGallerySnapshot(path, [], withStatus.filter((p) => !p.pending), ownerKey);

        if (withStatus.length === 0) {
          photoLeafReadyPathRef.current = pathKey;
          endLoadIndicator();
          return;
        }

        // First open of this folder: one loading pass until thumbs settle.
        // Later silent focus/refresh must not re-show the spinner.
        if (!alreadyReady) {
          clearLoadingDelay();
          setHasLoaded(true);
          setIsLoading(true);
        } else {
          endLoadIndicator();
        }
      };

      /**
       * In-flight captures have no folder on disk until the watermark queue drains.
       * Derive placeholders for the level below `path` so year / date screens are not
       * empty while a burst is still processing.
       */
      const pendingAlbumsBelow = () => {
        if (path.length === 0) return getPendingAlbums();
        if (isGuest || path.length > 2) return [];
        const byName = new Map();
        for (const p of getPendingPhotos()) {
          const segs = p.albumSegments || [];
          if (segs.length <= path.length) continue;
          if (!path.every((seg, i) => segs[i] === seg)) continue;
          const name = segs[path.length];
          if (!name || byName.has(name)) continue;
          const coverPath = String(p.path || '');
          byName.set(name, {
            id: name,
            idLabel: name,
            nameLabel: name,
            count: 0,
            cover: coverPath && !coverPath.startsWith('pending://') ? { path: coverPath } : null,
            type: path.length === 1 ? 'year' : 'date',
            _coverDir: `${currentDir}/${name}`,
            pending: true,
          });
        }
        return Array.from(byName.values());
      };

      const applyFolders = (items, { keepLoading = false } = {}) => {
        if (gen !== loadGenRef.current) return;
        let merged = items;
        if (path.length === 0) {
          merged = mergeAlbumItems(items, pendingAlbumsBelow());
        } else if (path.length <= 2) {
          // Year / date levels are sorted newest-first — keep that order and put
          // in-flight folders on top instead of re-sorting alphabetically.
          const existing = new Set((items || []).map((i) => String(i.id)));
          const extra = pendingAlbumsBelow().filter((i) => !existing.has(String(i.id)));
          merged = extra.length ? [...extra, ...items] : items;
        }
        const visible = filterNonEmptyAlbums(merged);
        setAlbumItems(visible);
        setCapturedPhotos([]);
        setGallerySnapshot(path, visible, [], ownerKey);
        if (!keepLoading) {
          endLoadIndicator();
        }
      };

      /** Resolve latest-image covers, prefetch, set items, then clear spinner. */
      const paintFoldersStable = async (baseItems) => {
        if (gen !== loadGenRef.current) return;
        let items = baseItems || [];
        const dirsNeedingCover = items
          .filter((i) => i._coverDir || i.id)
          .map((i) => i._coverDir || `${currentDir}/${i.id}`);
        if (dirsNeedingCover.length > 0 && GalleryIndexer.isAvailable()) {
          try {
            const covers = await GalleryIndexer.findLatestCovers(dirsNeedingCover, deletedArr);
            if (gen !== loadGenRef.current) return;
            items = applyCoversFromMap(items, covers);
          } catch (_) { }
        }
        // Empty disk folders (no cover) should not appear; pending may still show.
        items = filterNonEmptyAlbums(items);
        const coverUris = items.map((i) => i.cover?.path).filter(Boolean);
        if (coverUris.length > 0) {
          await Promise.all(coverUris.map((uri) => Image.prefetch(uri).catch(() => false)));
        }
        if (gen !== loadGenRef.current) return;
        applyFolders(items, { keepLoading: false });
      };

      /** If disk only has loose photos (no dirs yet), derive patient albums from paths. */
      const albumsFromRecursivePhotos = (photos) => {
        const byPatient = new Map();
        for (const file of photos || []) {
          const abs = String(file.path || '').replace(/^file:\/\//, '');
          if (!abs.startsWith(base + '/')) continue;
          const rel = abs.slice(base.length + 1);
          const patient = rel.split('/')[0];
          if (!patient) continue;
          const coverDir = `${base}/${patient}`;
          if (!byPatient.has(patient)) {
            byPatient.set(patient, {
              name: patient,
              path: coverDir,
              mtime: file.mtime || Date.now(),
            });
          }
        }
        return buildPatientAlbumItems(Array.from(byPatient.values()).map(toRnfsLikeDir));
      };

      const applyCoversFromMap = (items, covers) => {
        if (!covers || !items?.length) return items;
        return items.map((item) => {
          const coverPath = covers[item._coverDir] || covers[`${currentDir}/${item.id}`];
          if (!coverPath) return item;
          const uri = coverPath.startsWith('file://') ? coverPath : `file://${coverPath}`;
          return { ...item, cover: { path: uri } };
        });
      };

      // Prefer native Kotlin indexer on Android; fall back to RNFS elsewhere.
      if (GalleryIndexer.isAvailable()) {
        const t0 = Date.now();
        // Single paint path only — no warm intermediate paint (that caused one-by-one covers).

        // Album levels always request latest covers (patient / year / date).
        let listing = await GalleryIndexer.listDirectory(
          currentDir,
          deletedArr,
          albumsOnlyLevel,
          albumsOnlyLevel
        );
        if (__DEV__) {
          console.log(`[Gallery] native listDirectory ${currentDir} in ${Date.now() - t0}ms (dirs=${listing.dirs?.length || 0}, photos=${listing.photos?.length || 0})`);
        }
        if (gen !== loadGenRef.current) return;

        if (!listing.exists) {
          // Never resurrect stale snapshot albums after delete — only pending in-flight captures.
          if (isGuest && path.length === 0) {
            const pending = getPendingPhotos();
            if (pending.length > 0 || hasPending) {
              await applyPhotos(mergePhotos([], pending, path));
              return;
            }
          }
          if (hasPending && (albumsOnlyLevel || path.length === 0)) {
            await paintFoldersStable(pendingAlbumsBelow());
            return;
          }
          if (hasPending && path.length >= 3) {
            await applyPhotos(mergePhotos([], getPendingPhotos(), path));
            return;
          }
          setAlbumItems([]);
          setCapturedPhotos([]);
          setGallerySnapshot(path, [], [], ownerKey);
          endLoadIndicator();
          return;
        }

        if (path.length === 0) {
          // Guest mode stores a flat photo list under guest_photos (no patient/year albums).
          if (isGuest) {
            if (listing.photos?.length > 0) {
              await applyPhotos(listing.photos.map(formatPhoto));
            } else {
              const recursive = await GalleryIndexer.listImagesRecursive(currentDir, deletedArr);
              if (gen !== loadGenRef.current) return;
              await applyPhotos((recursive.photos || []).map(formatPhoto));
            }
            return;
          }
          if (await maybeConsolidateDuplicatePatientFolders()) {
            listing = await GalleryIndexer.listDirectory(
              currentDir,
              deletedArr,
              albumsOnlyLevel,
              albumsOnlyLevel
            );
            if (gen !== loadGenRef.current) return;
          }
          if (listing.dirs.length > 0) {
            let items = buildPatientAlbumItems(listing.dirs.map(toRnfsLikeDir));
            items = applyCoversFromMap(items, listing.covers);
            await paintFoldersStable(items);
          } else {
            const recursive = await GalleryIndexer.listImagesRecursive(currentDir, deletedArr);
            if (gen !== loadGenRef.current) return;
            const derived = albumsFromRecursivePhotos(recursive.photos || []);
            await paintFoldersStable(mergeAlbumItems(derived, getPendingAlbums()));
          }
          return;
        }

        if (path.length === 1) {
          const yearDirs = listing.dirs.filter((d) => /^\d{4}$/.test(d.name));
          if (yearDirs.length > 0) {
            let items = buildYearAlbumItems(yearDirs.map(toRnfsLikeDir));
            items = applyCoversFromMap(items, listing.covers);
            await paintFoldersStable(items);
          } else {
            await paintFoldersStable([]);
          }
          return;
        }

        if (path.length === 2) {
          let items = buildMonthAlbumItems(listing.dirs.map(toRnfsLikeDir));
          items = applyCoversFromMap(items, listing.covers);
          await paintFoldersStable(items);
          return;
        }

        if (path.length === 3) {
          // Fast leaf listing — all photos in one native pass, then prefetch + paint once.
          let leaf = listing;
          if (GalleryIndexer.listPhotosInFolder) {
            try {
              leaf = await GalleryIndexer.listPhotosInFolder(currentDir, deletedArr);
            } catch (_) {
              leaf = listing;
            }
          }
          if (gen !== loadGenRef.current) return;
          if (leaf.photos?.length > 0) {
            await applyPhotos(leaf.photos.map(formatPhoto));
          } else if (listing.dirs.length > 0) {
            let items = buildWeekAlbumItems(listing.dirs.map(toRnfsLikeDir));
            await paintFoldersStable(items);
          } else {
            await applyPhotos([]);
          }
          return;
        }

        if (path.length === 4) {
          await applyPhotos(listing.photos.map(formatPhoto));
        }
        return;
      }

      // ---- RNFS fallback (iOS / missing native module) ----
      const exists = await RNFS.exists(currentDir);
      if (gen !== loadGenRef.current) return;

      if (!exists) {
        if (!isGuest && path.length < 3) {
          applyFolders([]);
          return;
        }
        setAlbumItems([]);
        setCapturedPhotos([]);
        setGallerySnapshot(path, [], [], ownerKey);
        endLoadIndicator();
        return;
      }

      const getAllImageFilesRecursive = async (dirPath) => {
        let results = [];
        try {
          const list = await RNFS.readDir(dirPath);
          for (const item of list) {
            if (item.isDirectory()) {
              results = results.concat(await getAllImageFilesRecursive(item.path));
            } else if (item.isFile() && item.name.match(/\.(jpg|jpeg|png|gif|bmp)$/i) && !item.name.startsWith('compressed_')) {
              results.push({ ...item, directory: dirPath });
            }
          }
        } catch (_) { }
        return results;
      };

      const fillCoversFirst = async (dirs) => {
        try {
          return await Promise.all(
            dirs.map(async (item) => {
              try {
                const files = await getAllImageFilesRecursive(item._coverDir || `${currentDir}/${item.id}`);
                const valid = files.filter((f) => !deletedFilesSet.has(f.path));
                if (valid.length === 0) return item;
                const latest = valid.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())[0];
                const uri = `file://${latest.path}`;
                await Image.prefetch(uri).catch(() => false);
                return { ...item, cover: { path: uri } };
              } catch (_) {
                return item;
              }
            })
          );
        } catch (_) {
          return dirs;
        }
      };

      const applyFoldersWithCovers = async (items) => {
        const withCovers = await fillCoversFirst(items);
        if (gen !== loadGenRef.current) return;
        applyFolders(withCovers);
      };

      if (path.length === 0) {
        if (!isGuest) {
          await maybeConsolidateDuplicatePatientFolders();
        }
        const list = await RNFS.readDir(currentDir);
        if (gen !== loadGenRef.current) return;
        const dirs = list.filter((i) => i.isDirectory());
        if (dirs.length > 0) {
          await applyFoldersWithCovers(buildPatientAlbumItems(dirs));
        } else if (!isGuest) {
          const files = await getAllImageFilesRecursive(currentDir);
          if (gen !== loadGenRef.current) return;
          const filtered = files.filter((f) => !deletedFilesSet.has(f.path));
          await paintFoldersStable(mergeAlbumItems(albumsFromRecursivePhotos(filtered), getPendingAlbums()));
        } else {
          const files = await getAllImageFilesRecursive(currentDir);
          if (gen !== loadGenRef.current) return;
          const filtered = files.filter((f) => !deletedFilesSet.has(f.path));
          const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
          await applyPhotos(sorted.map(formatPhoto));
        }
        return;
      }

      if (path.length === 1) {
        const list = await RNFS.readDir(currentDir);
        if (gen !== loadGenRef.current) return;
        const subdirs = list.filter((i) => i.isDirectory());
        const yearDirs = subdirs.filter((d) => /^\d{4}$/.test(d.name));
        if (yearDirs.length > 0) {
          await applyFoldersWithCovers(buildYearAlbumItems(yearDirs));
        } else {
          applyFolders([]);
        }
        return;
      }

      if (path.length === 2) {
        const list = await RNFS.readDir(currentDir);
        if (gen !== loadGenRef.current) return;
        await applyFoldersWithCovers(buildMonthAlbumItems(list.filter((i) => i.isDirectory())));
        return;
      }

      if (path.length === 3) {
        const list = await RNFS.readDir(currentDir);
        if (gen !== loadGenRef.current) return;
        const imageFiles = list.filter(
          (i) => i.isFile() && i.name.match(/\.(jpg|jpeg|png|gif|bmp)$/i) && !i.name.startsWith('compressed_')
        );
        if (imageFiles.length > 0) {
          const filtered = imageFiles.filter((f) => !deletedFilesSet.has(f.path));
          const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
          await applyPhotos(sorted.map((file) => formatPhoto({ ...file, directory: currentDir })));
        } else {
          await applyFoldersWithCovers(buildWeekAlbumItems(list.filter((i) => i.isDirectory())));
        }
        return;
      }

      if (path.length === 4) {
        const list = await RNFS.readDir(currentDir);
        if (gen !== loadGenRef.current) return;
        const imageFiles = list.filter(
          (i) => i.isFile() && i.name.match(/\.(jpg|jpeg|png|gif|bmp)$/i) && !i.name.startsWith('compressed_')
        );
        const filtered = imageFiles.filter((f) => !deletedFilesSet.has(f.path));
        const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
        await applyPhotos(sorted.map((file) => formatPhoto({ ...file, directory: currentDir })));
      }
    } catch (error) {
      console.error('Failed to load album:', error);
      endLoadIndicator();
      if (!isSilent) {
        showInAppToast('Failed to load gallery', { durationMs: 2000, position: 'bottom' });
      }
    }
  }, [getBasePath, galleryOwnerKey, setCapturedPhotos, isGuest, beginLoadIndicator, endLoadIndicator, clearLoadingDelay, maybeConsolidateDuplicatePatientFolders]);

  const loadImages = useCallback(async (isSilent = false) => {
    const granted = await requestStoragePermissionForGallery(require('react-native').PermissionsAndroid);
    if (!granted) {
      showInAppToast('Storage permission required to load gallery', { durationMs: 3500, position: 'bottom' });
      endLoadIndicator();
      return;
    }
    loadAlbumContent(albumPath, isSilent);
  }, [albumPath, loadAlbumContent, endLoadIndicator]);

  useEffect(() => {
    loadImages(forceRefreshCounter > 0);
  }, [loadImages, forceRefreshCounter]);

  useFocusEffect(
    useCallback(() => {
      loadImages(true);
    }, [loadImages])
  );

  useEffect(() => {
    const flushPhotoBatch = () => {
      photoBatchTimerRef.current = null;
      const batch = pendingPhotoBatchRef.current;
      pendingPhotoBatchRef.current = [];
      if (!batch.length) return;
      if (!isGuest && albumPathRef.current.length < 3) return;
      // Full folder reload once — never drip images into the open grid.
      scheduleAlbumRefresh();
    };

    const sub = DeviceEventEmitter.addListener(GALLERY_PHOTO_ADDED, (photo) => {
      if (!photo) return;
      if (!isGuest && albumPathRef.current.length < 3) {
        // Quiet background refresh — do not flash the loading overlay on every capture.
        scheduleAlbumRefresh();
        return;
      }
      pendingPhotoBatchRef.current.push(photo);
      if (photoBatchTimerRef.current) clearTimeout(photoBatchTimerRef.current);
      photoBatchTimerRef.current = setTimeout(flushPhotoBatch, 500);
    });
    const upd = DeviceEventEmitter.addListener(GALLERY_PHOTO_UPDATED, ({ absolutePath }) => {
      if (!absolutePath) return;
      const bust = Date.now();
      IMAGE_CACHE.delete(`file://${absolutePath}`);
      IMAGE_CACHE.delete(absolutePath);
      setCapturedPhotos((prev) =>
        prev.map((p) => {
          const abs = (p.absolutePath || p.path?.replace(/^file:\/\//, '') || '').split('?')[0];
          if (abs !== absolutePath) return p;
          return {
            ...p,
            id: p.id || abs,
            path: `file://${absolutePath}`,
            absolutePath,
            imageVersion: bust,
          };
        })
      );
    });
    const pendingSub = DeviceEventEmitter.addListener(GALLERY_PENDING_CHANGED, () => {
      if (!isGuest && albumPathRef.current.length < 3) {
        scheduleAlbumRefresh();
        return;
      }
      // Guest root is a flat photo grid — refresh pending placeholders there too.
      if (isGuest || albumPathRef.current.length >= 3) {
        scheduleAlbumRefresh();
      }
    });
    return () => {
      sub.remove();
      upd.remove();
      pendingSub.remove();
      if (photoBatchTimerRef.current) clearTimeout(photoBatchTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      clearLoadingDelay();
    };
  }, [isGuest, setCapturedPhotos, scheduleAlbumRefresh, clearLoadingDelay]);

  const removeDeletedAlbumsLocally = useCallback((pathKeys = []) => {
    const keys = (pathKeys || []).filter(Boolean);
    if (keys.length === 0) return;
    // Last segment is the folder id at the current (or absolute) level.
    const ids = keys.map((k) => {
      const parts = String(k).split('/').filter(Boolean);
      return parts[parts.length - 1];
    });
    removeAlbumsFromSnapshot(ids);
    setAlbumItems((prev) => {
      const next = (prev || []).filter((a) => !ids.includes(String(a.id)));
      setGallerySnapshot(albumPathRef.current, next, [], galleryOwnerKeyRef.current);
      return next;
    });
  }, []);

  const markPhotoLeafReady = useCallback(() => {
    photoLeafReadyPathRef.current = albumPathRef.current.join('/');
    endLoadIndicator();
  }, [endLoadIndicator]);

  return {
    albumPath,
    setAlbumPath,
    albumItems,
    setAlbumItems,
    isLoading,
    setIsLoading,
    hasLoaded,
    forceRefreshCounter,
    setForceRefreshCounter,
    getBasePath,
    loadAlbumContent,
    loadImages,
    removeDeletedAlbumsLocally,
    markPhotoLeafReady,
  };
};

export default useGalleryAlbumNavigation;
