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
import android.os.PowerManager
import java.io.BufferedReader
import java.io.InputStreamReader

class RootPowerButtonService : Service() {

    private var process: Process? = null
    private var isRunning = false
    private var wasScreenInteractiveOnDown = false
    private var powerDownTime = 0L

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
            ensureWakeLock()
            Thread {
                logDeviceInfo()
                listenForPowerButton()
            }.start()
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
            powerDownTime = 0L

            while (isRunning) {
                val line = reader.readLine()
                if (line == null) {
                    Log.d("RootPowerMenu", "getevent output ended")
                    break
                }

                if (PowerMenuTriggerGate.isPowerDownLine(line)) {
                    Log.d("RootPowerMenu", "Power button DOWN: $line")
                    powerDownTime = System.currentTimeMillis()
                    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                    wasScreenInteractiveOnDown = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
                        powerManager.isInteractive
                    } else {
                        @Suppress("DEPRECATION")
                        powerManager.isScreenOn
                    }
                } else if (PowerMenuTriggerGate.isPowerUpLine(line)) {
                    Log.d("RootPowerMenu", "Power button UP: $line")
                    if (powerDownTime > 0) {
                        val duration = System.currentTimeMillis() - powerDownTime
                        powerDownTime = 0L
                        wakeUpScreen()
                        handlePowerButtonPress(duration)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to listen to getevent", e)
        }
    }

    private fun wakeUpScreen() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            val wakeLock = powerManager.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "dermaScopeApp::WakeLock"
            )
            wakeLock.acquire(3000)
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to acquire wakelock", e)
        }
    }

    private fun refreshAppWakeLock() {
        try {
            sendBroadcast(Intent("com.dermascopeapp.REFRESH_WAKE_LOCK"))
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to refresh wake lock", e)
        }
    }

    private fun ensureWakeLock() {
        try {
            sendBroadcast(Intent("com.dermascopeapp.ACQUIRE_WAKE_LOCK"))
        } catch (e: Exception) {
            Log.e("RootPowerMenu", "Failed to ensure wake lock", e)
        }
    }

    private fun handlePowerButtonPress(durationMs: Long) {
        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val isLocked = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            keyguardManager.isDeviceLocked
        } else {
            keyguardManager.isKeyguardLocked
        }

        if (!wasScreenInteractiveOnDown || MainActivity.isDeliberateLock) {
            Log.d(
                "RootPowerMenu",
                "Wake only (no power menu). wasInteractive=$wasScreenInteractiveOnDown deliberate=${MainActivity.isDeliberateLock}"
            )
            MainActivity.clearDeliberateLockAndRestoreKeepAwake()
            refreshAppWakeLock()
            return
        }

        if (isLocked) {
            Log.d("RootPowerMenu", "Skipping broadcast: secure keyguard locked")
            return
        }

        refreshAppWakeLock()
        PowerMenuTriggerGate.broadcastPowerPressed(
            this,
            source = "RootPowerButtonService",
            pressDurationMs = durationMs,
            wasInteractiveOnDown = true
        )
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
