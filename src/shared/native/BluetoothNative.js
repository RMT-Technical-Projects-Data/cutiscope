import { NativeModules, Platform } from 'react-native';

const { BluetoothModule, SystemTimeModule } = NativeModules;

/** Prefer dedicated BluetoothModule; fall back to SystemTimeModule if needed. */
function btNative() {
  if (Platform.OS !== 'android') return null;
  return BluetoothModule || SystemTimeModule || null;
}

export const BluetoothNative = {
  isAvailable() {
    return !!btNative();
  },

  module() {
    return btNative();
  },

  async setBluetoothState(enable) {
    const mod = btNative();
    if (!mod?.setBluetoothState) throw new Error('Bluetooth not available');
    return mod.setBluetoothState(enable);
  },

  async setBluetoothName(name) {
    const mod = btNative();
    if (!mod?.setBluetoothName) throw new Error('Bluetooth not available');
    return mod.setBluetoothName(name);
  },

  async startBluetoothScan() {
    const mod = btNative();
    if (!mod?.startBluetoothScan) return false;
    return mod.startBluetoothScan();
  },

  async stopBluetoothScan() {
    const mod = btNative();
    if (!mod?.stopBluetoothScan) return false;
    return mod.stopBluetoothScan();
  },

  async getPairedDevices() {
    const mod = btNative();
    if (!mod?.getPairedDevices) return [];
    return mod.getPairedDevices();
  },

  async getConnectedDevices() {
    const mod = btNative();
    if (!mod?.getConnectedDevices) return [];
    return mod.getConnectedDevices();
  },

  async pairDevice(address) {
    const mod = btNative();
    if (!mod?.pairDevice) throw new Error('Bluetooth not available');
    return mod.pairDevice(address);
  },

  async unpairDevice(address) {
    const mod = btNative();
    if (!mod?.unpairDevice) throw new Error('Bluetooth not available');
    return mod.unpairDevice(address);
  },

  async cancelPairing(address) {
    const mod = btNative();
    if (!mod?.cancelPairing) return false;
    return mod.cancelPairing(address);
  },

  async confirmPairing(address, confirm) {
    const mod = btNative();
    if (!mod?.confirmPairing) throw new Error('Bluetooth not available');
    return mod.confirmPairing(address, confirm);
  },

  async setBluetoothPin(address, pin) {
    const mod = btNative();
    if (!mod?.setBluetoothPin) throw new Error('Bluetooth not available');
    return mod.setBluetoothPin(address, pin);
  },

  async sendFileDirectViaBluetooth(paths, address) {
    const mod = btNative();
    if (!mod?.sendFileDirectViaBluetooth) throw new Error('Bluetooth not available');
    return mod.sendFileDirectViaBluetooth(paths, address);
  },

  async sendFilesViaBluetooth(paths, labels) {
    const mod = btNative();
    if (!mod?.sendFilesViaBluetooth) throw new Error('Bluetooth not available');
    return mod.sendFilesViaBluetooth(paths, labels);
  },

  async getWatermarkedImage(path, text) {
    const mod = btNative() || SystemTimeModule;
    if (!mod?.getWatermarkedImage) throw new Error('Watermark not available');
    return mod.getWatermarkedImage(path, text);
  },
};

export default BluetoothNative;
