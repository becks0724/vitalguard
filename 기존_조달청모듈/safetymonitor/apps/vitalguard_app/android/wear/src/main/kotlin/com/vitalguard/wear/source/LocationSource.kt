// 위치 심(seam) — iOS LocationProvider 의 계약 이식: 배치당 1회 조회, 묵은 좌표는 싣지 않는다
package com.vitalguard.wear.source

/** 좌표 4종 한 덩어리 — 정확도·측위시각 없이 좌표만 싣지 않는다(관제가 품질·나이를 못 잰다). */
data class LocationFix(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double,
    val atMs: Long,
)

interface LocationSource {
    fun start()
    fun stop()

    /** 신선한 fix 만 준다 — 유효기간을 넘긴 좌표는 null (묵은 좌표 금지 · iOS 와 같은 규칙). */
    fun currentFix(nowMs: Long): LocationFix?
}

/** 시험용 페이크 — 넣어 둔 fix 를 유효기간 규칙 그대로 돌려준다. */
class FakeLocationSource(
    private val maxAgeMs: Long = 120_000,
) : LocationSource {
    var fix: LocationFix? = null

    override fun start() = Unit
    override fun stop() = Unit
    override fun currentFix(nowMs: Long): LocationFix? {
        val f = fix ?: return null
        return if (nowMs - f.atMs <= maxAgeMs) f else null
    }
}
