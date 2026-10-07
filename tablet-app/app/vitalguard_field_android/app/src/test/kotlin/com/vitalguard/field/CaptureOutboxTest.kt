package com.vitalguard.field

// Ports: capture_site_id_test.dart, hold_bundle_ui_test.dart의 실제 enqueue 저장 경계.
import com.vitalguard.field.capture.*
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

class CaptureOutboxTest {
    @Test fun photoAndScanOnlyEnqueueWaitingAndNeverPublishEvenOffline() = runTest {
        val rig = outboxRig(); rig.offline()
        val author = captureAuthor(rig.field.state.value)
        val port = object : FakeCapturePort() {
            override suspend fun saveLocal(jpeg: ByteArray, fields: Map<String, String>) = enqueueCapturedPhoto(rig.box, author, jpeg, fields)
        }
        for (mode in CaptureMode.entries) {
            val result = CapturePipeline(port, deleteOriginal = {}).process(listOf("original.jpg"), capturedAt, mode,
                author.workerName, author.workerId, author.siteId)
            val item = rig.box.entry(result.queuedIds.single())!!
            assertEquals(1, result.queued); assertEquals(0, result.failed)
            assertEquals(OutboxKind.photo, item.kind); assertEquals(OutboxPhase.waiting, item.phase); assertNull(item.receipt)
            assertEquals(true, fromOutbox(item).json["local"])
            assertFalse(item.fields.containsKey("siteId")); assertNotNull(rig.field.photoBytes(fromOutbox(item)))
        }
        assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun assignedSiteAndJwtIdentityAreCapturedWithoutBorrowingFromPendingPhotos() = runTest {
        val rig = outboxRig()
        val user = AppUser(mapOf("id" to "a", "role" to "admin", "name" to "홍길동", "workerId" to "EMP-6861"))
        for (site in listOf(SiteInfo(mapOf("site_id" to "first-site", "site_name" to "첫 현장")),
            SiteInfo(mapOf("site_id" to "current-site")), null, SiteInfo(mapOf("id" to 101)), SiteInfo(mapOf("site_id" to "")))) {
            val author = captureAuthor(rig.field.state.value.copy(user = user, site = site))
            val port = object : FakeCapturePort() {
                override suspend fun saveLocal(jpeg: ByteArray, fields: Map<String, String>) = enqueueCapturedPhoto(rig.box, author, jpeg, fields)
            }
            CapturePipeline(port, deleteOriginal = {}).process(listOf("original"), capturedAt, CaptureMode.document,
                author.workerName, author.workerId, author.siteId)
            val fields = rig.box.items.value.last().fields
            assertEquals(site?.site_id?.takeIf { it.isNotEmpty() }, fields["siteId"])
            assertTrue(fields.getValue("ocrText").contains("작업자/ID: 홍길동, EMP-6861"))
            assertFalse(fields.keys.any { it in setOf("workerId", "workerName", "uploader") })
        }
        assertEquals("first-site", rig.box.items.value.first().siteId)
        val missing = captureAuthor(rig.field.state.value.copy(user = AppUser(mapOf("id" to "a", "role" to "admin"))))
        assertEquals("-", missing.workerName); assertEquals("-", missing.workerId)
    }
    @Test fun switchingAccountsDuringCaptureRejectsTheOldAuthor() = runTest {
        val rig = outboxRig(); val author = captureAuthor(rig.field.state.value)
        rig.field.signIn("b", "mock"); rig.box.load()
        val e = failure { enqueueCapturedPhoto(rig.box, author, PHOTO_BYTES, PHOTO_FIELDS) }
        assertEquals("reauth", e.action); assertTrue(rig.box.items.value.isEmpty()); assertTrue(rig.gateway.writes.isEmpty())
    }
}
