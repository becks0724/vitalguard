// 가속도 크기(g) 스트림 → 무동작 지속·모션 변동폭 — iOS WatchStreamer 의 계약을 그대로 이식한다
package com.vitalguard.wear.core

/**
 * iOS 원본과 같은 상수·같은 반올림·같은 null 규칙.
 *  - 임계 0.03g 이상이면 "움직였다" (`mag >= threshold` — 경계 포함)
 *  - 변동폭은 창 60개가 **다 차기 전엔 null** (부분 창을 보내느니 비운다)
 *  - 무동작 지속은 콜백이 한 번도 안 돌았으면 **0 이 아니라 null** (못 잰 것 ≠ 안 움직인 것)
 * ⚠ 워치8 실기의 채집 주기가 1Hz 가 아닐 수 있다 — 실측 ③ 뒤 창 크기(초 환산)를 재확정한다.
 */
class MotionTracker(
    private val moveThresholdG: Double = 0.03,
    private val windowSize: Int = 60,
) {
    private val magWindow = ArrayDeque<Double>()
    private var updates = 0
    private var lastMovementAtMs: Long? = null
    var maxG = 0.0
        private set

    /** 세션 시작 — iOS 처럼 기준점을 '시작 시각'으로 세워 무동작이 세션 시작부터 계수된다. */
    fun start(nowMs: Long) {
        magWindow.clear()
        updates = 0
        maxG = 0.0
        lastMovementAtMs = nowMs
    }

    fun onSample(magG: Double, atMs: Long) {
        updates++
        magWindow.addLast(magG)
        if (magWindow.size > windowSize) magWindow.removeFirst()
        if (magG > maxG) maxG = magG
        if (magG >= moveThresholdG) lastMovementAtMs = atMs
    }

    /** 무동작 지속(초 · 0.1 단위 반올림). */
    fun stillSec(nowMs: Long): Double? {
        val at = lastMovementAtMs
        if (updates == 0 || at == null) return null
        return Math.round((nowMs - at) / 1000.0 * 10) / 10.0
    }

    /** 모션 변동폭(밀리g 정수 · 모집단 표준편차). */
    fun variabilityMg(): Int? {
        if (magWindow.size < windowSize) return null
        val n = magWindow.size.toDouble()
        val mean = magWindow.sum() / n
        val variance = magWindow.sumOf { (it - mean) * (it - mean) } / n
        return Math.round(kotlin.math.sqrt(variance) * 1000).toInt()
    }
}
