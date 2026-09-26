package com.vitalguard.field

import com.vitalguard.field.capture.*

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** capture_site_id_test.dart의 세 회귀를 로그인/서버 없는 포트 경계로 옮겼다. */
class CaptureSiteIdTest {
    @Test fun currentSiteIsFixedForEachCaptureEvenAfterAssignmentChanges() = runBlocking {
        val port = FakeCapturePort()
        val pipeline = pipeline(port)
        pipeline.runCapture(mode = CaptureMode.document, siteId = "first-site")
        pipeline.runCapture(mode = CaptureMode.document, siteId = "current-site")
        assertEquals("first-site", port.savedFields[0]["siteId"])
        assertEquals("current-site", port.savedFields[1]["siteId"])
    }

    @Test fun absentSiteNeverBorrowsTheSiteFromAnotherPendingPhoto() = runBlocking {
        val port = FakeCapturePort()
        val pipeline = pipeline(port)
        pipeline.runCapture(siteId = "other-site")
        // null / site_id 필드 없음 / site_id 빈 문자열의 원본 세 경우.
        for (site in listOf(null, null, "")) {
            pipeline.runCapture(mode = CaptureMode.document, siteId = site)
            assertFalse(port.savedFields.last().containsKey("siteId"))
        }
        assertEquals("other-site", port.savedFields.first()["siteId"])
    }

    @Test fun offlineDocumentUsesLocalSaveAndNoUploadPort() = runBlocking {
        val port = FakeCapturePort()
        val result = pipeline(port).runCapture(mode = CaptureMode.document)
        assertEquals(0, result.uploaded)
        assertEquals(0, result.failed)
        assertEquals(1, result.queued)
        assertEquals(listOf("capture-1"), result.queuedIds)
        assertEquals("save-local", port.calls.last())
        assertFalse(port.savedFields.single().containsKey("siteId"))
        assertArrayEquals(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xd9.toByte()), port.savedBytes.single())
    }
}
