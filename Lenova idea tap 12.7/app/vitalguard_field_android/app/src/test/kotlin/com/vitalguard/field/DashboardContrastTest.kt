package com.vitalguard.field

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import com.vitalguard.field.ui.theme.DashboardColors
import org.junit.Assert.*
import org.junit.Test

class DashboardContrastTest {
    private fun contrast(a: Color, b: Color): Float {
        val values = listOf(a.luminance(), b.luminance())
        return (values.max() + .05f) / (values.min() + .05f)
    }
    @Test fun translucentCardTextStaysLegibleAtTheBrightestBackdropIntersection() {
        var background = DashboardColors.backdropLight
        // Radial highlight, architectural intersections, grain, then the glass fill.
        for (alpha in listOf(.04f, .022f, .022f, .024f)) background = Color.White.copy(alpha = alpha).compositeOver(background)
        val card = DashboardColors.card.compositeOver(background)
        for (text in listOf(DashboardColors.text, DashboardColors.secondary, DashboardColors.actionText)) {
            assertTrue("Card text contrast ${contrast(text, card)}", contrast(text, card) >= 4.5f)
        }
        assertTrue(DashboardColors.card.alpha > 0f && DashboardColors.card.alpha < 1f)
        assertEquals(1f, DashboardColors.sidebar.alpha, 0f)
        assertTrue(contrast(DashboardColors.secondary, DashboardColors.sidebar) >= 4.5f)
        assertTrue(contrast(DashboardColors.accentInk, DashboardColors.accent) >= 4.5f)
    }
}
