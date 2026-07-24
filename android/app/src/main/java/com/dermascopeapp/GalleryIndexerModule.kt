package com.dermascopeapp

import android.content.ContentUris
import android.content.Context
import android.media.MediaScannerConnection
import android.provider.MediaStore
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.DataOutputStream
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * Fast native gallery filesystem indexer.
 * Walks DCIM trees on a background dispatcher and caches recent listings so
 * Camera → Gallery navigation can paint from a warm prefetch.
 */
class GalleryIndexerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "GalleryIndexerModule"

    companion object {
        private const val TAG = "GalleryIndexer"
        private val IMAGE_EXT = Regex("\\.(jpg|jpeg|png|gif|bmp)$", RegexOption.IGNORE_CASE)

        /** Process-scoped prefetch cache: absoluteDir → serialized WritableMap payload as Maps. */
        private val listCache = ConcurrentHashMap<String, CachedListing>()
        private var prefetchJob: Job? = null

        data class CachedListing(
            val exists: Boolean,
            val dirs: List<FileEntry>,
            val photos: List<FileEntry>,
            val covers: Map<String, String>,
            val cachedAt: Long = System.currentTimeMillis()
        )

        data class FileEntry(
            val name: String,
            val path: String,
            val mtime: Long,
            val isDirectory: Boolean,
            val directory: String? = null
        )

        fun invalidateCache(path: String? = null) {
            if (path.isNullOrBlank()) {
                listCache.clear()
                return
            }
            val clean = path.removePrefix("file://")
            listCache.keys.removeAll { it == clean || it.startsWith("$clean/") || clean.startsWith("$it/") }
        }

        fun prependPhotoHint(absolutePath: String) {
            // Soft invalidate parents so next list picks up the new file.
            val parent = File(absolutePath).parent ?: return
            invalidateCache(parent)
        }
    }

    private fun deletedSet(arr: ReadableArray?): Set<String> {
        if (arr == null) return emptySet()
        val out = HashSet<String>(arr.size())
        for (i in 0 until arr.size()) {
            val p = arr.getString(i)?.removePrefix("file://") ?: continue
            if (p.isNotEmpty()) out.add(p)
        }
        return out
    }

    private fun isImageFile(name: String): Boolean {
        if (name.startsWith("compressed_", ignoreCase = true)) return false
        return IMAGE_EXT.containsMatchIn(name)
    }

    private fun listDirSync(dirPath: String, deleted: Set<String>): CachedListing {
        val dir = File(dirPath)
        if (!dir.exists() || !dir.isDirectory) {
            return CachedListing(exists = false, dirs = emptyList(), photos = emptyList(), covers = emptyMap())
        }

        val children = dir.listFiles() ?: emptyArray()
        val dirs = ArrayList<FileEntry>()
        val photos = ArrayList<FileEntry>()

        for (child in children) {
            if (child.isDirectory) {
                dirs.add(
                    FileEntry(
                        name = child.name,
                        path = child.absolutePath,
                        mtime = child.lastModified(),
                        isDirectory = true
                    )
                )
            } else if (child.isFile && isImageFile(child.name) && !deleted.contains(child.absolutePath)) {
                photos.add(
                    FileEntry(
                        name = child.name,
                        path = child.absolutePath,
                        mtime = child.lastModified(),
                        isDirectory = false,
                        directory = dir.absolutePath
                    )
                )
            }
        }

        dirs.sortBy { it.name.lowercase(Locale.US) }
        photos.sortByDescending { it.mtime }

        return CachedListing(exists = true, dirs = dirs, photos = photos, covers = emptyMap())
    }

    private fun collectImagesRecursive(dir: File, deleted: Set<String>, out: MutableList<FileEntry>) {
        val children = dir.listFiles() ?: return
        for (child in children) {
            if (child.isDirectory) {
                collectImagesRecursive(child, deleted, out)
            } else if (child.isFile && isImageFile(child.name) && !deleted.contains(child.absolutePath)) {
                out.add(
                    FileEntry(
                        name = child.name,
                        path = child.absolutePath,
                        mtime = child.lastModified(),
                        isDirectory = false,
                        directory = dir.absolutePath
                    )
                )
            }
        }
    }

    private fun latestCover(dirPath: String, deleted: Set<String>): String? {
        val images = ArrayList<FileEntry>()
        collectImagesRecursive(File(dirPath), deleted, images)
        if (images.isEmpty()) return null
        return images.maxByOrNull { it.mtime }?.path
    }

    private fun listingToWritable(listing: CachedListing): WritableMap {
        val map = Arguments.createMap()
        map.putBoolean("exists", listing.exists)

        val dirs = Arguments.createArray()
        for (d in listing.dirs) {
            val m = Arguments.createMap()
            m.putString("name", d.name)
            m.putString("path", d.path)
            m.putDouble("mtime", d.mtime.toDouble())
            m.putBoolean("isDirectory", true)
            dirs.pushMap(m)
        }
        map.putArray("dirs", dirs)

        val photos = Arguments.createArray()
        for (p in listing.photos) {
            val m = Arguments.createMap()
            m.putString("name", p.name)
            m.putString("path", p.path)
            m.putDouble("mtime", p.mtime.toDouble())
            m.putBoolean("isDirectory", false)
            m.putString("directory", p.directory ?: "")
            photos.pushMap(m)
        }
        map.putArray("photos", photos)

        val covers = Arguments.createMap()
        for ((k, v) in listing.covers) {
            covers.putString(k, v)
        }
        map.putMap("covers", covers)
        return map
    }

    @ReactMethod
    fun listDirectory(path: String, deletedPaths: ReadableArray?, includeCovers: Boolean, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val clean = path.removePrefix("file://")
                val deleted = deletedSet(deletedPaths)
                var listing = listDirSync(clean, deleted)
                val started = System.currentTimeMillis()

                if (includeCovers && listing.exists && listing.dirs.isNotEmpty()) {
                    val covers = HashMap<String, String>()
                    for (d in listing.dirs) {
                        latestCover(d.path, deleted)?.let { covers[d.path] = it }
                    }
                    listing = listing.copy(covers = covers)
                }

                listCache[clean] = listing
                Log.d(TAG, "listDirectory $clean dirs=${listing.dirs.size} photos=${listing.photos.size} covers=${listing.covers.size} in ${System.currentTimeMillis() - started}ms")
                withContext(Dispatchers.Main) { promise.resolve(listingToWritable(listing)) }
            } catch (e: Exception) {
                Log.e(TAG, "listDirectory failed", e)
                withContext(Dispatchers.Main) {
                    promise.reject("LIST_FAILED", e.message, e)
                }
            }
        }
    }

    @ReactMethod
    fun listImagesRecursive(path: String, deletedPaths: ReadableArray?, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val clean = path.removePrefix("file://")
                val deleted = deletedSet(deletedPaths)
                val dir = File(clean)
                if (!dir.exists() || !dir.isDirectory) {
                    val empty = Arguments.createMap()
                    empty.putBoolean("exists", false)
                    empty.putArray("photos", Arguments.createArray())
                    withContext(Dispatchers.Main) { promise.resolve(empty) }
                    return@launch
                }
                val images = ArrayList<FileEntry>()
                collectImagesRecursive(dir, deleted, images)
                images.sortByDescending { it.mtime }

                val photos = Arguments.createArray()
                for (p in images) {
                    val m = Arguments.createMap()
                    m.putString("name", p.name)
                    m.putString("path", p.path)
                    m.putDouble("mtime", p.mtime.toDouble())
                    m.putBoolean("isDirectory", false)
                    m.putString("directory", p.directory ?: "")
                    photos.pushMap(m)
                }
                val map = Arguments.createMap()
                map.putBoolean("exists", true)
                map.putArray("photos", photos)
                withContext(Dispatchers.Main) { promise.resolve(map) }
            } catch (e: Exception) {
                Log.e(TAG, "listImagesRecursive failed", e)
                withContext(Dispatchers.Main) {
                    promise.reject("LIST_RECURSIVE_FAILED", e.message, e)
                }
            }
        }
    }

    @ReactMethod
    fun findLatestCovers(dirPaths: ReadableArray, deletedPaths: ReadableArray?, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val deleted = deletedSet(deletedPaths)
                val covers = Arguments.createMap()
                for (i in 0 until dirPaths.size()) {
                    val p = dirPaths.getString(i)?.removePrefix("file://") ?: continue
                    latestCover(p, deleted)?.let { covers.putString(p, it) }
                }
                withContext(Dispatchers.Main) { promise.resolve(covers) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    promise.reject("COVERS_FAILED", e.message, e)
                }
            }
        }
    }

    /**
     * Fire-and-forget warm cache for Camera → Gallery navigation.
     * Resolves immediately; listing is stored in [listCache].
     */
    @ReactMethod
    fun prefetch(basePath: String, deletedPaths: ReadableArray?, promise: Promise) {
        val clean = basePath.removePrefix("file://")
        prefetchJob?.cancel()
        prefetchJob = CoroutineScope(Dispatchers.IO).launch {
            try {
                val deleted = deletedSet(deletedPaths)
                var listing = listDirSync(clean, deleted)
                if (listing.exists && listing.dirs.isNotEmpty()) {
                    val covers = HashMap<String, String>()
                    for (d in listing.dirs) {
                        latestCover(d.path, deleted)?.let { covers[d.path] = it }
                    }
                    listing = listing.copy(covers = covers)
                }
                listCache[clean] = listing
                Log.d(TAG, "Prefetch ready for $clean (${listing.dirs.size} dirs, ${listing.photos.size} photos)")
            } catch (e: Exception) {
                Log.w(TAG, "Prefetch failed: ${e.message}")
            }
        }
        promise.resolve(true)
    }

    @ReactMethod
    fun getCachedListing(path: String, promise: Promise) {
        val clean = path.removePrefix("file://")
        val cached = listCache[clean]
        if (cached == null) {
            promise.resolve(null)
        } else {
            promise.resolve(listingToWritable(cached))
        }
    }

    @ReactMethod
    fun invalidate(path: String?, promise: Promise) {
        invalidateCache(path)
        promise.resolve(true)
    }

    @ReactMethod
    fun deletePaths(paths: ReadableArray, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val cleaned = ArrayList<String>()
                for (i in 0 until paths.size()) {
                    val p = paths.getString(i)?.removePrefix("file://") ?: continue
                    if (p.isNotEmpty()) cleaned.add(p)
                }
                if (cleaned.isEmpty()) {
                    withContext(Dispatchers.Main) { promise.resolve(true) }
                    return@launch
                }

                val rooted = tryDeleteRoot(cleaned)
                if (!rooted) {
                    for (p in cleaned) {
                        try {
                            val f = File(p)
                            if (f.exists()) {
                                if (f.isDirectory) f.deleteRecursively() else f.delete()
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "Fallback delete failed for $p: ${e.message}")
                        }
                    }
                }

                unindexMediaStore(reactContext, cleaned)
                pruneEmptyParents(cleaned)

                for (p in cleaned) {
                    invalidateCache(p)
                }

                withContext(Dispatchers.Main) { promise.resolve(true) }
            } catch (e: Exception) {
                Log.e(TAG, "deletePaths failed", e)
                withContext(Dispatchers.Main) {
                    promise.reject("DELETE_FAILED", e.message, e)
                }
            }
        }
    }

    private fun tryDeleteRoot(paths: List<String>): Boolean {
        return try {
            val process = Runtime.getRuntime().exec("su")
            DataOutputStream(process.outputStream).use { os ->
                val parents = HashSet<String>()
                for (p in paths) {
                    os.writeBytes("rm -rf \"$p\"\n")
                    val slash = p.lastIndexOf('/')
                    if (slash > 0) parents.add(p.substring(0, slash))
                }
                for (parent in parents) {
                    os.writeBytes(
                        "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d \"file://$parent\"\n"
                    )
                }
                os.writeBytes("exit\n")
                os.flush()
            }
            process.waitFor() == 0
        } catch (e: Exception) {
            Log.w(TAG, "Root delete unavailable: ${e.message}")
            false
        }
    }

    private fun unindexMediaStore(context: Context, paths: List<String>) {
        try {
            val resolver = context.contentResolver
            for (p in paths) {
                try {
                    MediaScannerConnection.scanFile(context, arrayOf(p), null, null)
                } catch (_: Exception) {
                }
                try {
                    val uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    resolver.delete(uri, "${MediaStore.Images.Media.DATA}=?", arrayOf(p))
                } catch (_: Exception) {
                }
                // Also try relative path match for scoped storage layouts
                try {
                    val name = File(p).name
                    val uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    val cursor = resolver.query(
                        uri,
                        arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATA),
                        "${MediaStore.Images.Media.DISPLAY_NAME}=?",
                        arrayOf(name),
                        null
                    )
                    cursor?.use {
                        while (it.moveToNext()) {
                            val data = it.getString(1)
                            if (data == p) {
                                val id = it.getLong(0)
                                resolver.delete(ContentUris.withAppendedId(uri, id), null, null)
                            }
                        }
                    }
                } catch (_: Exception) {
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "MediaStore unindex: ${e.message}")
        }
    }

    private fun pruneEmptyParents(paths: List<String>) {
        val parents = paths.mapNotNull { File(it).parentFile }.toMutableSet()
        // Walk up a few levels; stop at DCIM/Camera or guest cache roots.
        var guard = 0
        while (parents.isNotEmpty() && guard < 8) {
            guard++
            val next = HashSet<File>()
            for (parent in parents) {
                try {
                    if (!parent.exists() || !parent.isDirectory) continue
                    val children = parent.listFiles()
                    if (children != null && children.isEmpty()) {
                        val name = parent.name
                        // Never prune DCIM / Camera / storage roots
                        if (name.equals("DCIM", true) ||
                            name.equals("Camera", true) ||
                            name.equals("0", true) ||
                            name.equals("storage", true)
                        ) {
                            continue
                        }
                        if (parent.delete()) {
                            parent.parentFile?.let { next.add(it) }
                            invalidateCache(parent.absolutePath)
                        }
                    }
                } catch (_: Exception) {
                }
            }
            parents.clear()
            parents.addAll(next)
        }
    }
}
