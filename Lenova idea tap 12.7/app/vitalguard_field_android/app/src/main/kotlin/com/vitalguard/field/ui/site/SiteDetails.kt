package com.vitalguard.field.ui.site

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
    var workerFilter by rememberSaveable { mutableStateOf(WorkerFilter.all.name) }
    val title = when (page) { "weather" -> "기상 상세"; "workers" -> "작업자 목록"; "gas" -> "가스 감지기 상세"; else -> "AED 상세" }
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
                    Text(if (state.forbidden) "마지막 수신 정보 표시 불가 · 접근 권한 없음" else siteStatusReceipt(data?.fetchedAt))
                    if (state.loading) StateLabel(StateKind.loading, "갱신 중 · 이전 자료 표시")
                    if (state.stale) StateLabel(StateKind.stale, "오래된 자료 · 5분 이상 경과")
                    if (state.forbidden) StateNotice(StateKind.locked, "접근 권한 없음", siteForbiddenMessage)
                    else if (state.failed) StateNotice(StateKind.failed, "수신 실패", "이전에 받은 자료를 표시합니다.")
                    Button(onRefresh, Modifier.heightIn(min = 64.dp).testTag("$page-refresh"), enabled = !state.loading) { Text("새로고침") }
                }
            }
        }
        if (state.forbidden) return@LazyColumn
        val section = when (page) { "weather" -> data?.weather; "workers" -> data?.workers; "gas" -> data?.gas; else -> data?.aed }
        if (section == null) { item { Text("$title 데이터 없음 · 아직 받지 못했습니다") }; return@LazyColumn }
        if (!section.ok) { item { Text("$title 수신 실패 · 상태를 확인할 수 없습니다. 새로고침해 주세요.") }; return@LazyColumn }
        item { DetailPanel { Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { SignalMark(section.level); Text(section.summary ?: "요약 데이터 없음") } } }
        when (page) {
            "weather" -> weatherRows(data!!.weather)
            "workers" -> workersRows(data!!.workers, WorkerFilter.valueOf(workerFilter)) { workerFilter = it.name }
            "gas" -> gasRows(data!!.gas, state)
            "aed" -> aedRows(data!!.aed)
        }
    }
}

