@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package com.vitalguard.field

// Ports: nav_rail_test.dart, common_states_test.dart의 receipt 분기, settings_test.dart의 계정 분리/목적지 왕복.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.session.FieldCoordinator
import com.vitalguard.field.ui.shell.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

class ShellStateTest {
    @Test fun defaultDependsOnWindowWidthAndPreferenceIsAccountLocal() = runTest {
        val store = MemoryStore()
        val c = FieldCoordinator(ScriptedGateway(), store, backgroundScope, MutableClock())
        val shell = ShellController(c, backgroundScope) {}
        shell.bindAccount("a"); shell.windowWidth(866); runCurrent()
        assertEquals(true, shell.state.value.collapsed)
        shell.toggle(); runCurrent(); assertEquals("false", store.read("a", vgRailPreferenceKey))
        val resumed = ShellController(c, backgroundScope) {}
        resumed.bindAccount("a"); resumed.windowWidth(866); runCurrent(); assertEquals(false, resumed.state.value.collapsed)
        resumed.bindAccount("b"); resumed.windowWidth(1200); runCurrent(); assertEquals(false, resumed.state.value.collapsed)
        resumed.windowWidth(900); assertEquals(true, resumed.state.value.collapsed)
        assertNull(store.read("b", vgRailPreferenceKey))
        for (index in 0..5) { resumed.select(index); assertEquals(index, resumed.state.value.destination) }
    }
    @Test fun latePreferenceCannotOverrideManualToggleAndSaveFailureRollsBack() = runTest {
        val pending = CompletableDeferred<String?>()
        val store = object : MemoryStore() {
            var reject = false
            override suspend fun read(accountId: String, key: String): String? =
                if (key == vgRailPreferenceKey) pending.await() else super.read(accountId, key)
            override suspend fun write(accountId: String, key: String, value: String) {
                if (reject) throw ApiFailure("storage")
                super.write(accountId, key, value)
            }
        }
        val c = FieldCoordinator(ScriptedGateway(), store, backgroundScope, MutableClock())
        val messages = mutableListOf<String>()
        val shell = ShellController(c, backgroundScope) { messages += it }
        shell.bindAccount("a"); shell.windowWidth(1200); runCurrent()
        shell.toggle(); runCurrent(); pending.complete("false"); runCurrent()
        assertEquals(true, shell.state.value.collapsed)
        store.reject = true; shell.toggle(); runCurrent()
        assertEquals(true, shell.state.value.collapsed); assertEquals(listOf("레일 접힘 상태를 저장하지 못했습니다."), messages)
    }
    @Test fun receiptUsesDestinationOfflineAndForbiddenPriorityExactly() {
        val ready = FieldState(siteStatusSnapshot = SiteStatus(siteStatusReply()))
        assertEquals("마지막 수신 2026-09-15 00:13:04 KST", shellReceipt(0, ready))
        assertEquals(siteStatusReceipt(null), shellReceipt(0, FieldState()))
        for (index in 2..4) assertEquals("기록은 저장되면 자동으로 전송됩니다 · 실패한 것만 [전송]을 눌러 주세요", shellReceipt(index, ready))
        val offline = ready.copy(offline = true)
        assertTrue(shellReceipt(0, offline).contains("60초마다 조회를 재시도"))
        assertTrue(shellReceipt(1, offline).contains("경보 대응 확인은 연결 후 가능하며 예약되지 않습니다."))
        assertTrue(shellReceipt(2, offline).contains("촬영한 사진과 주석·메모·음성은 기기에 보관합니다."))
        assertTrue(shellReceipt(3, offline).contains("결과 불명 항목은 서버 반영 여부부터 확인해 주세요."))
        assertTrue(shellReceipt(4, offline).contains("설정은 기기에 저장할 수 있습니다."))
        for (index in 0..1) assertEquals("마지막 수신 정보 표시 불가 · 접근 권한 없음", shellReceipt(index, offline.copy(siteStatusForbidden = true)))
        val badAlerts = ready.copy(siteStatusSnapshot = SiteStatus(siteStatusReply() + ("alerts" to mapOf("ok" to false))))
        assertEquals("경보 수신 실패 · 이전 수신 정보는 경보 화면에서 확인해 주세요", shellReceipt(1, badAlerts))
        assertEquals("마지막 수신 2026-09-15 00:13:04 KST", shellReceipt(0, badAlerts))
    }
}
