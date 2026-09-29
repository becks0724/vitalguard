package com.vitalguard.field.ui.site

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vitalguard.field.R
import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.theme.*
import java.time.Duration
import java.util.Locale

fun dashboardColumns(contentWidthDp: Float, fontScale: Float): Int {
    val readable = (contentWidthDp - 48f) / fontScale.coerceAtLeast(1f)
    return when { readable >= 960f -> 3; readable >= 570f -> 2; else -> 1 }
}

@Composable
fun GlassDashboard(state: SiteSummaryState, onRefresh: () -> Unit, onDetail: (String) -> Unit,
    onCctv: (String) -> Unit, onAlerts: () -> Unit) {
    DashboardTheme {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val columns = dashboardColumns(maxWidth.value, LocalDensity.current.fontScale)
            val weather: @Composable () -> Unit = { WeatherTile(state) { onDetail("weather") } }
            val workers: @Composable () -> Unit = { WorkersTile(state) { onDetail("workers") } }
            val gas: @Composable () -> Unit = { GasTile(state) { onDetail("gas") } }
            val aed: @Composable () -> Unit = { AedAlertCard() }
            val alerts: @Composable () -> Unit = { AlertsTile(state, onAlerts) }
            val cctv: @Composable () -> Unit = { CctvTile(onCctv) }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).testTag("site-summary-scroll")
                .padding(horizontal = 24.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                DashboardHeading(state, columns == 1, onRefresh)
                if ((state.loading && state.data == null) || state.stale || state.failed || state.forbidden) ReceptionNotice(state)
                Column(Modifier.fillMaxWidth().testTag("site-signals"), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    when (columns) {
                        3 -> Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) { weather(); aed() }
                            Column(Modifier.weight(1.13f), verticalArrangement = Arrangement.spacedBy(18.dp)) { workers(); gas() }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) { alerts(); cctv() }
                        }
                        2 -> Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) { weather(); gas(); aed() }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) { workers(); alerts(); cctv() }
                        }
                        else -> { alerts(); weather(); workers(); gas(); aed(); cctv() }
                    }
                }
            }
        }
    }
}

@Composable
private fun DashboardHeading(state: SiteSummaryState, compact: Boolean, onRefresh: () -> Unit) {
    val title: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("현장 대시보드", color = DashboardColors.text, style = MaterialTheme.typography.headlineLarge)
            Text(if (state.forbidden) "마지막 수신 정보 표시 불가 · 접근 권한 없음" else siteStatusReceipt(state.data?.fetchedAt),
                Modifier.testTag("site-receipt"), color = DashboardColors.secondary, style = MaterialTheme.typography.bodySmall)
        }
    }
    val refresh: @Composable () -> Unit = {
        OutlinedButton(onRefresh, Modifier.size(vgTapMin).testTag("site-refresh")
            .semantics { if (state.loading) stateDescription = "갱신 중" }, enabled = !state.loading,
            shape = CircleShape, contentPadding = PaddingValues(0.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = DashboardColors.text)) {
            VgIcon(R.drawable.ic_refresh, "새로고침", Modifier.size(24.dp))
        }
    }
    if (compact) Column(verticalArrangement = Arrangement.spacedBy(16.dp)) { title(); refresh() }
    else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { title() }; refresh()
    }
}

@Composable
private fun ReceptionNotice(state: SiteSummaryState) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.forbidden) {
                StateNotice(StateKind.locked, "접근 권한 없음", "관리자에게 역할·현장 배정을 확인해 주세요.", Modifier.testTag("site-forbidden"))
                Text("권한이 바뀌었으면 새로고침을 눌러 다시 조회합니다.", style = MaterialTheme.typography.bodySmall)
            } else if (state.failed) StateNotice(StateKind.failed, "수신 실패",
                if (state.data == null) "연결 후 새로고침해 주세요." else "이전에 받은 자료를 표시합니다.", Modifier.testTag("site-refresh-error"))
            else if (state.loading && state.data == null) StateNotice(StateKind.loading, "자료를 불러오는 중", "첫 수신을 기다리고 있습니다.")
            if (state.stale && !state.forbidden) StateLabel(StateKind.stale, "오래된 자료 · 5분 이상 경과", Modifier.testTag("site-stale"))
        }
}

