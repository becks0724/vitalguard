package com.vitalguard.field.ui.record

import com.vitalguard.field.ui.theme.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import com.vitalguard.field.data.ActionSide
import com.vitalguard.field.ui.shell.LocalActionPlacement
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.R
import com.vitalguard.field.capture.*
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.FieldController
import com.vitalguard.field.data.models.fromOutbox
import com.vitalguard.field.data.record.*
import com.vitalguard.field.ui.theme.VgIcon
import com.vitalguard.field.ui.theme.VgIconButton
import java.time.LocalDate

@Composable
fun RecordCalendarScreen(controller: FieldController, outbox: OutboxController, calendar: RecordCalendarController,
    actions: RecordActions, capture: CaptureUiState, onScan: () -> Unit, onPhoto: () -> Unit, onOpen: (CalendarRecord) -> Unit,
) {
    val field by controller.state.collectAsStateWithLifecycle()
    val entries by outbox.items.collectAsStateWithLifecycle()
    val state by calendar.state.collectAsStateWithLifecycle()
    val error by outbox.loadError.collectAsStateWithLifecycle()
    val records = remember(entries, state.server, state.loaded, field.user?.id) {
        mergeCalendarRecords(entries.filter { it.owner == field.user?.id }, state.server, !state.loaded)
    }
    RecordCalendarContent(state.selected, records, today = LocalDate.now(calendarZone), offline = field.offline,
        loading = state.loading, error = error ?: state.error, capture = capture, onSelect = calendar::select,
        onReload = { calendar.refresh() }, onOpen = onOpen, onSend = { it.local?.let(actions::send) }, onScan = onScan, onPhoto = onPhoto,
        thumbnail = { record ->
            PhotoPreview(controller, record.local?.let(::fromOutbox) ?: record.media, Modifier.size(64.dp), cacheWidth = 160)
        })
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun RecordCalendarContent(
    selected: LocalDate, records: List<CalendarRecord>, today: LocalDate = selected, offline: Boolean = false,
    loading: Boolean = false, error: String? = null, capture: CaptureUiState = CaptureUiState(),
    onSelect: (LocalDate) -> Unit = {}, onReload: () -> Unit = {}, onOpen: (CalendarRecord) -> Unit = {},
    onSend: (CalendarRecord) -> Unit = {}, onScan: () -> Unit = {}, onPhoto: () -> Unit = {},
    thumbnail: @Composable (CalendarRecord) -> Unit = { ImagePlaceholder(Modifier.size(64.dp)) },
) {
    var showDay by rememberSaveable { mutableStateOf(false) }
    val select: (LocalDate) -> Unit = { onSelect(it); showDay = true }
    val blocks = remember(records, selected) { calendarBlocks(records, selected) }
    val placement = LocalActionPlacement.current
    val physicalLeft = placement.side == ActionSide.left
    Scaffold(containerColor = Color.Transparent, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            // A measured bottom bar reserves space; capture actions never float over calendar cells.
            Box(Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 4.dp)) {
                Row(Modifier.align(if (physicalLeft) AbsoluteAlignment.CenterLeft else AbsoluteAlignment.CenterRight)
                    .testTag("record-capture-actions"),
                    horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    ActionIconButton(R.drawable.ic_scan, "서류 스캔", { if (!capture.busy) onScan() },
                        Modifier.testTag("document-scan"), enabled = placement.loaded && !capture.busy)
                    ActionIconButton(R.drawable.ic_camera, "사진 촬영", { if (!capture.busy) onPhoto() },
                        Modifier.testTag("photo-capture"), enabled = placement.loaded && !capture.busy)
                }
            }
        }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 8.dp)
            .testTag("record-calendar"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("워크 캘린더", style = MaterialTheme.typography.headlineSmall)
            if (offline) StateLabel(StateKind.offline, "오프라인 · 기록은 기기에 보관됩니다.", style = MaterialTheme.typography.bodySmall)
            if (error != null) Row(verticalAlignment = Alignment.CenterVertically) {
                Text(error, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                ActionIconButton(R.drawable.ic_refresh, "다시 불러오기", onReload, size = 56.dp)
            }
            if (loading || capture.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (capture.scannerReady == false) Text(scannerPreparationMessage, Modifier.testTag("scanner-not-ready"), style = MaterialTheme.typography.bodySmall)
            capture.operationMessage?.let { Text(it, Modifier.testTag("capture-status"), style = MaterialTheme.typography.bodySmall) }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                WeekCalendar(selected, today, blocks, onSelect = select,
                    onShift = { onSelect(selected.plusDays(it)); showDay = false }, onToday = { select(today) })
            }
        }
    }
    if (showDay) ModalBottomSheet(onDismissRequest = { showDay = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        val day = records.filter { it.date == selected }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 640.dp).testTag("calendar-day-list"),
            contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text("${selected.monthValue}월 ${selected.dayOfMonth}일 기록 · ${day.size}건", style = MaterialTheme.typography.titleLarge) }
            if (day.isEmpty()) item { Text("이 날짜에 저장된 기록이 없습니다.") }
            items(day, key = { it.key }) { record ->
                GlassCard(Modifier.fillMaxWidth().testTag("record-photo-${record.local?.id ?: record.media.id}").clickable {
                    showDay = false; onOpen(record)
                }) {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        thumbnail(record)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(record.media.title ?: "현장 사진", style = MaterialTheme.typography.titleMedium)
                            Text(captureRecordedTime(record.media.captured_at), style = MaterialTheme.typography.bodySmall)
                            Text(record.counts, style = MaterialTheme.typography.bodySmall)
                            CalendarStatusBadge(record.status)
                            record.local?.message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        }
                        if (record.canSend) ActionIconButton(R.drawable.ic_upload, "전송", { onSend(record) },
                            Modifier.testTag("calendar-send-${record.local?.id}"), enabled = !offline)
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarDay(date: LocalDate, selected: LocalDate, today: LocalDate, tag: String, onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val chosen = date == selected
    Box(modifier.height(56.dp).testTag(tag).semantics { this.selected = chosen; contentDescription = date.toString() }
        .clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.size(30.dp).background(when {
            chosen -> MaterialTheme.colorScheme.primary
            date == today -> MaterialTheme.colorScheme.primary.copy(alpha = .14f)
            else -> Color.Transparent
        }, CircleShape), contentAlignment = Alignment.Center) {
            Text("${date.dayOfMonth}", fontSize = 12.sp, color = when {
                chosen -> MaterialTheme.colorScheme.onPrimary
                else -> MaterialTheme.colorScheme.onSurface
            })
        }
    }
}

