package com.vitalguard.field

// Port: outbox_test.dart의 진입/전경/30초/수동 조회 + hold_bundle_ui_test.dart의 전경 만료.
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.ui.outbox.OutboxUiController
import kotlinx.coroutines.test.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.*
import org.junit.Test
import java.time.Duration

@OptIn(ExperimentalCoroutinesApi::class)
class OutboxLifecycleTest {
    @Test fun onlyVisibleForegroundCanAutomaticallyLookupAndManualLookupBypassesThrottle() = runTest {
        val gateway = LookupOutboxGateway(); val rig = outboxRig(gateway); val item = rig.photo()
        rig.restore(listOf(item.copy(phase = OutboxPhase.uncertain, needsVerification = true)))
        val ui = OutboxUiController(rig.box, backgroundScope); runCurrent()
        assertTrue(gateway.queries.isEmpty())
        ui.setVisible(true); runCurrent(); assertTrue(gateway.queries.isEmpty())
        ui.setForeground(true); runCurrent(); assertEquals(1, gateway.queries.size)
        ui.setVisible(false); ui.setVisible(true); runCurrent(); assertEquals(1, gateway.queries.size)
        ui.verify(); runCurrent(); assertEquals(2, gateway.queries.size)
        ui.setForeground(false); rig.clock.advance(31); ui.setVisible(false); ui.setVisible(true); runCurrent()
        assertEquals(2, gateway.queries.size)
        ui.setForeground(true); runCurrent(); assertEquals(3, gateway.queries.size)
        assertTrue(gateway.writes.isEmpty()); ui.close()
    }
    @Test fun foregroundPurgesExpiredCompletedRecordsEvenOnAnotherTab() = runTest {
        val rig = outboxRig(); val item = rig.photo(); rig.box.sendBundle(item.id)
        val ui = OutboxUiController(rig.box, backgroundScope); runCurrent()
        rig.clock.advance(Duration.ofDays(8).seconds)
        ui.setForeground(true); runCurrent()
        assertTrue(rig.box.items.value.isEmpty()); assertEquals(1, rig.gateway.writes.size); ui.close()
    }
    @Test fun offlineUiSendAndRetryNeverOpenHttp() = runTest {
        val rig = outboxRig(); val item = rig.photo(); rig.offline()
        val ui = OutboxUiController(rig.box, backgroundScope); ui.send(item); runCurrent()
        assertTrue(rig.gateway.writes.isEmpty()); assertEquals(OutboxPhase.waiting, rig.box.entry(item.id)!!.phase); ui.close()
    }
}
