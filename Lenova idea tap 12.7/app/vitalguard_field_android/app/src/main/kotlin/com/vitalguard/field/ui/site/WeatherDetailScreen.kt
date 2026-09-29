package com.vitalguard.field.ui.site

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vitalguard.field.R
import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.theme.*

private data class WeatherMetric(val id: String, val label: String, val icon: Int, val value: Double?, val unit: String,
    val digits: Int = 1, val note: String? = null)

@Composable
fun WeatherDetailScreen(state: SiteSummaryState, onBack: () -> Unit, onRefresh: () -> Unit) {
    val weather = state.data?.weather
    val current = weather?.current
    val metrics = listOf(
        WeatherMetric("temperature", "기온", R.drawable.ic_temperature, current?.temperatureC, "℃"),
        WeatherMetric("humidity", "습도", R.drawable.ic_humidity, current?.humidityPct, "%", 0),
        WeatherMetric("apparent", "체감온도", R.drawable.ic_apparent_temperature, current?.apparentTempC, "℃"),
        WeatherMetric("wind", "풍속", R.drawable.ic_wind, (current?.windGustKmh ?: current?.windKmh)?.div(3.6), "m/s",
            note = if (current?.windGustKmh != null) "순간 · 평균 ${metricValue(current.windKmh?.div(3.6), "m/s")}" else "평균"),
        WeatherMetric("rain", "강수량", R.drawable.ic_rain, current?.precipitationMm, "mm/h"),
        WeatherMetric("uv", "자외선", R.drawable.ic_sun, current?.uvIndex, ""),
        WeatherMetric("pm10", "미세먼지", R.drawable.ic_particles, current?.pm10, "μg/㎥", 0, "PM10"),
        WeatherMetric("pm25", "초미세먼지", R.drawable.ic_particles, current?.pm25, "μg/㎥", 0, "PM2.5"),
        WeatherMetric("wbgt", "습구흑구", R.drawable.ic_wbgt, current?.wbgt, "℃", note = "WBGT · 참고"),
    )
    val preview = LocalWeatherPreview.current
    Column(Modifier.fillMaxSize()) {
        preview.mode?.let { mode ->
            Surface(color = DashboardColors.sidebar, modifier = Modifier.fillMaxWidth().testTag("weather-preview-banner")) {
                Row(Modifier.padding(start = 24.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    VgIcon(mode.icon, modifier = Modifier.size(24.dp))
                    Text("효과 미리보기 · ${mode.label}", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    ActionIconButton(R.drawable.ic_close, "미리보기 종료", { preview.select(null) }, Modifier.testTag("weather-preview-close"), size = 56.dp)
                }
            }
        }
    BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
        val effectiveWidth = (maxWidth.value - 48) / LocalDensity.current.fontScale
        val columns = if (effectiveWidth >= 840) 4 else if (effectiveWidth >= 630) 3 else if (effectiveWidth >= 410) 2 else 1
        LazyColumn(Modifier.fillMaxSize().testTag("weather-detail-scroll"), contentPadding = PaddingValues(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    VgBackButton(Modifier.testTag("weather-back"), onClick = onBack)
                    Text("기상 상세", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                    WeatherPreviewPicker()
                    ActionIconButton(R.drawable.ic_refresh, "새로고침", onRefresh, Modifier.testTag("weather-refresh"), enabled = !state.loading, busy = state.loading)
                }
            }
            item {
                if (state.forbidden) StateLabel(StateKind.locked, "접근 권한 없음")
                else {
                    Text("마지막 수신 ${alertTime(weather?.fetchedAt ?: state.data?.fetchedAt)}", style = MaterialTheme.typography.bodySmall)
                    if (state.failed || weather?.ok == false) StateLabel(StateKind.failed, "수신 실패")
                    if (state.stale || weather?.stale == true) StateLabel(StateKind.stale, "오래된 자료")
                }
            }
            if (state.forbidden || weather?.ok != true) return@LazyColumn
            item {
                GlassCard(Modifier.fillMaxWidth().testTag("weather-current")) {
                    Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        VgIcon(when {
                            weather.effects.snow -> R.drawable.ic_snow
                            weather.effects.rain -> R.drawable.ic_rain
                            weather.effects.windDanger -> R.drawable.ic_wind
                            current?.weatherCode in setOf(0, 1) -> R.drawable.ic_sun
                            else -> R.drawable.ic_cloud
                        }, modifier = Modifier.size(64.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("현재 기상", style = MaterialTheme.typography.titleLarge)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                WeatherSignalDot(weather.level)
                                Text(weather.summary ?: "미수신", style = MaterialTheme.typography.bodyMedium)
                            }
                            Text(when (current?.obsSource) {
                                "kma-ncst" -> "기상청 · ${alertTime(current.obsAt)}"
                                "open-meteo" -> "오픈메테오 · ${alertTime(weather.fetchedAt)}"
                                else -> "${current?.obsSource ?: "관측"} · ${alertTime(current?.obsAt)}"
                            }, style = MaterialTheme.typography.bodySmall, color = DashboardColors.secondary)
                        }
                    }
                }
            }
            items(metrics.chunked(columns)) { group ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    group.forEach { metric -> WeatherMetricCard(metric, Modifier.weight(1f)) }
                    repeat(columns - group.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            val warning = weather.warning
            for (preliminary in listOf(false, true)) {
                val title = if (preliminary) "예비특보" else "발효특보"
                val available = if (preliminary) warning?.preliminaryAvailable else warning?.warningsAvailable
                val rows = if (preliminary) warning?.preliminary.orEmpty() else warning?.warnings.orEmpty()
                item {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        VgIcon(R.drawable.ic_alert, modifier = Modifier.size(24.dp))
                        Text(title, style = MaterialTheme.typography.titleMedium)
                        Text(if (available != true) "미수신" else if ((if (preliminary) warning?.omittedPreliminary else warning?.omittedWarnings ?: 0) != 0) "확인 필요" else if (rows.isEmpty()) "없음" else "${rows.size}건", style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.weight(1f))
                        if (!preliminary) warning?.sido?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                }
                items(rows) { row -> DetailPanel {
                    Text("${row.type} · ${if (preliminary) row.`when` ?: "시각 미수신" else row.level ?: "단계 미수신"}", fontWeight = FontWeight.Bold)
                    Text(row.regions.takeIf { it.isNotEmpty() }?.joinToString(" · ") ?: "지역 미수신")
                    if ((row.otherRegionCount ?: 0) > 0) Text("외 ${row.otherRegionCount}곳")
                } }
                val omitted = if (preliminary) warning?.omittedPreliminary else warning?.omittedWarnings
                if ((omitted ?: 0) > 0) item { StateLabel(StateKind.failed, "특보 ${omitted}건 표시 불가") }
            }
        }
    }
    }
}

@Composable
private fun WeatherMetricCard(metric: WeatherMetric, modifier: Modifier) {
    GlassCard(modifier.heightIn(min = 166.dp).testTag("weather-metric-${metric.id}")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally)) {
            VgIcon(metric.icon, modifier = Modifier.size(38.dp))
            Text("(${metric.label})", style = MaterialTheme.typography.labelMedium, color = DashboardColors.secondary)
        }
        HorizontalDivider(color = DashboardColors.line)
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
                Text(if (metric.value == null) "—" else metricValue(metric.value, "", metric.digits),
                    style = MaterialTheme.typography.headlineLarge.copy(fontSize = 34.sp), fontWeight = FontWeight.SemiBold)
                if (metric.unit.isNotEmpty()) Text(metric.unit, Modifier.padding(bottom = 4.dp), style = MaterialTheme.typography.bodySmall)
            }
            metric.note?.let { Text(it, Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                style = MaterialTheme.typography.labelSmall, color = DashboardColors.secondary) }
        }
    }
}

