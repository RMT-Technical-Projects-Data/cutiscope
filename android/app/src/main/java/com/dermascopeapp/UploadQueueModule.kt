package com.dermascopeapp

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Durable upload image registry (SQLite) + native JPEG compress for large uploads.
 * JS still performs the actual S3/Drive HTTP put.
 */
class UploadQueueModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "UploadQueueModule"

    private val dbHelper by lazy { RegistryDb(reactContext) }

    private class RegistryDb(ctx: ReactApplicationContext) :
        SQLiteOpenHelper(ctx, "upload_image_registry.db", null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS images (
                  id TEXT PRIMARY KEY NOT NULL,
                  userId TEXT,
                  userName TEXT,
                  patientId TEXT,
                  patientName TEXT,
                  filePath TEXT UNIQUE,
                  createdAt TEXT,
                  uploadStatus TEXT,
                  awsUrl TEXT
                )
                """.trimIndent()
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_images_status ON images(uploadStatus)")
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_images_path ON images(filePath)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
    }

    private fun normalizePath(p: String?): String =
        (p ?: "").removePrefix("file://")

    private fun cursorToMap(c: android.database.Cursor): WritableMap {
        val m = Arguments.createMap()
        m.putString("id", c.getString(c.getColumnIndexOrThrow("id")))
        m.putString("userId", c.getString(c.getColumnIndexOrThrow("userId")) ?: "")
        m.putString("userName", c.getString(c.getColumnIndexOrThrow("userName")) ?: "")
        m.putString("patientId", c.getString(c.getColumnIndexOrThrow("patientId")) ?: "")
        m.putString("patientName", c.getString(c.getColumnIndexOrThrow("patientName")) ?: "")
        m.putString("filePath", c.getString(c.getColumnIndexOrThrow("filePath")) ?: "")
        m.putString("createdAt", c.getString(c.getColumnIndexOrThrow("createdAt")) ?: "")
        m.putString("uploadStatus", c.getString(c.getColumnIndexOrThrow("uploadStatus")) ?: "PENDING")
        val aws = c.getString(c.getColumnIndexOrThrow("awsUrl"))
        if (aws != null) m.putString("awsUrl", aws) else m.putNull("awsUrl")
        return m
    }

    @ReactMethod
    fun upsertImage(params: ReadableMap, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val id = params.getString("id") ?: throw IllegalArgumentException("id required")
                val filePath = normalizePath(params.getString("filePath"))
                val values = ContentValues().apply {
                    put("id", id)
                    put("userId", if (params.hasKey("userId")) params.getString("userId") else "")
                    put("userName", if (params.hasKey("userName")) params.getString("userName") else "")
                    put("patientId", if (params.hasKey("patientId")) params.getString("patientId") else "")
                    put("patientName", if (params.hasKey("patientName")) params.getString("patientName") else "")
                    put("filePath", filePath)
                    put("createdAt", if (params.hasKey("createdAt")) params.getString("createdAt") else "")
                    put(
                        "uploadStatus",
                        if (params.hasKey("uploadStatus")) params.getString("uploadStatus") else "PENDING"
                    )
                    if (params.hasKey("awsUrl") && params.getString("awsUrl") != null) {
                        put("awsUrl", params.getString("awsUrl"))
                    } else {
                        putNull("awsUrl")
                    }
                }
                val db = dbHelper.writableDatabase
                db.insertWithOnConflict("images", null, values, SQLiteDatabase.CONFLICT_REPLACE)
                val out = valuesToMap(values)
                withContext(Dispatchers.Main) { promise.resolve(out) }
            } catch (e: Exception) {
                Log.e("UploadQueue", "upsert failed", e)
                withContext(Dispatchers.Main) { promise.reject("UPSERT_FAILED", e.message, e) }
            }
        }
    }

    private fun valuesToMap(v: ContentValues): WritableMap {
        val m = Arguments.createMap()
        m.putString("id", v.getAsString("id"))
        m.putString("userId", v.getAsString("userId") ?: "")
        m.putString("userName", v.getAsString("userName") ?: "")
        m.putString("patientId", v.getAsString("patientId") ?: "")
        m.putString("patientName", v.getAsString("patientName") ?: "")
        m.putString("filePath", v.getAsString("filePath") ?: "")
        m.putString("createdAt", v.getAsString("createdAt") ?: "")
        m.putString("uploadStatus", v.getAsString("uploadStatus") ?: "PENDING")
        val aws = v.getAsString("awsUrl")
        if (aws != null) m.putString("awsUrl", aws) else m.putNull("awsUrl")
        return m
    }

    @ReactMethod
    fun getImageByFilePath(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val path = normalizePath(filePath)
                val db = dbHelper.readableDatabase
                val c = db.query(
                    "images", null, "filePath=?", arrayOf(path), null, null, null, "1"
                )
                c.use {
                    if (it.moveToFirst()) {
                        withContext(Dispatchers.Main) { promise.resolve(cursorToMap(it)) }
                    } else {
                        withContext(Dispatchers.Main) { promise.resolve(null) }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.reject("GET_FAILED", e.message, e) }
            }
        }
    }

    @ReactMethod
    fun getPendingCount(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = dbHelper.readableDatabase
                val c = db.rawQuery(
                    "SELECT COUNT(*) FROM images WHERE uploadStatus IN (?,?,?)",
                    arrayOf("PENDING", "FAILED", "CLOCK_SKEW")
                )
                var count = 0
                c.use {
                    if (it.moveToFirst()) count = it.getInt(0)
                }
                withContext(Dispatchers.Main) { promise.resolve(count) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.resolve(0) }
            }
        }
    }

    @ReactMethod
    fun getPendingImages(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = dbHelper.readableDatabase
                val c = db.query(
                    "images",
                    null,
                    "uploadStatus IN (?,?,?)",
                    arrayOf("PENDING", "FAILED", "CLOCK_SKEW"),
                    null,
                    null,
                    "createdAt ASC"
                )
                val arr: WritableArray = Arguments.createArray()
                c.use {
                    while (it.moveToNext()) arr.pushMap(cursorToMap(it))
                }
                withContext(Dispatchers.Main) { promise.resolve(arr) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.reject("PENDING_FAILED", e.message, e) }
            }
        }
    }

    @ReactMethod
    fun updateStatus(filePath: String, status: String, awsUrl: String?, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val path = normalizePath(filePath)
                val values = ContentValues().apply {
                    put("uploadStatus", status)
                    if (awsUrl != null) put("awsUrl", awsUrl)
                }
                dbHelper.writableDatabase.update("images", values, "filePath=?", arrayOf(path))
                withContext(Dispatchers.Main) { promise.resolve(true) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.reject("STATUS_FAILED", e.message, e) }
            }
        }
    }

    @ReactMethod
    fun removeByFilePath(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val path = normalizePath(filePath)
                dbHelper.writableDatabase.delete("images", "filePath=?", arrayOf(path))
                withContext(Dispatchers.Main) { promise.resolve(true) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.reject("REMOVE_FAILED", e.message, e) }
            }
        }
    }

    @ReactMethod
    fun removeByFilePaths(paths: ReadableArray, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = dbHelper.writableDatabase
                db.beginTransaction()
                try {
                    for (i in 0 until paths.size()) {
                        val p = normalizePath(paths.getString(i))
                        if (p.isNotEmpty()) db.delete("images", "filePath=?", arrayOf(p))
                    }
                    db.setTransactionSuccessful()
                } finally {
                    db.endTransaction()
                }
                withContext(Dispatchers.Main) { promise.resolve(true) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.reject("REMOVE_BATCH_FAILED", e.message, e) }
            }
        }
    }

    @ReactMethod
    fun updateFilePath(oldPath: String, newPath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val old = normalizePath(oldPath)
                val newP = normalizePath(newPath)
                if (old.isEmpty() || newP.isEmpty() || old == newP) {
                    withContext(Dispatchers.Main) { promise.resolve(false) }
                    return@launch
                }
                val values = ContentValues().apply { put("filePath", newP) }
                val rows = dbHelper.writableDatabase.update("images", values, "filePath=?", arrayOf(old))
                withContext(Dispatchers.Main) { promise.resolve(rows > 0) }
            } catch (e: Exception) {
                Log.e("UploadQueue", "updateFilePath failed", e)
                withContext(Dispatchers.Main) { promise.reject("PATH_UPDATE_FAILED", e.message, e) }
            }
        }
    }

    @ReactMethod
    fun getUploadStatusMap(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = dbHelper.readableDatabase
                val c = db.query("images", arrayOf("filePath", "uploadStatus"), null, null, null, null, null)
                val map = Arguments.createMap()
                c.use {
                    while (it.moveToNext()) {
                        val path = it.getString(0) ?: continue
                        val status = it.getString(1) ?: continue
                        map.putString(path, status)
                    }
                }
                withContext(Dispatchers.Main) { promise.resolve(map) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { promise.resolve(Arguments.createMap()) }
            }
        }
    }

    /** Compress JPEG when over 2MB; returns absolute path (original or compressed). */
    @ReactMethod
    fun compressForUpload(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val path = ImageWatermarkProcessor.compressIfNeeded(
                    reactContext,
                    normalizePath(filePath),
                    maxBytes = 2_000_000L,
                    quality = 78
                )
                withContext(Dispatchers.Main) {
                    promise.resolve(
                        Arguments.createMap().apply {
                            putString("path", path)
                            putString("uri", "file://$path")
                            putBoolean("compressed", path != normalizePath(filePath))
                        }
                    )
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    promise.reject("COMPRESS_FAILED", e.message, e)
                }
            }
        }
    }
}
