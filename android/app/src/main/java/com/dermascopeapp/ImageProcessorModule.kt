package com.dermascopeapp

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min

class ImageProcessorModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "ImageProcessorModule"
    }

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
                Log.d("ImageProcessor", "Starting native processing for $uri, Zoom: $zoomVal, Orientation: $orientation")

                val cleanPath = if (uri.startsWith("file://")) uri.substring(7) else uri
                val sourceFile = File(cleanPath)

                if (!sourceFile.exists()) {
                    Log.e("ImageProcessor", "Source file does not exist: $cleanPath")
                    withContext(Dispatchers.Main) { promise.resolve(uri) }
                    return@launch
                }

                // Decode full-res; downscale below if needed to limit peak RAM in bursts.
                val options = BitmapFactory.Options().apply {
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                    inSampleSize = 1
                }
                var bitmap = BitmapFactory.decodeFile(cleanPath, options)
                if (bitmap == null) {
                    Log.e("ImageProcessor", "Failed to decode bitmap from $cleanPath")
                    withContext(Dispatchers.Main) { promise.resolve(uri) }
                    return@launch
                }

                // Downscale very large frames slightly before canvas work to avoid OOM
                // when the queue drains a burst. Keep enough resolution for clinical use.
                val maxEdge = 4096
                val srcW = bitmap.width
                val srcH = bitmap.height
                if (srcW > maxEdge || srcH > maxEdge) {
                    val scale = min(maxEdge.toFloat() / srcW, maxEdge.toFloat() / srcH)
                    val scaledW = max(1, (srcW * scale).toInt())
                    val scaledH = max(1, (srcH * scale).toInt())
                    val scaled = Bitmap.createScaledBitmap(bitmap, scaledW, scaledH, true)
                    if (scaled != bitmap) {
                        bitmap.recycle()
                        bitmap = scaled
                    }
                }

                val originalW = bitmap.width
                val originalH = bitmap.height

                // 2. Calculate Rotation
                var rotationAngle = 0f
                var isSideways = false

                // Using the FORCE_PORTRAIT logic from JS
                if (originalW > originalH) {
                    isSideways = true
                    rotationAngle = 90f
                } else {
                    isSideways = false
                    rotationAngle = 0f
                }
                Log.d("ImageProcessor", "FORCE_PORTRAIT: raw ${originalW}x${originalH} -> rotate $rotationAngle")

                val imgW = if (isSideways) originalH else originalW
                val imgH = if (isSideways) originalW else originalH

                // 3. Create Output Bitmap and Canvas
                val outputBitmap = Bitmap.createBitmap(imgW, imgH, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(outputBitmap)

                // 4. White Balance Paint
                val temp = 6500.0 // DEFAULT_TEMPERATURE
                val tint = 0.0    // DEFAULT_TINT

                val tempRatio = temp / 6500.0
                val rScale = if (tempRatio < 1) 1.0 else 1.0 / tempRatio
                val bScale = if (tempRatio > 1) 1.0 else tempRatio
                val gScale = 1.0 - (tint * 0.1)

                val colorMatrix = ColorMatrix(floatArrayOf(
                    rScale.toFloat(), 0f, 0f, 0f, 0f,
                    0f, gScale.toFloat(), 0f, 0f, 0f,
                    0f, 0f, bScale.toFloat(), 0f, 0f,
                    0f, 0f, 0f, 1f, 0f
                ))
                val paint = Paint().apply {
                    colorFilter = ColorMatrixColorFilter(colorMatrix)
                }

                // 5. Draw Image with Rotation
                canvas.save()
                if (rotationAngle == 90f) {
                    canvas.translate(imgW.toFloat(), 0f)
                    canvas.rotate(90f)
                } else if (rotationAngle == -90f) {
                    canvas.translate(0f, imgH.toFloat())
                    canvas.rotate(-90f)
                } else if (rotationAngle == 180f) {
                    canvas.translate(imgW.toFloat(), imgH.toFloat())
                    canvas.rotate(180f)
                }
                canvas.drawBitmap(bitmap, 0f, 0f, paint)
                canvas.restore()

                // Free original bitmap early
                bitmap.recycle()
                bitmap = null

                // 6. Draw Scale Watermark
                try {
                    val scaleX = imgW * 0.04f
                    val scaleTop = imgH * 0.1f
                    val scaleHeight = imgH * 0.8f

                    val scalePaint = Paint().apply {
                        color = Color.WHITE
                        strokeWidth = max(4f, imgW / 300f)
                        isAntiAlias = true
                        style = Paint.Style.FILL_AND_STROKE
                    }

                    canvas.drawLine(scaleX, scaleTop, scaleX, scaleTop + scaleHeight, scalePaint)

                    val maxMm = 15.0 / zoomVal
                    val textSize = max(30f, imgH / 40f)
                    
                    val textPaint = Paint().apply {
                        color = Color.WHITE
                        this.textSize = textSize
                        isAntiAlias = true
                        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
                    }

                    val totalSteps = (maxMm * 10).toInt()
                    for (step in 0..totalSteps) {
                        val `val` = step / 10.0
                        val valRounded = (`val` * 10).toInt()
                        val isMajor = valRounded % 10 == 0
                        val isMedium = valRounded % 10 == 5

                        val y = scaleTop + ((maxMm - `val`) / maxMm).toFloat() * scaleHeight

                        var tickWidth = imgW * 0.015f
                        if (isMajor) tickWidth = imgW * 0.04f
                        else if (isMedium) tickWidth = imgW * 0.027f

                        canvas.drawLine(scaleX, y, scaleX + tickWidth, y, scalePaint)

                        if (isMajor) {
                            val textStr = `val`.toInt().toString()
                            val textX = scaleX + tickWidth + (imgW * 0.015f)
                            canvas.drawText(textStr, textX, y + (textSize / 3f), textPaint)
                        }
                    }
                    canvas.drawText("mm", scaleX, scaleTop + scaleHeight + textSize + 10f, textPaint)
                } catch (e: Exception) {
                    Log.e("ImageProcessor", "Scale watermark error", e)
                }

                // 7. Draw Patient Info Box
                if (patientName.isNotEmpty() || part.isNotEmpty()) {
                    try {
                        val label = listOf(patientName, part).filter { it.isNotEmpty() }.joinToString(" | ")
                        val infoTextSize = max(40f, imgW / 25f)
                        
                        val infoPaint = Paint().apply {
                            color = Color.WHITE
                            isAntiAlias = true
                            textSize = infoTextSize
                            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                        }

                        val textWidth = infoPaint.measureText(label)
                        val paddingX = infoTextSize * 1.0f
                        val paddingY = infoTextSize * 0.6f
                        
                        val boxWidth = textWidth + paddingX * 2
                        val boxHeight = infoTextSize + paddingY * 2
                        
                        val boxX = (imgW - boxWidth) / 2f
                        val boxY = imgH - boxHeight - (imgH * 0.01f)

                        val boxPaint = Paint().apply {
                            color = Color.argb((0.6 * 255).toInt(), 0, 0, 0) // rgba(0,0,0,0.6)
                            isAntiAlias = true
                        }

                        canvas.drawRect(boxX, boxY, boxX + boxWidth, boxY + boxHeight, boxPaint)

                        val textX = boxX + paddingX
                        val textY = boxY + boxHeight / 2f + infoTextSize * 0.35f

                        canvas.drawText(label, textX, textY, infoPaint)
                    } catch (e: Exception) {
                        Log.e("ImageProcessor", "Patient info box error", e)
                    }
                }

                // 8. Save output — include nano-ish uniqueness so concurrent
                // process calls never collide on the same temp filename.
                val tempDir = reactContext.cacheDir
                val outputFile = File(tempDir, "processed_${System.currentTimeMillis()}_${Thread.currentThread().id}.jpg")
                
                FileOutputStream(outputFile).use { out ->
                    // 85 keeps quality high while reducing encode time/memory under burst.
                    outputBitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
                }
                
                outputBitmap.recycle()
                
                val finalPath = outputFile.absolutePath
                Log.d("ImageProcessor", "Done processing, saved to $finalPath")
                
                withContext(Dispatchers.Main) {
                    promise.resolve("file://$finalPath")
                }

            } catch (e: Exception) {
                Log.e("ImageProcessor", "Process failed", e)
                withContext(Dispatchers.Main) {
                    promise.resolve(uri) // fallback to original on error
                }
            }
        }
    }
}