@Composable
private fun WeatherSignalDot(level: String?) {
    val (label, color) = when (level) {
        "normal" -> "정상" to SignalColors.normal
        "warn" -> "주의" to VgColors.warn
        "danger" -> "위험" to SignalColors.danger
        else -> "상태 미확인" to DashboardColors.muted.copy(alpha = .45f)
    }
    Box(Modifier.size(16.dp).background(color, CircleShape).testTag("weather-signal-dot")
        .clearAndSetSemantics { contentDescription = label })
}

@Composable
private fun WeatherPreviewPicker() {
    val preview = LocalWeatherPreview.current
    var open by remember { mutableStateOf(false) }
    Box {
        ActionIconButton(R.drawable.ic_eye, "기상 효과 미리보기", { open = !open }, Modifier.testTag("weather-preview-open"), size = 56.dp)
        DropdownMenu(open, { open = false }, containerColor = DashboardColors.sidebar) {
            WeatherPreviewMode.entries.forEach { mode ->
                DropdownMenuItem(text = { Text(mode.label) }, leadingIcon = { VgIcon(mode.icon) },
                    onClick = { preview.select(mode); open = false }, modifier = Modifier.heightIn(min = 56.dp).testTag("weather-preview-${mode.name}"))
            }
        }
    }
}
