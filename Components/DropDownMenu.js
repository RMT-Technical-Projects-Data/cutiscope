import React, { useState, useRef } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, Modal, Animated, Text } from 'react-native';
import WifiMenu from './WifiMenu';
import WifiManager from 'react-native-wifi-reborn';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';

// Camera Modal Component moved outside the main component
const CameraModal = ({ visible, onClose, device, hasPermission, cameraRef, onCapture }) => (
  <Modal
    visible={visible}
    animationType="slide"
    onRequestClose={onClose}
  >
    <View style={styles.cameraContainer}>
      <TouchableOpacity style={styles.cameraBackButton} onPress={onClose}>
        <Image source={require('../assets/icon_back.png')} style={styles.cameraBackIcon} />
      </TouchableOpacity>
      
      {device && hasPermission ? (
        <>
          <Camera
            ref={cameraRef}
            style={styles.camera}
            device={device}
            isActive={visible}
            photo={true}
          />
          <TouchableOpacity style={styles.captureButton} onPress={onCapture}>
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.cameraPermissionContainer}>
          <Text style={styles.cameraPermissionText}>
            {hasPermission ? 'Camera not available' : 'Camera permission required'}
          </Text>
        </View>
      )}
    </View>
  </Modal>
);

const DropDownMenu = () => {
  const [menuVisible, setMenuVisible] = useState(false);
  const [wifiMenuVisible, setWifiMenuVisible] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [menuWidth] = useState(new Animated.Value(0));
  const [wifiState, setWifiState] = useState('unknown');
  
  // Camera states
  const camera = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const toggleMenu = () => {
    setMenuVisible(!menuVisible);
    Animated.timing(menuWidth, {
      toValue: menuVisible ? 0 : 300,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const handleLongPressWifi = () => {
    setWifiMenuVisible(true);
  };

  const handleWifiToggle = async () => {
    try {
      if (wifiState === 'enabled') {
        await WifiManager.setEnabled(false);
        setWifiState('disabled');
        console.log("Wifi State: " + wifiState);
      } else {
        await WifiManager.setEnabled(true);
        setWifiState('enabled');
        console.log("Wifi State: " + wifiState);
      }
    } catch (error) {
      console.error('Failed to toggle WiFi state', error);
    }
  };

  // Camera functionality
  const openCamera = async () => {
    if (!hasPermission) {
      const permissionGranted = await requestPermission();
      if (!permissionGranted) {
        console.log('Camera permission denied');
        return;
      }
    }
    setCameraVisible(true);
  };

  const closeCamera = () => {
    setCameraVisible(false);
  };

  const captureImage = async () => {
    if (camera.current) {
      try {
        const photo = await camera.current.takePhoto();
        console.log('Image captured:', photo.path);
        // You can add computer vision processing here
      } catch (error) {
        console.error('Failed to capture image:', error);
      }
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.button} onPress={toggleMenu}>
        <Image source={require('../assets/down.png')} style={styles.arrowIcon} />
      </TouchableOpacity>
      <Animated.View style={[styles.menu, { width: menuWidth }]}>
        <TouchableOpacity style={styles.menuItem} onPress={handleWifiToggle} onLongPress={handleLongPressWifi}>
          <Image source={require('../assets/icon_wifi.png')} style={styles.icon} />
        </TouchableOpacity>
        
        {/* Camera Menu Item */}
        <TouchableOpacity style={styles.menuItem} onPress={openCamera}>
          <Image source={require('../assets/icon_camera.png')} style={styles.icon} />
        </TouchableOpacity>
        
        {/* Other menu items can be added here */}
      </Animated.View>
      
      {/* Wifi Menu Modal */}
      <Modal
        visible={wifiMenuVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setWifiMenuVisible(false)}
      >
        <WifiMenu onClose={() => setWifiMenuVisible(false)} />
      </Modal>
      
      {/* Camera Modal */}
      <CameraModal
        visible={cameraVisible}
        onClose={closeCamera}
        device={device}
        hasPermission={hasPermission}
        cameraRef={camera}
        onCapture={captureImage}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    // No extra styling needed for the button
  },
  arrowIcon: {
    width: 30,
    height: 30,
  },
  menu: {
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: 'rgba(128, 128, 128, 0.5)',
    borderRadius: 5,
    marginTop: 10,
    height: 50,
    alignItems: 'center',
    elevation: 2,
  },
  menuItem: {
    padding: 15,
  },
  icon: {
    width: 24,
    height: 24,
  },
  // Camera Styles
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  cameraBackButton: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 10,
    padding: 10,
  },
  cameraBackIcon: {
    width: 30,
    height: 30,
    tintColor: 'white',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  captureButton: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
  },
  cameraPermissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraPermissionText: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
  },
});

export default DropDownMenu;