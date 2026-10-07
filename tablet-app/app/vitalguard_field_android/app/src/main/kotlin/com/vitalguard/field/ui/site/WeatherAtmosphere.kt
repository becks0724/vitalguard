package com.vitalguard.field.ui.site

import android.graphics.Bitmap
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.*

/** Small static opacity texture. Noise is baked once on CPU, never evaluated as a per-frame shader. */
private object WindAtmosphereCache {
    @Volatile var image: ImageBitmap? = null
    @Synchronized fun get(): ImageBitmap {
        image?.let { return it }
        val width = 512; val height = 192
        val pixels = IntArray(width * height)
        fun hash(x: Int, y: Int): Float {
            var n = x * 374761393 + y * 668265263
            n = (n xor (n ushr 13)) * 1274126177
            return ((n xor (n ushr 16)) and 0x7fffffff).toFloat() / Int.MAX_VALUE
        }
        fun noise(x: Float, y: Float): Float {
            val ix = floor(x).toInt(); val iy = floor(y).toInt()
            val dx = x - ix; val dy = y - iy
            val sx = dx * dx * (3f - 2f * dx); val sy = dy * dy * (3f - 2f * dy)
            val top = hash(ix, iy) * (1f - sx) + hash(ix + 1, iy) * sx
            val bottom = hash(ix, iy + 1) * (1f - sx) + hash(ix + 1, iy + 1) * sx
            return top * (1f - sy) + bottom * sy
        }
        for (y in 0 until height) for (x in 0 until width) {
            val u = x.toFloat() / width; val v = y.toFloat() / height
            val warp = noise(u * 4f + 31f, v * 4f + 7f) * .8f
            val cloud = noise(u * 3f, v * 5f + warp) * .54f + noise(u * 7f + 17f, v * 13f + warp) * .30f + noise(u * 15f, v * 29f) * .16f
            val edge = sin(u * PI).toFloat().pow(.8f) * sin(v * PI).toFloat().pow(1.5f)
            val opacity = (((cloud - .27f) / .73f).coerceIn(0f, 1f).pow(1.7f) * edge * 200).toInt()
            pixels[y * width + x] = (opacity shl 24) or 0x00D8D4C8
        }
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888).asImageBitmap().also { image = it }
    }
}

@Composable
internal fun rememberWindAtmosphere(enabled: Boolean): ImageBitmap? {
    val image by produceState(WindAtmosphereCache.image, enabled) {
        if (enabled && value == null) value = withContext(Dispatchers.Default) { WindAtmosphereCache.get() }
    }
    return image
}
