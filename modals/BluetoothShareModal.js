import React, { useState, useEffect, useRef } from 'react';
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
  Platform,
  Animated
} from 'react-native';
import ToggleSwitch from 'toggle-switch-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showInAppToast } from '../utils/Helpers';
import backIcon from '../assets/icon_back.png';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import KioskMode from '../utils/KioskMode';
import { ToastAndroid } from 'react-native';
const { SystemTimeModule } = NativeModules;
const { width } = Dimensions.get('window');

const BluetoothShareModal = ({ visible, onClose, selectedFiles, selectedLabels, onShareSuccess }) => {
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [sharingAddress, setSharingAddress] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showPairedDevicesScreen, setShowPairedDevicesScreen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  const [toast, setToast] = useState(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(6)).current;
  const toastHideTimerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      setToast(null);
      return;
    }

    const sub = DeviceEventEmitter.addListener('in_app_toast_show', (payload) => {
      const next = {
        message: payload?.message ?? '',
        durationMs: payload?.durationMs ?? 1400,
      };

      setToast(next);

      if (toastHideTimerRef.current) clearTimeout(toastHideTimerRef.current);

      toastOpacity.stopAnimation();
      toastTranslateY.stopAnimation();
      toastOpacity.setValue(0);
      toastTranslateY.setValue(6);

      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(toastTranslateY, { toValue: 0, duration: 120, useNativeDriver: true }),
      ]).start();

      toastHideTimerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(toastOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
          Animated.timing(toastTranslateY, { toValue: 6, duration: 180, useNativeDriver: true }),
        ]).start(({ finished }) => {
          if (finished) setToast(null);
        });
      }, Math.max(600, Number(next.durationMs) || 1400));
    });

    return () => {
      if (toastHideTimerRef.current) clearTimeout(toastHideTimerRef.current);
      sub.remove();
    };
  }, [visible, toastOpacity, toastTranslateY]);

  // Load Bluetooth State and check permissions on open
  useEffect(() => {
    if (visible) {
      // Temporarily exit Kiosk mode to permit standard Bluetooth activities / sharing intents
      // KioskMode.stopKioskMode()
      //   .then(() => console.log('[BluetoothShareModal] Kiosk Mode stopped successfully'))
      //   .catch(err => console.warn('[BluetoothShareModal] Failed to stop Kiosk Mode', err));

      checkAndActivateBluetooth();

      // Fetch device serial number
      AsyncStorage.getItem('serial_number')
        .then(sn => setSerialNumber(sn || ''))
        .catch(err => console.warn('[BluetoothShareModal] Failed to load serial number:', err));
    } else {
      stopScan();
    }
  }, [visible]);

  // Bluetooth event listeners
  useEffect(() => {
    if (!visible) return;

    const foundSub = DeviceEventEmitter.addListener('onBluetoothDeviceFound', (device) => {
      if (!device.name || device.name.trim() === '' || device.name === 'Unknown Device') return;
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

    const bondSub = DeviceEventEmitter.addListener('onBluetoothBondStateChanged', (event) => {
      if (event.bonded) {
        loadPairedDevices();
      }
    });

    return () => {
      foundSub.remove();
      finishSub.remove();
      bondSub.remove();
    };
  }, [visible, pairedDevices]);

  useEffect(() => {
    if (!visible) return;

    const acceptedSub = DeviceEventEmitter.addListener(
      'onBluetoothShareStatusChanged',
      (event) => {
        if (event.status === 'accepted') {
          //ToastAndroid.show('File transfer request sent to other device', ToastAndroid.LONG);
          showInAppToast("File transfer request sent to other device", { durationMs: 3000 });
        }
      }
    );

    return () => {
      acceptedSub.remove();
    };
  }, [visible]);

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
    if (isTransitioning) return;
    setIsTransitioning(true);
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
    } finally {
      setTimeout(() => {
        setIsTransitioning(false);
      }, 1500);
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
      showInAppToast("File transfer completed", { durationMs: 3000 });
      if (onShareSuccess) onShareSuccess();
      setTimeout(() => onClose(), 300);
      // onClose();
    } catch (e) {
      console.warn('Sharing failed:', e);
      const msg = (e && e.message) || String(e);
      const isCancelled =
        (e && e.code === 'BT_TRANSFER_FAILED') || msg.includes('0xc3');

      const isPairingCancelled = e && e.code === 'BT_PAIRING_CANCELLED';
      const isConnectFailed = e && e.code === 'BT_CONNECT_FAILED';

      if (isPairingCancelled) {
        if (Platform.OS === 'android') {
          ToastAndroid.show('Bluetooth pairing was cancelled', ToastAndroid.LONG);
        }
        showInAppToast("Bluetooth pairing was cancelled", { durationMs: 3000 });
      } else if (isCancelled) {
        if (Platform.OS === 'android') {
          //ToastAndroid.show('transfer cancelled by device', ToastAndroid.LONG);
        }
        showInAppToast("transfer cancelled by device", { durationMs: 3000 });
      } else if (isConnectFailed) {


        showInAppToast(msg || "Make sure the receiving device is set to receive files via Bluetooth.", { durationMs: 4000 });
      } else {
        if (Platform.OS === 'android') {
          ToastAndroid.show('Failed to send file', ToastAndroid.LONG);
        }
        showInAppToast("Failed to send file", { durationMs: 3000 });
      }
    } finally {
      setSharingAddress(null);
    }
  };

  const handleUnpairDevice = async (device) => {
    try {
      if (SystemTimeModule && SystemTimeModule.unpairDevice) {
        await SystemTimeModule.unpairDevice(device.address);
        showInAppToast(`Unpaired ${device.name || 'device'} successfully`);
        // Refresh paired devices list
        // loadPairedDevices();
        setTimeout(() => {

          loadPairedDevices();
        }, 500); // or 300–500 ms, enough for the system to update
      }
    } catch (e) {
      console.warn('Unpairing failed:', e);
      showInAppToast('Failed to unpair device');
    }
  };

  const renderPairedDeviceForUnpair = ({ item }) => (
    <View style={styles.deviceItem}>
      <View style={styles.deviceInfo}>
        <MaterialCommunityIcons
          name="bluetooth-connect"
          size={24}
          color="#22B2A6"
          style={{ marginRight: 15 }}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMac}>{item.address}</Text>
        </View>
        <TouchableOpacity
          style={styles.unpairButton}
          onPress={() => handleUnpairDevice(item)}
        >
          <Text style={styles.unpairButtonText}>Unpair</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

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
      statusBarTranslucent={true}
    >
      <View style={styles.modalContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Image source={backIcon} style={styles.backIcon} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitleMain}>Bluetooth Share</Text>
            {serialNumber ? <Text style={styles.serialNumberText}>S/N: {serialNumber}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => setShowMenu(prev => !prev)} style={styles.kebabButton}>
            <MaterialCommunityIcons name="dots-vertical" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={[styles.toggleRow, isTransitioning && { opacity: 0.6 }]}>
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
              disabled={isTransitioning}
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

              {scannedDevices.filter(d => !pairedDevices.find(p => p.address === d.address)).length > 0 ? (
                <FlatList
                  data={scannedDevices.filter(d => !pairedDevices.find(p => p.address === d.address))}
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

        {showMenu && (
          <TouchableOpacity
            style={styles.menuOverlay}
            activeOpacity={1}
            onPress={() => setShowMenu(false)}
          >
            <View style={styles.dropdownMenu}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowMenu(false);
                  setShowPairedDevicesScreen(true);
                }}
              >
                <Text style={styles.menuItemText}>Paired Devices</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}

        {showPairedDevicesScreen && (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000000', zIndex: 2000 }]}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => setShowPairedDevicesScreen(false)} style={styles.backButton}>
                <Image source={backIcon} style={styles.backIcon} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Paired Devices</Text>
              <View style={{ width: 44 }} />
            </View>

            <View style={styles.content}>
              {pairedDevices.length > 0 ? (
                <FlatList
                  data={pairedDevices}
                  keyExtractor={(item) => item.address}
                  renderItem={renderPairedDeviceForUnpair}
                  showsVerticalScrollIndicator={false}
                />
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No paired devices found.</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
      {toast && (
        <View pointerEvents="none" style={styles.toastContainer}>
          <Animated.View style={[styles.toast, { opacity: toastOpacity, transform: [{ translateY: toastTranslateY }] }]}>
            <Text style={styles.toastText}>{toast.message}</Text>
          </Animated.View>
        </View>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
    marginTop: 40,
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
    marginRight: 0,
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
  kebabButton: {
    height: 44,
    width: 44,
    borderRadius: 12,
    backgroundColor: '#41403D',
    borderWidth: 1,
    borderColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: 'transparent',
  },
  dropdownMenu: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 70,
    right: 20,
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2F3640',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
    minWidth: 160,
  },
  menuItem: {
    paddingVertical: 10,
    width: '100%',
  },
  menuItemText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
  },
  unpairButton: {
    backgroundColor: '#22B2A6',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unpairButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleMain: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  serialNumberText: {
    color: '#22B2A6',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
    marginTop: 2,
    textAlign: 'center',
  },
  toastContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 80,
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 9999,
  },
  toast: {
    maxWidth: 360,
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  toastText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    fontFamily: 'ProductSans-Regular',
  },
});

export default BluetoothShareModal;