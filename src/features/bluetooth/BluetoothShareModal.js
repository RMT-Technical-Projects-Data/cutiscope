import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  FlatList,
  DeviceEventEmitter,
  ActivityIndicator,
  Platform,
  Animated,
  BackHandler,
  ToastAndroid,
  PermissionsAndroid,
} from 'react-native';
import ToggleSwitch from 'toggle-switch-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showInAppToast, notifyUserActivity, setSessionIdleHold } from '../../shared/utils/inAppToast';
import { BackButton } from '../../shared/ui';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import BluetoothNative from '../../shared/native/BluetoothNative';
import KioskMode from '../../shared/native/KioskMode';
const { width } = Dimensions.get('window');

const BluetoothShareModal = ({
  visible,
  onClose,
  selectedFiles,
  selectedLabels,
  onShareSuccess,
  // Gallery historically passed these aliases — accept both.
  files,
  labels,
  onSuccess,
}) => {
  const fileList = (selectedFiles?.length ? selectedFiles : files) || [];
  const labelList = (selectedLabels?.length ? selectedLabels : labels) || [];
  const shareSuccess = onShareSuccess || onSuccess;

  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [sharingAddress, setSharingAddress] = useState(null);
  const [sharePhase, setSharePhase] = useState(null); // 'pairing' | 'sending' | null
  const [showMenu, setShowMenu] = useState(false);
  const [showPairedDevicesScreen, setShowPairedDevicesScreen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  const [toast, setToast] = useState(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(6)).current;
  const toastHideTimerRef = useRef(null);
  const scanTimeoutRef = useRef(null);
  const rescanTimerRef = useRef(null);
  // Discovery must never run during pairing/transfer — it starves the radio.
  const canScanRef = useRef(false);

  // Keep immersive kiosk while Bluetooth share UI is open — pause during pairing
  // so the system bond dialog is not fought by lock-task reapply.
  useEffect(() => {
    if (!visible) return undefined;
    if (sharePhase === 'pairing') return undefined;
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
  }, [visible, sharePhase]);

  // Freeze session inactivity while share / pairing / transfer is in progress.
  useEffect(() => {
    if (!visible) {
      setSessionIdleHold(false);
      return undefined;
    }
    setSessionIdleHold(true);
    notifyUserActivity();
    const keepAlive = setInterval(notifyUserActivity, 5000);
    return () => {
      clearInterval(keepAlive);
      setSessionIdleHold(false);
    };
  }, [visible, sharePhase]);

  // Hardware / gesture back closes share overlay when inline (covers gallery fullscreen).
  useEffect(() => {
    if (!visible) return undefined;
    const onBack = () => {
      onClose?.();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [visible, onClose]);

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
    if (!visible) {
      stopScan();
      return undefined;
    }

    checkAndActivateBluetooth();

    AsyncStorage.getItem('serial_number')
      .then(sn => setSerialNumber(sn || ''))
      .catch(err => console.warn('[BluetoothShareModal] Failed to load serial number:', err));

    // Leaving the screen must stop discovery — an orphaned scan keeps the radio
    // busy and makes the next pairing attempt fail.
    return () => {
      stopScan();
    };
  }, [visible]);

  // Bluetooth event listeners
  useEffect(() => {
    if (!visible) return;

    // Discovery reports the same device repeatedly and often supplies the friendly
    // name only on a later broadcast — upsert by address instead of dropping it.
    const upsertDevice = (device) => {
      if (!device?.address) return;
      setScannedDevices((prev) => {
        const index = prev.findIndex((d) => d.address === device.address);
        const name = device.name && device.name.trim() ? device.name.trim() : '';
        if (index === -1) {
          return [...prev, { address: device.address, name }];
        }
        if (!name || prev[index].name === name) return prev;
        const next = prev.slice();
        next[index] = { ...next[index], name };
        return next;
      });
    };

    const foundSub = DeviceEventEmitter.addListener('onBluetoothDeviceFound', upsertDevice);
    const nameSub = DeviceEventEmitter.addListener('onBluetoothDeviceNameChanged', upsertDevice);

    // Android discovery only runs ~12s. Keep cycling it so a phone that is put
    // into "discoverable" mode after the screen was opened still shows up.
    const finishSub = DeviceEventEmitter.addListener('onBluetoothDiscoveryFinished', () => {
      setIsScanning(false);
      if (rescanTimerRef.current) clearTimeout(rescanTimerRef.current);
      rescanTimerRef.current = setTimeout(() => {
        if (canScanRef.current) startScan({ reset: false });
      }, 2000);
    });

    const bondSub = DeviceEventEmitter.addListener('onBluetoothBondStateChanged', (event) => {
      if (event.bonded) {
        loadPairedDevices();
      }
    });

    return () => {
      foundSub.remove();
      nameSub.remove();
      finishSub.remove();
      bondSub.remove();
      if (rescanTimerRef.current) clearTimeout(rescanTimerRef.current);
    };
  }, [visible]);

  // Auto-rescan is only safe while the screen is open, Bluetooth is on and no
  // pairing/transfer is running.
  useEffect(() => {
    canScanRef.current = visible && bluetoothEnabled && !sharingAddress;
    if (!canScanRef.current && rescanTimerRef.current) {
      clearTimeout(rescanTimerRef.current);
      rescanTimerRef.current = null;
    }
  }, [visible, bluetoothEnabled, sharingAddress]);

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
    if (Platform.OS !== 'android') return true;
    try {
      const permissions = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      if (Platform.Version >= 31) {
        permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
        permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
      }
      const granted = await PermissionsAndroid.requestMultiple(permissions);
      const isGranted = (p) => granted[p] === PermissionsAndroid.RESULTS.GRANTED;

      if (Platform.Version >= 31) {
        return (
          isGranted(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN) &&
          isGranted(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT)
        );
      }
      return isGranted(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    } catch (err) {
      // Pre-granted / privileged kiosk builds can throw here — try scanning anyway.
      console.warn('Permission request error:', err);
      return true;
    }
  };

  const checkAndActivateBluetooth = async () => {
    const hasPerms = await requestPermissions();
    if (!hasPerms) {
      // showInAppToast('Permissions required for Bluetooth file sharing');
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
        if (BluetoothNative && BluetoothNative.setBluetoothState) {
          await BluetoothNative.setBluetoothState(true);
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
    if (BluetoothNative && BluetoothNative.getPairedDevices) {
      try {
        const devices = await BluetoothNative.getPairedDevices();
        setPairedDevices(devices || []);
      } catch (e) {
        console.warn('Error getting paired devices:', e);
      }
    }
  };

  const startScan = async ({ reset = true } = {}) => {
    if (!BluetoothNative?.startBluetoothScan) return;
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    try {
      // Background rescans keep previously found devices so the list never blinks empty.
      if (reset) setScannedDevices([]);
      setIsScanning(true);
      await BluetoothNative.startBluetoothScan();
      // Classic discovery runs ~12s; clear the spinner even if the finish
      // broadcast is missed while the app is backgrounded.
      scanTimeoutRef.current = setTimeout(() => setIsScanning(false), 20000);
    } catch (e) {
      console.warn('Error starting scan:', e);
      setIsScanning(false);
    }
  };

  const stopScan = async () => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    if (rescanTimerRef.current) {
      clearTimeout(rescanTimerRef.current);
      rescanTimerRef.current = null;
    }
    if (!BluetoothNative?.stopBluetoothScan) return;
    try {
      await BluetoothNative.stopBluetoothScan();
      setIsScanning(false);
    } catch (e) {
      console.warn('Error stopping scan:', e);
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

  // The remote device may show its own confirmation prompt, so allow plenty of
  // time — Android's own bond attempt runs about 60s before it gives up.
  const waitForBond = useCallback((address, timeoutMs = 65000) => {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sub.remove();
        if (ok) resolve(true);
        else reject(err);
      };

      const timer = setTimeout(() => {
        BluetoothNative.cancelPairing(address).catch(() => {});
        finish(
          false,
          Object.assign(new Error('Bluetooth pairing timed out'), { code: 'BT_PAIRING_TIMEOUT' })
        );
      }, timeoutMs);

      const sub = DeviceEventEmitter.addListener('onBluetoothBondStateChanged', (event) => {
        if (!event?.address || event.address.toUpperCase() !== String(address).toUpperCase()) return;
        if (event.bonded) {
          finish(true);
        } else {
          finish(
            false,
            Object.assign(new Error('Bluetooth pairing was cancelled'), { code: 'BT_PAIRING_CANCELLED' })
          );
        }
      });
    });
  }, []);

  const pairThenReady = useCallback(async (device) => {
    const alreadyPaired = pairedDevices.some((d) => d.address === device.address);
    if (alreadyPaired) return true;

    setSharePhase('pairing');
    showInAppToast(`Pairing with ${device.name || 'device'}. Confirm on both devices if asked.`, {
      durationMs: 4000,
      position: 'bottom',
    });

    // Subscribe before requesting the bond so an instant result is not missed.
    const bondPromise = waitForBond(device.address);
    bondPromise.catch(() => {});
    try {
      await BluetoothNative.pairDevice(device.address);
    } catch (e) {
      // createBond rejects when a bond is already in flight; keep waiting for the event.
      console.warn('[BluetoothShareModal] pairDevice start:', e?.message || e);
    }
    await bondPromise;
    await loadPairedDevices();
    return true;
  }, [pairedDevices, waitForBond]);

  const resolveSharePaths = useCallback(async () => {
    const paths = [];
    for (let i = 0; i < fileList.length; i += 1) {
      const raw = fileList[i];
      const clean = String(raw || '').replace('file://', '');
      if (!clean) continue;
      const label = labelList[i];
      if (label) {
        try {
          const watermarked = await BluetoothNative.getWatermarkedImage(clean, label);
          paths.push(String(watermarked || clean).replace('file://', ''));
          continue;
        } catch (e) {
          console.warn('[BluetoothShareModal] watermark failed, using original:', e?.message || e);
        }
      }
      paths.push(clean);
    }
    return paths;
  }, [fileList, labelList]);

  const handleDeviceSelect = async (device) => {
    if (sharingAddress || !device?.address) return;
    if (!fileList.length) {
      showInAppToast('No files selected to share', { durationMs: 2500 });
      return;
    }

    setSharingAddress(device.address);
    try {
      await stopScan();

      // 1) Pair first for unpaired / available devices (exits lock task for system pairing UI).
      await pairThenReady(device);

      // 2) Then send files over OPP/OBEX.
      setSharePhase('sending');
      showInAppToast(`Sending to ${device.name || 'Device'}...`, { durationMs: 2000, position: 'bottom' });

      const cleanPaths = await resolveSharePaths();
      if (!cleanPaths.length) {
        throw Object.assign(new Error('No valid files to send'), { code: 'BT_NO_FILES' });
      }

      await BluetoothNative.sendFileDirectViaBluetooth(cleanPaths, device.address);
      showInAppToast('File transfer completed', { durationMs: 3000 });
      if (shareSuccess) shareSuccess();
      setTimeout(() => onClose(), 300);
    } catch (e) {
      console.warn('Sharing failed:', e);
      const msg = (e && e.message) || String(e);
      const isCancelled =
        (e && e.code === 'BT_TRANSFER_FAILED') || msg.includes('0xc3');

      const isPairingCancelled = e && e.code === 'BT_PAIRING_CANCELLED';
      const isPairingTimeout = e && e.code === 'BT_PAIRING_TIMEOUT';
      const isConnectFailed = e && e.code === 'BT_CONNECT_FAILED';

      if (isPairingTimeout) {
        showInAppToast(
          'Pairing timed out. Accept the pairing request on the other device, then try again.',
          { durationMs: 4000 }
        );
      } else if (isPairingCancelled) {
        if (Platform.OS === 'android') {
          ToastAndroid.show('Bluetooth pairing was cancelled', ToastAndroid.LONG);
        }
        showInAppToast('Bluetooth pairing was cancelled', { durationMs: 3000 });
      } else if (isCancelled) {
        showInAppToast('transfer cancelled by device', { durationMs: 3000 });
      } else if (isConnectFailed) {
        showInAppToast(msg || 'Make sure the receiving device is set to receive files via Bluetooth.', { durationMs: 4000 });
      } else {
        if (Platform.OS === 'android') {
          ToastAndroid.show('Failed to send file', ToastAndroid.LONG);
        }
        showInAppToast('Failed to send file', { durationMs: 3000 });
      }
    } finally {
      setSharingAddress(null);
      setSharePhase(null);
    }
  };

  const handleUnpairDevice = async (device) => {
    try {
      if (BluetoothNative && BluetoothNative.unpairDevice) {
        await BluetoothNative.unpairDevice(device.address);
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
          <Text style={styles.deviceName}>{item.name || 'Unknown device'}</Text>
          <Text style={styles.deviceMac}>{item.address}</Text>
        </View>
        {sharingAddress === item.address ? (
          <View style={{ alignItems: 'flex-end' }}>
            <ActivityIndicator size="small" color="#22B2A6" />
            {sharePhase ? (
              <Text style={styles.sharePhaseText}>
                {sharePhase === 'pairing' ? 'Pairing…' : 'Sending…'}
              </Text>
            ) : null}
          </View>
        ) : (
          <MaterialCommunityIcons name="share-variant" size={20} color="#22B2A6" />
        )}
      </View>
    </TouchableOpacity>
  );

  // Devices that never report a name are background BLE radios (wearables, beacons,
  // randomised-MAC phones) that cannot receive files — keep them out of the picker.
  const availableDevices = scannedDevices.filter(
    (d) => d.name && !pairedDevices.some((p) => p.address === d.address)
  );

  if (!visible) {
    return null;
  }

  return (
    <View
      style={[styles.fullScreenContainer, styles.inlineOverlay]}
      pointerEvents="auto"
      onTouchStart={notifyUserActivity}
      onTouchMove={notifyUserActivity}
    >
      <View style={styles.modalContainer}>
        <View style={styles.header}>
          <BackButton onPress={onClose} style={styles.backButton} iconStyle={styles.backIcon} />
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
                  <TouchableOpacity onPress={() => startScan()} style={styles.scanButton}>
                    <MaterialCommunityIcons name="refresh" size={16} color="#22B2A6" style={{ marginRight: 4 }} />
                    <Text style={styles.scanText}>Scan</Text>
                  </TouchableOpacity>
                )}
              </View>

              {availableDevices.length > 0 ? (
                <FlatList
                  data={availableDevices}
                  keyExtractor={(item) => item.address}
                  renderItem={(props) => renderDevice({ ...props, isPaired: false })}
                  showsVerticalScrollIndicator={false}
                  style={{ flex: 1 }}
                />
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {isScanning ? 'Scanning for nearby devices...' : 'No new devices found.'}
                  </Text>
                  <Text style={styles.emptyHintText}>
                    On the other device, open Bluetooth settings and keep that screen open so it
                    stays visible to nearby devices.
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
              <BackButton
                onPress={() => setShowPairedDevicesScreen(false)}
                style={styles.backButton}
                iconStyle={styles.backIcon}
              />
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
    </View>
  );
};

const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  // Above FullScreenGalleryModal (zIndex 2000) — same pattern as Wi‑Fi inline overlay.
  inlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 16,
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
  sharePhaseText: {
    color: '#22B2A6',
    fontSize: 11,
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
  emptyHintText: {
    color: '#5A6472',
    fontSize: 13,
    fontFamily: 'ProductSans-Regular',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
    lineHeight: 19,
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
    backgroundColor: 'transparent',
    zIndex: 1000,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 70,
    right: 20,
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2F3640',
    paddingVertical: 8,
    minWidth: 160,
    elevation: 8,
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuItemText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'ProductSans-Regular',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleMain: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.5,
  },
  serialNumberText: {
    color: '#22B2A6',
    fontSize: 12,
    fontFamily: 'ProductSans-Regular',
    marginTop: 2,
  },
  unpairButton: {
    backgroundColor: '#2A1A1A',
    borderWidth: 1,
    borderColor: '#FF5252',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  unpairButtonText: {
    color: '#FF5252',
    fontSize: 13,
    fontFamily: 'ProductSans-Bold',
  },
  toastContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 80,
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 3000,
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
