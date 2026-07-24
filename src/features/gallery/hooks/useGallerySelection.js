import { useCallback, useState } from 'react';

const useGallerySelection = () => {
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [selectedAlbumPaths, setSelectedAlbumPaths] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const clearSelection = useCallback(() => {
    setSelectedPhotos([]);
    setSelectedAlbumPaths([]);
    setIsSelectionMode(false);
  }, []);

  const togglePhotoSelection = useCallback((photoId) => {
    setSelectedPhotos((previous) => {
      const next = previous.includes(photoId)
        ? previous.filter((id) => id !== photoId)
        : [...previous, photoId];
      if (next.length === 0) setIsSelectionMode(false);
      return next;
    });
  }, []);

  const toggleAlbumSelection = useCallback((pathKey) => {
    setSelectedAlbumPaths((previous) => (
      previous.includes(pathKey)
        ? previous.filter((key) => key !== pathKey)
        : [...previous, pathKey]
    ));
  }, []);

  const toggleAllPhotos = useCallback((photos) => {
    if (selectedPhotos.length === photos.length && photos.length > 0) {
      setSelectedPhotos([]);
      setIsSelectionMode(false);
      return;
    }
    setSelectedPhotos(photos.map((photo) => photo.path));
    setIsSelectionMode(true);
  }, [selectedPhotos.length]);

  const toggleAllAlbums = useCallback((albums, albumPath) => {
    const pathKeys = albums.map((item) => (
      albumPath.length === 0 ? item.id : [...albumPath, item.id].join('/')
    ));
    const allSelected = pathKeys.length > 0 && pathKeys.every((key) => selectedAlbumPaths.includes(key));
    if (allSelected) {
      setSelectedAlbumPaths([]);
      setIsSelectionMode(false);
      return;
    }
    setSelectedAlbumPaths(pathKeys);
    setIsSelectionMode(true);
  }, [selectedAlbumPaths]);

  return {
    isSelectionMode,
    selectedPhotos,
    selectedAlbumPaths,
    setIsSelectionMode,
    setSelectedPhotos,
    setSelectedAlbumPaths,
    clearSelection,
    toggleAlbumSelection,
    toggleAllAlbums,
    toggleAllPhotos,
    togglePhotoSelection,
  };
};

export default useGallerySelection;
