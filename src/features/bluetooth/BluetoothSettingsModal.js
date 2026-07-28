import React, { useState, useEffect, useCallback } from 'react';
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
import { BackButton } from '../../shared/ui';
import ToggleSwitch from 'toggle-switch-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showInAppToast } from '../../shared/utils/inAppToast';
import settingsIcon from '../../../assets/icon_settings.png';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import BluetoothNative from '../../shared/native/BluetoothNative';
import KioskMode from '../../shared/native/KioskMode';

const { width, height } = Dimensions.get('window');
/** Matches App CustomStatusBar height so content sits below it without moving it. */
const APP_STATUS_BAR_HEIGHT = 62;

const BluetoothSettingsModal = ({ visible, onClose }) => {
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [connectingAddress, setConnectingAddress] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showPairedDevicesScreen, setShowPairedDevicesScreen] = useState(false);

  // Load initial state
  useEffect(() => {
    if (visible) {
      const loadState = async () => {
        try {
          const state = await AsyncStorage.getItem('@bluetooth_state');
          if (state !== null) {
            const isEnabled = state === 'true';
            setBluetoothEnabled(isEnabled);
            if (isEnabled) {
              loadPairedDevices();
            }
          }
        } catch (e) {
          console.warn('Error loading bluetooth state', e);
        }
      };
      loadState();
    } else {
      // Stop scanning when modal closes
      if (isScanning && BluetoothNative && BluetoothNative.stopBluetoothScan) {
        BluetoothNative.stopBluetoothScan();
        setIsScanning(false);
      }
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    const reapply = () => {
      if (cancelled) return;
      KioskMode.reapplyImmersiveKiosk().catch(() => {});
    };
    reapply();
    const interval = setInterval(reapply, 400);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [visible, connectingAddress]);

  // Handle BT events
  useEffect(() => {
    const foundSub = DeviceEventEmitter.addListener('onBluetoothDeviceFound', (device) => {
      if (!device.name || device.name.trim() === '' || device.name === 'Unknown Device') return;

      setScannedDevices(prev => {
        // Filter out if already in pairedDevices or in scannedDevices
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

    const connectionSub = DeviceEventEmitter.addListener('onBluetoothConnectionChanged', (event) => {
      setConnectingAddress((current) => {
        if (event.address === current) {
          loadPairedDevices();
          return null;
        }
        return current;
      });
    });

    const bondSub = DeviceEventEmitter.addListener('onBluetoothBondStateChanged', (event) => {
      if (event.address === connectingAddress || connectingAddress === null) {
        setConnectingAddress(null);
        loadPairedDevices();
      }
    });

    return () => {
      foundSub.remove();
      finishSub.remove();
      connectionSub.remove();
      bondSub.remove();
    };
  }, [pairedDevices, connectingAddress]);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        return granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED ||
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.warn(err);
        return false;
      }
    }
    return true;
  };

  const loadPairedDevices = async () => {
    if (BluetoothNative && BluetoothNative.getPairedDevices) {
      try {
        const devices = await BluetoothNative.getPairedDevices();
        setPairedDevices(devices || []);
      } catch (e) {
        console.warn('Error getting paired devices', e);
      }
    }
  };

  const startScan = async () => {
    const hasPerms = await requestPermissions();
    if (!hasPerms) {
      if (showInAppToast) showInAppToast('Permissions required to scan Bluetooth devices');
      return;
    }

    if (BluetoothNative && BluetoothNative.startBluetoothScan) {
      try {
        setScannedDevices([]);
        setIsScanning(true);
        await BluetoothNative.startBluetoothScan();
      } catch (e) {
        console.warn('Error starting scan', e);
        setIsScanning(false);
      }
    }
  };

  const stopScan = async () => {
    if (BluetoothNative && BluetoothNative.stopBluetoothScan) {
      try {
        await BluetoothNative.stopBluetoothScan();
        setIsScanning(false);
      } catch (e) {
        console.warn('Error stopping scan', e);
      }
    }
  };

  const handleToggle = async (isOn) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setBluetoothEnabled(isOn);
    try {
      await AsyncStorage.setItem('@bluetooth_state', isOn.toString());
      if (BluetoothNative && BluetoothNative.setBluetoothState) {
        await BluetoothNative.setBluetoothState(isOn);
        if (isOn) {
          // Delay to allow OS to turn BT on before scanning
          setTimeout(() => {
            loadPairedDevices();
            // startScan();
          }, 1500);
        } else {
          stopScan();
          setPairedDevices([]);
          setScannedDevices([]);
        }
      }
    } catch (e) {
      console.warn('Error setting bluetooth state', e);
      setBluetoothEnabled(!isOn);
    } finally {
      setTimeout(() => {
        setIsTransitioning(false);
      }, 1500);
    }
  };

  const handlePair = async (device) => {
    if (BluetoothNative && BluetoothNative.pairDevice) {
      try {
        setConnectingAddress(device.address);
        if (showInAppToast) showInAppToast(`Connecting to ${device.name}...`);
        await BluetoothNative.pairDevice(device.address);

        // Safety timeout to clear loading if no event comes
        setTimeout(() => {
          setConnectingAddress(prev => prev === device.address ? null : prev);
          loadPairedDevices();
        }, 20000);
      } catch (e) {
        console.warn('Error pairing device', e);
        setConnectingAddress(null);
        if (showInAppToast) showInAppToast(`Failed to pair with ${device.name}`);
      }
    }
  };

  const handleUnpair = async () => {
    if (selectedDevice && BluetoothNative && BluetoothNative.unpairDevice) {
      try {
        if (showInAppToast) showInAppToast(`Unpairing ${selectedDevice.name}...`);
        await BluetoothNative.unpairDevice(selectedDevice.address);
        setShowOptionsModal(false);
        setTimeout(() => {
          loadPairedDevices();
        }, 1000);
      } catch (e) {
        console.warn('Error unpairing device', e);
        if (showInAppToast) showInAppToast(`Failed to unpair ${selectedDevice.name}`);
      }
    }
  };

  const handleUnpairDevice = async (device) => {
    try {
      if (BluetoothNative && BluetoothNative.unpairDevice) {
        if (showInAppToast) showInAppToast(`Unpaired ${device.name || 'device'} successfully`);
        await BluetoothNative.unpairDevice(device.address);
        setTimeout(() => {
          loadPairedDevices();
        }, 500);
      }
    } catch (e) {
      console.warn('Unpairing failed:', e);
      if (showInAppToast) showInAppToast('Failed to unpair device');
    }
  };

  const renderPairedDeviceForUnpair = ({ item }) => (
    <View style={styles.deviceItem}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
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
        </View>
        <TouchableOpacity
          style={styles.unpairBtn}
          onPress={() => handleUnpairDevice(item)}
        >
          <Text style={styles.unpairBtnText}>Unpair</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const openOptions = (device) => {
    setSelectedDevice(device);
    setShowOptionsModal(true);
  };

  const handleConnectSelected = () => {
    if (selectedDevice) {
      handlePair(selectedDevice);
      setShowOptionsModal(false);
    }
  };

  const renderDevice = ({ item, isPaired }) => (
    <TouchableOpacity
      style={styles.deviceItem}
      onPress={() => (isPaired ? openOptions(item) : handlePair(item))}
      disabled={connectingAddress !== null}
      activeOpacity={0.7}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMac}>{item.address}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {connectingAddress === item.address && (
            <ActivityIndicator size="small" color="#22B2A6" style={{ marginRight: 10 }} />
          )}
          {isPaired && (
            <>
              <View style={styles.verticalLine} />
              <TouchableOpacity onPress={() => openOptions(item)} style={styles.settingsButton}>
                <Image source={settingsIcon} style={styles.settingsIcon} />
              </TouchableOpacity>
            </>
          )}
        </View>
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
      <View style={styles.modalRoot}>
        {/* Transparent gap so the App CustomStatusBar stays put and visible */}
        <View style={styles.statusBarSpacer} />
        <View style={styles.modalContainer}>
          <View style={styles.header}>
            <BackButton onPress={onClose} />
            <Text style={styles.title}>Bluetooth</Text>
            <View style={styles.headerRight}>
              <TouchableOpacity onPress={() => setShowMenu(prev => !prev)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="dots-vertical" size={28} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.content}>
          <View style={[styles.toggleRow, isTransitioning && { opacity: 0.6 }]}>
            <Text style={styles.toggleText}>Bluetooth</Text>
            <ToggleSwitch
              isOn={bluetoothEnabled}
              onColor="#22B2A6"
              offColor="#7f8fa6"
              size="medium"
              onToggle={handleToggle}
              disabled={isTransitioning}
            />
          </View>

          {bluetoothEnabled && (
            <View style={{ flex: 1 }}>
              <View style={styles.sectionHeaderContainer}>
                <Text style={styles.sectionHeader}>Available Devices</Text>
                {isScanning ? (
                  <ActivityIndicator size="small" color="#22B2A6" />
                ) : (
                  <TouchableOpacity onPress={startScan}>
                    <Text style={styles.scanText}>Scan</Text>
                  </TouchableOpacity>
                )}
              </View>
              {scannedDevices.filter(d => !pairedDevices.find(p => p.address === d.address)).length > 0 ? (
                <FlatList
                  data={scannedDevices.filter(d => !pairedDevices.find(p => p.address === d.address))}
                  keyExtractor={(item) => item.address}
                  renderItem={(props) => renderDevice({ ...props, isPaired: false })}
                  style={styles.list}
                />
              ) : (
                <Text style={styles.emptyText}>No devices found.</Text>
              )}
            </View>
          )}

          {!bluetoothEnabled && (
            <Text style={styles.infoText}>
              Turn Bluetooth on to check supported devices.
            </Text>
          )}
        </View>
        </View>
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
        <View style={[StyleSheet.absoluteFillObject, styles.pairedScreen]}>
          <View style={styles.header}>
            <BackButton onPress={() => setShowPairedDevicesScreen(false)} />
            <Text style={styles.title}>Paired Devices</Text>
            <View style={styles.headerSpacer} />
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

      <Modal
        visible={showOptionsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowOptionsModal(false)}
      >
        <TouchableOpacity
          style={styles.optionsModalOverlay}
          activeOpacity={1}
          onPress={() => setShowOptionsModal(false)}
        >
          <View style={styles.optionsModalContent}>
            <Text style={styles.optionsTitle}>{selectedDevice?.name}</Text>
            <TouchableOpacity style={styles.optionButton} onPress={handleConnectSelected}>
              <Text style={styles.optionText}>Connect</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.optionButton, styles.unpairButton]} onPress={handleUnpair}>
              <Text style={[styles.optionText, { color: '#ff4757' }]}>Unpair</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowOptionsModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  statusBarSpacer: {
    height: APP_STATUS_BAR_HEIGHT,
    backgroundColor: 'transparent',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  pairedScreen: {
    backgroundColor: '#000000',
    zIndex: 2000,
    top: APP_STATUS_BAR_HEIGHT,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    marginBottom: 8,
  },
  backButton: {
    height: 40,
    width: 40,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#41403D',
    borderWidth: 1,
    borderColor: '#333333',
  },
  backButtonIcon: {
    width: 22,
    height: 22,
    tintColor: '#FFFFFF',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.5,
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
    flex: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    marginHorizontal: 0,
  },
  toggleText: {
    color: '#ffffff',
    fontSize: 18,
    fontFamily: 'ProductSans-Regular',
  },
  infoText: {
    color: '#a4b0be',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
    textAlign: 'center',
    marginTop: 20,
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  sectionHeader: {
    color: '#22B2A6',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  scanText: {
    color: '#22B2A6',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
  },
  list: {
    maxHeight: '90%',
  },
  deviceItem: {
    backgroundColor: '#2f3640',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  deviceName: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  deviceMac: {
    color: '#a4b0be',
    fontSize: 12,
    fontFamily: 'ProductSans-Regular',
    marginTop: 4,
  },
  emptyText: {
    color: '#7f8fa6',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
    fontStyle: 'italic',
    marginBottom: 20,
  },
  settingsButton: {
    padding: 10,
  },
  settingsIcon: {
    width: 22,
    height: 22,
    tintColor: '#a4b0be',
  },
  verticalLine: {
    width: 1,
    height: 30,
    backgroundColor: '#3d4b5f',
    marginHorizontal: 10,
  },
  optionsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionsModalContent: {
    backgroundColor: '#1c1c1e',
    width: '80%',
    borderRadius: 20,
    padding: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2f3640',
  },
  optionsTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontFamily: 'ProductSans-Bold',
    marginBottom: 25,
    textAlign: 'center',
  },
  optionButton: {
    width: '100%',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#2f3640',
    alignItems: 'center',
  },
  optionText: {
    color: '#00a8ff',
    fontSize: 18,
    fontFamily: 'ProductSans-Regular',
  },
  unpairButton: {
    borderBottomWidth: 0,
  },
  cancelButton: {
    marginTop: 20,
    padding: 10,
  },
  cancelText: {
    color: '#a4b0be',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
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
  unpairBtn: {
    backgroundColor: '#22B2A6',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unpairBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
  },
  emptyContainer: {
    paddingVertical: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default BluetoothSettingsModal;
