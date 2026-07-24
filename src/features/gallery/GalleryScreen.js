import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  UIManager,
  DeviceEventEmitter,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '../auth/authSessionContext';
import ConfirmationModal from '../../shared/ui/ConfirmationModal';
import { ScreenHeader } from '../../shared/ui';
import BluetoothShareModal from '../bluetooth/BluetoothShareModal';
import { showInAppToast } from '../../shared/utils/inAppToast';
import FullScreenGalleryModal from './FullScreenGalleryModal';
import GalleryActions from './components/GalleryActions';
import GalleryAlbumGrid from './components/galleryAlbumGrid';
import DeletionLoader from './components/galleryDeletionLoader';
import GalleryPhotoGrid from './components/galleryPhotoGrid';
import styles from './styles/galleryScreenStyles';
import { ACCENT_TEAL, screenHeight, width, formatAlbumPathTitle, isPhotoUploaded } from './utils/galleryPathUtils';
import useGallerySelection from './hooks/useGallerySelection';
import useGalleryOwnerAndCache from './hooks/useGalleryOwnerAndCache';
import useGalleryDelete from './hooks/useGalleryDelete';
import useGalleryAlbumNavigation from './hooks/useGalleryAlbumNavigation';
import useGalleryUpload from './hooks/useGalleryUpload';

