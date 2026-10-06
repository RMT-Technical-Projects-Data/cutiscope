package com.dermascopeapp

import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class AppUpdateModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "AppUpdateModule"
        private const val GITHUB_API_URL = "https://api.github.com/repos/RMT-Technical-Projects-Data/cutiscope/releases/latest"
        private const val APK_FILE_NAME = "cutiscope-update.apk"
    }

    private var downloadId: Long = -1
    private var downloadedFilePath: String? = null
    private var downloadReceiver: BroadcastReceiver? = null
    private var progressHandler: Handler? = null
    private var progressRunnable: Runnable? = null

    override fun getName(): String {
        return "AppUpdateModule"
    }

    /**
     * Fetches the latest release from GitHub API and compares versions.
     * Returns a WritableMap: { isAvailable, versionName, installedVersion, releaseNotes, downloadUrl }
     */
    @ReactMethod
    fun checkForUpdate(promise: Promise) {
        Thread {
            try {
                Log.d(TAG, "Checking for update at: $GITHUB_API_URL")
                val url = URL(GITHUB_API_URL)
                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.setRequestProperty("Accept", "application/vnd.github.v3+json")
                connection.setRequestProperty("User-Agent", "CutiScope-Android-App")
                connection.connectTimeout = 10000
                connection.readTimeout = 10000

                val responseCode = connection.responseCode
                if (responseCode != 200) {
                    Log.e(TAG, "GitHub API returned HTTP $responseCode")
                    promise.resolve(createNoUpdateResult(errorMessage = "GitHub API returned HTTP $responseCode"))
                    return@Thread
                }

                val reader = BufferedReader(InputStreamReader(connection.inputStream))
                val response = StringBuilder()
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    response.append(line)
                }
                reader.close()
                connection.disconnect()

                val json = JSONObject(response.toString())
                val tagName = json.optString("tag_name", "")
                val releaseNotes = json.optString("body", "Performance improvements and bug fixes.")
                
                // Get the APK download URL from assets
                var downloadUrl = ""
                val assets = json.optJSONArray("assets")
                if (assets != null && assets.length() > 0) {
                    for (i in 0 until assets.length()) {
                        val asset = assets.getJSONObject(i)
                        val assetName = asset.optString("name", "")
                        if (assetName.endsWith(".apk")) {
                            downloadUrl = asset.optString("browser_download_url", "")
                            break
                        }
                    }
                }

                // Strip "v" prefix from tag for comparison
                val remoteVersion = tagName.removePrefix("v").removePrefix("V").trim()
                val installedVersion = getInstalledVersionName()

                val isUpdateAvailable = isNewerVersion(remoteVersion, installedVersion)
                Log.i(TAG, "Update check result: installed=$installedVersion, remote=$remoteVersion, isAvailable=$isUpdateAvailable, downloadUrl=$downloadUrl")

                val result = Arguments.createMap()
                result.putBoolean("isAvailable", isUpdateAvailable)
                result.putString("versionName", remoteVersion)
                result.putString("installedVersion", installedVersion)
                result.putString("releaseNotes", releaseNotes)
                result.putString("downloadUrl", downloadUrl)

                promise.resolve(result)

            } catch (e: Exception) {
                Log.e(TAG, "Check for update failed", e)
                // On failure, don't show update — resolve with isAvailable=false and error info
                promise.resolve(createNoUpdateResult(errorMessage = e.message ?: "Unknown error"))
            }
        }.start()
    }

    /**
     * Downloads the APK from the given URL using Android DownloadManager.
     * Sends "onUpdateDownloaded" event to JS when complete.
     */
    @ReactMethod
    fun downloadUpdate(downloadUrl: String, promise: Promise) {
        try {
            if (downloadUrl.isBlank()) {
                promise.reject("DOWNLOAD_FAILED", "No download URL provided")
                return
            }

            // Clean up any previous download file
            val oldFile = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                APK_FILE_NAME
            )
            if (oldFile.exists()) {
                oldFile.delete()
            }

            val request = DownloadManager.Request(Uri.parse(downloadUrl))
                .setTitle("CutiScope Update")
                .setDescription("Downloading new version...")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, APK_FILE_NAME)
                .setMimeType("application/vnd.android.package-archive")

            val downloadManager = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadId = downloadManager.enqueue(request)

            // Register receiver for download completion
            registerDownloadReceiver()

            // Start polling for progress
            startProgressPolling()

            Log.d(TAG, "Download started with ID: $downloadId")
            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "Download failed", e)
            promise.reject("DOWNLOAD_FAILED", e.message)
        }
    }

    /**
     * Installs the downloaded APK by triggering the Android package installer.
     */
    @ReactMethod
    fun installUpdate(promise: Promise) {
        try {
            val filePath = downloadedFilePath
            if (filePath == null) {
                // Fallback: check Downloads folder
                val fallbackFile = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    APK_FILE_NAME
                )
                if (fallbackFile.exists()) {
                    launchInstallIntent(fallbackFile)
                    promise.resolve(true)
                    return
                }
                promise.reject("INSTALL_FAILED", "No downloaded APK found")
                return
            }

            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("INSTALL_FAILED", "APK file does not exist at: $filePath")
                return
            }

            launchInstallIntent(file)
            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "Installation failed", e)
            promise.reject("INSTALL_FAILED", e.message)
        }
    }

    // ─── Private helpers ───────────────────────────────────────────────

    private fun getInstalledVersionName(): String {
        return try {
            val packageInfo = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
            packageInfo.versionName ?: "0"
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get installed version", e)
            "0"
        }
    }

    /**
     * Compares two version strings (e.g. "7.2" > "7.1" → true).
     * Splits by "." and compares each segment numerically.
     */
    private fun isNewerVersion(remote: String, installed: String): Boolean {
        try {
            val remoteParts = remote.split(".").map { it.toIntOrNull() ?: 0 }
            val installedParts = installed.split(".").map { it.toIntOrNull() ?: 0 }

            val maxLength = maxOf(remoteParts.size, installedParts.size)
            for (i in 0 until maxLength) {
                val r = remoteParts.getOrElse(i) { 0 }
                val l = installedParts.getOrElse(i) { 0 }
                if (r > l) return true
                if (r < l) return false
            }
            return false // versions are equal
        } catch (e: Exception) {
            Log.e(TAG, "Version comparison failed: remote=$remote, installed=$installed", e)
            return false
        }
    }

    private fun createNoUpdateResult(
        installedVersion: String = "",
        remoteVersion: String = "",
        errorMessage: String = ""
    ): com.facebook.react.bridge.WritableMap {
        val result = Arguments.createMap()
        result.putBoolean("isAvailable", false)
        result.putString("versionName", remoteVersion)
        result.putString("installedVersion", installedVersion)
        result.putString("releaseNotes", "")
        result.putString("downloadUrl", "")
        if (errorMessage.isNotEmpty()) {
            result.putString("errorMessage", errorMessage)
        }
        return result
    }

    private fun registerDownloadReceiver() {
        // Unregister previous receiver if any
        unregisterDownloadReceiver()

        downloadReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) ?: -1
                if (id == downloadId) {
                    Log.d(TAG, "Download complete for ID: $id")

                    // Get the downloaded file path
                    val downloadManager = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                    val query = DownloadManager.Query().setFilterById(downloadId)
                    val cursor = downloadManager.query(query)

                    if (cursor != null && cursor.moveToFirst()) {
                        val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                        val status = cursor.getInt(statusIndex)

                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            val localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                            val localUri = cursor.getString(localUriIndex)

                            // Convert content:// URI to file path
                            downloadedFilePath = if (localUri != null && localUri.startsWith("file://")) {
                                Uri.parse(localUri).path
                            } else {
                                // Fallback to known path
                                File(
                                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                                    APK_FILE_NAME
                                ).absolutePath
                            }

                            Log.d(TAG, "APK downloaded to: $downloadedFilePath")

                            // Send event to JS
                            sendEventToJS("onUpdateDownloaded", downloadedFilePath ?: "")
                        } else {
                            Log.e(TAG, "Download failed with status: $status")
                            sendEventToJS("onUpdateDownloadFailed", "Download failed")
                        }
                        cursor.close()
                    }

                    unregisterDownloadReceiver()
                    stopProgressPolling()
                }
            }
        }

        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            reactContext.registerReceiver(downloadReceiver, filter)
        }
    }

    private fun unregisterDownloadReceiver() {
        try {
            downloadReceiver?.let {
                reactContext.unregisterReceiver(it)
            }
        } catch (e: Exception) {
            // Receiver might not be registered
        }
        downloadReceiver = null
    }

    private fun startProgressPolling() {
        stopProgressPolling() // Clean up any existing polling

        progressHandler = Handler(Looper.getMainLooper())
        progressRunnable = object : Runnable {
            override fun run() {
                if (downloadId == -1L) return

                val downloadManager = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val query = DownloadManager.Query().setFilterById(downloadId)
                val cursor = downloadManager.query(query)

                if (cursor != null && cursor.moveToFirst()) {
                    val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                    val status = cursor.getInt(statusIndex)

                    if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PAUSED || status == DownloadManager.STATUS_PENDING) {
                        val downloadedIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                        val totalIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)

                        val downloaded = cursor.getLong(downloadedIndex)
                        val total = cursor.getLong(totalIndex)

                        if (total > 0) {
                            val progress = (downloaded * 100 / total).toInt()
                            sendProgressToJS(progress)
                        }
                        
                        // Continue polling
                        progressHandler?.postDelayed(this, 1000)
                    } else {
                        // Download finished, failed or cancelled - stop polling
                        stopProgressPolling()
                    }
                    cursor.close()
                } else {
                    stopProgressPolling()
                }
            }
        }
        progressHandler?.post(progressRunnable!!)
    }

    private fun stopProgressPolling() {
        progressRunnable?.let { progressHandler?.removeCallbacks(it) }
        progressHandler = null
        progressRunnable = null
    }

    private fun sendProgressToJS(progress: Int) {
        try {
            val params = Arguments.createMap()
            params.putInt("progress", progress)
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onUpdateDownloadProgress", params)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send progress to JS", e)
        }
    }

    private fun sendEventToJS(eventName: String, data: String) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, data)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send event $eventName to JS", e)
        }
    }

    private fun launchInstallIntent(file: File) {
        val activity: Activity? = getCurrentActivity()
        if (activity != null) {
            try {
                // Exit Kiosk Mode (Lock Task) so the Installer can be seen.
                // Standard Android Screen Pinning blocks all other activities.
                activity.stopLockTask()
                Log.d(TAG, "Stopped Lock Task for installation")
            } catch (e: Exception) {
                // Not in lock task or failed to stop - continue anyway
                Log.e(TAG, "Failed to stop lock task (might not be active): ${e.message}")
            }
        }

        val intent = Intent(Intent.ACTION_VIEW)
        val uri: Uri

        val authority = reactContext.packageName + ".provider"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            uri = FileProvider.getUriForFile(reactContext, authority, file)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } else {
            uri = Uri.fromFile(file)
        }

        intent.setDataAndType(uri, "application/vnd.android.package-archive")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

        reactContext.startActivity(intent)
        Log.d(TAG, "Install intent launched for: ${file.absolutePath}")
    }
}
