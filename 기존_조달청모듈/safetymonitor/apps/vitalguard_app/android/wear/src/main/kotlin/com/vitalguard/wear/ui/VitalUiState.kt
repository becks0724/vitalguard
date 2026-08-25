// 화면이 그리는 데 필요한 전부 — 서비스·센서를 모른다. 그래서 미리보기가 실기 없이 렌더된다
package com.vitalguard.wear.ui

import com.vitalguard.wear.core.Severity
import com.vitalguard.wear.core.coreTempSeverity
import com.vitalguard.wear.core.estimateCoreTempC
import com.vitalguard.wear.core.heartRateSeverity
import com.vitalguard.wear.core.overallSeverity
import com.vitalguard.wear.core.spo2Severity

/**
 * ⚠ **null 은 0 이 아니다.** 측정 안 된 값은 화면에서 **생략**한다 —
 * iOS ContentView 의 "0 건은 생략" 규칙과 같다. 빈 자리를 0 으로 채우면
 * "측정했는데 0" 으로 읽혀 판정이 오염된다.
 */
data class VitalUiState(
    val workerName: String? = null,
    val bpm: Int? = null,
    val spo2: Int? = null,
    /** SpO₂ 측정 후 경과(초) — 기회 측정이라 값의 나이를 함께 보여준다. */
    val spo2AgeSec: Long? = null,
    val skinTempC: Double? = null,
    val ambientTempC: Double? = null,
    val steps: Int = 0,
    val stillSec: Double? = null,
    /** HRV(SDNN, ms) — 삼성 IBI 로 계산. 표본이 모자라면 null(0 으로 채우지 않는다). */
    val hrvSdnnMs: Double? = null,
    val batteryPct: Int? = null,
    val collecting: Boolean = false,
    val queued: Int = 0,
    /** 마지막 업로드 성공 후 경과(초). null = 아직 한 번도 못 올림. */
    val lastUploadAgeSec: Long? = null,
    /** 24시간 타임라인 표본 — 화면이 들고 있는 최근 값만. 비어 있으면 축만 그린다. */
    val timeline: List<TimelinePoint> = emptyList(),
    /** 현재 시각(epoch ms) — 차트가 창을 자르는 기준. */
    val nowMs: Long = 0L,
    /** 오늘 관측된 심박 범위 — 사진의 "95-102" 자리. 표본이 없으면 null. */
    val bpmRange: Pair<Int, Int>? = null,
) {
    val coreTempC: Double? get() = estimateCoreTempC(skinTempC)

    /** 화면 전체 상태 = 지표 중 가장 나쁜 것. 수집 전이면 대기. */
    val severity: Severity
        get() = if (!collecting && bpm == null) {
            Severity.IDLE
        } else {
            overallSeverity(
                heartRateSeverity(bpm),
                spo2Severity(spo2),
                coreTempSeverity(coreTempC),
            )
        }
}
