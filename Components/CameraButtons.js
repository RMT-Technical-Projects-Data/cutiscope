import React from 'react';
import { TouchableOpacity, Image, Text, View } from 'react-native';

const CameraButtons = ({
  isPressed,
  setIsPressed,
  handleSettingsPress,
  handleFocusBtn,
  handlePolarizationBtn,
  stopPolarization,
  handleCapturePress,
  onCapturePress,
  setOnCapturePress,
  handleGalleryPress,
  handleZoomPress,
  showScale,
  zoomBtnValue,
  latestPhotoUri,
  mapZoomToDisplay,
  settingsIcon,
  focusIcon,
  PolIcon,
  CaptureBtn,
  CapturePressedBtn,
  GalleryBtn,
  isPolPressed,
  styles
}) => {
  return (
    <>
      <View style={styles.blackBackground}>
        <TouchableOpacity
          style={[styles.menuItemSettings, isPressed === 'Settings']}
          onPress={handleSettingsPress}
          onPressIn={() => setIsPressed('Settings')}
          onPressOut={() => setIsPressed(null)}
          activeOpacity={1}
        >
          <Image
            source={settingsIcon}
            style={[
              styles.icon,
              isPressed === 'Settings' && { tintColor: '#22B2A6' },
            ]}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleFocusBtn}
          activeOpacity={1}
          style={[styles.menuItemFocus]}>
          <Image
            source={focusIcon}
            style={[
              styles.icon,
              isPressed === 'focus' && { tintColor: '#22B2A6' },
            ]}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handlePolarizationBtn}
          onLongPress={stopPolarization}
          activeOpacity={1}
          style={[styles.menuItemPol]}>
          <Image
            source={PolIcon}
            style={[
              styles.icon,
              isPolPressed === 'Polarization' && { tintColor: 'white', backgroundColor: 'grey', borderRadius: 50, padding: 20 },
              isPolPressed === 'CrossPolarization' && { tintColor: '#000000', backgroundColor: '#22B2A6', borderRadius: 50, padding: 20 },
            ]}
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.captureButton}
        onPress={handleCapturePress}
        onPressIn={() => {
          setOnCapturePress(true);
        }}
        onPressOut={() => {
          setOnCapturePress(false);
        }}>
        {onCapturePress ? (
          <Image source={CapturePressedBtn} style={styles.captureButton} />
        ) : (
          <Image source={CaptureBtn} style={styles.captureButton} />
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.galleryButton}
        onPress={handleGalleryPress}>
        <Image
          source={
            latestPhotoUri
              ? { uri: `file://${latestPhotoUri.path}` }
              : GalleryBtn
          }
          style={styles.galleryButton}
        />
      </TouchableOpacity>

      <TouchableOpacity style={[styles.zoomButton, { backgroundColor: showScale ? '#f9b039' : '#4f4f4f' }]} onPress={handleZoomPress}>
        <Text style={[styles.buttonText, { color: showScale ? '#000000' : 'white' }]}>
          {mapZoomToDisplay(zoomBtnValue)}x
        </Text>
      </TouchableOpacity>
    </>
  );
};

export default CameraButtons;
