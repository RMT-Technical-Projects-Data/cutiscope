import { useMemo } from 'react';
import {
  getGalleryOwnerKey,
  getGallerySnapshot,
} from '../gallerySnapshotCache';

const useGalleryOwnerAndCache = ({ isGuest, userData, getUsername }) => {
  const galleryOwnerKey = useMemo(() => getGalleryOwnerKey({
    isGuest,
    userId: userData?.id,
    username: userData?.username || getUsername(),
  }), [isGuest, userData?.id, userData?.username, getUsername]);

  const initialCache = useMemo(
    () => getGallerySnapshot([], galleryOwnerKey),
    [galleryOwnerKey]
  );

  return { galleryOwnerKey, initialCache };
};

export default useGalleryOwnerAndCache;