@Composable
private fun TileHeading(title: String, icon: Int, opensDetail: Boolean = true) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        VgIcon(icon, modifier = Modifier.size(21.dp), tint = DashboardColors.secondary)
        Text(title, Modifier.weight(1f), fontSize = 19.sp, fontWeight = FontWeight.Medium)
        if (opensDetail) VgIcon(R.drawable.ic_chevron_right, modifier = Modifier.size(18.dp), tint = DashboardColors.secondary)
    }
}

private fun panelSignal(section: SiteStatusSection?, state: SiteSummaryState, oldSample: Boolean = false): PanelSignal {
    if (state.forbidden) return PanelSignal.locked
    if (section?.ok != true) return PanelSignal.unknown
    return signalForLevel(section.level, !state.stale && !state.failed && !oldSample)
}

@Composable
private fun Metric(value: String, unit: String = "", color: Color = DashboardColors.text, size: Int = 54) {
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(value, color = color, fontSize = size.sp, lineHeight = (size + 4).sp, fontWeight = FontWeight.Medium,
            letterSpacing = (-2).sp, style = MaterialTheme.typography.displayMedium.copy(fontFeatureSettings = "tnum"))
        if (unit.isNotEmpty()) Text(unit, Modifier.padding(bottom = 7.dp), color = DashboardColors.secondary, fontSize = 19.sp)
    }
}

@Composable
private fun TileSummary(id: String, title: String, section: SiteStatusSection?, forbidden: Boolean) {
    Text(if (forbidden) "$title  접근 권한 없음" else "$title  ${signalText(id, section)}", color = DashboardColors.secondary,
        style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun MiniMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(label, color = DashboardColors.secondary, fontSize = 12.sp)
        Text(value, color = DashboardColors.text, fontSize = 16.sp, fontWeight = FontWeight.Medium,
            style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = "tnum"))
    }
}

@Composable
private fun WeatherTile(state: SiteSummaryState, onClick: () -> Unit) {
    val data = state.data?.weather.takeUnless { state.forbidden }
    val current = data?.current.takeIf { data?.ok == true && data.level != "idle" }
    SignalPanel(Modifier.testTag("site-row-weather").heightIn(min = 300.dp), panelSignal(data, state, data?.stale == true), onClick, !state.forbidden) {
        TileHeading("기상", R.drawable.ic_weather)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Metric(current?.temperatureC?.let { String.format(Locale.ROOT, "%.1f", it) } ?: "—", "°C")
                Text("체감 ${metricValue(current?.apparentTempC, "°C")}", color = DashboardColors.secondary, fontSize = 13.sp)
            }
            VgIcon(R.drawable.ic_weather, modifier = Modifier.size(48.dp), tint = DashboardColors.text)
        }
        HorizontalDivider(color = DashboardColors.line)
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            MiniMetric("습도", metricValue(current?.humidityPct, "%", 0), Modifier.weight(1f))
            MiniMetric(if (current?.windGustKmh != null) "순간풍속" else "평균풍속",
                metricValue((current?.windGustKmh ?: current?.windKmh)?.div(3.6), "m/s"), Modifier.weight(1f))
        }
        if (data?.stale == true) Text("오래된 기상 값 · 이전 수신 값입니다", color = DashboardColors.text)
        TileSummary("weather", "기상", data, state.forbidden)
    }
}

