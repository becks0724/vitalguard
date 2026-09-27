package com.vitalguard.field

import com.vitalguard.field.data.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.time.*

@OptIn(ExperimentalCoroutinesApi::class)
class CalendarControllerTest {
    @Test fun `날짜 이동은 보이는 주를 조회하며 같은 주 날짜 선택은 다시 조회하지 않는다`() = runTest {
        val calls = mutableListOf<Pair<String, String>>()
        val gateway = object : OutboxGateway() {
            override suspend fun calendarMedia(token: String, from: String, to: String): List<CalendarMedia> {
                calls += from to to; return emptyList()
            }
        }
        val rig = outboxRig(gateway)
        val calendar = RecordCalendarController(rig.field, rig.box, backgroundScope,
            Clock.fixed(Instant.parse("2026-09-27T00:00:00Z"), ZoneOffset.UTC))
        calendar.bindAccount("a"); calendar.setVisible(true); runCurrent()
        assertEquals("2026-09-27" to "2026-10-03", calls.last())
        val count = calls.size
        calendar.select(LocalDate.parse("2026-09-30")); runCurrent(); assertEquals(count, calls.size)
        calendar.select(LocalDate.parse("2026-10-04")); runCurrent()
        assertEquals("2026-10-04" to "2026-10-10", calls.last())
        calendar.close()
    }
    @Test fun `이전 주나 다른 계정의 늦은 응답은 현재 달력을 덮지 않는다`() = runTest {
        val gate = CompletableDeferred<List<CalendarMedia>>()
        val gateway = object : OutboxGateway() {
            override suspend fun calendarMedia(token: String, from: String, to: String) = withContext(NonCancellable) { gate.await() }
        }
        val rig = outboxRig(gateway)
        val calendar = RecordCalendarController(rig.field, rig.box, backgroundScope, rig.clock)
        calendar.bindAccount("a"); calendar.setVisible(true); runCurrent()
        calendar.setVisible(false); calendar.bindAccount(null)
        gate.complete(listOf(CalendarMedia(mapOf("id" to "old", "date_key" to "2026-09-26"))))
        runCurrent(); assertTrue(calendar.state.value.server.isEmpty()); assertFalse(calendar.state.value.loaded)
        calendar.close()
    }
    @Test fun `완료 사진의 주석을 다시 만들면 기존 주석과 사진을 재전송하지 않는다`() = runTest {
        val rig = outboxRig(); val photo = rig.photo()
        val first = rig.editor(photo); first.stroke(); assertTrue(first.save()); first.close()
        rig.box.releaseBundle(photo.id)
        val oldInk = rig.box.dependents(photo.id).single()
        val next = rig.editor(rig.box.entry(photo.id)!!); next.stroke(); assertTrue(next.save()); next.close()
        rig.box.releaseBundle(photo.id)
        assertEquals(listOf(OutboxKind.photo, OutboxKind.ink, OutboxKind.ink), rig.gateway.writes.map { it.kind })
        assertEquals(OutboxPhase.completed, rig.box.entry(oldInk.id)!!.phase)
        assertEquals(2, rig.box.dependents(photo.id).size)
    }
    @Test fun `완료 사진에 남긴 새 초안도 같은 계정에서 복구한다`() = runTest {
        val rig = outboxRig(); val photo = rig.photo(); rig.box.releaseBundle(photo.id)
        RecordSession(rig.field, rig.box, "a").remember(fromOutbox(rig.box.entry(photo.id)!!), ink = true)
        val restored = RecordSession(rig.field, rig.box, "a").read()!!
        assertTrue(restored.ink); assertEquals(photo.id, restored.media.id)
        assertEquals(rig.box.entry(photo.id)!!.receipt!!["id"], restored.media.text("serverId"))
    }
}
