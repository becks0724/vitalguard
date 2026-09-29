package com.vitalguard.field.data.contracts

import com.vitalguard.field.data.models.*
import java.time.Instant
import kotlinx.coroutines.flow.StateFlow

// Port: lib/data/contracts/field_contracts.dart. 예외에 원본 응답/자격 증명을 넣지 않는다.
class ApiFailure(
    override val message: String,
    val status: Int? = null,
    val code: String? = null,
    val action: String? = null,
    val retryAfterSec: Int? = null,
    val twoFactorRequired: Boolean = false,
    val uncertainWrite: Boolean = false,
    val networkUnreachable: Boolean = false,
) : Exception(message) {
    override fun toString() = message
}

fun nextStage(): Nothing = throw ApiFailure("다음 단계")

const val auxiliaryAccessDenied = "권한 없음 · 다시 로그인하면 다시 시도합니다"

interface FieldGateway {
    val isMock: Boolean
    suspend fun login(id: String, password: String, totpCode: String? = null): MobileSession
    suspend fun refresh(refreshToken: String): MobileSession
    suspend fun me(accessToken: String): AppUser
    suspend fun memberProfile(accessToken: String): com.vitalguard.field.data.profile.MemberProfile = nextStage()
    suspend fun logout(accessToken: String)
    suspend fun siteInfo(accessToken: String): SiteInfo?
    suspend fun siteStatus(accessToken: String): SiteStatus
    suspend fun calendarMedia(token: String, from: String, to: String): List<CalendarMedia> = nextStage()
    suspend fun calendarPhoto(token: String, id: String): ByteArray = nextStage()
    suspend fun calendarVoice(comment: MediaComment): ByteArray = nextStage()
    suspend fun deleteCalendarMedia(token: String, id: String): Unit = nextStage()
    // CCTV·경보 확인 HTTP는 3단계. 기록 쓰기는 동일한 원장을 통해 상세 닫힘/재접속/수동 실패 재시도에서 호출한다.
    suspend fun cctvTicket(accessToken: String, cameraId: String): CctvTicket = nextStage()
    suspend fun ackAlert(accessToken: String, id: String): Boolean = nextStage()
    suspend fun upload(token: String, bytes: ByteArray, fields: Map<String, String>): CalendarMedia = nextStage()
    suspend fun addComment(token: String, mediaId: String, body: String, clientOperationId: String? = null): MediaComment = nextStage()
    suspend fun voiceComment(token: String, mediaId: String, audio: ByteArray, durationMs: Int? = null,
        clientOperationId: String? = null, siteId: String? = null): MediaComment = nextStage()
}

interface CaptureAddressGateway {
    suspend fun captureAddress(token: String, latitude: Double, longitude: Double): String? = nextStage()
}

enum class OperationPresence { confirmed, absent, unknown }
data class OperationCheck(val presence: OperationPresence, val receipt: JsonObject? = null, val deduplicated: Boolean = false)
interface OperationLookupGateway {
    suspend fun lookupOperations(token: String, clientOperationIds: List<String>): Map<String, OperationCheck> = nextStage()
}

interface LocalStore {
    suspend fun readTokenBundle(): String?
    suspend fun writeTokenBundle(json: String?)
    suspend fun read(accountId: String, key: String): String?
    suspend fun write(accountId: String, key: String, value: String)
    suspend fun readBytes(accountId: String, key: String): ByteArray?
    suspend fun writeBytes(accountId: String, key: String, bytes: ByteArray)
    suspend fun remove(accountId: String, key: String)
    suspend fun keys(accountId: String): List<String>
}

enum class AuthStage { restoring, login, totp, ready, denied, reauthenticate }

// 화면/로컬 상태. 서버 JSON에 이 필드를 추가하지 않는다.
data class FieldState(
    val authStage: AuthStage = AuthStage.restoring,
    val busy: Boolean = false,
    val offline: Boolean = false,
    val message: String? = null,
    val loginFailure: ApiFailure? = null,
    val lockedUntil: Instant? = null,
    val user: AppUser? = null,
    val site: SiteInfo? = null,
    val siteStatusSnapshot: SiteStatus? = null,
    val siteStatusForbidden: Boolean = false,
)

interface FieldController : AutoCloseable {
    val state: StateFlow<FieldState>
    val isMock: Boolean
    val local: LocalStore
    var beforeLock: (suspend () -> Unit)?
    suspend fun initialize()
    suspend fun signIn(id: String, password: String, remember: Boolean = true)
    suspend fun submitTotp(code: String)
    suspend fun cancelSignIn()
    suspend fun signOut()
    suspend fun refreshSite()
    suspend fun siteStatus(): SiteStatus
    suspend fun memberProfile(): com.vitalguard.field.data.profile.MemberProfile = nextStage()
    suspend fun calendarMedia(from: String, to: String): List<CalendarMedia> = nextStage()
    suspend fun deleteCalendarMedia(id: String): Unit = nextStage()
    fun connectivityChanged(online: Boolean) {}
    suspend fun photoBytes(media: CalendarMedia): ByteArray = nextStage()
    suspend fun voiceBytes(comment: MediaComment): ByteArray = nextStage()
    suspend fun publish(bytes: ByteArray, fields: Map<String, String>): CalendarMedia = nextStage()
    suspend fun comment(mediaId: String, text: String, clientOperationId: String? = null): MediaComment = nextStage()
    suspend fun voiceComment(mediaId: String, audio: ByteArray, durationMs: Int? = null,
        clientOperationId: String? = null, siteId: String? = null): MediaComment = nextStage()
    suspend fun cctvTicket(cameraId: String): CctvTicket = nextStage()
    suspend fun ackAlert(id: String): Boolean = nextStage()
    suspend fun captureAddress(latitude: Double, longitude: Double): String? = null
    val operationLookupAvailable: Boolean get() = false
    suspend fun lookupOperation(clientOperationId: String): OperationCheck =
        lookupOperations(listOf(clientOperationId))[clientOperationId] ?: OperationCheck(OperationPresence.unknown)
    suspend fun lookupOperations(ids: List<String>): Map<String, OperationCheck> =
        ids.associateWith { OperationCheck(OperationPresence.unknown) }
    override fun close() {}
}

fun interface InternetProbe { suspend fun hasInternet(): Boolean? }

interface CalendarPhotoCache {
    suspend fun read(owner: String, id: String): ByteArray?
    suspend fun write(owner: String, id: String, bytes: ByteArray)
    suspend fun remove(owner: String, id: String)
}
