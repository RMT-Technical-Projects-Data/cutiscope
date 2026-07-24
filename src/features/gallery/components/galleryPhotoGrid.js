import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, View, StyleSheet } from 'react-native';
import ThumbnailItem from './galleryThumbnailItem';
import styles from '../styles/galleryScreenStyles';
import { normalizePhotoPath } from '../utils/galleryPathUtils';

/**
 * Photo leaf grid. Stays hidden under the parent spinner until every thumb
 * has settled (onLoad/onError), then reveals in one shot.
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
  const [revealed, setRevealed] = useState(needed === 0);

  useEffect(() => {
    settledRef.current = 0;
    setRevealed(needed === 0);
    if (needed === 0) {
      readySigRef.current = signature;
      onPhotosReady?.();
      return undefined;
    }
    // Large folders: FlatList virtualizes — reveal after prefetch (already done in hook).
    if (needed > 72) {
      readySigRef.current = signature;
      setRevealed(true);
      onPhotosReady?.();
      return undefined;
    }
    const t = setTimeout(() => {
      if (readySigRef.current !== signature) {
        readySigRef.current = signature;
        setRevealed(true);
        onPhotosReady?.();
      }
    }, 6000);
    return () => clearTimeout(t);
  }, [signature, needed, onPhotosReady]);

  const onThumbSettled = useCallback(() => {
    settledRef.current += 1;
    if (settledRef.current >= needed && readySigRef.current !== signature) {
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
        key={`photos_grid_${signature}`}
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

const local = StyleSheet.create({
  wrap: { flex: 1 },
  hide: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
});

export default GalleryPhotoGrid;
