package com.vitalguard.field

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.data.alerts.AlertsState
import com.vitalguard.field.data.cctv.CctvState
import com.vitalguard.field.data.mock.stage3SampleStatus
import com.vitalguard.field.ui.alerts.AlertsContent
import com.vitalguard.field.ui.cctv.CctvContent
import com.vitalguard.field.ui.site.*
import com.vitalguard.field.ui.theme.VgTheme
import java.time.Instant

private val fixed = Instant.parse("2026-09-27T06:00:00Z")
private val sample = stage3SampleStatus(fixed.toString())
private val site = SiteSummaryState(data = sample, now = fixed, receivedAt = fixed)

@PreviewTest @Preview(name = "Weather866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable fun WeatherStage3Preview() { GlassPreviewSurface { SiteDetailScreen("weather", site, {}, {}) } }
@PreviewTest @Preview(name = "Workers866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable fun WorkersStage3Preview() { GlassPreviewSurface { SiteDetailScreen("workers", site, {}, {}) } }
@PreviewTest @Preview(name = "Gas866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable fun GasStage3Preview() { GlassPreviewSurface { SiteDetailScreen("gas", site, {}, {}) } }
@PreviewTest @Preview(name = "Aed866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable fun AedStage3Preview() { GlassPreviewSurface { AedAlertCard() } }
@PreviewTest @Preview(name = "Alerts866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable fun AlertsStage3Preview() { GlassPreviewSurface { AlertsContent(AlertsState(data = sample, authorized = true, now = fixed), isMock = true) } }
@PreviewTest @Preview(name = "AlertDetail866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable fun AlertDetailStage3Preview() { GlassPreviewSurface { AlertsContent(AlertsState(data = sample, authorized = true, now = fixed, selected = sample.alerts.items.first()), isMock = true, canAck = { true }) } }
@PreviewTest @Preview(name = "CctvUnavailable866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable fun CctvStage3Preview() { GlassPreviewSurface { CctvContent(CctvState(active = true, error = "현장에서 카메라를 꺼 두었습니다", failures = 1, now = fixed)) } }

@PreviewTest @Preview(name = "AlertFilters", device = "spec:width=600dp,height=600dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun AlertFiltersPreview() { GlassPreviewSurface { com.vitalguard.field.ui.alerts.AlertFilterPanel(false, null, {}, {}, {}, {}, {}) } }

@PreviewTest @Preview(name = "AlertFiltersCompact", device = "spec:width=440dp,height=640dp,dpi=160", locale = "ko", fontScale = 2f, showBackground = true)
@Composable fun AlertFiltersCompactPreview() { GlassPreviewSurface { com.vitalguard.field.ui.alerts.AlertFilterPanel(false, null, {}, {}, {}, {}, {}) } }

@PreviewTest @Preview(name = "WeatherLandscape", device = "spec:width=1150dp,height=740dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun WeatherLandscapePreview() { GlassPreviewSurface { SiteDetailScreen("weather", site, {}, {}) } }
@PreviewTest @Preview(name = "WeatherCompactLargeText", device = "spec:width=460dp,height=950dp,dpi=160", locale = "ko", fontScale = 2f, showBackground = true)
@Composable fun WeatherCompactLargeTextPreview() { GlassPreviewSurface { SiteDetailScreen("weather", site, {}, {}) } }

@PreviewTest @Preview(name = "WeatherMetricNeon", device = "spec:width=1150dp,height=740dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun WeatherMetricNeonPreview() {
    val data = com.vitalguard.field.data.models.SiteStatus(mapOf("ok" to true, "fetchedAt" to fixed.toString(),
        "weather" to mapOf("ok" to true, "level" to "danger", "summary" to "체감온도 위험 · 모의 자료", "stale" to false, "fetchedAt" to fixed.toString(),
            "metricLevels" to mapOf("apparent" to "danger", "wind" to "warn", "rain" to "normal", "uv" to "normal", "pm25" to "warn"),
            "current" to mapOf("temperatureC" to 31.0, "humidityPct" to 68, "apparentTempC" to 33.5, "windKmh" to 18, "windGustKmh" to 36,
                "precipitationMm" to 0, "uvIndex" to 3.2, "pm10" to 44, "pm25" to 42, "wbgt" to 29.0, "obsSource" to "모의 관측", "obsAt" to fixed.toString()))))
    GlassPreviewSurface { SiteDetailScreen("weather", SiteSummaryState(data = data, now = fixed), {}, {}) }
}
