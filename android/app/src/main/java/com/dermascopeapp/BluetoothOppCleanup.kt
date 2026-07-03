package com.dermascopeapp

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * Clears Android Bluetooth OPP transfer history and dismisses stale
 * "Bluetooth share successfully" system notifications after reboot/power-on.
 */
object BluetoothOppCleanup {
    private const val TAG = "BluetoothOppCleanup"

    private val OPP_URIS = listOf(
        Uri.parse("content://com.android.bluetooth.opp/btopp"),
        Uri.parse("content://com.google.android.bluetooth.opp/btopp"),
    )

    private const val STATUS_SUCCESS = 200
    private const val STATUS_FAILED = 400

    private val BOOT_CLEANUP_DELAYS_MS = longArrayOf(2000L, 6000L, 12000L, 20000L)

    @JvmStatic
    fun clearCompletedTransfers(context: Context) {
        var totalDeleted = 0
        for (uri in OPP_URIS) {
            try {
                val deleted = context.contentResolver.delete(
                    uri,
                    "status = ? OR status = ?",
                    arrayOf(STATUS_SUCCESS.toString(), STATUS_FAILED.toString()),
                )
                if (deleted > 0) {
                    totalDeleted += deleted
                    Log.i(TAG, "Deleted $deleted OPP records from $uri")
                }
            } catch (e: SecurityException) {
                Log.w(TAG, "No permission to clear OPP records at $uri: ${e.message}")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to clear OPP records at $uri: ${e.message}")
            }
        }

        if (totalDeleted > 0) {
            Log.i(TAG, "Cleared $totalDeleted Bluetooth share history record(s)")
        }

        dismissBluetoothNotifications()
    }

    /** Run cleanup several times after boot — Bluetooth OPP may start late on power-on. */
    @JvmStatic
    fun scheduleBootCleanup(context: Context) {
        val appContext = context.applicationContext
        val handler = Handler(Looper.getMainLooper())
        for (delayMs in BOOT_CLEANUP_DELAYS_MS) {
            handler.postDelayed({ clearCompletedTransfers(appContext) }, delayMs)
        }
        Log.i(TAG, "Scheduled Bluetooth OPP cleanup at ${BOOT_CLEANUP_DELAYS_MS.joinToString(", ")} ms")
    }

    private fun dismissBluetoothNotifications() {
        val packages = listOf("com.android.bluetooth", "com.google.android.bluetooth")
        for (pkg in packages) {
            runShellCommand("cmd notification cancel-all $pkg")
            runShellCommand("su -c cmd notification cancel-all $pkg")
        }
    }

    private fun runShellCommand(command: String) {
        try {
            val process = Runtime.getRuntime().exec(arrayOf("sh", "-c", command))
            BufferedReader(InputStreamReader(process.inputStream)).use { it.readText() }
            if (process.waitFor() == 0) {
                Log.i(TAG, "Shell OK: $command")
            }
        } catch (e: Exception) {
            Log.d(TAG, "Shell skipped ($command): ${e.message}")
        }
    }
}
