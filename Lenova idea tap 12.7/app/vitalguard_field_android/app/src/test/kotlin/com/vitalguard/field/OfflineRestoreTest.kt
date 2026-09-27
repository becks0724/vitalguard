@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package com.vitalguard.field

// Port: offline_restore_test.dart. 2단계 address 대신 1단계 site-status로 재연결을 유발한다.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.session.FieldCoordinator
import java.net.SocketException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

private fun success(path: String, site: JsonObject? = SAVED_SITE) = when (path) {
    ME -> ApiReply(200, mapOf("ok" to true, "user" to ONLINE_USER))
    REFRESH, "/api/mobile/v1/session/login" -> ApiReply(200, session("new-access").json)
    SITE_INFO -> ApiReply(200, mapOf("ok" to true, "siteInfo" to site))
    SITE_STATUS -> ApiReply(200, siteStatusReply())
    "/api/mobile/v1/session/logout" -> ApiReply(200, mapOf("ok" to true))
    else -> error("unexpected route")
}

class OfflineRestoreTest {
    @Test fun meDisallowedRoleClearsSavedIdentityBeforeItCanBeRestoredOffline() = runTest {
        val store = savedStore()
        val gateway = ScriptedGateway().apply { onMe = { AppUser(SAVED_USER + ("role" to "worker")) } }
        val c = FieldCoordinator(gateway, store, backgroundScope, MutableClock())
        var locks = 0; c.beforeLock = { locks++ }
        c.initialize()
        assertEquals(AuthStage.reauthenticate, c.state.value.authStage); assertEquals(1, locks)
        assertNull(store.tokens); assertNull(c.state.value.user); assertFalse(gateway.calls.contains("site"))
    }
    @Test fun socketFailureRestoresAllowedUserAndOnlyTheirCachedSite() = runTest {
        val store = savedStore()
        val original = store.tokens
        store.write("saved-account", "site:info", Json.encode(SAVED_SITE))
        store.write("other", "site:info", """{"site_id":"other-site"}""")
        val calls = mutableListOf<String>()
        val c = FieldCoordinator(LiveGateway(JsonTransport { _, path, _, _ ->
            calls += path; throw SocketException()
        }), store, backgroundScope, MutableClock())
        c.initialize()
        assertEquals(listOf(ME), calls)
        assertEquals(AuthStage.ready, c.state.value.authStage); assertTrue(c.state.value.offline)
        assertEquals(SAVED_USER, c.state.value.user?.json); assertEquals(SAVED_SITE, c.state.value.site?.json)
        assertNull(c.state.value.message); assertEquals(original, store.tokens)
    }
    @Test fun statusless503MalformedAndTimeoutAllowUnexpiredOfflineRestore() = runTest {
        val results = listOf<Any>(ApiFailure("synthetic"), ApiReply(503, mapOf("ok" to false)),
            IllegalArgumentException(), ApiReply(200, mapOf("ok" to true, "user" to null)), SocketTimeoutException())
        results.forEach { result ->
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, _, _, _ ->
                if (result is ApiReply) result else throw result as Exception
            }), savedStore(), backgroundScope, MutableClock())
            c.initialize()
            assertEquals(AuthStage.ready, c.state.value.authStage); assertTrue(c.state.value.offline)
            assertEquals(SAVED_USER, c.state.value.user?.json); assertNull(c.state.value.message)
        }
    }
    @Test fun explicitAuthenticationRejectionDoesNotBypassWithCache() = runTest {
        listOf(401 to null, 401 to "none", 401 to "reauth", 403 to "reauth", 503 to "reauth").forEach { (status, action) ->
            val store = savedStore()
            store.write("saved-account", "site:info", Json.encode(SAVED_SITE))
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, path, _, _ ->
                if (path == ME) ApiReply(status, mapOf("ok" to false, "action" to action)) else success(path)
            }), store, backgroundScope, MutableClock())
            c.initialize()
            assertEquals(AuthStage.reauthenticate, c.state.value.authStage)
            assertNull(store.tokens)
            assertNull(c.state.value.user); assertNull(c.state.value.site); assertEquals(RESTORE_FAILURE, c.state.value.message)
        }
    }
    @Test fun absentExpiredOrBrokenBundleNeverInventsOfflineIdentity() = runTest {
        val missing = FieldCoordinator(LiveGateway(JsonTransport { _, _, _, _ -> error("must not call") }),
            MemoryStore(), backgroundScope, MutableClock())
        missing.initialize(); assertEquals(AuthStage.login, missing.state.value.authStage); assertNull(missing.state.value.message)
        listOf(PAST to EXPIRED_FAILURE, "synthetic-invalid-date" to RESTORE_FAILURE).forEach { (time, message) ->
            val store = savedStore(refreshExpiresAt = time)
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, _, _, _ -> throw SocketException() }), store, backgroundScope, MutableClock())
            c.initialize()
            assertEquals(AuthStage.login, c.state.value.authStage); assertNull(c.state.value.user)
            assertEquals(message, c.state.value.message); assertNotNull(store.tokens)
        }
        val store = MemoryStore().apply { tokens = "bad-json" }
        val c = FieldCoordinator(ScriptedGateway(), store, backgroundScope, MutableClock())
        c.initialize(); assertEquals(RESTORE_FAILURE, c.state.value.message)
    }
    @Test fun siteFailureAfterMeAndRefreshFailureBeforeMeBothRestoreCache() = runTest {
        for (expired in listOf(false, true)) {
            val store = savedStore(expiredAccess = expired)
            val original = store.tokens
            store.write("saved-account", "site:info", Json.encode(SAVED_SITE))
            val calls = mutableListOf<String>()
            var online = false
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, path, _, _ ->
                calls += path
                if (!online && (expired || path != ME)) throw SocketException()
                success(path)
            }), store, backgroundScope, MutableClock())
            c.initialize()
            assertEquals(if (expired) listOf(REFRESH) else listOf(ME, SITE_INFO), calls)
            assertEquals(SAVED_USER, c.state.value.user?.json); assertEquals(SAVED_SITE, c.state.value.site?.json)
            assertTrue(c.state.value.offline); assertEquals(original, store.tokens)
            online = true
            c.siteStatus(); runCurrent()
            assertEquals(ONLINE_USER, c.state.value.user?.json); assertFalse(c.state.value.offline)
            if (expired) assertEquals(listOf(REFRESH, REFRESH, SITE_STATUS, ME, SITE_INFO), calls)
        }
    }
    @Test fun disallowedSavedRoleLogsOutBeforeDiscardEvenIfLogoutFails() = runTest {
        for (logoutFailure in listOf<Any?>(null, ApiReply(401, mapOf("ok" to false)), SocketException())) {
            val store = savedStore(user = SAVED_USER + ("role" to "worker"))
            val saved = store.tokens
            val calls = mutableListOf<String>()
            val c = FieldCoordinator(LiveGateway(JsonTransport { method, path, token, _ ->
                calls += "$method $path"
                assertEquals(saved, store.tokens); assertEquals("old-access", token)
                when (logoutFailure) {
                    is ApiReply -> logoutFailure
                    is Exception -> throw logoutFailure
                    else -> success(path)
                }
            }), store, backgroundScope, MutableClock())
            c.initialize()
            assertEquals(AuthStage.denied, c.state.value.authStage); assertNull(store.tokens)
            assertNull(c.state.value.user); assertEquals(RESTORE_FAILURE, c.state.value.message)
            assertEquals(listOf("POST /api/mobile/v1/session/logout"), calls)
        }
    }
    @Test fun malformedSiteCacheAndOtherAccountCacheDoNotLeak() = runTest {
        listOf(null, "null", "synthetic-invalid-json", "[]").forEach { cache ->
            val store = savedStore()
            store.write("other", "site:info", Json.encode(SAVED_SITE))
            if (cache != null) store.write("saved-account", "site:info", cache)
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, _, _, _ -> throw SocketException() }), store, backgroundScope, MutableClock())
            c.initialize(); assertEquals(AuthStage.ready, c.state.value.authStage); assertNull(c.state.value.site)
        }
    }
    @Test fun onlineRestoreAndLoginCacheBothAssignedAndNullSite() = runTest {
        for (login in listOf(false, true)) for (site in listOf(SAVED_SITE, null)) {
            val store = savedStore()
            store.write("saved-account", "site:info", """{"site_id":"old"}""")
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, path, _, _ -> success(path, site) }), store, backgroundScope, MutableClock())
            if (login) c.signIn("saved-account", "synthetic") else c.initialize()
            assertEquals(AuthStage.ready, c.state.value.authStage)
            assertEquals(Json.encode(site), store.read("saved-account", "site:info"))
            val restored = FieldCoordinator(LiveGateway(JsonTransport { _, _, _, _ -> throw SocketException() }), store, backgroundScope, MutableClock())
            restored.initialize(); assertEquals(site, restored.state.value.site?.json)
        }
    }
    @Test fun firstReconnectRevalidatesOnceWithoutBlockingConcurrentReads() = runTest {
        for (retry in listOf(false, true)) {
            var online = false; var meCalls = 0; var statusCalls = 0
            val pending = CompletableDeferred<ApiReply>()
            val store = savedStore()
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, path, _, _ ->
                when (path) {
                    ME -> { meCalls++; if (!online) throw SocketException(); pending.await() }
                    SITE_STATUS -> {
                        statusCalls++
                        if (retry && statusCalls == 1) ApiReply(401, mapOf("ok" to false, "action" to "refresh")) else success(path)
                    }
                    else -> success(path)
                }
            }), store, backgroundScope, MutableClock())
            c.initialize(); online = true
            if (retry) {
                // 2d: 부수 401은 refresh/재전송 없이 항목에만 남고, 다음 성공이 me 재검증을 시작한다.
                assertEquals(auxiliaryAccessDenied, failure { c.siteStatus() }.message)
                assertEquals(AuthStage.ready, c.state.value.authStage)
                c.siteStatus()
            } else {
                val requests = List(3) { async { c.siteStatus() } }
                requests.forEach { it.await() }
            }
            runCurrent()
            c.siteStatus()
            assertEquals(2, meCalls); assertFalse(pending.isCompleted); assertFalse(c.state.value.offline)
            assertEquals(SAVED_USER, c.state.value.user?.json)
            pending.complete(success(ME)); runCurrent()
            assertEquals(ONLINE_USER, c.state.value.user?.json)
            assertEquals(Json.encode(SAVED_SITE), store.read("saved-account", "site:info"))
            c.siteStatus(); runCurrent(); assertEquals(2, meCalls)
        }
    }
    @Test fun rejectedReconnectLocksOnceButNetworkFailurePreservesSession() = runTest {
        val replies = listOf(
            ApiReply(200, mapOf("ok" to true, "user" to SAVED_USER + ("role" to "worker"))),
            ApiReply(401, mapOf("ok" to false)), ApiReply(403, mapOf("ok" to false)),
            ApiReply(403, mapOf("ok" to false, "action" to "reauth")), null,
        )
        for (reply in replies) {
            var meCalls = 0; var locks = 0
            val pending = CompletableDeferred<ApiReply>()
            val store = savedStore()
            val c = FieldCoordinator(LiveGateway(JsonTransport { _, path, _, _ ->
                if (path == ME) { if (++meCalls == 1) throw SocketException(); pending.await() } else success(path)
            }), store, backgroundScope, MutableClock())
            c.beforeLock = { locks++ }
            c.initialize(); c.siteStatus(); runCurrent()
            if (reply == null) pending.completeExceptionally(SocketException()) else pending.complete(reply)
            runCurrent()
            assertEquals(2, meCalls)
            if (reply != null && (reply.status != 403 || reply.body["action"] == "reauth")) {
                assertEquals(1, locks); assertEquals(AuthStage.reauthenticate, c.state.value.authStage)
                assertNull(c.state.value.user); assertNull(store.tokens)
            } else {
                assertEquals(0, locks); assertEquals(AuthStage.ready, c.state.value.authStage); assertNotNull(store.tokens)
                c.siteStatus(); runCurrent(); assertEquals(2, meCalls)
            }
        }
    }
    @Test fun logoutIgnoresLateBackgroundMe() = runTest {
        var meCalls = 0
        val pending = CompletableDeferred<ApiReply>()
        val store = savedStore()
        val c = FieldCoordinator(LiveGateway(JsonTransport { _, path, _, _ ->
            if (path == ME) { if (++meCalls == 1) throw SocketException(); pending.await() } else success(path)
        }), store, backgroundScope, MutableClock())
        c.initialize(); c.siteStatus(); runCurrent()
        c.signOut(); pending.complete(success(ME)); runCurrent()
        assertEquals(AuthStage.login, c.state.value.authStage); assertNull(c.state.value.user); assertNull(store.tokens)
    }
}
