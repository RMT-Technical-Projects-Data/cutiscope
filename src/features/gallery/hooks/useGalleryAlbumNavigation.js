import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';
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

export const sanitizeFolderName = (s) => {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/[\s/\\:*?"<>|]/g, '_').replace(/_+/g, '_').trim().slice(0, 80);
};

const toRnfsLikeDir = (d) => ({
  name: d.name,
  path: d.path,
  mtime: new Date(d.mtime),
  isDirectory: () => true,
  isFile: () => false,
});

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

  // Coalesce background upload status events so mass uploads do not thrash the grid.
  useEffect(() => {
    const pendingStatuses = new Map();
    let flushTimer = null;

    const flushStatuses = () => {
      flushTimer = null;
      if (pendingStatuses.size === 0) return;
      const updates = new Map(pendingStatuses);
      pendingStatuses.clear();
      setCapturedPhotos((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const clean = (p.absolutePath || p.path?.replace('file://', '') || '').split('?')[0];
          const status = updates.get(clean);
          if (!status || p.uploadStatus === status) return p;
          changed = true;
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
        flushTimer = setTimeout(flushStatuses, 350);
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
  }, [setCapturedPhotos]);

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

  const loadAlbumContent = useCallback(async (path, isSilent = false) => {
    const gen = ++loadGenRef.current;
    const ownerKey = galleryOwnerKey;
    const base = getBasePath();
    try {
      const cached = getGallerySnapshot(path, ownerKey);
      const cacheBelongsHere = (entries) => {
        if (!entries?.length) return false;
        return entries.every((p) => {
          const abs = (p.absolutePath || String(p.path || '').replace(/^file:\/\//, '')).split('?')[0];
          return !abs || abs.startsWith(base);
        });
      };
      const usableCache =
        cached &&
        (
          (cached.albumItems.length > 0 && ownerKey && cached.ownerKey === ownerKey) ||
          cacheBelongsHere(cached.capturedPhotos)
        );

      if (usableCache && (cached.albumItems.length > 0 || cached.capturedPhotos.length > 0)) {
        setAlbumItems(cached.albumItems);
        setCapturedPhotos(cached.capturedPhotos);
        setIsLoading(false);
      } else if (!isSilent) {
        setIsLoading(true);
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

      const applyPhotos = (formatted) => {
        if (gen !== loadGenRef.current) return;
        setAlbumItems([]);
        setCapturedPhotos(formatted);
        setGallerySnapshot(path, [], formatted, ownerKey);
        setIsLoading(false);

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

      const applyFolders = (items) => {
        if (gen !== loadGenRef.current) return;
        setAlbumItems(items);
        setCapturedPhotos([]);
        setGallerySnapshot(path, items, [], ownerKey);
        setIsLoading(false);
      };

      const applyCoversFromMap = (items, covers) => {
        if (!covers || !items?.length) return items;
        return items.map((item) => {
          const coverPath = covers[item._coverDir] || covers[`${currentDir}/${item.id}`];
          if (!coverPath) return item;
          return { ...item, cover: { path: `file://${coverPath}` } };
        });
      };

      // Prefer native Kotlin indexer on Android; fall back to RNFS elsewhere.
      if (GalleryIndexer.isAvailable()) {
        const t0 = Date.now();
        // Warm cache from Camera prefetch — paint instantly when available.
        if (path.length === 0 && !usableCache) {
          const warm = await GalleryIndexer.getCachedListing(currentDir);
          if (gen !== loadGenRef.current) return;
          if (warm?.exists && (warm.dirs.length > 0 || warm.photos.length > 0)) {
            if (warm.dirs.length > 0) {
              let items = buildPatientAlbumItems(warm.dirs.map(toRnfsLikeDir));
              items = applyCoversFromMap(items, warm.covers);
              applyFolders(items);
            } else {
              applyPhotos(warm.photos.map(formatPhoto));
            }
            if (__DEV__) {
              console.log(`[Gallery] warm cache paint in ${Date.now() - t0}ms`);
            }
          }
        }

        const listing = await GalleryIndexer.listDirectory(
          currentDir,
          deletedArr,
          path.length <= 2
        );
        if (__DEV__) {
          console.log(`[Gallery] native listDirectory ${currentDir} in ${Date.now() - t0}ms (dirs=${listing.dirs?.length || 0}, photos=${listing.photos?.length || 0})`);
        }
        if (gen !== loadGenRef.current) return;

        if (!listing.exists) {
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
            applyFolders(items);
            // Refresh covers in background if prefetch omitted some.
            if (!listing.covers || Object.keys(listing.covers).length === 0) {
              GalleryIndexer.findLatestCovers(
                listing.dirs.map((d) => d.path),
                deletedArr
              ).then((covers) => {
                if (gen !== loadGenRef.current) return;
                const next = applyCoversFromMap(items, covers);
                setAlbumItems(next);
                setGallerySnapshot(path, next, [], ownerKey);
              }).catch(() => {});
            }
          } else {
            const recursive = await GalleryIndexer.listImagesRecursive(currentDir, deletedArr);
            if (gen !== loadGenRef.current) return;
            applyPhotos((recursive.photos || []).map(formatPhoto));
          }
          return;
        }

        if (path.length === 1) {
          const yearDirs = listing.dirs.filter((d) => /^\d{4}$/.test(d.name));
          if (yearDirs.length > 0) {
            let items = buildYearAlbumItems(yearDirs.map(toRnfsLikeDir));
            items = applyCoversFromMap(items, listing.covers);
            applyFolders(items);
          } else {
            const recursive = await GalleryIndexer.listImagesRecursive(currentDir, deletedArr);
            if (gen !== loadGenRef.current) return;
            applyPhotos((recursive.photos || []).map(formatPhoto));
          }
          return;
        }

        if (path.length === 2) {
          let items = buildMonthAlbumItems(listing.dirs.map(toRnfsLikeDir));
          items = applyCoversFromMap(items, listing.covers);
          applyFolders(items);
          return;
        }

        if (path.length === 3) {
          if (listing.photos.length > 0) {
            applyPhotos(listing.photos.map(formatPhoto));
          } else {
            let items = buildWeekAlbumItems(listing.dirs.map(toRnfsLikeDir));
            items = applyCoversFromMap(items, listing.covers);
            applyFolders(items);
          }
          return;
        }

        if (path.length === 4) {
          applyPhotos(listing.photos.map(formatPhoto));
        }
        return;
      }

      // ---- RNFS fallback (iOS / missing native module) ----
      const exists = await RNFS.exists(currentDir);
      if (gen !== loadGenRef.current) return;

      if (!exists) {
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

      const fillCoversLater = (dirs, setter) => {
        (async () => {
          try {
            const withCovers = await Promise.all(
              dirs.map(async (item) => {
                try {
                  const files = await getAllImageFilesRecursive(item._coverDir || `${currentDir}/${item.id}`);
                  const valid = files.filter((f) => !deletedFilesSet.has(f.path));
                  if (valid.length === 0) return item;
                  const latest = valid.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())[0];
                  return { ...item, cover: { path: `file://${latest.path}` } };
                } catch (_) {
                  return item;
                }
              })
            );
            if (gen === loadGenRef.current) setter(withCovers);
          } catch (_) { }
        })();
      };

      const applyFoldersWithCovers = (items) => {
        applyFolders(items);
        fillCoversLater(items, (next) => {
          setAlbumItems(next);
          setGallerySnapshot(path, next, [], ownerKey);
        });
      };

      if (path.length === 0) {
        const list = await RNFS.readDir(currentDir);
        if (gen !== loadGenRef.current) return;
        const dirs = list.filter((i) => i.isDirectory());
        if (dirs.length > 0) {
          applyFoldersWithCovers(buildPatientAlbumItems(dirs));
        } else {
          const files = await getAllImageFilesRecursive(currentDir);
          if (gen !== loadGenRef.current) return;
          const filtered = files.filter((f) => !deletedFilesSet.has(f.path));
          const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
          applyPhotos(sorted.map(formatPhoto));
        }
        return;
      }

      if (path.length === 1) {
        const list = await RNFS.readDir(currentDir);
        if (gen !== loadGenRef.current) return;
        const subdirs = list.filter((i) => i.isDirectory());
        const yearDirs = subdirs.filter((d) => /^\d{4}$/.test(d.name));
        if (yearDirs.length > 0) {
          applyFoldersWithCovers(buildYearAlbumItems(yearDirs));
        } else {
          const files = await getAllImageFilesRecursive(currentDir);
          if (gen !== loadGenRef.current) return;
          const filtered = files.filter((f) => !deletedFilesSet.has(f.path));
          const sorted = filtered.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
          applyPhotos(sorted.map(formatPhoto));
        }
        return;
      }

      if (path.length === 2) {
        const list = await RNFS.readDir(currentDir);
        if (gen !== loadGenRef.current) return;
        applyFoldersWithCovers(buildMonthAlbumItems(list.filter((i) => i.isDirectory())));
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
          applyPhotos(sorted.map((file) => formatPhoto({ ...file, directory: currentDir })));
        } else {
          applyFoldersWithCovers(buildWeekAlbumItems(list.filter((i) => i.isDirectory())));
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
        applyPhotos(sorted.map((file) => formatPhoto({ ...file, directory: currentDir })));
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
  }, [getBasePath, galleryOwnerKey, setCapturedPhotos]);

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
    const sub = DeviceEventEmitter.addListener(GALLERY_PHOTO_ADDED, (photo) => {
      if (!photo) return;
      const showingPhotos = capturedPhotosRef.current.length > 0 || albumItems.length === 0;
      if (!showingPhotos && albumPath.length < 3 && !isGuest) {
        return;
      }
      setIsLoading(false);
      setCapturedPhotos((prev) => {
        const abs = photo.absolutePath || photo.path?.replace('file://', '');
        if (prev.some((p) => (p.absolutePath || p.path?.replace('file://', '')) === abs)) {
          return prev;
        }
        return [photo, ...prev];
      });
      setAlbumItems([]);
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
    return () => {
      sub.remove();
      upd.remove();
    };
  }, [albumPath.length, albumItems.length, isGuest, capturedPhotosRef, setCapturedPhotos]);

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
  };
};

export default useGalleryAlbumNavigation;
