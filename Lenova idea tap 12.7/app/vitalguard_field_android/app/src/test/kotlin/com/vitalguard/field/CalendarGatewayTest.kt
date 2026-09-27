package com.vitalguard.field

import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.session.FieldCoordinator
import com.vitalguard.field.ui.record.RecordActions
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.net.UnknownHostException
import java.nio.file.Files

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class CalendarGatewayTest {
    @Test fun `주간 범위와 JWT로 조회하고 기존 CalendarMedia 행을 읽는다`() = runTest {
        val live = LiveGateway(JsonTransport { method, path, token, body ->
            assertEquals("GET", method); assertEquals("/api/calendar/media?from=2026-09-27&to=2026-10-03", path)
            assertEquals("jwt", token); assertNull(body)
            ApiReply(200, mapOf("ok" to true, "media" to listOf(mapOf("id" to "server", "date_key" to "2026-09-27",
                "client_operation_id" to "operation", "canDelete" to true))))
        })
        val media = live.calendarMedia("jwt", "2026-09-27", "2026-10-03").single()
        assertEquals("server", media.id); assertEquals("operation", media.operationId); assertTrue(media.canDelete!!)
    }
    @Test fun `사진은 다운로드 URL API가 발급한 주소로만 내려받는다`() = runTest {
        val live = LiveGateway(JsonTransport { method, path, token, _ ->
            assertEquals("GET", method); assertEquals("/api/calendar/media/download-url?id=server%2Fid", path)
            assertEquals("jwt", token); ApiReply(200, mapOf("ok" to true, "url" to "https://unit.invalid/signed"))
        }, downloadTransport = DownloadTransport { url -> assertEquals("https://unit.invalid/signed", url); PHOTO_BYTES })
        assertArrayEquals(PHOTO_BYTES, live.calendarPhoto("jwt", "server/id"))
    }
    @Test fun `음성은 목록 GET의 audio_url만 사용하고 댓글 ID로 다운로드 API를 만들지 않는다`() = runTest {
        val live = LiveGateway(JsonTransport { _, _, _, _ -> error("댓글의 download-url API는 없다") },
            downloadTransport = DownloadTransport { url -> assertEquals("https://unit.invalid/voice-signed", url); byteArrayOf(1, 2) })
        val comment = MediaComment(mapOf("id" to "comment", "media_id" to "photo", "body" to "",
            "audio_storage_key" to "private/audio.m4a", "audio_url" to "https://unit.invalid/voice-signed", "audio_ms" to 7744))
        assertArrayEquals(byteArrayOf(1, 2), live.calendarVoice(comment))
        for (url in listOf(null, "", "http://unit.invalid/audio", "https://user:secret@unit.invalid/audio", "file:///tmp/audio")) {
            val missing = MediaComment(comment.json + ("audio_url" to url))
            assertEquals(voiceUrlUnavailable, failure { live.calendarVoice(missing) }.message)
        }
    }
    @Test fun `삭제 유예 403 코드와 문구는 그대로 전달하고 로컬 기록은 유지한다`() = runTest {
        val message = "삭제 유예 시간(10분)이 지났습니다"
        val live = LiveGateway(JsonTransport { method, path, _, _ ->
            assertEquals("DELETE", method); assertTrue(path.startsWith("/api/calendar/media?id="))
            ApiReply(403, mapOf("ok" to false, "code" to "MEDIA_DELETE_WINDOW_EXPIRED", "error" to message))
        })
        val gateway = object : OutboxGateway() {
            override suspend fun deleteCalendarMedia(token: String, id: String) = live.deleteCalendarMedia(token, id)
        }
        val rig = outboxRig(gateway); val photo = rig.photo(); rig.box.send(photo)
        val before = rig.store.keys("a").toSet()
        val error = failure { rig.box.deletePhoto(photo.id) }
        assertEquals(403, error.status); assertEquals("MEDIA_DELETE_WINDOW_EXPIRED", error.code); assertEquals(message, error.message)
        assertEquals(before, rig.store.keys("a").toSet()); assertNotNull(rig.box.entry(photo.id)); assertNotNull(rig.store.readBytes("a", photo.bytesKey))
        val actions = RecordActions(rig.box, backgroundScope)
        actions.discard(rig.box.entry(photo.id)!!); runCurrent()
        assertEquals(message, actions.state.value[actions.stateKey(photo)]!!.error)
    }
    @Test fun `서버 삭제 성공 뒤에만 부모와 딸린 파일을 지운다`() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle(); rig.box.sendBundle(bundle.photo.id)
        val child = rig.box.enqueue(OutboxKind.text, "새 메모".toByteArray(), emptyMap(), "현장", dependsOn = bundle.photo.id)
        rig.box.deletePhoto(bundle.photo.id)
        assertNull(rig.box.entry(bundle.photo.id)); assertTrue(rig.box.dependents(bundle.photo.id).isEmpty())
        assertNull(rig.store.readBytes("a", child.bytesKey))
        assertTrue(rig.field.calendarMedia("2026-09-01", "2026-09-30").isEmpty())
    }
    @Test fun `네트워크 복귀 알림만으로 오프라인 표시가 풀린다`() = runTest {
        val rig = outboxRig(); rig.field.connectivityChanged(false)
        assertTrue(rig.field.state.value.offline)
        val writes = rig.gateway.writes.size
        rig.field.connectivityChanged(true)
        assertFalse(rig.field.state.value.offline); assertEquals(writes, rig.gateway.writes.size)
    }
    @Test fun `업로드 전 DNS 실패는 재시도 가능하고 제출 뒤 실패는 불명이다`() = runTest {
        for (submitted in listOf(false, true)) {
            val live = LiveGateway(JsonTransport { _, _, _, _ -> error("unused") }, multipartTransport = MultipartTransport { _, _, _, _, started ->
                if (submitted) started()
                throw UnknownHostException("test")
            })
            val error = failure { live.upload("jwt", PHOTO_BYTES, PHOTO_FIELDS + ("clientOperationId" to "id")) }
            assertEquals(submitted, error.uncertainWrite); assertTrue(error.networkUnreachable)
        }
    }
    @Test fun `사진 캐시는 계정별로 분리되고 읽어도 칠일 만료를 연장하지 않는다`() = runTest {
        val root = Files.createTempDirectory("calendar-cache-test").toFile()
        try {
            val clock = MutableClock(); val cache = CalendarFileCache(root, clock)
            cache.write("a", "../../사진", PHOTO_BYTES)
            assertNull(cache.read("b", "../../사진")); assertArrayEquals(PHOTO_BYTES, cache.read("a", "../../사진"))
            clock.advance(6 * 86400); assertArrayEquals(PHOTO_BYTES, cache.read("a", "../../사진"))
            clock.advance(86400); assertNull(cache.read("a", "../../사진"))
            assertFalse(root.walkTopDown().any { it.isFile })
        } finally { root.deleteRecursively() }
    }
    @Test fun `완료 사진은 서버에서 받고 두번째 열람은 계정 캐시를 사용한다`() = runTest {
        val root = Files.createTempDirectory("calendar-controller-cache").toFile()
        try {
            var downloads = 0
            val gateway = object : OutboxGateway() {
                override suspend fun calendarPhoto(token: String, id: String): ByteArray { downloads++; return PHOTO_BYTES }
            }
            val field = FieldCoordinator(gateway, MemoryStore(), backgroundScope, photoCache = CalendarFileCache(root))
            field.signIn("a", "mock")
            val server = CalendarMedia(mapOf("id" to "server", "date_key" to "2026-09-27"))
            assertArrayEquals(PHOTO_BYTES, field.photoBytes(server)); field.photoBytes(server); assertEquals(1, downloads)
            field.signIn("b", "mock"); field.photoBytes(server); assertEquals(2, downloads)
        } finally { root.deleteRecursively() }
    }
}
