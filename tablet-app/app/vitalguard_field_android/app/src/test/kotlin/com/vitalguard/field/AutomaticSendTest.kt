package com.vitalguard.field

import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.*
import com.vitalguard.field.ui.outbox.historyEntries
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AutomaticSendTest {
    @Test fun `상세를 닫으면 대기를 영속화하고 전송중에서 완료로 이동한다`() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle(); rig.box.beginReview(bundle.photo.id)
        rig.box.resumeAutomatic(true); assertTrue(rig.gateway.writes.isEmpty())
        rig.gateway.gate = CompletableDeferred()
        val send = async { rig.box.releaseBundle(bundle.photo.id) }; runCurrent()
        assertEquals(OutboxPhase.sending, rig.box.entry(bundle.photo.id)!!.phase)
        assertTrue(rig.box.items.value.all { it.autoSendReady })
        rig.gateway.gate!!.complete(Unit); send.await()
        assertTrue(rig.box.bundleCompleted(bundle.photo.id))
        assertEquals(listOf(OutboxKind.photo, OutboxKind.ink, OutboxKind.text, OutboxKind.voice), rig.gateway.writes.map { it.kind })
    }
    @Test fun `일반 실패는 닫힘과 네트워크 복귀로 재전송하지 않고 수동으로 전송한다`() = runTest {
        val rig = outboxRig(); val photo = rig.photo()
        rig.gateway.writeFailure = ApiFailure("거부", status = 403)
        rig.box.releaseBundle(photo.id)
        rig.gateway.writeFailure = null
        rig.box.releaseBundle(photo.id); rig.box.resumeAutomatic(true)
        assertEquals(1, rig.gateway.writes.size); assertEquals(OutboxPhase.failed, rig.box.entry(photo.id)!!.phase)
        rig.box.sendBundle(photo.id, retry = true)
        assertEquals(2, rig.gateway.writes.size); assertTrue(rig.box.bundleCompleted(photo.id))
    }
    @Test fun `연결 전에 실패한 네트워크 항목과 대기는 네트워크 복귀 시 재시도한다`() = runTest {
        val rig = outboxRig(); val first = rig.photo()
        rig.gateway.writeFailure = ApiFailure("연결 실패", networkUnreachable = true)
        rig.box.releaseBundle(first.id)
        assertTrue(rig.box.entry(first.id)!!.networkFailure)
        val second = rig.photo(); rig.box.releaseBundle(second.id)
        assertEquals(OutboxPhase.waiting, rig.box.entry(second.id)!!.phase)
        rig.gateway.writeFailure = null; rig.field.connectivityChanged(true)
        rig.box.resumeAutomatic(networkRestored = true)
        assertTrue(rig.box.bundleCompleted(first.id)); assertTrue(rig.box.bundleCompleted(second.id))
        assertEquals(3, rig.gateway.writes.size)
    }
    @Test fun `결과 불명은 네트워크 복귀나 상세 닫힘으로 바뀌지 않는다`() = runTest {
        val rig = outboxRig(); val photo = rig.photo()
        rig.gateway.writeFailure = ApiFailure("응답 유실", uncertainWrite = true, networkUnreachable = true)
        rig.box.releaseBundle(photo.id)
        rig.gateway.writeFailure = null; rig.field.connectivityChanged(true)
        rig.box.resumeAutomatic(true); rig.box.releaseBundle(photo.id)
        assertEquals(1, rig.gateway.writes.size); assertEquals(OutboxPhase.uncertain, rig.box.entry(photo.id)!!.phase)
        assertFalse(rig.box.entry(photo.id)!!.networkFailure)
    }
    @Test fun `완료 사진에 붙인 추가 메모와 음성만 자동 전송한다`() = runTest {
        val rig = outboxRig(); val photo = rig.photo(); rig.box.releaseBundle(photo.id)
        rig.box.beginReview(photo.id)
        val serverId = rig.box.entry(photo.id)!!.receipt!!["id"]
        rig.box.enqueue(OutboxKind.text, "추가 메모".toByteArray(), emptyMap(), "현장", dependsOn = photo.id)
        rig.box.enqueue(OutboxKind.voice, byteArrayOf(3), emptyMap(), "현장", dependsOn = photo.id)
        rig.box.resumeAutomatic(true); assertEquals(1, rig.gateway.writes.size)
        rig.box.releaseBundle(photo.id)
        assertEquals(listOf(OutboxKind.photo, OutboxKind.text, OutboxKind.voice), rig.gateway.writes.map { it.kind })
        assertEquals(serverId, rig.gateway.writes[1].fields["mediaId"])
        assertEquals(serverId, rig.gateway.writes[2].fields["commentOf"])
    }
    @Test fun `서버 사진 참조는 사진 업로드와 가짜 완료 이력을 만들지 않는다`() = runTest {
        val rig = outboxRig()
        val media = CalendarMedia(mapOf("id" to "remote", "date_key" to "2026-09-27", "site_id" to "site-b"))
        val photo = rig.box.referenceServerPhoto(media)
        assertEquals(photo.id, rig.box.referenceServerPhoto(media).id)
        assertTrue(historyEntries(rig.box.items.value).isEmpty())
        rig.box.enqueue(OutboxKind.text, "메모".toByteArray(), emptyMap(), "현장", dependsOn = photo.id)
        rig.box.releaseBundle(photo.id)
        assertEquals(listOf(OutboxKind.text), rig.gateway.writes.map { it.kind })
        assertEquals("remote", rig.gateway.writes.single().fields["mediaId"])
    }
    @Test fun `동시 닫힘과 재접속에도 한 작업 ID를 한 번만 전송한다`() = runTest {
        val rig = outboxRig(); val photo = rig.photo(); rig.box.readyBundle(photo.id)
        rig.gateway.gate = CompletableDeferred()
        val first = async { rig.box.releaseBundle(photo.id) }; runCurrent()
        val second = async { rig.box.resumeAutomatic(true) }; runCurrent()
        assertEquals(1, rig.gateway.writes.size)
        rig.gateway.gate!!.complete(Unit); first.await(); second.await()
        assertTrue(rig.box.bundleCompleted(photo.id))
    }
    @Test fun confirmedMemoStaysOneLocalAttachmentUntilPhotoDetailCloses() = runTest {
        val rig = outboxRig(); val photo = rig.photo()
        val workspace = RecordWorkspace(rig.field, rig.box, FakeInkRenderer(), FakeSpeech(), FakeVoice(), backgroundScope, {})
        workspace.bindAccount("a"); workspace.openDetail(photo.id)
        val input = workspace.input(photo.id); runCurrent()
        val text = "보호구 미착용 확인 2층"
        input.note(text); input.save()
        assertTrue(rig.box.dependents(photo.id).isEmpty())
        input.confirm(true); input.save(); input.save()
        assertNull(input.state.value.error)
        // ViewModel의 원장 갱신/재접속 경로도 작성 중인 상세를 전송하지 않아야 한다.
        rig.box.load(); rig.box.resumeAutomatic(networkRestored = true); runCurrent()
        val memo = rig.box.dependents(photo.id).single()
        assertEquals(OutboxKind.text, memo.kind); assertEquals(OutboxPhase.waiting, memo.phase)
        assertFalse(memo.autoSendReady); assertEquals(photo.id, workspace.detail.value)
        assertEquals(text, rig.store.readBytes("a", memo.bytesKey)!!.toString(Charsets.UTF_8))
        assertTrue(rig.gateway.writes.isEmpty())
        assertTrue(input.leave()); workspace.finishInput(input)
        rig.box.resumeAutomatic(); runCurrent()
        assertEquals(photo.id, workspace.detail.value)
        assertEquals(memo, rig.box.dependents(photo.id).single()); assertTrue(rig.gateway.writes.isEmpty())
        workspace.closeDetail(); runCurrent()
        assertNull(workspace.detail.value); assertTrue(rig.box.bundleCompleted(photo.id))
        val sent = rig.box.dependents(photo.id).single()
        assertEquals(memo.id, sent.id); assertEquals(OutboxPhase.completed, sent.phase)
        assertNull(rig.store.readBytes("a", sent.bytesKey))
        assertEquals(listOf(OutboxKind.photo, OutboxKind.text), rig.gateway.writes.map { it.kind })
        assertEquals(text, rig.gateway.writes.last().bytes.toString(Charsets.UTF_8))
        workspace.close()
    }
    @Test fun `워크스페이스는 탭 이동과 백그라운드 닫힘 뒤 달력으로 돌아가며 미확정 초안을 보존한다`() = runTest {
        val rig = outboxRig(); val photo = rig.photo()
        val workspace = RecordWorkspace(rig.field, rig.box, FakeInkRenderer(), FakeSpeech(), FakeVoice(), backgroundScope, {})
        workspace.bindAccount("a"); workspace.openDetail(photo.id)
        val input = workspace.input(photo.id); runCurrent(); input.note("아직 확인하지 않은 메모")
        workspace.background(); runCurrent()
        assertNull(workspace.detail.value); assertEquals(1L, workspace.closedDetail.value)
        assertTrue(rig.box.bundleCompleted(photo.id)); assertEquals(1, rig.gateway.writes.size)
        assertEquals("아직 확인하지 않은 메모", Json.decodeObject(rig.store.read("a", input.key)!!)["text"])
        workspace.close()
    }
    @Test fun `일곱 날이 지나도 미전송 추가분이 있는 부모 영수증은 남긴다`() = runTest {
        val rig = outboxRig(); val photo = rig.photo(); rig.box.releaseBundle(photo.id)
        rig.box.enqueue(OutboxKind.text, "미전송".toByteArray(), emptyMap(), "현장", dependsOn = photo.id)
        rig.clock.advance(8 * 86400)
        rig.box.purgeExpired()
        assertNotNull(rig.box.entry(photo.id))
    }
}
