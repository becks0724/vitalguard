@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package com.vitalguard.field

// Ports: site_status_test.dart, offline_restore_test.dart, common_states_test.dart(TOTP/reauth).
// TASK의 단일 비행·늦은 응답·기기 우선 로그아웃 분기는 원본 coordinator에 대한 추가 회귀다.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

class FieldCoordinatorTest {
    @Test fun requiredWrite401RefreshesOnceWithNewTokenAndRetry401Locks() = runTest {
        for (rejectRetry in listOf(false, true)) {
            val gateway = ScriptedGateway().apply {
                onUpload = { token ->
                    if (token == "old-access" || rejectRetry) throw ApiFailure("private", status = 401, action = "refresh")
                    CalendarMedia(mapOf("id" to "sent"))
                }
            }
            val store = MemoryStore()
            val c = FieldCoordinator(gateway, store, backgroundScope, MutableClock())
            c.signIn("saved-account", "synthetic")
            var locks = 0
            c.beforeLock = { locks++ }
            if (rejectRetry) {
                failure { c.publish(PHOTO_BYTES, PHOTO_FIELDS) }
                assertEquals(1, locks); assertEquals(AuthStage.reauthenticate, c.state.value.authStage)
                assertNull(store.tokens); assertNull(c.state.value.siteStatusSnapshot)
            } else {
                assertEquals("sent", c.publish(PHOTO_BYTES, PHOTO_FIELDS).id)
                assertEquals(AuthStage.ready, c.state.value.authStage)
            }
            assertEquals(1, gateway.calls.count { it == "refresh" }); assertEquals(listOf("old-access", "new-access"), gateway.tokens)
        }
    }
    @Test fun expiredParallelRequestsShareSingleRefresh() = runTest {
        val clock = MutableClock()
        val pending = CompletableDeferred<MobileSession>()
        val gateway = ScriptedGateway().apply { onRefresh = { pending.await() } }
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, clock)
        c.signIn("saved-account", "synthetic")
        clock.advance(901)
        val jobs = List(3) { async { c.siteStatus() } }
        runCurrent()
        assertEquals(1, gateway.calls.count { it == "refresh" }); assertEquals(0, gateway.calls.count { it == "status" })
        pending.complete(session("new-access"))
        jobs.forEach { it.await() }
        assertEquals(listOf("new-access", "new-access", "new-access"), gateway.tokens)
    }
    @Test fun refreshReauthAndBeforeLockFailureStillClearTokens() = runTest {
        for (failure in listOf(ApiFailure("expired", status = 401), ApiFailure("expired", status = 403),
            ApiFailure("expired", status = 503, action = "reauth"))) {
            val clock = MutableClock()
            val store = MemoryStore()
            val gateway = ScriptedGateway().apply { onRefresh = { throw failure } }
            val c = FieldCoordinator(gateway, store, backgroundScope, clock)
            c.signIn("saved-account", "synthetic")
            c.beforeLock = { error("draft storage failed") }
            clock.advance(901)
            assertSame(failure, com.vitalguard.field.failure { c.siteStatus() })
            assertEquals(AuthStage.reauthenticate, c.state.value.authStage); assertNull(store.tokens)
            assertEquals("초안 저장 상태를 확인해 주세요. 다시 로그인해야 합니다.", c.state.value.message)
        }
    }
    @Test fun forbiddenClearsSnapshotWithoutRefreshAndAccountSwitchClearsView() = runTest {
        val gateway = ScriptedGateway()
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic"); c.siteStatus()
        gateway.onStatus = { throw ApiFailure("private", status = 403, action = "none") }
        failure { c.siteStatus() }
        assertNull(c.state.value.siteStatusSnapshot); assertTrue(c.state.value.siteStatusForbidden)
        assertEquals(AuthStage.ready, c.state.value.authStage); assertFalse(gateway.calls.contains("refresh"))
        c.signIn("next-account", "synthetic")
        assertFalse(c.state.value.siteStatusForbidden); assertNull(c.state.value.siteStatusSnapshot)
    }
    @Test fun refreshSiteCachesNullAndFailureKeepsPreviousSite() = runTest {
        for (site in listOf(SiteInfo(mapOf("site_id" to "new-site", "site_name" to "새 현장")), null)) {
            val gateway = ScriptedGateway()
            val store = MemoryStore()
            val c = FieldCoordinator(gateway, store, backgroundScope, MutableClock())
            c.signIn("saved-account", "synthetic")
            gateway.onSite = { site }; c.refreshSite()
            assertSame(site, c.state.value.site); assertEquals(Json.encode(site?.json), store.read("saved-account", "site:info"))
            for (status in listOf(null, 503)) {
                val previous = c.state.value.site; val cached = store.read("saved-account", "site:info")
                val problem = ApiFailure("현장 조회 실패", status = status)
                gateway.onSite = { throw problem }
                assertSame(problem, failure { c.refreshSite() })
                assertSame(previous, c.state.value.site); assertEquals(cached, store.read("saved-account", "site:info"))
            }
        }
    }
    @Test fun lateSiteOrLoginResultsNeverRestoreSignedOutIdentity() = runTest {
        val gateway = ScriptedGateway()
        val store = MemoryStore()
        val c = FieldCoordinator(gateway, store, backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic")
        val cached = store.read("saved-account", "site:info")
        val site = CompletableDeferred<SiteInfo?>()
        gateway.onSite = { site.await() }
        val refreshing = async { failure { c.refreshSite() } }
        runCurrent(); c.signOut()
        site.complete(SiteInfo(mapOf("site_id" to "late")))
        refreshing.await()
        assertNull(c.state.value.site); assertEquals(cached, store.read("saved-account", "site:info"))
        val login = CompletableDeferred<MobileSession>()
        gateway.onLogin = { _, _, _ -> login.await() }
        val signingIn = async { c.signIn("old", "synthetic") }
        runCurrent(); c.cancelSignIn(); login.complete(session()); signingIn.await()
        assertEquals(AuthStage.login, c.state.value.authStage); assertNull(c.state.value.user); assertNull(store.tokens)
    }
    @Test fun lateRefreshCannotReplaceNewAccountsTokenBundle() = runTest {
        val clock = MutableClock()
        val gateway = ScriptedGateway()
        val store = MemoryStore()
        val c = FieldCoordinator(gateway, store, backgroundScope, clock)
        c.signIn("saved-account", "synthetic"); clock.advance(901)
        val pending = CompletableDeferred<MobileSession>()
        gateway.onRefresh = { pending.await() }
        val request = async { failure { c.siteStatus() } }
        runCurrent()
        c.signOut()
        c.signIn("new-account", "synthetic")
        val newTokens = store.tokens
        pending.complete(session("late-access"))
        request.await()
        assertEquals("new-account", c.state.value.user?.id)
        assertEquals(newTokens, store.tokens)
        assertNull(c.state.value.siteStatusSnapshot)
    }
    @Test fun roleAliasesAreAcceptedButWorkerAndUnrecognizedRolesAreDeniedAfterLogout() = runTest {
        for (role in listOf("platform_admin", "owner", "site_manager", "admin", "worker", "owner_officer", "unknown", "")) {
            val store = MemoryStore()
            val gateway = ScriptedGateway().apply {
                onLogin = { _, _, _ -> session(user = SAVED_USER + ("role" to role)) }
                onLogout = { assertNull(store.tokens); throw ApiFailure("server unavailable") }
            }
            val c = FieldCoordinator(gateway, store, backgroundScope, MutableClock())
            c.signIn("demo", "synthetic")
            val accepted = role in setOf("platform_admin", "owner", "site_manager", "admin")
            assertEquals(if (accepted) AuthStage.ready else AuthStage.denied, c.state.value.authStage)
            assertEquals(!accepted, gateway.calls.contains("logout"))
            if (!accepted) { assertNull(c.state.value.user); assertNull(store.tokens) }
        }
    }
    @Test fun mockTotpWrongCorrectCancelAndRememberFalse() = runTest {
        val store = MemoryStore()
        val c = FieldCoordinator(MockGateway(MutableClock()), store, backgroundScope, MutableClock())
        c.signIn("totp", "mock", remember = false)
        assertEquals(AuthStage.totp, c.state.value.authStage)
        c.submitTotp("000000"); assertEquals(AuthStage.totp, c.state.value.authStage)
        c.submitTotp("123456"); assertEquals(AuthStage.ready, c.state.value.authStage); assertNull(store.tokens)
        c.signOut(); c.signIn("totp", "mock"); c.cancelSignIn(); c.submitTotp("123456")
        assertEquals(AuthStage.login, c.state.value.authStage); assertNull(c.state.value.loginFailure)
        c.signIn("worker", "mock"); assertEquals(AuthStage.denied, c.state.value.authStage)
        c.cancelSignIn(); assertEquals(AuthStage.login, c.state.value.authStage)
    }
    @Test fun serverLockPreventsLoginAndTotpUntilInjectedClockExpires() = runTest {
        val clock = MutableClock()
        val gateway = ScriptedGateway().apply {
            onLogin = { _, _, _ -> throw ApiFailure("locked", retryAfterSec = 37, twoFactorRequired = true) }
        }
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, clock)
        c.signIn("totp", "synthetic")
        assertEquals(clock.instant().plusSeconds(37), c.state.value.lockedUntil)
        c.submitTotp("123456"); c.signIn("demo", "synthetic")
        assertEquals(1, gateway.calls.count { it == "login" })
        clock.advance(37); gateway.onLogin = { _, _, _ -> session() }
        c.submitTotp("123456"); assertEquals(AuthStage.ready, c.state.value.authStage)
    }
    @Test fun logoutIsLocalFirstAndServerFailureIsOnlyAMessage() = runTest {
        val gateway = ScriptedGateway()
        val store = MemoryStore()
        val c = FieldCoordinator(gateway, store, backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic")
        store.write("saved-account", "draft", "기기 기록")
        var locks = 0; c.beforeLock = { locks++ }
        gateway.onLogout = {
            assertEquals(AuthStage.login, c.state.value.authStage); assertNull(store.tokens)
            assertNull(c.state.value.user); throw ApiFailure("unreachable")
        }
        c.signOut()
        assertEquals(1, locks); assertEquals("기기 기록", store.read("saved-account", "draft"))
        assertEquals("기기에서는 로그아웃했습니다. 서버 세션 종료는 확인하지 못했습니다.", c.state.value.message)
    }
    @Test fun draftSaveFailureStopsLogoutAndUncertainWritesNeverRetry() = runTest {
        val gateway = ScriptedGateway()
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic")
        c.beforeLock = { throw ApiFailure("draft") }
        failure { c.signOut() }; assertEquals(AuthStage.ready, c.state.value.authStage); assertFalse(gateway.calls.contains("logout"))
        c.beforeLock = null
        for (status in listOf(null, 401, 503)) {
            c.signIn("saved-account", "synthetic")
            gateway.onUpload = { throw ApiFailure("uncertain", status = status, uncertainWrite = true) }
            assertTrue(failure { c.publish(byteArrayOf(1), emptyMap()) }.uncertainWrite)
            assertEquals(if (status == 401) AuthStage.reauthenticate else AuthStage.ready, c.state.value.authStage)
        }
        assertEquals(3, gateway.calls.count { it == "upload" }); assertFalse(gateway.calls.contains("refresh"))
        c.connectivityChanged(false)
        val keys = c.local.keys("saved-account")
        assertEquals("연결 후 가능", failure { c.ackAlert("1") }.message)
        assertEquals(keys, c.local.keys("saved-account")); assertFalse(gateway.calls.contains("ack"))
    }
    @Test fun ack401NeverRepeatsPost() = runTest {
        val gateway = ScriptedGateway().apply { onAck = { throw ApiFailure("expired", status = 401, action = "refresh") } }
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic"); failure { c.ackAlert("1") }
        assertEquals(1, gateway.calls.count { it == "ack" }); assertFalse(gateway.calls.contains("refresh"))
        assertEquals(AuthStage.reauthenticate, c.state.value.authStage)
    }
}
