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
  const [isLoading, setIsLoading] = useState(() => {
    const cached = initialCache;
    return !(cached && (cached.albumItems.length > 0 || cached.capturedPhotos.length > 0));
  });
  const [forceRefreshCounter, setForceRefreshCounter] = useState(0);
  const loadGenRef = useRef(0);
  const galleryOwnerKeyRef = useRef(galleryOwnerKey);
  const albumPathRef = useRef(albumPath);
  const refreshTimerRef = useRef(null);
  const photoBatchTimerRef = useRef(null);
  const pendingPhotoBatchRef = useRef([]);
  const loadingToastAtRef = useRef(0);

  albumPathRef.current = albumPath;

  const scheduleAlbumRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      setForceRefreshCounter((c) => c + 1);
    }, 700);
  }, []);

  const toastLoadingOnce = useCallback(() => {
    const now = Date.now();
    if (now - loadingToastAtRef.current < 2500) return;
    loadingToastAtRef.current = now;
    showInAppToast('Loading, please wait…', { durationMs: 2000, position: 'center' });
  }, []);

  // Drop previous session UI when switching user ↔ guest.
  useEffect(() => {
    if (galleryOwnerKeyRef.current === galleryOwnerKey) return;
    galleryOwnerKeyRef.current = galleryOwnerKey;
    setAlbumPath([]);
    setAlbumItems([]);
    setCapturedPhotos([]);
    setIsLoading(true);
    setForceRefreshCounter((c) => c + 1);
  }, [galleryOwnerKey, setCapturedPhotos]);

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

    const statusSub = DeviceEventEmitter.addListener('IMAGE_UPLOAD_STATUS_CHANGED', ({ filePath, status }) => {
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

  // Entering a folder: clear previous level tiles so we never flash the wrong albums.
  useEffect(() => {
    const isPhotoLeaf = !isGuest && albumPath.length >= 3;
    setCapturedPhotos([]);
    setAlbumItems([]);
    setIsLoading(true);
    if (isPhotoLeaf) {
      toastLoadingOnce();
    }
  }, [albumPath.join('/'), isGuest, setCapturedPhotos, toastLoadingOnce]);

  const loadAlbumContent = useCallback(async (path, isSilent = false) => {
    const gen = ++loadGenRef.current;
    const ownerKey = galleryOwnerKey;
    const base = getBasePath();
    try {
      const albumsOnlyLevel = !isGuest && path.length < 3;

      const cached = getGallerySnapshot(path, ownerKey);
      const pendingAlbums = getPendingAlbums();
      const pendingPhotos = getPendingPhotos();
      const hasPending =
        (path.length === 0 && pendingAlbums.length > 0) ||
        (path.length >= 3 &&
          pendingPhotos.some((p) => {
            const segs = p.albumSegments || [];
            return path.every((seg, i) => segs[i] === seg);
          }));

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

      // Album levels: never paint early from cache — wait for one stable cover pass.
      // Silent refresh (post-delete / background) keeps current tiles until the new list is ready.
      const isPhotoLeaf = !isGuest && path.length >= 3;
      if (albumsOnlyLevel) {
        if (!isSilent) {
          setIsLoading(true);
          toastLoadingOnce();
        }
        setCapturedPhotos([]);
      } else if (isPhotoLeaf) {
        if (!isSilent) {
          setIsLoading(true);
          toastLoadingOnce();
        }
        setAlbumItems([]);
      } else if (usableCache && (cached.albumItems.length > 0 || cached.capturedPhotos.length > 0 || hasPending)) {
        const diskPhotos = cached.capturedPhotos || [];
        const mergedPhotos = mergePhotos(diskPhotos, pendingPhotos, path);
        setAlbumItems([]);
        setCapturedPhotos(mergedPhotos);
        setIsLoading(false);
      } else if (!isSilent) {
        setIsLoading(true);
        toastLoadingOnce();
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
        const merged = mergePhotos(formatted, getPendingPhotos(), path);
        setAlbumItems([]);
        setIsLoading(true);
        await prefetchPhotoBatch(merged);
        if (gen !== loadGenRef.current) return;
        // Keep spinner until GalleryPhotoGrid reports every thumb settled.
        setCapturedPhotos(merged);
        setGallerySnapshot(path, [], merged.filter((p) => !p.pending), ownerKey);
        if (merged.length === 0) {
          setIsLoading(false);
        }

        (async () => {
          try {
            const statusMap = await ImageDatabase.getUploadStatusMap();
            if (gen !== loadGenRef.current) return;
            setCapturedPhotos((prev) =>
              prev.map((p) => {
                const key = p.absolutePath || p.path?.replace('file://', '');
                const status = statusMap[key];
                return status ? { ...p, uploadStatus: status } : p;
              })
            );
          } catch (_) { }
        })();
      };

      const applyFolders = (items, { keepLoading = false } = {}) => {
        if (gen !== loadGenRef.current) return;
        const merged =
          path.length === 0 ? mergeAlbumItems(items, getPendingAlbums()) : items;
        const visible = filterNonEmptyAlbums(merged);
        setAlbumItems(visible);
        setCapturedPhotos([]);
        setGallerySnapshot(path, visible, [], ownerKey);
        if (!keepLoading) {
          setIsLoading(false);
        }
      };

      /** Resolve latest-image covers, prefetch, set items, keep spinner until UI confirms decode. */
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
        // Prefetch done — paint once and clear spinner (no second "wait for onLoad" flicker).
        applyFolders(items, { keepLoading: false });
        setIsLoading(false);
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
        const listing = await GalleryIndexer.listDirectory(
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
          if (hasPending && (albumsOnlyLevel || path.length === 0)) {
            await paintFoldersStable(mergeAlbumItems([], getPendingAlbums()));
            return;
          }
          if (hasPending && path.length >= 3) {
            await applyPhotos(mergePhotos([], getPendingPhotos(), path));
            return;
          }
          setAlbumItems([]);
          setCapturedPhotos([]);
          setGallerySnapshot(path, [], [], ownerKey);
          setIsLoading(false);
          return;
        }

        if (path.length === 0) {
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
          const pendingOnly = mergeAlbumItems([], getPendingAlbums());
          applyFolders(pendingOnly);
          return;
        }
        setAlbumItems([]);
        setCapturedPhotos([]);
        setGallerySnapshot(path, [], [], ownerKey);
        setIsLoading(false);
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
      if (!isSilent) {
        setIsLoading(false);
        showInAppToast('Failed to load gallery', { durationMs: 2000, position: 'bottom' });
      } else {
        setIsLoading(false);
      }
    }
  }, [getBasePath, galleryOwnerKey, setCapturedPhotos, isGuest, toastLoadingOnce]);

  const loadImages = useCallback(async (isSilent = false) => {
    const granted = await requestStoragePermissionForGallery(require('react-native').PermissionsAndroid);
    if (!granted) {
      showInAppToast('Storage permission required to load gallery', { durationMs: 3500, position: 'bottom' });
      if (!isSilent) setIsLoading(false);
      return;
    }
    loadAlbumContent(albumPath, isSilent);
  }, [albumPath, loadAlbumContent]);

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
      if (albumPathRef.current.length >= 3) {
        scheduleAlbumRefresh();
      }
    });
    return () => {
      sub.remove();
      upd.remove();
      pendingSub.remove();
      if (photoBatchTimerRef.current) clearTimeout(photoBatchTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [isGuest, setCapturedPhotos, scheduleAlbumRefresh]);

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

  return {
    albumPath,
    setAlbumPath,
    albumItems,
    setAlbumItems,
    isLoading,
    setIsLoading,
    forceRefreshCounter,
    setForceRefreshCounter,
    getBasePath,
    loadAlbumContent,
    loadImages,
    removeDeletedAlbumsLocally,
  };
};

export default useGalleryAlbumNavigation;
