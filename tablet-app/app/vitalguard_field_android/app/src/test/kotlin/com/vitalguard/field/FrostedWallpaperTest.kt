package com.vitalguard.field

import com.vitalguard.field.ui.theme.blurWallpaperPixels
import org.junit.Assert.*
import org.junit.Test

class FrostedWallpaperTest {
    @Test fun uniformPhotoColourAndAlphaStayUnchangedEvenAtEdges() {
        val colour = 0xFF3C789A.toInt()
        val pixels = IntArray(7 * 5) { colour }
        assertArrayEquals(pixels.copyOf(), blurWallpaperPixels(pixels, 7, 5, 12))
    }

    @Test fun fineDetailSoftensWithoutMakingOpaquePhotoTransparent() {
        val pixels = IntArray(25 * 25) { 0xFF000000.toInt() }
        pixels[12 * 25 + 12] = 0xFFFFFFFF.toInt()
        val result = blurWallpaperPixels(pixels, 25, 25, 1)
        val center = result[12 * 25 + 12] and 255
        assertTrue(center in 1..254)
        assertTrue((result[12 * 25 + 13] and 255) > 0)
        assertTrue(result.all { it ushr 24 == 255 })
    }
}
