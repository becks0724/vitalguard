@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package com.vitalguard.field

// Ports: login_connection_test.dart의 3분기·입력 보존·늦은 연결 확인·인라인 오류, common_states_test.dart의 인증 입력.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.session.FieldCoordinator
import com.vitalguard.field.ui.auth.*
import java.net.SocketException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

class AuthUiControllerTest {
    @Test fun probeHasThreeMessagesPreservesIdAndClearsPassword() = runTest {
        for (internet in listOf(false, true, null)) {
            var probes = 0
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, _, _, _ -> throw SocketException() }),
                MemoryStore(), backgroundScope, MutableClock())
            c.initialize()
            val form = AuthUiController(c, InternetProbe { probes++; internet }, backgroundScope, MutableClock())
            form.id("field-operator"); form.password("synthetic")
            form.submit(); runCurrent()
            assertEquals(1, probes); assertEquals(connectionDialog(internet), form.state.value.dialog)
            assertEquals("field-operator", form.state.value.id); assertEquals("", form.state.value.password)
            assertTrue(c.state.value.loginFailure!!.networkUnreachable)
            form.dismissDialog(); assertNull(form.state.value.dialog); form.close()
        }
    }
    @Test fun timeoutIsInlineAndNeverProbesInternet() = runTest {
        var probes = 0
        val c = FieldCoordinator(LiveGateway(JsonTransport { _, _, _, _ -> throw SocketTimeoutException() }),
            MemoryStore(), backgroundScope, MutableClock())
        c.initialize()
        val form = AuthUiController(c, InternetProbe { probes++; false }, backgroundScope, MutableClock())
        form.id("demo"); form.password("synthetic"); form.submit(); runCurrent()
        assertEquals(0, probes); assertNull(form.state.value.dialog)
        assertEquals("서버 응답을 기다리는 시간이 지났습니다", c.state.value.message); form.close()
    }
    @Test fun later401OrClosedScreenDiscardsOldConnectivityResult() = runTest {
        for (close in listOf(false, true)) {
            var attempts = 0
            val pending = CompletableDeferred<Boolean?>()
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, _, _, _ ->
                if (attempts++ == 0) throw SocketException()
                ApiReply(401, mapOf("ok" to false, "error" to "invalid_credentials"))
            }), MemoryStore(), backgroundScope, MutableClock())
            c.initialize()
            val form = AuthUiController(c, InternetProbe { pending.await() }, backgroundScope, MutableClock())
            form.id("demo"); form.password("synthetic"); form.submit(); runCurrent()
            if (close) form.close() else { form.password("synthetic"); form.submit(); runCurrent() }
            pending.complete(false); runCurrent()
            assertNull(form.state.value.dialog)
            if (!close) assertEquals("아이디 또는 비밀번호가 올바르지 않습니다", c.state.value.message)
            form.close()
        }
    }
    @Test fun codeAcceptsOnlySixAsciiDigitsAndClockDrivesCountdown() = runTest {
        val clock = MutableClock()
        val gateway = ScriptedGateway().apply { onLogin = { _, _, _ -> throw ApiFailure("locked", retryAfterSec = 2) } }
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, clock)
        val form = AuthUiController(c, InternetProbe { true }, backgroundScope, clock)
        form.code("a12345678가"); assertEquals("123456", form.state.value.code)
        form.id("demo"); form.password("synthetic"); form.submit(); runCurrent()
        assertEquals(3L, form.state.value.seconds)
        clock.advance(3); advanceTimeBy(1000); runCurrent(); assertEquals(0L, form.state.value.seconds)
        form.close()
    }
}
