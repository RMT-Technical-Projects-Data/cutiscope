import React from 'react';
import {
  StyleSheet,
  View,
  Image,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import ZoomControl from '../cameraZoomRuler';

import settingsIcon from '../../../../assets/icon_settings.png';
import CaptureBtn from '../../../../assets/capture.png';
import CapturePressedBtn from '../../../../assets/capture_pressed.png';
import GalleryBtn from '../../../../assets/icon_gallery.png';
import torchOffIcon from '../../../../assets/Dermscope_Torch_Icon_OFF_-removebg-preview.png';
import polarisedIcon from '../../../../assets/Untitled_design-removebg-preview.png';
import nonPolarisedIcon from '../../../../assets/Gemini_Generated_Image_w2zk1ow2zk1ow2zk-removebg-preview.png';

/**
 * Bottom chrome: settings / light / patient / body-part row + gallery / capture / zoom.
 */
export default function CameraChrome({
  // Settings / power
  handleSettingsPress,
  ignoreKeysRef,
  setIsLightOn,
  // Light / torch / polarization
  cameraError,
  onLightButtonPressIn,
  onLightButtonPressOut,
  onLightButtonPress,
  isLightOn,
  showTorchOnly,
  polIconColor,
  // Patient / body part
  isGuest,
  forceTorchOffUntilUserTaps,
  setPatientBoxModalVisible,
  setBodyPartModalVisible,
  currentBox,
  bodyPart,
  // Gallery
  handleGalleryPress,
  latestPhotoUri,
  // Capture
  startContinuousCapture,
  stopContinuousCapture,
  isCapturing,
  onCapturePress,
  // Zoom
  zoom,
  minZoom,
  maxZoom,
  setZoomBtnValue,
  resetInactivityTimer,
  zoomBtnValue,
}) {
  return (
    <>
      {/* ========== BLACK BACKGROUND WITH SETTINGS AND POLARIZATION ========== */}
      <View style={styles.blackBackground}>
        <TouchableOpacity
          style={[styles.menuItemSettings]}
          onPress={handleSettingsPress}
          onLongPress={() => {
            console.log('🔌 UI Request: Opening PowerOff modal via event');
            ignoreKeysRef.current = true;
            setIsLightOn(false);
            DeviceEventEmitter.emit('requestPowerMenu');
          }}
          activeOpacity={0.7}
        >
          <Image
            source={settingsIcon}
            style={[styles.icon]}
          />
        </TouchableOpacity>

        {/* ========== LIGHT TOGGLE BUTTON ========== */}
        {/* ========== LIGHT TOGGLE BUTTON ========== */}
        <Pressable
          style={[styles.menuItemLight, cameraError && { opacity: 0.5 }]}
          disabled={!!cameraError}
          onPressIn={onLightButtonPressIn}
          onPressOut={onLightButtonPressOut}
          // onLongPress={onLightButtonLongPress}
          delayLongPress={300}
          onPress={onLightButtonPress}
        >
          <View>
            <Image
              source={
                !isLightOn
                  ? torchOffIcon
                  : showTorchOnly  // During the torch-only phase (500ms)
                    ? torchOffIcon   // Show torchOnIcon
                    : polIconColor === 'nonPolarised'
                      ? nonPolarisedIcon
                      : polarisedIcon
              }
              style={[
                styles.icon,
                // Only apply size modifiers when NOT in torch-only phase AND light is on
                isLightOn && !showTorchOnly && polIconColor === 'nonPolarised' && styles.smallerIcon,
                isLightOn && !showTorchOnly && polIconColor === 'polarised' && styles.widerPolarisedIcon,
              ]}
            />
          </View>
        </Pressable>

        {/* ========== BOX / PATIENT (hidden in guest mode; set ID & name; images save to that folder) ========== */}
        {!isGuest && (
          <TouchableOpacity
            style={[styles.menuItemLight, styles.boxButtonWrapper]}
            // onPress={() => setPatientBoxModalVisible(true)}
            onPress={() => {
              forceTorchOffUntilUserTaps();
              setPatientBoxModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="folder-account"
              size={40}
              color={currentBox?.id ? '#22B2A6' : '#fff'}
            />
          </TouchableOpacity>
        )}

        {/* ========== BODY PART ICON ========== */}
        {!isGuest && (
          <TouchableOpacity
            style={[styles.menuItemLight, styles.boxButtonWrapper]}
            // onPress={() => setBodyPartModalVisible(true)}
            onPress={() => {
              forceTorchOffUntilUserTaps();
              setBodyPartModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="human"
              size={40}
              color={bodyPart ? '#22B2A6' : '#fff'}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* ========== UNIFIED BOTTOM CONTROLS ========== */}
      <View style={styles.bottomControlsContainer}>
        {/* LEFT: Gallery */}
        <View style={styles.leftContainer}>
          <TouchableOpacity
            style={styles.galleryButtonWrapper}
            onPress={handleGalleryPress}>
            {/* key forces remount so Android Image cache does not keep a deleted thumb */}
            <Image
              key={latestPhotoUri?.path ? `gallery-thumb-${latestPhotoUri.path}` : 'gallery-empty'}
              source={
                latestPhotoUri?.path
                  ? { uri: `file://${latestPhotoUri.path}` }
                  : GalleryBtn
              }
              style={styles.galleryIcon}
            />
          </TouchableOpacity>
        </View>

        {/* CENTER: Capture – hold for continuous burst (processing waits 3s after last shot) */}
        <View style={styles.centerContainer}>
          <TouchableOpacity
            style={[styles.captureButtonWrapper, cameraError && { opacity: 0.5 }]}
            disabled={!!cameraError}
            onPressIn={startContinuousCapture}
            onPressOut={stopContinuousCapture}
            activeOpacity={0.6}
          >
            {isCapturing ? (
              <ActivityIndicator size="large" color="#22B2A6" />
            ) : (
              <Image
                source={onCapturePress ? CapturePressedBtn : CaptureBtn}
                style={styles.captureIcon}
              />
            )}
          </TouchableOpacity>
        </View>

        {/* RIGHT: Zoom Control */}
        <View style={styles.rightContainer}>
          <View style={styles.zoomControlBoxWrapper}>
            <ZoomControl
              zoom={zoom}
              minZoom={minZoom}
              maxZoom={maxZoom}
              onZoomChange={(val) => {
                setZoomBtnValue(val);
                resetInactivityTimer();
              }}
              isCompact={true}
              currentZoom={zoomBtnValue}
              disabled={!!cameraError}
            />
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  blackBackground: {
    width: '100%',
    height: '10%',
    backgroundColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    bottom: '27%',
    gap: 40,
  },
  bottomControlsContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    paddingBottom: 40,
  },
  leftContainer: {
    flex: 1,
    alignItems: 'flex-start',
    paddingLeft: 30,
  },
  centerContainer: {
    width: 120,
    alignItems: 'center',
  },
  rightContainer: {
    flex: 1,
    alignItems: 'flex-end',
    paddingRight: 30,
  },
  galleryButtonWrapper: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
  },
  captureButtonWrapper: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureIcon: {
    width: 90,
    height: 90,
    resizeMode: 'contain',
  },
  zoomControlBoxWrapper: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  menuItemSettings: {
    width: 45,
    height: 45,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
  },
  menuItemLight: {
    width: 45,
    height: 45,
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  boxButtonWrapper: {
    marginLeft: 8,
  },
  icon: {
    width: 45,
    height: 45,
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
  },
  smallerIcon: {
    width: 53,
    height: 53,
  },
  widerPolarisedIcon: {
    width: 57,
    height: 40,
  },
});
