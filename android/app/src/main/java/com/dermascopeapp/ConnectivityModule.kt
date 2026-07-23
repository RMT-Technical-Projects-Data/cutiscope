package com.dermascopeapp

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import kotlin.concurrent.thread

/**
 * Connectivity helpers for kiosk devices where Android's captive-portal /
 * NetworkMonitor validation marks Wi-Fi as "Limited" even when the app's
 * backend (and often the public Internet) is reachable.
 *
 * Strategy:
 * 1. Disable captive-portal detection (WRITE_SECURE_SETTINGS / root).
 * 2. Probe real reachability (Google 204 + backend + DNS).
 * 3. Tell ConnectivityManager the network has connectivity so VALIDATED sticks.
 */
class ConnectivityModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ConnectivityModule"

        /** Don't attempt captive portal detection (Android Settings.Global). */
        private const val CAPTIVE_PORTAL_MODE_IGNORE = 0

        @Volatile
        private var captivePortalDisabled = false

        /**
         * Best-effort disable of Android captive-portal / "Limited connection" checks.
         * Safe to call from Application.onCreate on a background thread.
         */
        fun disableCaptivePortalDetection(context: Context): Boolean {
            if (captivePortalDisabled) return true

            var ok = false
            try {
                val cr = context.contentResolver
                Settings.Global.putInt(cr, "captive_portal_mode", CAPTIVE_PORTAL_MODE_IGNORE)
                Settings.Global.putInt(cr, "captive_portal_detection_enabled", 0)
                // Prefer HTTP generate_204 over HTTPS (fewer TLS/time issues on kiosks).
                Settings.Global.putString(
                    cr,
                    "captive_portal_http_url",
                    "http://connectivitycheck.gstatic.com/generate_204"
                )
                Settings.Global.putString(
                    cr,
                    "captive_portal_https_url",
                    "https://connectivitycheck.gstatic.com/generate_204"
                )
                ok = true
                Log.i(TAG, "Captive portal detection disabled via Settings.Global")
            } catch (e: Exception) {
                Log.w(TAG, "Settings.Global captive portal disable failed: ${e.message}")
            }

            // Root fallback (device-owner / rooted kiosk images).
            try {
                val process = Runtime.getRuntime().exec("su")
                val os = process.outputStream
                os.write("settings put global captive_portal_mode 0\n".toByteArray())
                os.write("settings put global captive_portal_detection_enabled 0\n".toByteArray())
                os.write(
                    "settings put global captive_portal_http_url http://connectivitycheck.gstatic.com/generate_204\n".toByteArray()
                )
                os.write(
                    "settings put global captive_portal_https_url https://connectivitycheck.gstatic.com/generate_204\n".toByteArray()
                )
                os.write("exit\n".toByteArray())
                os.flush()
                os.close()
                val code = process.waitFor()
                if (code == 0) {
                    ok = true
                    Log.i(TAG, "Captive portal detection disabled via root settings")
                } else {
                    Log.w(TAG, "Root captive portal disable exit=$code")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Root captive portal disable failed: ${e.message}")
            }

            captivePortalDisabled = ok
            return ok
        }
    }

    override fun getName(): String = "ConnectivityModule"

    @ReactMethod
    fun disableCaptivePortalChecks(promise: Promise) {
        thread {
            try {
                promise.resolve(disableCaptivePortalDetection(reactContext))
            } catch (e: Exception) {
                promise.reject("CAPTIVE_PORTAL_ERROR", e.localizedMessage, e)
            }
        }
    }

    @ReactMethod
    fun getNetworkStatus(promise: Promise) {
        thread {
            try {
                promise.resolve(evaluateNetworkStatus(null))
            } catch (e: Exception) {
                promise.reject("FETCH_ERROR", e.localizedMessage, e)
            }
        }
    }

    /**
     * Probe real connectivity (optional backend URL), then report the active
     * network as having Internet so Android clears "Limited connection".
     *
     * @param apiProbeUrl optional URL such as http://host:4040/api/health
     */
    @ReactMethod
    fun forceValidateNetwork(apiProbeUrl: String?, promise: Promise) {
        thread {
            try {
                disableCaptivePortalDetection(reactContext)
                val status = evaluateNetworkStatus(apiProbeUrl)
                if (status == "WIFI_INTERNET" || status == "CELLULAR_INTERNET") {
                    reportActiveNetworkConnectivity(true)
                }
                Log.i(TAG, "forceValidateNetwork → $status (api=$apiProbeUrl)")
                promise.resolve(status)
            } catch (e: Exception) {
                promise.reject("VALIDATE_ERROR", e.localizedMessage, e)
            }
        }
    }

    /**
     * Explicitly tell the system the active network has / does not have Internet.
     */
    @ReactMethod
    fun reportNetworkConnectivity(hasConnectivity: Boolean, promise: Promise) {
        thread {
            try {
                val reported = reportActiveNetworkConnectivity(hasConnectivity)
                promise.resolve(reported)
            } catch (e: Exception) {
                promise.reject("REPORT_ERROR", e.localizedMessage, e)
            }
        }
    }

    private fun evaluateNetworkStatus(apiProbeUrl: String?): String {
        val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return "NO_NETWORK"
        val caps = cm.getNetworkCapabilities(network) ?: return "NO_NETWORK"

        val isWifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        val isCellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
        val isValidated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

        if (isWifi) {
            if (isValidated || hasRealInternet(apiProbeUrl)) {
                return "WIFI_INTERNET"
            }
            return "WIFI_NO_INTERNET"
        }

        if (isCellular) {
            if (isValidated || hasRealInternet(apiProbeUrl)) {
                return "CELLULAR_INTERNET"
            }
            return "CELLULAR_NO_INTERNET"
        }

        return "OTHER_NETWORK"
    }

    private fun reportActiveNetworkConnectivity(hasConnectivity: Boolean): Boolean {
        return try {
            val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network: Network = cm.activeNetwork ?: return false
            cm.reportNetworkConnectivity(network, hasConnectivity)
            Log.i(TAG, "reportNetworkConnectivity($hasConnectivity) on $network")
            true
        } catch (e: Exception) {
            Log.w(TAG, "reportNetworkConnectivity failed: ${e.message}")
            false
        }
    }

    private fun hasRealInternet(apiProbeUrl: String?): Boolean {
        val probes = mutableListOf(
            "http://connectivitycheck.gstatic.com/generate_204",
            "https://clients3.google.com/generate_204",
            "http://www.gstatic.com/generate_204",
        )
        if (!apiProbeUrl.isNullOrBlank()) {
            probes.add(0, apiProbeUrl.trim())
        }

        for (probe in probes) {
            if (httpProbeSucceeds(probe)) {
                Log.i(TAG, "Internet probe OK: $probe")
                return true
            }
        }

        // Last-resort TCP reachability (DNS / firewall may block HTTP probes).
        if (tcpReachable("8.8.8.8", 53, 1500) || tcpReachable("1.1.1.1", 53, 1500)) {
            Log.i(TAG, "Internet probe OK via DNS TCP")
            return true
        }

        Log.w(TAG, "All Internet probes failed")
        return false
    }

    private fun httpProbeSucceeds(urlString: String): Boolean {
        return try {
            val url = URL(urlString)
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 2500
            conn.readTimeout = 2500
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.requestMethod = "GET"
            conn.connect()
            val code = conn.responseCode
            conn.disconnect()
            // generate_204 → 204; many health endpoints → 200; some captive portals → 204/200
            code in 200..399
        } catch (e: Exception) {
            Log.d(TAG, "Probe failed $urlString: ${e.message}")
            false
        }
    }

    private fun tcpReachable(host: String, port: Int, timeoutMs: Int): Boolean {
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), timeoutMs)
                true
            }
        } catch (_: Exception) {
            false
        }
    }
}
