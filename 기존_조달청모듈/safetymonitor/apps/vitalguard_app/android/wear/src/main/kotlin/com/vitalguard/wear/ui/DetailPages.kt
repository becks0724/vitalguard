// 지표별 상세 — **추이 차트가 주인공**이다. 수치는 요약 화면이 이미 보여주므로 여기선 보조다
package com.vitalguard.wear.ui

import androidx.compose.runtime.Composable
import com.vitalguard.wear.core.HistoryWindow
import com.vitalguard.wear.core.Thresholds
import com.vitalguard.wear.core.heartRateSeverity
import com.vitalguard.wear.core.skinTempSeverity
import com.vitalguard.wear.core.spo2Severity

/**
 * 심박 추이 — 15분. 안전대 상·하한을 임계선으로 깔아 "얼마나 남았나" 가 보이게 한다.
 */
@Composable
fun HeartDetailPage(state: VitalUiState) {
    val vals = state.heartTrend.map { it.value }
    DetailPage(
        title = "심박 추이",
        value = state.bpm?.toString() ?: "--",
        unit = "bpm",
        tint = heartRateSeverity(state.bpm).color(),
        chart = {
            TrendChart(
                samples = state.heartTrend,
                nowMs = state.nowMs,
                windowMs = HistoryWindow.HEART_MS,
                tint = heartRateSeverity(state.bpm).color(),
                thresholds = listOf(
                    Threshold(Thresholds.HR_CAUTION_HIGH.toDouble(), VgColors.Caution),
                    Threshold(Thresholds.HR_DANGER_HIGH.toDouble(), VgColors.Danger),
                ),
            )
        },
        rows = buildList {
            if (vals.size >= 2) {
                add(DetailRow("최저 / 최고", "${vals.min().toInt()} / ${vals.max().toInt()}"))
                add(DetailRow("평균", "${vals.average().toInt()}"))
            }
            state.hrvSdnnMs?.let { add(DetailRow("HRV", "${it.toInt()} ms", VgColors.Accent)) }
        },
    )
}

/**
 * SpO₂ 추이 — 1시간. 5분 주기 단발이라 점이 성기다.
 * ⚠ 차트가 점을 선으로 잇지 않는 구간이 정상이다 — 측정 안 한 시간을 메우지 않는다.
 */
@Composable
fun Spo2DetailPage(state: VitalUiState) {
    val vals = state.spo2Trend.map { it.value }
    DetailPage(
        title = "산소포화도 추이",
        value = state.spo2?.toString() ?: "--",
        unit = "%",
        tint = spo2Severity(state.spo2).color(),
        chart = {
            TrendChart(
                samples = state.spo2Trend,
                nowMs = state.nowMs,
                windowMs = HistoryWindow.SPO2_MS,
                tint = spo2Severity(state.spo2).color(),
                thresholds = listOf(
                    Threshold(Thresholds.SPO2_CAUTION.toDouble(), VgColors.Caution),
                    Threshold(Thresholds.SPO2_DANGER.toDouble(), VgColors.Danger),
                ),
                // 5분 주기라 공백 허용을 넉넉히 — 그래도 결측은 끊어 보인다.
                maxGapMs = 8 * 60_000L,
            )
        },
        rows = buildList {
            if (vals.size >= 2) add(DetailRow("최저 / 최고", "${vals.min().toInt()} / ${vals.max().toInt()}"))
            state.spo2AgeSec?.let { add(DetailRow("마지막 측정", ageLabel(it))) }
            add(DetailRow("측정 주기", "5분", VgColors.Secondary))
        },
    )
}

/**
 * 체온 추이 — 30분. **피부온과 주변온을 겹쳐 그린다.**
 * ★ 두 선(굵은 선=피부온 · 가는 파란선=주변온)이 **나란히** 오르면 기기 발열,
 *   피부온만 오르면 실제 체온이다([[R-25]] 판별법). 같은 축이라야 이 비교가 성립한다.
 *   작업자가 스스로 구별할 수 있게 하는 것이 이 페이지의 존재 이유다.
 */
