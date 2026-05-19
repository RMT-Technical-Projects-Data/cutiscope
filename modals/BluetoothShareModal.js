import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Dimensions,
  NativeModules,
  FlatList,
  DeviceEventEmitter,
  ActivityIndicator,
  PermissionsAndroid,
  Platform
} from 'react-native';
import CustomStatusBar from '../Components/CustomStatusBar';
import ToggleSwitch from 'toggle-switch-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showInAppToast } from '../utils/Helpers';
import backIcon from '../assets/icon_back.png';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import KioskMode from '../utils/KioskMode';

const { SystemTimeModule } = NativeModules;
const { width } = Dimensions.get('window');

const BluetoothShareModal = ({ visible, onClose, selectedFiles, selectedLabels, onShareSuccess }) => {
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [sharingAddress, setSharingAddress] = useState(null);

  // Load Bluetooth State and check permissions on open
  useEffect(() => {
    if (visible) {
      // Temporarily exit Kiosk mode to permit standard Bluetooth activities / sharing intents
      // KioskMode.stopKioskMode()
      //   .then(() => console.log('[BluetoothShareModal] Kiosk Mode stopped successfully'))
      //   .catch(err => console.warn('[BluetoothShareModal] Failed to stop Kiosk Mode', err));

      checkAndActivateBluetooth();
    } else {
      stopScan();
    }
  }, [visible]);

  // Bluetooth event listeners
  useEffect(() => {
    if (!visible) return;

    const foundSub = DeviceEventEmitter.addListener('onBluetoothDeviceFound', (device) => {
      setScannedDevices(prev => {
        if (!pairedDevices.find(d => d.address === device.address) &&
          !prev.find(d => d.address === device.address)) {
          return [...prev, device];
        }
        return prev;
      });
    });

    const finishSub = DeviceEventEmitter.addListener('onBluetoothDiscoveryFinished', () => {
      setIsScanning(false);
    });

    return () => {
      foundSub.remove();
      finishSub.remove();
    };
  }, [visible, pairedDevices]);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];
        if (Platform.Version >= 31) {
          permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
          permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
        }
        const granted = await PermissionsAndroid.requestMultiple(permissions);

        const fineLocGranted = granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
        if (Platform.Version >= 31) {
          const scanGranted = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
          const connectGranted = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
          return scanGranted && connectGranted;
        }
        return fineLocGranted;
      } catch (err) {
        console.warn('Permission request error:', err);
        return false;
      }
    }
    return true;
  };

  const checkAndActivateBluetooth = async () => {
    const hasPerms = await requestPermissions();
    if (!hasPerms) {
      showInAppToast('Permissions required for Bluetooth file sharing');
      return;
    }

    try {
      const state = await AsyncStorage.getItem('@bluetooth_state');
      const isEnabled = state === 'true';
      setBluetoothEnabled(isEnabled);

      if (isEnabled) {
        loadPairedDevices();
        startScan();
      } else {
        // Prompt to enable Bluetooth or enable it automatically
        if (SystemTimeModule && SystemTimeModule.setBluetoothState) {
          await SystemTimeModule.setBluetoothState(true);
          setBluetoothEnabled(true);
          await AsyncStorage.setItem('@bluetooth_state', 'true');
          setTimeout(() => {
            loadPairedDevices();
            startScan();
          }, 1500);
        }
      }
    } catch (e) {
      console.warn('Error activating Bluetooth:', e);
    }
  };

  const loadPairedDevices = async () => {
    if (SystemTimeModule && SystemTimeModule.getPairedDevices) {
      try {
        const devices = await SystemTimeModule.getPairedDevices();
        setPairedDevices(devices || []);
      } catch (e) {
        console.warn('Error getting paired devices:', e);
      }
    }
  };

  const startScan = async () => {
    if (SystemTimeModule && SystemTimeModule.startBluetoothScan) {
      try {
        setScannedDevices([]);
        setIsScanning(true);
        await SystemTimeModule.startBluetoothScan();
      } catch (e) {
        console.warn('Error starting scan:', e);
        setIsScanning(false);
      }
    }
  };

  const stopScan = async () => {
    if (SystemTimeModule && SystemTimeModule.stopBluetoothScan) {
      try {
        await SystemTimeModule.stopBluetoothScan();
        setIsScanning(false);
      } catch (e) {
        console.warn('Error stopping scan:', e);
      }
    }
  };

  const handleToggle = async (isOn) => {
    setBluetoothEnabled(isOn);
    try {
      await AsyncStorage.setItem('@bluetooth_state', isOn.toString());
      if (SystemTimeModule && SystemTimeModule.setBluetoothState) {
        await SystemTimeModule.setBluetoothState(isOn);
        if (isOn) {
          setTimeout(() => {
            loadPairedDevices();
            startScan();
          }, 1500);
        } else {
          stopScan();
          setPairedDevices([]);
          setScannedDevices([]);
        }
      }
    } catch (e) {
      console.warn('Error setting bluetooth state:', e);
      setBluetoothEnabled(!isOn);
    }
  };

  const handleDeviceSelect = async (device) => {
    if (sharingAddress) return;
    setSharingAddress(device.address);
    showInAppToast(`Sending to ${device.name || 'Device'}...`, { durationMs: 2000, position: 'bottom' });

    try {
      await stopScan();
      const cleanPaths = selectedFiles.map(path => path.replace('file://', ''));
      await SystemTimeModule.sendFileDirectViaBluetooth(cleanPaths, device.address);
      // If fallback was used, the promise resolves immediately and onClose() will be called.
      // If direct succeeded, we also close and notify success.
      if (onShareSuccess) onShareSuccess();
      onClose();
    } catch (e) {
      console.error('Sharing failed:', e);
      showInAppToast("Failed to send file", { durationMs: 3000 });
    } finally {
      setSharingAddress(null);
    }
  };

  const renderDevice = ({ item, isPaired }) => (
    <TouchableOpacity
      style={styles.deviceItem}
      onPress={() => handleDeviceSelect(item)}
      disabled={sharingAddress !== null}
    >
      <View style={styles.deviceInfo}>
        <MaterialCommunityIcons
          name={isPaired ? "bluetooth-connect" : "bluetooth"}
          size={24}
          color={isPaired ? "#22B2A6" : "#A4B0BE"}
          style={{ marginRight: 15 }}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMac}>{item.address}</Text>
        </View>
        {sharingAddress === item.address ? (
          <ActivityIndicator size="small" color="#22B2A6" />
        ) : (
          <MaterialCommunityIcons name="share-variant" size={20} color="#22B2A6" />
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <CustomStatusBar />
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Image source={backIcon} style={styles.backIcon} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bluetooth Share</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.toggleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons name="bluetooth" size={24} color="#FFFFFF" style={{ marginRight: 10 }} />
              <Text style={styles.toggleText}>Bluetooth</Text>
            </View>
            <ToggleSwitch
              isOn={bluetoothEnabled}
              onColor="#22B2A6"
              offColor="#7F8FA6"
              size="medium"
              onToggle={handleToggle}
            />
          </View>

          {bluetoothEnabled && (
            <View style={{ flex: 1 }}>
              {/* Paired Devices Section */}
              {pairedDevices.length > 0 && (
                <View style={{ maxHeight: '45%', marginBottom: 15 }}>
                  <Text style={styles.sectionHeader}>Paired Devices</Text>
                  <FlatList
                    data={pairedDevices}
                    keyExtractor={(item) => item.address}
                    renderItem={(props) => renderDevice({ ...props, isPaired: true })}
                    showsVerticalScrollIndicator={false}
                  />
                </View>
              )}

              {/* Available Devices Section */}
              <View style={styles.sectionHeaderContainer}>
                <Text style={styles.sectionHeader}>Available Devices</Text>
                {isScanning ? (
                  <ActivityIndicator size="small" color="#22B2A6" />
                ) : (
                  <TouchableOpacity onPress={startScan} style={styles.scanButton}>
                    <MaterialCommunityIcons name="refresh" size={16} color="#22B2A6" style={{ marginRight: 4 }} />
                    <Text style={styles.scanText}>Scan</Text>
                  </TouchableOpacity>
                )}
              </View>

              {scannedDevices.length > 0 ? (
                <FlatList
                  data={scannedDevices}
                  keyExtractor={(item) => item.address}
                  renderItem={(props) => renderDevice({ ...props, isPaired: false })}
                  showsVerticalScrollIndicator={false}
                  style={{ flex: 1 }}
                />
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {isScanning ? "Scanning for nearby devices..." : "No new devices found. Tap Scan to search."}
                  </Text>
                </View>
              )}
            </View>
          )}

          {!bluetoothEnabled && (
            <View style={styles.disabledContainer}>
              <MaterialCommunityIcons name="bluetooth-off" size={60} color="#7F8FA6" style={{ marginBottom: 15 }} />
              <Text style={styles.infoText}>
                Please turn Bluetooth on to see paired and available devices for file sharing.
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? '12%' : '6%',
    paddingBottom: 20,
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
  },
  backButton: {
    height: 44,
    width: 44,
    borderRadius: 12,
    backgroundColor: '#41403D',
    borderWidth: 1,
    borderColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    width: 25,
    height: 25,
    tintColor: '#FFFFFF',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.5,
    flex: 1,
    textAlign: 'center',
    marginRight: 44, // Offset back button to center title perfectly
  },
  content: {
    paddingHorizontal: 20,
    flex: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2F3640',
  },
  toggleText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'ProductSans-Regular',
  },
  disabledContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  infoText: {
    color: '#A4B0BE',
    fontSize: 15,
    fontFamily: 'ProductSans-Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 10,
  },
  sectionHeader: {
    color: '#22B2A6',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  scanText: {
    color: '#22B2A6',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
  },
  deviceItem: {
    backgroundColor: '#1C1C1E',
    padding: 18,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2F3640',
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  deviceMac: {
    color: '#A4B0BE',
    fontSize: 12,
    fontFamily: 'ProductSans-Regular',
    marginTop: 4,
  },
  emptyContainer: {
    paddingVertical: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#7F8FA6',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
    fontStyle: 'italic',
    textAlign: 'center',
  },
});

export default BluetoothShareModal;