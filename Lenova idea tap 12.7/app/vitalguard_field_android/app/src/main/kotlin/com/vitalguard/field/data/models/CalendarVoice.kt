package com.vitalguard.field.data.models

import java.net.URI

const val voiceUrlUnavailable = "음성 재생 미확인 · 서버가 재생 주소를 제공하지 않았습니다. 기록을 새로 불러와 주세요."

/** GET /api/calendar/media가 발급한 주소만 쓴다. storage key로 임의 경로를 만들지 않는다. */
fun calendarVoiceUrl(comment: MediaComment): String? {
    if (!comment.isVoice) return null
    val raw = comment.audio_url?.takeIf { it.isNotBlank() } ?: return null
    return runCatching { URI(raw) }.getOrNull()?.takeIf {
        it.scheme == "https" && !it.host.isNullOrBlank() && it.userInfo == null
    }?.let { raw }
}