import deleteIcon from '../../../assets/icon_delete.png';
import uploadIcon from '../../../assets/icon_upload.png';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const GalleryScreen = ({ route, navigation }) => {
  const { userData, isGuest, getUsername } = useAuth();
  const { galleryOwnerKey, initialCache } = useGalleryOwnerAndCache({
    isGuest,
    userData,
    getUsername,
  });
  const [capturedPhotos, setCapturedPhotos] = useState(() => initialCache?.capturedPhotos || []);
  const capturedPhotosRef = React.useRef(capturedPhotos);
  const {
    isSelectionMode,
    selectedPhotos,
    selectedAlbumPaths,
    setIsSelectionMode,
    setSelectedPhotos,
    setSelectedAlbumPaths,
    toggleAlbumSelection,
    toggleAllAlbums,
    toggleAllPhotos,
    togglePhotoSelection,
  } = useGallerySelection();
  const [fullScreenPhoto, setFullScreenPhoto] = useState(null);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({
    title: '',
    message: '',
    confirmText: '',
    cancelText: 'Cancel',
    isDestructive: false,
    onConfirm: () => { },
  });
  const [bluetoothShareVisible, setBluetoothShareVisible] = useState(false);
  const [bluetoothShareFiles, setBluetoothShareFiles] = useState([]);
  const [bluetoothShareLabels, setBluetoothShareLabels] = useState([]);
  const [powerMenuOpen, setPowerMenuOpen] = useState(false);

  useEffect(() => {
    capturedPhotosRef.current = capturedPhotos;
  }, [capturedPhotos]);

  useEffect(() => {
    const subOpen = DeviceEventEmitter.addListener('onPowerMenuOpened', () => setPowerMenuOpen(true));
    const subClose = DeviceEventEmitter.addListener('onPowerMenuClosed', () => setPowerMenuOpen(false));
    return () => {
      subOpen.remove();
      subClose.remove();
    };
  }, []);

  const {
    albumPath,
    setAlbumPath,
    albumItems,
    setAlbumItems,
    isLoading,
    setIsLoading,
    hasLoaded,
    forceRefreshCounter,
    setForceRefreshCounter,
    getBasePath,
    removeDeletedAlbumsLocally,
    markPhotoLeafReady,
  } = useGalleryAlbumNavigation({
    isGuest,
    userData,
    getUsername,
    galleryOwnerKey,
    initialCache,
    setCapturedPhotos,
    capturedPhotosRef,
  });

  const handleAlbumCoversReady = useCallback(() => {
    setIsLoading(false);
  }, [setIsLoading]);

  const handlePhotosReady = useCallback(() => {
    markPhotoLeafReady?.();
  }, [markPhotoLeafReady]);

  const {
    clearDeletedFiles,
    isDeleting,
    handleSelectAllAlbums,
    handleDeleteSelectedAlbums,
    handleDeleteCurrentImage,
    handleDeleteSelected,
  } = useGalleryDelete({
    getBasePath,
    albumItems,
    albumPath,
    selectedAlbumPaths,
    selectedPhotos,
    fullScreenPhoto,
    toggleAllAlbums,
    setSelectedAlbumPaths,
    setSelectedPhotos,
    setIsSelectionMode,
    setForceRefreshCounter,
    setCapturedPhotos,
    setFullScreenPhoto,
    setConfirmConfig,
    setConfirmModalVisible,
    removeDeletedAlbumsLocally,
  });

  const activePhotos = useMemo(() => capturedPhotos, [capturedPhotos]);

  const getShareLabel = useCallback((photo) => {
    if (!photo || !photo.name) return '';
    let patientText = '';
    let bodyPartText = '';
    const bpIndex = photo.name.indexOf('_BP-');
    if (bpIndex !== -1) {
      if (bpIndex > 9) {
        patientText = photo.name.substring(10, bpIndex);
      }
      const matchBody = photo.name.match(/_BP-(.*?)_\d+_\d+\.jpg/);
      if (matchBody) {
        bodyPartText = matchBody[1].replace(/_/g, ' ');
      }
    } else {
      const matchPatientNoBody = photo.name.match(/^Cutiscope_(.*?)_\d{8}_\d{6}\.jpg/);
      if (matchPatientNoBody) {
        patientText = matchPatientNoBody[1];
      }
    }
    return [patientText, bodyPartText].filter(Boolean).join(' | ');
  }, []);

  const {
    isUploading,
    uploadProgress,
    uploadTotal,
    handleUploadImage,
    handleUploadSelectedImages,
  } = useGalleryUpload({
    isGuest,
    getUsername,
    selectedPhotos,
    activePhotos,
    getShareLabel,
    setCapturedPhotos,
    setSelectedPhotos,
    setIsSelectionMode,
    setConfirmConfig,
    setConfirmModalVisible,
  });

  const handleBluetoothShareSuccess = useCallback(() => {
    setSelectedPhotos([]);
    setIsSelectionMode(false);
    setFullScreenPhoto(null);
  }, [setSelectedPhotos, setIsSelectionMode]);

  const handleBackPress = useCallback(() => {
    if (albumPath.length > 0) {
      setAlbumPath((prev) => prev.slice(0, -1));
      setIsSelectionMode(false);
      setSelectedPhotos([]);
      setSelectedAlbumPaths([]);
      return;
    }
    if (isSelectionMode) {
      setSelectedPhotos([]);
      setSelectedAlbumPaths([]);
      setIsSelectionMode(false);
    } else {
      navigation?.goBack?.() || navigation?.navigate?.('Camera');
    }
  }, [albumPath.length, isSelectionMode, navigation, setAlbumPath, setIsSelectionMode, setSelectedPhotos, setSelectedAlbumPaths]);

  const handlePhotoPress = useCallback((photo) => {
    if (isSelectionMode) {
      togglePhotoSelection(photo.path);
    } else {
      setFullScreenPhoto(photo);
    }
  }, [isSelectionMode, togglePhotoSelection]);

  const handlePhotoLongPress = useCallback((photoId) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
    }
    togglePhotoSelection(photoId);
  }, [isSelectionMode, togglePhotoSelection, setIsSelectionMode]);

  const handleBluetoothShareSelected = useCallback(() => {
    if (selectedPhotos.length === 0) {
      showInAppToast('No images selected!', { durationMs: 2000, position: 'bottom' });
      return;
    }
    const labels = selectedPhotos.map((path) => {
      const photo = activePhotos.find((p) => p.path === path || p.absolutePath === path.replace('file://', ''));
      return photo ? getShareLabel(photo) : '';
    });
    setBluetoothShareFiles(selectedPhotos);
    setBluetoothShareLabels(labels);
    setBluetoothShareVisible(true);
  }, [selectedPhotos, activePhotos, getShareLabel]);

  const handleSelectAll = useCallback(() => {
    toggleAllPhotos(activePhotos);
  }, [activePhotos, toggleAllPhotos]);

  const isPhotoLevel = activePhotos.length > 0;
  const isFolderLevel = albumItems.length > 0 && !isPhotoLevel;

  const canUploadSelection = useMemo(() => {
    if (selectedPhotos.length === 0) return false;
    return selectedPhotos.every((path) => {
      const cleanPath = path.replace('file://', '');
      const photo = activePhotos.find((p) => p.path === path || (p.absolutePath || p.path?.replace('file://', '')) === cleanPath);
      return photo && !isPhotoUploaded(photo) && photo.uploadStatus !== 'UPLOADING' && photo.uploadStatus !== 'PENDING' && photo.uploadStatus !== 'CLOCK_SKEW';
    });
  }, [selectedPhotos, activePhotos]);

  const galleryTitle = useMemo(() => {
    if (albumPath.length === 0) return 'Gallery';
    if (isSelectionMode && activePhotos.length > 0) {
      return `Photos (${selectedPhotos.length} selected)`;
    }
    if (isSelectionMode && isFolderLevel) {
      return `Albums (${selectedAlbumPaths.length} selected)`;
    }
    return formatAlbumPathTitle(albumPath, albumItems);
  }, [
    albumPath,
    albumItems,
    isSelectionMode,
    activePhotos.length,
    selectedPhotos.length,
    isFolderLevel,
    selectedAlbumPaths.length,
  ]);

  const fullScreenInitialIndex = useMemo(() => {
    if (!fullScreenPhoto || activePhotos.length === 0) return 0;
    let i = activePhotos.findIndex((p) => p.id === fullScreenPhoto.id);
    if (i === -1) i = activePhotos.findIndex((p) => p.path === fullScreenPhoto.path);
    return i >= 0 ? i : 0;
  }, [fullScreenPhoto, activePhotos]);

  const fullScreenImageUrls = useMemo(
    () =>
      activePhotos.map((photo) => ({
        url: photo.path,
        width,
        height: screenHeight,
        props: {
          source: { uri: photo.path },
          fadeDuration: 0,
          resizeMode: 'contain',
        },
      })),
    [activePhotos]
  );

  return (
    <GestureHandlerRootView style={styles.container}>
      <View
        style={styles.container}
        onStartShouldSetResponder={() => {
          DeviceEventEmitter.emit('userActivity');
          return false;
        }}
      >
        <ScreenHeader
          onBack={handleBackPress}
          title={galleryTitle}
          right={
            isSelectionMode && isPhotoLevel && activePhotos.length > 0 ? (
              <TouchableOpacity
                style={[
                  styles.selectAllButton,
                  selectedPhotos.length === activePhotos.length && styles.unselectAllButton
                ]}
                onPress={handleSelectAll}
              >
                <Text style={styles.selectAllText}>
                  {selectedPhotos.length === activePhotos.length ? 'Unselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
            ) : isSelectionMode && isFolderLevel && albumItems.length > 0 ? (
              <TouchableOpacity
                style={[
                  styles.selectAllButton,
                  selectedAlbumPaths.length === albumItems.length && styles.unselectAllButton
                ]}
                onPress={handleSelectAllAlbums}
              >
                <Text style={styles.selectAllText}>
                  {selectedAlbumPaths.length === albumItems.length ? 'Unselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
            ) : null
          }
        />

        {isGuest && albumPath.length === 0 && (
          <View style={styles.guestHintBanner}>
            <Text style={styles.guestHintText} selectable={false}>
              Temporary storage. Photos will be deleted when you exit guest mode.
            </Text>
          </View>
        )}

        {isLoading && !hasLoaded ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={ACCENT_TEAL} />
            <Text style={styles.loadingText}>Loading, please wait…</Text>
          </View>
        ) : hasLoaded && !isFolderLevel && !isPhotoLevel ? (
          <View style={styles.emptyMemories}>
            <Text style={styles.emptyMemoriesText}>
              {isGuest ? 'No photos in guest mode' : 'No photos found'}
            </Text>
            <Text style={styles.emptyMemoriesSubText}>
              {isGuest
                ? 'Capture images to get started. They will be removed when you exit guest mode.'
                : 'Images will appear here from your camera gallery'}
            </Text>
          </View>
        ) : isFolderLevel ? (
          <View style={{ flex: 1 }}>
            <GalleryAlbumGrid
              albumItems={albumItems}
              albumPath={albumPath}
              isGuest={isGuest}
              isSelectionMode={isSelectionMode}
              selectedAlbumPaths={selectedAlbumPaths}
              onToggleSelection={toggleAlbumSelection}
              onCoversReady={handleAlbumCoversReady}
              onOpenAlbum={(id, selectPath) => {
                if (selectPath) {
                  setIsSelectionMode(true);
                  setSelectedAlbumPaths([selectPath]);
                  return;
                }
                setAlbumPath((previous) => [...previous, id]);
                setIsSelectionMode(false);
                setSelectedPhotos([]);
                setSelectedAlbumPaths([]);
              }}
            />
          </View>
        ) : isPhotoLevel ? (
          <View style={{ flex: 1 }}>
            {isLoading ? (
              <View style={[styles.loadingContainer, { position: 'absolute', zIndex: 2, left: 0, right: 0, top: 0, bottom: 0 }]}>
                <ActivityIndicator size="large" color={ACCENT_TEAL} />
                <Text style={styles.loadingText}>Loading, please wait…</Text>
              </View>
            ) : null}
            <GalleryPhotoGrid
              photos={activePhotos}
              selectedPhotos={selectedPhotos}
              isSelectionMode={isSelectionMode}
              isGuest={isGuest}
              onPhotoPress={handlePhotoPress}
              onPhotoLongPress={handlePhotoLongPress}
              onPhotosReady={handlePhotosReady}
            />
          </View>
        ) : null}

        <FullScreenGalleryModal
          visible={!!fullScreenPhoto}
          photos={activePhotos}
          imageUrls={fullScreenImageUrls}
          initialIndex={fullScreenInitialIndex}
          onClose={() => setFullScreenPhoto(null)}
          onDelete={handleDeleteCurrentImage}
          onUpload={handleUploadImage}
          isGuest={isGuest}
          powerMenuOpen={powerMenuOpen}
          getShareLabel={getShareLabel}
          onBluetoothShare={(photo) => {
            const label = getShareLabel ? getShareLabel(photo) : '';
            setBluetoothShareFiles([photo.path]);
            setBluetoothShareLabels([label]);
            setBluetoothShareVisible(true);
          }}
        />

        {isSelectionMode && selectedPhotos.length > 0 && (
          <GalleryActions
            mode="photos"
            isGuest={isGuest}
            canUpload={canUploadSelection}
            uploadIcon={uploadIcon}
            deleteIcon={deleteIcon}
            onUpload={handleUploadSelectedImages}
            onDelete={handleDeleteSelected}
            onShare={handleBluetoothShareSelected}
          />
        )}
        {isSelectionMode && selectedAlbumPaths.length > 0 && (
          <GalleryActions
            mode="albums"
            isGuest={isGuest}
            selectedAlbumCount={selectedAlbumPaths.length}
            deleteIcon={deleteIcon}
            onDeleteAlbums={handleDeleteSelectedAlbums}
          />
        )}

        <ConfirmationModal
          visible={confirmModalVisible}
          onClose={() => setConfirmModalVisible(false)}
          title={confirmConfig.title}
          message={confirmConfig.message}
          confirmText={confirmConfig.confirmText}
          cancelText={confirmConfig.cancelText}
          isDestructive={confirmConfig.isDestructive}
          onConfirm={() => {
            const action = confirmConfig.onConfirm;
            setConfirmModalVisible(false);
            setTimeout(() => {
              if (typeof action === 'function') {
                Promise.resolve(action()).catch((err) => {
                  console.error('Confirmation action failed:', err);
                });
              }
            }, 120);
          }}
        />

        <BluetoothShareModal
          visible={bluetoothShareVisible}
          selectedFiles={bluetoothShareFiles}
          selectedLabels={bluetoothShareLabels}
          onClose={() => setBluetoothShareVisible(false)}
          onShareSuccess={handleBluetoothShareSuccess}
        />

        <DeletionLoader visible={isDeleting} />
      </View>
    </GestureHandlerRootView>
  );
};

export default GalleryScreen;
