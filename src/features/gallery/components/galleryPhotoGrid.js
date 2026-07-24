import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, View, StyleSheet } from 'react-native';
import ThumbnailItem from './galleryThumbnailItem';
import styles from '../styles/galleryScreenStyles';
import { normalizePhotoPath } from '../utils/galleryPathUtils';

/**
 * Photo leaf grid. Loading/hide happens once per open; soft refreshes stay visible.
 */
const GalleryPhotoGrid = ({
  photos,
  selectedPhotos,
  isSelectionMode,
  isGuest,
  onPhotoPress,
  onPhotoLongPress,
  onPhotosReady,
}) => {
  const count = photos?.length || 0;
  const signature = useMemo(
    () => (photos || []).map((p) => `${normalizePhotoPath(p) || p.id}:${p.imageVersion || 0}`).join('|'),
    [photos]
  );
  const needed = count;
  const settledRef = useRef(0);
  const readySigRef = useRef('');
  const revealedRef = useRef(false);
  const [revealed, setRevealed] = useState(needed === 0);

  useEffect(() => {
    if (needed === 0) {
      revealedRef.current = false;
      readySigRef.current = signature;
      setRevealed(true);
      onPhotosReady?.();
      return undefined;
    }

    // Soft refresh while already showing — do not hide / re-spin.
    if (revealedRef.current) {
      readySigRef.current = signature;
      setRevealed(true);
      onPhotosReady?.();
      return undefined;
    }

    settledRef.current = 0;
    setRevealed(false);

    if (needed > 72) {
      revealedRef.current = true;
      readySigRef.current = signature;
      setRevealed(true);
      onPhotosReady?.();
      return undefined;
    }

    const t = setTimeout(() => {
      if (!revealedRef.current) {
        revealedRef.current = true;
        readySigRef.current = signature;
        setRevealed(true);
        onPhotosReady?.();
      }
    }, 6000);
    return () => clearTimeout(t);
  }, [signature, needed, onPhotosReady]);

  const onThumbSettled = useCallback(() => {
    settledRef.current += 1;
    if (settledRef.current >= needed && !revealedRef.current) {
      revealedRef.current = true;
      readySigRef.current = signature;
      setRevealed(true);
      onPhotosReady?.();
    }
  }, [needed, signature, onPhotosReady]);

  const renderItem = useCallback(({ item: photo }) => (
    <ThumbnailItem
      photo={photo}
      isSelected={selectedPhotos.includes(photo.path)}
      isSelectionMode={isSelectionMode}
      isGuest={isGuest}
      onPress={onPhotoPress}
      onLongPress={onPhotoLongPress}
      onImageSettled={onThumbSettled}
    />
  ), [selectedPhotos, isSelectionMode, isGuest, onPhotoPress, onPhotoLongPress, onThumbSettled]);

  const keyExtractor = useCallback((item) => normalizePhotoPath(item) || item.id, []);

  const renderAll = count > 0 && count <= 72;
  const listProps = useMemo(() => {
    if (renderAll) {
      return {
        initialNumToRender: count,
        maxToRenderPerBatch: count,
        windowSize: Math.max(5, Math.ceil(count / 3) + 2),
        removeClippedSubviews: false,
        updateCellsBatchingPeriod: 16,
      };
    }
    return {
      initialNumToRender: 24,
      maxToRenderPerBatch: 12,
      windowSize: 9,
      removeClippedSubviews: Platform.OS === 'android',
      updateCellsBatchingPeriod: 40,
    };
  }, [renderAll, count]);

  return (
    <View style={local.wrap}>
      <FlatList
        key={`photos_grid_${albumStableKey(signature, revealedRef.current)}`}
        data={photos}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={3}
        contentContainerStyle={[styles.photosContainer, isSelectionMode && selectedPhotos.length > 0 && { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        extraData={`${isSelectionMode}:${selectedPhotos.length}:${count}:${revealed}`}
        {...listProps}
      />
      {!revealed ? <View style={local.hide} pointerEvents="none" /> : null}
    </View>
  );
};

/** Keep FlatList instance stable after first reveal so soft refreshes do not remount. */
function albumStableKey(signature, alreadyRevealed) {
  return alreadyRevealed ? 'ready' : signature;
}

const local = StyleSheet.create({
  wrap: { flex: 1 },
  hide: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
});

export default GalleryPhotoGrid;