@Composable
private fun WorkersTile(state: SiteSummaryState, onClick: () -> Unit) {
    val data = state.data?.workers.takeUnless { state.forbidden }
    val distribution = workerDistribution(data)
    val total = distribution.total
    val signal = panelSignal(data, state, !distribution.complete || total == 0)
    val colors = mapOf(WorkerBucket.normal to SignalColors.normal, WorkerBucket.caution to SignalColors.caution,
        WorkerBucket.danger to SignalColors.danger, WorkerBucket.waiting to SignalColors.waiting)
    SignalPanel(Modifier.testTag("site-row-workers"), signal, onClick, !state.forbidden) {
        TileHeading("작업자", R.drawable.ic_person)
        Box(Modifier.fillMaxWidth().heightIn(min = 164.dp).testTag("worker-distribution").semantics {
            stateDescription = distribution.shares.joinToString(" · ") {
                "${it.bucket.label} ${it.count}명 ${String.format(Locale.ROOT, "%.1f", it.fraction * 100)}%"
            }.ifEmpty { if (total == 0) "등록 인원 0명" else "인원 집계 미확인" }
        }, contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(148.dp).clearAndSetSemantics {}) {
                val stroke = 9.dp.toPx(); val inset = stroke / 2
                drawArc(DashboardColors.line, 135f, 270f, false, Offset(inset, inset), Size(size.width - stroke, size.height - stroke), style = Stroke(stroke, cap = StrokeCap.Round))
                var start = 135f
                for (share in distribution.shares) {
                    val sweep = 270f * share.fraction
                    drawArc(colors.getValue(share.bucket), start, sweep, false, Offset(inset, inset),
                        Size(size.width - stroke, size.height - stroke), style = Stroke(stroke, cap = StrokeCap.Butt))
                    start += sweep
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("전체 인원", color = DashboardColors.secondary, fontSize = 12.sp)
                Metric(total?.toString() ?: "—", "명", size = 44)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for ((bucket, count) in listOf(WorkerBucket.normal to data?.normal, WorkerBucket.caution to data?.caution, WorkerBucket.danger to data?.danger)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.size(7.dp).background(colors.getValue(bucket), CircleShape))
                        Text(bucket.label, color = DashboardColors.secondary, fontSize = 12.sp)
                    }
                    Text(count?.let { "${it}명" } ?: "—", fontSize = 16.sp, color = DashboardColors.text)
                }
            }
        }
        if ((data?.waiting ?: 0) > 0) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.size(7.dp).background(SignalColors.waiting, CircleShape))
            Text("미수신 ${data!!.waiting}명", Modifier.testTag("workers-unreceived"), color = DashboardColors.secondary, fontSize = 12.sp)
        }
        if (total != null && !distribution.complete) Text("집계 확인 필요", color = DashboardColors.secondary, fontSize = 12.sp)
    }
}

@Composable
private fun GasTile(state: SiteSummaryState, onClick: () -> Unit) {
    val data = state.data?.gas.takeUnless { state.forbidden }
    val readingsReady = data?.gasesAvailable == true && data.gases.size == 3 && data.gases.all { it.value != null && it.unit != null }
    val old = (parseInstantOrNull(data?.lastSeenAt)?.let { Duration.between(it, state.now).seconds >= 300 } ?: true) || !readingsReady
    SignalPanel(Modifier.testTag("site-row-gas"), panelSignal(data, state, old), onClick, !state.forbidden) {
        TileHeading("가스 감지기", R.drawable.ic_gas)
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val stacked = maxWidth.value / LocalDensity.current.fontScale.coerceAtLeast(1f) < 276f
            val reading: @Composable (String) -> Unit = { id ->
                val reading = data?.gases?.firstOrNull { it.key == id }
                Text(when {
                    state.forbidden -> "—"
                    data?.ok != true -> "미수신"
                    else -> compactGasValue(reading, data.level == "idle" || reading?.level == "idle")
                },
                    Modifier.testTag("dashboard-gas-$id"), color = DashboardColors.text, fontWeight = FontWeight.Medium, fontSize = 16.sp)
            }
            if (stacked) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (id in listOf("o2", "co", "h2s")) Row(Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    GasCloudSymbol(id); Box(Modifier.weight(1f)) { reading(id) }
                }
            } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (id in listOf("o2", "co", "h2s")) Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    GasCloudSymbol(id); reading(id)
                }
            }
        }
        GasReceipt(data?.lastSeenAt)
    }
}

