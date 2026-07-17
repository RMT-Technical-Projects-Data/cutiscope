package com.dermascopeapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import android.app.KeyguardManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import java.io.BufferedReader
import java.io.InputStreamReader

class RootPowerButtonService : Service() {

    private var process: Process? = null
    private var isRunning = false
    private var wasScreenInteractiveOnDown = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        val notification = NotificationCompat.Builder(this, "PowerMenuService")
            .setContentTitle("dermaScope Power Active")
            .setContentText("Listening for Power Button...")
            .setSmallIcon(android.R.drawable.ic_lock_power_off)
            .build()
        startForeground(1, notification)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isRunning) {
            isRunning = true
            
            // ========== ADD THIS: Ensure wake lock on service start ==========
            ensureWakeLock()
            // ==================================================================
            
            Thread { 
                logDeviceInfo()
                listenForPowerButton() 
            }.start()
            
            // Disable default long-press power menu
            try {
                Runtime.getRuntime().exec(arrayOf("su", "-c", "settings put global power_button_long_press 0"))
                Log.d("RootPowerMenu", "Disabled long-press power button settings")
            } catch (e: Exception) {
                Log.e("RootPowerMenu", "Failed to disable long-press", e)
            }
        }
        return START_STICKY
    }

    private fun listenForPowerButton() {
        try {
            process = Runtime.getRuntime().exec(arrayOf("su", "-c", "getevent -lq"))
            val reader = BufferedReader(InputStreamReader(process!!.inputStream))
            var powerDownTime = 0L

            while (isRunning) {
                val line = reader.readLine()
                if (line == null) {
                    Log.d("RootPowerMenu", "getevent output ended")
                    break
                }
                
                // Flexible matching for KEY_POWER or hex 0074
                // Typical lines: 
                // /dev/input/event3: 0001 0074 00000001
                // /dev/input/event3: EV_KEY KEY_POWER DOWN
                val isPowerKey = line.contains("KEY_POWER") || line.contains(" 0074 ")
                val isDown = line.contains("DOWN") || line.endsWith("00000001")
                val isUp = line.contains("UP") || line.endsWith("00000000")

                if (isPowerKey) {
                    Log.d("RootPowerMenu", "Power event detected: $line")
                    if (isDown) {
                        Log.d("RootPowerMenu", "Power button DOWN detected")
                        powerDownTime = System.currentTimeMillis()
                        
                        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                        wasScreenInteractiveOnDown = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
                            powerManager.isInteractive
                        } else {
                            @Suppress("DEPRECATION")
                            powerManager.isScreenOn
                        }
                    } else if (isUp) {
                        Log.d("RootPowerMenu", "Power button UP detected")
                        if (powerDownTime > 0) { 
                            wakeUpScreen()
                            handlePowerButtonPress()
                            powerDownTime = 0L
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to listen to getevent", e)
        }
    }

    private fun wakeUpScreen() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            val wakeLock = powerManager.newWakeLock(
                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "dermaScopeApp::WakeLock"
            )
            wakeLock.acquire(3000)
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to acquire wakelock", e)
        }
    }

    private fun refreshAppWakeLock() {
        try {
            val intent = Intent("com.dermascopeapp.REFRESH_WAKE_LOCK")
            sendBroadcast(intent)
            Log.d("RootPowerMenu", "Wake lock refresh requested")
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to refresh wake lock", e)
        }
    }

    private fun ensureWakeLock() {
        try {
            val intent = Intent("com.dermascopeapp.ACQUIRE_WAKE_LOCK")
            sendBroadcast(intent)
            Log.d("RootPowerMenu", "Wake lock acquisition requested")
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to ensure wake lock", e)
        }
    }

    private fun handlePowerButtonPress() {
        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val isLocked = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            keyguardManager.isDeviceLocked
        } else {
            keyguardManager.isKeyguardLocked
        }

        // Wake-from-lock / screen-was-off: only wake the display — do NOT open power menu.
        if (!wasScreenInteractiveOnDown || MainActivity.isDeliberateLock) {
            Log.d(
                "RootPowerMenu",
                "Wake only (no power menu). wasInteractive=$wasScreenInteractiveOnDown deliberate=${MainActivity.isDeliberateLock}"
            )
            MainActivity.clearDeliberateLockAndRestoreKeepAwake()
            refreshAppWakeLock()
            return
        }

        // Screen was already ON: show in-app power menu (unless secure keyguard is up).
        if (!isLocked) {
            Log.d("RootPowerMenu", "Screen was ON — broadcasting POWER_BUTTON_PRESSED")
            refreshAppWakeLock()
            val intent = Intent("com.dermascopeapp.POWER_BUTTON_PRESSED")
            sendBroadcast(intent)
        } else {
            Log.d("RootPowerMenu", "Skipping broadcast: secure keyguard locked")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        process?.destroy()
        try {
            Runtime.getRuntime().exec(arrayOf("su", "-c", "settings put global power_button_long_press 1"))
        } catch (e: Exception) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun logDeviceInfo() {
        try {
            val process = Runtime.getRuntime().exec(arrayOf("su", "-c", "getevent -i"))
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            Log.d("RootPowerMenu", "--- Device Info Start ---")
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                Log.d("RootPowerMenu", line!!)
            }
            Log.d("RootPowerMenu", "--- Device Info End ---")
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to get device info", e)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "PowerMenuService",
                "Power Menu Background Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }
}
