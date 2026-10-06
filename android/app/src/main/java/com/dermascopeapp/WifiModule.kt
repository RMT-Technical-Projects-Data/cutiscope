package com.dermascopeapp

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader

/**
 * Privileged Wi‑Fi connect / scan / forget (extracted from SystemTimeModule).
 */
class WifiModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WifiModule"

    private fun normalizeSsid(ssid: String?): String {
        if (ssid == null) return ""
        var s = ssid
        if (s.length >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            s = s.substring(1, s.length - 1)
        }
        return s
    }

    private fun escapeShellArg(arg: String): String {
        return "'" + arg.replace("'", "'\\''") + "'"
    }

    private fun forgetNetworkInternal(ssid: String) {
        try {
            val normalized = normalizeSsid(ssid)
            if (normalized.isEmpty()) return

            val listProcess = Runtime.getRuntime().exec("su")
            DataOutputStream(listProcess.outputStream).use { os ->
                os.writeBytes("cmd wifi list-networks\n")
                os.writeBytes("exit\n")
                os.flush()
            }
            val output = BufferedReader(InputStreamReader(listProcess.inputStream)).use { it.readText() }
            listProcess.waitFor()

            for (line in output.split("\n")) {
                if (line.contains(normalized)) {
                    val parts = line.trim().split(Regex("\\s+"))
                    if (parts.isNotEmpty()) {
                        val networkId = parts[0]
                        if (networkId.toIntOrNull() != null) {
                            val forgetProcess = Runtime.getRuntime().exec("su")
                            DataOutputStream(forgetProcess.outputStream).use { os ->
                                os.writeBytes("cmd wifi forget-network $networkId\n")
                                os.writeBytes("exit\n")
                                os.flush()
                            }
                            forgetProcess.waitFor()
                        }
                    }
                }
            }
        } catch (_: Exception) {
        }
    }

    @ReactMethod
    fun connectToWifi(ssid: String, password: String?, securityType: String?, promise: Promise) {
        Thread {
            try {
                val cleanSsid = normalizeSsid(ssid)
                val process = Runtime.getRuntime().exec("su")
                DataOutputStream(process.outputStream).use { os ->
                    val auth = if (password.isNullOrEmpty()) "open" else "wpa2"
                    val quotedSsid = escapeShellArg(cleanSsid)
                    if (password.isNullOrEmpty()) {
                        os.writeBytes("cmd wifi connect-network $quotedSsid $auth\n")
                    } else {
                        val quotedPass = escapeShellArg(password)
                        os.writeBytes("cmd wifi connect-network $quotedSsid $auth $quotedPass\n")
                    }
                    os.writeBytes("exit\n")
                    os.flush()
                }
                val exitCode = process.waitFor()
                if (exitCode == 0) {
                    promise.resolve(true)
                } else {
                    promise.reject("CONNECTION_FAILED", "WiFi connect failed with exit code $exitCode")
                }
            } catch (e: Exception) {
                promise.reject("CONNECTION_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun forceWifiScan(promise: Promise) {
        Thread {
            try {
                val process = Runtime.getRuntime().exec("su")
                DataOutputStream(process.outputStream).use { os ->
                    os.writeBytes("cmd wifi start-scan\n")
                    os.writeBytes("exit\n")
                    os.flush()
                }
                val exitCode = process.waitFor()
                if (exitCode == 0) promise.resolve(true)
                else promise.reject("SCAN_FAILED", "WiFi scan failed with exit code $exitCode")
            } catch (e: Exception) {
                promise.reject("SCAN_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun forgetNetwork(ssid: String, promise: Promise) {
        Thread {
            try {
                forgetNetworkInternal(ssid)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("FORGET_ERROR", e.message, e)
            }
        }.start()
    }
}
