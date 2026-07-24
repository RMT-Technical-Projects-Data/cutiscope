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
import java.io.OutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class SystemTimeModule extends ReactContextBaseJavaModule {

    SystemTimeModule(ReactApplicationContext context) {
        super(context);
    }

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
                // su not found, if the app has permission it might work via sh for some
                // settings
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
                // Do not forget the network before connecting — that wipes saved credentials
                // and forces the user to re-enter the password. Use forgetNetwork() only
                // when the user explicitly chooses "Forget".
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

    /**
     * Trigger a privileged Wi-Fi scan (bypasses normal app scan throttling on many builds).
     * Results still come from WifiManager scan cache — call loadWifiList shortly after.
     */
    @ReactMethod
    public void forceWifiScan(com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            os.writeBytes("cmd wifi start-scan\n");
            os.writeBytes("exit\n");
            os.flush();
            os.close();
            int exitCode = process.waitFor();
            if (exitCode == 0) {
                promise.resolve(true);
            } else {
                promise.reject("SCAN_FAILED", "Root wifi start-scan failed with exit code " + exitCode);
            }
        } catch (Exception e) {
            promise.reject("SCAN_ERROR", e.getMessage());
        }
    }

    private String normalizeSsid(String ssid) {
        if (ssid == null) {
            return "";
        }
        String value = ssid.trim();
        if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }

    private void forgetNetworkInternal(String ssid) {
        try {
            String normalizedSsid = normalizeSsid(ssid);
            if (normalizedSsid.isEmpty()) {
                return;
            }
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
                if (line.contains(normalizedSsid)) {
                    String[] parts = line.trim().split("\\s+");
                    if (parts.length > 0) {
                        // Check if this line actually matches the SSID
                        if (line.contains("\"" + normalizedSsid + "\"") || line.contains(normalizedSsid)) {
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

    /**
     * Batch-delete many files/folders in a SINGLE root shell.
     * This avoids spawning one `su` process (and one media-scan broadcast) per
     * file, which made deleting 100-200 images take minutes. `rm -rf` handles
     * both files and directories, and we trigger just one media scan per unique
     * parent directory instead of one per file.
     */
    @ReactMethod
    public void deletePathsRoot(com.facebook.react.bridge.ReadableArray paths, com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());

            java.util.HashSet<String> parents = new java.util.HashSet<>();
            for (int i = 0; i < paths.size(); i++) {
                String p = paths.getString(i);
                if (p == null || p.isEmpty()) continue;
                os.writeBytes("rm -rf \"" + p + "\"\n");
                int slash = p.lastIndexOf('/');
                if (slash > 0) parents.add(p.substring(0, slash));
            }

            // One media-scan per parent directory (far fewer than per-file).
            for (String parent : parents) {
                os.writeBytes("am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d \"file://" + parent + "\"\n");
            }

            os.writeBytes("exit\n");
            os.flush();
            os.close();

            int exitCode = process.waitFor();
            promise.resolve(exitCode == 0);
        } catch (Exception e) {
            promise.reject("DELETE_ERROR", e.getMessage());
        }
    }

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
}
