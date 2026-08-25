// IBI(박동 간격) 목록 → SDNN(ms) — 삼성 IBI_LIST 로 HRV 를 직접 계산한다 (애플은 완제품만 줬다)
package com.vitalguard.wear.core

object Sdnn {

    /** 유효 판정 값 — 삼성 `IBI_STATUS_LIST` 의 정상 코드. 실측 ③에서 재확인한다(가정 명시). */
    const val STATUS_VALID = 0

    /**
     * 생리학적 IBI 하한·상한(ms) — 심박 30~220bpm 에 대응한다.
     *
     * ★ **status 만으로는 안 걸러진다**(08-25 실기: HRV 402ms 관측 · 정상은 20~100ms).
     *   삼성이 status=0 으로 주면서도 0 이나 극단값을 섞어 보내는 경우가 있고,
     *   그런 표본 두어 개가 SDNN 을 통째로 망가뜨린다(표준편차는 이상치에 취약하다).
     *   심박 자체가 정상 범위인데 HRV 만 튀면 이 필터가 안 걸린 것이다.
     */
    const val IBI_MIN_MS = 270   // 220bpm
    const val IBI_MAX_MS = 2000  // 30bpm

    /**
     * SDNN = NN 간격의 모집단 표준편차(ms). 표본이 2개 미만이면 **0 이 아니라 null** —
     * "변동이 없다" 와 "못 쟀다" 를 가르는 iOS motionVariability 와 같은 규칙이다.
     * status 가 오면 길이가 같은 것만 신뢰하고, 유효(0) 표본만 쓴다.
     */
    fun sdnnMs(ibiMs: List<Int>, status: List<Int>? = null): Double? {
        val byStatus = if (status != null && status.size == ibiMs.size) {
            ibiMs.filterIndexed { i, _ -> status[i] == STATUS_VALID }
        } else {
            ibiMs
        }
        // 생리 범위 밖은 버린다 — status 가 정상이라고 해도 값 자체가 불가능하면 표본이 아니다.
        val valid = byStatus.filter { it in IBI_MIN_MS..IBI_MAX_MS }
        if (valid.size < 2) return null
        val mean = valid.sumOf { it.toDouble() } / valid.size
        val variance = valid.sumOf { (it - mean) * (it - mean) } / valid.size
        return kotlin.math.sqrt(variance)
    }
}
