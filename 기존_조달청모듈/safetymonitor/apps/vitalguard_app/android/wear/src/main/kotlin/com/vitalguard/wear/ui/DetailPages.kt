// 지표별 상세 페이지 — 세로 스와이프로 요약 아래에 붙는다(가로는 워치 뒤로가기와 충돌한다)
package com.vitalguard.wear.ui

import androidx.compose.runtime.Composable
import com.vitalguard.wear.core.Severity
import com.vitalguard.wear.core.Thresholds
import com.vitalguard.wear.core.heartRateSeverity
import com.vitalguard.wear.core.skinTempSeverity
import com.vitalguard.wear.core.spo2Severity

/** 심박 — 5분 차트와 구간 통계. 안전대 어디인지가 요약 화면의 좌측 베젤과 같은 뜻이다. */
@Composable
fun HeartDetailPage(state: VitalUiState) {
    val bpms = state.timeline.map { it.bpm }
    DetailPage(
        title = "심박",
        value = state.bpm?.toString() ?: "--",
        unit = "bpm",
        tint = heartRateSeverity(state.bpm).color(),
        rows = buildList {
            if (bpms.size >= 2) {
                add(DetailRow("최근 5분", "${bpms.min()}~${bpms.max()}"))
                add(DetailRow("평균", "${bpms.average().toInt()}"))
            }
            add(
                DetailRow(
                    "안전대",
                    "${Thresholds.HR_DANGER_LOW}~${Thresholds.HR_DANGER_HIGH}",
                    VgColors.Secondary,
                ),
            )
            state.hrvSdnnMs?.let { add(DetailRow("HRV", "${it.toInt()} ms", VgColors.Accent)) }
        },
        chart = if (state.timeline.size >= 2) {
            { HeartChart(state.timeline, state.nowMs, heartRateSeverity(state.bpm).color()) }
        } else {
            null
        },
    )
}

/** SpO₂ — 기회 측정이라 **값의 나이**가 값만큼 중요하다(5분 주기 단발). */
@Composable
fun Spo2DetailPage(state: VitalUiState) {
    DetailPage(
        title = "산소포화도",
        value = state.spo2?.toString() ?: "--",
        unit = "%",
        tint = spo2Severity(state.spo2).color(),
        rows = buildList {
            state.spo2AgeSec?.let { add(DetailRow("측정", ageLabel(it))) }
            add(DetailRow("주의", "< ${Thresholds.SPO2_CAUTION}%", VgColors.Caution))
            add(DetailRow("위험", "< ${Thresholds.SPO2_DANGER}%", VgColors.Danger))
            if (state.spo2 == null) {
                add(DetailRow("주기", "5분마다 측정", VgColors.Secondary))
            }
        },
    )
}

/**
 * 피부온 — **주변온을 함께 보여준다.** 둘이 같이 오르면 기기 발열이고 피부온만 오르면
 * 실제 체온이다(08-25 [[R-25]] 판별법). 작업자가 스스로 구별할 수 있게 한다.
 */
@Composable
fun TempDetailPage(state: VitalUiState) {
    DetailPage(
        title = "피부온",
        value = state.skinTempC?.let { "%.1f".format(it) } ?: "--",
        unit = "℃",
        tint = skinTempSeverity(state.skinTempC).color(),
        rows = buildList {
            state.ambientTempC?.let { add(DetailRow("주변", "%.1f ℃".format(it), VgColors.Accent)) }
            if (state.skinTempC != null && state.ambientTempC != null) {
                add(DetailRow("차이", "%.1f ℃".format(state.skinTempC - state.ambientTempC)))
            }
            add(
                DetailRow(
                    "주의 / 위험",
                    "${Thresholds.SKIN_TEMP_CAUTION_C} / ${Thresholds.SKIN_TEMP_DANGER_C}",
                    VgColors.Secondary,
                ),
            )
        },
    )
}

/** 활동 — 걸음·층·칼로리와 스트레스 기여도. 우측 베젤(걸음)의 상세다. */
@Composable
fun ActivityDetailPage(state: VitalUiState) {
    val stress = state.stress
    DetailPage(
        title = "활동",
        value = if (state.sessionSteps > 0) "%,d".format(state.sessionSteps) else "--",
        unit = "보",
        tint = VgColors.Accent,
        rows = buildList {
            if (state.windowFloors > 0) add(DetailRow("층", "${state.windowFloors}"))
            if (state.windowKcal > 0) add(DetailRow("칼로리", "%.1f kcal".format(state.windowKcal)))
            add(
                DetailRow(
                    "스트레스",
                    stress.index?.toString() ?: "보정 중",
                    if (stress.index != null) stress.level.color() else VgColors.Idle,
                ),
            )
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
            // 무동작은 화면 요약에서 내렸지만(사용자 결정) 상세에서는 근거로 보여준다.
            state.stillSec?.let {
                if (it >= 30) {
                    add(
                        DetailRow(
                            "무동작",
                            stillShort(it),
                            if (it >= Thresholds.COLLAPSE_STILL_SEC) VgColors.Caution else VgColors.Secondary,
                        ),
                    )
                }
            }
        },
    )
}

/** 페이지 목록 — 요약이 0번. 순서를 바꾸면 사용자가 익힌 위치가 흐트러진다. */
val DETAIL_PAGE_COUNT = 5
