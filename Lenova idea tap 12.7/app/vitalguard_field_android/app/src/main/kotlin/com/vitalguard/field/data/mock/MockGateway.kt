package com.vitalguard.field.data.mock

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import java.time.Clock
import java.time.ZoneOffset

// Port: mock_gateway.dart (세션·현장 샘플). 나머지 메서드는 계약의 "다음 단계".
open class MockGateway(private val clock: Clock = Clock.systemUTC()) : FieldGateway {
    override val isMock = true
    protected var userId = "demo"
    private var sequence = 0
    private val media = mutableListOf<JsonObject>()
    private val photoFiles = mutableMapOf<String, ByteArray>()
    private val mediaOwners = mutableMapOf<String, String>()
    protected val operationMedia = mutableMapOf<String, JsonObject>()
    protected val operationComments = mutableMapOf<String, JsonObject>()
    val logoutTokens = mutableListOf<String>()
    val siteInfoTokens = mutableListOf<String>()
    private fun session() = MobileSession(mapOf(
        "ok" to true, "accessToken" to "mock-access-$userId", "refreshToken" to "mock-refresh-$userId",
        "accessExpiresInSec" to 900, "refreshExpiresAt" to "2099-01-01T00:00:00+09:00",
        "user" to mapOf("id" to userId, "role" to if (userId == "worker") "worker" else "site_manager",
            "name" to "모의 안전관리자", "workerId" to "MOCK-01"), "twoFactorPending" to false,
    ))
    override suspend fun login(id: String, password: String, totpCode: String?): MobileSession {
        if (password != "mock") throw ApiFailure("모의 비밀번호는 mock입니다", status = 401)
        if (id == "totp" && totpCode != "123456") {
            throw ApiFailure("모의 인증번호 123456을 입력하세요", status = 401, twoFactorRequired = true)
        }
        userId = id
        return session()
    }
    override suspend fun refresh(refreshToken: String) = session()
    override suspend fun me(accessToken: String) = session().user
    override suspend fun logout(accessToken: String) { logoutTokens.add(accessToken) }
    override suspend fun siteInfo(accessToken: String): SiteInfo? {
        siteInfoTokens.add(accessToken)
        val now = clock.instant().atOffset(ZoneOffset.ofHours(9))
        return SiteInfo(mapOf("id" to 1, "snapshot_date" to now.toLocalDate().toString(),
            "site_name" to "모의 현장", "company_name" to "모의 시공사", "construction_type" to null,
            "address" to null, "start_date" to null, "completion_date" to null, "recorded_at" to now.toString()))
    }
    override suspend fun siteStatus(accessToken: String) = SiteStatus(mockSiteStatusReply(clock.instant().toString()))
    override suspend fun calendarMedia(token: String, from: String, to: String): List<CalendarMedia> = media
        .filter { mediaOwners[it["id"]] == userId && it["annotation_of"] == null && (it["date_key"] as String) in from..to }
        .map { row -> CalendarMedia(row + mapOf("canDelete" to true, "comments" to operationComments.values.filter { it["media_id"] == row["id"] })) }
    override suspend fun calendarPhoto(token: String, id: String) = photoFiles[id]?.copyOf() ?: throw ApiFailure("사진을 찾을 수 없습니다", status = 404)
    override suspend fun deleteCalendarMedia(token: String, id: String) {
        if (mediaOwners[id] != userId) throw ApiFailure("사진을 찾을 수 없습니다", status = 404)
        media.removeAll { it["id"] == id || it["annotation_of"] == id }
        photoFiles.remove(id); mediaOwners.remove(id)
        operationComments.entries.removeAll { it.value["media_id"] == id }
    }
    override suspend fun upload(token: String, bytes: ByteArray, fields: Map<String, String>): CalendarMedia {
        val operation = fields["clientOperationId"]
        operationMedia["$userId:$operation"]?.let { return CalendarMedia(it, operation, deduplicated = true) }
        val ink = fields.containsKey("annotationOf")
        if (ink) {
            inkUploadSizeError(bytes.size)?.let { throw ApiFailure(it, status = 413) }
            if (fields["annotationOf"].isNullOrBlank()) throw ApiFailure("원본 ID가 필요합니다", status = 400)
            try {
                val body = Json.decodeObject(bytes.toString(Charsets.UTF_8))
                check(body["v"] is Int || body["v"] is Long)
            } catch (_: Exception) { throw ApiFailure("잉크 JSON에 정수 v가 필요합니다", status = 400) }
        }
        val jpeg = bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte()
        val id = "mock-upload-${++sequence}"
        val extension = if (ink) "json" else if (jpeg) "jpg" else "png"
        val row = buildMap<String, Any?> {
            put("id", id); put("date_key", fields["dateKey"]); put("captured_at", fields["capturedAt"])
            put("client_operation_id", operation)
            put("media_type", if (ink) "ink" else "image")
            if (ink) put("annotation_of", fields["annotationOf"])
            put("title", fields["title"]); put("media_url", "https://mock.invalid/upload-$sequence.$extension")
            put("ocr_text", fields["ocrText"]); put("site_id", fields["siteId"])
            put("uploader", "모의 안전관리자"); put("worker_id", "MOCK-01"); put("description", null)
            put("created_at", kstNow(clock).toString())
        }
        media += row
        photoFiles[id] = bytes.copyOf(); mediaOwners[id] = userId
        if (operation != null) operationMedia["$userId:$operation"] = row
        return CalendarMedia(row, operation)
    }
    override suspend fun addComment(token: String, mediaId: String, body: String, clientOperationId: String?): MediaComment {
        operationComments["$userId:$clientOperationId"]?.let { return MediaComment(it, clientOperationId, deduplicated = true) }
        val row = mapOf("id" to "mock-comment-${++sequence}", "media_id" to mediaId, "body" to body,
            "author_id" to userId, "author_name" to "모의 안전관리자", "author_role" to "site_manager",
            "author_title" to null, "created_at" to kstNow(clock).toString(), "updated_at" to null)
        if (clientOperationId != null) operationComments["$userId:$clientOperationId"] = row
        return MediaComment(row, clientOperationId)
    }
    override suspend fun voiceComment(token: String, mediaId: String, audio: ByteArray, durationMs: Int?,
        clientOperationId: String?, siteId: String?): MediaComment {
        operationComments["$userId:$clientOperationId"]?.let { return MediaComment(it, clientOperationId, deduplicated = true) }
        if (token.isEmpty()) throw ApiFailure("로그인이 필요합니다", status = 401)
        if (mediaId.isBlank() || audio.isEmpty() || (durationMs ?: 0) < 0) throw ApiFailure("원본 사진과 유효한 녹음이 필요합니다", status = 400)
        if (audio.size > maxVoiceBytes) throw ApiFailure("녹음 크기가 10 MiB를 넘었습니다", status = 413)
        val photo = media.firstOrNull { it["id"] == mediaId } ?: throw ApiFailure("원본 사진이 없습니다", status = 404)
        if (photo["annotation_of"] != null || photo["media_type"] == "ink") throw ApiFailure("잉크본에는 음성 댓글을 달 수 없습니다", status = 400)
        val id = "mock-voice-${++sequence}"
        val row = mapOf("id" to id, "media_id" to mediaId, "body" to "", "author_id" to userId,
            "author_name" to "모의 안전관리자", "author_role" to "site_manager", "created_at" to kstNow(clock).toString(),
            "audio_storage_key" to id, "audio_url" to "https://mock.invalid/$id.m4a", "audio_ms" to durationMs)
        if (clientOperationId != null) operationComments["$userId:$clientOperationId"] = row
        return MediaComment(row, clientOperationId)
    }

}

