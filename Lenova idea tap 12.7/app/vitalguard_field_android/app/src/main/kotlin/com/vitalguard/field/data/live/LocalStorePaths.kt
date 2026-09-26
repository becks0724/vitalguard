package com.vitalguard.field.data.live

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64

// Port: local_store_paths.dart. padding을 유지하는 base64url, 80자 디렉터리 조각.
fun localStorePathSegments(key: String): List<String> {
    require(key.isNotEmpty()) { "저장 키가 필요합니다" }
    return Base64.getUrlEncoder().encodeToString(key.toByteArray(Charsets.UTF_8)).chunked(80)
}

fun localStoreKeyFromSegments(segments: List<String>): String? {
    if (segments.isEmpty() || segments.any { !Regex("[A-Za-z0-9_-]+={0,2}").matches(it) }) return null
    return try {
        val bytes = Base64.getUrlDecoder().decode(segments.joinToString(""))
        val key = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        if (key.isEmpty() || localStorePathSegments(key) != segments) null else key
    } catch (_: Exception) { null }
}
