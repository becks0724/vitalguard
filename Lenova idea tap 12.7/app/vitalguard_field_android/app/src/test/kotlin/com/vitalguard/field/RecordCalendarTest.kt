package com.vitalguard.field

import com.vitalguard.field.data.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.*
import org.junit.Assert.*
import org.junit.Test
import java.time.*

class RecordCalendarTest {
    private val sunday = LocalDate.parse("2026-09-27")
    private fun photo(id: String = "p", captured: String? = "2026-09-27T09:35:00+09:00", phase: OutboxPhase = OutboxPhase.waiting) =
        OutboxEntry(id, "a", OutboxKind.photo, buildMap {
            put("dateKey", "2026-09-27"); put("clientOperationId", id); captured?.let { put("capturedAt", it) }
        }, "현장", Instant.parse("2026-09-27T00:00:00Z"), false, phase = phase)
    private fun media(id: String, extra: JsonObject = emptyMap()) = CalendarMedia(mapOf("id" to id,
        "date_key" to "2026-09-27", "media_type" to "image", "captured_at" to "2026-09-27T09:35:00+09:00") + extra)

    @Test fun `주는 일요일에 시작하며 달과 해의 경계를 넘는다`() {
        assertEquals(sunday, weekStart(sunday.plusDays(6)))
        assertEquals(LocalDate.parse("2026-10-03"), weekDays(sunday).last())
        assertEquals(LocalDate.parse("2025-12-28"), weekStart(LocalDate.parse("2026-01-01")))
    }
    @Test fun `주 행 높이가 균등하다 - 미니 월간은 여섯 개의 일곱 칸 행이다`() {
        val cells = monthDays(YearMonth.of(2026, 9))
        assertEquals(42, cells.size); assertEquals(DayOfWeek.SUNDAY, cells.first().dayOfWeek)
        assertTrue(cells.zipWithNext().all { (a, b) -> a.plusDays(1) == b })
    }
    @Test fun `시간 범위는 24시간이다 - 첫 렌더는 07시다`() {
        assertEquals(0, WEEK_START_HOUR); assertEquals(24, WEEK_END_HOUR); assertEquals(44, WEEK_HOUR_DP); assertEquals(7, INITIAL_SCROLL_HOUR)
        assertEquals(0, captureMinute("2026-09-27T00:00:00+09:00"))
        assertEquals(1439, captureMinute("2026-09-27T23:59:59+09:00"))
    }
    @Test fun `사진은 촬영 시각 위치에 놓는다 - KST로 해석하고 같은 시간대는 묶는다`() {
        val records = mergeCalendarRecords(listOf(photo(), photo("p2", "2026-09-27T00:59:00Z")), emptyList())
        val block = calendarBlocks(records, sunday).single()
        assertEquals(9, block.hour); assertEquals(575, records.first().minute); assertEquals(2, block.records.size)
        assertEquals("사진 2 · 음성 0", block.label)
    }
    @Test fun `시각을 못 읽은 사진도 버리지 않는다 - 종일 띠에 남는다`() {
        val records = mergeCalendarRecords(listOf(photo(captured = "bad"), photo("p2", null)), emptyList())
        val block = calendarBlocks(records, sunday).single()
        assertNull(block.hour); assertEquals(2, block.records.size)
    }
    @Test fun `같은 사진은 작업 ID나 sourceKey나 영수증 ID로 합친다`() {
        for (mode in 0..2) {
            val local = photo(phase = OutboxPhase.failed).copy(sourceKey = "source", receipt = if (mode == 2) mapOf("id" to "remote") else null)
            val remote = media("remote", when (mode) { 0 -> mapOf("client_operation_id" to "p"); 1 -> mapOf("sourceKey" to "source"); else -> emptyMap() })
            val row = mergeCalendarRecords(listOf(local), listOf(remote, remote)).single()
            assertSame(remote, row.media); assertTrue(row.server); assertEquals(CalendarStatus.failed, row.status)
        }
    }
    @Test fun `미디어 블록은 사진과 음성 건수로 표기한다 - 서버 댓글과 딸린 음성은 중복 계산하지 않는다`() {
        val parent = photo(phase = OutboxPhase.completed)
        val voice = parent.copy(id = "voice", fields = mapOf("clientOperationId" to "voice"), kind = OutboxKind.voice,
            dependsOn = parent.id, receipt = mapOf("id" to "comment"))
        val remote = media("remote", mapOf("client_operation_id" to parent.id, "comments" to listOf(mapOf(
            "id" to "comment", "media_id" to "remote", "body" to "", "audio_storage_key" to "voice.m4a", "audio_ms" to 5000))))
        val rows = mergeCalendarRecords(listOf(parent, voice, voice.copy(id = "voice-new", fields = mapOf("clientOperationId" to "voice-new"),
            phase = OutboxPhase.waiting, receipt = null)), listOf(remote))
        assertEquals("사진 1 · 음성 2", calendarBlocks(rows, sunday).single().label)
    }
    @Test fun `불명 전송중 실패 대기 완료 순으로 묶음 상태를 표시한다`() {
        val phases = listOf(OutboxPhase.completed, OutboxPhase.waiting, OutboxPhase.failed, OutboxPhase.sending, OutboxPhase.uncertain)
        val expected = listOf(CalendarStatus.completed, CalendarStatus.stored, CalendarStatus.failed, CalendarStatus.sending, CalendarStatus.uncertain)
        phases.indices.forEach { index -> assertEquals(expected[index], calendarStatus(phases.take(index + 1).map { photo(phase = it) })) }
        assertEquals(CalendarStatus.uncertain, calendarStatus(listOf(photo().copy(needsVerification = true))))
    }
    @Test fun `성공한 주간 조회에서 사라진 완료 사진은 로컬 영수증으로 되살리지 않는다`() {
        assertTrue(mergeCalendarRecords(listOf(photo(phase = OutboxPhase.completed)), emptyList(), false).isEmpty())
        assertEquals(1, mergeCalendarRecords(listOf(photo()), emptyList(), false).size)
    }
}
