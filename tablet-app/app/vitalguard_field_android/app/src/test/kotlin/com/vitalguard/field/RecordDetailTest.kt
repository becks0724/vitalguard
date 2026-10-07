@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package com.vitalguard.field

import com.vitalguard.field.capture.captureRecordedTime
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.time.*
import java.util.TimeZone

// 서버 route.ts/listCalendarMedia/listCommentsForMedia의 응답 모양. 실서버 응답을 수집한 자료가 아닌 합성 표본이다.
private fun commentRow(id: String, extra: JsonObject = emptyMap()): JsonObject = mapOf(
    "id" to id, "media_id" to "remote-photo", "body" to "메모 $id", "author_name" to "담당관",
    "created_at" to "2026-09-27T03:00:02.862Z", "audio_storage_key" to null, "audio_ms" to null) + extra
private fun remotePhoto() = CalendarMedia(mapOf("id" to "remote-photo", "date_key" to "2026-09-27",
    "captured_at" to "2026-09-27T02:08:00Z", "annotationId" to "remote-ink", "comments" to listOf(
        commentRow("text-1", mapOf("client_operation_id" to "text-op")), commentRow("text-2"), commentRow("text-3"),
        commentRow("voice-1", mapOf("body" to "", "audio_storage_key" to "audio/key.m4a", "audio_ms" to 7744,
            "client_operation_id" to "voice-op", "audio_url" to "https://unit.invalid/audio")))))

class RecordDetailTest {
    @Test fun fullServerCommentsAndLocalAttachmentsAreMergedByOperationIdAndReceipt() {
        fun child(id: String, kind: OutboxKind, receipt: JsonObject? = null) = OutboxEntry(id, "a", kind,
            mapOf("clientOperationId" to id), "현장", Instant.EPOCH, false, receipt = receipt, dependsOn = "parent")
        val children = listOf(child("text-op", OutboxKind.text), child("voice-op", OutboxKind.voice),
            child("second-local", OutboxKind.text, mapOf("id" to "text-2")),
            child("ink-op", OutboxKind.ink, mapOf("id" to "remote-ink")), child("new-text", OutboxKind.text),
            child("new-voice", OutboxKind.voice), child("new-ink", OutboxKind.ink))
        val merged = RecordAttachments(remotePhoto(), children)
        assertEquals(listOf("text-1", "text-2", "text-3", "voice-1"), merged.comments.map { it.id })
        assertEquals(4, merged.textCount); assertEquals(2, merged.voiceCount); assertEquals(2, merged.knownInkCount)
        assertTrue(merged.inkCountUnverified)
        assertEquals("주석 2개 이상 · 메모 4 · 음성 2", merged.counts)
        assertEquals(setOf("ink-op", "new-ink", "new-text", "new-voice"), merged.local.map { it.id }.toSet())
    }

    @Test fun storageKeyAloneDeterminesVoiceAndMissingDurationOrUrlNeverBecomesZero() {
        val rows = listOf(commentRow("text", mapOf("audio_ms" to 7744, "audio_url" to "https://unit.invalid/unused")),
            commentRow("voice", mapOf("audio_storage_key" to "key")))
        val merged = RecordAttachments(CalendarMedia(remotePhoto().json + ("comments" to rows)), emptyList())
        assertEquals(1, merged.voiceCount); assertEquals(1, merged.textCount)
        assertNull(calendarVoiceUrl(merged.comments.last())); assertNull(merged.comments.last().audio_ms)
        assertEquals("주석 1개 이상 · 메모 1 · 음성 1", merged.counts)
    }

    @Test fun oneLatestAnnotationIdNeverClaimsToBeTheFullSameDayRevisionCount() {
        val merged = RecordAttachments(remotePhoto(), emptyList())
        assertEquals("주석 1개 이상 · 메모 3 · 음성 1", merged.counts)
        assertTrue(merged.inkCountUnverified); assertEquals("remote-ink", merged.latestAnnotationId)
        val withoutInk = RecordAttachments(CalendarMedia(remotePhoto().json + ("annotationId" to null)), emptyList())
        assertEquals("주석 0 · 메모 3 · 음성 1", withoutInk.counts); assertFalse(withoutInk.inkCountUnverified)
    }

    @Test fun openingServerReferenceFetchesEveryCommentInsteadOfKeepingItsOldSingleComment() = runTest {
        val requests = mutableListOf<Pair<String, String>>()
        val gateway = object : OutboxGateway() {
            override suspend fun calendarMedia(token: String, from: String, to: String): List<CalendarMedia> {
                requests += from to to; return listOf(remotePhoto())
            }
        }
        val rig = outboxRig(gateway)
        val reference = rig.box.referenceServerPhoto(CalendarMedia(remotePhoto().json + ("comments" to listOf(commentRow("old")))))
        val detail = RecordDetailController(rig.field, fromOutbox(reference), backgroundScope)
        assertEquals(1, detail.state.value.media.comments.size)
        detail.refresh(); runCurrent()
        assertEquals(listOf("2026-09-27" to "2026-09-27"), requests)
        assertEquals(4, detail.state.value.media.comments.size)
        assertEquals("주석 1개 이상 · 메모 3 · 음성 1", RecordAttachments(detail.state.value.media, emptyList()).counts)
        assertTrue(gateway.writes.isEmpty()); detail.close()
    }

    @Test fun detailComment401OnlyChangesItsErrorAndNeverErasesEarlierComments() = runTest {
        val gateway = object : OutboxGateway() {
            override suspend fun calendarMedia(token: String, from: String, to: String): List<CalendarMedia> =
                throw ApiFailure("인증 필요", status = 401, action = "reauth")
        }
        val rig = outboxRig(gateway)
        val before = rig.field.state.value
        val detail = RecordDetailController(rig.field, remotePhoto(), backgroundScope)
        detail.refresh(); runCurrent()
        assertEquals(auxiliaryAccessDenied, detail.state.value.error); assertFalse(detail.state.value.loading)
        assertEquals(4, detail.state.value.media.comments.size); assertEquals(before, rig.field.state.value)
        assertEquals(0, gateway.refreshes); detail.close()
    }

    @Test fun lateDetailResponseCannotReplaceClosedDetailOrAnotherAccountsData() = runTest {
        val gate = CompletableDeferred<List<CalendarMedia>>()
        val gateway = object : OutboxGateway() {
            override suspend fun calendarMedia(token: String, from: String, to: String) = withContext(NonCancellable) { gate.await() }
        }
        val rig = outboxRig(gateway)
        val original = CalendarMedia(remotePhoto().json + ("comments" to emptyList<Any>()))
        val detail = RecordDetailController(rig.field, original, backgroundScope)
        detail.refresh(); runCurrent(); detail.close(); rig.field.signIn("b", "mock")
        gate.complete(listOf(remotePhoto())); runCurrent()
        assertTrue(detail.state.value.media.comments.isEmpty())
    }

    @Test fun commentsAndPhotoTimesShareTheDeviceZoneFormatterWithoutChangingCaptureStampContract() {
        val original = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Seoul"))
            assertEquals("2026-09-27 12:00:02", captureRecordedTime("2026-09-27T03:00:02.862Z"))
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
            assertEquals("2026-09-27 03:00:02", captureRecordedTime("2026-09-27T03:00:02.862Z"))
            assertEquals("2026-09-27 12:00:02", com.vitalguard.field.capture.captureKstStamp(Instant.parse("2026-09-27T03:00:02.862Z")))
        } finally { TimeZone.setDefault(original) }
    }
}
