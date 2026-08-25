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

    /**
     * ⚠ **심부 체온 임계다. 갤럭시 화면은 이걸 쓰지 않는다**(08-25 C안).
     *
     * 서버 `coreTempEstimates` 는 **심박 시계열 + 칼만 필터**로 심부를 추정하고 이 임계를 쓴다.
     * 워치는 **실측 피부온**을 그대로 보여주므로 축도 임계도 다르다 — 아래 SKIN_* 를 쓴다.
     * 상수는 서버 대조용으로 남긴다(관제와 값이 갈리는지 볼 때 필요하다).
     */
    const val CORE_TEMP_CAUTION_C = 37.5
    const val CORE_TEMP_DANGER_C = 38.0

    /**
     * 피부온 임계 — **변환 없이 실측을 그대로 판정한다**(C안).
     *
     * ★ 왜 변환을 안 하나. 종전 `피부온 + 0.5` 는 **애플 수면 손목온(35~36℃) 기준**으로 잡힌
     *   상수인데, 삼성 실측은 **37.4~37.7℃** 라 전제가 다르다. 상수만 바꾸면 근거 없는 숫자를
     *   박는 것이고, 오늘 HRV 에서 겪은 함정과 같다.
     *   ⟹ 지금은 실측을 정직하게 보여주고, 하루치 데이터(실내/실외·정지/작업)가 쌓이면
     *      주변온 상관을 실측해 변환식을 정한다(3단계).
     *
     * 값의 근거 — 손목 피부온은 심부보다 낮고 환경에 끌린다. 실내 정지 실측이 37.4~37.7 이므로
     * 38.0 을 주의, 38.5 를 위험으로 둔다. **잠정값이고 실측이 쌓이면 재조정한다.**
     */
    const val SKIN_TEMP_CAUTION_C = 38.0
    const val SKIN_TEMP_DANGER_C = 38.5

    /** 손목 → 심부 보정(서버 상수 사본). C안에서 화면은 안 쓴다 — 3단계 변환식 논의용으로 보존. */
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

    /**
     * 심박 베젤 축 = 30~150 bpm.
     *
     * ⚠ 종전 40~130 은 **임계와 축 끝이 같아서** 위험 구간(≤40 · ≥130)이 폭 0 이었다 —
     *   구간을 색으로 나눠 그리면 빨강이 아예 안 보인다. 임계 바깥으로 20bpm 씩 펴서
     *   다섯 구간이 모두 폭을 갖게 한다(위험 8.3% · 주의 8.3% · 정상 50% · 주의 16.7% · 위험 16.7%).
     */
    const val HR_GAUGE_MIN_BPM = 30.0
    const val HR_GAUGE_MAX_BPM = 150.0

    /**
     * 피부온 게이지 축 = 33.0~40.0.
     *
     * ⚠ **종전 바닥 36.0 은 오염된 실측으로 잡은 값이었다.** 축을 정할 때 근거로 삼은
     *   "실측대 37.4~37.7" 은 전부 기기 발열 구간의 값이었다(R-25 로 발열을 분리하기 전).
     *   발열이 빠진 뒤 같은 손목에서 나온 값은 **35.2℃** 였고, 바닥보다 낮으니 게이지가
     *   0 으로 잘려 **"수치는 뜨는데 인디케이터가 안 찬다"** 가 됐다(08-25 사용자 보고).
     *
     * 새 축의 근거 — 서버 적재분(착용 확정 = 심박 있는 행)을 주변온으로 갈라 재측정.
     *   주변온 33℃ 미만(정상)  15행  최저 **34.12** · 평균 36.66 · 최고 37.98
     *   주변온 33℃ 이상(발열)  25행  최저 35.38  · 평균 37.83 · 최고 38.59
     * 바닥은 정상 구간 최저(34.12)보다 낮아야 잘리지 않는다 → 여유 1.1℃ 를 두고 33.0.
     * 천장은 40.0 유지 — 위험선 38.5 가 79% 라 **넘어서도 남은 여유가 보인다**(R-21 규율).
     *
     * ⚠ 임계값(주의 38.0 · 위험 38.5)은 **아직 잠정**이다. 축과 달리 임계는 온열질환
     *   실측이 있어야 바꾼다 — 정상 평균이 36.66 이므로 지금 임계가 너무 높을 가능성이 있다.
     */
    const val SKIN_GAUGE_MIN_C = 33.0
    const val SKIN_GAUGE_MAX_C = 40.0
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

/**
 * ⚠ **화면은 이 함수를 쓰지 않는다**(08-25 C안). 서버는 심박+칼만으로 심부를 추정하므로
 * 이 단순 덧셈과 값이 갈린다 — 실측에서 워치 38.16℃ vs 서버 37.4℃ 로 벌어졌다.
 * 3단계에서 주변온 보정식이 정해지면 그때 이 자리를 채운다. 지금은 보존만.
 */
fun estimateCoreTempC(skinC: Double?): Double? =
    skinC?.let { it + Thresholds.WRIST_TO_CORE_OFFSET_C }

/** 피부온 판정 — 실측을 그대로 본다(변환 없음). 잠정 임계이고 실측이 쌓이면 재조정한다. */
fun skinTempSeverity(skinC: Double?): Severity = when {
    skinC == null -> Severity.IDLE
    skinC >= Thresholds.SKIN_TEMP_DANGER_C -> Severity.DANGER
    skinC >= Thresholds.SKIN_TEMP_CAUTION_C -> Severity.CAUTION
    else -> Severity.NORMAL
}

fun coreTempSeverity(coreC: Double?): Severity = when {
    coreC == null -> Severity.IDLE
    coreC >= Thresholds.CORE_TEMP_DANGER_C -> Severity.DANGER
    coreC >= Thresholds.CORE_TEMP_CAUTION_C -> Severity.CAUTION
    else -> Severity.NORMAL
}

/** 화면 전체 상태 = 개별 지표 중 **가장 나쁜 것**. 하나라도 위험이면 화면은 위험이다. */
fun overallSeverity(vararg parts: Severity): Severity =
    parts.maxByOrNull { it.ordinal } ?: Severity.IDLE
