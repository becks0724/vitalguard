package com.vitalguard.field

// Ports: record_contract_test.dart, hold_bundle_ui_test.dart의 로컬 열람/활성 조건.
// 역할/refresh/계정 epoch 공통 회귀는 기존 FieldCoordinatorTest/OfflineRestoreTest에 있다.
import com.vitalguard.field.data.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.mergeCalendarRecords
import com.vitalguard.field.ui.record.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class RecordContractTest {
    @Test fun originalDateLongIdAndUtcCaptureTimeArePreservedWithoutImpersonatingUploader() {
        val id = "원".repeat(140)
        val media = CalendarMedia(mapOf("id" to id, "date_key" to "2026-09-11", "captured_at" to "2026-09-11T15:30:00Z",
            "uploader" to "이전 담당관", "worker_id" to "OLD"))
        val fields = annotationFields(media)
        assertEquals("2026-09-11", fields["dateKey"]); assertEquals(id, fields["annotationOf"])
        assertTrue(fields.getValue("title").contains(id)); assertEquals("2026-09-12T00:30:00.000+09:00", fields["capturedAt"])
        assertFalse(fields.containsKey("uploader")); assertFalse(fields.containsKey("workerId"))
        assertEquals("2026-09-12T00:30:00.123456+09:00", asKstIso("2026-09-12T00:30:00.123456"))
        assertEquals("2026-09-12T00:30:00.000+09:00", asKstIso("2026-09-12T00:30:00+0900"))
    }
    @Test fun inkLimitHasTheExactMessageAndBoundary() {
        assertNull(inkUploadSizeError(2_097_152))
        assertEquals("잉크 크기 2048.0 KB가 전송 한도 2 MB (2,097,152바이트)를 넘었습니다. 기기에는 저장됩니다. 획을 줄인 뒤 다시 저장해 주세요.", inkUploadSizeError(2_097_153))
    }
    @Test fun photoBytesReadsLocalAndReportsMissingLocalOrServerSourcesSeparately() = runTest {
        val rig = outboxRig(); val photo = rig.photo()
        assertArrayEquals(PHOTO_BYTES, rig.field.photoBytes(fromOutbox(photo)))
        assertEquals("사진을 찾을 수 없습니다", failure { rig.field.photoBytes(CalendarMedia(fromOutbox(photo).json - "local")) }.message)
        rig.store.remove("a", photo.bytesKey)
        assertEquals("원본이 기기에 없습니다", failure { rig.field.photoBytes(fromOutbox(photo)) }.message)
        assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun calendarShowsLocalAndCompletedServerPhotosAndCountsAttachments() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle(); rig.clock.advance(1); val newest = rig.photo()
        assertEquals(setOf(newest.id, bundle.photo.id), mergeCalendarRecords(rig.box.items.value, emptyList()).map { it.local!!.id }.toSet())
        assertEquals("주석 1 · 메모 1 · 음성 1", attachmentCounts(rig.box.dependents(bundle.photo.id)))
        rig.box.sendBundle(newest.id)
        val server = rig.field.calendarMedia("2026-09-01", "2026-09-30")
        val records = mergeCalendarRecords(rig.box.items.value, server)
        assertEquals(2, records.size); assertEquals(1, records.count { it.server })
    }
    @Test fun detailActionConditionsMatchWaitingFailedOfflineUncertainAndReauthentication() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle()
        val offline = photoActions(bundle.photo, bundle.all.drop(1), emptySet(), true)
        assertTrue(offline.editable); assertTrue(offline.deletable); assertFalse(offline.sendable)
        for (phase in listOf(OutboxPhase.uncertain, OutboxPhase.reauthenticate, OutboxPhase.sending)) {
            val state = photoActions(bundle.photo, listOf(bundle.voice.copy(phase = phase)), emptySet(), false)
            assertFalse(state.editable); assertFalse(state.deletable); assertFalse(state.sendable)
        }
        val busy = photoActions(bundle.photo, listOf(bundle.text), setOf(bundle.text.id), false)
        assertFalse(busy.editable); assertFalse(busy.sendable)
        val completedChild = photoActions(bundle.photo, listOf(bundle.text.copy(phase = OutboxPhase.completed)), emptySet(), false)
        assertTrue(completedChild.editable); assertFalse(completedChild.deletable)
        val failed = photoActions(bundle.photo.copy(phase = OutboxPhase.failed), emptyList(), emptySet(), false)
        assertTrue(failed.editable && failed.deletable && failed.sendable)
    }
    @Test fun draftCleanupDoesNotClearAnotherPhotosSession() = runTest {
        val rig = outboxRig(); val photo = rig.photo()
        rig.store.write("a", recordSessionKey, Json.encode(mapOf("media" to mapOf("id" to "other"))))
        localRecordDraftKeys(photo.id).forEach { rig.store.write("a", it, "draft") }
        clearLocalRecordDrafts(rig.field, photo.id)
        localRecordDraftKeys(photo.id).forEach { assertNull(rig.store.read("a", it)) }
        assertNotNull(rig.store.read("a", recordSessionKey))
    }
    @Test fun accountActionPlacementReadsLeftOrDefaultsRightWithoutWriting() = runTest {
        val store = FaultStore()
        store.write("a", vgActionSidePreferenceKey, "left")
        val writes = store.writtenKeys.toList()
        val a = ActionPlacement(store, "a"); val b = ActionPlacement(store, "b")
        a.load(); b.load()
        assertTrue(a.state.value.loaded && b.state.value.loaded)
        assertEquals(ActionSide.left, a.state.value.side); assertEquals(ActionSide.right, b.state.value.side)
        assertEquals(writes, store.writtenKeys)
    }
}
