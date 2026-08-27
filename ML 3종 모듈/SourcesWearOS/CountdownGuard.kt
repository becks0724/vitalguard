// 카운트다운 가드 (Wear OS 판) — Swift CountdownGuard 포팅. danger 판정 후 30초 확인 창.
// "낙상 아님" 버튼(수동) 외에, recovery 와 같은 원리로 **지속적 움직임이 감지되면 자동 취소**한다.
// 안전 설계: 순간 경련·짧은 꿈틀거림에 취소되지 않도록 "연속 sustainSec 초 이상 움직임"을 요구.
// 사용: danger 시점에 start() → 매 모션 샘플 feed(totalG) → 콜백 3종 중 하나로 종료.
package com.vitalguard.ml

import kotlin.math.sqrt

class CountdownGuard(
    private val durationSec: Double = 30.0,
    private val movingStd: Double = 0.15,   // 1초 창 |accel| 표준편차가 이 이상이면 "움직임"
    private val sustainSec: Int = 5,        // 연속 몇 초 움직여야 자동 취소인가
    private val fs: Double = 50.0
) {
    var onAutoCancel: (() -> Unit)? = null    // 지속 움직임 → 자동 "낙상 아님"
    var onManualCancel: (() -> Unit)? = null  // 버튼 → cancelByUser() 호출측이 연결
    var onConfirm: (() -> Unit)? = null       // 시간 만료(무반응) → 낙상 확정·신고

    private var deadlineMs: Long? = null
    private val second = ArrayList<Double>()  // 현재 1초 버킷
    private var movingStreak = 0
    private var finished = false

    fun start(nowMs: Long = System.currentTimeMillis()) {
        deadlineMs = nowMs + (durationSec * 1000).toLong()
        second.clear()
        movingStreak = 0
        finished = false
    }

    /** 모션 콜백에서 매 샘플 호출 (모듈 로거와 같은 스레드에서). */
    fun feed(totalG: Double, nowMs: Long = System.currentTimeMillis()) {
        val deadline = deadlineMs
        if (finished || deadline == null) return
        second.add(totalG)
        if (second.size >= fs.toInt()) {                   // 1초 버킷 완성
            val n = second.size.toDouble()
            var mean = 0.0
            for (v in second) mean += v
            mean /= n
            var varsum = 0.0
            for (v in second) varsum += (v - mean) * (v - mean)
            val sd = sqrt(varsum / n)
            second.clear()
            movingStreak = if (sd >= movingStd) movingStreak + 1 else 0
            if (movingStreak >= sustainSec) {              // 연속 움직임 → 회복으로 판단
                finish { onAutoCancel?.invoke() }
                return
            }
        }
        if (nowMs >= deadline) {                           // 무반응 → 확정
            finish { onConfirm?.invoke() }
        }
    }

    /** "낙상 아님" 버튼에서 호출. */
    fun cancelByUser() {
        if (finished) return
        finish { onManualCancel?.invoke() }
    }

    private fun finish(emit: () -> Unit) {
        finished = true
        deadlineMs = null
        emit()
    }
}
