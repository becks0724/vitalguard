package com.vitalguard.field

import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.site.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class WeatherEffectsTest {
    private val now = Instant.parse("2026-09-29T13:00:00Z")
    private fun state(effect: Map<String, Any?>, weather: Map<String, Any?> = emptyMap()): SiteSummaryState =
        SiteSummaryState(now = now, data = SiteStatus(mapOf("ok" to true, "fetchedAt" to now.toString(),
            "weather" to (mapOf("ok" to true, "level" to "danger", "stale" to false, "fetchedAt" to now.toString(), "effects" to effect) + weather))))
    private val rain = mapOf("precipitation" to "rain", "precipitationSource" to "kma-ncst", "windDanger" to true)
    @Test fun effectsRequireWeatherPageFreshSuccessfulDataAndOnline() {
        val fresh = state(rain)
        assertTrue(weatherBackgroundEffects(fresh, true, false).rain)
        assertTrue(weatherBackgroundEffects(fresh, true, false).windDanger)
        for (s in listOf(fresh.copy(failed = true), fresh.copy(forbidden = true), fresh.copy(now = now.plusSeconds(300)),
            state(rain, mapOf("stale" to true)), state(rain, mapOf("persisted" to true)), state(rain, mapOf("ok" to false)),
            state(rain, mapOf("fetchedAt" to "bad")), state(rain, mapOf("fetchedAt" to now.plusSeconds(1).toString())))) {
            assertFalse(weatherBackgroundEffects(s, true, false).active)
        }
        assertFalse(weatherBackgroundEffects(fresh, false, false).active)
        assertFalse(weatherBackgroundEffects(fresh, true, true).active)
    }
    @Test fun noClientThresholdOrInferredPrecipitationAndMixedIsBoth() {
        assertFalse(weatherBackgroundEffects(state(emptyMap()), true, false).active)
        assertFalse(WeatherEffects(mapOf("windDanger" to "true")).windDanger)
        assertFalse(WeatherEffects(rain + ("precipitationSource" to "unknown")).rain)
        val mixed = WeatherEffects(rain + ("precipitation" to "mixed"))
        assertTrue(mixed.rain); assertTrue(mixed.snow)
        assertFalse(WeatherEffects(rain + ("precipitation" to "none") + ("windDanger" to false)).active)
    }
}
