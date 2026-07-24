package com.dermascopeapp

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import android.view.KeyEvent
import android.util.Log
import android.os.PowerManager
import android.content.Context

class PowerMenuAccessibilityService : AccessibilityService() {

    companion object {
        var instance: PowerMenuAccessibilityService? = null
    }

    private var powerDownAt = 0L
    private var wasInteractiveOnDown = false

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d("PowerMenuAccess", "Service connected")
        instance = this
        val info = AccessibilityServiceInfo()
        info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
        this.serviceInfo = info
    }

    override fun onKeyEvent(event: KeyEvent?): Boolean {
        if (event?.keyCode != KeyEvent.KEYCODE_POWER) {
            return super.onKeyEvent(event)
        }

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val screenOn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            powerManager.isInteractive
        } else {
            @Suppress("DEPRECATION")
            powerManager.isScreenOn
        }

        if (event.action == KeyEvent.ACTION_DOWN) {
            // Ignore auto-repeat / synthetic repeats.
            if (event.repeatCount > 0) return true

            powerDownAt = System.currentTimeMillis()
            wasInteractiveOnDown = screenOn && !MainActivity.isDeliberateLock

            if (!screenOn || MainActivity.isDeliberateLock) {
                Log.d("PowerMenuAccess", "Screen off / deliberate lock — wake only, no power menu")
                MainActivity.clearDeliberateLockAndRestoreKeepAwake()
                return false
            }
            // Consume DOWN so the system does not sleep while we wait for UP.
            return true
        }

        if (event.action == KeyEvent.ACTION_UP) {
            val downAt = powerDownAt
            powerDownAt = 0L
            if (downAt <= 0) {
                return !screenOn || MainActivity.isDeliberateLock
            }
            if (!wasInteractiveOnDown || !screenOn || MainActivity.isDeliberateLock) {
                Log.d("PowerMenuAccess", "UP without interactive down — no menu")
                return false
            }

            val duration = System.currentTimeMillis() - downAt
            Log.d("PowerMenuAccess", "Power UP after ${duration}ms — gated menu open")

            PowerMenuTriggerGate.broadcastPowerPressed(
                this,
                source = "PowerMenuAccessibilityService",
                pressDurationMs = duration,
                wasInteractiveOnDown = true
            )

            val activityIntent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(activityIntent)
            return true
        }

        return super.onKeyEvent(event)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    fun lockScreen(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Log.d("PowerMenuAccess", "Performing GLOBAL_ACTION_LOCK_SCREEN")
            performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
        } else {
            Log.w("PowerMenuAccess", "GLOBAL_ACTION_LOCK_SCREEN not supported on this API level (${Build.VERSION.SDK_INT})")
            false
        }
    }
}
