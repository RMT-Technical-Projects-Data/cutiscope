import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const HEADER_FOOTER_BG = '#000000';
const PRIMARY_TEXT = '#FFFFFF';
const ACCENT_TEAL = '#22B2A6';

/**
 * Bottom action bar for gallery selection (photos or albums).
 */
const GalleryActions = ({
  mode = 'photos',
  isGuest = false,
  canUpload = false,
  selectedAlbumCount = 0,
  uploadIcon,
  deleteIcon,
  onUpload,
  onDelete,
  onShare,
  onDeleteAlbums,
}) => {
  if (mode === 'albums') {
    if (isGuest) return null;
    return (
      <View style={[styles.actionContainer, styles.actionContainerCentered]}>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={onDeleteAlbums}
        >
          <Image source={deleteIcon} style={[styles.actionIcon, { tintColor: ACCENT_TEAL }]} />
          <Text style={styles.btnText}>
            Delete {selectedAlbumCount} Album(s)
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.actionContainer}>
      <View style={styles.actionSlot}>
        {!isGuest && canUpload ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={onUpload}
          >
            <Image source={uploadIcon} style={[styles.actionIcon, { tintColor: ACCENT_TEAL }]} />
            <Text style={styles.btnText}>Upload</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.actionSlot}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onDelete}
        >
          <Image source={deleteIcon} style={[styles.actionIcon, { tintColor: ACCENT_TEAL }]} />
          <Text style={styles.btnText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.actionSlot}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onShare}
        >
          <MaterialCommunityIcons name="bluetooth" size={30} color={ACCENT_TEAL} style={{ marginBottom: 4 }} />
          <Text style={styles.btnText}>Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  actionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'space-between',
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 20,
    backgroundColor: HEADER_FOOTER_BG,
    height: 90,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  actionContainerCentered: {
    justifyContent: 'center',
  },
  actionSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    paddingVertical: 3,
    fontSize: 14,
    fontWeight: '500',
    color: PRIMARY_TEXT,
    textAlign: 'center',
  },
  actionIcon: {
    width: 30,
    height: 30,
    marginBottom: 5,
  },
});

export default GalleryActions;
