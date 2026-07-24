package com.dermascopeapp

import android.media.MediaScannerConnection
import android.os.Environment
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Native capture save + optional processAndSave + durable pending-job file.
 * JS still owns shutter / deferGate; this module removes RNFS mkdir/move/scan storms.
 */
class CapturePipelineModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CapturePipelineModule"

    companion object {
        private const val TAG = "CapturePipeline"
        private const val QUEUE_FILE = "capture_queue_pending_v1.json"
    }

    private val mutex = Mutex()
    private var deferBusy = false

    private fun queueFile(): File = File(reactContext.filesDir, QUEUE_FILE)

    private fun sanitize(s: String?): String {
        if (s.isNullOrBlank()) return ""
        return s.replace(Regex("""[\s/\\:*?"<>|]"""), "_").replace(Regex("_+"), "_").trim().take(80)
    }

    private fun emit(event: String, params: WritableMap?) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(event, params)
        } catch (e: Exception) {
            Log.w(TAG, "emit $event failed: ${e.message}")
        }
    }

    private fun saveImageSync(options: ReadableMap): WritableMap {
        val sourcePath = (options.getString("sourcePath") ?: "").removePrefix("file://")
        if (sourcePath.isEmpty()) throw IllegalArgumentException("sourcePath required")
        val source = File(sourcePath)
        if (!source.exists()) throw IllegalStateException("Source file does not exist: $sourcePath")

        val forGuest = options.hasKey("forGuest") && options.getBoolean("forGuest")
        val keepSource = options.hasKey("keepSource") && options.getBoolean("keepSource")
        val skipScan = options.hasKey("skipScan") && options.getBoolean("skipScan")
        val fileNameOpt = if (options.hasKey("fileName")) options.getString("fileName") else null
        val username = if (options.hasKey("username")) options.getString("username") else "user"
        val userId = if (options.hasKey("userId")) options.getString("userId") else null
        val boxId = if (options.hasKey("boxId")) options.getString("boxId") else null
        val boxName = if (options.hasKey("boxName")) options.getString("boxName") else ""
        val guestDir = if (options.hasKey("guestDir")) options.getString("guestDir") else null

        val now = Date()
        val pad = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(now)
        val targetFileName = when {
            !fileNameOpt.isNullOrBlank() -> fileNameOpt
            !boxId.isNullOrBlank() -> "Cutiscope_${boxId}_$pad.jpg"
            else -> "Cutiscope_$pad.jpg"
        }

        val directoryPath: File = if (forGuest) {
            val dir = if (!guestDir.isNullOrBlank()) File(guestDir.removePrefix("file://"))
            else File(reactContext.cacheDir, "guest_photos")
            if (!dir.exists()) dir.mkdirs()
            dir
        } else {
            val userSegment = if (!userId.isNullOrBlank()) userId else sanitize(username)
            val cal = java.util.Calendar.getInstance()
            val year = cal.get(java.util.Calendar.YEAR).toString()
            val month = String.format(Locale.US, "%02d", cal.get(java.util.Calendar.MONTH) + 1)
            val day = String.format(Locale.US, "%02d", cal.get(java.util.Calendar.DAY_OF_MONTH))
            val dateSegment = "$day-$month-$year"
            val patientSegment = if (!boxId.isNullOrBlank()) {
                "${boxId}__${sanitize(boxName)}"
            } else {
                "Unassigned"
            }
            val dcim = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM)
            File(dcim, "Camera/$userSegment/$patientSegment/$year/$dateSegment").also {
                if (!it.exists()) it.mkdirs()
            }
        }

        var target = File(directoryPath, targetFileName)
        if (target.exists()) {
            val unique = "${System.currentTimeMillis()}_${(1000..9999).random()}"
            val name = target.name.replace(Regex("(\\.[^.]+)$"), "_$unique$1")
            target = File(directoryPath, name)
        }

        if (keepSource) {
            source.copyTo(target, overwrite = true)
        } else {
            val moved = try {
                source.renameTo(target)
            } catch (_: Exception) {
                false
            }
            if (!moved) {
                source.copyTo(target, overwrite = true)
                try {
                    source.delete()
                } catch (_: Exception) {
                }
            }
        }

        if (!forGuest && !skipScan) {
            try {
                MediaScannerConnection.scanFile(reactContext, arrayOf(target.absolutePath), null, null)
            } catch (_: Exception) {
            }
        }

        GalleryIndexerModule.invalidateCache(directoryPath.absolutePath)
        GalleryIndexerModule.prependPhotoHint(target.absolutePath)

        val map = Arguments.createMap()
        map.putBoolean("success", true)
        map.putString("path", target.absolutePath)
        map.putString("fileName", target.name)
        map.putString("localUrl", "file://${target.absolutePath}")
        map.putDouble("size", target.length().toDouble())
        map.putDouble("modified", target.lastModified().toDouble())
        map.putString("directory", directoryPath.absolutePath)
        return map
    }

    @ReactMethod
    fun saveImage(options: ReadableMap, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val result = saveImageSync(options)
                withContext(Dispatchers.Main) { promise.resolve(result) }
            } catch (e: Exception) {
                Log.e(TAG, "saveImage failed", e)
                withContext(Dispatchers.Main) {
                    promise.reject("SAVE_FAILED", e.message, e)
                }
            }
        }
    }

    /**
     * Process watermark + save to gallery tree in one native call.
     */
    @ReactMethod
    fun processAndSave(options: ReadableMap, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val sourcePath = options.getString("sourcePath")
                    ?: throw IllegalArgumentException("sourcePath required")
                val zoom = if (options.hasKey("zoom")) options.getDouble("zoom") else 1.0
                val patientName = if (options.hasKey("patientName")) options.getString("patientName") ?: "" else ""
                val part = if (options.hasKey("bodyPart")) options.getString("bodyPart") ?: "" else ""
                val orientation = if (options.hasKey("orientation")) options.getString("orientation") else "portrait"

                val processed = ImageWatermarkProcessor.processToCache(
                    reactContext.cacheDir,
                    sourcePath,
                    zoom,
                    patientName,
                    part,
                    orientation
                )

                val saveOpts = Arguments.createMap()
                // Copy known save fields from options
                saveOpts.putString("sourcePath", processed)
                saveOpts.putBoolean("keepSource", false)
                if (options.hasKey("forGuest")) saveOpts.putBoolean("forGuest", options.getBoolean("forGuest"))
                if (options.hasKey("skipScan")) saveOpts.putBoolean("skipScan", options.getBoolean("skipScan"))
                if (options.hasKey("fileName")) options.getString("fileName")?.let { saveOpts.putString("fileName", it) }
                if (options.hasKey("username")) options.getString("username")?.let { saveOpts.putString("username", it) }
                if (options.hasKey("userId")) options.getString("userId")?.let { saveOpts.putString("userId", it) }
                if (options.hasKey("boxId")) options.getString("boxId")?.let { saveOpts.putString("boxId", it) }
                if (options.hasKey("boxName")) options.getString("boxName")?.let { saveOpts.putString("boxName", it) }
                if (options.hasKey("guestDir")) options.getString("guestDir")?.let { saveOpts.putString("guestDir", it) }

                val result = saveImageSync(saveOpts)

                try {
                    val p = File(processed)
                    if (p.exists() && p.absolutePath != result.getString("path")) p.delete()
                } catch (_: Exception) {
                }

                val out = Arguments.createMap()
                out.putBoolean("success", true)
                out.putString("path", result.getString("path"))
                out.putString("fileName", result.getString("fileName"))
                out.putString("localUrl", result.getString("localUrl"))
                out.putString("directory", result.getString("directory"))
                if (result.hasKey("size")) out.putDouble("size", result.getDouble("size"))
                if (result.hasKey("modified")) out.putDouble("modified", result.getDouble("modified"))

                emit("onCaptureSaved", Arguments.createMap().apply {
                    putString("path", result.getString("path"))
                    putString("fileName", result.getString("fileName"))
                    putString("directory", result.getString("directory"))
                })

                withContext(Dispatchers.Main) { promise.resolve(out) }
            } catch (e: Exception) {
                Log.e(TAG, "processAndSave failed", e)
                emit("onCaptureFailed", Arguments.createMap().apply {
                    putString("message", e.message ?: "failed")
                })
                withContext(Dispatchers.Main) {
                    promise.reject("PROCESS_SAVE_FAILED", e.message, e)
                }
            }
        }
    }

    @ReactMethod
    fun persistQueue(json: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                mutex.withLock {
                    queueFile().writeText(json)
                }
                withContext(Dispatchers.Main) { promise.resolve(true) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    promise.reject("PERSIST_FAILED", e.message, e)
                }
            }
        }
    }

    @ReactMethod
    fun loadQueue(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val f = queueFile()
                val text = if (f.exists()) f.readText() else "[]"
                withContext(Dispatchers.Main) { promise.resolve(text) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.resolve("[]") }
            }
        }
    }

    @ReactMethod
    fun setDeferBusy(busy: Boolean, promise: Promise) {
        deferBusy = busy
        promise.resolve(true)
    }

    @ReactMethod
    fun getQueueSize(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val f = queueFile()
                val size = if (!f.exists()) 0 else {
                    try {
                        JSONArray(f.readText()).length()
                    } catch (_: Exception) {
                        0
                    }
                }
                withContext(Dispatchers.Main) { promise.resolve(size) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.resolve(0) }
            }
        }
    }

    /** Replace destination file in-place (hydrated galleryPath overwrite). */
    @ReactMethod
    fun replaceFile(sourcePath: String, destPath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val src = File(sourcePath.removePrefix("file://"))
                val dst = File(destPath.removePrefix("file://"))
                if (!src.exists()) throw IllegalStateException("source missing")
                dst.parentFile?.mkdirs()
                src.copyTo(dst, overwrite = true)
                try {
                    if (src.absolutePath != dst.absolutePath) src.delete()
                } catch (_: Exception) {
                }
                MediaScannerConnection.scanFile(reactContext, arrayOf(dst.absolutePath), null, null)
                GalleryIndexerModule.invalidateCache(dst.parent)
                withContext(Dispatchers.Main) {
                    promise.resolve(Arguments.createMap().apply {
                        putBoolean("success", true)
                        putString("path", dst.absolutePath)
                    })
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    promise.reject("REPLACE_FAILED", e.message, e)
                }
            }
        }
    }
}
