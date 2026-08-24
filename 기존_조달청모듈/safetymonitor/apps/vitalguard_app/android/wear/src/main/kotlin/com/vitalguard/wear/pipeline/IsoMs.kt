// epoch ms → 정준 ISO 8601(밀리초 3자리 · Z) — 서버 canonicalIsoMs 와 같은 형태만 낸다
package com.vitalguard.wear.pipeline

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

object IsoMs {
    // 항상 소수 3자리 — 서버 Zod 가드(ts-canonical-format)가 이 형태를 정준으로 삼는다.
    private val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .withZone(ZoneOffset.UTC)

    fun format(epochMs: Long): String = fmt.format(Instant.ofEpochMilli(epochMs))
}
