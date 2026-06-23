package com.dermascopeapp

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Native module exposing Android Lock Task Mode (kiosk) to JavaScript.
 * When the app is device owner, setLockTaskPackages is used so only this app can run in lock task.
 */
class KioskModeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "KioskModeModule"
    }

    @ReactMethod
    fun startKioskMode(promise: Promise) {
        val activity: Activity? = getCurrentActivity()
        if (activity != null) {
            try {
                val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val adminName = ComponentName(activity, KioskDeviceAdminReceiver::class.java)

                if (dpm.isDeviceOwnerApp(activity.packageName)) {
                    dpm.setLockTaskPackages(adminName, arrayOf(activity.packageName, "com.android.bluetooth", "com.google.android.bluetooth"))
                }

                activity.startLockTask()
                promise.resolve("Kiosk Mode Started")
            } catch (e: Exception) {
                promise.reject("KIOSK_ERROR", "Failed to start Kiosk Mode", e)
            }
        } else {
            promise.reject("ACTIVITY_NULL", "Current Activity is null")
        }
    }

    @ReactMethod
    fun stopKioskMode(promise: Promise) {
        val activity: Activity? = getCurrentActivity()
        if (activity != null) {
            try {
                activity.stopLockTask()
                promise.resolve("Kiosk Mode Stopped")
            } catch (e: Exception) {
                promise.reject("KIOSK_ERROR", "Failed to stop Kiosk Mode", e)
            }
        } else {
            promise.reject("ACTIVITY_NULL", "Current Activity is null")
        }
    }
}
