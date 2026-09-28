package com.vitalguard.field.ui.theme

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import com.vitalguard.field.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.roundToInt

internal data class WallpaperFrame(val origin: Offset = Offset.Zero, val size: IntSize = IntSize.Zero)
internal val LocalWallpaperFrame = staticCompositionLocalOf<State<WallpaperFrame>?> { null }

/** A single, half-resolution bitmap per process, shared across tabs and rotations. */
private object FrostedWallpaperCache {
    @Volatile private var bitmap: ImageBitmap? = null
    fun peek(): ImageBitmap? = bitmap

    @Synchronized fun get(resources: Resources): ImageBitmap {
        bitmap?.let { return it }
        val source = checkNotNull(BitmapFactory.decodeResource(resources, R.drawable.site_wallpaper,
            BitmapFactory.Options().apply {
                inSampleSize = 2
                inScaled = false
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }))
        val width = source.width
        val height = source.height
        val pixels = IntArray(width * height)
        source.getPixels(pixels, 0, width, 0, 0, width, height)
        source.recycle()
        // Three box passes approximate a soft Gaussian. No RenderEffect, GPU blur or frame capture.
        val result = Bitmap.createBitmap(blurWallpaperPixels(pixels, width, height, 12),
            width, height, Bitmap.Config.ARGB_8888).asImageBitmap()
        bitmap = result
        return result
    }
}

@Composable
private fun rememberFrostedWallpaper(): ImageBitmap? {
    val resources = LocalContext.current.resources
    if (LocalInspectionMode.current) return remember(resources) { FrostedWallpaperCache.get(resources) }
    val bitmap by produceState(FrostedWallpaperCache.peek(), resources) {
        value = withContext(Dispatchers.Default) { FrostedWallpaperCache.get(resources) }
    }
    return bitmap
}

/** Draw only the enclosing panel's background; its contents never enter the blur. */
@Composable
internal fun FrostedWallpaper(modifier: Modifier = Modifier) {
    val bitmap = rememberFrostedWallpaper()
    val frame = LocalWallpaperFrame.current
    val direction = LocalLayoutDirection.current
    var origin by remember { mutableStateOf(Offset.Zero) }
    Canvas(modifier.onGloballyPositioned { origin = it.positionInRoot() }) {
        val viewport = frame?.value
        if (bitmap != null && viewport != null && viewport.size.width > 0 && viewport.size.height > 0) {
            // Same Crop + CenterStart as the sharp outer wallpaper, including system insets/margins.
            val scale = max(viewport.size.width.toFloat() / bitmap.width, viewport.size.height.toFloat() / bitmap.height)
            val width = bitmap.width * scale
            val height = bitmap.height * scale
            val relative = origin - viewport.origin
            val x = if (direction == LayoutDirection.Ltr) 0f else viewport.size.width - width
            drawImage(bitmap, dstOffset = IntOffset((x - relative.x).roundToInt(),
                ((viewport.size.height - height) / 2f - relative.y).roundToInt()),
                dstSize = IntSize(width.roundToInt(), height.roundToInt()), filterQuality = FilterQuality.Medium)
        }
        drawRect(DashboardColors.workspace)
    }
}

/** Sliding sums keep this one-time CPU operation linear; edge pixels are extended, not darkened. */
internal fun blurWallpaperPixels(pixels: IntArray, width: Int, height: Int, radius: Int): IntArray {
    require(width > 0 && height > 0 && pixels.size == width * height && radius > 0)
    val scratch = IntArray(pixels.size)
    fun pass(input: IntArray, output: IntArray, horizontal: Boolean) {
        val length = if (horizontal) width else height
        val lines = if (horizontal) height else width
        val stride = if (horizontal) 1 else width
        val window = radius * 2 + 1
        for (line in 0 until lines) {
            val base = if (horizontal) line * width else line
            var a = 0; var r = 0; var g = 0; var b = 0
            fun add(pixel: Int, sign: Int) {
                a += (pixel ushr 24) * sign
                r += ((pixel ushr 16) and 255) * sign
                g += ((pixel ushr 8) and 255) * sign
                b += (pixel and 255) * sign
            }
            for (i in -radius..radius) add(input[base + i.coerceIn(0, length - 1) * stride], 1)
            for (i in 0 until length) {
                output[base + i * stride] = ((a / window) shl 24) or ((r / window) shl 16) or
                    ((g / window) shl 8) or (b / window)
                add(input[base + (i - radius).coerceAtLeast(0) * stride], -1)
                add(input[base + (i + radius + 1).coerceAtMost(length - 1) * stride], 1)
            }
        }
    }
    repeat(3) {
        pass(pixels, scratch, true)
        pass(scratch, pixels, false)
    }
    return pixels
}
