package com.dermascopeapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.atomic.AtomicBoolean
import com.facebook.react.bridge.LifecycleEventListener
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.app.KeyguardManager
import android.os.PowerManager
import android.view.WindowManager
import android.app.Activity

class SystemPowerModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    private val isReceiverRegistered = AtomicBoolean(false)
    private var isLocking = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            Log.d("SystemPowerModule", "Received intent: ${intent?.action}")
            if (intent?.action == "com.dermascopeapp.POWER_BUTTON_PRESSED") {
                Log.d("SystemPowerModule", "Triggering emitPowerButtonEvent")
                emitPowerButtonEvent(reactContext)
            }
        }
    }

    init {
        registerPowerReceiverIfNeeded()
    }

    override fun getName(): String {
        return "SystemPowerModule"
    }

    override fun initialize() {
        super.initialize()
        reactContext.addLifecycleEventListener(this)
        setupDpmPolicies()
    }

    @ReactMethod
    fun initializeModule() {
        Log.d("SystemPowerModule", "initializeModule() called from JS")
        registerPowerReceiverIfNeeded()
        setupDpmPolicies()
    }

 private fun setupDpmPolicies() {
    try {
        val dpm = reactContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = ComponentName(reactContext, KioskDeviceAdminReceiver::class.java)
        if (dpm.isAdminActive(adminComponent)) {
            Log.i("SystemPowerModule", "DPM Admin active")
            // REMOVED: dpm.setMaximumTimeToLock(adminComponent, 0L)
            // This line was forcing immediate lock - removing it keeps kiosk mode without auto-lock
        } else {
            Log.w("SystemPowerModule", "DPM Admin NOT active")
        }
    } catch (e: Exception) {
        Log.e("SystemPowerModule", "Failed to setup DPM policies", e)
    }
}

    @ReactMethod
    fun powerOff() {
        try {
            Log.d("SystemPowerModule", "Attempting power off...")

            // 1. Try ROOT first (silent shutdown)
            try {
                Log.i("SystemPowerModule", "Trying root shutdown...")
                Runtime.getRuntime().exec(arrayOf("su", "-c", "reboot -p"))
                return
            } catch (e: Exception) {
                Log.e("SystemPowerModule", "Root shutdown failed: ${e.message}")
            }

            // 2. Fallback to shell
            try {
                Log.i("SystemPowerModule", "Trying shell shutdown...")
                Runtime.getRuntime().exec(arrayOf("sh", "-c", "reboot -p"))
                return
            } catch (e: Exception) {
                Log.e("SystemPowerModule", "Shell shutdown failed: ${e.message}")
            }

            // 3. LAST fallback → show OS power menu
            PowerMenuAccessibilityService.instance?.let {
                Log.i("SystemPowerModule", "Showing system power dialog")
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                    it.performGlobalAction(
                        android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_POWER_DIALOG
                    )
                }
            }

        } catch (e: Exception) {
            Log.e("SystemPowerModule", "Failed to power off", e)
        }
    }

    @ReactMethod
    fun restart() {
        try {
            Log.d("SystemPowerModule", "Attempting restart...")

            // 1. ROOT reboot FIRST (fastest & silent)
            try {
                Log.i("SystemPowerModule", "Trying root reboot...")
                Runtime.getRuntime().exec(arrayOf("su", "-c", "reboot"))
                return
            } catch (e: Exception) {
                Log.e("SystemPowerModule", "Root reboot failed: ${e.message}")
            }

            // 2. Device Owner fallback
            try {
                val dpm = reactContext.getSystemService(
                    Context.DEVICE_POLICY_SERVICE
                ) as DevicePolicyManager

                val adminComponent =
                    ComponentName(
                        reactContext,
                        KioskDeviceAdminReceiver::class.java
                    )

                if (dpm.isDeviceOwnerApp(reactContext.packageName)) {
                    Log.i("SystemPowerModule", "Trying DPM.reboot()")

                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
                        dpm.reboot(adminComponent)
                        return
                    }
                }
            } catch (e: Exception) {
                Log.e("SystemPowerModule", "DPM reboot failed: ${e.message}")
            }

            // 3. LAST fallback → OS power dialog
            PowerMenuAccessibilityService.instance?.let {
                Log.i("SystemPowerModule", "Showing system power dialog")

                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                    it.performGlobalAction(
                        android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_POWER_DIALOG
                    )
                }
            }

        } catch (e: Exception) {
            Log.e("SystemPowerModule", "Failed to restart", e)
        }
    }

    @ReactMethod
    fun lockScreen() {
        if (isLocking) return
        isLocking = true
        
        try {
            Log.d("SystemPowerModule", "Attempting lock screen...")
            
            // Set flag on MainActivity to indicate this is a deliberate lock action.
            // This prevents screenOffReceiver from waking the screen back up.
            MainActivity.isDeliberateLock = true
            
            val dpm = reactContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val adminComponent = ComponentName(reactContext, KioskDeviceAdminReceiver::class.java)
            
            if (dpm.isAdminActive(adminComponent)) {
                Log.i("SystemPowerModule", "Locking via DPM.lockNow()")
                dpm.lockNow()
                return
            }
            
            // Fallback: Accessibility Service (Android 9+)
            PowerMenuAccessibilityService.instance?.let {
                Log.i("SystemPowerModule", "Locking via Accessibility Service")
                if (it.lockScreen()) return
            }
            
            Log.w("SystemPowerModule", "Admin and Accessibility fallbacks failed. Falling back to moveTaskToBack")
            MainActivity.isDeliberateLock = false
            val currentActivity = reactContext.currentActivity
            currentActivity?.moveTaskToBack(true)
            
        } catch (e: Exception) {
            MainActivity.isDeliberateLock = false
            Log.e("SystemPowerModule", "Lock failed: ${e.message}")
        } finally {
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                isLocking = false
            }, 1000)
        }
    }


    override fun onHostResume() {
        Log.d("SystemPowerModule", "onHostResume: Resetting isLocking flag")
        isLocking = false
    }

    override fun onHostPause() {
        Log.d("SystemPowerModule", "onHostPause: Resetting isLocking flag")
        isLocking = false
    }

    override fun onHostDestroy() {
        isLocking = false
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Keep React Native happy
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Keep React Native happy
    }

    private fun registerPowerReceiverIfNeeded() {
        if (isReceiverRegistered.getAndSet(true)) return

        try {
            val filter = IntentFilter("com.dermascopeapp.POWER_BUTTON_PRESSED")
            ContextCompat.registerReceiver(
                reactContext,
                receiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            Log.d("SystemPowerModule", "BroadcastReceiver registered for POWER_BUTTON_PRESSED")
        } catch (e: Exception) {
            isReceiverRegistered.set(false)
            Log.e("SystemPowerModule", "Failed to register receiver: ${e.message}")
        }
    }

    companion object {
        fun emitPowerButtonEvent(reactContext: ReactApplicationContext?) {
            try {
                reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("onPowerButtonPressed", null)
                Log.d("SystemPowerModule", "Power button event emitted to React Native")
            } catch (e: Exception) {
                Log.e("SystemPowerModule", "Failed to emit power button event: ${e.message}")
            }
        }
    }
}