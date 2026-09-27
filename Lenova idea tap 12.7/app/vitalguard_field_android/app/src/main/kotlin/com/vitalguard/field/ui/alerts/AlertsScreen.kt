package com.vitalguard.field.ui.alerts

import com.vitalguard.field.ui.theme.*
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.data.alerts.*
import com.vitalguard.field.data.models.*
import java.time.Duration

fun alertScope(scoped: Boolean?) = when (scoped) {
    true -> "이 현장 기준"
    false -> "전체 현장 기준 · 현장별로 한정되지 않은 경보입니다"
    null -> "경보 집계 범위 확인 불가"
}

@Composable
fun AlertsScreen(controller: AlertsController, isMock: Boolean) {
    val state by controller.state.collectAsStateWithLifecycle()
    AlertsContent(state, isMock, controller::select, { controller.refresh(true) }, controller::acknowledge, controller::canAck)
}

@Composable
fun AlertsContent(state: AlertsState, isMock: Boolean = false, onSelect: (AlertItem?) -> Unit = {},
    onRefresh: () -> Unit = {}, onAcknowledge: (AlertItem) -> Unit = {}, canAck: (AlertItem) -> Boolean = { false }) {
    var acknowledged by rememberSaveable { mutableStateOf(false) }
    var type by rememberSaveable { mutableStateOf<String?>(null) }
    val selected = state.selected
    BackHandler(selected != null) { onSelect(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)
        .testTag(if (selected == null) "alerts-list-scroll" else "alerts-detail-scroll"),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(if (selected == null) "경보 목록" else "경보 상세", style = MaterialTheme.typography.headlineSmall)
        Text(alertScope(state.data?.alerts?.siteScoped), Modifier.testTag("alerts-scope"))
        Text(if (!state.authorized || state.forbidden) "마지막 수신 정보 표시 불가 · 접근 권한 없음"
            else siteStatusReceipt(state.data?.fetchedAt))
        if (state.offline) StateLabel(StateKind.offline, "오프라인 · 대응 확인은 연결 후 가능")
        if (state.data?.let { Duration.between(parseInstant(it.fetchedAt), state.now).seconds >= 300 } == true)
            Text("오래된 자료 · 마지막 수신 후 5분 이상 지났습니다")
        if (state.loading) StateLabel(StateKind.loading, "서버 상태 조회 중")
        if (state.readFailed) StateNotice(StateKind.failed, "경보 수신 실패", "이전에 받은 내용을 표시합니다.", Modifier.testTag("alerts-read-error"))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            if (selected != null) OutlinedButton({ onSelect(null) }, Modifier.heightIn(min = 56.dp).testTag("alerts-back")) { Text("목록으로") }
            OutlinedButton({ onRefresh() }, Modifier.heightIn(min = 56.dp).testTag("alerts-refresh"),
                enabled = state.authorized && !state.loading && !state.sending) { Text("서버 상태 다시 조회") }
        }
        if (!state.authorized || state.forbidden) {
            Text("경보 접근 권한을 확인할 수 없습니다. 관리자에게 문의해 주세요.", Modifier.testTag("alerts-forbidden"))
        } else if (selected == null) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                for (done in listOf(false, true)) FilterChip(acknowledged == done, { acknowledged = done },
                    label = { Text(if (done) "대응완료" else "미대응") },
                    modifier = Modifier.heightIn(min = 56.dp).testTag(if (done) "alerts-filter-acked" else "alerts-filter-unacked"))
            }
            // Rows wrap naturally at tablet/split-window widths, without an extra horizontal gesture.
            val types = listOf<String?>(null) + AlertType.entries.map { it.name }
            for (group in types.chunked(3)) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (name in group) FilterChip(type == name, { type = name },
                    label = { Text(AlertType.entries.firstOrNull { it.name == name }?.label ?: "전체 종류") },
                    modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("alerts-type-${name ?: "all"}"))
            }
            val rows = state.items.filter { it.acknowledged == acknowledged && (type == null || it.type.name == type) }
            Text("마지막 수신 기준 · 미대응 ${state.data?.alerts?.unacked?.toString() ?: "수신 안 됨"} · 수신 목록 필터 결과 ${rows.size}건")
            if (state.data == null || state.data?.alerts?.itemsAvailable != true) Text("경보 목록을 아직 확인할 수 없습니다")
            else if (rows.isEmpty()) Text("수신한 목록에 선택한 조건의 경보가 없습니다")
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
            if (current == null) Text("목록에서 확인할 수 없는 경보 · 종료로 추정하지 않습니다. 다시 조회해 주세요.", Modifier.testTag("alert-missing"))
            else if (!same) Text("같은 ID의 경보 대상 또는 발생 시각이 바뀌었습니다. 목록에서 다시 선택해 주세요.")
            else if (row.id in state.reopened) Text("다시 열린 경보 · 대상과 발생 시각을 다시 확인해 주세요.")
            else if (row.acknowledged) Text("종료된 경보 · 대응 확인이 기록되어 있습니다.")
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
                Text("대응 확인 응답과 조회 목록의 상태가 아직 일치하지 않습니다. 서버 상태를 다시 조회해 주세요.")
            if (row.workerId == null || row.ts == null) Text("대상 또는 발생 시각 정보가 없어 대응 확인을 할 수 없습니다.")
            Text("위 대상·발생 시각을 확인한 뒤 아래 버튼을 한 번 눌러 주세요. 대응 확인은 위험 해제나 사고 종결을 뜻하지 않습니다.")
            Button({ onAcknowledge(selected) }, Modifier.heightIn(min = 64.dp).testTag("alert-ack"), enabled = canAck(selected)) {
                Text(if (state.offline) "연결 후 가능" else if (phase == AlertWritePhase.sending) "처리 중" else "대응 확인")
            }
        }
    }
}

/** The shell reserves its height. This observes snapshots and never owns a timer or POST. */
@Composable
fun GlobalAlertStrip(controller: AlertsController, deferred: Boolean, onOpen: (AlertItem) -> Unit) {
    val s by controller.state.collectAsStateWithLifecycle()
    val row = s.pending.firstOrNull()?.takeIf { s.authorized && !s.forbidden && !deferred } ?: return
    GlassCard(Modifier.fillMaxWidth().padding(8.dp).testTag("global-alert-strip")) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
            StateIcon(StateKind.warning, Modifier.padding(12.dp).size(24.dp))
            Column(Modifier.weight(1f).fillMaxHeight().clickable { onOpen(row) }.padding(8.dp)
                .verticalScroll(rememberScrollState()).testTag("global-alert-open")) {
                Text("${row.type.label} · 미대응 (수신 기준)", fontWeight = FontWeight.Bold)
                Text("${row.workerName ?: row.workerId ?: "작업자 정보 없음"} · 상세 보기")
            }
            TextButton({ controller.dismiss(row) }, Modifier.sizeIn(minWidth = 56.dp, minHeight = 56.dp).testTag("global-alert-dismiss")) { Text("닫기") }
        }
    }
}
