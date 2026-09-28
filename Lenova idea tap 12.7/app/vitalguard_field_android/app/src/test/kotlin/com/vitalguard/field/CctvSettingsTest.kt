package com.vitalguard.field

import com.vitalguard.field.data.cctv.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.models.CctvTicket
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class CctvSettingsTest {
    private val frames = object : CctvFrames {
        override suspend fun fetch(ticket: CctvTicket) = byteArrayOf(1)
    }
    @Test fun periodSurvivesControllerRecreationAndStaysWithItsAccountWithoutOpeningCamera() = runTest {
        val store = MemoryStore()
        store.write("a", CCTV_LEGACY_PERIOD_KEY, "10")
        var tickets = 0
        val gateway = object : ScriptedGateway() {
            override suspend fun cctvTicket(accessToken: String, cameraId: String): CctvTicket { tickets++; return stage3Ticket(tickets) }
        }
        val field = FieldCoordinator(gateway, store, backgroundScope, MutableClock()); field.signIn("a", "pw")
        val first = CctvController(field, frames, backgroundScope, MutableClock()); runCurrent()
        assertTrue(first.state.value.periodLoaded); assertEquals(2000, first.state.value.periodMillis)
        first.period(500); runCurrent()
        assertEquals("500", store.read("a", CCTV_PERIOD_PREFERENCE_KEY)); first.close()
        val restored = CctvController(field, frames, backgroundScope, MutableClock()); runCurrent()
        assertEquals(500, restored.state.value.periodMillis)
        field.signOut(); runCurrent(); field.signIn("b", "pw"); runCurrent()
        assertEquals(2000, restored.state.value.periodMillis)
        assertNull(store.read("b", CCTV_PERIOD_PREFERENCE_KEY)); assertEquals(0, tickets)
    }

    @Test fun failedWriteKeepsPreviousPeriodAndReadFailureCanBeRepairedWithDefaultChoice() = runTest {
        var failRead = true; var failWrite = true
        val store = object : MemoryStore() {
            override suspend fun read(accountId: String, key: String): String? {
                if (key == CCTV_PERIOD_PREFERENCE_KEY && failRead) error("synthetic read failure")
                return super.read(accountId, key)
            }
            override suspend fun write(accountId: String, key: String, value: String) {
                if (key == CCTV_PERIOD_PREFERENCE_KEY && failWrite) error("synthetic write failure")
                super.write(accountId, key, value)
            }
        }
        val field = FieldCoordinator(ScriptedGateway(), store, backgroundScope, MutableClock()); field.signIn("a", "pw")
        val cctv = CctvController(field, frames, backgroundScope, MutableClock()); runCurrent()
        assertTrue(cctv.state.value.periodLoaded); assertNotNull(cctv.state.value.periodError)
        cctv.period(0); runCurrent()
        assertEquals(2000, cctv.state.value.periodMillis); assertFalse(cctv.state.value.periodSaving)
        assertNotNull(cctv.state.value.periodError)
        failRead = false; failWrite = false
        cctv.period(2000); runCurrent()
        assertNull(cctv.state.value.periodError); assertEquals("2000", store.read("a", CCTV_PERIOD_PREFERENCE_KEY))
        cctv.close(); store.write("a", CCTV_PERIOD_PREFERENCE_KEY, "9999")
        val repaired = CctvController(field, frames, backgroundScope, MutableClock()); runCurrent()
        assertEquals(2000, repaired.state.value.periodMillis)
    }

    @Test fun rapidSelectionAndLateWriteCannotChangeTheNextAccount() = runTest {
        val gate = CompletableDeferred<Unit>(); var writes = 0
        val store = object : MemoryStore() {
            override suspend fun write(accountId: String, key: String, value: String) {
                if (key == CCTV_PERIOD_PREFERENCE_KEY) { writes++; gate.await() }
                super.write(accountId, key, value)
            }
        }
        val field = FieldCoordinator(ScriptedGateway(), store, backgroundScope, MutableClock()); field.signIn("a", "pw")
        val cctv = CctvController(field, frames, backgroundScope, MutableClock()); runCurrent()
        cctv.period(500); cctv.period(0); runCurrent()
        assertTrue(cctv.state.value.periodSaving)
        field.signOut(); runCurrent(); field.signIn("b", "pw"); runCurrent()
        gate.complete(Unit); runCurrent()
        assertEquals(1, writes); assertEquals("500", store.read("a", CCTV_PERIOD_PREFERENCE_KEY))
        assertNull(store.read("b", CCTV_PERIOD_PREFERENCE_KEY))
        assertEquals(2000, cctv.state.value.periodMillis); assertFalse(cctv.state.value.periodSaving)
    }
}
