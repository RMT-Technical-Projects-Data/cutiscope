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
}) => {
  const [imageUri, setImageUri] = useState(null);
  const [isUploaded, setIsUploaded] = useState(false);

  useEffect(() => {
    const uri = photo.path;
    if (!uri) return;
    const cacheKey = `${uri}::${photo.imageVersion || 0}`;
    if (imageCache.has(cacheKey)) {
      setImageUri(imageCache.get(cacheKey));
      return;
    }
    try {
      imageCache.set(cacheKey, uri);
      setImageUri(uri);
    } catch (error) {
      console.log('Error loading thumbnail:', error);
    }
  }, [photo.path, photo.imageVersion]);

  useEffect(() => {
    if (photo.uploadStatus === 'UPLOADED') {
      setIsUploaded(true);
      return;
    }
    if (['PENDING', 'FAILED', 'UPLOADING'].includes(photo.uploadStatus)) {
      setIsUploaded(false);
      return;
    }
    const checkUploadStatus = async () => {
      try {
        const cleanPath = (photo.absolutePath || photo.path.replace('file://', '')).split('?')[0];
        const status = await AsyncStorage.getItem(`uploaded_${cleanPath}`);
        setIsUploaded(status === 'true');
      } catch (error) {
        console.log('Error checking upload status:', error);
      }
    };
    checkUploadStatus();
  }, [photo.path, photo.absolutePath, photo.uploadStatus]);

  return (
    <TouchableOpacity
      style={styles.thumbnailContainer}
      onPress={() => onPress(photo)}
      onLongPress={() => onLongPress(photo.path)}
      delayLongPress={300}
      activeOpacity={0.7}
    >
      {imageUri && (
        <Image
          key={`${imageUri}::${photo.imageVersion || 0}`}
          source={{ uri: imageUri }}
          style={[styles.thumbnail, isSelectionMode && isSelected && styles.photoImageSelected]}
          resizeMode="cover"
          fadeDuration={0}
        />
      )}
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
));

export { imageCache };
export default ThumbnailItem;
