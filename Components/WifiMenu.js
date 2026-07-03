import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Platform, PermissionsAndroid, Image, ActivityIndicator, ToastAndroid } from 'react-native';
import KioskTextInput from './KioskTextInput';
import WifiManager from 'react-native-wifi-reborn';
import { Camera, useCameraDevices, useFrameProcessor } from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';

const WIFI_ICON = require('../assets/icon_wifi.png');
const CHECK_ICON = '✓';

const WifiMenu = ({ onClose }) => {
  const [networks, setNetworks] = useState([]);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [currentSSID, setCurrentSSID] = useState(null);
  const [password, setPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [wifiState, setWifiState] = useState('unknown');

  // Camera states
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraResult, setCameraResult] = useState('');

  const camera = useRef(null);
  const devices = useCameraDevices();
  const device = devices.back;

  useEffect(() => {
    // Request location permission for WiFi
    const requestLocationPermission = async () => {
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: 'Location Permission',
              message: 'This app needs location permission to access WiFi networks.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            }
          );
          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
            console.log('Location permission granted');
            fetchNetworks();
          } else {
            console.log('Location permission denied');
          }
        } catch (err) {
          console.warn(err);
        }
      }
    };

    // Request camera permission
    const requestCameraPermission = async () => {
      const cameraPermission = await Camera.requestCameraPermission();
      setHasCameraPermission(cameraPermission === 'authorized');
    };

    requestCameraPermission();
    fetchCurrentNetwork();
  }, []);

  const fetchCurrentNetwork = async () => {
    try {
      const ssid = await WifiManager.getCurrentWifiSSID();
      if (ssid && ssid !== '<unknown ssid>') {
        setCurrentSSID(ssid);
      } else {
        setCurrentSSID(null);
      }
    } catch (error) {
      console.warn('Error fetching current network', error);
      setCurrentSSID(null);
    }
  };

  const fetchNetworks = async () => {
    try {
      const wifiList = await WifiManager.loadWifiList();
      setNetworks(wifiList.map((network) => ({
        id: network.BSSID,
        name: network.SSID,
        requiresPassword: network.capabilities.includes('WPA') || network.capabilities.includes('WEP'),
      })));
      await fetchCurrentNetwork();
    } catch (error) {
      console.error('Failed to fetch WiFi networks', error);
    }
  };

  // Camera functionality
  const toggleCamera = () => {
    setIsCameraActive(!isCameraActive);
  };

  const captureImage = async () => {
    if (camera.current) {
      try {
        const photo = await camera.current.takePhoto({
          qualityPrioritization: 'speed',
          flash: 'off',
        });
        setCameraResult(`Image captured: ${photo.path}`);
        // Here you can add your computer vision processing
        // For example: processImage(photo.path);
      } catch (error) {
        console.error('Failed to capture image', error);
        setCameraResult('Failed to capture image');
      }
    }
  };

  // Basic frame processor for computer vision (example)
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    // This runs on a separate thread for real-time processing
    // You can add your computer vision logic here
    // Example: QR code detection, object detection, etc.
    console.log(`Frame: ${frame.width}x${frame.height}`);

    // If you want to update UI based on frame analysis:
    // runOnJS(setCameraResult)(`Processing frame: ${frame.width}x${frame.height}`);
  }, []);

  const handleWifiToggle = async () => {
    try {
      if (wifiState === 'enabled') {
        WifiManager.setEnabled(false);
        setWifiState('disabled');
      } else {
        WifiManager.setEnabled(true);
        setWifiState('enabled');
        fetchNetworks();
      }
    } catch (error) {
      console.error('Failed to toggle WiFi state', error);
    }
  };

  const handleConnect = async (network) => {
    if (network.name === currentSSID) return;
    if (network.requiresPassword) {
      setSelectedNetwork(network);
      setShowPasswordModal(true);
    } else {
      try {
        // bindNetwork = true ensures the OS uses this WiFi connection
        await WifiManager.connectToProtectedSSID(network.SSID, '', false, true);
        console.log(`Connecting to ${network.name} - OS will use this WiFi`);
        onClose();
      } catch (error) {
        console.error(`Failed to connect to ${network.name}`, error);
      }
    }
  };

  const handlePasswordSubmit = async () => {
    if (!password) {
      if (Platform.OS === 'android') {
        ToastAndroid.show('Password required', ToastAndroid.SHORT);
      }
      return;
    }
    try {
      // bindNetwork = true ensures the OS uses this WiFi connection
      await WifiManager.connectToProtectedSSID(selectedNetwork.SSID, password, false, true);
      console.log(`Connecting to ${selectedNetwork.name} with password - OS will use this WiFi`);
      setPassword('');
      setShowPasswordModal(false);
      onClose();
    } catch (error) {
      console.error(`Failed to connect to ${selectedNetwork.name} with password`, error);
    }
  };

  return (
    <View style={styles.modalContainer}>
      <ScrollView contentContainerStyle={styles.modalContent}>
        <Text style={styles.title}>WiFi Settings</Text>

        {/* Connected Network Section */}
        {wifiState === 'enabled' && currentSSID && (
          <View style={styles.connectedContainer}>
            <View style={styles.connectedHeader}>
              <View style={styles.iconContainer}>
                <Image source={WIFI_ICON} style={styles.connectedIcon} />
              </View>
              <View style={styles.connectedInfo}>
                <Text style={styles.connectedLabel}>Connected to</Text>
                <Text style={styles.connectedSSID}>{currentSSID}</Text>
              </View>
              {/* <View style={styles.connectedStatus}>
                 <Text style={styles.checkIcon}>{CHECK_ICON}</Text>
              </View> */}
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>Available Networks</Text>

        {/* Camera Section */}
        <View style={styles.cameraSection}>
          <Text style={styles.cameraTitle}>Camera Vision</Text>
          <TouchableOpacity style={styles.cameraButton} onPress={toggleCamera}>
            <Text style={styles.cameraButtonText}>
              {isCameraActive ? 'Stop Camera' : 'Start Camera'}
            </Text>
          </TouchableOpacity>

          {isCameraActive && device && hasCameraPermission && (
            <View style={styles.cameraContainer}>
              <Camera
                ref={camera}
                style={styles.camera}
                device={device}
                isActive={isCameraActive}
                photo={true}
                frameProcessor={frameProcessor}
              />
              <TouchableOpacity style={styles.captureButton} onPress={captureImage}>
                <Text style={styles.captureButtonText}>Capture</Text>
              </TouchableOpacity>
            </View>
          )}

          {cameraResult ? (
            <Text style={styles.cameraResult}>{cameraResult}</Text>
          ) : null}
        </View>

        {/* WiFi Networks Section */}
        {networks.filter(n => n.name !== currentSSID).length > 0 ? (
          networks.filter(n => n.name !== currentSSID).map((network) => (
            <TouchableOpacity
              key={network.id}
              style={styles.networkItem}
              onPress={() => handleConnect(network)}
            >
              <Text style={styles.networkName}>{network.name}</Text>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.networkName}>No networks found</Text>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.toggleButton} onPress={handleWifiToggle}>
        <Text style={styles.toggleButtonText}>{wifiState === 'enabled' ? 'Turn WiFi Off' : 'Turn WiFi On'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.closeButton} onPress={onClose}>
        <Text style={styles.closeButtonText}>Close</Text>
      </TouchableOpacity>

      {/* Password Modal */}
      <Modal
        visible={showPasswordModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.passwordModalContainer}>
          <Text style={styles.passwordPrompt}>Enter Password for {selectedNetwork?.name}</Text>
          <KioskTextInput
            style={styles.passwordInput}
            secureTextEntry
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            showDismiss={true}
          />
          <TouchableOpacity style={styles.submitButton} onPress={handlePasswordSubmit}>
            <Text style={styles.submitButtonText}>Connect</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={() => setShowPasswordModal(false)}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    width: '80%',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  cameraSection: {
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 5,
  },
  cameraTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  cameraButton: {
    padding: 10,
    backgroundColor: '#2196F3',
    borderRadius: 5,
    marginBottom: 10,
  },
  cameraButtonText: {
    color: 'white',
    textAlign: 'center',
  },
  cameraContainer: {
    alignItems: 'center',
  },
  camera: {
    width: 200,
    height: 200,
    marginBottom: 10,
  },
  captureButton: {
    padding: 10,
    backgroundColor: '#FF5722',
    borderRadius: 5,
  },
  captureButtonText: {
    color: 'white',
  },
  cameraResult: {
    marginTop: 10,
    fontSize: 12,
    color: '#666',
  },
  networkItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  networkName: {
    fontSize: 16,
  },
  toggleButton: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 5,
  },
  toggleButtonText: {
    color: 'white',
    fontSize: 16,
  },
  closeButton: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#ddd',
    borderRadius: 5,
  },
  closeButtonText: {
    fontSize: 16,
  },
  passwordModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  passwordPrompt: {
    fontSize: 18,
    color: 'white',
    marginBottom: 10,
  },
  passwordInput: {
    width: '80%',
    padding: 10,
    backgroundColor: 'black',
    borderRadius: 5,
    marginBottom: 10,
  },
  submitButton: {
    padding: 10,
    backgroundColor: '#004949',
    borderRadius: 5,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
  },
  connectedContainer: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#30D158',
  },
  connectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(48, 209, 88, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  connectedIcon: {
    width: 24,
    height: 24,
    tintColor: '#30D158',
  },
  connectedInfo: {
    flex: 1,
  },
  connectedLabel: {
    fontSize: 12,
    color: '#30D158',
    marginBottom: 2,
    fontWeight: '600',
  },
  connectedSSID: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  connectedStatus: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkIcon: {
    fontSize: 20,
    color: '#30D158',
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 10,
  }
});

export default WifiMenu;