@Composable
fun TempDetailPage(state: VitalUiState) {
    DetailPage(
        title = "체온 추이",
        value = state.skinTempC?.let { "%.1f".format(it) } ?: "--",
        unit = "℃",
        tint = skinTempSeverity(state.skinTempC).color(),
        chart = {
            TrendChart(
                samples = state.skinTempTrend,
                nowMs = state.nowMs,
                windowMs = HistoryWindow.TEMP_MS,
                tint = skinTempSeverity(state.skinTempC).color(),
                thresholds = listOf(
                    Threshold(Thresholds.SKIN_TEMP_CAUTION_C, VgColors.Caution),
                    Threshold(Thresholds.SKIN_TEMP_DANGER_C, VgColors.Danger),
                ),
                // 같은 축에 주변온을 겹친다 — 두 선이 나란히 오르면 기기 발열이다.
                overlay = state.ambientTrend,
                label = "피부온",
                overlayLabel = "주변온",
            )
        },
        rows = buildList {
            state.ambientTempC?.let { add(DetailRow("주변", "%.1f ℃".format(it), VgColors.Accent)) }
            if (state.skinTempC != null && state.ambientTempC != null) {
                add(DetailRow("차이", "%.1f ℃".format(state.skinTempC - state.ambientTempC)))
            }
        },
    )
}

/** 스트레스 추이 — 30분. 활동 강도와 함께 본다(같은 재료로 계산되므로). */
@Composable
fun ActivityDetailPage(state: VitalUiState) {
    val stress = state.stress
    DetailPage(
        title = "스트레스 추이",
        value = stress.index?.toString() ?: "--",
        unit = "",
        tint = if (stress.index != null) stress.level.color() else VgColors.Idle,
        chart = {
            TrendChart(
                samples = state.stressTrend,
                nowMs = state.nowMs,
                windowMs = HistoryWindow.STRESS_MS,
                tint = if (stress.index != null) stress.level.color() else VgColors.Idle,
                thresholds = listOf(
                    Threshold(40.0, VgColors.Caution),
                    Threshold(70.0, VgColors.Danger),
                ),
                maxGapMs = 6 * 60_000L,
            )
        },
        rows = buildList {
            if (state.sessionSteps > 0) add(DetailRow("걸음", "%,d 보".format(state.sessionSteps)))
            stress.activity?.let {
                add(
                    DetailRow(
                        "활동 강도",
                        when (it) {
                            com.vitalguard.wear.core.ActivityState.REST -> "안정"
                            com.vitalguard.wear.core.ActivityState.LIGHT -> "가벼움"
                            com.vitalguard.wear.core.ActivityState.HEAVY -> "작업 중"
                        },
                        VgColors.Secondary,
                    ),
                )
            }
            if (stress.calibrating) add(DetailRow("상태", "보정 중", VgColors.Idle))
        },
    )
}

/**
 * 걸음 상세 — 누계 추이. 기울기가 곧 "지금 얼마나 움직이는가" 다(계단처럼 오르면 간헐 이동).
 *
 * ★ 걸음은 베젤에서 내려갔다(우측은 스트레스가 쓴다) — **수치는 여기가 유일한 자리**다.
 *   수집·전송은 그대로다. 화면에서만 내린 것이다.
 */
@Composable
fun StepsDetailPage(state: VitalUiState) {
    val pts = state.stepsTrend
    DetailPage(
        title = "오늘 걸음",
        value = state.dailySteps?.let { "%,d".format(it) } ?: "--",
        unit = "보",
        tint = VgColors.Accent,
        chart = {
            TrendChart(
                samples = pts,
                nowMs = state.nowMs,
                windowMs = HistoryWindow.STEPS_MS,
                tint = VgColors.Accent,
                // 2분 배치라 공백 허용을 넉넉히 — 그래도 수집이 멎은 구간은 끊어 보인다.
                maxGapMs = 6 * 60_000L,
            )
        },
        rows = buildList {
            if (pts.size >= 2) {
                val span = (pts.last().atMs - pts.first().atMs) / 60_000.0
                val gained = pts.last().value - pts.first().value
                if (span >= 1.0 && gained > 0) {
                    add(DetailRow("분당", "%.0f 보".format(gained / span)))
                }
            }
            if (state.sessionSteps > 0) add(DetailRow("이번 착용", "%,d 보".format(state.sessionSteps)))
            if (state.windowFloors > 0) add(DetailRow("층", "${state.windowFloors} 층"))
        },
    )
}

/** 페이지 목록 — 요약이 0번. **뒤에만 더한다** — 순서를 바꾸면 익힌 위치가 흐트러진다. */
val DETAIL_PAGE_COUNT = 6
