package com.vitalguard.field

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.record.*
import com.vitalguard.field.ui.record.AndroidInkRenderer
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream

@RunWith(AndroidJUnit4::class)
class InkRendererAndroidTest {
    private fun image(width: Int,height: Int): ByteArray {
        val bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
        return try { ByteArrayOutputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it); it.toByteArray() } } finally { bitmap.recycle() }
    }
    @Test fun markerIsTranslucentAndErasingLeavesOriginalPixels() = runBlocking {
        val renderer=AndroidInkRenderer(); val base=image(100,100)
        val marker=InkStroke(InkTool.marker,0xFFFF0000,.1,listOf(InkPoint(.1,.5,.5),InkPoint(.9,.5,.5)))
        fun pixel(bytes: ByteArray): Int {
            val bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.size)
            return try { bitmap.getPixel(50,50) } finally { bitmap.recycle() }
        }
        val color=pixel(renderer.render(base,listOf(marker)))
        assertEquals(255,Color.red(color)); assertTrue(Color.green(color) in 165..167); assertEquals(255,Color.alpha(color))
        val strokes=mutableListOf(marker)
        eraseInkStrokes(strokes,InkStroke(InkTool.eraser,0,.028,listOf(InkPoint(.5,.5))),InkSize(100.0,100.0))
        assertEquals(Color.WHITE,pixel(renderer.render(base,strokes)))
    }
    @Test fun largePhotoPreviewIsSampledButPngKeepsOriginalResolution() = runBlocking {
        val renderer=AndroidInkRenderer(); val base=image(4160,3120)
        val preview=renderer.preview(base)
        assertTrue(preview.width<=1600); preview.recycle()
        val png=renderer.render(base,listOf(InkStroke(InkTool.rectangle,0xFFDC2626,.004,listOf(InkPoint(.2,.2),InkPoint(.8,.8)))))
        val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
        BitmapFactory.decodeByteArray(png,0,png.size,bounds)
        assertEquals(4160,bounds.outWidth); assertEquals(3120,bounds.outHeight); assertEquals("image/png",bounds.outMimeType)
    }
}
