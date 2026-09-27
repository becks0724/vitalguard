package com.vitalguard.field

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.data.*
import com.vitalguard.field.data.models.CalendarMedia
import com.vitalguard.field.data.record.mergeCalendarRecords
import com.vitalguard.field.ui.record.RecordCalendarContent
import com.vitalguard.field.ui.outbox.OutboxHistoryContent
import com.vitalguard.field.ui.shell.VgBackground
import com.vitalguard.field.ui.theme.VgTheme
import java.time.Instant
import java.time.LocalDate

private val fixedDay = LocalDate.parse("2026-09-27")
private fun previewEntry(id: String, hour: Int, phase: OutboxPhase = OutboxPhase.waiting) = OutboxEntry(
    id, "preview", OutboxKind.photo, mapOf("clientOperationId" to id, "title" to "안전난간 점검", "siteId" to "site-a",
        "dateKey" to fixedDay.toString(), "capturedAt" to "2026-09-27T${hour.toString().padStart(2, '0')}:15:00+09:00"),
    "광주 현장", Instant.parse("2026-09-27T00:15:00Z"), false, phase = phase)

@PreviewTest
@Preview(name = "RecordCalendar866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable
fun RecordCalendarPreview() {
    val local = listOf(previewEntry("local-one", 9), previewEntry("local-two", 11, OutboxPhase.failed).copy(message = "전송하지 못했습니다. 다시 전송해 주세요."))
    val server = CalendarMedia(mapOf("id" to "server-one", "date_key" to "2026-09-28", "captured_at" to "2026-09-28T10:30:00+09:00",
        "media_type" to "image", "title" to "작업 전 점검", "comments" to listOf(mapOf("id" to "voice-one", "media_id" to "server-one",
            "body" to "", "audio_storage_key" to "preview/voice.m4a", "audio_ms" to 12000))))
    VgTheme { Box(Modifier.fillMaxSize()) {
        VgBackground(Modifier.matchParentSize())
        RecordCalendarContent(fixedDay, mergeCalendarRecords(local, listOf(server)), today = fixedDay)
    } }
}

@PreviewTest
@Preview(name = "OutboxHistory866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable
fun OutboxHistoryPreview() {
    val entries = listOf(
        previewEntry("operation-completed", 8, OutboxPhase.completed).copy(completedAt = Instant.parse("2026-09-27T00:16:04Z"), receipt = mapOf("id" to "server-one")),
        previewEntry("operation-failed", 9, OutboxPhase.failed).copy(message = "파일 전송에 실패했습니다. [전송]을 눌러 주세요."),
        previewEntry("operation-uncertain", 10, OutboxPhase.uncertain).copy(needsVerification = true, message = "서버 반영 여부를 먼저 확인해 주세요."),
        previewEntry("operation-sending", 11, OutboxPhase.sending),
    )
    VgTheme { Box(Modifier.fillMaxSize()) {
        VgBackground(Modifier.matchParentSize())
        OutboxHistoryContent(entries.reversed(), account = "태블릿 담당자", busyIds = setOf("operation-sending"))
    } }
}
