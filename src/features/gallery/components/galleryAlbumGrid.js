import React, { useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { FlatList, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import styles from '../styles/galleryScreenStyles';

const FolderTile = memo(({
  item,
  pathKey,
  isSelected,
  isSelectionMode,
  isGuest,
  onToggleSelection,
  onOpenAlbum,
}) => (
  <TouchableOpacity
    style={[styles.folderTile, isSelectionMode && isSelected && styles.folderTileSelected]}
    onPress={() => (isSelectionMode ? onToggleSelection(pathKey) : onOpenAlbum(item.id))}
    onLongPress={() => {
      if (isGuest) return;
      if (isSelectionMode) onToggleSelection(pathKey);
      else onOpenAlbum(item.id, pathKey);
    }}
    delayLongPress={300}
    activeOpacity={0.7}
  >
    {item.cover?.path ? (
      <Image
        source={{ uri: item.cover.path }}
        style={styles.folderImage}
        resizeMode="cover"
        fadeDuration={0}
      />
    ) : (
      <View style={[styles.folderImage, styles.folderPlaceholder]} />
    )}
    {isSelectionMode && isSelected && (
      <View style={styles.folderSelectedOverlay}>
        <Text style={styles.folderSelectedText}>✓</Text>
      </View>
    )}
    <Text style={styles.folderName} numberOfLines={1}>
      {item.nameLabel || item.idLabel}
    </Text>
    <Text style={styles.folderCount}>{item.count > 0 ? `${item.count} photos` : ''}</Text>
  </TouchableOpacity>
), (prev, next) => (
  prev.item.id === next.item.id
  && prev.item.cover?.path === next.item.cover?.path
  && prev.item.nameLabel === next.item.nameLabel
  && prev.isSelected === next.isSelected
  && prev.isSelectionMode === next.isSelectionMode
  && prev.pathKey === next.pathKey
));

/**
 * Album tiles. Covers are prefetched before paint, so show immediately —
 * no hide-until-ready overlay (that caused loading/flicker loops).
 */
const GalleryAlbumGrid = ({
  albumItems,
  albumPath,
  isGuest,
  isSelectionMode,
  selectedAlbumPaths,
  onToggleSelection,
  onOpenAlbum,
  onCoversReady,
}) => {
  const signature = useMemo(
    () => (albumItems || []).map((i) => `${i.id}:${i.cover?.path || ''}`).join('|'),
    [albumItems]
  );
  const readyForSigRef = useRef('');

  useEffect(() => {
    if (readyForSigRef.current === signature) return;
    readyForSigRef.current = signature;
    onCoversReady?.();
  }, [signature, onCoversReady]);

  const renderItem = useCallback(({ item }) => {
    const pathKey = albumPath.length === 0 ? item.id : [...albumPath, item.id].join('/');
    const isSelected = selectedAlbumPaths.includes(pathKey);
    return (
      <FolderTile
        item={item}
        pathKey={pathKey}
        isSelected={isSelected}
        isSelectionMode={isSelectionMode}
        isGuest={isGuest}
        onToggleSelection={onToggleSelection}
        onOpenAlbum={onOpenAlbum}
      />
    );
  }, [albumPath, isGuest, isSelectionMode, onOpenAlbum, onToggleSelection, selectedAlbumPaths]);

  if ((albumItems?.length || 0) <= 48) {
    const rows = [];
    for (let i = 0; i < albumItems.length; i += 2) {
      rows.push(albumItems.slice(i, i + 2));
    }
    return (
      <ScrollView
        contentContainerStyle={[
          styles.foldersContainer,
          isSelectionMode && selectedAlbumPaths.length > 0 && { paddingBottom: 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {rows.map((row, idx) => (
          <View key={`row_${idx}`} style={styles.folderRow}>
            {row.map((item) => {
              const pathKey = albumPath.length === 0 ? item.id : [...albumPath, item.id].join('/');
              return (
                <FolderTile
                  key={item.id}
                  item={item}
                  pathKey={pathKey}
                  isSelected={selectedAlbumPaths.includes(pathKey)}
                  isSelectionMode={isSelectionMode}
                  isGuest={isGuest}
                  onToggleSelection={onToggleSelection}
                  onOpenAlbum={onOpenAlbum}
                />
              );
            })}
            {row.length === 1 ? (
              <View style={styles.folderTileSpacer} pointerEvents="none" />
            ) : null}
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <FlatList
      data={albumItems}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      numColumns={2}
      contentContainerStyle={[
        styles.foldersContainer,
        isSelectionMode && selectedAlbumPaths.length > 0 && { paddingBottom: 100 },
      ]}
      columnWrapperStyle={styles.folderRow}
      showsVerticalScrollIndicator={false}
      extraData={`${isSelectionMode}:${selectedAlbumPaths.length}`}
      removeClippedSubviews={false}
      initialNumToRender={albumItems.length}
      maxToRenderPerBatch={albumItems.length}
      windowSize={21}
    />
  );
};

export default GalleryAlbumGrid;
