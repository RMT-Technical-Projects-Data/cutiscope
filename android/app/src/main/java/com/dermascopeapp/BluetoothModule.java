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
import android.bluetooth.BluetoothSocket;
import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import java.util.concurrent.atomic.AtomicReference;
import java.io.OutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class BluetoothModule extends ReactContextBaseJavaModule {

    private final ConcurrentHashMap<String, CountDownLatch> pendingBondLatches = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Boolean> pendingBondResults = new ConcurrentHashMap<>();
    /** When true, intercept system pairing UI and auto-confirm — no app/system pair-request dialog. */
    private final AtomicBoolean appInitiatedPairing = new AtomicBoolean(false);
    /** Never block the main thread with su/waitFor during pairing. */
    private final ExecutorService pairingExecutor = Executors.newSingleThreadExecutor();
    /** Address of the bond we started, so unrelated bond events do not clear our state. */
    private final AtomicReference<String> pairingAddress = new AtomicReference<>(null);
    /** Hidden BluetoothDevice.PAIRING_VARIANT_CONSENT — "just works" pairing. */
    private static final int PAIRING_VARIANT_CONSENT = 3;
    /** Hidden BluetoothDevice.EXTRA_REASON — carries UNBOND_REASON_* on a failed bond. */
    private static final String EXTRA_UNBOND_REASON = "android.bluetooth.device.extra.REASON";
    private static final long BOND_WAIT_SECONDS = 60L;

    BluetoothModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public void initialize() {
        super.initialize();
        try {
            IntentFilter filter = new IntentFilter();
            filter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY);
            filter.addAction(BluetoothDevice.ACTION_FOUND);
            filter.addAction(BluetoothDevice.ACTION_NAME_CHANGED);
            filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED);
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
            if (BluetoothDevice.ACTION_FOUND.equals(action)
                    || BluetoothDevice.ACTION_NAME_CHANGED.equals(action)) {
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device != null) {
                    try {
                        // getName() is often null on the first broadcast; the intent carries
                        // the name as soon as the remote device reports it.
                        String name = intent.getStringExtra(BluetoothDevice.EXTRA_NAME);
                        if (name == null || name.trim().isEmpty()) {
                            name = device.getName();
                        }

                        WritableMap map = Arguments.createMap();
                        map.putString("name", name != null ? name : "");
                        map.putString("address", device.getAddress());

                        String event = BluetoothDevice.ACTION_NAME_CHANGED.equals(action)
                                ? "onBluetoothDeviceNameChanged"
                                : "onBluetoothDeviceFound";
                        getReactApplicationContext()
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit(event, map);
                    } catch (SecurityException e) {
                        // Silently handle
                    }
                }
            } else if (BluetoothAdapter.ACTION_DISCOVERY_STARTED.equals(action)) {
                getReactApplicationContext()
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                        .emit("onBluetoothDiscoveryStarted", null);
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
                if (device == null) return;
                if (!appInitiatedPairing.get()) return;

                int variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, -1);
                boolean autoConfirmable = variant == BluetoothDevice.PAIRING_VARIANT_PASSKEY_CONFIRMATION
                        || variant == PAIRING_VARIANT_CONSENT;

                boolean confirmed = false;
                if (autoConfirmable) {
                    try {
                        // Fast binder call; only works on privileged builds. Never run
                        // su/waitFor here — that blocked the main thread and caused ANRs.
                        confirmed = device.setPairingConfirmation(true);
                    } catch (Throwable t) {
                        confirmed = false;
                    }
                }

                if (confirmed) {
                    try {
                        abortBroadcast();
                    } catch (Exception ignored) {
                    }
                }
                // If we could not confirm, let the system pairing dialog through. Swallowing
                // it left the bond unanswered until Android timed out and cancelled it.
                // Do not reapply lock-task here — fighting the pairing overlay causes black screens.
            } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(action)) {
                int state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR);
                int prevState = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.ERROR);
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);

                if (device != null) {
                    String address = device.getAddress();
                    String pairing = pairingAddress.get();
                    boolean isOurBond = pairing == null || pairing.equalsIgnoreCase(address);

                    if (isOurBond && (state == BluetoothDevice.BOND_BONDED || state == BluetoothDevice.BOND_NONE)) {
                        appInitiatedPairing.set(false);
                        pairingAddress.set(null);
                        Activity activity = getCurrentActivity();
                        if (activity != null) {
                            MainActivity.stopImmersiveKioskWatchdog(activity);
                            MainActivity.reapplyFullKiosk(activity);
                        }
                    }

                    if (state == BluetoothDevice.BOND_BONDED) {
                        completeBondWait(address, true);
                        WritableMap map = Arguments.createMap();
                        map.putString("address", address);
                        map.putBoolean("bonded", true);
                        getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("onBluetoothBondStateChanged", map);
                    } else if (state == BluetoothDevice.BOND_NONE && prevState != BluetoothDevice.BOND_BONDED) {
                        // Includes BOND_BONDING -> BOND_NONE (rejected / timed out) and builds
                        // that report an unknown previous state.
                        completeBondWait(address, false);
                        WritableMap map = Arguments.createMap();
                        map.putString("address", address);
                        map.putBoolean("bonded", false);
                        map.putBoolean("cancelled", true);
                        // The system Bluetooth UI raises its own error toast for most of
                        // these reasons; JS uses it to avoid stacking a second message.
                        map.putInt("reason", intent.getIntExtra(EXTRA_UNBOND_REASON, -1));
                        getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("onBluetoothBondStateChanged", map);
                    }
                }
            }
        }
    };

    @Override
    public String getName() {
        return "BluetoothModule";
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
                // Note: enable() is deprecated since API 33 and may require user consent or be
                // restricted
                success = adapter.enable();
            } else {
                success = adapter.disable();
            }

            // On many modern Android versions, enable/disable returns false if the app
            // isn't a system app,
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
            final BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported");
                return;
            }
            if (!adapter.isEnabled()) {
                promise.reject("BT_DISABLED", "Bluetooth is turned off");
                return;
            }

            if (adapter.isDiscovering()) {
                adapter.cancelDiscovery();
                // cancelDiscovery() is asynchronous — starting immediately makes the
                // adapter drop the new scan, so no devices are ever reported.
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        adapter.startDiscovery();
                    } catch (Exception ignored) {
                    }
                }, 400);
                promise.resolve(true);
                return;
            }

            boolean started = adapter.startDiscovery();
            promise.resolve(started);
        } catch (SecurityException e) {
            promise.reject("BT_PERMISSION", "BLUETOOTH_SCAN permission required", e);
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
        } catch (SecurityException e) {
            // Opportunistic stop from Camera focus ? treat missing permission as no-op.
            promise.resolve(false);
        } catch (Exception e) {
            promise.resolve(false);
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
    public void pairDevice(final String address, final com.facebook.react.bridge.Promise promise) {
        try {
            final BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported");
                return;
            }
            final BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device != null) {
                final Activity activity = getCurrentActivity();
                if (activity != null) {
                    activity.runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                                promise.resolve(true);
                                return;
                            }

                            appInitiatedPairing.set(true);
                            pairingAddress.set(address);
                            // Pause kiosk lock-task so system pairing UI can appear without black screens.
                            MainActivity.stopImmersiveKioskWatchdog(activity);
                            try {
                                activity.stopLockTask();
                            } catch (Exception ignored) {
                            }

                            // Discovery keeps the radio busy and makes bonding slow enough to
                            // time out — stop it and give the adapter a moment to settle.
                            try {
                                if (adapter.isDiscovering()) {
                                    adapter.cancelDiscovery();
                                }
                            } catch (SecurityException ignored) {
                            }

                            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                                try {
                                    if (device.getBondState() == BluetoothDevice.BOND_BONDING
                                            || device.getBondState() == BluetoothDevice.BOND_BONDED) {
                                        promise.resolve(true);
                                        return;
                                    }
                                    if (device.createBond()) {
                                        promise.resolve(true);
                                    } else {
                                        appInitiatedPairing.set(false);
                                        pairingAddress.set(null);
                                        MainActivity.reapplyFullKiosk(activity);
                                        promise.reject("PAIR_ERROR", "Failed to start bonding");
                                    }
                                } catch (Exception e) {
                                    appInitiatedPairing.set(false);
                                    pairingAddress.set(null);
                                    MainActivity.reapplyFullKiosk(activity);
                                    promise.reject("PAIR_ERROR", e.getMessage());
                                }
                            }, 350);
                        }
                    });
                } else {
                    promise.reject("ACTIVITY_NULL", "Activity is null");
                }
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

    /**
     * Confirms or rejects an in-flight pairing request.
     *
     * Only the documented API is used. Blind "service call bluetooth <code>"
     * transactions were previously attempted as a root fallback, but those
     * transaction ids differ per Android version and frequently landed on
     * cancelBondProcess/removeBond — silently aborting the pairing instead.
     */
    @ReactMethod
    public void confirmPairing(String address, boolean confirm, com.facebook.react.bridge.Promise promise) {
        pairingExecutor.execute(() -> {
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                BluetoothDevice device = adapter != null ? adapter.getRemoteDevice(address) : null;
                if (device == null) {
                    promise.reject("ERROR", "Device not found");
                    return;
                }
                if (confirm) {
                    promise.resolve(device.setPairingConfirmation(true));
                } else {
                    promise.resolve(cancelBondProcess(device));
                }
            } catch (SecurityException e) {
                promise.reject("BT_NOT_PRIVILEGED", "Pairing must be confirmed on screen", e);
            } catch (Exception e) {
                promise.reject("ERROR", e.getMessage());
            }
        });
    }

    /** Aborts a bond that is still in progress, e.g. after a JS-side timeout. */
    @ReactMethod
    public void cancelPairing(String address, com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            BluetoothDevice device = adapter != null ? adapter.getRemoteDevice(address) : null;
            if (device == null) {
                promise.resolve(false);
                return;
            }
            appInitiatedPairing.set(false);
            pairingAddress.set(null);
            boolean cancelled = device.getBondState() == BluetoothDevice.BOND_BONDING
                    && cancelBondProcess(device);
            Activity activity = getCurrentActivity();
            if (activity != null) {
                MainActivity.reapplyFullKiosk(activity);
            }
            promise.resolve(cancelled);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    private boolean cancelBondProcess(BluetoothDevice device) {
        try {
            Method m = device.getClass().getMethod("cancelBondProcess", (Class[]) null);
            Object result = m.invoke(device, (Object[]) null);
            return result instanceof Boolean ? (Boolean) result : true;
        } catch (Exception e) {
            return false;
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
                        file);
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
    public void sendFilesViaBluetooth(ReadableArray filePaths, ReadableArray labels,
            com.facebook.react.bridge.Promise promise) {
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
                                file);
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

    private void completeBondWait(String address, boolean success) {
        pendingBondResults.put(address, success);
        CountDownLatch latch = pendingBondLatches.get(address);
        if (latch != null) {
            latch.countDown();
        }
    }

    private boolean ensureDeviceBonded(BluetoothDevice device) throws Exception {
        if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
            return true;
        }

        String address = device.getAddress();
        CountDownLatch latch = new CountDownLatch(1);
        pendingBondLatches.put(address, latch);

        try {
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                return true;
            }

            final Activity activity = getCurrentActivity();
            if (activity != null) {
                try {
                    activity.runOnUiThread(() -> {
                        appInitiatedPairing.set(true);
                        pairingAddress.set(address);
                        MainActivity.stopImmersiveKioskWatchdog(activity);
                        try {
                            activity.stopLockTask();
                        } catch (Exception ignored) {
                        }
                    });
                } catch (Exception ignored) {
                }
            } else {
                appInitiatedPairing.set(true);
            }

            if (device.getBondState() == BluetoothDevice.BOND_NONE) {
                device.createBond();
            }

            latch.await(BOND_WAIT_SECONDS, TimeUnit.SECONDS);
            return device.getBondState() == BluetoothDevice.BOND_BONDED;
        } finally {
            appInitiatedPairing.set(false);
            pairingAddress.set(null);
            pendingBondLatches.remove(address);
            pendingBondResults.remove(address);
            Activity activity = getCurrentActivity();
            if (activity != null) {
                MainActivity.reapplyFullKiosk(activity);
            }
        }
    }

    // -------------------------------------------------------------
    // send bluettoth direct file transfer logic
    @ReactMethod
    public void sendFileDirectViaBluetooth(ReadableArray filePaths, String address,
            com.facebook.react.bridge.Promise promise) {
        new Thread(() -> {
            BluetoothSocket socket = null;
            boolean rfcommConnected = false; // ★ track whether we got past connection

            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null) {
                    promise.reject("BT_UNSUPPORTED", "Bluetooth not supported");
                    return;
                }

                BluetoothDevice device = adapter.getRemoteDevice(address);
                if (device == null) {
                    promise.reject("BT_DEVICE_NOT_FOUND", "Device not found");
                    return;
                }

                if (adapter.isDiscovering())
                    adapter.cancelDiscovery();

                if (!ensureDeviceBonded(device)) {
                    promise.reject("BT_PAIRING_CANCELLED", "Bluetooth pairing was cancelled or failed");
                    return;
                }

                java.util.UUID OPP_UUID = java.util.UUID.fromString("00001105-0000-1000-8000-00805F9B34FB");

                // Try secure RFCOMM first, then insecure
                try {
                    socket = device.createRfcommSocketToServiceRecord(OPP_UUID);
                    socket.connect();
                    Log.i("SystemTimeModule", "Secure RFCOMM connected");
                } catch (Exception e1) {
                    Log.w("SystemTimeModule", "Secure RFCOMM failed, trying insecure: " + e1.getMessage());
                    try {
                        if (socket != null)
                            socket.close();
                    } catch (Exception ignored) {
                    }
                    socket = null;
                    try {
                        socket = device.createInsecureRfcommSocketToServiceRecord(OPP_UUID);
                        socket.connect();
                        Log.i("SystemTimeModule", "Insecure RFCOMM connected");
                    } catch (Exception e2) {
                        Log.w("SystemTimeModule",
                                "UUID-based RFCOMM failed, trying fixed channels (PC fallback): " + e2.getMessage());
                        try {
                            if (socket != null)
                                socket.close();
                        } catch (Exception ignored) {
                        }
                        socket = null;
                        int[] channelsToTry = { 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
                        BluetoothSocket connectedSocket = null;
                        for (int ch : channelsToTry) {
                            BluetoothSocket candidate = null;
                            try {

                                java.lang.reflect.Method m = device.getClass().getMethod("createInsecureRfcommSocket",
                                        int.class);
                                candidate = (BluetoothSocket) m.invoke(device, ch);
                                candidate.connect();
                                Log.i("SystemTimeModule", "Fixed channel RFCOMM connected on channel " + ch);
                                connectedSocket = candidate;
                                break;
                            } catch (Exception eCh) {
                                Log.w("SystemTimeModule", "Channel " + ch + " failed: " + eCh.getMessage());
                                try {
                                    if (candidate != null)
                                        candidate.close();
                                } catch (Exception ignored) {
                                }
                            }
                        }

                        if (connectedSocket == null) {
                            Log.e("SystemTimeModule", "All RFCOMM attempts failed: " + e2.getMessage());
                            promise.reject("BT_CONNECT_FAILED",
                                    "Make sure the receiving device is set to receive files via Bluetooth.");
                            return;
                        }
                        socket = connectedSocket;
                    }
                }

                // ★ Mark that RFCOMM is up — any failure after this is an OBEX-level rejection
                rfcommConnected = true;

                sendObexFiles(socket, filePaths);

                try {
                    BluetoothOppCleanup.clearCompletedTransfers(getReactApplicationContext());
                } catch (Exception cleanupEx) {
                    Log.w("SystemTimeModule", "Bluetooth OPP cleanup failed: " + cleanupEx.getMessage());
                }

                try {
                    WritableMap statusMap = Arguments.createMap();
                    statusMap.putString("status", "completed");
                    getReactApplicationContext()
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                            .emit("onBluetoothShareStatusChanged", statusMap);
                } catch (Exception ex) {
                    Log.e("SystemTimeModule", "Failed to emit completed status: " + ex.getMessage());
                }
                promise.resolve("Files sent successfully");

            } catch (Exception e) {
                Log.e("SystemTimeModule", "OBEX transfer failed: " + e.getMessage());

                if (!rfcommConnected) {
                    // Should not reach here (handled above) but guard anyway
                    // launchSystemShare(filePaths, null, promise);
                    promise.reject("BT_CONNECT_FAILED",
                            "Make sure the receiving device is set to receive files via Bluetooth.");
                } else {
                    // ★ OBEX was rejected or cancelled by remote device
                    // Do NOT launch system share — just reject cleanly, stay in kiosk mode
                    try {
                        WritableMap statusMap = Arguments.createMap();
                        statusMap.putString("status", "cancelled");
                        getReactApplicationContext()
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("onBluetoothShareStatusChanged", statusMap);
                    } catch (Exception ex) {
                        Log.e("SystemTimeModule", "Failed to emit cancelled status: " + ex.getMessage());
                    }
                    promise.reject("BT_TRANSFER_FAILED", "Transfer failed or was cancelled: " + e.getMessage());
                }
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        }).start();
    }

    private void launchSystemShare(ReadableArray filePaths, BluetoothDevice device,
            com.facebook.react.bridge.Promise promise) {
        try {
            ArrayList<Uri> uris = new ArrayList<>();
            for (int i = 0; i < filePaths.size(); i++) {
                File file = new File(filePaths.getString(i));
                if (file.exists()) {
                    uris.add(FileProvider.getUriForFile(getReactApplicationContext(),
                            getReactApplicationContext().getPackageName() + ".provider", file));
                }
            }
            Intent intent = new Intent(Intent.ACTION_SEND_MULTIPLE);
            intent.setType("image/jpeg");
            intent.setPackage("com.android.bluetooth");
            intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            if (device != null)
                intent.putExtra(BluetoothDevice.EXTRA_DEVICE, device);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

            Activity activity = getCurrentActivity();
            if (activity != null)
                try {
                    activity.stopLockTask();
                } catch (Exception ignored) {
                }

            getReactApplicationContext().startActivity(intent);
            promise.resolve("Fallback system share launched");
        } catch (Exception e) {
            promise.reject("SHARE_ERROR", e.getMessage());
        }
    }

    // ─── Corrected OBEX client
    // ────────────────────────────────────────────────────

    private void sendObexFiles(BluetoothSocket socket, ReadableArray filePaths) throws Exception {
        OutputStream out = socket.getOutputStream();
        InputStream in = socket.getInputStream();

        // ── CONNECT ──────────────────────────────────────────────────────────────
        // Advertise 0xFFFF but we MUST use whatever the server responds with
        out.write(new byte[] {
                (byte) 0x80, 0x00, 0x07, // opcode CONNECT + length=7
                0x10, 0x00, // OBEX v1.0, flags=0
                (byte) 0xFF, (byte) 0xFF // our advertised max packet size
        });
        out.flush();

        byte[] connResp = readObexPacket(in);
        if ((connResp[0] & 0xFF) != 0xA0)
            throw new IOException("OBEX CONNECT rejected: 0x" + Integer.toHexString(connResp[0] & 0xFF));

        try {
            WritableMap map = Arguments.createMap();
            map.putString("status", "accepted");
            getReactApplicationContext()
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onBluetoothShareStatusChanged", map);
        } catch (Exception e) {
            Log.e("SystemTimeModule", "Failed to emit accepted status: " + e.getMessage());
        }

        // ★ Read server's max packet size from CONNECT response bytes 5-6
        // Layout: [respCode(1)] [pktLen(2)] [version(1)] [flags(1)] [maxPkt(2)]
        int serverMaxPacket = 0xFFFF;
        if (connResp.length >= 7) {
            serverMaxPacket = ((connResp[5] & 0xFF) << 8) | (connResp[6] & 0xFF);
            if (serverMaxPacket < 255)
                serverMaxPacket = 255; // sanity floor
        }
        final int MAX_PACKET = serverMaxPacket; // ★ use THIS for all PUT packets
        Log.i("SystemTimeModule", "OBEX CONNECT OK — server max packet: " + MAX_PACKET + " bytes");

        // ── PUT each file ─────────────────────────────────────────────────────────
        for (int i = 0; i < filePaths.size(); i++) {
            File file = new File(filePaths.getString(i));
            if (!file.exists()) {
                Log.w("SystemTimeModule", "Skipping missing file: " + filePaths.getString(i));
                continue;
            }

            // Read whole file into memory
            byte[] fileData;
            try (FileInputStream fis = new FileInputStream(file);
                    ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
                byte[] tmp = new byte[8192];
                int n;
                while ((n = fis.read(tmp)) != -1)
                    buf.write(tmp, 0, n);
                fileData = buf.toByteArray();
            }

            byte[] nameHdr = buildNameHeader(file.getName()); // UTF-16BE, 0x01
            byte[] typeHdr = buildTypeHeader("image/jpeg"); // ASCII+\0, 0x42
            byte[] lenHdr = buildLengthHeader(fileData.length); // 4-byte int, 0xC3

            int pktOverhead = 3; // opcode(1) + pkt-len(2)
            int bodyHdrSize = 3; // body-HI(1) + body-len(2)
            int commonHeaders = nameHdr.length + typeHdr.length + lenHdr.length;

            int offset = 0;
            boolean firstPacket = true;

            while (offset < fileData.length) {
                int available = MAX_PACKET - pktOverhead - bodyHdrSize;
                if (firstPacket)
                    available -= commonHeaders;

                int chunkSize = Math.min(fileData.length - offset, available);
                boolean isLast = (offset + chunkSize >= fileData.length);

                ByteArrayOutputStream payload = new ByteArrayOutputStream();
                if (firstPacket) {
                    payload.write(nameHdr);
                    payload.write(typeHdr);
                    payload.write(lenHdr);
                }

                // 0x48 = Body (more to come), 0x49 = End-of-Body (last chunk)
                int bodyHdrLen = 3 + chunkSize;
                payload.write(isLast ? 0x49 : 0x48);
                payload.write(bodyHdrLen >> 8);
                payload.write(bodyHdrLen & 0xFF);
                payload.write(fileData, offset, chunkSize);

                byte[] payloadBytes = payload.toByteArray();
                int pktLen = pktOverhead + payloadBytes.length;

                // 0x02 = PUT non-final, 0x82 = PUT final (last packet for this file)
                out.write(isLast ? 0x82 : 0x02);
                out.write(pktLen >> 8);
                out.write(pktLen & 0xFF);
                out.write(payloadBytes);
                out.flush();

                byte[] resp = readObexPacket(in);
                int respCode = resp[0] & 0xFF;

                if (isLast) {
                    if (respCode != 0xA0)
                        throw new IOException(
                                "PUT final rejected for " + file.getName() + ": 0x" + Integer.toHexString(respCode));
                    Log.i("SystemTimeModule", "PUT OK: " + file.getName());
                } else {
                    if (respCode != 0x90)
                        throw new IOException("PUT continue rejected: 0x" + Integer.toHexString(respCode));
                }

                offset += chunkSize;
                firstPacket = false;
            }
        }

        // ── DISCONNECT ───────────────────────────────────────────────────────────
        out.write(new byte[] { (byte) 0x81, 0x00, 0x03 });
        out.flush();
        try {
            readObexPacket(in);
        } catch (Exception ignored) {
        }
        // socket.close();
        Log.i("SystemTimeModule", "OBEX session complete");
    }
    // ─── OBEX header builders
    // ─────────────────────────────────────────────────────

    /** 0x01 — Name: Unicode UTF-16BE + 2-byte null terminator */
    private byte[] buildNameHeader(String name) throws Exception {
        byte[] utf16 = name.getBytes("UTF-16BE");
        int total = 3 + utf16.length + 2; // HI(1) + len(2) + chars + null(2)
        byte[] h = new byte[total];
        h[0] = 0x01;
        h[1] = (byte) (total >> 8);
        h[2] = (byte) (total & 0xFF);
        System.arraycopy(utf16, 0, h, 3, utf16.length);
        // Last 2 bytes stay 0x00 0x00 (null terminator) from array init
        return h;
    }

    /** 0x42 — Type: ASCII MIME type + single null terminator */
    private byte[] buildTypeHeader(String mimeType) throws Exception {
        byte[] ascii = (mimeType + "\0").getBytes("US-ASCII");
        int total = 3 + ascii.length;
        byte[] h = new byte[total];
        h[0] = 0x42;
        h[1] = (byte) (total >> 8);
        h[2] = (byte) (total & 0xFF);
        System.arraycopy(ascii, 0, h, 3, ascii.length);
        return h;
    }

    /**
     * 0xC3 — Length: 4-byte unsigned int.
     * Note: 0xCx headers have NO length field — just HI(1) + value(4) = 5 bytes
     * total.
     */
    private byte[] buildLengthHeader(long len) {
        return new byte[] {
                (byte) 0xC3,
                (byte) (len >> 24), (byte) (len >> 16), (byte) (len >> 8), (byte) len
        };
    }

    // ─── I/O helpers ─────────────────────────────────────────────────────────────

    /** Read a full OBEX response packet (header tells us the length). */
    private byte[] readObexPacket(InputStream in) throws IOException {
        byte[] hdr = new byte[3];
        readFully(in, hdr, 0, 3);
        int total = ((hdr[1] & 0xFF) << 8) | (hdr[2] & 0xFF);
        if (total < 3)
            throw new IOException("Malformed OBEX packet, length=" + total);
        byte[] pkt = new byte[total];
        pkt[0] = hdr[0];
        pkt[1] = hdr[1];
        pkt[2] = hdr[2];
        if (total > 3)
            readFully(in, pkt, 3, total - 3);
        return pkt;
    }

    private void readFully(InputStream in, byte[] buf, int off, int len) throws IOException {
        int read = 0;
        while (read < len) {
            int n = in.read(buf, off + read, len - read);
            if (n == -1)
                throw new IOException("Stream closed unexpectedly after " + read + "/" + len + " bytes");
            read += n;
        }
    }

    // ------------------------------------------------------------------------------------------
    @ReactMethod
    public void getWatermarkedImage(String filePath, String text, com.facebook.react.bridge.Promise promise) {
        String path = watermarkFileInternal(filePath, text);
        if (path != null) {
            promise.resolve(path);
        } else {
            promise.reject("WATERMARK_ERROR", "Failed to watermark image");
        }
    }

    private String watermarkFileInternal(String filePath, String text) {
        try {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inMutable = true;
            Bitmap src = BitmapFactory.decodeFile(filePath, options);
            if (src == null)
                return null;

            Canvas canvas = new Canvas(src);
            int width = src.getWidth();
            int height = src.getHeight();

            // Draw semi-transparent black bar at the top
            Paint barPaint = new Paint();
            barPaint.setColor(Color.BLACK);
            barPaint.setAlpha(180);

            int fontSize = width / 25; // Proportional font size
            if (fontSize < 20)
                fontSize = 20;

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

            return tempFile.getAbsolutePath();
        } catch (Exception e) {
            Log.e("SystemTimeModule", "Watermarking failed for: " + filePath, e);
            return null;
        }
    }

    private Uri watermarkFile(String filePath, String text) {
        String path = watermarkFileInternal(filePath, text);
        if (path == null)
            return null;

        return FileProvider.getUriForFile(
                getReactApplicationContext(),
                getReactApplicationContext().getPackageName() + ".provider",
                new File(path));
    }

    private boolean isConnected(BluetoothDevice device) {
        try {
            Method m = device.getClass().getMethod("isConnected", (Class[]) null);
            return (boolean) m.invoke(device, (Object[]) null);
        } catch (Exception e) {
            return false;
        }
    }

    @ReactMethod
    public void setBluetoothName(String name, com.facebook.react.bridge.Promise promise) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("BT_NOT_SUPPORTED", "Bluetooth is not supported on this device");
                return;
            }
            boolean success = adapter.setName(name);
            if (success) {
                promise.resolve(true);
            } else {
                promise.reject("BT_NAME_SET_FAILED", "Failed to set Bluetooth local name");
            }
        } catch (Exception e) {
            promise.reject("BT_NAME_SET_EXCEPTION", e.getMessage(), e);
        }
    }
}