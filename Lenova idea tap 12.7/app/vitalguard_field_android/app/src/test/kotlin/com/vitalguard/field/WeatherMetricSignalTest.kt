package com.vitalguard.field

import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.site.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class WeatherMetricSignalTest {
    private val now = Instant.parse("2026-09-30T00:00:00Z")
    private fun state(levels: Map<String, Any?>? = null, weather: Map<String, Any?> = emptyMap()) =
        SiteSummaryState(now = now, data = SiteStatus(mapOf("ok" to true, "fetchedAt" to now.toString(),
            "weather" to (mapOf("ok" to true, "level" to "danger", "stale" to false, "fetchedAt" to now.toString(), "metricLevels" to levels) + weather))))
    @Test fun usesOnlyRecognizedServerMetricLevelsAndNeverInfersFromValueOrOverallDanger() {
        val s = state(mapOf("apparent" to "danger", "wind" to "warn", "rain" to "normal", "uv" to "caution", "pm25" to true, "temperature" to "danger"))
        assertEquals("danger", weatherMetricSignal(s, "apparent", 20.0))
        assertEquals("warn", weatherMetricSignal(s, "wind", 0.0))
        assertEquals("normal", weatherMetricSignal(s, "rain", 0.0))
        assertNull(weatherMetricSignal(s, "uv", 11.0))
        assertNull(weatherMetricSignal(s, "pm25", 200.0))
        assertNull(weatherMetricSignal(s, "temperature", 50.0))
        assertNull(weatherMetricSignal(state(), "wind", 1000.0))
    }
    @Test fun indoorReadingsRemainSeparateAndExpireUsingServerValidityInsteadOfDeviceClock() {
        val checked = "2026-09-30T00:00:00Z"
        val received = now.plusSeconds(3600) // intentionally skewed tablet clock
        fun indoor(environment: Map<String, Any?>) = SiteSummaryState(now = received, receivedAt = received,
            data = SiteStatus(mapOf("ok" to true, "fetchedAt" to checked, "weather" to mapOf("ok" to false),
                "gas" to mapOf("ok" to true, "level" to "danger", "deviceId" to "gaspod", "lastSeenAt" to checked, "environment" to environment))))
        val sample = mapOf("source" to "gaspod", "temperatureC" to 0, "humidityPct" to 50, "pressureHpa" to 1008.4,
            "checkedAt" to checked, "validForMs" to 48_000)
        val fresh = indoor(sample)
        assertTrue(indoorEnvironmentFresh(fresh))
        assertFalse(indoorEnvironmentFresh(fresh.copy(now = received.plusSeconds(48))))
        assertFalse(indoorEnvironmentFresh(fresh.copy(receivedAt = null)))
        assertFalse(indoorEnvironmentFresh(fresh.copy(failed = true)))
        assertNull(indoor(sample + ("source" to "external")).data!!.gas.environment)
        assertEquals(0.0, fresh.data!!.gas.environment!!.temperatureC!!, .001)
        assertEquals(1008.4, fresh.data!!.gas.environment!!.pressureHpa!!, .001)
    }
    @Test fun loginWeatherDisplayExpiresAcrossTimeAndDeviceReboot() {
        val cached = LoginWeatherSnapshot(WeatherEffects("rain", true), 200_000, 3)
        assertTrue(cached.visible(100_000, 3).active)
        assertFalse(cached.visible(200_000, 3).active)
        assertFalse(cached.visible(100_000, 4).active)
        assertFalse(cached.visible(100_000, -1).active)
    }
    @Test fun forecastDoesNotInventMissingValuesOrInvalidDates() {
        val w = SiteStatusWeather(mapOf("ok" to true, "level" to "normal", "forecast" to listOf(
            mapOf("date" to "bad", "highC" to 25), mapOf("date" to "2026-09-30", "highC" to 0, "lowC" to -2, "precipitationProbabilityPct" to 101))))
        assertEquals(1, w.forecast.size)
        assertEquals(0.0, w.forecast.single().highC!!, .001)
        assertNull(w.forecast.single().precipitationProbabilityPct)
        assertNull(w.forecast.single().weatherCode)
    }
    @Test fun noNeonWhenValueOrJudgmentCannotBeTreatedAsCurrent() {
        val levels = mapOf("wind" to "danger")
        val s = state(levels)
        for (bad in listOf(s.copy(failed = true), s.copy(forbidden = true), s.copy(now = now.plusSeconds(300)),
            state(levels, mapOf("stale" to true)), state(levels, mapOf("persisted" to true)),
            state(levels, mapOf("fetchedAt" to "bad")), state(levels, mapOf("fetchedAt" to now.plusSeconds(1).toString())),
            state(levels, mapOf("ok" to false)))) assertNull(weatherMetricSignal(bad, "wind", 40.0))
        assertNull(weatherMetricSignal(s, "wind", null))
        assertNull(weatherMetricSignal(s, "wind", Double.NaN))
    }
}
