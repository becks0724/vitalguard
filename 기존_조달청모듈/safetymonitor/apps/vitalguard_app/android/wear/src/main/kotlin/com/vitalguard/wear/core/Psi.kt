// 생리적 부담 지수(PSI) — 심부체온·심박으로 열 부담을 0~10 으로. 관제웹 lib/psi.ts 의 이식본
package com.vitalguard.wear.core

/**
 * PSI = 5·(Tc − Tc0)/(39.5 − Tc0) + 5·(HR − HR0)/(180 − HR0)
 * 출처 = Moran et al., "A physiological strain index to evaluate heat stress",
 *        Am J Physiol 275(1):R129-34, 1998.
 *
 * ★ 왜 이걸 쓰는가 — 우리 온열 임계는 우리가 고른 참고값이라 근거를 대기 어렵다.
 *   PSI 는 임계까지 논문에 있어 **우리가 정할 숫자가 하나도 없다**(표준을 구현할 뿐 발명하지 않는다).
 *
 * ⚠ **표시 전용이다.** 원식은 Tc 를 직장온도 실측으로 전제하는데 우리 입력은 추정치다.
 *   추정 오차가 지수로 전파되고 그 전파량을 검증할 정답 데이터가 없다 —
 *   그래서 화면 전체 판정(`severity`)·알림에 넣지 않는다. 관제웹 psi.ts 와 같은 규율이다.
 *
 * ⚠ **관제웹과 값이 다를 수 있다.** 서버의 Tc 는 심박+칼만 추정이고 워치의 Tc 는 피부온+오프셋이다
 *   (R-24 투트랙). 같은 식에 다른 입력이 들어가므로 다른 답이 나오는 것이 정상이다.
 */
object Psi {
    /** 논문 가정 상한 — 심부체온 39.5℃ · 심박 180bpm 에서 PSI 10. */
    private const val TC_MAX = 39.5
    private const val HR_MAX = 180.0

    /** 안정심박을 모를 때의 기준 심박 — 논문 가정 하한. */
    private const val HR0_FALLBACK = 60.0

    /** 세션 시작 기준 심부체온 — 관제웹 analyzers 의 `CT0`. 숫자를 두 곳에 두지 않는다. */
    const val CT0 = 37.1

    /** 문헌 임계 — 높은 생리적 부담 구역. */
    const val HIGH = 6.0

    /** 문헌 임계 — 열 손상 고위험. */
    const val CRITICAL = 7.5

    /** 계기 축 — 논문 스케일 그대로 0~10. */
    const val GAUGE_MAX = 10.0

    /**
     * 산출. 입력이 하나라도 없으면 **null(판정 불가)** 이다 — 0(부담 없음)과 구분한다.
     */
    fun compute(coreTempC: Double?, heartRate: Int?): Double? {
        if (coreTempC == null || heartRate == null) return null
        if (!coreTempC.isFinite()) return null
        val thermal = 5.0 * (coreTempC - CT0) / (TC_MAX - CT0)
        val cardio = 5.0 * (heartRate - HR0_FALLBACK) / (HR_MAX - HR0_FALLBACK)
        return (thermal + cardio).coerceIn(0.0, 10.0)
    }

    /** 문헌 임계로 구간을 나눈다. 경계값은 그 구간에 포함된다(≥). */
    fun severity(value: Double?): Severity = when {
        value == null -> Severity.IDLE
        value >= CRITICAL -> Severity.DANGER
        value >= HIGH -> Severity.CAUTION
        else -> Severity.NORMAL
    }
}
