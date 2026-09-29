package com.vitalguard.field.data.record

import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import java.time.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

const val WEEK_START_HOUR = 0
const val WEEK_END_HOUR = 24
const val WEEK_HOUR_DP = 44
const val INITIAL_SCROLL_HOUR = 7
val calendarZone: ZoneId = ZoneId.of("Asia/Seoul")
fun weekStart(date: LocalDate): LocalDate = date.minusDays((date.dayOfWeek.value % 7).toLong())
fun weekDays(date: LocalDate): List<LocalDate> = (0L..6L).map { weekStart(date).plusDays(it) }
fun monthDays(month: YearMonth): List<LocalDate> = (0L..41L).map { weekStart(month.atDay(1)).plusDays(it) }
fun captureMinute(raw: String?): Int? = raw?.let {
    runCatching { OffsetDateTime.parse(asKstIso(it)).let { time -> time.hour * 60 + time.minute } }.getOrNull()
}
enum class CalendarStatus(val label: String) {
    stored("기기 보관"), sending("전송 중"), failed("실패"), uncertain("불명"), completed("완료")
}
fun calendarStatus(items: List<OutboxEntry>): CalendarStatus = when {
    items.any { it.needsVerification || it.phase == OutboxPhase.uncertain } -> CalendarStatus.uncertain
    items.any { it.phase == OutboxPhase.sending } -> CalendarStatus.sending
    items.any { it.phase in setOf(OutboxPhase.failed, OutboxPhase.reauthenticate) } -> CalendarStatus.failed
    items.any { it.phase == OutboxPhase.waiting } -> CalendarStatus.stored
    else -> CalendarStatus.completed
}

/** 화면용 투영. 서버 행/전송 원장은 기존 CalendarMedia와 OutboxEntry를 그대로 사용한다. */
data class CalendarRecord(val media: CalendarMedia, val local: OutboxEntry?, val attachments: List<OutboxEntry>, val server: Boolean) {
    val key get() = if (server) "server:${media.id}" else "local:${media.id}"
    val date: LocalDate get() = LocalDate.parse(media.date_key)
    val minute get() = captureMinute(media.captured_at)
    val status get() = calendarStatus(listOfNotNull(local) + attachments)
    val voiceCount: Int get() = RecordAttachments(media, attachments).voiceCount
    val canSend get() = status == CalendarStatus.failed && local != null &&
        (listOf(local) + attachments).any { it.phase == OutboxPhase.failed || it.phase == OutboxPhase.reauthenticate }
    val counts get() = "${if (media.media_type == "video") "영상" else "사진"} 1 · 음성 $voiceCount"
}
fun mergeCalendarRecords(local: List<OutboxEntry>, server: List<CalendarMedia>, includeCompletedLocal: Boolean = true): List<CalendarRecord> {
    val photos = local.filter { it.kind == OutboxKind.photo }
    val matched = mutableSetOf<String>()
    val remote = server.distinctBy { it.id }.map { media ->
        val photo = photos.firstOrNull { it.receipt?.get("id") == media.id || it.id == media.operationId ||
            (it.sourceKey != null && it.sourceKey == media.sourceKey) }
        photo?.let { matched += it.id }
        CalendarRecord(media, photo, local.filter { photo != null && it.dependsOn == photo.id }, true)
    }
    return (remote + photos.filter { it.id !in matched }.mapNotNull { photo ->
        val children = local.filter { it.dependsOn == photo.id }
        if (!includeCompletedLocal && photo.phase == OutboxPhase.completed && children.all { it.phase == OutboxPhase.completed }) return@mapNotNull null
        val fallback = photo.receipt?.takeIf { it["id"] is String && it["date_key"] is String }?.let(::CalendarMedia)
        CalendarRecord(fallback ?: fromOutbox(photo), photo, children, fallback != null)
    }).filter { runCatching { it.date }.isSuccess }.sortedWith(compareBy({ it.date }, { it.minute ?: -1 }, { it.key }))
}
data class CalendarBlock(val date: LocalDate, val hour: Int?, val records: List<CalendarRecord>) {
    val key get() = "$date:${hour ?: "all-day"}"
    val status get() = calendarStatus(records.flatMap { listOfNotNull(it.local) + it.attachments })
    val label get() = buildList {
        val videos = records.count { it.media.media_type == "video" }
        add("사진 ${records.size - videos}")
        if (videos > 0) add("영상 $videos")
        add("음성 ${records.sumOf { it.voiceCount }}")
    }.joinToString(" · ")
}
fun calendarBlocks(records: List<CalendarRecord>, selected: LocalDate): List<CalendarBlock> {
    val days = weekDays(selected)
    return records.filter { it.date in days }.groupBy { it.date to it.minute?.div(60) }
        .map { (slot, members) -> CalendarBlock(slot.first, slot.second, members) }
}

data class RecordCalendarState(
    val selected: LocalDate, val server: List<CalendarMedia> = emptyList(),
    val loaded: Boolean = false, val loading: Boolean = false, val error: String? = null,
)
class RecordCalendarController(private val field: FieldController, private val queue: OutboxController,
    private val scope: CoroutineScope, private val clock: Clock = Clock.systemUTC()) : AutoCloseable {
    private val mutable = MutableStateFlow(RecordCalendarState(LocalDate.now(clock.withZone(calendarZone))))
    val state = mutable.asStateFlow()
    private var owner: String? = null
    private var visible = false
    private var generation = 0
    private var fetch: Job? = null
    fun bindAccount(value: String?) {
        if (owner == value) return
        owner = value; generation++; fetch?.cancel()
        mutable.value = RecordCalendarState(mutable.value.selected)
        if (visible) refresh()
    }
    fun setVisible(value: Boolean) {
        if (visible == value) return
        visible = value
        if (value) refresh()
    }
    fun today() = select(LocalDate.now(clock.withZone(calendarZone)))
    fun select(date: LocalDate) {
        val changedWeek = weekStart(date) != weekStart(mutable.value.selected)
        mutable.value = mutable.value.copy(selected = date, server = if (changedWeek) emptyList() else mutable.value.server,
            loaded = if (changedWeek) false else mutable.value.loaded)
        if (changedWeek) refresh()
    }
    fun refresh() {
        val account = owner ?: return
        if (!visible) return
        val days = weekDays(mutable.value.selected)
        val expected = ++generation
        fetch?.cancel()
        fetch = scope.launch {
            mutable.value = mutable.value.copy(loading = true, error = null)
            try {
                val records = field.calendarMedia(days.first().toString(), days.last().toString())
                if (expected == generation && account == owner) mutable.value = mutable.value.copy(server = records, loaded = true)
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                if (expected == generation && account == owner) mutable.value = mutable.value.copy(error = e.message ?: "서버 기록을 불러오지 못했습니다")
            } finally { if (expected == generation) mutable.value = mutable.value.copy(loading = false) }
        }
    }
    private val completed = scope.launch {
        queue.items.map { items -> items.filter { it.phase == OutboxPhase.completed }.map { it.id } }.distinctUntilChanged()
            .collect { refresh() }
    }
    fun removed(serverId: String) { mutable.value = mutable.value.copy(server = mutable.value.server.filterNot { it.id == serverId }); refresh() }
    override fun close() { generation++; fetch?.cancel(); completed.cancel() }
}
