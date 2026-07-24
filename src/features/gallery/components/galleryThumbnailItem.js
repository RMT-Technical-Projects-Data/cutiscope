import React, { useEffect, useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import styles from '../styles/galleryScreenStyles';

const imageCache = new Map();

const ThumbnailItem = React.memo(({
  photo,
  isSelected,
  isSelectionMode,
  isGuest,
  onPress,
  onLongPress,
  onImageSettled,
}) => {
  const imageUri = photo?.path || null;
  const [isUploaded, setIsUploaded] = useState(false);

  useEffect(() => {
    if (!imageUri) {
      onImageSettled?.();
      return;
    }
    const cacheKey = `${imageUri}::${photo.imageVersion || 0}`;
    if (!imageCache.has(cacheKey)) {
      imageCache.set(cacheKey, imageUri);
    }
  }, [imageUri, photo.imageVersion, onImageSettled]);

  useEffect(() => {
    if (photo.uploadStatus === 'UPLOADED') {
      setIsUploaded(true);
      return;
    }
    if (['PENDING', 'FAILED', 'UPLOADING', 'CLOCK_SKEW'].includes(photo.uploadStatus)) {
      setIsUploaded(false);
      return;
    }
    // Prefer status already on the photo object — avoid N AsyncStorage reads on big folders.
    if (photo.uploadStatus != null) {
      setIsUploaded(photo.uploadStatus === 'UPLOADED');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cleanPath = (photo.absolutePath || photo.path.replace('file://', '')).split('?')[0];
        const status = await AsyncStorage.getItem(`uploaded_${cleanPath}`);
        if (!cancelled) setIsUploaded(status === 'true');
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [photo.path, photo.absolutePath, photo.uploadStatus]);

  return (
    <TouchableOpacity
      style={styles.thumbnailContainer}
      onPress={() => onPress(photo)}
      onLongPress={() => onLongPress(photo.path)}
      delayLongPress={300}
      activeOpacity={0.7}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={[styles.thumbnail, isSelectionMode && isSelected && styles.photoImageSelected]}
          resizeMode="cover"
          fadeDuration={0}
          onLoad={onImageSettled}
          onError={onImageSettled}
        />
      ) : null}
      {isSelectionMode && isSelected && (
        <View style={styles.selectedOverlay}><Text style={styles.selectedText}>✓</Text></View>
      )}
      {!isGuest && (
        <View style={styles.uploadedIndicator}>
          <View style={isUploaded ? styles.greenDot : styles.grayDot} />
        </View>
      )}
      {!isGuest && photo.timestamp && (
        <Text style={styles.photoTimestamp} numberOfLines={1}>
          {photo.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
    </TouchableOpacity>
  );
}, (prev, next) => (
  prev.photo.path === next.photo.path
  && prev.photo.imageVersion === next.photo.imageVersion
  && prev.photo.uploadStatus === next.photo.uploadStatus
  && prev.isSelected === next.isSelected
  && prev.isSelectionMode === next.isSelectionMode
  && prev.isGuest === next.isGuest
  && prev.onImageSettled === next.onImageSettled
));

export { imageCache };
export default ThumbnailItem;

