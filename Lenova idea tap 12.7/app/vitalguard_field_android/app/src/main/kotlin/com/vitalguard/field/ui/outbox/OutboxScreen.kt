package com.vitalguard.field.ui.outbox

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
    var filterName by rememberSaveable(queue.account) { mutableStateOf<String?>(null) }
    var siteGroup by rememberSaveable(queue.account) { mutableStateOf<String?>(null) }
    var confirmId by rememberSaveable(queue.account) { mutableStateOf<String?>(null) }
    val filter = filterName?.let(OutboxPhase::valueOf)
    val groups = entries.associate { it.siteGroup to it.siteName }
    val visible = entries.filter { (siteGroup == null || it.siteGroup == siteGroup) && (filter == null || it.phase == filter) }.reversed()
    val account = queue.account
    LazyColumn(Modifier.fillMaxSize().testTag("outbox-list"), state = rememberLazyListState(),
        contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("전송 상태", style = MaterialTheme.typography.headlineMedium)
                Text("현재 계정 · ${field.user?.name ?: account ?: "로그인 필요"}${if (account == null) "" else " ($account)"}")
                Text("로컬 저장됨은 기기에 보관한 상태입니다. 전송 완료는 서버에서 받은 사실을 확인한 상태입니다.")
                Text("초안은 작성 당시 현장으로 고정됩니다. 연결 후 각 항목의 전송/재시도를 눌러 주세요.")
                Text("전송 완료 항목은 7일 뒤 자동으로 지워집니다. 원본은 관제웹에서 봅니다.")
                if (field.offline) Text("오프라인 · 사진·잉크본·메모·음성은 기기에 보관합니다.")
                if (queue.supportedLookup) {
                    OutlinedButton({ ui.verify() }, Modifier.testTag("outbox-lookup-all"),
                        enabled = canLookup && !checking && entries.any { it.phase == OutboxPhase.uncertain }) { Text("서버 상태 다시 조회") }
                    Text("결과 불명만 조회합니다. 화면 진입·전경 복귀 시 자동 조회하며, 30초 안에는 반복하지 않습니다.")
                    if (checking) LinearProgressIndicator(Modifier.fillMaxWidth())
                    lookupMessage?.let { Text(it, Modifier.testTag("outbox-lookup-message")) }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = filter == null, onClick = { filterName = null }, label = { Text("전체 ${entries.size}") })
                    for ((phase, label) in listOf(OutboxPhase.waiting to "대기", OutboxPhase.sending to "진행", OutboxPhase.failed to "실패",
                        OutboxPhase.uncertain to "결과 불명", OutboxPhase.reauthenticate to "재로그인 필요", OutboxPhase.completed to "완료")) {
                        FilterChip(selected = filter == phase, onClick = { filterName = phase.name },
                            label = { Text("$label ${entries.count { it.phase == phase }}") })
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = siteGroup == null, onClick = { siteGroup = null }, label = { Text("모든 작성 현장") })
                    groups.forEach { (group, name) -> FilterChip(selected = siteGroup == group, onClick = { siteGroup = group }, label = { Text(name) }) }
                }
                if (loadError != null) { Text(loadError!!); TextButton(ui::loadAndCheck) { Text("전송 원장 다시 열기") } }
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
                    OutboxCard(item, parent, item.id in busyIds, field.offline, queue.supportedLookup, checking, canLookup,
                        item.id in retryableIds, onVerify = { ui.verify(item) }, onSend = { ui.send(item) },
                        onConfirmAbsent = { confirmId = item.id }, onSignOut = ui::signOut)
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
        confirmButton = { Button({ confirmId = null; ui.send(confirmItem, confirmAbsent = true) }, enabled = !field.offline) { Text("미등록 확인 · 재시도") } })
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
    Card(Modifier.fillMaxWidth().testTag("outbox-${item.id}")) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${item.kindLabel} · ${item.fields["title"] ?: item.fields["commentOf"].orEmpty()}", style = MaterialTheme.typography.titleMedium)
            if (item.dependsOn != null) Text("원본 사진 ${parent?.fields?.get("title") ?: "제목 없음"} 에 딸림")
            Text(item.statusLabel, Modifier.testTag("outbox-status-${item.id}"), fontWeight = FontWeight.Bold)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            item.message?.let { Text(it, Modifier.padding(top = 8.dp)) }
            Text("현장 ID ${item.siteId ?: "미제공"} · ${localCreatedAt(item)}")
            SelectionContainer { Text("작업 ID ${item.id}") }
            item.fields["annotationOf"]?.let { Text("원본 사진 $it") }
            if (uncertain) Text("이미 서버에 등록됐을 수 있습니다. 서버 반영 여부를 먼저 확인해 주세요.")
            if (uncertain && !supportedLookup) Text("서버 반영 여부를 자동으로 확인할 수 없습니다. 관제웹에서 먼저 확인해 주세요. 자동 재전송하지 않습니다.")
            if (item.phase == OutboxPhase.reauthenticate) Text("작성 계정으로 다시 로그인한 뒤 이 항목을 재개해 주세요. 초안은 그대로 보관됩니다.")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if (uncertain) {
                    if (supportedLookup) OutlinedButton(onVerify, enabled = !busy && !checking && canLookup) { Text("서버 상태 재조회") }
                    if (retryable) Button(onSend, enabled = !cannotSend && !checking && canLookup) { Text("같은 작업 재시도") }
                    if (!supportedLookup) OutlinedButton(onConfirmAbsent, enabled = !cannotSend) { Text("관제웹 미등록 확인 후 재시도") }
                } else if (item.phase != OutboxPhase.completed && item.phase != OutboxPhase.sending) {
                    Button(onSend, enabled = !cannotSend) { Text(if (item.phase == OutboxPhase.waiting) "전송" else "같은 작업 재시도") }
                }
                if (item.phase == OutboxPhase.reauthenticate) TextButton(onSignOut, enabled = !busy) { Text("다시 로그인") }
            }
        }
    }
}
