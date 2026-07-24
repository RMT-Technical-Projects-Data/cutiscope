package com.dermascopeapp

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Native module exposing Android Lock Task Mode (kiosk) to JavaScript.
 * When the app is device owner, setLockTaskPackages is used so only this app can run in lock task.
 */
class KioskModeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun getName(): String {
        return "KioskModeModule"
    }

    @ReactMethod
    fun startKioskMode(promise: Promise) {
        waitForActivityThen(promise, maxAttempts = 20, delayMs = 100L) { activity ->
            try {
                val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val adminName = ComponentName(activity, KioskDeviceAdminReceiver::class.java)

                if (dpm.isDeviceOwnerApp(activity.packageName)) {
                    dpm.setLockTaskPackages(
                        adminName,
                        arrayOf(
                            activity.packageName,
                            "com.android.bluetooth",
                            "com.google.android.bluetooth",
                            "com.android.settings"
                        )
                    )
                }

                activity.startLockTask()
                promise.resolve("Kiosk Mode Started")
            } catch (e: Exception) {
                promise.reject("KIOSK_ERROR", "Failed to start Kiosk Mode", e)
            }
        }
    }

    @ReactMethod
    fun stopKioskMode(promise: Promise) {
        waitForActivityThen(promise, maxAttempts = 10, delayMs = 100L) { activity ->
            try {
                activity.stopLockTask()
                promise.resolve("Kiosk Mode Stopped")
            } catch (e: Exception) {
                promise.reject("KIOSK_ERROR", "Failed to stop Kiosk Mode", e)
            }
        }
    }

    /**
     * Bridgeless / Fabric can invoke JS before getCurrentActivity() is set.
     * Retry briefly on the main thread instead of failing immediately.
     */
    private fun waitForActivityThen(
        promise: Promise,
        maxAttempts: Int,
        delayMs: Long,
        action: (Activity) -> Unit
    ) {
        fun attempt(remaining: Int) {
            val activity = getCurrentActivity()
            if (activity != null) {
                action(activity)
                return
            }
            if (remaining <= 1) {
                promise.reject("ACTIVITY_NULL", "Current Activity is null")
                return
            }
            mainHandler.postDelayed({ attempt(remaining - 1) }, delayMs)
        }
        mainHandler.post { attempt(maxAttempts) }
    }
}













