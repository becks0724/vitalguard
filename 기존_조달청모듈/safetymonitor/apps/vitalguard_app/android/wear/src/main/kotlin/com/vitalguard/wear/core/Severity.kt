// 위험도 판정 — 관제웹 severity.ts·analyzers/thresholds.ts 와 **같은 값**을 쓴다(화면이 서버와 다른 말을 하지 않도록)
package com.vitalguard.wear.core

/** 관제웹 `Status` 와 같은 4단계. 라벨도 같다 — 작업자와 관제가 같은 낱말을 본다. */
enum class Severity(val label: String) {
    IDLE("대기"),
    NORMAL("정상"),
    CAUTION("주의"),
    DANGER("위험"),
}

/**
 * 임계값 원본 = `packages/analyzers/src/thresholds.ts`.
 * ⚠ **손으로 옮긴 사본이다**([[L-106]]) — 서버가 바꾸면 여기도 바뀌어야 한다.
 *   가드(3단계 F)가 두 값을 대조해 갈리면 빨간불이 되게 한다.
 */
object Thresholds {
    const val HR_DANGER_HIGH = 130
    const val HR_DANGER_LOW = 40
    const val HR_CAUTION_HIGH = 110
    const val HR_CAUTION_LOW = 50

    const val SPO2_CAUTION = 92
    const val SPO2_DANGER = 88

    const val CORE_TEMP_CAUTION_C = 37.5
    const val CORE_TEMP_DANGER_C = 38.0
    /** 손목 → 심부 보정. 서버와 같은 상수를 써야 화면과 관제가 같은 체온을 말한다. */
    const val WRIST_TO_CORE_OFFSET_C = 0.5

    /** 무동작 지속 — 붕괴(실신) 후보 경계. 낙상(30s)보다 길게 잡은 값. */
    const val COLLAPSE_STILL_SEC = 90.0

    /**
     * 체온 게이지가 펴는 범위 — **임계가 아니라 표시용 축**이다.
     *
     * 왜 35.0~40.0 인가(08-25 사용자 지적 반영) —
     * 종전 36.0~38.5 는 ⓐ 정상체온 36.2℃ 가 8% 라 거의 안 차 보이고
     * ⓑ 38.5℃ 이상이 전부 100% 로 뭉개져 **40℃ 가 얼마나 심각한지 가늠이 안 됐다**.
     * 임상 저체온(35℃ 미만)~고열(40℃ 이상)을 축으로 삼으면 정상이 중간에 오고,
     * 주의 37.5=50% · 위험 38.0=60% 라 **위험선을 넘어도 남은 여유가 보인다**.
     */
    const val TEMP_GAUGE_MIN_C = 35.0
    const val TEMP_GAUGE_MAX_C = 40.0
}

/** 심박 — 안정 임계 기준(작업부하 밴드 완화는 서버가 활동 분류로 한다. 워치는 보수적으로). */
fun heartRateSeverity(bpm: Int?): Severity = when {
    bpm == null -> Severity.IDLE
    bpm >= Thresholds.HR_DANGER_HIGH || bpm <= Thresholds.HR_DANGER_LOW -> Severity.DANGER
    bpm >= Thresholds.HR_CAUTION_HIGH || bpm <= Thresholds.HR_CAUTION_LOW -> Severity.CAUTION
    else -> Severity.NORMAL
}

fun spo2Severity(pct: Int?): Severity = when {
    pct == null -> Severity.IDLE
    pct < Thresholds.SPO2_DANGER -> Severity.DANGER
    pct < Thresholds.SPO2_CAUTION -> Severity.CAUTION
    else -> Severity.NORMAL
}

/** 심부 체온 추정 — 피부온 + 보정. 서버 `estimateCoreTempC` 와 같은 형태. */
fun estimateCoreTempC(skinC: Double?): Double? =
    skinC?.let { it + Thresholds.WRIST_TO_CORE_OFFSET_C }

fun coreTempSeverity(coreC: Double?): Severity = when {
    coreC == null -> Severity.IDLE
    coreC >= Thresholds.CORE_TEMP_DANGER_C -> Severity.DANGER
    coreC >= Thresholds.CORE_TEMP_CAUTION_C -> Severity.CAUTION
    else -> Severity.NORMAL
}

/** 화면 전체 상태 = 개별 지표 중 **가장 나쁜 것**. 하나라도 위험이면 화면은 위험이다. */
fun overallSeverity(vararg parts: Severity): Severity =
    parts.maxByOrNull { it.ordinal } ?: Severity.IDLE
