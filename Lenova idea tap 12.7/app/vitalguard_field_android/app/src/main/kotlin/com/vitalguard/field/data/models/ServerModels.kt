@file:Suppress("PropertyName")
package com.vitalguard.field.data.models

import java.util.Collections

// Port: lib/data/models/server_models.dart. 서버 JSON 이름을 유지한다.
open class ServerRow(json: JsonObject) {
    val json: JsonObject = Collections.unmodifiableMap(LinkedHashMap(json))
    fun text(key: String): String? = json[key] as? String
    fun number(key: String): Double? = (json[key] as? Number)?.toDouble()
    fun flag(key: String): Boolean? = json[key] as? Boolean
}

class AppUser(json: JsonObject) : ServerRow(json) {
    val id: String get() = requireNotNull(text("id")) { "사용자 응답 형식을 확인할 수 없습니다" }
    val role: String get() = requireNotNull(text("role")) { "사용자 응답 형식을 확인할 수 없습니다" }
    val name get() = text("name")
    val workerId get() = text("workerId")
}

class MobileSession(json: JsonObject) : ServerRow(json) {
    val accessToken: String get() = requireNotNull(text("accessToken")) { "로그인 응답 형식을 확인할 수 없습니다" }
    val refreshToken: String get() = requireNotNull(text("refreshToken")) { "로그인 응답 형식을 확인할 수 없습니다" }
    val accessExpiresInSec: Int get() = (json["accessExpiresInSec"] as Number).toInt()
    val refreshExpiresAt: String get() = requireNotNull(text("refreshExpiresAt")) { "로그인 응답 형식을 확인할 수 없습니다" }
    val user: AppUser get() = AppUser(requireNotNull(json["user"].jsonObjectOrNull()) { "사용자 응답 형식을 확인할 수 없습니다" })
    val twoFactorPending get() = flag("twoFactorPending")
}

class CctvTicket(json: JsonObject) : ServerRow(json) {
    init {
        require(json["ok"] == true && !text("ticket").isNullOrEmpty() &&
            !Regex("[\\x00-\\x20\\x7f]").containsMatchIn(text("ticket").orEmpty()) &&
            (json["expiresAt"] is Int || json["expiresAt"] is Long) &&
            (json["ttlSec"] is Int || json["ttlSec"] is Long) &&
            (json["ttlSec"] as Number).toLong() > 0 && text("gateApi") != null) {
            "CCTV 티켓 응답 형식이 올바르지 않습니다"
        }
    }
    val ok get() = flag("ok")!!
    val ticket get() = text("ticket")!!
    val expiresAt get() = (json["expiresAt"] as Number).toLong() // Unix epoch ms
    val ttlSec get() = (json["ttlSec"] as Number).toInt()
    val gateApi get() = text("gateApi")!!
}

class SiteInfo(json: JsonObject) : ServerRow(json) {
    // id는 일별 스냅숏 ID이며 배정 ID가 아니다.
    val site_id get() = text("site_id")
    val site_name get() = text("site_name")
    val company_name get() = text("company_name")
    val address get() = text("address")
}

class CalendarMedia(
    json: JsonObject,
    val clientOperationId: String? = null,
    val deduplicated: Boolean = false,
) : ServerRow(json) {
    // 위 두 값은 응답 봉투이며 행 JSON에 넣지 않는다.
    val id get() = text("id")!!
    val date_key get() = text("date_key")!!
    val captured_at get() = text("captured_at")
    val title get() = text("title")
    val media_type get() = text("media_type")
    val media_url get() = text("media_url")
    val thumbnail_url get() = text("thumbnail_url")
    val ocr_text get() = text("ocr_text")
    val road_address get() = text("road_address")
    val latitude get() = number("latitude")
    val longitude get() = number("longitude")
    val site_id get() = text("site_id")
    val worker_id get() = text("worker_id")
    val uploader get() = text("uploader")
    val description get() = text("description")
    val coord_gap_m get() = number("coord_gap_m")
    val coord_ref_accuracy_m get() = number("coord_ref_accuracy_m")
    val canDelete get() = flag("canDelete")
    val comments: List<MediaComment> get() = (json["comments"] as? List<*>).orEmpty()
        .map { MediaComment(requireNotNull(it.jsonObjectOrNull())) }
}

class MediaComment(
    json: JsonObject,
    val clientOperationId: String? = null,
    val deduplicated: Boolean = false,
) : ServerRow(json) {
    val id get() = text("id")!!
    val media_id get() = text("media_id")!!
    val body get() = text("body")!!
    val author_id get() = text("author_id")
    val author_name get() = text("author_name")
    val author_role get() = text("author_role")
    val author_title get() = text("author_title")
    val created_at get() = text("created_at")
    val updated_at get() = text("updated_at")
    val audio_storage_key get() = text("audio_storage_key")
    val audio_url get() = text("audio_url")
    val audio_ms get() = (json["audio_ms"] as? Number)?.toInt()
}
