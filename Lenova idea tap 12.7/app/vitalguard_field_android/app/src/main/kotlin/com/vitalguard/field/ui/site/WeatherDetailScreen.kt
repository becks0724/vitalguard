package com.vitalguard.field.ui.site

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
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
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val effectiveWidth = (maxWidth.value - 48) / LocalDensity.current.fontScale
        val columns = if (effectiveWidth >= 840) 4 else if (effectiveWidth >= 630) 3 else if (effectiveWidth >= 410) 2 else 1
        LazyColumn(Modifier.fillMaxSize().testTag("weather-detail-scroll"), contentPadding = PaddingValues(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    VgBackButton(Modifier.testTag("weather-back"), onClick = onBack)
                    Text("기상 상세", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
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
                                SignalMark(weather.level)
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

@Composable
private fun WeatherMetricCard(metric: WeatherMetric, modifier: Modifier) {
    GlassCard(modifier.heightIn(min = 166.dp).testTag("weather-metric-${metric.id}")) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                VgIcon(metric.icon, modifier = Modifier.size(38.dp))
                Text("(${metric.label})", style = MaterialTheme.typography.labelMedium, color = DashboardColors.secondary)
            }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (metric.value == null) "—" else metricValue(metric.value, "", metric.digits),
                    style = MaterialTheme.typography.headlineLarge.copy(fontSize = 34.sp), fontWeight = FontWeight.SemiBold)
                Text(metric.unit, Modifier.padding(bottom = 4.dp), style = MaterialTheme.typography.bodySmall)
            }
            metric.note?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = DashboardColors.secondary) }
        }
    }
}
