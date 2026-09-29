package com.vitalguard.field

import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class WeatherForecastGatewayTest {
    private val time = "2026-09-30T00:00:00Z"
    private val weather = mapOf("ok" to true, "level" to "normal", "lat" to 35.0, "lon" to 127.0, "stale" to false, "fetchedAt" to time)
    @Test fun legacyForecastUsesExistingPublicReadWithoutTokenAndCachesPerWeatherSnapshot() = runTest {
        var forecastReads = 0
        val gateway = LiveGateway(JsonTransport { method, path, token, _ ->
            assertEquals("GET", method)
            if (path == "/api/app/admin/site-status") ApiReply(200, mapOf("ok" to true, "fetchedAt" to time, "weather" to weather)) else {
                assertNull(token); assertEquals("/api/weather?lat=35.0&lon=127.0", path); forecastReads++
                ApiReply(200, mapOf("ok" to true, "daily7" to mapOf("time" to listOf("2026-09-30"), "weatherCode" to listOf(61),
                    "tMax" to listOf(21), "tMin" to listOf(15), "precipProbMax" to listOf(null))))
            }
        })
        val status = gateway.siteStatus("fixture-token")
        assertEquals(21.0, status.weather.forecast.single().highC!!, .01)
        assertNull(status.weather.forecast.single().precipitationProbabilityPct)
        gateway.siteStatus("fixture-token")
        assertEquals(1, forecastReads)
    }
    @Test fun missingForecastOrFailureNeverBreaksSiteDataOrChangesItsStatus() = runTest {
        for (extra in listOf(emptyMap(), mapOf("forecast" to emptyList<Any>()), mapOf("stale" to true))) {
            var reads = 0
            val gateway = LiveGateway(JsonTransport { _, path, _, _ ->
                if (path == "/api/app/admin/site-status") ApiReply(200, mapOf("ok" to true, "fetchedAt" to time, "weather" to weather + extra))
                else { reads++; ApiReply(503, mapOf("ok" to false)) }
            })
            val status = gateway.siteStatus("fixture-token")
            assertTrue(status.weather.ok); assertTrue(status.weather.forecast.isEmpty())
            assertEquals(if (extra.isEmpty()) 1 else 0, reads)
        }
    }
}
