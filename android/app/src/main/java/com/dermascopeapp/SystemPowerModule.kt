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
import com.facebook.react.bridge.Promise
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

            // Clear KEEP_SCREEN_ON / wake locks first — otherwise lockNow cannot keep the screen off.
            MainActivity.prepareForDeliberateLock()

            val activity = reactContext.currentActivity
            val dpm = reactContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val adminComponent = ComponentName(reactContext, KioskDeviceAdminReceiver::class.java)

            // Prefer goToSleep on the main thread after flags are cleared.
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                try {
                    var locked = false

                    // 1) Device admin lockNow (works even with keyguard disabled as screen-off)
                    if (dpm.isAdminActive(adminComponent)) {
                        Log.i("SystemPowerModule", "Locking via DPM.lockNow()")
                        dpm.lockNow()
                        locked = true
                    }

                    // 2) PowerManager.goToSleep (reflection — DEVICE_POWER / system apps)
                    try {
                        val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
                        val method = PowerManager::class.java.getMethod("goToSleep", Long::class.javaPrimitiveType)
                        method.invoke(pm, android.os.SystemClock.uptimeMillis())
                        Log.i("SystemPowerModule", "goToSleep invoked")
                        locked = true
                    } catch (e: Exception) {
                        Log.w("SystemPowerModule", "goToSleep unavailable: ${e.message}")
                    }

                    // 3) Accessibility GLOBAL_ACTION_LOCK_SCREEN
                    if (!locked) {
                        PowerMenuAccessibilityService.instance?.let {
                            Log.i("SystemPowerModule", "Locking via Accessibility Service")
                            if (it.lockScreen()) locked = true
                        }
                    }

                    // 4) Root fallback: turn screen off without toggling back on
                    if (!locked) {
                        try {
                            Runtime.getRuntime().exec(arrayOf("su", "-c", "input keyevent 223")) // KEYCODE_SLEEP
                            Log.i("SystemPowerModule", "Root KEYCODE_SLEEP sent")
                            locked = true
                        } catch (e: Exception) {
                            Log.w("SystemPowerModule", "Root sleep failed: ${e.message}")
                        }
                    }

                    if (!locked) {
                        Log.w("SystemPowerModule", "All lock strategies failed; moveTaskToBack fallback")
                        MainActivity.isDeliberateLock = false
                        activity?.moveTaskToBack(true)
                    }
                } catch (e: Exception) {
                    MainActivity.isDeliberateLock = false
                    Log.e("SystemPowerModule", "Lock post failed: ${e.message}")
                }
            }
        } catch (e: Exception) {
            MainActivity.isDeliberateLock = false
            Log.e("SystemPowerModule", "Lock failed: ${e.message}")
        } finally {
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                isLocking = false
            }, 1500)
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

    // Instantly force the hardware backlight to 0 by writing the LED/backlight
    // sysfs node directly via root. This bypasses DisplayPowerController's ramp
    // animation (which is what makes setAppBrightness fade slowly). The current
    // value is saved so it can be restored instantly on wake. We do NOT touch the
    // window brightness / Settings so DPC's own target stays unchanged and it
    // won't animate anything. Resolves true only if a node was found & written.
    @ReactMethod
    fun blackoutScreen(promise: Promise) {
        Thread {
            try {
                val script =
                    "for f in /sys/class/leds/lcd-backlight/brightness " +
                    "/sys/class/backlight/*/brightness; do " +
                    "if [ -f \"\$f\" ]; then " +
                    "cat \"\$f\" > /data/local/tmp/dscope_bl 2>/dev/null; " +
                    "echo 0 > \"\$f\" 2>/dev/null; echo OK; break; fi; done"
                val p = Runtime.getRuntime().exec(arrayOf("su", "-c", script))
                val out = p.inputStream.bufferedReader().readText()
                p.waitFor()
                promise.resolve(out.contains("OK"))
            } catch (e: Exception) {
                Log.e("SystemPowerModule", "blackoutScreen failed: ${e.message}")
                promise.resolve(false)
            }
        }.start()
    }

    // Restore the hardware backlight to the value saved by blackoutScreen().
    @ReactMethod
    fun restoreScreen() {
        Thread {
            try {
                val script =
                    "for f in /sys/class/leds/lcd-backlight/brightness " +
                    "/sys/class/backlight/*/brightness; do " +
                    "if [ -f \"\$f\" ]; then " +
                    "if [ -s /data/local/tmp/dscope_bl ]; then " +
                    "cat /data/local/tmp/dscope_bl > \"\$f\" 2>/dev/null; " +
                    "else echo 255 > \"\$f\" 2>/dev/null; fi; break; fi; done"
                Runtime.getRuntime().exec(arrayOf("su", "-c", script)).waitFor()
            } catch (e: Exception) {
                Log.e("SystemPowerModule", "restoreScreen failed: ${e.message}")
            }
        }.start()
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