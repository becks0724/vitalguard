package com.vitalguard.field

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import com.vitalguard.field.data.alerts.AlertsState
import com.vitalguard.field.data.mock.stage3SampleStatus
import com.vitalguard.field.ui.alerts.AlertsContent
import com.vitalguard.field.ui.theme.VgTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.time.Instant

class AlertFiltersComposeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val now = Instant.parse("2026-09-27T06:00:00Z")
    @Test fun draftFiltersApplyTogetherAndDismissPreservesPreviousSelection() {
        var writes = 0
        compose.setContent { VgTheme { AlertsContent(AlertsState(data = stage3SampleStatus(now.toString()), authorized = true, now = now), onAcknowledge = { writes++ }) } }
        compose.onNodeWithTag("alert-row-42").assertExists()
        compose.onNodeWithTag("alerts-filter-open").performScrollTo().performClick()
        compose.onNodeWithTag("alerts-filter-acked").performClick().assertIsSelected()
        compose.onNodeWithTag("alerts-filter-category-1").performClick()
        compose.onNodeWithTag("alerts-type-sos").performClick().assertIsSelected()
        compose.onNodeWithTag("alerts-filter-apply").assertContentDescriptionEquals("필터 적용").performClick()
        compose.onNodeWithTag("alerts-filter-summary").assertTextEquals("대응완료 · SOS · 0건")
        compose.onNodeWithTag("alert-row-42").assertDoesNotExist()
        compose.onNodeWithTag("alerts-filter-open").performClick()
        compose.onNodeWithTag("alerts-filter-reset").performClick()
        compose.onNodeWithTag("alerts-filter-close").performClick()
        compose.onNodeWithTag("alerts-filter-summary").assertTextEquals("대응완료 · SOS · 0건")
        compose.onNodeWithTag("alerts-filter-open").performClick()
        compose.onNodeWithTag("alerts-filter-reset").performClick()
        compose.onNodeWithTag("alerts-filter-apply").performClick()
        compose.onNodeWithTag("alert-row-42").assertExists()
        compose.runOnIdle { assertEquals(0, writes) }
    }
    @Test fun roundRefreshRetainsReadOnlyActionAndLoadingGuard() {
        var calls = 0; val state = mutableStateOf(AlertsState(data = stage3SampleStatus(now.toString()), authorized = true, now = now))
        compose.setContent { VgTheme { AlertsContent(state.value, onRefresh = { calls++ }) } }
        compose.onNodeWithTag("alerts-refresh").assertContentDescriptionEquals("새로고침")
            .assertWidthIsEqualTo(56.dp).assertHeightIsEqualTo(56.dp).performClick()
        compose.mainClock.autoAdvance = false
        compose.runOnIdle { assertEquals(1, calls); state.value = state.value.copy(loading = true) }
        compose.mainClock.advanceTimeByFrame()
        compose.onNodeWithTag("alerts-refresh").assertIsNotEnabled()
        compose.onNodeWithText("서버 상태 다시 조회").assertDoesNotExist()
    }
}
