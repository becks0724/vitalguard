package com.vitalguard.field.data.record

import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/** 서버의 댓글과 같은 사진의 로컬 첨부를 한 번만 표시/계산하는 투영이다. */
class RecordAttachments(val media: CalendarMedia, attachments: List<OutboxEntry>) {
    private val serverId = media.text("serverId") ?: media.id
    val comments = media.comments.filter { it.media_id == serverId }
        .distinctBy { it.operationId ?: it.id }.distinctBy { it.id }
        .sortedBy { parseInstantOrNull(it.created_at) }
    val local = attachments.distinctBy { it.fields["clientOperationId"] ?: it.id }.filter { child ->
        child.kind == OutboxKind.ink || comments.none {
            it.id == child.receipt?.get("id") || it.operationId == child.id ||
                (it.operationId != null && it.operationId == child.fields["clientOperationId"])
        }
    }
    val voiceCount = comments.count { it.isVoice } + local.count { it.kind == OutboxKind.voice }
    val textCount = comments.count { !it.isVoice } + local.count { it.kind == OutboxKind.text }
    val latestAnnotationId = media.annotationId?.takeIf { it.isNotBlank() }
    val localInk = local.filter { it.kind == OutboxKind.ink }
    val knownInkCount = localInk.map { it.receipt?.get("id") as? String ?: it.id }.toSet().let {
        (it + listOfNotNull(latestAnnotationId)).size
    }
    private val serverRecord = media.json["local"] != true || media.text("serverId") != null
    // listCalendarMedia는 원본만 주고 최신 annotationId만 제공한다. 전체 리비전 수를 꾸미지 않는다.
    val inkCountUnverified = serverRecord && (latestAnnotationId != null || !media.json.containsKey("annotationId"))
    val commentsUnverified = serverRecord && media.json["comments"] !is List<*>
    private fun count(name: String, value: Int, unknown: Boolean) = when {
        !unknown -> "$name $value"
        value == 0 -> "$name 미확인"
        else -> "$name ${value}개 이상"
    }
    val counts get() = listOf(count("주석", knownInkCount, inkCountUnverified),
        count("메모", textCount, commentsUnverified), count("음성", voiceCount, commentsUnverified)).joinToString(" · ")
}

data class RecordDetailState(val media: CalendarMedia, val loading: Boolean = false, val error: String? = null)

/** 상세를 열 때 같은 날 GET을 다시 읽는다. 오래된 outbox 영수증이 댓글 목록을 고정하지 않는다. */
class RecordDetailController(private val field: FieldController, private val original: CalendarMedia,
    private val scope: CoroutineScope) : AutoCloseable {
    private val owner = field.state.value.user?.id
    private val serverId = if (original.json["local"] == true) original.text("serverId") else original.id
    private val mutable = MutableStateFlow(RecordDetailState(original))
    val state = mutable.asStateFlow()
    private var generation = 0
    private var fetch: Job? = null
    fun refresh() {
        if (serverId == null || owner == null || owner != field.state.value.user?.id) return
        val expected = ++generation
        fetch?.cancel()
        fetch = scope.launch {
            mutable.value = mutable.value.copy(loading = true, error = null)
            try {
                val row = field.calendarMedia(original.date_key, original.date_key).firstOrNull { it.id == serverId }
                    ?: throw ApiFailure("서버에서 이 사진을 찾을 수 없습니다", status = 404)
                if (expected == generation && owner == field.state.value.user?.id)
                    mutable.value = RecordDetailState(row)
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                if (expected == generation && owner == field.state.value.user?.id)
                    mutable.value = mutable.value.copy(error = e.message ?: "서버 기록을 불러오지 못했습니다")
            } finally {
                if (expected == generation) mutable.value = mutable.value.copy(loading = false)
            }
        }
    }
    override fun close() { generation++; fetch?.cancel() }
}
