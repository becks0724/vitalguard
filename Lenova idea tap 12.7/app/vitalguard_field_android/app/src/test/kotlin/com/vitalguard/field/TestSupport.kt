package com.vitalguard.field

// Ports: test/support/site_status_fixture.dart, offline_restore_test.dart, site_status_test.dart의 가짜 게이트웨이.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.MemoryStore
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.fail

const val NOW = "2026-09-14T15:13:04.759Z"
const val FUTURE = "2099-01-01T00:00:00Z"
const val PAST = "2000-01-01T00:00:00Z"
const val ME = "/api/mobile/v1/session/me"
const val REFRESH = "/api/mobile/v1/session/refresh"
const val SITE_INFO = "/api/admin/site-info"
const val SITE_STATUS = "/api/app/admin/site-status"
const val RESTORE_FAILURE = "저장된 로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요. 기기 기록은 보존됩니다."
const val EXPIRED_FAILURE = "저장된 로그인의 유효 기간이 지났습니다. 다시 로그인해 주세요. 기기 기록은 보존됩니다."
val SAVED_USER: JsonObject = mapOf("id" to "saved-account", "role" to "site_manager", "name" to "저장된 담당관")
val ONLINE_USER: JsonObject = SAVED_USER + ("name" to "서버에서 갱신한 담당관")
val SAVED_SITE: JsonObject = mapOf("id" to 123, "site_id" to "assigned-site", "site_name" to "저장된 현장", "company_name" to "시공사")
fun session(token: String = "old-access", user: JsonObject = SAVED_USER, refreshExpiresAt: String = FUTURE, seconds: Int = 900) =
    MobileSession(mapOf("ok" to true, "accessToken" to token, "refreshToken" to "synthetic-refresh",
        "accessExpiresInSec" to seconds, "refreshExpiresAt" to refreshExpiresAt, "user" to user))
fun savedStore(expiredAccess: Boolean = false, refreshExpiresAt: String = FUTURE, user: JsonObject = SAVED_USER) = MemoryStore().apply {
    tokens = Json.encode(mapOf("session" to session(user = user, refreshExpiresAt = refreshExpiresAt).json,
        "localAccessExpiresAt" to if (expiredAccess) PAST else FUTURE))
}
fun siteStatusReply(): JsonObject = mapOf(
    "ok" to true, "fetchedAt" to NOW,
    "weather" to mapOf("ok" to true, "level" to "normal", "summary" to "기상 특보 0건"),
    "workers" to mapOf("ok" to true, "level" to "normal", "normal" to 0, "waiting" to 0),
    "gas" to mapOf("ok" to true, "level" to "normal", "summary" to "가스 경보 0건"),
    "aed" to mapOf("ok" to true, "level" to "normal", "summary" to "점검 필요 0건", "total" to 0, "devices" to emptyList<Any>()),
    "alerts" to mapOf("ok" to true, "unacked" to 0, "siteScoped" to false, "items" to emptyList<Any>()),
)
class MutableClock(var time: Instant = Instant.parse(NOW)) : Clock() {
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId): Clock = Clock.fixed(time, zone)
    override fun instant(): Instant = time
    fun advance(seconds: Long) { time = time.plusSeconds(seconds) }
}
suspend fun failure(block: suspend () -> Any?): ApiFailure {
    try { block() } catch (e: ApiFailure) { return e }
    fail("Expected ApiFailure")
    error("unreachable")
}

open class ScriptedGateway : FieldGateway {
    override val isMock = true
    val calls = mutableListOf<String>()
    val tokens = mutableListOf<String>()
    var onLogin: suspend (String, String, String?) -> MobileSession = { id, _, _ -> session(user = SAVED_USER + ("id" to id)) }
    var onRefresh: suspend (String) -> MobileSession = { session("new-access") }
    var onMe: suspend (String) -> AppUser = { AppUser(ONLINE_USER) }
    var onSite: suspend (String) -> SiteInfo? = { SiteInfo(SAVED_SITE) }
    var onStatus: suspend (String) -> SiteStatus = { SiteStatus(siteStatusReply()) }
    var onLogout: suspend (String) -> Unit = {}
    var onUpload: suspend () -> CalendarMedia = { throw ApiFailure("다음 단계") }
    var onAck: suspend () -> Boolean = { throw ApiFailure("다음 단계") }
    override suspend fun login(id: String, password: String, totpCode: String?): MobileSession {
        calls += "login"; return onLogin(id, password, totpCode)
    }
    override suspend fun refresh(refreshToken: String): MobileSession { calls += "refresh"; return onRefresh(refreshToken) }
    override suspend fun me(accessToken: String): AppUser { calls += "me"; return onMe(accessToken) }
    override suspend fun siteInfo(accessToken: String): SiteInfo? { calls += "site"; return onSite(accessToken) }
    override suspend fun siteStatus(accessToken: String): SiteStatus {
        calls += "status"; tokens += accessToken; return onStatus(accessToken)
    }
    override suspend fun logout(accessToken: String) { calls += "logout"; onLogout(accessToken) }
    override suspend fun upload(token: String, bytes: ByteArray, fields: Map<String, String>): CalendarMedia {
        calls += "upload"; return onUpload()
    }
    override suspend fun ackAlert(accessToken: String, id: String): Boolean { calls += "ack"; return onAck() }
}
