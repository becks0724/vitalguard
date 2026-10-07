package com.vitalguard.field

import com.vitalguard.field.data.alerts.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

fun stage3Alert(id: String = "42", ack: Boolean = false, worker: String = "worker-a"): JsonObject = mapOf(
    "id" to id, "type" to "fall", "worker_id" to worker, "worker_name" to "모의 작업자", "ts" to NOW,
    "created_at" to NOW, "ack_at" to if (ack) NOW else null, "ack_by" to if (ack) "server-actor" else null,
)
fun stage3Status(rows: List<JsonObject>, available: Boolean = true): SiteStatus = SiteStatus(siteStatusReply() +
    ("alerts" to if (available) mapOf("ok" to true, "siteScoped" to true, "unacked" to rows.count { it["ack_at"] == null }, "items" to rows)
    else mapOf("ok" to false)))

class Stage3AlertsTest {
    private suspend fun TestScope.rig(gateway: ScriptedGateway): Pair<FieldCoordinator, AlertsController> {
        val field = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock())
        field.signIn("a", "pw")
        val alerts = AlertsController(field, backgroundScope, MutableClock())
        runCurrent(); alerts.refresh(true); runCurrent()
        return field to alerts
    }
    @Test fun selectingAndDismissingNeverAcknowledgesAndStripIsFifo() = runTest {
        var rows = listOf(stage3Alert())
        val g = ScriptedGateway().apply { onStatus = { stage3Status(rows) } }
        val (field, alerts) = rig(g)
        val first = alerts.state.value.items.first()
        alerts.select(first); assertEquals(first, alerts.state.value.selected)
        rows = listOf(stage3Alert("43"), stage3Alert()); field.siteStatus(); runCurrent()
        assertEquals(listOf("42", "43"), alerts.state.value.pending.map { it.id })
        alerts.dismiss(first); assertEquals(listOf("43"), alerts.state.value.pending.map { it.id })
        field.siteStatus(); runCurrent(); assertEquals(listOf("43"), alerts.state.value.pending.map { it.id })
        assertEquals(0, g.calls.count { it == "ack" }); assertFalse(alerts.state.value.items.first { it.id == "42" }.acknowledged)
        field.signOut(); runCurrent(); assertTrue(alerts.state.value.pending.isEmpty()); assertNull(alerts.state.value.data)
    }
    @Test fun explicitAckIsSingleFlightAndServerGetSuppliesActor() = runTest {
        val response = CompletableDeferred<Boolean>(); var acked = false
        val g = ScriptedGateway().apply {
            onStatus = { stage3Status(listOf(stage3Alert(ack = acked))) }
            onAck = { response.await() }
        }
        val (_, alerts) = rig(g); val row = alerts.state.value.items.single()
        alerts.acknowledge(row); alerts.acknowledge(row); runCurrent()
        assertEquals(1, g.calls.count { it == "ack" }); assertEquals(AlertWritePhase.sending, alerts.state.value.phase(row.id))
        acked = true; response.complete(true); runCurrent()
        assertEquals(AlertWritePhase.confirmed, alerts.state.value.phase(row.id))
        assertEquals("server-actor", alerts.state.value.items.single().ackBy)
        assertTrue(alerts.state.value.pending.isEmpty()); assertFalse(alerts.canAck(row))
    }
    @Test fun uncertaintyNeedsFreshMatchingRowBeforeAnExplicitRetry() = runTest {
        var readFails = false
        val g = ScriptedGateway().apply {
            onStatus = { if (readFails) throw ApiFailure("unavailable", status = 503) else stage3Status(listOf(stage3Alert())) }
            onAck = { readFails = true; throw ApiFailure("lost response", status = 503, uncertainWrite = true) }
        }
        val (_, alerts) = rig(g); val row = alerts.state.value.items.single()
        alerts.acknowledge(row); runCurrent()
        assertEquals(AlertWritePhase.uncertain, alerts.state.value.phase(row.id)); assertFalse(alerts.canAck(row))
        alerts.acknowledge(row); runCurrent(); assertEquals(1, g.calls.count { it == "ack" })
        g.onStatus = { stage3Status(emptyList()) }; alerts.refresh(true); runCurrent()
        assertEquals(AlertWritePhase.uncertain, alerts.state.value.phase(row.id)); assertFalse(alerts.canAck(row))
        g.onStatus = { stage3Status(listOf(stage3Alert())) }; alerts.refresh(true); runCurrent()
        assertEquals(AlertWritePhase.retryReady, alerts.state.value.phase(row.id)); assertTrue(alerts.canAck(row))
        assertEquals(1, g.calls.count { it == "ack" })
    }
    @Test fun conflictAndResponseListMismatchDoNotEnableDuplicatePost() = runTest {
        val g = ScriptedGateway().apply { onStatus = { stage3Status(listOf(stage3Alert())) }; onAck = { false } }
        val (_, alerts) = rig(g); val row = alerts.state.value.items.single()
        alerts.acknowledge(row); runCurrent()
        assertEquals(AlertWritePhase.conflict, alerts.state.value.phase(row.id)); assertFalse(alerts.canAck(row))
        alerts.acknowledge(row); runCurrent(); assertEquals(1, g.calls.count { it == "ack" })
    }
    @Test fun changedOccurrenceAndOfflineNeverPost() = runTest {
        val g = ScriptedGateway().apply { onStatus = { stage3Status(listOf(stage3Alert())) } }
        val (field, alerts) = rig(g); val row = alerts.state.value.items.single()
        g.onStatus = { stage3Status(listOf(stage3Alert(worker = "different-person"))) }; alerts.refresh(true); runCurrent()
        assertFalse(alerts.canAck(row)); alerts.acknowledge(row); runCurrent()
        g.onStatus = { throw ApiFailure("offline", networkUnreachable = true) }; alerts.refresh(true); runCurrent()
        assertTrue(field.state.value.offline); assertFalse(alerts.canAck(alerts.state.value.items.single()))
        assertEquals(0, g.calls.count { it == "ack" })
    }
    @Test fun partialReadCannotTurnUnknownIntoConfirmedOrFresh() = runTest {
        val g = ScriptedGateway().apply { onStatus = { stage3Status(listOf(stage3Alert())) } }
        val (_, alerts) = rig(g); val row = alerts.state.value.items.single()
        g.onStatus = { stage3Status(emptyList(), available = false) }; alerts.refresh(true); runCurrent()
        assertTrue(alerts.state.value.readFailed); assertEquals(1, alerts.state.value.items.size); assertFalse(alerts.canAck(row))
    }
    @Test fun forbiddenReadClearsDetailsAndManualRefreshCanRecover() = runTest {
        val g = ScriptedGateway().apply { onStatus = { stage3Status(listOf(stage3Alert())) } }
        val (field, alerts) = rig(g); alerts.select(alerts.state.value.items.single())
        g.onStatus = { throw ApiFailure("denied", status = 403) }; alerts.refresh(true); runCurrent()
        assertTrue(alerts.state.value.forbidden); assertNull(alerts.state.value.data); assertNull(alerts.state.value.selected)
        assertEquals(AuthStage.ready, field.state.value.authStage)
        g.onStatus = { stage3Status(listOf(stage3Alert())) }; alerts.refresh(true); runCurrent()
        assertFalse(alerts.state.value.forbidden); assertTrue(alerts.canAck(alerts.state.value.items.single()))
    }
    @Test fun pollingOnlyRunsForVisibleForegroundAlerts() = runTest {
        val g = ScriptedGateway().apply { onStatus = { stage3Status(listOf(stage3Alert())) } }
        val (_, alerts) = rig(g); val initial = g.calls.count { it == "status" }
        alerts.setForeground(true); advanceTimeBy(60_000); runCurrent(); assertEquals(initial, g.calls.count { it == "status" })
        alerts.setVisible(true); runCurrent(); advanceTimeBy(60_000); runCurrent()
        assertEquals(initial + 2, g.calls.count { it == "status" })
        alerts.setForeground(false); advanceTimeBy(120_000); runCurrent(); assertEquals(initial + 2, g.calls.count { it == "status" })
    }
    @Test fun accountSwitchRejectsOldRowBeforeTheSnapshotObserverRuns() = runTest {
        val g = ScriptedGateway().apply { onStatus = { stage3Status(listOf(stage3Alert())) } }
        val (field, alerts) = rig(g); val oldRow = alerts.state.value.items.single()
        assertTrue(alerts.canAck(oldRow))
        field.signIn("different-account", "pw")
        // Do not advance the observer: authorization must read the current account synchronously.
        assertFalse(alerts.canAck(oldRow))
        alerts.acknowledge(oldRow); runCurrent()
        assertEquals(0, g.calls.count { it == "ack" })
    }
    @Test fun batchUsesOnlyCapturedVisibleRowsAndBlocksDuplicateTap() = runTest {
        val wait = CompletableDeferred<Boolean>(); val acked = mutableSetOf<String>(); val sent = mutableListOf<String>()
        val g = object : ScriptedGateway() {
            override suspend fun ackAlert(accessToken: String, id: String): Boolean {
                sent += id; if (id == "42") wait.await(); acked += id; return true
            }
        }.apply { onStatus = { stage3Status(listOf("42", "43", "44").map { stage3Alert(it, it in acked) }) } }
        val (_, alerts) = rig(g); val selected = alerts.state.value.items.take(2)
        alerts.acknowledgeVisible(selected); alerts.acknowledgeVisible(selected); runCurrent()
        assertTrue(alerts.state.value.batchRunning); assertEquals(listOf("42"), sent)
        wait.complete(true); runCurrent()
        assertEquals(listOf("42", "43"), sent); assertEquals(2, alerts.state.value.batchDone)
        assertFalse(alerts.state.value.batchRunning); assertFalse(alerts.state.value.items.first { it.id == "44" }.acknowledged)
    }
    @Test fun batchStopsOnUnknownResultWithoutRetryingOrSendingRemainingRows() = runTest {
        val sent = mutableListOf<String>()
        val g = object : ScriptedGateway() {
            override suspend fun ackAlert(accessToken: String, id: String): Boolean {
                sent += id; throw ApiFailure("lost", status = 503, uncertainWrite = true)
            }
        }.apply { onStatus = { stage3Status(listOf(stage3Alert("42"), stage3Alert("43"))) } }
        val (_, alerts) = rig(g); alerts.acknowledgeVisible(alerts.state.value.items); runCurrent()
        assertEquals(listOf("42"), sent); assertEquals(0, alerts.state.value.batchDone)
        assertFalse(alerts.state.value.batchRunning); assertNotNull(alerts.state.value.batchError)
    }

}
