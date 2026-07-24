import React, { useCallback } from 'react';
import { FlatList, Image, Text, TouchableOpacity, View } from 'react-native';
import styles from '../styles/galleryScreenStyles';

const GalleryAlbumGrid = ({
  albumItems,
  albumPath,
  isGuest,
  isSelectionMode,
  selectedAlbumPaths,
  onToggleSelection,
  onOpenAlbum,
}) => {
  const renderItem = useCallback(({ item }) => {
    const pathKey = albumPath.length === 0 ? item.id : [...albumPath, item.id].join('/');
    const isSelected = selectedAlbumPaths.includes(pathKey);
    return (
      <TouchableOpacity
        style={[styles.folderTile, isSelectionMode && isSelected && styles.folderTileSelected]}
        onPress={() => isSelectionMode ? onToggleSelection(pathKey) : onOpenAlbum(item.id)}
        onLongPress={() => {
          if (isGuest) return;
          if (isSelectionMode) onToggleSelection(pathKey);
          else onOpenAlbum(item.id, pathKey);
        }}
        delayLongPress={300}
        activeOpacity={0.7}
      >
        {item.cover?.path
          ? <Image source={{ uri: item.cover.path }} style={styles.folderImage} resizeMode="cover" />
          : <View style={[styles.folderImage, styles.folderPlaceholder]} />}
        {isSelectionMode && isSelected && (
          <View style={styles.folderSelectedOverlay}><Text style={styles.folderSelectedText}>✓</Text></View>
        )}
        <Text style={styles.folderName} numberOfLines={1}>{item.nameLabel || item.idLabel}</Text>
        <Text style={styles.folderCount}>{item.count > 0 ? `${item.count} photos` : ''}</Text>
      </TouchableOpacity>
    );
  }, [albumPath, isGuest, isSelectionMode, onOpenAlbum, onToggleSelection, selectedAlbumPaths]);

  return (
    <FlatList
      key={`folders_grid_${isSelectionMode}_${selectedAlbumPaths.length}`}
      data={albumItems}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      numColumns={2}
      contentContainerStyle={[styles.foldersContainer, isSelectionMode && selectedAlbumPaths.length > 0 && { paddingBottom: 100 }]}
      columnWrapperStyle={styles.folderRow}
      showsVerticalScrollIndicator={false}
      extraData={[selectedAlbumPaths, isSelectionMode, albumItems]}
    />
  );
};

export default GalleryAlbumGrid;
