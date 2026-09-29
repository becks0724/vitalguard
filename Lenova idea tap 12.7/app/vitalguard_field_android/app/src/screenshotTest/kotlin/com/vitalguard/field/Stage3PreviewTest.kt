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
private val site = SiteSummaryState(data = sample, now = fixed)

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
