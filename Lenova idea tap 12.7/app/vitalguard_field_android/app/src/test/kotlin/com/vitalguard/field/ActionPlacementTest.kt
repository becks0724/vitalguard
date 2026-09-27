package com.vitalguard.field

import com.vitalguard.field.data.*
import com.vitalguard.field.data.mock.MemoryStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ActionPlacementTest {
    @Test fun selectionSurvivesRecreationAndRemainsAccountSpecific() = runTest {
        val store = MemoryStore()
        val first = ActionPlacement(store, "a")
        first.select(ActionSide.left)
        assertNull(store.read("a", vgActionSidePreferenceKey))
        first.load(); first.select(ActionSide.left)
        val restored = ActionPlacement(store, "a"); restored.load()
        val other = ActionPlacement(store, "b"); other.load()
        assertEquals(ActionSide.left, restored.state.value.side)
        assertEquals(ActionSide.right, other.state.value.side)
        other.select(ActionSide.right)
        assertNull(store.read("b", vgActionSidePreferenceKey))
    }
    @Test fun failedWriteRevertsAndSameSideCanRepairFailedRead() = runTest {
        var readFail = true
        var writeFail = true
        val store = object : MemoryStore() {
            override suspend fun read(accountId: String, key: String): String? {
                if (readFail) error("synthetic storage failure")
                return super.read(accountId, key)
            }
            override suspend fun write(accountId: String, key: String, value: String) {
                if (writeFail) error("synthetic storage failure")
                super.write(accountId, key, value)
            }
        }
        val preference = ActionPlacement(store, "a"); preference.load()
        assertTrue(preference.state.value.loaded); assertNotNull(preference.state.value.error)
        preference.select(ActionSide.left)
        assertEquals(ActionSide.right, preference.state.value.side)
        assertFalse(preference.state.value.saving)
        writeFail = false; readFail = false
        preference.select(ActionSide.right)
        assertNull(preference.state.value.error)
        assertEquals("right", store.read("a", vgActionSidePreferenceKey))
    }
    @Test fun rapidTapsDoNotRaceOrWriteToTheNextAccount() = runTest {
        val gate = CompletableDeferred<Unit>()
        var writes = 0
        val store = object : MemoryStore() {
            override suspend fun write(accountId: String, key: String, value: String) {
                writes++; gate.await(); super.write(accountId, key, value)
            }
        }
        val previous = ActionPlacement(store, "a"); previous.load()
        val job = launch { previous.select(ActionSide.left) }; runCurrent()
        assertTrue(previous.state.value.saving)
        previous.select(ActionSide.right)
        val next = ActionPlacement(store, "b"); next.load()
        gate.complete(Unit); job.join()
        assertEquals(1, writes)
        assertEquals("left", store.read("a", vgActionSidePreferenceKey))
        assertNull(store.read("b", vgActionSidePreferenceKey))
        assertEquals(ActionSide.right, next.state.value.side)
    }
    @Test fun cancellationDoesNotLeavePermanentlyDisabledControls() = runTest {
        val gate = CompletableDeferred<Unit>()
        val store = object : MemoryStore() {
            override suspend fun write(accountId: String, key: String, value: String) { gate.await() }
        }
        val preference = ActionPlacement(store, "a"); preference.load()
        val job = launch { preference.select(ActionSide.left) }; runCurrent()
        job.cancel(); job.join()
        assertFalse(preference.state.value.saving)
        assertEquals(ActionSide.right, preference.state.value.side)
    }
}
