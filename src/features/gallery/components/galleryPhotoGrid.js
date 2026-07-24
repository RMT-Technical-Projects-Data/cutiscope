import React, { useCallback } from 'react';
import { FlatList, Platform } from 'react-native';
import ThumbnailItem from './galleryThumbnailItem';
import styles from '../styles/galleryScreenStyles';
import { normalizePhotoPath } from '../utils/galleryPathUtils';

const GalleryPhotoGrid = ({
  photos,
  selectedPhotos,
  isSelectionMode,
  isGuest,
  onPhotoPress,
  onPhotoLongPress,
}) => {
  const renderItem = useCallback(({ item: photo }) => (
    <ThumbnailItem
      photo={photo}
      isSelected={selectedPhotos.includes(photo.path)}
      isSelectionMode={isSelectionMode}
      isGuest={isGuest}
      onPress={onPhotoPress}
      onLongPress={onPhotoLongPress}
    />
  ), [selectedPhotos, isSelectionMode, isGuest, onPhotoPress, onPhotoLongPress]);

  const keyExtractor = useCallback((item) => normalizePhotoPath(item) || item.id, []);

  return (
    <FlatList
      key="photos_grid"
      data={photos}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={3}
      contentContainerStyle={[styles.photosContainer, isSelectionMode && selectedPhotos.length > 0 && { paddingBottom: 100 }]}
      showsVerticalScrollIndicator={false}
      initialNumToRender={18}
      maxToRenderPerBatch={9}
      windowSize={7}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={Platform.OS === 'android'}
      extraData={`${isSelectionMode}:${selectedPhotos.length}`}
    />
  );
};

export default GalleryPhotoGrid;