private fun LazyListScope.weatherRows(data: SiteStatusWeather) {
    val current = data.current
    item { DetailPanel {
        Text(when (data.cached) { true -> "캐시에서 받은 기상 값"; false -> "캐시를 사용하지 않은 기상 응답"; null -> "기상 캐시 여부 데이터 없음" })
        Text(when (data.stale) { true -> "오래된 기상 값 · 이전 수신 값입니다"; false -> "서버 오래됨 표시 없음 · 수신 시각을 함께 확인해 주세요"; null -> "기상 자료의 오래됨 여부 미확인" })
        if (data.persisted == true) Text("저장된 기상 자료로 대체한 값입니다")
        Text("현장 기준 좌표 · 위도 ${data.lat ?: "데이터 없음"} · 경도 ${data.lon ?: "데이터 없음"}")
        Text("담당관의 현재 위치가 아닌 현장에 저장된 좌표의 기상입니다")
        Text("좌표 출처 ${data.coordSource ?: "데이터 없음"} · 기상 출처 ${data.source ?: "데이터 없음"}")
        Text("기상 마지막 수신 ${alertTime(data.fetchedAt)}")
        data.headlineBasis?.let { Text("대표 판정 근거 · $it") }
        Text("판정은 서버가 보낸 상태입니다. 함께 적용된 모든 판정은 확인할 수 없습니다")
    } }
    item { Text("현재 기상 · 마지막 수신 값", style = MaterialTheme.typography.titleLarge)
        Text("관측 출처 ${current?.obsSource ?: "데이터 없음"} · ${alertTime(current?.obsAt)}") }
    val wind = current?.windGustKmh ?: current?.windKmh
    val rows = listOf(
        Triple("기온", current?.temperatureC, "℃"), Triple("습도", current?.humidityPct, "%"),
        Triple("체감온도", current?.apparentTempC, "℃"), Triple("풍속", wind?.div(3.6), "m/s"),
        Triple("강수량", current?.precipitationMm, "mm/h"), Triple("자외선지수", current?.uvIndex, ""),
        Triple("미세먼지 PM10", current?.pm10, "μg/㎥"), Triple("미세먼지 PM2.5", current?.pm25, "μg/㎥"),
        Triple("WBGT", current?.wbgt, "℃"),
    )
    items(rows) { (name, value, unit) -> DetailPanel {
        Text("$name ${metricValue(value, unit, if (name in listOf("습도", "미세먼지 PM10", "미세먼지 PM2.5")) 0 else 1)}",
            style = MaterialTheme.typography.titleLarge)
        if (name == "풍속") Text(if (current?.windGustKmh != null) "순간풍속 기준 · 평균 ${metricValue(current.windKmh?.div(3.6), "m/s")}" else "평균풍속 기준 · 순간풍속 미수신")
        if (name == "WBGT") Text("습구흑구 (참고)")
    } }
    val warning = data.warning
    item { Text("특보 지역 ${warning?.sido ?: "데이터 없음"} · 출처 ${warning?.source ?: "데이터 없음"}") }
    for (preliminary in listOf(false, true)) {
        val title = if (preliminary) "예비특보" else "발효특보"
        val available = if (preliminary) warning?.preliminaryAvailable else warning?.warningsAvailable
        val rowsForKind = if (preliminary) warning?.preliminary.orEmpty() else warning?.warnings.orEmpty()
        val omitted = if (preliminary) warning?.omittedPreliminary else warning?.omittedWarnings
        item { Text(title, style = MaterialTheme.typography.titleLarge)
            Text((if (preliminary) warning?.preliminarySummary else warning?.summary) ?: "$title 요약 데이터 없음")
            if (available != true) Text("$title 데이터 없음 · 목록을 받지 못했습니다")
            else if (rowsForKind.isEmpty() && omitted == 0) Text("$title 0건 · 수신한 목록이 비어 있습니다")
            if ((omitted ?: 0) > 0) Text("$title ${omitted}건의 내용을 확인할 수 없습니다") }
        items(rowsForKind) { row -> DetailPanel {
            Text("${row.type} · ${if (preliminary) row.`when` ?: "예상 시각 데이터 없음" else row.level ?: "단계 데이터 없음"}", fontWeight = FontWeight.Bold)
            Text(row.regions.takeIf { it.isNotEmpty() }?.joinToString(" · ") ?: "지역 데이터 없음")
            if ((row.otherRegionCount ?: 0) > 0) Text("그 밖의 지역 ${row.otherRegionCount}곳 (서버 집계)")
        } }
    }
}