fun mockSiteStatusReply(fetchedAt: String): JsonObject = mapOf(
    "ok" to true, "fetchedAt" to fetchedAt,
    "weather" to mapOf("ok" to true, "level" to "normal", "summary" to "기상 특보 0건"),
    "workers" to mapOf("ok" to true, "level" to "normal", "normal" to 12, "waiting" to 0),
    "gas" to mapOf("ok" to true, "level" to "idle", "summary" to "모의 감지기 수신 대기"),
    "aed" to mapOf("ok" to true, "level" to "normal", "summary" to "점검 필요 0건", "total" to 0, "devices" to emptyList<Any>()),
    "alerts" to mapOf("ok" to true, "unacked" to 0, "siteScoped" to false, "items" to emptyList<Any>()),
)

// 원문과 같이 기본 모의는 관제웹 확인 경로, 조회 가능한 모의는 명시적으로 주입한다.
open class MockLookupGateway(clock: Clock = Clock.systemUTC()) : MockGateway(clock), OperationLookupGateway {
    override suspend fun lookupOperations(token: String, clientOperationIds: List<String>) = clientOperationIds.associateWith {
        val row = operationMedia["$userId:$it"] ?: operationComments["$userId:$it"]
        if (row == null) OperationCheck(OperationPresence.absent)
        else OperationCheck(OperationPresence.confirmed, mapOf("id" to row["id"]))
    }
}
