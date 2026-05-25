package com.dermascopeapp

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.view.KeyEvent
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import com.github.kevinejohn.keyevent.KeyEventModule
import android.media.AudioManager
import android.util.Log
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import android.os.PowerManager
import android.hardware.camera2.CameraManager
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ReactActivity() {
    companion object {
        @JvmStatic
        @Volatile
        var isDeliberateLock = false
    }

    // Add these fields with your existing ones
    private var wakeLock: PowerManager.WakeLock? = null
    private var temporaryWakeLock: PowerManager.WakeLock? = null
    private val wakeLockRefreshHandler = Handler(Looper.getMainLooper())
    private var wakeLockRefreshRunnable: Runnable? = null
    
    // Add this broadcast receiver to refresh wake lock from service
    private val wakeLockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                "com.dermascopeapp.REFRESH_WAKE_LOCK" -> refreshWakeLock()
                "com.dermascopeapp.ACQUIRE_WAKE_LOCK" -> acquireWakeLock()
            }
        }
    }

    // Audio manager for silent volume adjustment
    private lateinit var audioManager: AudioManager
    
    // Polarization states
    private var polarizationActive = false
    private var polarizationMode = 0 // 0: off, 1: linear, 2: circular

    // Physical volume button tracking for Modal recovery
    private var isVolumeDownHeld = false
    private var isVolumeUpHeld = false

    private val isStopping = AtomicBoolean(false)
    private var powerButtonMonitor: PowerButtonMonitor? = null

    /**
     * Returns the name of the main component registered from JavaScript. This is used to schedule
     * rendering of the component.
     */
    override fun getMainComponentName(): String = "dermaScopeApp"

    override fun onCreate(savedInstanceState: Bundle?) {
        Log.i("MainActivity", "!!! onCreate START !!!")
        super.onCreate(savedInstanceState)

        // Lock to portrait always (kiosk); overrides any rotation
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT

        // Keep screen on and show when locked
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SECURE
        )
       
        // ========== ADD THIS: Acquire wake lock ==========
        acquireWakeLock()
        registerWakeLockReceiver()
        // =================================================
       
        // Initialize audio manager
        audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
       
        // Start the Root Power Button Service
        val serviceIntent = Intent(this, RootPowerButtonService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        checkAccessibilityService()

        // Listen for screen off (standby) so we turn off torch and notify JS
        registerScreenOffReceiver()

        // Full kiosk: when device owner, lock to this app and disable lock screen
        startKioskIfDeviceOwner()

        // Try to enable accessibility service if we have permission
        tryEnableAccessibilityService()

        // Start fallback power button monitor
        startPowerButtonMonitor()

        Log.i("MainActivity", "Activity created, services started")
    }

    override fun onResume() {
        super.onResume()
        isDeliberateLock = false
        Log.d("MainActivity", "onResume: reset isDeliberateLock to false")
    }

    /**
     * If this app is device owner, enable lock task (only this app), disable keyguard (no lock screen),
     * and optionally set immersive mode so only our app is visible (no status/nav bar if desired).
     */
    private fun startKioskIfDeviceOwner() {
        try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val adminName = ComponentName(this, KioskDeviceAdminReceiver::class.java)
            if (!dpm.isDeviceOwnerApp(packageName)) {
                Log.i("MainActivity", "Not device owner - kiosk lock task not started")
                return
            }
            // Allow only this app and bluetooth packages in lock task mode
            dpm.setLockTaskPackages(adminName, arrayOf(packageName, "com.android.bluetooth", "com.google.android.bluetooth"))
            // No lock screen - go straight to app
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                dpm.setKeyguardDisabled(adminName, true)
            }
            // Enter lock task so user cannot leave the app (no home, no recents)
            startLockTask()
            Log.i("MainActivity", "Kiosk started: lock task + keyguard disabled")
            // Optional: immersive full screen (hide system status/nav bars)
            setImmersiveKiosk()
        } catch (e: Exception) {
            Log.e("MainActivity", "startKioskIfDeviceOwner failed", e)
        }
    }

    /** Use WRITE_SECURE_SETTINGS to hide status bar and navigation bar (full screen kiosk). */
    private fun setImmersiveKiosk() {
        try {
            // policy_control: immersive for all (no status bar, no nav bar)
            Settings.Global.putString(
                contentResolver,
                "policy_control",
                "immersive.status=*;immersive.navigation=*"
            )
            Log.i("MainActivity", "Immersive kiosk (policy_control) set")
        } catch (e: Exception) {
            Log.w("MainActivity", "setImmersiveKiosk failed (need priv-app): ${e.message}")
        }
    }

    private fun tryEnableAccessibilityService() {
        try {
            val service = "${packageName}/${PowerMenuAccessibilityService::class.java.canonicalName}"
            val enabledServices = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            
            if (enabledServices == null || !enabledServices.contains(service)) {
                val newEnabledServices = if (enabledServices.isNullOrEmpty()) service else "$enabledServices:$service"
                Settings.Secure.putString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, newEnabledServices)
                Settings.Secure.putInt(contentResolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
                Log.i("MainActivity", "Successfully enabled PowerMenuAccessibilityService via Secure Settings")
            }
        } catch (e: Exception) {
            Log.w("MainActivity", "Could not enable accessibility service via code (needs WRITE_SECURE_SETTINGS): ${e.message}")
        }
    }

    private fun checkAccessibilityService() {
        val service = "${packageName}/${PowerMenuAccessibilityService::class.java.canonicalName}"
        val enabled = android.provider.Settings.Secure.getString(
            contentResolver,
            android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )?.contains(service) ?: false
        Log.i("MainActivity", "PowerMenuAccessibilityService enabled: $enabled")
        
        if (!enabled) {
            Log.w("MainActivity", "!!! PowerMenuAccessibilityService is NOT enabled !!!")
            Log.w("MainActivity", "Please enable it in Settings > Accessibility for the Power Menu to work.")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        
        // ========== ADD THIS: Release wake lock ==========
        releaseWakeLock()
        try {
            unregisterReceiver(wakeLockReceiver)
        } catch (e: Exception) {
            Log.e("MainActivity", "Error unregistering receiver: ${e.message}")
        }
        // =================================================
        
        isStopping.set(true)
        powerButtonMonitor?.stopMonitoring()
        try {
            unregisterReceiver(screenOffReceiver)
        } catch (e: Exception) {
            Log.e("MainActivity", "Error unregistering receiver: ${e.message}")
        }
    }
    private fun acquireWakeLock() {
        try {
            if (wakeLock == null) {
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = powerManager.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or 
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                    "dermascopeapp:keepawake"
                )
                wakeLock?.setReferenceCounted(false)
            }
            
            if (wakeLock?.isHeld == false) {
                wakeLock?.acquire(10 * 60 * 1000L) // Acquire for 10 minutes
                Log.i("MainActivity", "Wake lock acquired")
            }
            
            // Start periodic refresh
            startPeriodicWakeLockRefresh()
        } catch (e: Exception) {
            Log.e("MainActivity", "Failed to acquire wake lock: ${e.message}")
        }
    }

    private fun refreshWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
                wakeLock?.acquire(10 * 60 * 1000L)
                Log.d("MainActivity", "Wake lock refreshed")
            } else {
                acquireWakeLock()
            }
        } catch (e: Exception) {
            Log.e("MainActivity", "Failed to refresh wake lock: ${e.message}")
            acquireWakeLock()
        }
    }

    private fun startPeriodicWakeLockRefresh() {
        stopPeriodicWakeLockRefresh()
        
        wakeLockRefreshRunnable = object : Runnable {
            override fun run() {
                refreshWakeLock()
                wakeLockRefreshHandler.postDelayed(this, 5 * 60 * 1000L) // Refresh every 5 minutes
            }
        }
        wakeLockRefreshHandler.postDelayed(wakeLockRefreshRunnable!!, 5 * 60 * 1000L)
        Log.d("MainActivity", "Periodic wake lock refresh started")
    }

    private fun stopPeriodicWakeLockRefresh() {
        wakeLockRefreshRunnable?.let {
            wakeLockRefreshHandler.removeCallbacks(it)
        }
        wakeLockRefreshRunnable = null
    }

    private fun releaseWakeLock() {
        try {
            stopPeriodicWakeLockRefresh()
            wakeLock?.let {
                if (it.isHeld) {
                    it.release()
                    Log.i("MainActivity", "Wake lock released")
                }
            }
            wakeLock = null
        } catch (e: Exception) {
            Log.e("MainActivity", "Failed to release wake lock: ${e.message}")
        }
    }

    private fun registerWakeLockReceiver() {
        val filter = IntentFilter().apply {
            addAction("com.dermascopeapp.REFRESH_WAKE_LOCK")
            addAction("com.dermascopeapp.ACQUIRE_WAKE_LOCK")
        }
        ContextCompat.registerReceiver(
            this,
            wakeLockReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        Log.d("MainActivity", "Wake lock receiver registered")
    }

    private fun disableSystemPowerMenu() {
        try {
            Runtime.getRuntime().exec(arrayOf("su", "-c", "settings put global power_button_long_press 0"))
            Runtime.getRuntime().exec(arrayOf("su", "-c", "settings put global power_button_very_long_press 0"))
            Log.i("MainActivity", "System power menu disabled")
        } catch (e: Exception) {
            Log.e("MainActivity", "Failed to disable system power menu: ${e.message}")
        }
    }

    private val screenOffReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF) {
                if (isDeliberateLock) {
                    Log.i("MainActivity", "Screen OFF detected (Deliberate lock) - NOT waking up screen")
                    isDeliberateLock = false
                    
                    // 1. Turn off torch
                    turnOffTorchAtSystemLevel()
                    
                    // 2. Release wake lock
                    releaseWakeLock()
                } else {
                    Log.i("MainActivity", "Screen OFF detected (Non-deliberate) - attempting immediate wake up")
                    
                    // 1. Turn off torch
                    turnOffTorchAtSystemLevel()
                    
                    // 2. Wake the screen back up immediately
                    wakeUpScreen()
                    
                    // 3. Release old wake lock
                    releaseWakeLock()
                }
            } else if (intent.action == Intent.ACTION_SCREEN_ON) {
                Log.i("MainActivity", "Screen ON - acquiring wake lock")
                acquireWakeLock()
                
                // Release temporary wake lock since screen is now ON
                try {
                    temporaryWakeLock?.let {
                        if (it.isHeld) {
                            it.release()
                            Log.i("MainActivity", "Temporary wake lock released")
                        }
                    }
                    temporaryWakeLock = null
                } catch (e: Exception) {
                    Log.e("MainActivity", "Error releasing temporary wake lock: ${e.message}")
                }
            }
        }
    }

    /** Turn off flashlight at Android system level so torch is off even when app is backgrounded/locked. */
    private fun turnOffTorchAtSystemLevel() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val cameraManager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
                val ids = cameraManager.cameraIdList
                for (id in ids) {
                    try {
                        cameraManager.setTorchMode(id, false)
                        Log.i("MainActivity", "Torch off for camera $id")
                    } catch (e: Exception) {
                        Log.w("MainActivity", "setTorchMode off for $id: ${e.message}")
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("MainActivity", "turnOffTorchAtSystemLevel: ${e.message}")
        }
    }

    private fun registerScreenOffReceiver() {
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        filter.addAction(Intent.ACTION_SCREEN_ON)
        registerReceiver(screenOffReceiver, filter)
    }

    @Suppress("DEPRECATION")
    private fun wakeUpScreen() {
        try {
            Log.d("MainActivity", "wakeUpScreen() called")
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            
            // Release existing temporary wake lock if any
            try {
                temporaryWakeLock?.let {
                    if (it.isHeld) {
                        it.release()
                    }
                }
            } catch (e: Exception) {}
            
            // Method 1: WakeLock with ACQUIRE_CAUSES_WAKEUP (No root needed)
            temporaryWakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or 
                PowerManager.ACQUIRE_CAUSES_WAKEUP or 
                PowerManager.ON_AFTER_RELEASE,
                "dermascopeapp:powerbutton_wakeup"
            ).apply {
                setReferenceCounted(false)
                acquire(3000)
            }
            Log.i("MainActivity", "Temporary wake lock acquired")

            // Also schedule a delayed acquisition to handle cases where the OS overrides immediate wake locks
            val handler = Handler(Looper.getMainLooper())
            handler.postDelayed({
                try {
                    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                    if (!powerManager.isInteractive) {
                        Log.i("MainActivity", "Screen still off after 100ms - acquiring wake lock again")
                        temporaryWakeLock?.acquire(3000)
                    }
                } catch (e: Exception) {
                    Log.e("MainActivity", "Delayed wake lock failed: ${e.message}")
                }
            }, 100)
            
            // Method 2: Shell command fallback (Needs root, run in background)
            Thread {
                try {
                    Runtime.getRuntime().exec(arrayOf("su", "-c", "input keyevent 224"))
                } catch (e: Exception) {
                    try {
                        // Method 3: Non-root shell fallback
                        Runtime.getRuntime().exec(arrayOf("input", "keyevent", "224"))
                    } catch (ex: Exception) {
                        Log.e("MainActivity", "Shell wake up failed: ${ex.message}")
                    }
                }
            }.start()
            
            Log.i("MainActivity", "Wake up signals sent")
        } catch (e: Exception) {
            Log.e("MainActivity", "Failed to wake up screen: ${e.message}")
        }
    }

    /** Called when screen turns off (e.g. user pressed power to lock). App turns off torch; device stays locked. */
    private fun emitScreenOffEventToReactNative() {
        try {
            Log.i("MainActivity", "Broadcasting SCREEN_OFF intent")
            val intent = Intent("com.dermascopeapp.SCREEN_OFF")
            intent.setPackage(packageName)
            sendBroadcast(intent)
        } catch (e: Exception) {
            Log.e("MainActivity", "Error broadcasting SCREEN_OFF: ${e.message}")
        }
    }

    /** Called when user holds power button 3s - show power menu (and optionally wake). */
    private fun emitPowerButtonEventToReactNative() {
        try {
            Log.i("MainActivity", "Broadcasting POWER_BUTTON_PRESSED intent")
            val intent = Intent("com.dermascopeapp.POWER_BUTTON_PRESSED")
            intent.setPackage(packageName)
            sendBroadcast(intent)
            
            runOnUiThread {
                Toast.makeText(this, "Power Menu Triggered", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Log.e("MainActivity", "Error broadcasting POWER_BUTTON_PRESSED: ${e.message}")
        }
    }

    private fun startPowerButtonMonitor() {
        powerButtonMonitor = PowerButtonMonitor()
        powerButtonMonitor?.start()
    }

    private inner class PowerButtonMonitor : Thread() {
        private var process: Process? = null
        private val isPowerDown = AtomicBoolean(false)
        private var downStartTime = 0L

        override fun run() {
            try {
                process = Runtime.getRuntime().exec(arrayOf("su", "-c", "getevent -t"))
                val reader = BufferedReader(InputStreamReader(process?.inputStream))
                Log.i("PowerButtonMonitor", "Monitoring thread started")
                
                var line: String? = null
                while (!isStopping.get()) {
                    line = reader.readLine()
                    val currentLine = line ?: break
                    
                    if (currentLine.contains("0074")) {
                        val isPress = currentLine.contains("00000001") || currentLine.trim().endsWith("1")
                        val isRelease = currentLine.contains("00000000") || currentLine.trim().endsWith("0")
                        
                        if (isPress && !isPowerDown.get()) {
                            isPowerDown.set(true)
                            downStartTime = System.currentTimeMillis()
                            Log.i("PowerButtonMonitor", "Power button DOWN")
                            checkHoldStatus()
                        } else if (isRelease) {
                            isPowerDown.set(false)
                            Log.i("PowerButtonMonitor", "Power button UP after ${System.currentTimeMillis() - downStartTime}ms")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("PowerButtonMonitor", "Error: ${e.message}")
            }
        }

        private fun checkHoldStatus() {
            Thread {
                try {
                    while (isPowerDown.get() && !isStopping.get()) {
                        val duration = System.currentTimeMillis() - downStartTime
                        if (duration >= 3000) {
                            Log.i("PowerButtonMonitor", "Power button HELD for 3s!")
                            emitPowerButtonEventToReactNative()
                            isPowerDown.set(false) 
                            break
                        }
                        Thread.sleep(100)
                    }
                } catch (e: Exception) {}
            }.start()
        }

        fun stopMonitoring() {
            process?.destroy()
        }
    }
   
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        Log.d("MainActivity", "onKeyDown: $keyCode, action: ${event.action}, repeat: ${event.repeatCount}")
       
        // Handle volume buttons for polarization
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            val isDownKey = (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)
            val isUpKey = (keyCode == KeyEvent.KEYCODE_VOLUME_UP)
            
            // Ignore auto-repeat events if we already know they are held
            if (event.repeatCount > 0) {
                if (isDownKey && isVolumeDownHeld) return true
                if (isUpKey && isVolumeUpHeld) return true
            }

            // Mark as held (fresh press or recovered from Modal)
            if (isDownKey) isVolumeDownHeld = true
            if (isUpKey) isVolumeUpHeld = true

            // 1. Send key event to React Native FIRST
            KeyEventModule.getInstance().onKeyDownEvent(keyCode, event)
           
            // 2. Handle polarization logic
            handleVolumeButtonForPolarization(keyCode)
           
            // 3. Adjust volume SILENTLY (no UI)
            adjustVolumeSilently(keyCode)
           
            // 4. Prevent default Android behavior
            return true
        }
       
        // Block power + volume combinations (screenshots)
        if (keyCode == KeyEvent.KEYCODE_POWER ||
            keyCode == KeyEvent.KEYCODE_VOLUME_UP ||
            keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            return handleSpecialKeyCombinations(keyCode, event)
        }
       
        return super.onKeyDown(keyCode, event)
    }
   
    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        Log.d("MainActivity", "onKeyUp: $keyCode")
       
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            // Update physical state tracking
            if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) isVolumeDownHeld = false
            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) isVolumeUpHeld = false

            // Send key up event to React Native
            KeyEventModule.getInstance().onKeyUpEvent(keyCode, event)
        }
       
        return super.onKeyUp(keyCode, event)
    }
   
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // This is called for all key events - good for catching all combinations
        if (event.keyCode == KeyEvent.KEYCODE_VOLUME_UP ||
            event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
           
            // Handle based on action
            when (event.action) {
                KeyEvent.ACTION_DOWN -> {
                    // We'll handle in onKeyDown
                    return super.dispatchKeyEvent(event)
                }
                KeyEvent.ACTION_UP -> {
                    // We'll handle in onKeyUp
                    return super.dispatchKeyEvent(event)
                }
                KeyEvent.ACTION_MULTIPLE -> {
                    // Handle repeated key events
                    return true // Consume to prevent default
                }
            }
        }
       
        return super.dispatchKeyEvent(event)
    }
   
    /**
     * HANDLE SPECIAL KEY COMBINATIONS (Screenshots)
     */
    private fun handleSpecialKeyCombinations(keyCode: Int, event: KeyEvent): Boolean {
        // Check for screenshot combinations
        val currentTime = System.currentTimeMillis()
       
        // This is a simple approach - you can expand this for more complex detection
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            // If power was pressed recently, block the combination
            if (isPowerButtonRecentlyPressed(currentTime)) {
                Log.d("MainActivity", "Blocking screenshot combination")
                Toast.makeText(this, "Screenshot disabled", Toast.LENGTH_SHORT).show()
                return true
            }
        }
       
        // Track power button presses
        if (keyCode == KeyEvent.KEYCODE_POWER) {
            trackPowerButtonPress(currentTime)
        }
       
        return super.onKeyDown(keyCode, event)
    }
   
    /**
     * SILENT VOLUME ADJUSTMENT
     */
    private fun adjustVolumeSilently(keyCode: Int) {
        try {
            val direction = when (keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> AudioManager.ADJUST_RAISE
                KeyEvent.KEYCODE_VOLUME_DOWN -> AudioManager.ADJUST_LOWER
                else -> return
            }
           
            // CRITICAL: Use FLAG_SHOW_UI = 0 to hide the UI completely
            // You can also use AudioManager.FLAG_PLAY_SOUND if you want sound but no UI
            audioManager.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                direction,
                0 // FLAG = 0 means: No UI, no sound, no vibration
            )
           
            Log.d("MainActivity", "Volume adjusted silently: $direction")
           
        } catch (e: Exception) {
            Log.e("MainActivity", "Error adjusting volume: ${e.message}")
        }
    }
   
    /**
     * POLARIZATION CONTROL FUNCTIONS - Simplified Version
     */
    private fun handleVolumeButtonForPolarization(keyCode: Int) {
        // Decouple mode selection from active state to ensure persistence
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            if (polarizationActive && polarizationMode == 1) {
                polarizationActive = false
                // Keep mode as 1 so we remember it was Linear
                sendPolarizationEvent("polarization_off")
            } else {
                polarizationActive = true
                polarizationMode = 1
                sendPolarizationEvent("linear_activated")
            }
        } else if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (polarizationActive && polarizationMode == 2) {
                polarizationActive = false
                // Keep mode as 2 so we remember it was Circular
                sendPolarizationEvent("polarization_off")
            } else {
                polarizationActive = true
                polarizationMode = 2
                sendPolarizationEvent("circular_activated")
            }
        }
    }
   
    private fun sendPolarizationEvent(eventType: String) {
        // Create a bundle with polarization info
        val bundle = Bundle().apply {
            putString("type", "polarization_event")
            putString("event", eventType)
            putBoolean("active", polarizationActive)
            putInt("mode", polarizationMode)
            putString("modeName", getPolarizationModeName())
        }
       
        // Note: You might need to create a custom native module to send this to React Native
        // For now, we'll rely on the React Native side to detect patterns via regular key events
        Log.d("MainActivity", "Polarization event: $eventType, mode: $polarizationMode")
    }
   
    private fun getPolarizationModeName(): String {
        return when (polarizationMode) {
            1 -> "Linear"
            2 -> "Circular"
            else -> "Off"
        }
    }
   
    /**
     * POWER BUTTON TRACKING (For screenshot prevention)
     */
    private var lastPowerPressTime = 0L
    private val POWER_BUTTON_TIMEOUT = 1000L // 1 second
   
    private fun isPowerButtonRecentlyPressed(currentTime: Long): Boolean {
        return (currentTime - lastPowerPressTime) < POWER_BUTTON_TIMEOUT
    }
   
    private fun trackPowerButtonPress(currentTime: Long) {
        lastPowerPressTime = currentTime
    }
   
    /**
     * PUBLIC METHODS FOR REACT NATIVE
     * These can be exposed via a native module if needed
     */
    fun setPolarizationFromJS(active: Boolean, mode: Int) {
        polarizationActive = active
        polarizationMode = mode
        Log.d("MainActivity", "Polarization set from JS: active=$active, mode=$mode")
    }
   
    fun getPolarizationStateFromJS(): Bundle {
        return Bundle().apply {
            putBoolean("active", polarizationActive)
            putInt("mode", polarizationMode)
            putString("modeName", getPolarizationModeName())
        }
    }

    /**
     * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
     * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
     */
    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
