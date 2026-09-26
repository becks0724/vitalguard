package com.vitalguard.field.data.session

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import java.time.Clock
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// Port: lib/data/field_coordinator.dart. App의 Main scope에서 호출, JVM에서는 주입 scope/clock.
class FieldCoordinator(
    val gateway: FieldGateway,
    override val local: LocalStore,
    private val scope: CoroutineScope,
    private val clock: Clock = Clock.systemUTC(),
) : FieldController {
    private val mutable = MutableStateFlow(FieldState())
    override val state = mutable.asStateFlow()
    override val isMock get() = gateway.isMock
    override var beforeLock: (suspend () -> Unit)? = null
    private var session: MobileSession? = null
    private var accessExpiresAt: Instant? = null
    private var refreshing: CompletableDeferred<Unit>? = null
    private var revalidateOnReconnect = false
    private var epoch = 0
    private var remember = true
    private var challengeId: String? = null
    private var challengePassword: String? = null
    private var disposed = false
    private var revalidation: Job? = null
    private val tokenWrites = Mutex()
    private val s get() = mutable.value
    private fun update(block: (FieldState) -> FieldState) { if (!disposed) mutable.value = block(s) }
    private fun clearView() {
        revalidateOnReconnect = false
        update { it.copy(user = null, site = null, siteStatusSnapshot = null, siteStatusForbidden = false) }
    }
    private fun allowed(user: AppUser) = user.role in setOf("platform_admin", "owner", "site_manager", "admin")
    private fun authenticationRejected(error: Throwable) = error is ApiFailure &&
        (error.status == 401 || error.status == 403 || error.action == "reauth")
    private fun checkEpoch(expected: Int) {
        if (expected != epoch || disposed) throw ApiFailure("로그인 상태가 바뀌었습니다")
    }
    private fun rethrowCancellation(error: Throwable) { if (error is CancellationException) throw error }

    private suspend fun accept(value: MobileSession, expected: Int, expiresAt: Instant? = null) {
        checkEpoch(expected)
        if (!allowed(value.user)) {
            try { gateway.logout(value.accessToken) } catch (e: Exception) { rethrowCancellation(e) }
            checkEpoch(expected)
            session = null
            clearView()
            tokenWrites.withLock { checkEpoch(expected); local.writeTokenBundle(null) }
            checkEpoch(expected)
            update { it.copy(authStage = AuthStage.denied) }
            throw ApiFailure("이 앱을 사용할 수 없는 계정입니다. 현장 관리자 계정을 확인해 주세요", status = 403)
        }
        session = value
        update { it.copy(user = value.user) }
        accessExpiresAt = expiresAt ?: clock.instant().plusSeconds(value.accessExpiresInSec.toLong())
        tokenWrites.withLock {
            checkEpoch(expected)
            local.writeTokenBundle(if (remember) Json.encode(mapOf(
                "session" to value.json, "localAccessExpiresAt" to accessExpiresAt!!.toString(),
            )) else null)
        }
        checkEpoch(expected)
    }

    override suspend fun initialize() {
        val expected = ++epoch
        var savedSession: MobileSession? = null
        revalidateOnReconnect = false
        update { it.copy(message = null) }
        try {
            val raw = local.readTokenBundle()
            if (expected != epoch) return
            if (raw == null) {
                update { it.copy(authStage = AuthStage.login) }
                return
            }
            val stored = Json.decodeObject(raw)
            val saved = MobileSession(requireNotNull(stored["session"].jsonObjectOrNull()))
            accept(saved, expected, parseInstant(stored["localAccessExpiresAt"] as String))
            if (expected != epoch) return
            savedSession = saved
            val current = authorized(action = gateway::me)
            if (!allowed(current)) throw ApiFailure("이 앱을 사용할 수 없는 계정입니다", status = 403, action = "reauth")
            checkEpoch(expected)
            update { it.copy(user = current) }
            val site = loadSite()
            if (expected != epoch) return
            update { it.copy(site = site, authStage = AuthStage.ready) }
        } catch (error: Exception) {
            rethrowCancellation(error)
            if (expected != epoch && s.authStage != AuthStage.reauthenticate) return
            var refreshExpiresAt: Instant? = null
            val saved = savedSession
            if (!authenticationRejected(error) && saved != null && expected == epoch) {
                refreshExpiresAt = try { parseInstantOrNull(saved.refreshExpiresAt) } catch (_: Exception) { null }
                if (refreshExpiresAt?.isAfter(clock.instant()) == true) {
                    val cached = readCachedSite(saved.user.id)
                    if (expected != epoch) return
                    revalidateOnReconnect = true
                    update { it.copy(user = saved.user, site = cached, authStage = AuthStage.ready, offline = true, message = null) }
                    return
                }
            }
            clearView()
            update { it.copy(
                authStage = if (it.authStage == AuthStage.denied) AuthStage.denied else AuthStage.login,
                message = if (refreshExpiresAt != null)
                    "저장된 로그인의 유효 기간이 지났습니다. 다시 로그인해 주세요. 기기 기록은 보존됩니다."
                else "저장된 로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요. 기기 기록은 보존됩니다.",
            ) }
        }
    }

    private suspend fun loadSite(): SiteInfo? {
        val expected = epoch
        val account = s.user?.id
        val result = authorized(action = gateway::siteInfo)
        checkEpoch(expected)
        if (account != null) local.write(account, "site:info", Json.encode(result?.json))
        checkEpoch(expected)
        return result
    }

    private suspend fun readCachedSite(account: String): SiteInfo? = try {
        local.read(account, "site:info")?.let { Json.decode(it).jsonObjectOrNull()?.let(::SiteInfo) }
    } catch (e: Exception) { rethrowCancellation(e); null }

    private fun markOnline() {
        val wasOffline = s.offline
        update { it.copy(offline = false) }
        if (!wasOffline) return
        if (revalidateOnReconnect) {
            // 시작 전에 소비한다. me의 성공이나 동시 요청은 두 번째 작업을 만들지 않는다.
            revalidateOnReconnect = false
            val expected = epoch
            revalidation = scope.launch { revalidateSession(expected) }
        }
    }

    private suspend fun revalidateSession(expected: Int) {
        try {
            val current = authorized(retryUnauthorized = false, action = gateway::me)
            if (expected != epoch) return
            if (!allowed(current)) throw ApiFailure("이 앱을 사용할 수 없는 계정입니다", status = 403, action = "reauth")
            update { it.copy(user = current) }
            try {
                val site = loadSite()
                if (expected != epoch) return
                update { it.copy(site = site) }
            } catch (e: Exception) { rethrowCancellation(e) }
        } catch (error: Exception) {
            rethrowCancellation(error)
            if (expected == epoch && authenticationRejected(error)) lock()
        }
    }

    override suspend fun signIn(id: String, password: String, remember: Boolean) {
        if (s.busy || s.lockedUntil?.isAfter(clock.instant()) == true) return
        val expected = ++epoch
        clearView()
        session = null
        refreshing = null
        this.remember = remember
        challengeId = id.trim()
        challengePassword = password
        login(expected)
    }

    private suspend fun login(expected: Int, code: String? = null) {
        update { it.copy(busy = true, message = null, loginFailure = null) }
        try {
            val result = gateway.login(requireNotNull(challengeId), requireNotNull(challengePassword), code)
            if (expected != epoch) return
            accept(result, expected)
            challengePassword = null
            challengeId = null
            val site = loadSite()
            if (expected != epoch) return
            update { it.copy(site = site, authStage = AuthStage.ready, offline = false) }
        } catch (error: ApiFailure) {
            if (expected != epoch) return
            update { it.copy(
                message = error.message, loginFailure = error,
                lockedUntil = error.retryAfterSec?.let { seconds -> clock.instant().plusSeconds(seconds.toLong()) } ?: it.lockedUntil,
                authStage = when {
                    error.twoFactorRequired -> AuthStage.totp
                    it.authStage == AuthStage.denied || it.authStage == AuthStage.reauthenticate -> it.authStage
                    else -> AuthStage.login
                },
            ) }
            if (s.authStage != AuthStage.totp) { challengePassword = null; challengeId = null }
        } catch (error: Exception) {
            rethrowCancellation(error)
            if (expected != epoch) return
            challengePassword = null
            challengeId = null
            update { it.copy(message = "로그인 응답 또는 기기 저장 상태를 확인할 수 없습니다", authStage = AuthStage.login) }
        } finally {
            // 이전 계정의 늦은 완료가 새 로그인의 busy를 풀지 못한다.
            if (expected == epoch || s.authStage == AuthStage.reauthenticate) update { it.copy(busy = false) }
        }
    }

    override suspend fun submitTotp(code: String) {
        if (s.busy || s.lockedUntil?.isAfter(clock.instant()) == true) return
        if (challengePassword == null) {
            update { it.copy(authStage = AuthStage.login) }
            return
        }
        login(epoch, code)
    }

    override suspend fun cancelSignIn() {
        ++epoch
        challengePassword = null
        challengeId = null
        session = null
        clearView()
        update { it.copy(authStage = AuthStage.login, busy = false, message = null, loginFailure = null) }
    }

    private suspend fun lock() {
        val expected = epoch
        try { beforeLock?.invoke() } catch (e: Exception) {
            rethrowCancellation(e)
            if (expected == epoch) update { it.copy(message = "초안 저장 상태를 확인해 주세요. 다시 로그인해야 합니다.") }
        }
        if (expected != epoch) return
        ++epoch
        session = null
        clearView()
        update { it.copy(authStage = AuthStage.reauthenticate) }
        try { tokenWrites.withLock { local.writeTokenBundle(null) } }
        catch (e: Exception) { rethrowCancellation(e) }
    }

    private suspend fun refresh() {
        refreshing?.let { it.await(); return }
        val expected = epoch
        val current = session ?: throw ApiFailure("다시 로그인해 주세요", action = "reauth")
        val work = CompletableDeferred<Unit>()
        refreshing = work
        try {
            accept(gateway.refresh(current.refreshToken), expected)
            work.complete(Unit)
        } catch (e: Exception) {
            if (e is ApiFailure && expected == epoch && authenticationRejected(e)) lock()
            work.completeExceptionally(e)
            throw e
        } finally {
            if (refreshing === work) refreshing = null
        }
    }

    private suspend fun <T> authorized(
        writing: Boolean = false,
        retryUnauthorized: Boolean = true,
        action: suspend (String) -> T,
    ): T {
        val expected = epoch
        if (session == null) throw ApiFailure("다시 로그인해 주세요", action = "reauth")
        if (accessExpiresAt?.isBefore(clock.instant()) != false) refresh()
        checkEpoch(expected)
        val token = session?.accessToken ?: throw ApiFailure("로그인 상태가 바뀌었습니다")
        fun checkResultEpoch() {
            if (expected != epoch) throw ApiFailure("다른 계정으로 전환됐습니다. 처리 결과를 확인해 주세요", uncertainWrite = writing)
        }
        try {
            val result = action(token)
            checkResultEpoch()
            markOnline()
            return result
        } catch (error: ApiFailure) {
            if (expected != epoch) throw error
            if (retryUnauthorized && !error.uncertainWrite && error.status == 401 &&
                error.action != "none" && error.action != "reauth") {
                if (session?.accessToken == token) refresh()
                if (expected != epoch || session == null) throw error
                try {
                    val result = action(session!!.accessToken)
                    checkResultEpoch()
                    markOnline()
                    return result
                } catch (retryError: ApiFailure) {
                    if (expected == epoch && (retryError.status == 401 || retryError.action == "reauth")) lock()
                    if (expected == epoch && retryError.status == null) update { it.copy(offline = true) }
                    throw retryError
                }
            }
            if (error.action == "reauth") lock()
            if (error.status == null) update { it.copy(offline = true) }
            throw error
        }
    }

    override suspend fun signOut() {
        val expected = epoch
        beforeLock?.invoke()
        checkEpoch(expected)
        val token = session?.accessToken
        val signedOutEpoch = ++epoch
        session = null
        refreshing = null
        clearView()
        challengePassword = null
        challengeId = null
        tokenWrites.withLock { local.writeTokenBundle(null) }
        if (signedOutEpoch != epoch) return
        update { it.copy(authStage = AuthStage.login, message = null, loginFailure = null, busy = false) }
        if (token != null) {
            try { gateway.logout(token) } catch (e: Exception) {
                rethrowCancellation(e)
                if (signedOutEpoch == epoch) update { it.copy(message = "기기에서는 로그아웃했습니다. 서버 세션 종료는 확인하지 못했습니다.") }
            }
        }
    }

    override suspend fun refreshSite() {
        val result = loadSite()
        update { it.copy(site = result) }
    }

    override suspend fun siteStatus(): SiteStatus {
        val expected = epoch
        try {
            val result = authorized(action = gateway::siteStatus)
            checkEpoch(expected)
            update { it.copy(siteStatusSnapshot = result, siteStatusForbidden = false) }
            return result
        } catch (error: ApiFailure) {
            if (expected == epoch && (error.status == 403 || error.status == 401)) {
                update { it.copy(siteStatusSnapshot = null, siteStatusForbidden = error.status == 403) }
            }
            throw error
        }
    }

    override suspend fun cctvTicket(cameraId: String) = authorized { gateway.cctvTicket(it, cameraId) }
    override suspend fun ackAlert(id: String): Boolean {
        if (s.offline) throw ApiFailure("연결 후 가능", action = "none")
        if (id.isBlank()) throw ApiFailure("경보 ID를 확인해 주세요", status = 400)
        return authorized(writing = true, retryUnauthorized = false) {
            if (s.offline) throw ApiFailure("연결 후 가능", action = "none")
            gateway.ackAlert(it, id)
        }
    }
    override suspend fun photoBytes(media: CalendarMedia): ByteArray {
        val account = s.user?.id ?: throw ApiFailure("다시 로그인해 주세요")
        val expected = epoch
        if (media.json["local"] != true) throw ApiFailure("원본이 기기에 없습니다")
        val bytes = local.readBytes(account, "outbox-file:${media.id}")
        checkEpoch(expected)
        return bytes ?: throw ApiFailure("원본이 기기에 없습니다")
    }
    override suspend fun publish(bytes: ByteArray, fields: Map<String, String>) =
        authorized(writing = true) { gateway.upload(it, bytes, fields) }
    override suspend fun comment(mediaId: String, text: String, clientOperationId: String?) =
        authorized(writing = true) { gateway.addComment(it, mediaId, text, clientOperationId) }
    override suspend fun voiceComment(mediaId: String, audio: ByteArray, durationMs: Int?, clientOperationId: String?, siteId: String?) =
        authorized(writing = true) { gateway.voiceComment(it, mediaId, audio, durationMs, clientOperationId, siteId) }
    override suspend fun captureAddress(latitude: Double, longitude: Double): String? {
        val addressGateway = gateway as? CaptureAddressGateway ?: return null
        return authorized { addressGateway.captureAddress(it, latitude, longitude) }
    }
    // 게이트웨이가 조회 계약을 구현한 환경에서만 조회 버튼을 제공한다.
    override val operationLookupAvailable get() = gateway is OperationLookupGateway
    override suspend fun lookupOperations(ids: List<String>): Map<String, OperationCheck> {
        val lookup = gateway as? OperationLookupGateway ?: return super.lookupOperations(ids)
        return authorized { lookup.lookupOperations(it, ids) }
    }
    override fun close() {
        disposed = true
        ++epoch
        challengePassword = null
        challengeId = null
        session = null
        revalidation?.cancel()
    }
}
