package com.dermascopeapp;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import java.io.DataOutputStream;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import java.util.Set;
import java.util.ArrayList;
import android.util.Log;
import java.lang.reflect.Method;
import androidx.core.content.FileProvider;
import android.net.Uri;
import java.io.File;
import java.io.FileOutputStream;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;

public class SystemTimeModule extends ReactContextBaseJavaModule {

    SystemTimeModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public void initialize() {
        super.initialize();
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(BluetoothDevice.ACTION_FOUND);
            filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
            filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
            filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
            filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
            filter.addAction(BluetoothDevice.ACTION_PAIRING_REQUEST);
            getReactApplicationContext().registerReceiver(bluetoothReceiver, filter);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        try {
            getReactApplicationContext().unregisterReceiver(bluetoothReceiver);
        } catch (Exception e) {
            // Ignore
        }
    }

    private final BroadcastReceiver bluetoothReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device != null) {
                    try {
                        WritableMap map = Arguments.createMap();
                        map.putString("name", device.getName() != null ? device.getName() : "Unknown Device");
                        map.putString("address", device.getAddress());

                        getReactApplicationContext()
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("onBluetoothDeviceFound", map);
                    } catch (SecurityException e) {
                        // Silently handle
                    }
                }
            } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                getReactApplicationContext()
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                        .emit("onBluetoothDiscoveryFinished", null);
            } else if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device != null) {
                    try {
                        WritableMap map = Arguments.createMap();
                        map.putString("address", device.getAddress());
                        map.putString("name", device.getName() != null ? device.getName() : "Unknown Device");
                        map.putBoolean("connected", true);
                        getReactApplicationContext()
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                            .emit("onBluetoothConnectionChanged", map);
                    } catch (SecurityException e) {
                        // Silently handle
                    }
                }
            } else if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device != null) {
                    try {
                        WritableMap map = Arguments.createMap();
                        map.putString("address", device.getAddress());
                        map.putString("name", device.getName() != null ? device.getName() : "Unknown Device");
                        map.putBoolean("connected", false);
                        getReactApplicationContext()
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                            .emit("onBluetoothConnectionChanged", map);
                    } catch (SecurityException e) {
                        // Silently handle
                    }
                }
            } else if (BluetoothDevice.ACTION_PAIRING_REQUEST.equals(action)) {
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                int type = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, BluetoothDevice.ERROR);
                int passkey = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_KEY, BluetoothDevice.ERROR);
                
                if (device != null) {
                    try {
                        WritableMap map = Arguments.createMap();
                        map.putString("address", device.getAddress());
                        map.putString("name", device.getName() != null ? device.getName() : "Unknown Device");
                        map.putInt("variant", type);
                        map.putInt("passkey", passkey);
                        
                        getReactApplicationContext()
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                            .emit("onBluetoothPairingRequest", map);
                    } catch (SecurityException e) {
                        // Silently handle
                    }
                }
            } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(action)) {
                int state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR);
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device != null && state == BluetoothDevice.BOND_BONDED) {
                    WritableMap map = Arguments.createMap();
                    map.putString("address", device.getAddress());
                    map.putBoolean("bonded", true);
                    getReactApplicationContext()
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                        .emit("onBluetoothBondStateChanged", map);
                }
            }
        }
    };

    @Override
    public String getName() {
        return "SystemTimeModule";
    }

    @ReactMethod
    public void setTime(double timestamp) {
        try {
            // Convert timestamp (milliseconds) to Date
            Date date = new Date((long) timestamp);

            // Format date for 'date' command: MMddHHmmYYYY.ss
            SimpleDateFormat sdf = new SimpleDateFormat("MMddHHmmyyyy.ss", Locale.US);
            String formattedDate = sdf.format(date);

            // Execute date setting command as root
            Process process = null;
            try {
                process = Runtime.getRuntime().exec("su");
                DataOutputStream os = new DataOutputStream(process.getOutputStream());

                os.writeBytes("settings put global auto_time 0\n");
                os.writeBytes("date " + formattedDate + "\n");
                // Sync the system time to the hardware real-time clock (RTC) in UTC format
                os.writeBytes("hwclock -u -w\n");
                os.writeBytes("sync\n");
                // Broadcast TIME_SET to trigger immediate system UI update (Status Bar, etc.)
                os.writeBytes("am broadcast -a android.intent.action.TIME_SET\n");
                os.writeBytes("exit\n");
                os.flush();
                os.close();
                process.waitFor();
            } catch (IOException e) {
                // su not found, if the app has permission it might work via sh for some settings
                // but 'date' and 'hwclock' definitely need root.
                Log.w("SystemTimeModule", "Root access unavailable for setTime");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void setTimezone(String timezoneId, com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());

            // Disable auto timezone
            os.writeBytes("settings put global auto_time_zone 0\n");
            // Set the timezone property so it persists across reboots
            os.writeBytes("setprop persist.sys.timezone " + timezoneId + "\n");
            // Broadcast the change to immediately update UI/apps
            os.writeBytes("am broadcast -a android.intent.action.TIMEZONE_CHANGED --es time-zone " + timezoneId + "\n");

            os.writeBytes("exit\n");
            os.flush();
            os.close();
            process.waitFor();
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SET_TIMEZONE_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void grantPermissions(com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());

            String packageName = "com.dermascopeapp";
            String[] permissions = {
                    "android.permission.CAMERA",
                    "android.permission.READ_EXTERNAL_STORAGE",
                    "android.permission.WRITE_EXTERNAL_STORAGE",
                    "android.permission.READ_MEDIA_IMAGES",
                    "android.permission.ACCESS_FINE_LOCATION",
                    "android.permission.ACCESS_COARSE_LOCATION"
            };

            // 1. Grant standard permissions
            for (String perm : permissions) {
                os.writeBytes("pm grant " + packageName + " " + perm + "\n");
            }

            // 2. Grant MANAGE_EXTERNAL_STORAGE for Android 11+ (API 30+)
            // This provides "All Files Access" which bypasses scoped storage restrictions
            os.writeBytes("appops set " + packageName + " MANAGE_EXTERNAL_STORAGE allow\n");

            os.writeBytes("exit\n");
            os.flush();
            os.close();
            process.waitFor();

            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("GRANT_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void connectToWifi(String ssid, String password, String securityType,
            com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());

            // Format: cmd wifi connect-network <ssid> <security_type> <password>
            // securityType should be "open", "wpa2", or "wpa3" (we can map "Secured" to
            // "wpa2" as default)

            String cmdAuth = "open";
            if (password != null && !password.isEmpty()) {
                cmdAuth = "wpa2"; // Defaulting to WPA2 for secured networks
            }

            // Wrap SSID in quotes if it has spaces, but usually cmd wifi handles raw args
            // if carefully passed.
            // However, shell argument parsing is tricky. Best to quote.
            String safeSsid = "\"" + ssid + "\"";
            String safePassword = "\"" + password + "\"";

            if (cmdAuth.equals("open")) {
                os.writeBytes("cmd wifi connect-network " + safeSsid + " open\n");
            } else {
                // For secured networks, forget the network first to ensure fresh authentication
                forgetNetworkInternal(ssid);
                os.writeBytes("cmd wifi connect-network " + safeSsid + " " + cmdAuth + " " + safePassword + "\n");
            }

            os.writeBytes("exit\n");
            os.flush();
            os.close();

            int exitCode = process.waitFor();

            if (exitCode == 0) {
                promise.resolve(true);
            } else {
                promise.reject("CONNECTION_FAILED", "Root command failed with exit code " + exitCode);
            }
        } catch (Exception e) {
            promise.reject("CONNECTION_ERROR", e.getMessage());
        }
    }

    private void forgetNetworkInternal(String ssid) {
        try {
            // 1. List networks
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            java.io.InputStream is = process.getInputStream();
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is));

            os.writeBytes("cmd wifi list-networks\n");
            os.writeBytes("exit\n");
            os.flush();

            String line;
            String networkId = null;

            // 2. Parse output to find Network ID
            while ((line = reader.readLine()) != null) {
                if (line.contains(ssid)) {
                    String[] parts = line.trim().split("\\s+");
                    if (parts.length > 0) {
                        // Check if this line actually matches the SSID
                        if (line.contains("\"" + ssid + "\"") || line.contains(ssid)) {
                            networkId = parts[0];
                            break;
                        }
                    }
                }
            }

            os.close();
            process.waitFor();

            // 3. Forget network if found
            if (networkId != null) {
                Process forgetProc = Runtime.getRuntime().exec("su");
                DataOutputStream forgetOs = new DataOutputStream(forgetProc.getOutputStream());
                forgetOs.writeBytes("cmd wifi forget-network " + networkId + "\n");
                forgetOs.writeBytes("exit\n");
                forgetOs.flush();
                forgetOs.close();
                forgetProc.waitFor();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void forgetNetwork(String ssid, com.facebook.react.bridge.Promise promise) {
        try {
            forgetNetworkInternal(ssid);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("FORGET_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void deleteFileRoot(String filePath, com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());

            String safePath = "\"" + filePath + "\"";

            // 1. Delete the file forcefully
            os.writeBytes("rm -f " + safePath + "\n");

            // 2. Broadcast to MediaScanner to remove it from Gallery apps immediately
            // Note: Since Android 4.4, ACTION_MEDIA_MOUNTED is deprecated/restricted,
            // but ACTION_MEDIA_SCANNER_SCAN_FILE works for specific files.
            // We use 'am broadcast' to trigger this intent.
            // The data uri must be file:///path/to/file
            String uri = "file://" + filePath;
            os.writeBytes("am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d " + "\"" + uri + "\"\n");

            os.writeBytes("exit\n");
            os.flush();
            os.close();

            int exitCode = process.waitFor();

            if (exitCode == 0) {
                promise.resolve(true);
            } else {
                promise.reject("DELETE_FAILED", "Root delete failed with exit code " + exitCode);
            }
        } catch (Exception e) {
            promise.reject("DELETE_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void setBluetoothState(boolean enable, com.facebook.react.bridge.Promise promise) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        boolean rootAttempted = false;
        boolean rootSucceeded = false;

        try {
            Process process = Runtime.getRuntime().exec("su");
            rootAttempted = true;
            DataOutputStream os = new DataOutputStream(process.getOutputStream());

            if (enable) {
                os.writeBytes("svc bluetooth enable\n");
                // Explicitly disable Bluetooth tethering
                os.writeBytes("settings put global bluetooth_tethering_on 0\n");
            } else {
                os.writeBytes("svc bluetooth disable\n");
            }

            os.writeBytes("exit\n");
            os.flush();
            os.close();

            int exitCode = process.waitFor();
            rootSucceeded = (exitCode == 0);
        } catch (Exception e) {
            // su not found or failed, will fall back
        }

        if (rootSucceeded) {
            promise.resolve(true);
            return;
        }

        // Fallback to standard API if root failed or was unavailable
        if (adapter == null) {
            promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported on this device");
            return;
        }

        try {
            boolean success;
            if (enable) {
                // Note: enable() is deprecated since API 33 and may require user consent or be restricted
                success = adapter.enable();
            } else {
                success = adapter.disable();
            }
            
            // On many modern Android versions, enable/disable returns false if the app isn't a system app,
            // but we'll resolve true if we at least made the attempt without an exception.
            promise.resolve(true);
        } catch (SecurityException se) {
            promise.reject("BLUETOOTH_ERROR", "Permission denied: " + se.getMessage());
        } catch (Exception e) {
            promise.reject("BLUETOOTH_ERROR", "Fallback failed: " + e.getMessage());
        }
    }

    @ReactMethod
    public void startBluetoothScan(com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported");
                return;
            }
            if (adapter.isDiscovering()) {
                adapter.cancelDiscovery();
            }

            adapter.startDiscovery();
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SCAN_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void stopBluetoothScan(com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter != null && adapter.isDiscovering()) {
                adapter.cancelDiscovery();
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("STOP_SCAN_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getPairedDevices(com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported");
                return;
            }
            Set<BluetoothDevice> pairedDevices = adapter.getBondedDevices();
            WritableArray array = Arguments.createArray();
            if (pairedDevices != null) {
                for (BluetoothDevice device : pairedDevices) {
                    WritableMap map = Arguments.createMap();
                    map.putString("name", device.getName() != null ? device.getName() : "Unknown Device");
                    map.putString("address", device.getAddress());
                    array.pushMap(map);
                }
            }
            promise.resolve(array);
        } catch (Exception e) {
            promise.reject("PAIRED_DEVICES_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void pairDevice(String address, com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported");
                return;
            }
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device != null) {
                device.createBond();
                promise.resolve(true);
            } else {
                promise.reject("PAIR_ERROR", "Device not found");
            }
        } catch (Exception e) {
            promise.reject("PAIR_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getConnectedDevices(com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported");
                return;
            }
            Set<BluetoothDevice> pairedDevices = adapter.getBondedDevices();
            WritableArray array = Arguments.createArray();
            if (pairedDevices != null) {
                for (BluetoothDevice device : pairedDevices) {
                    if (isConnected(device)) {
                        WritableMap map = Arguments.createMap();
                        map.putString("name", device.getName() != null ? device.getName() : "Unknown Device");
                        map.putString("address", device.getAddress());
                        array.pushMap(map);
                    }
                }
            }
            promise.resolve(array);
        } catch (Exception e) {
            promise.reject("CONNECTED_DEVICES_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void unpairDevice(String address, com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported");
                return;
            }
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device != null) {
                Method m = device.getClass().getMethod("removeBond", (Class[]) null);
                m.invoke(device, (Object[]) null);
                promise.resolve(true);
            } else {
                promise.reject("UNPAIR_ERROR", "Device not found");
            }
        } catch (Exception e) {
            promise.reject("UNPAIR_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void confirmPairing(String address, boolean confirm, com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device != null) {
                try {
                    device.setPairingConfirmation(confirm);
                    promise.resolve(true);
                } catch (SecurityException e) {
                    // Standard method failed, try root-based input simulation
                    if (confirm) {
                        confirmPairingViaRoot(address);
                    } else {
                        cancelPairingViaRoot(address);
                    }
                    promise.resolve(true);
                }
            } else {
                promise.reject("ERROR", "Device not found");
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    private void confirmPairingViaRoot(String address) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            // Direct binder calls are much faster than UI automation
            // We try common transaction codes for setPairingConfirmation(String address, boolean confirm)
            // Android 11: 40, Android 12: 43, Android 13: 44, Android 14: 45
            // s16 = String, i32 1 = true
            os.writeBytes("service call bluetooth 40 s16 " + address + " i32 1\n");
            os.writeBytes("service call bluetooth 43 s16 " + address + " i32 1\n");
            os.writeBytes("service call bluetooth 44 s16 " + address + " i32 1\n");
            os.writeBytes("service call bluetooth 45 s16 " + address + " i32 1\n");
            
            // Fallback: If binder calls failed, try a quick keyevent
            os.writeBytes("input keyevent KEYCODE_DPAD_RIGHT\n");
            os.writeBytes("input keyevent KEYCODE_ENTER\n");
            
            os.writeBytes("exit\n");
            os.flush();
            os.close();
            process.waitFor();
        } catch (IOException e) {
            // su not found, fallback to standard keyevents if possible via 'sh'
            try {
                Process sh = Runtime.getRuntime().exec("sh");
                DataOutputStream os = new DataOutputStream(sh.getOutputStream());
                os.writeBytes("input keyevent KEYCODE_DPAD_RIGHT\n");
                os.writeBytes("input keyevent KEYCODE_ENTER\n");
                os.writeBytes("exit\n");
                os.flush();
                os.close();
                sh.waitFor();
            } catch (Exception ignored) {}
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void cancelPairingViaRoot(String address) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            os.writeBytes("service call bluetooth 40 s16 " + address + " i32 0\n");
            os.writeBytes("service call bluetooth 43 s16 " + address + " i32 0\n");
            os.writeBytes("service call bluetooth 44 s16 " + address + " i32 0\n");
            os.writeBytes("service call bluetooth 45 s16 " + address + " i32 0\n");
            os.writeBytes("input keyevent KEYCODE_ENTER\n");
            os.writeBytes("exit\n");
            os.flush();
            os.close();
            process.waitFor();
        } catch (IOException e) {
            // su not found, try fallback via 'sh'
            try {
                Process sh = Runtime.getRuntime().exec("sh");
                DataOutputStream os = new DataOutputStream(sh.getOutputStream());
                os.writeBytes("input keyevent KEYCODE_ENTER\n");
                os.writeBytes("exit\n");
                os.flush();
                os.close();
                sh.waitFor();
            } catch (Exception ignored) {}
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void setBluetoothPin(String address, String pin, com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device != null) {
                byte[] pinBytes = pin.getBytes();
                device.setPin(pinBytes);
                promise.resolve(true);
            } else {
                promise.reject("ERROR", "Device not found");
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void sendFileViaBluetooth(String filePath, String text, com.facebook.react.bridge.Promise promise) {
        try {
            Uri finalUri;
            if (text != null && !text.isEmpty()) {
                finalUri = watermarkFile(filePath, text);
            } else {
                File file = new File(filePath);
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "File does not exist: " + filePath);
                    return;
                }
                finalUri = FileProvider.getUriForFile(
                    getReactApplicationContext(),
                    getReactApplicationContext().getPackageName() + ".provider",
                    file
                );
            }

            if (finalUri == null) {
                promise.reject("WATERMARK_ERROR", "Failed to process image");
                return;
            }

            Intent intent = new Intent();
            intent.setAction(Intent.ACTION_SEND);
            intent.setType("image/jpeg");
            intent.putExtra(Intent.EXTRA_STREAM, finalUri);
            
            if (text != null && !text.isEmpty()) {
                intent.putExtra(Intent.EXTRA_TEXT, text);
                intent.putExtra(Intent.EXTRA_SUBJECT, text);
                intent.putExtra(Intent.EXTRA_TITLE, text);
            }

            intent.setPackage("com.android.bluetooth");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getReactApplicationContext().startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SHARE_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void sendFilesViaBluetooth(ReadableArray filePaths, ReadableArray labels, com.facebook.react.bridge.Promise promise) {
        try {
            ArrayList<Uri> uris = new ArrayList<>();
            for (int i = 0; i < filePaths.size(); i++) {
                String filePath = filePaths.getString(i);
                String label = (labels != null && i < labels.size()) ? labels.getString(i) : null;
                
                Uri finalUri;
                if (label != null && !label.isEmpty()) {
                    finalUri = watermarkFile(filePath, label);
                } else {
                    File file = new File(filePath);
                    if (file.exists()) {
                        finalUri = FileProvider.getUriForFile(
                            getReactApplicationContext(),
                            getReactApplicationContext().getPackageName() + ".provider",
                            file
                        );
                    } else {
                        finalUri = null;
                    }
                }
                
                if (finalUri != null) {
                    uris.add(finalUri);
                }
            }

            if (uris.isEmpty()) {
                promise.reject("FILES_NOT_FOUND", "No valid files found for sharing");
                return;
            }

            Intent intent = new Intent();
            intent.setAction(Intent.ACTION_SEND_MULTIPLE);
            intent.setType("image/jpeg");
            intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);

            intent.setPackage("com.android.bluetooth");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getReactApplicationContext().startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SHARE_ERROR", e.getMessage());
        }
    }

    private Uri watermarkFile(String filePath, String text) {
        try {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inMutable = true;
            Bitmap src = BitmapFactory.decodeFile(filePath, options);
            if (src == null) return null;
            
            Canvas canvas = new Canvas(src);
            int width = src.getWidth();
            int height = src.getHeight();
            
            // Draw semi-transparent black bar at the top
            Paint barPaint = new Paint();
            barPaint.setColor(Color.BLACK);
            barPaint.setAlpha(180);
            
            int fontSize = width / 25; // Proportional font size
            if (fontSize < 20) fontSize = 20;
            
            Paint textPaint = new Paint();
            textPaint.setColor(Color.WHITE);
            textPaint.setTextSize(fontSize);
            textPaint.setAntiAlias(true);
            textPaint.setFakeBoldText(true);
            
            Rect textBounds = new Rect();
            textPaint.getTextBounds(text, 0, text.length(), textBounds);
            
            int padding = fontSize;
            int barHeight = textBounds.height() + padding * 2;
            
            // Draw background bar
            canvas.drawRect(0, 0, width, barHeight, barPaint);
            
            // Draw centered text
            float x = (width - textBounds.width()) / 2f;
            float y = padding + textBounds.height();
            canvas.drawText(text, x, y, textPaint);
            
            // Save to temp file
            File cacheDir = getReactApplicationContext().getCacheDir();
            File tempFile = File.createTempFile("watermarked_", ".jpg", cacheDir);
            FileOutputStream out = new FileOutputStream(tempFile);
            src.compress(Bitmap.CompressFormat.JPEG, 90, out);
            out.close();
            
            return FileProvider.getUriForFile(
                getReactApplicationContext(),
                getReactApplicationContext().getPackageName() + ".provider",
                tempFile
            );
        } catch (Exception e) {
            Log.e("SystemTimeModule", "Watermarking failed for: " + filePath, e);
            return null;
        }
    }

    private boolean isConnected(BluetoothDevice device) {
        try {
            Method m = device.getClass().getMethod("isConnected", (Class[]) null);
            return (boolean) m.invoke(device, (Object[]) null);
        } catch (Exception e) {
            return false;
        }
    }
}
