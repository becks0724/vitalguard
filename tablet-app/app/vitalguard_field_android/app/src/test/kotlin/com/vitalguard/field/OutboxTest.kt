package com.vitalguard.field

// Port: test/outbox_test.dart (UI는 RecordCalendarFlowComposeTest/OutboxComposeTest).
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

@OptIn(ExperimentalCoroutinesApi::class)
class OutboxTest {
    @Test fun retryUsesTheSameUuidOriginalBytesAndFields() = runTest {
        val rig = outboxRig()
        rig.gateway.writeFailure = ApiFailure("실패", status = 400)
        val photo = rig.photo()
        assertEquals(4, UUID.fromString(photo.id).version())
        rig.box.send(photo)
        assertEquals(OutboxPhase.failed, rig.box.entry(photo.id)!!.phase)
        rig.gateway.writeFailure = null
        rig.box.send(photo, retry = true)
        assertEquals(2, rig.gateway.writes.size)
        val (first, again) = rig.gateway.writes
        assertEquals(first.fields, again.fields); assertArrayEquals(first.bytes, again.bytes)
        assertEquals(serverCompletedLabel, rig.box.entry(photo.id)!!.statusLabel)
    }
    @Test fun authenticationRefreshKeepsOperationAndFile() = runTest {
        val rig = outboxRig(); rig.gateway.expireOnce = true
        val photo = rig.photo(); rig.box.send(photo)
        assertEquals(1, rig.gateway.refreshes); assertEquals(2, rig.gateway.writes.size)
        assertEquals(rig.gateway.writes[0].fields, rig.gateway.writes[1].fields)
        assertArrayEquals(PHOTO_BYTES, rig.gateway.writes[1].bytes)
    }
    @Test fun reloadKeepsOperationOriginalSiteAndFiles() = runTest {
        val rig = outboxRig(); val photo = rig.photo()
        rig.restore(); val restored = rig.box.items.value.single()
        assertEquals(photo, restored); assertArrayEquals(PHOTO_BYTES, rig.field.photoBytes(fromOutbox(restored)))
        assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun callerMutationCannotChangeStoredPayloadOrFieldsAndBytesPrecedeLedger() = runTest {
        val store = FaultStore(); val rig = outboxRig(store = store)
        store.writtenKeys.clear()
        val bytes = PHOTO_BYTES.copyOf(); val fields = PHOTO_FIELDS.toMutableMap()
        val item = rig.box.enqueue(OutboxKind.photo, bytes, fields, "A")
        bytes[0] = 0; fields["title"] = "변경"
        assertArrayEquals(PHOTO_BYTES, store.readBytes("a", item.bytesKey))
        assertEquals("작업 사진", item.fields["title"])
        assertEquals(listOf(item.bytesKey, outboxStorageKey), store.writtenKeys)
    }
    @Test fun identicalSourceSnapshotReusesOneIdButNewContentGetsAnother() = runTest {
        val rig = outboxRig(); val first = rig.photo("source")
        assertEquals(first.id, rig.photo("source").id)
        assertNotEquals(first.id, rig.photo("source", PHOTO_FIELDS + ("title" to "수정")).id)
        assertEquals(2, rig.box.items.value.size)
    }
    @Test fun deduplicationIsConfirmedCompletion() = runTest {
        val rig = outboxRig(); rig.gateway.duplicate = true
        val item = rig.photo(); rig.box.send(item)
        val done = rig.box.entry(item.id)!!
        assertTrue(done.deduplicated); assertEquals(OutboxPhase.completed, done.phase)
        assertEquals("같은 작업이 이미 서버에 있습니다. 서버 확인됨.", done.message)
    }
    @Test fun uncertainLookupAbsentRequiresExplicitRetryAndNeverPostsAutomatically() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway)
        gateway.writeFailure = ApiFailure("유실", uncertainWrite = true)
        val item = rig.photo(); rig.box.send(item)
        rig.box.send(item, retry = true); assertEquals(1, gateway.writes.size)
        gateway.lookupResult = OperationCheck(OperationPresence.absent)
        rig.box.verify(item)
        assertEquals(OutboxPhase.uncertain, rig.box.entry(item.id)!!.phase)
        assertTrue(rig.box.entry(item.id)!!.needsVerification); assertTrue(rig.box.canRetryUncertain(item))
        assertEquals(1, gateway.writes.size)
        gateway.writeFailure = null
        rig.box.send(item, retry = true)
        assertEquals(2, gateway.writes.size); assertEquals(gateway.writes.first().fields, gateway.writes.last().fields)
    }
    @Test fun registeredLookupCompletesWithoutPostAndPreservesReceipt() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway)
        val item = rig.photo()
        rig.restore(listOf(item.copy(phase = OutboxPhase.uncertain, needsVerification = true)))
        gateway.lookupResult = OperationCheck(OperationPresence.confirmed, mapOf("id" to "server-photo"))
        rig.box.verifyUncertain()
        assertEquals(OutboxPhase.completed, rig.box.entry(item.id)!!.phase)
        assertEquals(mapOf("id" to "server-photo"), rig.box.entry(item.id)!!.receipt)
        assertTrue(gateway.writes.isEmpty())
    }
    @Test fun unknownLookupAndRestartNeverAuthorizeRetry() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway); val item = rig.photo()
        rig.restore(listOf(item.copy(phase = OutboxPhase.uncertain, needsVerification = true)))
        rig.box.verify(item); rig.box.send(item, retry = true)
        rig.restore(); rig.box.send(item, retry = true)
        assertTrue(gateway.writes.isEmpty()); assertFalse(rig.box.canRetryUncertain(item))
    }
    @Test fun sendingRecoversAsUncertainBeforeBeingExposed() = runTest {
        val rig = outboxRig(); val item = rig.photo()
        rig.restore(listOf(item.copy(phase = OutboxPhase.sending)))
        val restored = rig.box.entry(item.id)!!
        assertEquals(OutboxPhase.uncertain, restored.phase); assertTrue(restored.needsVerification)
        assertEquals("앱 종료 당시 처리 중이었습니다. 서버 반영 여부를 먼저 확인해 주세요.", restored.message)
        assertTrue(rig.store.read("a", outboxStorageKey)!!.contains("uncertain"))
    }
    @Test fun wrongOwnerOrOperationLedgerDoesNotExposeOrOverwriteFiles() = runTest {
        for (bad in listOf("owner", "clientOperationId")) {
            val rig = outboxRig(); val item = rig.photo()
            val invalid = if (bad == "owner") item.copy(owner = "b") else item.copy(fields = item.fields + ("clientOperationId" to "wrong"))
            rig.restore(listOf(invalid))
            assertTrue(rig.box.items.value.isEmpty()); assertNotNull(rig.box.loadError.value)
            assertArrayEquals(PHOTO_BYTES, rig.store.readBytes("a", item.bytesKey))
        }
    }
    @Test fun reauthenticationAndAccountSwitchKeepTheOriginalLedgerPrivate() = runTest {
        val rig = outboxRig(); val item = rig.photo()
        rig.gateway.writeFailure = ApiFailure("만료", status = 401, action = "reauth")
        rig.box.send(item); runCurrent()
        assertEquals(AuthStage.reauthenticate, rig.field.state.value.authStage)
        assertTrue(rig.box.items.value.isEmpty())
        rig.gateway.writeFailure = null
        rig.field.signIn("b", "mock"); rig.box.load(); rig.box.send(item)
        assertTrue(rig.box.items.value.isEmpty()); assertEquals(1, rig.gateway.writes.size)
        rig.field.signIn("a", "mock"); rig.box.load()
        assertEquals(OutboxPhase.reauthenticate, rig.box.entry(item.id)!!.phase)
    }
    @Test fun latePostStaysWithTheOriginalAccount() = runTest {
        val rig = outboxRig(); val item = rig.photo(); rig.gateway.gate = CompletableDeferred()
        val sending = launch { rig.box.send(item) }; runCurrent()
        rig.field.signIn("b", "mock"); rig.box.load(); rig.gateway.gate!!.complete(Unit); sending.join()
        assertTrue(rig.box.items.value.isEmpty())
        rig.field.signIn("a", "mock"); rig.box.load()
        assertEquals(OutboxPhase.uncertain, rig.box.entry(item.id)!!.phase)
        assertTrue(rig.box.entry(item.id)!!.needsVerification)
    }
    @Test fun localWriteFailurePreventsEnqueueAndSendingHttpButDoesNotPoisonQueue() = runTest {
        val store = FaultStore(); val rig = outboxRig(store = store)
        store.fails = { _, _ -> true }; rejects { rig.photo() }; assertTrue(rig.box.items.value.isEmpty())
        store.fails = { _, _ -> false }; val item = rig.photo()
        store.fails = { key, bytes -> key == outboxStorageKey && bytes.toString(Charsets.UTF_8).contains("sending") }
        rig.box.send(item)
        assertTrue(rig.gateway.writes.isEmpty()); assertEquals(OutboxPhase.failed, rig.box.entry(item.id)!!.phase)
        store.fails = { _, _ -> false }; rig.box.send(item, retry = true)
        assertEquals(1, rig.gateway.writes.size)
    }
    @Test fun doubleTapProducesOnlyOnePostAndBusyStateIsObservable() = runTest {
        val rig = outboxRig(); val item = rig.photo(); rig.gateway.gate = CompletableDeferred()
        val first = launch { rig.box.send(item) }; runCurrent()
        assertTrue(item.id in rig.box.busyIds.value)
        rig.box.send(item); assertEquals(1, rig.gateway.writes.size)
        rig.gateway.gate!!.complete(Unit); first.join(); assertFalse(rig.box.isBusy(item))
    }
    @Test fun batchesAre50_50_1AndAutomaticLookupIsLimitedToThirtySeconds() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway)
        val rows = (0 until 101).map { rig.photo().copy(phase = OutboxPhase.uncertain, needsVerification = true) }
        rig.restore(rows)
        rig.box.verifyUncertain(automatic = true)
        assertEquals(listOf(50, 50, 1), gateway.queries.map { it.size })
        assertEquals(rows.map { it.id }, gateway.queries.flatten())
        rig.box.verifyUncertain(automatic = true); assertEquals(3, gateway.queries.size)
        rig.clock.advance(30); rig.box.verifyUncertain(automatic = true); assertEquals(6, gateway.queries.size)
        rig.box.verifyUncertain(); assertEquals(9, gateway.queries.size)
        assertTrue(gateway.writes.isEmpty())
    }
    @Test fun lookupErrorsNeverBecomeAbsentAndStopRemainingBatches() = runTest {
        for (status in listOf(400, 401, 403, 503, null)) {
            val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway)
            val rows = (0 until 51).map { rig.photo().copy(phase = OutboxPhase.uncertain, needsVerification = true) }
            rig.restore(rows); gateway.lookupFailure = ApiFailure("장애", status = status, action = "none")
            rig.box.verifyUncertain()
            assertEquals(1, gateway.queries.size); assertTrue(gateway.writes.isEmpty())
            assertTrue(rig.box.items.value.all { it.phase == OutboxPhase.uncertain })
            assertFalse(rig.box.canRetryUncertain(rows.first()))
        }
    }
    @Test fun absenceIsNotPersistedAndANewFailedLookupRevokesRetry() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway); val item = rig.photo()
        rig.restore(listOf(item.copy(phase = OutboxPhase.uncertain, needsVerification = true)))
        gateway.lookupResult = OperationCheck(OperationPresence.absent); rig.box.verify(item)
        assertTrue(rig.box.canRetryUncertain(item)); rig.restore(); assertFalse(rig.box.canRetryUncertain(item))
        rig.box.verify(item); gateway.lookupFailure = ApiFailure("DB", status = 503); rig.box.verify(item)
        assertFalse(rig.box.canRetryUncertain(item)); rig.box.send(item, retry = true); assertTrue(gateway.writes.isEmpty())
    }
    @Test fun lateLookupCannotConfirmPreviousAccountAndBackgroundStopsNextBatch() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway)
        val rows = (0 until 51).map { rig.photo().copy(phase = OutboxPhase.uncertain, needsVerification = true) }; rig.restore(rows)
        gateway.lookupGate = CompletableDeferred()
        val work = launch { rig.box.verifyUncertain() }; runCurrent()
        rig.field.signIn("b", "mock"); rig.box.load()
        gateway.lookupGate!!.complete(rows.associate { it.id to OperationCheck(OperationPresence.confirmed) }); work.join()
        assertEquals(1, gateway.queries.size); assertTrue(rig.box.items.value.isEmpty())
        rig.field.signIn("a", "mock"); rig.box.load(); assertTrue(rig.box.items.value.all { it.phase == OutboxPhase.uncertain })
        var active = true
        gateway.lookupGate = CompletableDeferred()
        val second = launch { rig.box.verifyUncertain { active } }; runCurrent(); active = false
        gateway.lookupGate!!.complete(rows.associate { it.id to OperationCheck(OperationPresence.unknown) }); second.join()
        assertEquals(2, gateway.queries.size)
    }
    @Test fun manualWebConfirmationIsAvailableOnlyWithoutLookupAndDoesNotPost() = runTest {
        val rig = outboxRig(); val item = rig.photo()
        rig.restore(listOf(item.copy(phase = OutboxPhase.uncertain, needsVerification = true)))
        rig.box.confirmAbsent(item)
        assertEquals(OutboxPhase.failed, rig.box.entry(item.id)!!.phase); assertTrue(rig.gateway.writes.isEmpty())
        val lookup = outboxRig(LookupOutboxGateway()); val second = lookup.photo()
        lookup.restore(listOf(second.copy(phase = OutboxPhase.uncertain, needsVerification = true)))
        lookup.box.confirmAbsent(second); assertEquals(OutboxPhase.uncertain, lookup.box.entry(second.id)!!.phase)
    }
}
