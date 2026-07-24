import { NativeModules, Platform } from 'react-native';

const { WifiModule, SystemTimeModule } = NativeModules;

/** Prefer dedicated WifiModule; fall back to SystemTimeModule during migration. */
function wifiNative() {
  if (Platform.OS !== 'android') return null;
  return WifiModule || SystemTimeModule || null;
}

export const WifiNative = {
  isAvailable() {
    return !!wifiNative();
  },

  async connectToWifi(ssid, password = '', securityType = 'WPA') {
    const mod = wifiNative();
    if (!mod?.connectToWifi) throw new Error('Wifi connect not available');
    return mod.connectToWifi(ssid, password, securityType);
  },

  async forceWifiScan() {
    const mod = wifiNative();
    if (!mod?.forceWifiScan) return false;
    return mod.forceWifiScan();
  },

  async forgetNetwork(ssid) {
    const mod = wifiNative();
    if (!mod?.forgetNetwork) throw new Error('Wifi forget not available');
    return mod.forgetNetwork(ssid);
  },
};

export default WifiNative;
