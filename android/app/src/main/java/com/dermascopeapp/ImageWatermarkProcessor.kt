package com.dermascopeapp

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Typeface
import android.media.ExifInterface
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min

/**
 * Shared watermark / WB / rotate pipeline used by ImageProcessorModule and CapturePipelineModule.
 */
object ImageWatermarkProcessor {
    private const val TAG = "ImageWatermark"

    private fun resolveRotationDegrees(path: String, orientation: String?, width: Int, height: Int): Float {
        val fromExif = try {
            when (ExifInterface(path).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (e: Exception) {
            Log.w(TAG, "EXIF read failed: ${e.message}")
            0f
        }
        if (fromExif != 0f) return fromExif

        val fromOrientation = when (orientation?.lowercase()) {
            "landscape-left" -> 90f
            "landscape-right" -> 270f
            "portrait-upside-down" -> 180f
            else -> 0f
        }
        if (fromOrientation != 0f) return fromOrientation

        if (width > height) return 90f
        return 0f
    }

    /**
     * @return absolute path to processed JPEG in [cacheDir], or null on failure
     */
    fun processToCache(
        cacheDir: File,
        uri: String,
        zoomVal: Double,
        patientName: String,
        part: String,
        orientation: String?
    ): String {
        val cleanPath = if (uri.startsWith("file://")) uri.substring(7) else uri
        val sourceFile = File(cleanPath)
        if (!sourceFile.exists()) {
            throw IllegalStateException("Source file does not exist: $cleanPath")
        }

        val options = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inSampleSize = 1
        }
        var bitmap = BitmapFactory.decodeFile(cleanPath, options)
            ?: throw IllegalStateException("Failed to decode bitmap from $cleanPath")

        // Preserve full sensor resolution (48MP ≈ 8064×6048). Do not downscale here —
        // upload compression is handled separately in compressIfNeeded().
        Log.d(TAG, "processToCache decode: ${bitmap.width}×${bitmap.height}px")

        val originalW = bitmap.width
        val originalH = bitmap.height
        val rotationAngle = resolveRotationDegrees(cleanPath, orientation, originalW, originalH)
        val isSideways = rotationAngle == 90f || rotationAngle == 270f || rotationAngle == -90f

        val imgW = if (isSideways) originalH else originalW
        val imgH = if (isSideways) originalW else originalH

        val outputBitmap = Bitmap.createBitmap(imgW, imgH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(outputBitmap)

        val temp = 6500.0
        val tint = 0.0
        val tempRatio = temp / 6500.0
        val rScale = if (tempRatio < 1) 1.0 else 1.0 / tempRatio
        val bScale = if (tempRatio > 1) 1.0 else tempRatio
        val gScale = 1.0 - (tint * 0.1)

        val colorMatrix = ColorMatrix(
            floatArrayOf(
                rScale.toFloat(), 0f, 0f, 0f, 0f,
                0f, gScale.toFloat(), 0f, 0f, 0f,
                0f, 0f, bScale.toFloat(), 0f, 0f,
                0f, 0f, 0f, 1f, 0f
            )
        )
        val paint = Paint().apply {
            colorFilter = ColorMatrixColorFilter(colorMatrix)
        }

        canvas.save()
        when (rotationAngle) {
            90f -> {
                canvas.translate(imgW.toFloat(), 0f)
                canvas.rotate(90f)
            }
            270f, -90f -> {
                canvas.translate(0f, imgH.toFloat())
                canvas.rotate(-90f)
            }
            180f -> {
                canvas.translate(imgW.toFloat(), imgH.toFloat())
                canvas.rotate(180f)
            }
        }
        canvas.drawBitmap(bitmap, 0f, 0f, paint)
        canvas.restore()
        bitmap.recycle()

        run {
            val scaleX = imgW * 0.04f
            val scaleTop = imgH * 0.1f
            val scaleHeight = imgH * 0.8f
            val safeZoom = if (zoomVal > 0.01) zoomVal else 1.0

            val scalePaint = Paint().apply {
                color = Color.WHITE
                strokeWidth = max(4f, imgW / 300f)
                isAntiAlias = true
                style = Paint.Style.FILL_AND_STROKE
            }
            canvas.drawLine(scaleX, scaleTop, scaleX, scaleTop + scaleHeight, scalePaint)

            val maxMm = 15.0 / safeZoom
            val textSize = max(30f, imgH / 40f)
            val textPaint = Paint().apply {
                color = Color.WHITE
                this.textSize = textSize
                isAntiAlias = true
                typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
            }

            val totalSteps = (maxMm * 10).toInt().coerceAtLeast(0).coerceAtMost(500)
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
                    canvas.drawText(`val`.toInt().toString(), scaleX + tickWidth + (imgW * 0.015f), y + (textSize / 3f), textPaint)
                }
            }
            canvas.drawText("mm", scaleX, scaleTop + scaleHeight + textSize + 10f, textPaint)
        }

        if (patientName.isNotEmpty() || part.isNotEmpty()) {
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
                color = Color.argb((0.6 * 255).toInt(), 0, 0, 0)
                isAntiAlias = true
            }
            canvas.drawRect(boxX, boxY, boxX + boxWidth, boxY + boxHeight, boxPaint)
            canvas.drawText(label, boxX + paddingX, boxY + boxHeight / 2f + infoTextSize * 0.35f, infoPaint)
        }

        val outputFile = File(cacheDir, "processed_${System.currentTimeMillis()}_${Thread.currentThread().id}.jpg")
        FileOutputStream(outputFile).use { out ->
            // High quality for local clinical archive — upload path compresses separately if needed.
            outputBitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)
        }
        outputBitmap.recycle()
        return outputFile.absolutePath
    }

    /** Compress a JPEG for upload when over [maxBytes]. Returns path (may be original). */
    fun compressIfNeeded(context: Context, sourcePath: String, maxBytes: Long = 2_000_000L, quality: Int = 78): String {
        val clean = if (sourcePath.startsWith("file://")) sourcePath.substring(7) else sourcePath
        val src = File(clean)
        if (!src.exists() || src.length() <= maxBytes) return clean

        val bitmap = BitmapFactory.decodeFile(clean) ?: return clean
        val out = File(context.cacheDir, "compressed_${System.currentTimeMillis()}.jpg")
        FileOutputStream(out).use { fos ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, fos)
        }
        bitmap.recycle()
        return if (out.exists() && out.length() > 0) out.absolutePath else clean
    }
}