@Composable
private fun WeekCalendar(selected: LocalDate, today: LocalDate, blocks: List<CalendarBlock>, onSelect: (LocalDate) -> Unit,
    onShift: (Long) -> Unit, onToday: () -> Unit,
) {
    val days = weekDays(selected)
    val density = LocalDensity.current
    val scroll = rememberScrollState(with(density) { (INITIAL_SCROLL_HOUR * WEEK_HOUR_DP).dp.roundToPx() })
    GlassCard(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().padding(8.dp).testTag("calendar-week")) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            VgIconButton(R.drawable.ic_chevron_left, "이전 주", onClick = { onShift(-7) })
            Text("${days.first().year}년 ${days.first().monthValue}/${days.first().dayOfMonth} – " +
                (if (days.last().year != days.first().year) "${days.last().year}년 " else "") +
                "${days.last().monthValue}/${days.last().dayOfMonth}",
                Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            ActionIconButton(R.drawable.ic_calendar_today, "오늘", onToday, size = 56.dp)
            VgIconButton(R.drawable.ic_chevron_right, "다음 주", onClick = { onShift(7) })
        }
        Row(Modifier.fillMaxWidth()) {
            Spacer(Modifier.width(42.dp))
            days.forEachIndexed { index, date ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(listOf("일", "월", "화", "수", "목", "금", "토")[index], style = MaterialTheme.typography.labelSmall)
                    CalendarDay(date, selected, today, "week-day-$date", { onSelect(date) }, modifier = Modifier.fillMaxWidth())
                }
            }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("calendar-all-day")) {
            Text("종일", Modifier.width(42.dp).padding(top = 6.dp), style = MaterialTheme.typography.labelSmall)
            days.forEach { date ->
                Box(Modifier.weight(1f).heightIn(min = 48.dp).border(.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    blocks.firstOrNull { it.date == date && it.hour == null }?.let { block ->
                        CalendarMediaBlock(block, Modifier.fillMaxWidth(), { onSelect(date) })
                    }
                }
            }
        }
        // 날짜 머리글은 고정하고 24시간 격자만 세로 스크롤한다. 새 조회마다 07시로 돌아가지 않는다.
        Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).testTag("calendar-hour-scroll")) {
            Row(Modifier.fillMaxWidth().height((WEEK_END_HOUR * WEEK_HOUR_DP + 20).dp)) {
                Box(Modifier.width(42.dp).fillMaxHeight()) {
                    (WEEK_START_HOUR..WEEK_END_HOUR).forEach { hour ->
                        Text("%02d:00".format(hour), Modifier.offset(y = (hour * WEEK_HOUR_DP).dp), fontSize = 10.sp)
                    }
                }
                days.forEach { date ->
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        (WEEK_START_HOUR until WEEK_END_HOUR).forEach { hour ->
                            Box(Modifier.offset(y = (hour * WEEK_HOUR_DP).dp).fillMaxWidth().height(WEEK_HOUR_DP.dp)
                                .border(.5.dp, MaterialTheme.colorScheme.outlineVariant).clickable { onSelect(date) })
                        }
                        blocks.filter { it.date == date && it.hour != null }.forEach { block ->
                            CalendarMediaBlock(block, Modifier.offset(y = (block.hour!! * WEEK_HOUR_DP + 2).dp)
                                .fillMaxWidth().height((WEEK_HOUR_DP - 4).dp), { onSelect(date) })
                        }
                    }
                }
            }
        }
    }
    }
}

@Composable
fun CalendarStatusBadge(status: CalendarStatus) {
    StateLabel(when (status) {
        CalendarStatus.completed -> StateKind.ready
        CalendarStatus.failed -> StateKind.failed
        CalendarStatus.uncertain -> StateKind.stale
        CalendarStatus.sending -> StateKind.loading
        CalendarStatus.stored -> StateKind.empty
    }, status.label, style = MaterialTheme.typography.labelSmall, iconSize = 14.dp)
}
@Composable
private fun CalendarMediaBlock(block: CalendarBlock, modifier: Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = modifier.padding(horizontal = 1.dp).testTag("calendar-block-${block.key}")
        .semantics { contentDescription = "${block.date} ${block.hour?.let { "${it}시" } ?: "종일"} · ${block.label} · ${block.status.label}" },
        color = DashboardColors.accent.copy(alpha = .16f), contentColor = MaterialTheme.colorScheme.onSurface, shape = MaterialTheme.shapes.extraSmall) {
        Column(Modifier.padding(3.dp)) {
            Text(block.label, fontSize = 10.sp, lineHeight = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            CalendarStatusBadge(block.status)
        }
    }
}
