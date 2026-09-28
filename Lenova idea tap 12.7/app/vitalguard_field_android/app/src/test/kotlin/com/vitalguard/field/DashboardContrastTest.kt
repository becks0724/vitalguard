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
    @Test fun translucentWorkspaceAndCardsStayLegibleEvenOverWhiteWallpaper() {
        // The photograph's brightest possible pixel; independent of crop/orientation.
        val background = DashboardColors.workspace.compositeOver(Color.White)
        val card = DashboardColors.card.compositeOver(background)
        val offlineBar = DashboardColors.offlineBar.compositeOver(background)
        for (text in listOf(DashboardColors.text, DashboardColors.secondary, DashboardColors.actionText)) {
            assertTrue("Card text contrast ${contrast(text, card)}", contrast(text, card) >= 4.5f)
            assertTrue("Workspace text contrast ${contrast(text, background)}", contrast(text, background) >= 4.5f)
            assertTrue("Offline strip text contrast ${contrast(text, offlineBar)}", contrast(text, offlineBar) >= 4.5f)
        }
        assertTrue(DashboardColors.workspace.alpha > 0f && DashboardColors.workspace.alpha < 1f)
        assertTrue(DashboardColors.card.alpha > 0f && DashboardColors.card.alpha < 1f)
        assertEquals(1f, DashboardColors.sidebar.alpha, 0f)
        assertTrue(contrast(DashboardColors.secondary, DashboardColors.sidebar) >= 4.5f)
        assertTrue(contrast(DashboardColors.accentInk, DashboardColors.accent) >= 4.5f)
    }
}
