package com.vitalguard.field

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.vitalguard.field.data.models.SiteStatus
import com.vitalguard.field.ui.site.SiteSummaryState
import com.vitalguard.field.ui.site.WeatherDetailScreen
import com.vitalguard.field.ui.theme.DashboardTheme
import org.junit.Rule
import org.junit.Test
import java.time.Instant

class WeatherIndoorComposeTest {
    @get:Rule val compose = createComposeRule()
    @Test fun indoorValuesSurviveOutdoorFailureAndDisappearAfterServerExpiry() {
        val time = Instant.parse("2026-09-30T00:00:00Z")
        val data = SiteStatus(mapOf("ok" to true, "fetchedAt" to time.toString(), "weather" to mapOf("ok" to false),
            "gas" to mapOf("ok" to true, "level" to "normal", "deviceId" to "mock-gaspod", "lastSeenAt" to time.toString(),
                "environment" to mapOf("source" to "gaspod", "temperatureC" to 23.7, "humidityPct" to 52, "pressureHpa" to 1008.4,
                    "checkedAt" to time.toString(), "validForMs" to 60000))))
        val state = mutableStateOf(SiteSummaryState(data = data, now = time, receivedAt = time))
        compose.setContent { DashboardTheme { WeatherDetailScreen(state.value, {}, {}) } }
        compose.onNodeWithTag("weather-detail-scroll").performScrollToNode(hasTestTag("weather-metric-indoor-pressure"))
        compose.onNodeWithText("1008.4").assertIsDisplayed()
        compose.onNodeWithText("hPa").assertIsDisplayed()
        compose.onNodeWithText("23.7").assertExists()
        compose.runOnIdle { state.value = state.value.copy(now = time.plusSeconds(60)) }
        compose.onNodeWithText("1008.4").assertDoesNotExist()
        compose.onNodeWithText("23.7").assertDoesNotExist()
        compose.onNodeWithText("수신 지연").assertExists()
    }
}
