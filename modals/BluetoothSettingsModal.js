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
import CustomStatusBar from '../Components/CustomStatusBar';
import VerticalDivider from '../Components/VerticalDivider';
import backIcon from '../assets/icon_back.png';
import ToggleSwitch from 'toggle-switch-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showInAppToast } from '../utils/Helpers';
import settingsIcon from '../assets/icon_settings.png';

const { SystemTimeModule } = NativeModules;
const { width, height } = Dimensions.get('window');

const BluetoothSettingsModal = ({ visible, onClose }) => {
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [connectingAddress, setConnectingAddress] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [pairingRequest, setPairingRequest] = useState(null);

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
              loadConnectedDevices();
            }
          }
        } catch (e) {
          console.warn('Error loading bluetooth state', e);
        }
      };
      loadState();
    } else {
      // Stop scanning when modal closes
      if (isScanning && SystemTimeModule && SystemTimeModule.stopBluetoothScan) {
        SystemTimeModule.stopBluetoothScan();
        setIsScanning(false);
      }
    }
  }, [visible]);

  // Handle BT events
  useEffect(() => {
    const foundSub = DeviceEventEmitter.addListener('onBluetoothDeviceFound', (device) => {
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
      if (event.connected) {
        setConnectedDevices(prev => {
          if (!prev.find(d => d.address === event.address)) {
            return [...prev, { name: event.name || 'Unknown Device', address: event.address }];
          }
          return prev;
        });
      } else {
        setConnectedDevices(prev => prev.filter(d => d.address !== event.address));
      }

      if (event.address === connectingAddress || connectingAddress === null) {
        setConnectingAddress(null);
        loadPairedDevices();
      }
    });

    const bondSub = DeviceEventEmitter.addListener('onBluetoothBondStateChanged', (event) => {
      if (event.address === connectingAddress || connectingAddress === null) {
        setConnectingAddress(null);
        loadPairedDevices();
      }
    });

    const pairingSub = DeviceEventEmitter.addListener('onBluetoothPairingRequest', (event) => {
      setPairingRequest(event);
    });

    return () => {
      foundSub.remove();
      finishSub.remove();
      connectionSub.remove();
      bondSub.remove();
      pairingSub.remove();
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
    if (SystemTimeModule && SystemTimeModule.getPairedDevices) {
      try {
        const devices = await SystemTimeModule.getPairedDevices();
        setPairedDevices(devices || []);
      } catch (e) {
        console.warn('Error getting paired devices', e);
      }
    }
  };

  const loadConnectedDevices = async () => {
    if (SystemTimeModule && SystemTimeModule.getConnectedDevices) {
      try {
        const devices = await SystemTimeModule.getConnectedDevices();
        setConnectedDevices(devices || []);
      } catch (e) {
        console.warn('Error getting connected devices', e);
      }
    }
  };

  const startScan = async () => {
    const hasPerms = await requestPermissions();
    if (!hasPerms) {
      if (showInAppToast) showInAppToast('Permissions required to scan Bluetooth devices');
      return;
    }

    if (SystemTimeModule && SystemTimeModule.startBluetoothScan) {
      try {
        setScannedDevices([]);
        setIsScanning(true);
        await SystemTimeModule.startBluetoothScan();
      } catch (e) {
        console.warn('Error starting scan', e);
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
        console.warn('Error stopping scan', e);
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
          // Delay to allow OS to turn BT on before scanning
          setTimeout(() => {
            loadPairedDevices();
            loadConnectedDevices();
            startScan();
          }, 1500);
        } else {
          stopScan();
          setPairedDevices([]);
          setScannedDevices([]);
          setConnectedDevices([]);
        }
      }
    } catch (e) {
      console.warn('Error setting bluetooth state', e);
      setBluetoothEnabled(!isOn);
    }
  };

  const handlePair = async (device) => {
    if (SystemTimeModule && SystemTimeModule.pairDevice) {
      try {
        setConnectingAddress(device.address);
        if (showInAppToast) showInAppToast(`Connecting to ${device.name}...`);
        await SystemTimeModule.pairDevice(device.address);

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
    if (selectedDevice && SystemTimeModule && SystemTimeModule.unpairDevice) {
      try {
        if (showInAppToast) showInAppToast(`Unpairing ${selectedDevice.name}...`);
        await SystemTimeModule.unpairDevice(selectedDevice.address);
        setShowOptionsModal(false);
        setTimeout(() => {
          loadPairedDevices();
          loadConnectedDevices();
        }, 1000);
      } catch (e) {
        console.warn('Error unpairing device', e);
        if (showInAppToast) showInAppToast(`Failed to unpair ${selectedDevice.name}`);
      }
    }
  };

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

  const handleConfirmPairing = async (confirm) => {
    if (pairingRequest && SystemTimeModule && SystemTimeModule.confirmPairing) {
      const address = pairingRequest.address;
      setPairingRequest(null); // Close immediately
      try {
        await SystemTimeModule.confirmPairing(address, confirm);
      } catch (e) {
        console.warn('Error confirming pairing', e);
        if (showInAppToast) showInAppToast('Failed to confirm pairing');
      }
    }
  };

  const renderDevice = ({ item, isPaired }) => (
    <TouchableOpacity 
      style={styles.deviceItem} 
      onPress={() => isPaired ? openOptions(item) : handlePair(item)}
      disabled={connectingAddress !== null}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMac}>{item.address}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {connectingAddress === item.address && (
            <ActivityIndicator size="small" color="#4cd137" style={{ marginRight: 10 }} />
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
    >
      <View style={styles.modalContainer}>
        <CustomStatusBar />
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Image source={backIcon} style={styles.backIcon} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <VerticalDivider />
          <Text style={styles.headerTitle}>Bluetooth Settings</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleText}>Bluetooth</Text>
            <ToggleSwitch
              isOn={bluetoothEnabled}
              onColor="#4cd137"
              offColor="#7f8fa6"
              size="medium"
              onToggle={handleToggle}
            />
          </View>

          {bluetoothEnabled && (
            <View style={{ flex: 1 }}>
              {connectedDevices.length > 0 && (
                <>
                  <View style={styles.sectionHeaderContainer}>
                    <Text style={styles.sectionHeader}>Connected Devices</Text>
                  </View>
                  <FlatList
                    data={connectedDevices}
                    keyExtractor={(item) => item.address}
                    renderItem={(props) => renderDevice({ ...props, isPaired: true })}
                    style={styles.list}
                  />
                </>
              )}

              <View style={styles.sectionHeaderContainer}>
                <Text style={styles.sectionHeader}>Paired Devices</Text>
              </View>
              {pairedDevices.length > 0 ? (
                <FlatList
                  data={pairedDevices}
                  keyExtractor={(item) => item.address}
                  renderItem={(props) => renderDevice({ ...props, isPaired: true })}
                  style={styles.list}
                />
              ) : (
                <Text style={styles.emptyText}>No paired devices found.</Text>
              )}

              <View style={styles.sectionHeaderContainer}>
                <Text style={styles.sectionHeader}>Available Devices</Text>
                {isScanning ? (
                  <ActivityIndicator size="small" color="#4cd137" />
                ) : (
                  <TouchableOpacity onPress={startScan}>
                    <Text style={styles.scanText}>Scan</Text>
                  </TouchableOpacity>
                )}
              </View>
              {scannedDevices.length > 0 ? (
                <FlatList
                  data={scannedDevices}
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
              Turn Bluetooth on to connect with supported devices. Note that changes here will affect the OS Bluetooth state.
            </Text>
          )}
        </View>
      </View>

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

      <Modal
        visible={pairingRequest !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPairingRequest(null)}
      >
        <View style={styles.pairingModalOverlay}>
          <View style={styles.pairingModalContent}>
            <Text style={styles.pairingTitle}>Bluetooth pairing request</Text>
            <Text style={styles.pairingMessage}>
              Pair with {pairingRequest?.name}? Confirm that this passkey is shown on {pairingRequest?.name}.
            </Text>
            
            {pairingRequest?.passkey >= 0 && (
              <Text style={styles.passkeyText}>{pairingRequest?.passkey}</Text>
            )}

            <View style={styles.pairingButtonsRow}>
              <TouchableOpacity 
                style={styles.pairingButton} 
                onPress={() => handleConfirmPairing(false)}
              >
                <Text style={styles.pairingCancelText}>Cancel</Text>
              </TouchableOpacity>
              <View style={styles.pairingDivider} />
              <TouchableOpacity 
                style={styles.pairingButton} 
                onPress={() => handleConfirmPairing(true)}
              >
                <Text style={styles.pairingConfirmText}>Pair</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingTop: '6%',
    paddingBottom: 20,
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 20,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backIcon: {
    width: 24,
    height: 24,
    tintColor: '#ffffff',
    marginRight: 8,
  },
  backText: {
    color: '#ffffff',
    fontSize: 18,
    fontFamily: 'ProductSans-Regular',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontFamily: 'ProductSans-Bold',
    marginLeft: 15,
  },
  content: {
    padding: 20,
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
    marginTop: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2f3640',
    paddingBottom: 5,
  },
  sectionHeader: {
    color: '#4cd137',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  scanText: {
    color: '#00a8ff',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
  },
  list: {
    maxHeight: '40%',
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
  pairingModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pairingModalContent: {
    backgroundColor: '#1c1c1e',
    width: '85%',
    borderRadius: 25,
    paddingTop: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2f3640',
    overflow: 'hidden',
  },
  pairingTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontFamily: 'ProductSans-Bold',
    marginBottom: 15,
  },
  pairingMessage: {
    color: '#a4b0be',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
    lineHeight: 22,
  },
  passkeyText: {
    color: '#ffffff',
    fontSize: 36,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 2,
    marginBottom: 30,
  },
  pairingButtonsRow: {
    flexDirection: 'row',
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: '#2f3640',
  },
  pairingButton: {
    flex: 1,
    paddingVertical: 20,
    alignItems: 'center',
  },
  pairingDivider: {
    width: 1,
    backgroundColor: '#2f3640',
  },
  pairingCancelText: {
    color: '#ffffff',
    fontSize: 18,
    fontFamily: 'ProductSans-Regular',
  },
  pairingConfirmText: {
    color: '#ffffff',
    fontSize: 18,
    fontFamily: 'ProductSans-Bold',
  },
});

export default BluetoothSettingsModal;
