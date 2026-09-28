package com.vitalguard.field

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.mock.stage3SampleStatus
import com.vitalguard.field.ui.site.*
import com.vitalguard.field.ui.theme.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant

@RunWith(AndroidJUnit4::class)
class DashboardComposeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val now = Instant.parse("2026-09-27T06:00:00Z")
    @Test fun narrowLargeTextKeepsEveryDetailAndVideoActionReachable() {
        var detail = ""; var alerts = 0; var videos = 0
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                VgTheme { DashboardBackdrop(Modifier.width(520.dp).fillMaxHeight()) {
                    DashboardWorkspace(Modifier.fillMaxSize()) {
                    SiteScreen(SiteSummaryState(stage3SampleStatus(now.toString()), now = now),
                        onOpenDetail = { detail = it }, onOpenCctv = { videos++ }, onOpenAlerts = { alerts++ })
                    }
                } }
            }
        }
        for (page in listOf("weather", "workers", "gas", "aed")) {
            compose.onNodeWithTag("site-row-$page").performScrollTo().assertHeightIsAtLeast(72.dp).performClick()
            compose.runOnIdle { assertEquals(page, detail) }
        }
        compose.onNodeWithTag("site-open-cctv").performScrollTo().assertHeightIsAtLeast(56.dp).performClick()
        compose.onNodeWithTag("site-alerts").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, videos); assertEquals(1, alerts) }
    }
    @Test fun forbiddenHidesCachedMetricsAndUnknownUnitsNeverBecomeNumbers() {
        val state = mutableStateOf(SiteSummaryState(stage3SampleStatus(now.toString()), forbidden = true, now = now))
        compose.setContent {
            VgTheme { DashboardBackdrop(Modifier.fillMaxSize()) {
                DashboardWorkspace(Modifier.fillMaxSize()) { SiteScreen(state.value) }
            } }
        }
        compose.onNodeWithText("27.2", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("site-refresh").assertContentDescriptionEquals("새로고침")
            .assertWidthIsEqualTo(56.dp).assertHeightIsEqualTo(56.dp)
        compose.onNodeWithTag("site-row-weather").assertIsNotEnabled()
        compose.runOnIdle { state.value = state.value.copy(forbidden = false) }
        compose.onNodeWithTag("site-row-gas").performScrollTo()
        compose.onNodeWithTag("dashboard-gas-co", useUnmergedTree = true).assertTextEquals("단위 미수신")
        compose.onNodeWithTag("dashboard-gas-o2", useUnmergedTree = true).assertTextEquals("20.9 %")
        val before = compose.onNodeWithTag("site-row-weather").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { state.value = state.value.copy(loading = true) }
        compose.onNodeWithTag("site-refresh").assertIsNotEnabled()
        assertEquals(before, compose.onNodeWithTag("site-row-weather").fetchSemanticsNode().boundsInRoot)
    }
}
