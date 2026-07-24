package com.dermascopeapp

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.atomic.AtomicLong

/**
 * Single gate for in-app power menu opens.
 * Prevents duplicate sources (root getevent + accessibility + 3s monitor)
 * and filters bounce / wake races that otherwise open the menu "by themselves".
 */
object PowerMenuTriggerGate {
    private const val TAG = "PowerMenuGate"
    private const val COOLDOWN_MS = 1500L
    private const val MIN_PRESS_MS = 35L
    private const val MAX_PRESS_MS = 2500L
    /** Ignore menu open if display only just became interactive (wake race). */
    private const val SCREEN_STABLE_MS = 900L

    private val lastAcceptedElapsed = AtomicLong(0L)
    @Volatile private var lastScreenOffElapsed = 0L

    fun noteScreenOff() {
        lastScreenOffElapsed = SystemClock.elapsedRealtime()
    }

    fun noteScreenOn() {
        // Keep lastScreenOffElapsed; stability is measured from it.
    }

    /**
     * @param pressDurationMs duration from DOWN→UP when known; null if unknown
     * @param wasInteractiveOnDown screen was on before this press (required for menu)
     */
    fun tryAcceptPress(
        context: Context,
        pressDurationMs: Long? = null,
        wasInteractiveOnDown: Boolean = true,
        source: String
    ): Boolean {
        if (MainActivity.isDeliberateLock) {
            Log.d(TAG, "reject($source): deliberate lock")
            return false
        }
        if (!wasInteractiveOnDown) {
            Log.d(TAG, "reject($source): screen was off on down")
            return false
        }
        if (!isScreenInteractive(context)) {
            Log.d(TAG, "reject($source): screen not interactive now")
            return false
        }
        if (pressDurationMs != null) {
            if (pressDurationMs < MIN_PRESS_MS) {
                Log.d(TAG, "reject($source): press too short (${pressDurationMs}ms)")
                return false
            }
            if (pressDurationMs > MAX_PRESS_MS) {
                Log.d(TAG, "reject($source): press too long (${pressDurationMs}ms) — ignore for menu")
                return false
            }
        }
        val now = SystemClock.elapsedRealtime()
        if (lastScreenOffElapsed > 0 && now - lastScreenOffElapsed < SCREEN_STABLE_MS) {
            Log.d(TAG, "reject($source): screen just woke (${now - lastScreenOffElapsed}ms)")
            return false
        }
        while (true) {
            val prev = lastAcceptedElapsed.get()
            if (now - prev < COOLDOWN_MS) {
                Log.d(TAG, "reject($source): cooldown (${now - prev}ms)")
                return false
            }
            if (lastAcceptedElapsed.compareAndSet(prev, now)) {
                Log.i(TAG, "accept($source) duration=${pressDurationMs}")
                return true
            }
        }
    }

    fun broadcastPowerPressed(context: Context, source: String, pressDurationMs: Long? = null, wasInteractiveOnDown: Boolean = true) {
        if (!tryAcceptPress(context, pressDurationMs, wasInteractiveOnDown, source)) return
        try {
            val intent = Intent("com.dermascopeapp.POWER_BUTTON_PRESSED")
            intent.setPackage(context.packageName)
            context.sendBroadcast(intent)
        } catch (e: Exception) {
            Log.e(TAG, "broadcast failed from $source", e)
        }
    }

    /** Strict power-key line match for getevent output (avoids loose "0074" / trailing 1|0 hits). */
    fun isPowerKeyLine(line: String): Boolean {
        if (line.contains("KEY_POWER")) return true
        // EV_KEY type 0001, code 0074 (KEY_POWER), value 0/1
        return Regex("""(?:^|\s)0001\s+0074\s+0000000[01](?:\s|$)""").containsMatchIn(line)
    }

    fun isPowerDownLine(line: String): Boolean {
        if (!isPowerKeyLine(line)) return false
        return line.contains("DOWN") || Regex("""0001\s+0074\s+00000001""").containsMatchIn(line)
    }

    fun isPowerUpLine(line: String): Boolean {
        if (!isPowerKeyLine(line)) return false
        return line.contains("UP") || Regex("""0001\s+0074\s+00000000""").containsMatchIn(line)
    }

    private fun isScreenInteractive(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            pm.isInteractive
        } else {
            @Suppress("DEPRECATION")
            pm.isScreenOn
        }
    }
}
