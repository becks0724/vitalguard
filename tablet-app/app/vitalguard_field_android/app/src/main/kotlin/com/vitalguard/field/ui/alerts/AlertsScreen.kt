package com.vitalguard.field.ui.alerts

import com.vitalguard.field.R
import com.vitalguard.field.ui.theme.*
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.data.alerts.*
import com.vitalguard.field.data.models.*
import java.time.Duration

fun alertScope(scoped: Boolean?) = when (scoped) {
    true -> "이 현장 기준"
    false -> "전체 현장 기준"
    null -> "경보 집계 범위 확인 불가"
}

@Composable
fun AlertsScreen(controller: AlertsController, isMock: Boolean) {
    val state by controller.state.collectAsStateWithLifecycle()
    AlertsContent(state, isMock, controller::select, { controller.refresh(true) }, controller::acknowledge, controller::canAck, controller::acknowledgeVisible)
}

@Composable
fun AlertsContent(state: AlertsState, isMock: Boolean = false, onSelect: (AlertItem?) -> Unit = {},
    onRefresh: () -> Unit = {}, onAcknowledge: (AlertItem) -> Unit = {}, canAck: (AlertItem) -> Boolean = { false }, onAcknowledgeVisible: (List<AlertItem>) -> Unit = {}) {
    var acknowledged by rememberSaveable { mutableStateOf(false) }
    var type by rememberSaveable { mutableStateOf<String?>(null) }
    var filterOpen by remember { mutableStateOf(false) }
    var draftAcknowledged by remember { mutableStateOf(false) }
    var draftType by remember { mutableStateOf<String?>(null) }
    val selected = state.selected
    BackHandler(selected != null) { onSelect(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)
        .testTag(if (selected == null) "alerts-list-scroll" else "alerts-detail-scroll"),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (selected != null) VgBackButton(Modifier.testTag("alerts-back"), onClick = { onSelect(null) })
            Text(if (selected == null) "경보 목록" else "경보 상세", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
            ActionIconButton(R.drawable.ic_refresh, "새로고침", onRefresh,
                Modifier.testTag("alerts-refresh").semantics { if (state.loading) stateDescription = "갱신 중" },
                enabled = state.authorized && !state.loading && !state.sending && !state.batchRunning, size = 56.dp, busy = state.loading)
        }
        Text(alertScope(state.data?.alerts?.siteScoped), Modifier.testTag("alerts-scope"))
        Text(if (!state.authorized || state.forbidden) "마지막 수신 정보 표시 불가 · 접근 권한 없음"
            else siteStatusReceipt(state.data?.fetchedAt))
        if (state.offline) StateLabel(StateKind.offline, "오프라인")
        if (state.data?.let { Duration.between(parseInstant(it.fetchedAt), state.now).seconds >= 300 } == true)
            Text("오래된 자료")
        if (state.loading) StateLabel(StateKind.loading, "서버 상태 조회 중")
        if (state.readFailed) StateLabel(StateKind.failed, "경보 수신 실패", Modifier.testTag("alerts-read-error"))
        if (!state.authorized || state.forbidden) {
            Text("접근 권한 없음", Modifier.testTag("alerts-forbidden"))
        } else if (selected == null) {
            Box {
                OutlinedButton({ draftAcknowledged = acknowledged; draftType = type; filterOpen = true },
                    Modifier.heightIn(min = 56.dp).testTag("alerts-filter-open"), shape = RoundedCornerShape(28.dp)) {
                    VgIcon(R.drawable.ic_filter); Spacer(Modifier.width(8.dp)); Text("조회 필터")
                }
                DropdownMenu(filterOpen, { filterOpen = false },
                    modifier = Modifier.width((LocalConfiguration.current.screenWidthDp - 48).coerceAtMost(560).dp),
                    shape = RoundedCornerShape(24.dp), containerColor = DashboardColors.sidebar) {
                    AlertFilterPanel(draftAcknowledged, draftType, { draftAcknowledged = it }, { draftType = it },
                        onReset = { draftAcknowledged = false; draftType = null },
                        onApply = { acknowledged = draftAcknowledged; type = draftType; filterOpen = false },
                        onClose = { filterOpen = false })
                }
            }
            val rows = state.items.filter { it.acknowledged == acknowledged && (type == null || it.type.name == type) }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("${if (acknowledged) "대응완료" else "미대응"} · ${AlertType.entries.firstOrNull { it.name == type }?.label ?: "전체 종류"} · ${rows.size}건",
                    Modifier.weight(1f).testTag("alerts-filter-summary"))
                if (!acknowledged) ActionIconButton(R.drawable.ic_check,
                    if (state.batchRunning) "대응 처리 중 ${state.batchDone}/${state.batchTotal}" else "현재 목록의 미대응 ${rows.size}건 대응 확인",
                    { onAcknowledgeVisible(rows) }, Modifier.testTag("alerts-ack-visible"), size = 56.dp, tint = SignalColors.normal,
                    enabled = rows.isNotEmpty() && rows.all(canAck) && !state.batchRunning, busy = state.batchRunning)
            }
            state.batchError?.let { StateNotice(StateKind.failed, "대응 결과 확인 필요", it, Modifier.testTag("alerts-batch-error")) }
            if (state.data == null || state.data?.alerts?.itemsAvailable != true) Text("경보 목록 미수신")
            else if (rows.isEmpty()) Text("선택한 조건의 경보 없음")
            if ((state.data?.alerts?.omittedItems ?: 0) > 0) Text("식별 정보가 없거나 중복된 경보 ${state.data!!.alerts.omittedItems}건은 표시하지 못했습니다")
            rows.forEach { row ->
                GlassCard(Modifier.fillMaxWidth().testTag("alert-row-${row.id}").clickable { onSelect(row) }) {
                    Column(Modifier.padding(16.dp).heightIn(min = 72.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${row.type.label} · ${row.workerName ?: row.workerId ?: "작업자 정보 없음"}", fontWeight = FontWeight.Bold)
                        Text(alertTime(row.ts ?: row.createdAt))
                        StateLabel(if (row.acknowledged) StateKind.ready else StateKind.warning, if (row.acknowledged) "대응완료 · 처리자 ${row.ackBy ?: "정보 없음"}" else "미대응")
                    }
                }
            }
        } else {
            val current = state.items.firstOrNull { it.id == selected.id }
            val same = current?.sameOccurrence(selected) == true
            val row = if (same) current!! else selected
            Text("${row.type.label} · ${row.workerName ?: row.workerId ?: "작업자 정보 없음"}", style = MaterialTheme.typography.titleLarge)
            Text("대상 ID · ${row.workerId ?: "정보 없음"}")
            Text("발생 시각 · ${alertTime(row.ts)}")
            Text("서버 기록 시각 · ${alertTime(row.createdAt)}")
            if (row.acknowledged) {
                Text("대응 확인 시각 · ${alertTime(row.ackAt)}")
                Text("처리자 · ${row.ackBy ?: "정보 없음"}", Modifier.testTag("alert-ack-by"))
            }
            if (current == null) Text("경보 상태 확인 필요", Modifier.testTag("alert-missing"))
            else if (!same) Text("경보 정보 변경됨 · 다시 선택")
            else if (row.id in state.reopened) Text("다시 열린 경보")
            else if (row.acknowledged) Text("대응 확인됨")
            val phase = state.phase(row.id)
            val message = when (phase) {
                AlertWritePhase.idle -> null
                AlertWritePhase.sending -> "처리 중 · 서버 응답을 기다리고 있습니다"
                AlertWritePhase.confirmed -> if (isMock) "모의 대응 확인됨 · 실제 서버로 보내지 않았습니다" else "서버 확인됨 · 대응 확인이 반영되었습니다"
                AlertWritePhase.conflict -> "충돌 · 다른 관리자가 이미 처리함. 서버 목록에서 처리자를 확인합니다."
                AlertWritePhase.failed -> "실패 · ${state.failures[row.id] ?: "요청이 거부되었습니다"} 자동으로 다시 보내지 않습니다."
                AlertWritePhase.uncertain -> "결과 불명 · 서버 상태 재조회가 우선입니다. 자동으로 다시 보내지 않습니다."
                AlertWritePhase.retryReady -> "서버 재조회됨 · 미대응 상태입니다. 대상과 시각을 다시 확인한 뒤 직접 눌러 주세요."
            }
            message?.let { Text(it, Modifier.testTag("alert-write-${phase.name}"), fontWeight = FontWeight.Bold) }
            if (same && !row.acknowledged && phase in setOf(AlertWritePhase.confirmed, AlertWritePhase.conflict))
                Text("서버 상태 재조회 필요")
            if (row.workerId == null || row.ts == null) Text("대상·발생 시각 정보 없음")
            ActionIconButton(R.drawable.ic_check,
                if (state.offline) "연결 후 가능" else if (phase == AlertWritePhase.sending) "처리 중" else "대응 확인",
                { onAcknowledge(selected) }, Modifier.testTag("alert-ack"), enabled = canAck(selected), tint = SignalColors.normal, busy = phase == AlertWritePhase.sending)
        }
    }
}

/** The shell bounds its height; an absent strip releases idle record space. No timer or POST here. */
@Composable
fun GlobalAlertStrip(controller: AlertsController, deferred: Boolean, onOpen: (AlertItem) -> Unit) {
    val s by controller.state.collectAsStateWithLifecycle()
    val row = s.pending.firstOrNull()?.takeIf { s.authorized && !s.forbidden && !deferred } ?: return
    GlassCard(Modifier.fillMaxWidth().padding(8.dp).testTag("global-alert-strip")) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
            StateIcon(StateKind.warning, Modifier.padding(12.dp).size(24.dp))
            Column(Modifier.weight(1f).fillMaxHeight().clickable { onOpen(row) }.padding(8.dp)
                .verticalScroll(rememberScrollState()).testTag("global-alert-open"), verticalArrangement = Arrangement.Center) {
                Text("${row.type.label} · 미대응 (수신 기준)", fontWeight = FontWeight.Bold)
                Text("${row.workerName ?: row.workerId ?: "작업자 정보 없음"} · 상세 보기")
            }
            ActionIconButton(R.drawable.ic_close, "닫기", { controller.dismiss(row) }, Modifier.testTag("global-alert-dismiss"), size = 56.dp, visualScale = .78f)
        }
    }
}