@Composable
fun AedAlertCard() {
    // Existing `aed` payload is defibrillator maintenance, not this terminal's feedback.
    SignalPanel(Modifier.testTag("site-row-aed-alert"), PanelSignal.pending) {
        TileHeading("AED-alert", R.drawable.ic_aed_alert, opensDetail = false)
        Row(Modifier.fillMaxWidth().heightIn(min = 86.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            VgIcon(R.drawable.ic_aed_alert, modifier = Modifier.size(60.dp), tint = DashboardColors.secondary)
            Text("연동 대기", Modifier.testTag("aed-alert-pending"), style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun AlertsTile(state: SiteSummaryState, onClick: () -> Unit) {
    val data = state.data?.alerts.takeUnless { state.forbidden }
    GlassPanel(Modifier.testTag("site-alerts"), onClick, !state.forbidden) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            VgIcon(R.drawable.ic_alert, modifier = Modifier.size(21.dp)); Text("미대응 경보", Modifier.weight(1f), fontSize = 19.sp, fontWeight = FontWeight.Medium)
            VgIcon(R.drawable.ic_chevron_right, modifier = Modifier.size(18.dp))
        }
        Metric(data?.unacked?.toString() ?: "—", "건", if ((data?.unacked ?: 0) > 0) DashboardColors.warning else DashboardColors.text, 64)
        Text(if (state.forbidden) "접근 권한 없음" else alertsText(data), color = DashboardColors.secondary, fontSize = 13.sp)
        if (data?.ok == true) Text(when (data.siteScoped) {
            false -> "전체 현장 기준 · 이 현장만의 경보 수가 아닙니다"
            true -> "이 현장 기준"
            null -> "경보 집계 범위 확인 불가"
        }, color = DashboardColors.secondary, fontSize = 12.sp)
    }
}

@Composable
private fun CctvTile(onOpen: (String) -> Unit) {
    var picker by remember { mutableStateOf(false) }
    GlassPanel {
        Text("현장 CCTV", fontSize = 19.sp, fontWeight = FontWeight.Medium)
        Box(Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(16.dp)).background(Color.Black.copy(alpha = .16f)), contentAlignment = Alignment.Center) {
            Canvas(Modifier.matchParentSize().clearAndSetSemantics {}) {
                val line = DashboardColors.secondary.copy(alpha = .28f); val corner = 15.dp.toPx(); val inset = 14.dp.toPx()
                for ((x, y, dx, dy) in listOf(listOf(inset, inset, 1f, 1f), listOf(size.width-inset, inset, -1f, 1f),
                    listOf(inset, size.height-inset, 1f, -1f), listOf(size.width-inset, size.height-inset, -1f, -1f))) {
                    drawLine(line, Offset(x, y), Offset(x+corner*dx, y), 1.dp.toPx())
                    drawLine(line, Offset(x, y), Offset(x, y+corner*dy), 1.dp.toPx())
                }
            }
            VgIcon(R.drawable.ic_video, modifier = Modifier.size(38.dp), tint = DashboardColors.secondary)
        }
        Box {
        Button({ picker = true }, Modifier.fillMaxWidth().heightIn(min = vgTapMin).testTag("site-open-cctv"),
            colors = ButtonDefaults.buttonColors(containerColor = DashboardColors.accent, contentColor = DashboardColors.accentInk)) {
            Text("영상 보기", fontWeight = FontWeight.SemiBold); Spacer(Modifier.width(10.dp)); VgIcon(R.drawable.ic_chevron_right)
        }
        DropdownMenu(expanded = picker, onDismissRequest = { picker = false },
            modifier = Modifier.width(280.dp).testTag("cctv-picker"), shape = RoundedCornerShape(28.dp),
            containerColor = Color(0xEB777C80), tonalElevation = 0.dp, shadowElevation = 12.dp,
            border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = .22f))) {
            Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp)) {
                VgIcon(R.drawable.ic_cameras, modifier = Modifier.size(26.dp), tint = Color.White)
                Text("현장 CCTV", color = Color.White, style = MaterialTheme.typography.labelLarge)
            }
            com.vitalguard.field.data.cctv.CCTV_CAMERAS.forEach { camera ->
                HorizontalDivider(color = Color.White.copy(alpha = .18f))
                DropdownMenuItem(text = { Text(camera, color = Color.White) },
                    leadingIcon = { VgIcon(R.drawable.ic_video, tint = Color.White.copy(alpha = .85f)) },
                    onClick = { picker = false; onOpen(camera) }, modifier = Modifier.heightIn(min = 64.dp).testTag("cctv-picker-$camera"))
            }
        }
        }
    }
}
