package com.vitalguard.field

// Port: test/outbox_bundle_test.dart. 원문 R-7 데이터 수용 기준과 legacy 단독 send 계약.
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Duration

@OptIn(ExperimentalCoroutinesApi::class)
class OutboxBundleTest {
    @Test fun dependencyCompletionAndDraftFieldsRoundTripWithLegacyDefaults() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle()
        val entry = bundle.ink.copy(completedAt = rig.clock.instant(), phase = OutboxPhase.completed, receipt = mapOf("id" to "receipt"))
        assertEquals(entry, OutboxEntry.fromJson(Json.decodeObject(Json.encode(entry.toJson()))))
        val old = OutboxEntry.fromJson(bundle.photo.toJson() - setOf("dependsOn", "completedAt", "draftKeys"))
        assertNull(old.dependsOn); assertNull(old.completedAt); assertTrue(old.draftKeys.isEmpty())
    }
    @Test fun flutterV1FixtureRetainsExactKeysAndRecoversSending() = runTest {
        val rig = outboxRig()
        val raw = javaClass.getResourceAsStream("/flutter-outbox-v1.json")!!.bufferedReader().use { it.readText() }
        rig.store.write("a", outboxStorageKey, raw)
        rig.box.close(); rig.box = OutboxController(rig.field, backgroundScope, rig.clock); rig.box.load()
        assertNull(rig.box.loadError.value); assertEquals(4, rig.box.items.value.size)
        val photo = rig.box.entry("flutter-photo")!!
        assertNull(photo.dependsOn); assertEquals("원본 현장", photo.siteName)
        assertEquals("field-101", photo.siteId)
        assertEquals(OutboxPhase.uncertain, rig.box.entry("flutter-voice")!!.phase)
        assertTrue(rig.box.entry("flutter-voice")!!.needsVerification)
        assertEquals(setOf("schemaVersion", "items"), Json.decodeObject(rig.store.read("a", outboxStorageKey)!!).keys)
        assertEquals(setOf("id", "owner", "kind", "fields", "siteName", "createdAt", "mock", "sourceKey", "annotationDraftId",
            "dependsOn", "completedAt", "draftKeys", "phase", "message", "receipt", "deduplicated", "needsVerification"), photo.toJson().keys)
    }
    @Test fun localStubCopiesOnlyOriginalMetadataAndParsesCoordinates() = runTest {
        val rig = outboxRig(); val photo = rig.photo(fields = PHOTO_FIELDS + mapOf("latitude" to "35.1", "longitude" to "127.2"))
        val media = fromOutbox(photo)
        assertEquals(true, media.json["local"]); assertEquals(photo.id, media.id)
        assertNull(media.media_url); assertNull(media.thumbnail_url)
        assertEquals(35.1, media.latitude!!, .0); assertEquals("원래 문구", media.ocr_text)
        rejects { fromOutbox(photo.copy(kind = OutboxKind.ink)) }
    }
    @Test fun dependentsCopyParentSiteAndPreserveInsertionOrderForEqualTime() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle()
        assertEquals(bundle.all.drop(1), rig.box.dependents(bundle.photo.id))
        bundle.all.drop(1).forEach { assertEquals("site-a", it.siteId); assertEquals(bundle.photo, rig.box.parentOf(it)) }
        val noSite = rig.photo(fields = PHOTO_FIELDS - "siteId")
        val child = rig.box.enqueue(OutboxKind.text, byteArrayOf(1), mapOf("siteId" to "borrowed"), "A", dependsOn = noSite.id)
        assertNull(child.siteId)
    }
    @Test fun sendsPhotoThenInkTextVoiceAndSynthesizesReferencesOnlyForHttp() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle(); rig.box.sendBundle(bundle.photo.id)
        val calls = rig.gateway.writes
        assertEquals(listOf(OutboxKind.photo, OutboxKind.ink, OutboxKind.text, OutboxKind.voice), calls.map { it.kind })
        val id = rig.box.entry(bundle.photo.id)!!.receipt!!["id"]
        assertEquals(id, calls[1].fields["annotationOf"]); assertEquals(id, calls[2].fields["mediaId"]); assertEquals(id, calls[3].fields["commentOf"])
        assertEquals(bundle.text.id, calls[2].fields["clientOperationId"])
        assertEquals("1234", calls[3].fields["audioMs"]); assertEquals("site-a", calls[3].fields["siteId"])
        assertEquals("2026-09-17", calls[1].fields["dateKey"])
        assertEquals("한글 메모\n안전 점검", calls[2].bytes.toString(Charsets.UTF_8))
        rig.box.dependents(bundle.photo.id).forEach { assertTrue(listOf("annotationOf", "commentOf", "mediaId").none(it.fields::containsKey)) }
        assertTrue(rig.box.bundleCompleted(bundle.photo.id))
    }
    @Test fun storedReferenceFieldsAreRejectedBeforeCreatingFilesOrLedger() = runTest {
        val rig = outboxRig(); val photo = rig.photo(); val before = rig.store.keys("a")
        for (key in listOf("annotationOf", "commentOf", "mediaId")) rejects {
            rig.box.enqueue(OutboxKind.ink, byteArrayOf(1), mapOf(key to "server-id"), "A", dependsOn = photo.id)
        }
        assertEquals(before, rig.store.keys("a")); assertEquals(1, rig.box.items.value.size)
    }
    @Test fun sendingAChildStartsTheWholeBundleAndIsSingleFlight() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle(); rig.gateway.gate = CompletableDeferred()
        val first = launch { rig.box.sendBundle(bundle.photo.id) }; runCurrent()
        val second = launch { rig.box.send(bundle.voice, retry = true) }; runCurrent()
        rejects { rig.box.discard(bundle.photo.id) }
        assertEquals(1, rig.gateway.writes.size)
        rig.gateway.gate!!.complete(Unit); joinAll(first, second)
        assertEquals(listOf(OutboxKind.photo, OutboxKind.ink, OutboxKind.text, OutboxKind.voice), rig.gateway.writes.map { it.kind })
    }
    @Test fun sameSourceInDifferentBundlesIsNotReusedAndDraftKeysAreCopied() = runTest {
        val rig = outboxRig(); val a = rig.photo(); val b = rig.photo()
        val drafts = mutableListOf("draft")
        val first = rig.box.enqueue(OutboxKind.text, byteArrayOf(1), emptyMap(), "A", sourceKey = "same", dependsOn = a.id, draftKeys = drafts)
        drafts += "changed"
        val second = rig.box.enqueue(OutboxKind.text, byteArrayOf(1), emptyMap(), "A", sourceKey = "same", dependsOn = b.id)
        assertNotEquals(first.id, second.id); assertEquals(listOf("draft"), first.draftKeys)
    }
    @Test fun uncertainParentWaitsUntilRegisteredWithIdAndExplicitResumption() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway); val bundle = rig.bundle()
        gateway.failKind = OutboxKind.photo; gateway.writeFailure = ApiFailure("유실", uncertainWrite = true)
        rig.box.sendBundle(bundle.photo.id)
        assertEquals(1, gateway.writes.size)
        rig.box.dependents(bundle.photo.id).forEach {
            assertEquals(OutboxPhase.waiting, it.phase); assertEquals("원본 사진 결과 확인 후 전송됩니다", it.message)
        }
        gateway.lookupResult = OperationCheck(OperationPresence.confirmed, mapOf("id" to "looked-up-photo"))
        rig.box.verifyUncertain(); assertEquals(1, gateway.writes.size)
        gateway.writeFailure = null; rig.box.sendBundle(bundle.photo.id)
        assertEquals(4, gateway.writes.size)
        assertEquals("looked-up-photo", gateway.writes[1].fields["annotationOf"])
        assertEquals("2026-09-17", gateway.writes[1].fields["dateKey"])
        assertEquals("원래 문구", gateway.writes[1].fields["ocrText"])
    }
    @Test fun completedPhotoWithoutStringReceiptKeepsChildrenWaiting() = runTest {
        for (receipt in listOf(null, mapOf("id" to 1))) {
            val rig = outboxRig(); val bundle = rig.bundle()
            rig.restore(bundle.all.map { if (it.id == bundle.photo.id) it.copy(phase = OutboxPhase.completed, receipt = receipt) else it })
            rig.box.sendBundle(bundle.photo.id)
            assertTrue(rig.gateway.writes.isEmpty())
            rig.box.dependents(bundle.photo.id).forEach { assertEquals("원본 사진 결과 확인 후 전송됩니다", it.message) }
        }
    }
    @Test fun failedPhotoWaitsAndRetryUsesSameId() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle()
        rig.gateway.failKind = OutboxKind.photo; rig.gateway.writeFailure = ApiFailure("원본", status = 404)
        rig.box.sendBundle(bundle.photo.id)
        assertEquals(OutboxPhase.failed, rig.box.entry(bundle.photo.id)!!.phase)
        assertTrue(rig.box.entry(bundle.photo.id)!!.message!!.startsWith("원본 사진을 찾을 수 없습니다. 삭제 여부를 확인해 주세요."))
        assertTrue(rig.box.dependents(bundle.photo.id).all { it.phase == OutboxPhase.waiting })
        rig.gateway.writeFailure = null; rig.box.sendBundle(bundle.photo.id, retry = true)
        assertEquals(rig.gateway.writes[0].fields, rig.gateway.writes[1].fields)
        assertTrue(rig.box.bundleCompleted(bundle.photo.id))
    }
    @Test fun reauthenticationPersistsChildWaitingReasonInOriginalAccount() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle()
        rig.gateway.writeFailure = ApiFailure("만료", status = 401, action = "reauth")
        rig.box.sendBundle(bundle.photo.id)
        val raw = Json.decodeObject(rig.store.read("a", outboxStorageKey)!!)["items"] as List<*>
        raw.map { OutboxEntry.fromJson(it.jsonObjectOrNull()!!) }.filter { it.dependsOn != null }.forEach {
            assertEquals("원본 사진 결과 확인 후 전송됩니다", it.message); assertEquals(OutboxPhase.waiting, it.phase)
        }
    }
    @Test fun failedInkDoesNotBlockLaterNotesAndCleanupWaitsForAllMembers() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle()
        rig.gateway.failKind = OutboxKind.ink; rig.gateway.writeFailure = ApiFailure("권한", status = 403)
        rig.box.sendBundle(bundle.photo.id)
        assertEquals(4, rig.gateway.writes.size); assertFalse(rig.box.bundleCompleted(bundle.photo.id))
        bundle.all.forEach { assertNotNull(rig.store.readBytes("a", it.bytesKey)) }
        rig.gateway.writeFailure = null; rig.box.sendBundle(bundle.photo.id, retry = true)
        assertEquals(5, rig.gateway.writes.size); assertEquals(OutboxKind.ink, rig.gateway.writes.last().kind)
        bundle.all.forEach { assertNull(rig.store.readBytes("a", it.bytesKey)) }
    }
    @Test fun missingParentFailsWithoutHttp() = runTest {
        val rig = outboxRig()
        val child = rig.box.enqueue(OutboxKind.text, "메모".toByteArray(), emptyMap(), "A", dependsOn = "missing")
        rig.box.send(child)
        assertEquals(OutboxPhase.failed, rig.box.entry(child.id)!!.phase)
        assertEquals("원본 사진 항목이 없습니다", rig.box.entry(child.id)!!.message)
        assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun completionRemovesBytesPreviewsDraftsAndCacheButRetainsReceipts() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle()
        for (key in localRecordDraftKeys(bundle.photo.id)) rig.store.write("a", key, "draft")
        rig.store.write("a", recordSessionKey, Json.encode(mapOf("media" to mapOf("id" to bundle.photo.id))))
        rig.store.write("a", "ink:draft", "draft")
        rig.store.writeBytes("a", "outbox-preview:${bundle.photo.id}", byteArrayOf(9))
        rig.store.write("a", "photo:mock-upload-1", "cache"); rig.store.write("a", "published:mock-upload-1", "draft")
        rig.box.sendBundle(bundle.photo.id)
        bundle.all.forEach { assertNull(rig.store.readBytes("a", it.bytesKey)) }
        val remaining = rig.store.keys("a")
        assertFalse(remaining.any { it.startsWith("outbox-file:") || it.startsWith("outbox-preview:") || it.startsWith("annotation:") || it.startsWith("photo:") || it.startsWith("published:") })
        assertNull(rig.store.read("a", recordSessionKey)); assertNull(rig.store.read("a", "ink:draft"))
        assertTrue(rig.box.items.value.all { it.phase == OutboxPhase.completed && it.completedAt != null && it.receipt != null })
        assertEquals(4, rig.box.items.value.size)
    }
    @Test fun photoOnlyBundleAlsoCleansImmediately() = runTest {
        val rig = outboxRig(); val photo = rig.photo(); rig.box.sendBundle(photo.id)
        assertNull(rig.store.readBytes("a", photo.bytesKey)); assertTrue(rig.box.bundleCompleted(photo.id))
    }
    @Test fun receiptPersistenceFailurePreservesBytesUntilStorageRecoversWithoutReposting() = runTest {
        val store = FaultStore(); val rig = outboxRig(store = store); val photo = rig.photo()
        store.fails = { key, bytes -> key == outboxStorageKey && (Json.decodeObject(bytes.toString(Charsets.UTF_8))["items"] as List<*>).any {
            it.jsonObjectOrNull()?.get("phase") == "completed"
        } }
        rejects { rig.box.sendBundle(photo.id) }
        assertNotNull(store.readBytes("a", photo.bytesKey)); assertEquals(1, rig.gateway.writes.size)
        store.fails = { _, _ -> false }; rig.box.sendBundle(photo.id)
        assertNull(store.readBytes("a", photo.bytesKey)); assertEquals(1, rig.gateway.writes.size)
    }
    @Test fun finalUncertainAttachmentLookupCleansBundleWithoutAnyPost() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway); val bundle = rig.bundle()
        gateway.failKind = OutboxKind.voice; gateway.writeFailure = ApiFailure("유실", uncertainWrite = true)
        rig.box.sendBundle(bundle.photo.id); assertNotNull(rig.store.readBytes("a", bundle.photo.bytesKey))
        gateway.lookupResult = OperationCheck(OperationPresence.confirmed, mapOf("id" to "voice-row"))
        rig.box.verifyUncertain()
        assertTrue(rig.box.bundleCompleted(bundle.photo.id)); assertEquals(4, gateway.writes.size)
        bundle.all.forEach { assertNull(rig.store.readBytes("a", it.bytesKey)) }
    }
    @Test fun lookupKeepsAnExistingReceipt() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway); val photo = rig.photo()
        rig.restore(listOf(photo.copy(phase = OutboxPhase.uncertain, receipt = mapOf("id" to "old", "title" to "keep"))))
        gateway.lookupResult = OperationCheck(OperationPresence.confirmed, mapOf("id" to "new")); rig.box.verifyUncertain()
        assertEquals(mapOf("id" to "old", "title" to "keep"), rig.box.entry(photo.id)!!.receipt)
    }
    @Test fun expiresStrictlyAfterSevenDaysAndSupportsLegacyCreatedAt() = runTest {
        val rig = outboxRig(); val now = rig.clock.instant()
        val entries = listOf(8L, 7L, 6L).map { days -> rig.photo().copy(phase = OutboxPhase.completed, completedAt = now.minus(Duration.ofDays(days))) }
        val waiting = rig.photo().copy(createdAt = now.minus(Duration.ofDays(30)))
        rig.restore(entries + waiting)
        assertEquals(setOf(entries[1].id, entries[2].id, waiting.id), rig.box.items.value.map { it.id }.toSet())
        assertNull(rig.store.readBytes("a", entries[0].bytesKey)); assertNotNull(rig.store.readBytes("a", waiting.bytesKey))
        rig.restore(listOf(waiting.copy(phase = OutboxPhase.completed, completedAt = null)))
        assertTrue(rig.box.items.value.isEmpty())
    }
    @Test fun customRetentionAndLegacyCacheCleanupAreAccountScopedAndOneTime() = runTest {
        val rig = outboxRig()
        // 첫 load 전에 별도 계정의 legacy 키를 심는다.
        rig.store.write("b", "calendar:month", "old"); rig.store.write("b", "photo:one", "old")
        rig.store.write("b", "published:one", "old"); rig.store.write("b", "annotation:keep", "draft")
        rig.field.signIn("b", "mock"); rig.box.load()
        assertEquals(listOf("annotation:keep", outboxStorageKey, "outbox:legacy-cache-cleaned:r7").toSet(),
            rig.store.keys("b").filterNot { it == "site:info" }.toSet())
        rig.store.write("b", "photo:later", "keep"); rig.box.load(); assertEquals("keep", rig.store.read("b", "photo:later"))
        rig.field.signIn("a", "mock"); rig.box.load()
        val photo = rig.photo(); rig.box.sendBundle(photo.id)
        assertEquals(1, rig.box.purgeExpired(Duration.ofDays(1), rig.clock.instant().plus(Duration.ofDays(2))))
    }
    @Test fun deletingPhotoDeletesWaitingAndFailedChildrenAndUnsubmittedDrafts() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle(); val unrelated = rig.photo()
        localRecordDraftKeys(bundle.photo.id).forEach { rig.store.write("a", it, "draft") }
        rig.box.discard(bundle.photo.id)
        assertEquals(listOf(unrelated), rig.box.items.value)
        bundle.all.forEach { assertNull(rig.store.readBytes("a", it.bytesKey)) }
        localRecordDraftKeys(bundle.photo.id).forEach { assertNull(rig.store.read("a", it)) }
        assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun deletingAChildPreservesTheParentAndOtherChildren() = runTest {
        val rig = outboxRig(); val bundle = rig.bundle(); rig.box.discard(bundle.text.id)
        assertEquals(listOf(bundle.ink, bundle.voice), rig.box.dependents(bundle.photo.id))
        assertNotNull(rig.store.readBytes("a", bundle.photo.bytesKey)); assertNull(rig.store.readBytes("a", bundle.text.bytesKey))
    }
    @Test fun onlyWaitingAndFailedBundlesCanBeDeleted() = runTest {
        for (phase in listOf(OutboxPhase.uncertain, OutboxPhase.completed, OutboxPhase.sending, OutboxPhase.reauthenticate)) {
            val rig = outboxRig(); val bundle = rig.bundle()
            rig.restore(bundle.all.map { if (it.id == bundle.voice.id) it.copy(phase = phase) else it })
            val keys = rig.store.keys("a").toSet(); rejects { rig.box.discard(bundle.photo.id) }
            assertEquals(keys, rig.store.keys("a").toSet()); assertEquals(4, rig.box.items.value.size)
        }
    }
    @Test fun offlineCaptureAndBundleStorageNeverAutoSendOnReconnect() = runTest {
        val rig = outboxRig(); rig.offline(); val bundle = rig.bundle(); rig.box.sendBundle(bundle.photo.id)
        assertTrue(rig.box.items.value.all { it.phase == OutboxPhase.waiting }); assertTrue(rig.gateway.writes.isEmpty())
        assertEquals("오프라인입니다. 연결 후 전송 상태에서 전송/재시도를 눌러 주세요.", rig.box.entry(bundle.photo.id)!!.message)
        rig.offline(false); assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun legacyStandaloneSendAndInkReceiptCacheStayCompatible() = runTest {
        val rig = outboxRig(); val photo = rig.photo(); rig.box.send(photo)
        assertNotNull(rig.store.readBytes("a", photo.bytesKey))
        val ink = rig.box.enqueue(OutboxKind.ink, "{\"v\":1}".toByteArray(),
            mapOf("dateKey" to "2026-09-17", "annotationOf" to rig.box.entry(photo.id)!!.receipt!!["id"] as String), "A",
            annotationDraftId = "legacy-draft", previewBytes = byteArrayOf(9))
        rig.box.send(ink); val receipt = rig.box.entry(ink.id)!!.receipt!!["id"]
        assertEquals("legacy-draft", rig.store.read("a", "published:$receipt")); assertArrayEquals(byteArrayOf(9), rig.store.readBytes("a", "photo:$receipt"))
    }
}
