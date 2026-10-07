package com.vitalguard.field.ui.site

import com.vitalguard.field.R
import com.vitalguard.field.ui.theme.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.vitalguard.field.data.models.*
import java.time.Duration

@Composable
fun DetailPanel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    GlassCard(modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

@Composable
fun SiteDetailScreen(page: String, state: SiteSummaryState, onBack: () -> Unit, onRefresh: () -> Unit) {
    require(page in setOf("weather", "workers", "gas"))
    if (page == "weather") { WeatherDetailScreen(state, onBack, onRefresh); return }
    var workerFilter by rememberSaveable { mutableStateOf(WorkerFilter.all.name) }
    val title = when (page) { "weather" -> "기상 상세"; "workers" -> "작업자 목록"; else -> "가스 감지기 상세" }
    val data = state.data
    LazyColumn(Modifier.fillMaxSize().testTag("$page-detail-scroll"), contentPadding = PaddingValues(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    VgBackButton(Modifier.testTag("$page-back"), onClick = onBack)
                    Text(title, Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                }
                DetailPanel {
                    if (page == "gas" && !state.forbidden) GasReceipt(data?.gas?.lastSeenAt)
                    else Text(if (state.forbidden) "마지막 수신 정보 표시 불가 · 접근 권한 없음" else siteStatusReceipt(data?.fetchedAt))
                    if (state.loading) StateLabel(StateKind.loading, "갱신 중")
                    if (state.stale && page != "gas") StateLabel(StateKind.stale, "오래된 자료 · 5분 이상 경과")
                    if (state.forbidden) StateLabel(StateKind.locked, "접근 권한 없음")
                    else if (state.failed) StateLabel(StateKind.failed, "수신 실패")
                    ActionIconButton(R.drawable.ic_refresh, "새로고침", onRefresh, Modifier.testTag("$page-refresh"), enabled = !state.loading, busy = state.loading)
                }
            }
        }
        if (state.forbidden) return@LazyColumn
        val section = when (page) { "weather" -> data?.weather; "workers" -> data?.workers; else -> data?.gas }
        if (section == null) { item { Text("$title 미수신") }; return@LazyColumn }
        if (!section.ok) { item { Text("$title 수신 실패") }; return@LazyColumn }
        if (page == "weather") item { DetailPanel { Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { SignalMark(section.level); Text(section.summary ?: "요약 데이터 없음") } } }
        when (page) {
            "workers" -> workersRows(data!!.workers, WorkerFilter.valueOf(workerFilter)) { workerFilter = it.name }
            "gas" -> gasRows(data!!.gas, state)
        }
    }
}

private fun LazyListScope.workersRows(data: SiteStatusWorkers, filter: WorkerFilter, onFilter: (WorkerFilter) -> Unit) {
    val rows = data.items.filter(filter::matches)
    item { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(when (data.piiRedacted) { true -> "위치 가림"; false -> "위치 표시"; null -> "위치 미확인" })
        for (group in WorkerFilter.entries.chunked(3)) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (candidate in group) FilterChip(filter == candidate, { onFilter(candidate) },
                label = { Text("${candidate.label} ${candidate.count(data)?.let { "${it}명" } ?: "데이터 없음"}") },
                modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("workers-filter-${candidate.name}"))
        }
        when {
            !data.itemsAvailable -> Text("작업자 목록 미수신")
            data.items.isEmpty() && data.omittedItems > 0 -> Text("작업자 정보 확인 필요")
            data.items.isEmpty() && (data.total ?: 0) > 0 -> Text("작업자 목록 미수신")
            data.items.isEmpty() -> Text("작업자 0명")
            else -> Text("${rows.size}명")
        }
        if (data.omittedItems > 0) Text("식별 정보가 없거나 중복된 작업자 ${data.omittedItems}건은 표시하지 못했습니다")
    } }
    items(rows, key = { it.workerId }) { row -> DetailPanel(Modifier.testTag("worker-card-${row.workerId}")) {
        val label = if (row.tone == "idle") "미수신" else row.label ?: "상태 데이터 없음"
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { SignalMark(if (row.tone == "caution") "warn" else row.tone); Text("${row.name ?: row.workerId} · $label", style = MaterialTheme.typography.titleLarge) }
        Text("직급 ${row.jobTitle ?: "데이터 없음"} · ID ${row.workerId}")
        Text(when (row.worn) { true -> "착용 중"; false -> "미착용"; null -> "착용 여부 데이터 없음" })
        if (row.stale == true) StateLabel(StateKind.offline, "연결 끊김 · 생체값 표시 보류")
        else {
            Text("심박 ${metricValue(row.heartRate, "bpm", 0)} · 산소포화도 ${metricValue(row.spo2, "%", 0)}")
            Text("피부체온 ${metricValue(row.skinTempC, "℃")} · 심부체온 추정 ${metricValue(row.coreTempC, "℃")}")
        }
        if (row.stale == null) Text("연결 상태 데이터 없음")
        row.staleLabel?.let { Text(it) }
        Text("마지막 측정 ${alertTime(row.lastSeenAt)}")
        Text(row.ageSec?.let { "수신 당시 ${it}초 경과" } ?: "수신 당시 경과 시간 데이터 없음")
        Text(workerLocation(row, data.piiRedacted), Modifier.testTag("worker-location-${row.workerId}"))
    } }
}

private fun LazyListScope.gasRows(data: SiteStatusGas, state: SiteSummaryState) {
    if (!data.gasesAvailable || data.omittedGases > 0) item { DetailPanel {
        if (!data.gasesAvailable) Text("가스별 데이터 없음 · 목록을 받지 못했습니다")
        if (data.omittedGases > 0) Text("종류 식별이 안 되거나 중복된 가스 ${data.omittedGases}건은 표시하지 못했습니다")
    } }
    items(listOf("o2", "co", "h2s")) { key ->
        val gas = data.gases.firstOrNull { it.key == key }
        val waiting = data.level == "idle" || gas?.level == "idle"
        val fresh = parseInstantOrNull(data.lastSeenAt)?.let { Duration.between(it, state.now).seconds < 300 } == true
        SignalPanel(Modifier.testTag("gas-$key"),
            signalForLevel(gas?.level.takeUnless { waiting || gas?.value == null }, fresh && !state.stale && !state.failed && gas?.unit != null)) {
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                GasCloudSymbol(key)
                Text(compactGasValue(gas, waiting), Modifier.weight(1f).testTag("gas-value-$key"), style = MaterialTheme.typography.headlineSmall)
            }
        }
    }
}
