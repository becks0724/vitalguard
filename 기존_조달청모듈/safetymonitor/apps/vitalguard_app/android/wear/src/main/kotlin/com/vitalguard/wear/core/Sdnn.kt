// IBI(박동 간격) 목록 → SDNN(ms) — 삼성 IBI_LIST 로 HRV 를 직접 계산한다 (애플은 완제품만 줬다)
package com.vitalguard.wear.core

object Sdnn {

    /** 유효 판정 값 — 삼성 `IBI_STATUS_LIST` 의 정상 코드. 실측 ③에서 재확인한다(가정 명시). */
    const val STATUS_VALID = 0

    /**
     * SDNN = NN 간격의 모집단 표준편차(ms). 표본이 2개 미만이면 **0 이 아니라 null** —
     * "변동이 없다" 와 "못 쟀다" 를 가르는 iOS motionVariability 와 같은 규칙이다.
     * status 가 오면 길이가 같은 것만 신뢰하고, 유효(0) 표본만 쓴다.
     */
    fun sdnnMs(ibiMs: List<Int>, status: List<Int>? = null): Double? {
        val valid = if (status != null && status.size == ibiMs.size) {
            ibiMs.filterIndexed { i, _ -> status[i] == STATUS_VALID }
        } else {
            ibiMs
        }
        if (valid.size < 2) return null
        val mean = valid.sumOf { it.toDouble() } / valid.size
        val variance = valid.sumOf { (it - mean) * (it - mean) } / valid.size
        return kotlin.math.sqrt(variance)
    }
}
