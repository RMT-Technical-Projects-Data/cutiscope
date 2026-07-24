package com.dermascopeapp

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ImageProcessorModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ImageProcessorModule"

    @ReactMethod
    fun processImageAsync(
        uri: String,
        zoomVal: Double,
        patientName: String,
        part: String,
        orientation: String?,
        promise: Promise
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val path = ImageWatermarkProcessor.processToCache(
                    reactContext.cacheDir,
                    uri,
                    zoomVal,
                    patientName,
                    part,
                    orientation
                )
                withContext(Dispatchers.Main) {
                    promise.resolve("file://$path")
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    promise.reject("PROCESS_FAILED", e.message ?: "Image processing failed", e)
                }
            }
        }
    }
}