private fun LazyListScope.workersRows(data: SiteStatusWorkers, filter: WorkerFilter, onFilter: (WorkerFilter) -> Unit) {
    val rows = data.items.filter(filter::matches)
    item { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(when (data.piiRedacted) { true -> "위치 가림 · 개인정보 보호 설정 적용"; false -> "위치 표시 허용 · 수신된 좌표를 표시합니다"; null -> "위치 표시 보류 · 가림 여부 미수신" })
        for (group in WorkerFilter.entries.chunked(3)) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (candidate in group) FilterChip(filter == candidate, { onFilter(candidate) },
                label = { Text("${candidate.label} ${candidate.count(data)?.let { "${it}명" } ?: "데이터 없음"}") },
                modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("workers-filter-${candidate.name}"))
        }
        Text("서버 집계 기준 · 끊김은 주의·위험과 겹칠 수 있습니다")
        when {
            !data.itemsAvailable -> Text("작업자 데이터 없음 · 개별 목록을 받지 못했습니다")
            data.items.isEmpty() && data.omittedItems > 0 -> Text("작업자 데이터 확인 불가 · 식별 정보를 확인해 주세요")
            data.items.isEmpty() && (data.total ?: 0) > 0 -> Text("작업자 데이터 없음 · 집계 인원에 해당하는 목록이 비어 있습니다")
            data.items.isEmpty() -> Text("작업자 0명 · 수신한 목록이 비어 있습니다")
            else -> Text("수신 목록 필터 결과 ${rows.size}명")
        }
        if (data.omittedItems > 0) Text("식별 정보가 없거나 중복된 작업자 ${data.omittedItems}건은 표시하지 못했습니다")
    } }
    items(rows, key = { it.workerId }) { row -> DetailPanel(Modifier.testTag("worker-card-${row.workerId}")) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { SignalMark(if (row.tone == "caution") "warn" else row.tone); Text("${row.name ?: row.workerId} · ${row.label ?: "상태 데이터 없음"}", style = MaterialTheme.typography.titleLarge) }
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
    item { DetailPanel {
        Text("값 옆의 서버 단위를 확인해 주세요. 판정은 서버가 보낸 상태입니다")
        Text("감지기 ID ${data.deviceId ?: "데이터 없음"}")
        Text("감지기 마지막 수신 ${alertTime(data.lastSeenAt)}")
        Text("전원 상태 ${data.power ?: "데이터 없음"}")
        if (data.lastSeenAt?.let { Duration.between(parseInstant(it), state.now).seconds >= 300 } == true)
            Text("감지기 수신 오래됨 · 아래는 이전 수신 값입니다")
        if (!data.gasesAvailable) Text("가스별 데이터 없음 · 목록을 받지 못했습니다")
        if (data.omittedGases > 0) Text("종류 식별이 안 되거나 중복된 가스 ${data.omittedGases}건은 표시하지 못했습니다")
    } }
    items(listOf("o2" to "O₂ 산소", "co" to "CO 일산화탄소", "h2s" to "H₂S 황화수소")) { (key, name) ->
        val gas = data.gases.firstOrNull { it.key == key }
        val waiting = data.level == "idle" || gas?.level == "idle"
        DetailPanel(Modifier.testTag("gas-$key")) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { SignalMark(if (waiting) "idle" else gas?.level); Text(gas?.gas ?: name, style = MaterialTheme.typography.titleLarge) }
            Text(gasMeasurement(gas, waiting), Modifier.testTag("gas-value-$key"), style = MaterialTheme.typography.headlineSmall)
            Text("위치 ${gas?.loc ?: "데이터 없음"}")
        }
    }
}

private fun LazyListScope.aedRows(data: SiteStatusAed) {
    item {
        Text("장비 수 ${data.total?.toString() ?: "데이터 없음"}")
        Text("교환까지 남은 일수는 서버가 보낸 값입니다. 점검 예정일은 제공되지 않았습니다")
        when {
            !data.devicesAvailable -> Text("AED 기기 데이터 없음 · 목록을 받지 못했습니다")
            data.devices.isEmpty() && data.omittedDevices > 0 -> Text("AED 기기 데이터 확인 불가 · 식별 정보를 확인해 주세요")
            data.devices.isEmpty() && data.total == 0 -> Text("등록된 AED 0대 · 수신한 기기 목록이 비어 있습니다")
            data.devices.isEmpty() -> Text("AED 기기 데이터 없음 · 등록 수에 해당하는 목록을 확인할 수 없습니다")
        }
        if (data.omittedDevices > 0) Text("식별 정보가 없거나 중복된 AED ${data.omittedDevices}건은 표시하지 못했습니다")
    }
    items(data.devices, key = { it.deviceId }) { device -> DetailPanel(Modifier.testTag("aed-${device.deviceId}")) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { SignalMark(device.level); Text(device.loc ?: "위치 데이터 없음", style = MaterialTheme.typography.titleLarge) }
        Text("기기 ID ${device.deviceId}")
        device.summary?.let { Text(it) }
        Text("배터리 교환 ${aedDueText(device.batteryDueDays)}")
        Text("전극패드 교환 ${aedDueText(device.padsDueDays)}")
    } }
}
