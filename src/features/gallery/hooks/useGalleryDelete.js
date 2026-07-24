import { useCallback, useEffect, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildS3PathFromImage, deleteObjectFromS3 } from '../../upload/S3UploadService';
import ImageDatabase from '../../upload/localImageDatabase';
import { DELETED_FILES_KEY } from '../utils/galleryPathUtils';
import { imageCache as IMAGE_CACHE } from '../components/galleryThumbnailItem';
import { showInAppToast } from '../../../shared/utils/inAppToast';
import GalleryIndexer from '../../../shared/native/GalleryIndexer';

const useGalleryDelete = ({
  getBasePath,
  albumItems,
  albumPath,
  selectedAlbumPaths,
  selectedPhotos,
  fullScreenPhoto,
  toggleAllAlbums,
  setSelectedAlbumPaths,
  setSelectedPhotos,
  setIsSelectionMode,
  setForceRefreshCounter,
  setCapturedPhotos,
  setFullScreenPhoto,
  setConfirmConfig,
  setConfirmModalVisible,
  removeDeletedAlbumsLocally,
}) => {
  const [deletedFiles, setDeletedFiles] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletedFilesLoaded, setDeletedFilesLoaded] = useState(false);

  useEffect(() => {
    const loadDeletedFiles = async () => {
      try {
        const value = await AsyncStorage.getItem(DELETED_FILES_KEY);
        if (value) setDeletedFiles(new Set(JSON.parse(value)));
      } catch (error) {
        console.log('Error loading deleted files:', error);
      } finally {
        setDeletedFilesLoaded(true);
      }
    };
    loadDeletedFiles();
  }, []);

  useEffect(() => {
    if (!deletedFilesLoaded) return;
    AsyncStorage.setItem(DELETED_FILES_KEY, JSON.stringify([...deletedFiles]))
      .catch((error) => console.log('Error saving deleted files:', error));
  }, [deletedFiles, deletedFilesLoaded]);

  const runWithDeletionLoader = useCallback(async (work) => {
    setIsDeleting(true);
    const startedAt = Date.now();
    try {
      await work();
    } finally {
      const remaining = 500 - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      setIsDeleting(false);
    }
  }, []);

  const clearDeletedFiles = useCallback(async () => {
    await AsyncStorage.removeItem(DELETED_FILES_KEY);
    setDeletedFiles(new Set());
  }, []);

  const deleteFileWithCleanup = useCallback(async (filePath) => {
    const cleanPath = filePath.replace('file://', '');

    try {
      try {
        const image = await ImageDatabase.getImageByFilePath(cleanPath);
        if (image && image.uploadStatus === 'UPLOADED') {
          const { fullKey } = buildS3PathFromImage(image);
          await deleteObjectFromS3(fullKey);
        }
      } catch (s3DeleteErr) {
        console.warn('S3 delete during cleanup:', s3DeleteErr);
      }

      if (GalleryIndexer.isAvailable()) {
        await GalleryIndexer.deletePaths([cleanPath]);
      } else {
        try {
          const { SystemTimeModule } = NativeModules;
          if (SystemTimeModule && SystemTimeModule.deleteFileRoot) {
            await SystemTimeModule.deleteFileRoot(cleanPath);
          }
        } catch (rootError) {
          console.warn('Root deletion failed, falling back to standard deletion:', rootError);
        }

        const fileExists = await RNFS.exists(cleanPath);
        if (fileExists) {
          await RNFS.unlink(cleanPath);
          if (Platform.OS === 'android') {
            try {
              await RNFS.scanFile(cleanPath);
            } catch (error) {
              console.warn('Error updating media store:', error);
            }
          }
        }
      }

      setDeletedFiles(prev => {
        const newSet = new Set(prev);
        newSet.add(cleanPath);
        return newSet;
      });

      IMAGE_CACHE.delete(filePath);
      IMAGE_CACHE.delete(cleanPath);
      IMAGE_CACHE.delete(`file://${cleanPath}`);

      try {
        await AsyncStorage.removeItem(`uploaded_${cleanPath}`);
      } catch (e) {
        console.warn('Error clearing upload status:', e);
      }
      try {
        await ImageDatabase.removeImageByFilePath(cleanPath);
      } catch (e) {
        console.warn('Error removing from image registry:', e);
      }
      return true;
    } catch (error) {
      console.error(`Error deleting file ${cleanPath}:`, error);
      throw error;
    }
  }, []);

  // Fast bulk delete via GalleryIndexer (root + MediaStore + prune + cache invalidate).
  const batchDeleteFiles = useCallback(async (rawPaths) => {
    const paths = Array.from(
      new Set(
        (rawPaths || [])
          .map((p) => (p || '').replace('file://', ''))
          .filter(Boolean)
      )
    );
    if (paths.length === 0) return;

    let deleted = false;
    if (GalleryIndexer.isAvailable()) {
      try {
        deleted = await GalleryIndexer.deletePaths(paths);
      } catch (e) {
        console.warn('GalleryIndexer.deletePaths failed, falling back:', e);
      }
    }

    if (!deleted) {
      const { SystemTimeModule } = NativeModules;
      try {
        if (SystemTimeModule && SystemTimeModule.deletePathsRoot) {
          deleted = await SystemTimeModule.deletePathsRoot(paths);
        }
      } catch (e) {
        console.warn('Batch root delete failed, falling back:', e);
      }
      if (!deleted) {
        await Promise.all(
          paths.map(async (p) => {
            try {
              if (SystemTimeModule && SystemTimeModule.deleteFileRoot) {
                await SystemTimeModule.deleteFileRoot(p);
              }
            } catch (_) { }
            try {
              if (await RNFS.exists(p)) await RNFS.unlink(p);
            } catch (_) { }
          })
        );
      }
    }

    paths.forEach((p) => {
      IMAGE_CACHE.delete(p);
      IMAGE_CACHE.delete(`file://${p}`);
    });
    setDeletedFiles((prev) => {
      const next = new Set(prev);
      paths.forEach((p) => next.add(p));
      return next;
    });

    (async () => {
      try {
        await Promise.all(
          paths.map(async (p) => {
            try {
              const image = await ImageDatabase.getImageByFilePath(p);
              if (image && image.uploadStatus === 'UPLOADED') {
                const { fullKey } = buildS3PathFromImage(image);
                await deleteObjectFromS3(fullKey).catch(() => { });
              }
            } catch (_) { }
          })
        );
      } finally {
        try {
          await ImageDatabase.removeImagesByFilePaths(paths);
        } catch (_) { }
        await Promise.all(
          paths.map(async (p) => {
            try {
              await AsyncStorage.removeItem(`uploaded_${p}`);
            } catch (_) { }
          })
        );
      }
    })();
  }, []);

  const deleteFolderRecursive = useCallback(async (dirPath) => {
    if (GalleryIndexer.isAvailable()) {
      await GalleryIndexer.deletePaths([dirPath]);
      return;
    }
    let list;
    try {
      list = await RNFS.readDir(dirPath);
    } catch (e) {
      console.warn('Could not read dir for delete:', dirPath, e);
      return;
    }
    for (const item of list) {
      const fullPath = item.path;
      if (item.isDirectory()) {
        await deleteFolderRecursive(fullPath);
        try {
          await RNFS.unlink(fullPath);
        } catch (e) {
          if (Platform.OS === 'android') {
            try {
              const { SystemTimeModule } = NativeModules;
              if (SystemTimeModule && SystemTimeModule.deleteFileRoot) {
                await SystemTimeModule.deleteFileRoot(fullPath);
              }
            } catch (rootE) {
              console.log('Could not remove dir:', fullPath, e);
            }
          } else {
            console.log('Could not remove dir:', fullPath, e);
          }
        }
      } else {
        try {
          await RNFS.unlink(fullPath);
        } catch (e) {
          if (Platform.OS === 'android') {
            try {
              const { SystemTimeModule } = NativeModules;
              if (SystemTimeModule && SystemTimeModule.deleteFileRoot) {
                await SystemTimeModule.deleteFileRoot(fullPath);
              }
            } catch (rootE) {
              console.log('Could not remove file:', fullPath, e);
            }
          } else {
            console.log('Could not remove file:', fullPath, e);
          }
        }
      }
    }
  }, []);

  const deleteAlbumWithAllImages = useCallback(async (pathSegments) => {
    const base = getBasePath();
    const fullPath = pathSegments.length === 0 ? base : `${base}/${pathSegments.join('/')}`;

    let imagePaths = [];
    try {
      if (GalleryIndexer.isAvailable()) {
        const recursive = await GalleryIndexer.listImagesRecursive(fullPath, []);
        imagePaths = (recursive.photos || []).map((f) => f.path);
      } else {
        const exists = await RNFS.exists(fullPath);
        if (!exists) return;
        const getAllImageFilesRecursive = async (dirPath) => {
          let results = [];
          try {
            const list = await RNFS.readDir(dirPath);
            for (const item of list) {
              if (item.isDirectory()) {
                results = results.concat(await getAllImageFilesRecursive(item.path));
              } else if (item.isFile() && item.name.match(/\.(jpg|jpeg|png|gif|bmp)$/i) && !item.name.startsWith('compressed_')) {
                results.push(item);
              }
            }
          } catch (_) { }
          return results;
        };
        const imageFiles = await getAllImageFilesRecursive(fullPath);
        imagePaths = imageFiles.map((f) => f.path);
      }
    } catch (_) { }

    await batchDeleteFiles([...imagePaths, fullPath]);
  }, [getBasePath, batchDeleteFiles]);

  const handleSelectAllAlbums = useCallback(() => {
    toggleAllAlbums(albumItems, albumPath);
  }, [albumItems, albumPath, toggleAllAlbums]);

  const handleDeleteSelectedAlbums = useCallback(() => {
    if (selectedAlbumPaths.length === 0) {
      showInAppToast('No albums selected', { durationMs: 2000, position: 'bottom' });
      return;
    }
    const count = selectedAlbumPaths.length;
    setConfirmConfig({
      title: 'Delete Album(s)',
      message: `Delete ${count} album(s) and all images inside permanently?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: async () => {
        try {
          const pathsToDelete = [...selectedAlbumPaths];
          await runWithDeletionLoader(async () => {
            for (const pathKey of pathsToDelete) {
              const pathSegments = pathKey.split('/').filter(Boolean);
              await deleteAlbumWithAllImages(pathSegments);
            }
            // Drop from UI + snapshot immediately so refresh cannot resurrect them.
            if (typeof removeDeletedAlbumsLocally === 'function') {
              removeDeletedAlbumsLocally(pathsToDelete);
            }
            try {
              const base = getBasePath();
              const parent =
                albumPath.length === 0 ? base : `${base}/${albumPath.join('/')}`;
              await GalleryIndexer.invalidate(parent);
            } catch (_) { }
            setSelectedAlbumPaths([]);
            setIsSelectionMode(false);
            setForceRefreshCounter((c) => c + 1);
          });
          showInAppToast(`${count} album(s) deleted`, { durationMs: 2000, position: 'bottom' });
        } catch (error) {
          console.error('Failed to delete albums:', error);
          showInAppToast('Delete failed', { durationMs: 2000, position: 'bottom' });
        }
      }
    });
    setConfirmModalVisible(true);
  }, [selectedAlbumPaths, deleteAlbumWithAllImages, runWithDeletionLoader, setConfirmConfig, setConfirmModalVisible, setSelectedAlbumPaths, setIsSelectionMode, setForceRefreshCounter, removeDeletedAlbumsLocally, getBasePath, albumPath]);

  const handleDeleteCurrentImage = useCallback(async (photoObj) => {
    const targetPhoto = photoObj && photoObj.path ? photoObj : fullScreenPhoto;
    if (!targetPhoto) return;
    setConfirmConfig({
      title: "Delete Image",
      message: "Delete this image permanently?",
      confirmText: "Delete",
      cancelText: "Cancel",
      isDestructive: true,
      onConfirm: async () => {
        try {
          await runWithDeletionLoader(async () => {
            await batchDeleteFiles([targetPhoto.path]);
            setCapturedPhotos(prev => {
              const nextPhotos = prev.filter(img => img.path !== targetPhoto.path);
              if (nextPhotos.length === 0) setFullScreenPhoto(null);
              return nextPhotos;
            });
          });
          showInAppToast("Image deleted!", { durationMs: 2000, position: 'bottom' });
        } catch (error) {
          console.error('Failed to delete image:', error);
          showInAppToast("Delete failed!", { durationMs: 2000, position: 'bottom' });
        }
      }
    });
    setConfirmModalVisible(true);
  }, [fullScreenPhoto, batchDeleteFiles, runWithDeletionLoader, setConfirmConfig, setConfirmModalVisible, setCapturedPhotos, setFullScreenPhoto]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedPhotos.length === 0) {
      showInAppToast("No images selected!", { durationMs: 2000, position: 'bottom' });
      return;
    }
    setConfirmConfig({
      title: "Delete Images",
      message: `Delete ${selectedPhotos.length} image(s) permanently?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      isDestructive: true,
      onConfirm: async () => {
        try {
          const targets = [...selectedPhotos];
          await runWithDeletionLoader(async () => {
            await batchDeleteFiles(targets);
            const normTargets = new Set(targets.map(p => (p || '').replace('file://', '')));
            setCapturedPhotos(prev => {
              const nextPhotos = prev.filter(img => !normTargets.has((img.path || '').replace('file://', '')));
              if (nextPhotos.length === 0) setFullScreenPhoto(null);
              return nextPhotos;
            });
            setSelectedPhotos([]);
            setIsSelectionMode(false);
          });
          showInAppToast(`${targets.length} image(s) deleted!`, { durationMs: 2000, position: 'bottom' });
        } catch (error) {
          console.error("Failed to delete images:", error);
          showInAppToast("Delete failed!", { durationMs: 2000, position: 'bottom' });
        }
      }
    });
    setConfirmModalVisible(true);
  }, [selectedPhotos, batchDeleteFiles, runWithDeletionLoader, setConfirmConfig, setConfirmModalVisible, setCapturedPhotos, setFullScreenPhoto, setSelectedPhotos, setIsSelectionMode]);

  return {
    clearDeletedFiles,
    deletedFiles,
    isDeleting,
    runWithDeletionLoader,
    setDeletedFiles,
    deleteFileWithCleanup,
    batchDeleteFiles,
    deleteFolderRecursive,
    deleteAlbumWithAllImages,
    handleSelectAllAlbums,
    handleDeleteSelectedAlbums,
    handleDeleteCurrentImage,
    handleDeleteSelected,
  };
};

export default useGalleryDelete;
