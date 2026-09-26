package com.vitalguard.field.pilot.capture

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class CapturePipelineTest {
    // capture_ocr_test.dart: 원본 OCR 선행 + 신원 필드 제외 + 로컬 보관 결과.
    @Test fun originalOcrPrecedesStampAndFieldsContainNoIdentity() = runBlocking {
        val port = FakeCapturePort().apply {
            fix = CaptureFix(35.12345, 127.12345, 12.0)
            server = "전라남도 순천시 중앙로 1"
        }
        val result = pipeline(port).runCapture(siteId = "site-1")
        assertEquals(0, result.uploaded)
        assertEquals(1, result.queued)
        assertEquals(listOf("capture-1"), result.queuedIds)
        assertEquals(listOf(
            "location", "server-address", "ocr:/original/full-resolution.jpg",
            "stamp-resize:/original/full-resolution.jpg", "save-local",
        ), port.calls)
        val fields = port.savedFields.single()
        assertEquals("2026-08-19", fields["dateKey"])
        assertEquals("2026-08-19T14:07:17+09:00", fields["capturedAt"])
        assertEquals("site-1", fields["siteId"])
        assertEquals("현장 사진", fields["title"])
        assertEquals("전라남도 순천시 중앙로 1", fields["roadAddress"])
        assertEquals("35.123450", fields["latitude"])
        assertEquals("127.123450", fields["longitude"])
        assertTrue(fields.containsKey("ocrText"))
        assertFalse(fields.keys.any { it in setOf("uploader", "workerName", "workerId") })
        assertTrue(fields.getValue("ocrText").contains("작업자/ID: 홍길동, EMP-6861"))
    }

    // capture_ocr_test.dart: 서버 주소가 없을 때만 기기 추정 주소로 내려간다.
    @Test fun deviceAddressIsOnlyUsedWhenServerAddressIsAbsent() = runBlocking {
        val port = FakeCapturePort().apply {
            fix = CaptureFix(35.12345, 127.12345)
            device = "광주광역시 동구 금남로 1"
        }
        pipeline(port).runCapture(listOf("/original/document.jpg"), CaptureMode.document)
        assertEquals(listOf("location", "server-address", "device-address"), port.calls.take(3))
        assertEquals("광주광역시 동구 금남로 1 (기기 추정)", port.savedFields.single()["roadAddress"])
    }

    @Test fun eachPageUsesItsOwnOriginalAndPageNumber() = runBlocking {
        val port = FakeCapturePort()
        val paths = listOf("/original/one.jpg", "/original/two.jpg", "/original/three.jpg")
        val deleted = mutableListOf<String>()
        val result = CapturePipeline(port, deleteOriginal = { deleted += it }).runCapture(paths, CaptureMode.document)
        assertEquals(3, result.queued)
        assertEquals(0, result.failed)
        assertEquals(listOf("location") + paths.flatMap { listOf("ocr:$it", "stamp-resize:$it", "save-local") }, port.calls)
        port.savedFields.forEachIndexed { index, fields ->
            assertEquals("서류 스캔 · 페이지 ${index + 1}", fields["title"])
            assertTrue(fields.getValue("ocrText").startsWith("페이지 ${index + 1}\n안전난간 점검\n"))
        }
        assertEquals(paths, deleted)
    }

    @Test fun pageFailuresAreCountedAndDoNotPreventLaterPagesOrCleanup() = runBlocking {
        val port = FakeCapturePort().apply {
            ocrFailures += "/original/one.jpg"
            stampFailures += "/original/two.jpg"
            saveFailures += "서류 스캔 · 페이지 3"
        }
        val paths = listOf("one", "two", "three", "four").map { "/original/$it.jpg" }
        val events = port.calls
        val result = CapturePipeline(port, deleteOriginal = { events += "delete:$it" }).runCapture(paths, CaptureMode.document)
        assertEquals(3, result.failed)
        assertEquals(1, result.queued)
        assertEquals("저장 실패", result.lastError)
        assertEquals("서류 스캔 · 페이지 4", port.savedFields.single()["title"])
        assertTrue(port.savedFields.single().getValue("ocrText").startsWith("페이지 4\n"))
        assertFalse(events.contains("stamp-resize:/original/one.jpg"))
        assertEquals(paths.map { "delete:$it" }, events.takeLast(4))
        assertEquals("기기에 저장됨 · 1건 · 주석·메모를 붙인 뒤 전송\n3건 처리 실패\n저장 실패", result.operationMessage)
    }

    @Test fun optionalLocationFailureStillSavesWithMissingLocation() = runBlocking {
        val port = FakeCapturePort().apply { locationFailure = true }
        val result = pipeline(port).runCapture()
        assertEquals(0, result.failed)
        assertEquals(1, result.queued)
        assertFalse(port.calls.any { it.endsWith("address") })
        assertFalse(port.savedFields.single().containsKey("latitude"))
        assertTrue(result.records.single().stampLines.contains("위치 미확보"))
    }

    @Test fun failedOrBlankServerAddressFallsBackToDevice() = runBlocking {
        for (failServer in listOf(true, false)) {
            val port = FakeCapturePort().apply {
                fix = CaptureFix(35.12345, 127.12345)
                serverFailure = failServer
                server = "  \n "
                device = "광주광역시 동구 금남로 1"
            }
            assertEquals(0, pipeline(port).runCapture().failed)
            assertEquals("광주광역시 동구 금남로 1 (기기 추정)", port.savedFields.single()["roadAddress"])
        }
    }

    @Test fun bothAddressFailuresKeepCoordinatesAndDoNotFailThePhoto() = runBlocking {
        val port = FakeCapturePort().apply {
            fix = CaptureFix(35.12345, 127.12345)
            serverFailure = true
            deviceFailure = true
        }
        val result = pipeline(port).runCapture()
        assertEquals(1, result.queued)
        assertEquals(0, result.failed)
        assertFalse(port.savedFields.single().containsKey("roadAddress"))
        assertEquals("35.123450", port.savedFields.single()["latitude"])
    }

    @Test fun emptyOcrGetsTheSameFallbackAndStampLines() = runBlocking {
        val port = FakeCapturePort().apply { recognized = "  \n " }
        val result = pipeline(port).runCapture()
        assertEquals(
            "페이지 1\n[텍스트 미검출]\n[2026-08-19 14:07:17]\n위치 미확보\n작업자/ID: 홍길동, EMP-6861",
            result.records.single().fields["ocrText"],
        )
    }

    @Test fun emptyInputDoesNotRequestLocationOrWriteFiles() = runBlocking {
        val port = FakeCapturePort()
        val result = pipeline(port).runCapture(emptyList())
        assertEquals(0, result.queued)
        assertEquals(0, result.failed)
        assertTrue(port.calls.isEmpty())
    }

    @Test fun cancellationStillDeletesEveryOriginal() = runBlocking {
        val port = object : FakeCapturePort() {
            override suspend fun recognizeOriginal(path: String): String { throw CancellationException("closed") }
        }
        val deleted = mutableListOf<String>()
        val paths = listOf("/original/one.jpg", "/original/two.jpg")
        try {
            CapturePipeline(port, deleteOriginal = { deleted += it }).runCapture(paths)
            fail("Cancellation must propagate")
        } catch (_: CancellationException) {
            assertEquals(paths, deleted)
        }
    }

    @Test fun eachStageReportsElapsedMillisecondsFromAnInjectedClock() = runBlocking {
        var tick = 0L
        val result = CapturePipeline(FakeCapturePort(), nanoTime = { tick++ * 10_000_000 }, deleteOriginal = {}).runCapture()
        assertEquals(CaptureTimings(10, 10, 10, 10, 10), result.records.single().timings)
    }
}
