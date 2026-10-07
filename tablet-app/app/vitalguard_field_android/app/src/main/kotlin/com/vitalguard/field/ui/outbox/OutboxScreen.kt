package com.vitalguard.field.ui.outbox

import com.vitalguard.field.R
import com.vitalguard.field.ui.theme.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.data.*
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Port: lib/ui/outbox/outbox_screen.dart. 문구/키/필터/현장 그룹 유지.
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OutboxScreen(ui: OutboxUiController) {
    val queue = ui.queue
    val entries by queue.items.collectAsStateWithLifecycle()
    val field by queue.field.state.collectAsStateWithLifecycle()
    val checking by queue.checking.collectAsStateWithLifecycle()
    val lookupMessage by queue.lookupMessage.collectAsStateWithLifecycle()
    val loadError by queue.loadError.collectAsStateWithLifecycle()
    val busyIds by queue.busyIds.collectAsStateWithLifecycle()
    val retryableIds by queue.retryableIds.collectAsStateWithLifecycle()
    val error by ui.error.collectAsStateWithLifecycle()
    val canLookup by ui.lookupEnabled.collectAsStateWithLifecycle()
    OutboxHistoryContent(entries.filter { it.owner == queue.account }, field.user?.name ?: queue.account ?: "로그인 필요", field.offline,
        checking, lookupMessage, loadError, busyIds, retryableIds, error, queue.supportedLookup, canLookup,
        onReload = ui::loadAndCheck, onVerify = ui::verify, onSend = { item, absent -> ui.send(item, absent) }, onSignOut = ui::signOut)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OutboxHistoryContent(
    allEntries: List<OutboxEntry>, account: String = "현재 계정", offline: Boolean = false,
    checking: Boolean = false, lookupMessage: String? = null, loadError: String? = null,
    busyIds: Set<String> = emptySet(), retryableIds: Set<String> = emptySet(), error: String? = null,
    supportedLookup: Boolean = false, canLookup: Boolean = false, onReload: () -> Unit = {},
    onVerify: (OutboxEntry?) -> Unit = {}, onSend: (OutboxEntry, Boolean) -> Unit = { _, _ -> }, onSignOut: () -> Unit = {},
) {
    val entries = historyEntries(allEntries)
    var filterName by rememberSaveable(account) { mutableStateOf<String?>(null) }
    var siteGroup by rememberSaveable(account) { mutableStateOf<String?>(null) }
    var confirmId by rememberSaveable(account) { mutableStateOf<String?>(null) }
    val filter = filterName?.let(OutboxPhase::valueOf)
    val groups = entries.associate { it.siteGroup to it.siteName }
    val visible = entries.filter { (siteGroup == null || it.siteGroup == siteGroup) && (filter == null || historyPhase(it) == filter) }.reversed()
    LazyColumn(Modifier.fillMaxSize().testTag("outbox-list"), state = rememberLazyListState(),
        contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("전송 이력", style = MaterialTheme.typography.headlineMedium)
                Text("현재 계정 · $account")
                if (offline) StateLabel(StateKind.offline, "오프라인")
                if (supportedLookup) {
                    ActionIconButton(R.drawable.ic_refresh, "서버 상태 다시 조회", { onVerify(null) }, Modifier.testTag("outbox-lookup-all"),
                        enabled = canLookup && !checking && entries.any { it.phase == OutboxPhase.uncertain }, busy = checking)
                    if (checking) LinearProgressIndicator(Modifier.fillMaxWidth())
                    lookupMessage?.let { Text(it, Modifier.testTag("outbox-lookup-message")) }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = filter == null, onClick = { filterName = null }, label = { Text("전체 ${entries.size}") })
                    for ((phase, label) in listOf(OutboxPhase.completed to "완료", OutboxPhase.failed to "실패",
                        OutboxPhase.uncertain to "결과 불명", OutboxPhase.sending to "전송 중")) {
                        FilterChip(selected = filter == phase, onClick = { filterName = phase.name },
                            label = { Text("$label ${entries.count { historyPhase(it) == phase }}") })
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = siteGroup == null, onClick = { siteGroup = null }, label = { Text("모든 작성 현장") })
                    groups.forEach { (group, name) -> FilterChip(selected = siteGroup == group, onClick = { siteGroup = group }, label = { Text(name) }) }
                }
                if (loadError != null) { Text(loadError); ActionIconButton(R.drawable.ic_refresh, "전송 원장 다시 열기", onReload, enabled = !checking, busy = checking) }
                error?.let { Text(it) }
                if (visible.isEmpty() && loadError == null) Text("이 계정에 표시할 전송 항목이 없습니다.", Modifier.padding(vertical = 32.dp))
            }
        }
        groups.forEach { (group, name) ->
            val members = visible.filter { it.siteGroup == group }
            if (members.isNotEmpty()) {
                item(key = "group:$group") { Text("작성 당시 현장 · $name", Modifier.padding(top = 24.dp, bottom = 8.dp), style = MaterialTheme.typography.titleLarge) }
                items(members, key = { "outbox-${it.id}" }) { item ->
                    val parent = entries.firstOrNull { it.id == item.dependsOn && it.kind == OutboxKind.photo }
                    OutboxCard(item, parent, item.id in busyIds, offline, supportedLookup, checking, canLookup,
                        item.id in retryableIds, onVerify = { onVerify(item) }, onSend = { onSend(item, false) },
                        onConfirmAbsent = { confirmId = item.id }, onSignOut = onSignOut)
                }
            }
        }
    }
    val confirmItem = entries.firstOrNull { it.id == confirmId }
    if (confirmItem != null) AlertDialog(onDismissRequest = { confirmId = null },
        title = { Text("서버 반영 여부를 확인했나요?") },
        text = {
            Text("관제웹에서 이 기록이 등록되지 않은 것을 확인한 경우에만 재시도해 주세요.\n\n" +
                "${confirmItem.siteName} · ${confirmItem.kindLabel}\n" +
                "작성일 ${confirmItem.fields["dateKey"] ?: localCreatedAt(confirmItem).take(10)}\n" +
                "원본 ${confirmItem.fields["annotationOf"] ?: confirmItem.fields["commentOf"] ?: "새 사진"}\n" +
                "작업 ID ${confirmItem.id}\n\n동일한 작업 ID와 보관 파일로 재시도합니다.", Modifier.verticalScroll(rememberScrollState()))
        }, dismissButton = { TextButton({ confirmId = null }) { Text("아직 확인하지 못함") } },
        confirmButton = { Button({ confirmId = null; onSend(confirmItem, true) }, enabled = !offline) { Text("미등록 확인 · 재시도") } })
}
private fun localCreatedAt(item: OutboxEntry) = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm")
    .format(item.createdAt.atZone(ZoneId.systemDefault()))

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OutboxCard(item: OutboxEntry, parent: OutboxEntry?, busy: Boolean, offline: Boolean,
    supportedLookup: Boolean, checking: Boolean, canLookup: Boolean, retryable: Boolean,
    onVerify: () -> Unit, onSend: () -> Unit, onConfirmAbsent: () -> Unit, onSignOut: () -> Unit,
) {
    val uncertain = item.needsVerification || item.phase == OutboxPhase.uncertain
    val cannotSend = busy || offline
    GlassCard(Modifier.fillMaxWidth().testTag("outbox-${item.id}")) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${item.kindLabel} · ${item.fields["title"] ?: item.fields["commentOf"].orEmpty()}", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                OutboxInfoButton(item)
            }
            if (item.dependsOn != null) Text("원본 사진 ${parent?.fields?.get("title") ?: "제목 없음"} 에 딸림")
            StateLabel(item.phase.visualState(), item.statusLabel, Modifier.testTag("outbox-status-${item.id}"))
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            item.message?.let { Text(it, Modifier.padding(top = 8.dp)) }
            Text(localCreatedAt(item), style = MaterialTheme.typography.bodySmall)
            if (item.phase == OutboxPhase.completed) Text("${if (item.mock) "모의 확인 시각" else "서버 확인 시각"} · " +
                (item.completedAt?.let { DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss").format(it.atZone(ZoneId.of("Asia/Seoul"))) } ?: "미기록"))
            item.fields["annotationOf"]?.let { Text("원본 사진 $it") }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if (uncertain) {
                    if (supportedLookup) ActionIconButton(R.drawable.ic_refresh, "서버 상태 재조회", onVerify, enabled = !busy && !checking && canLookup, busy = checking)
                    if (retryable) Button(onSend, enabled = !cannotSend && !checking && canLookup) { Text("같은 작업 재시도") }
                    if (!supportedLookup) OutlinedButton(onConfirmAbsent, enabled = !cannotSend) { Text("관제웹 미등록 확인 후 재시도") }
                } else if (item.phase == OutboxPhase.failed || item.phase == OutboxPhase.reauthenticate) {
                    ActionIconButton(R.drawable.ic_upload, "전송", onSend, enabled = !cannotSend)
                }
                if (item.phase == OutboxPhase.reauthenticate) TextButton(onSignOut, enabled = !busy) { Text("다시 로그인") }
            }
        }
    }
}
