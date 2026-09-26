package com.vitalguard.field

// Port: vg_background_test.dart의 팔레트 단조성·휘도·88% 카드 대비, vg_theme.dart의 V-1~V-5.
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import com.vitalguard.field.ui.shell.*
import com.vitalguard.field.ui.theme.*
import org.junit.Assert.*
import org.junit.Test

class BackgroundContrastTest {
    private fun contrast(a: Color, b: Color): Float {
        val values = listOf(a.luminance(), b.luminance())
        return (values.max() + .05f) / (values.min() + .05f)
    }
    @Test fun palettesAndCardForegroundsKeepContrast() {
        for (backdrop in VgBackdrop.entries) {
            val palette = backdropPalette(backdrop)
            for (channel in listOf<(Color) -> Float>({ it.red }, { it.green }, { it.blue })) {
                assertTrue(palette.gradient.zipWithNext().all { (a, b) -> channel(a) <= channel(b) })
            }
            val colors = palette.gradient + palette.gradient.flatMap {
                listOf(palette.line.copy(alpha = palette.gridOpacity).compositeOver(it),
                    palette.line.copy(alpha = palette.contourOpacity).compositeOver(it))
            }
            val min = colors.minBy { it.luminance() }; val max = colors.maxBy { it.luminance() }
            if (backdrop == VgBackdrop.dark) {
                assertTrue(min.luminance() >= .01f); assertTrue(max.luminance() <= .05f)
                assertTrue(contrast(Color.White, VgColors.ink.copy(alpha = vgCardSurfaceAlpha).compositeOver(max)) >= 4.5f)
            } else {
                assertTrue(min.luminance() >= .75f); assertTrue(max.luminance() <= .92f)
                assertTrue(contrast(VgColors.ink, Color.White.copy(alpha = vgCardSurfaceAlpha).compositeOver(min)) >= 4.5f)
            }
        }
        for (status in listOf(VgColors.ok, VgColors.warn, VgColors.danger)) assertTrue(contrast(status, VgColors.ink) >= 4.5f)
        assertTrue(contrast(VgColors.primary, Color.White) >= 4.5f)
    }
}
