// 추이 차트 — 지표 하나의 시계열을 선/점으로. 워치 폭에서 '오르는가 내리는가'가 읽히는 것이 목표
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import com.vitalguard.wear.core.Sample

/** 임계선 — 차트 위에 가로선으로 그어 "어디부터 위험인가" 를 보여준다. */
data class Threshold(val value: Double, val color: Color)

/**
 * 추이 차트.
 *
 * ★ 세로축을 **표본 범위에 맞춰 늘린다**(고정 축이 아니라). 근무 중 심박은 90~100 안에서
 *   움직이는데 40~130 고정 축이면 선이 납작해져 아무것도 안 보인다.
 *   다만 임계선이 창 밖이면 함께 담아 "얼마나 남았나" 가 보이게 한다.
 *
 * ★ 보조 계열(overlay)은 **같은 세로축**에 그린다. 피부온과 주변온이 그렇다 —
 *   축을 따로 주면 "둘 다 오르는가(기기 발열) vs 피부온만 오르는가(진짜 체온)" 를
 *   눈으로 비교할 수 없다([[R-25]] 판별법이 통째로 무력해진다).
 *
 * ★ 점이 성기면(SpO₂ 처럼) **선이 아니라 점**으로 그린다 — 두 점을 선으로 이으면
 *   측정하지 않은 구간을 측정한 것처럼 보이게 만든다(없는 데이터를 그리지 않는 규칙).
 */
@Composable
fun TrendChart(
    samples: List<Sample>,
    nowMs: Long,
    windowMs: Long,
    tint: Color,
    thresholds: List<Threshold> = emptyList(),
    /** 이 간격보다 벌어진 두 점은 잇지 않는다(측정 공백을 선으로 메우지 않는다). */
    maxGapMs: Long = windowMs / 6,
    heightDp: Int = 58,
    /** 같은 축에 겹쳐 그릴 보조 계열(예 주변온). 비어 있으면 안 그린다. */
    overlay: List<Sample> = emptyList(),
    overlayTint: Color = VgColors.Accent,
    /**
     * 두 계열의 이름. ⚠ 겹쳐 그리면서 이름을 안 주면 **어느 선이 무엇인지 알 방법이 없다** —
     * 08-25 실기 캡처에서 체온 페이지가 정확히 그 상태였다(선 둘, 설명 0).
     */
    label: String? = null,
    overlayLabel: String? = null,
) {
    // 창 밖 표본은 축 계산에서도 뺀다 — 수집이 멈춘 뒤 남은 옛 점이 세로축을 잡아당기면
    // 지금 구간이 납작해진다(그려지지 않는 점이 축을 정하는 상황).
    val visible = samples.filter { it.atMs >= nowMs - windowMs }
    val visibleOverlay = overlay.filter { it.atMs >= nowMs - windowMs }
    Column(Modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(heightDp.dp)) {
            val w = size.width
            val h = size.height
            val pad = h * 0.10f

            if (visible.isEmpty()) {
                drawLine(
                    color = VgColors.Track,
                    start = Offset(0f, h - pad),
                    end = Offset(w, h - pad),
                    strokeWidth = 1.5f,
                )
                return@Canvas
            }

            // 세로 범위 — 표본 + 창 안 임계선을 함께 담는다.
            var lo = visible.minOf { it.value }
            var hi = visible.maxOf { it.value }
            // 보조 계열도 축에 담는다 — 잘리면 비교할 수 없다.
            if (visibleOverlay.isNotEmpty()) {
                lo = minOf(lo, visibleOverlay.minOf { it.value })
                hi = maxOf(hi, visibleOverlay.maxOf { it.value })
            }
            thresholds.forEach { t ->
                if (t.value in (lo - (hi - lo) * 2)..(hi + (hi - lo) * 2) || hi - lo < 1e-6) {
                    lo = minOf(lo, t.value); hi = maxOf(hi, t.value)
                }
            }
            val span = (hi - lo).coerceAtLeast(1e-6)
            fun y(v: Double) = (h - pad - ((v - lo) / span * (h - pad * 2))).toFloat()
            fun x(t: Long) = w - ((nowMs - t).toFloat() / windowMs) * w

            // 세로 격자 — 시간 눈금. 참고 워치앱처럼 값 뒤에 옅게 깔아 "폭" 을 준다.
            for (i in 1 until GRID_DIVISIONS) {
                val gx = w * i / GRID_DIVISIONS
                drawLine(
                    color = VgColors.Track.copy(alpha = 0.55f),
                    start = Offset(gx, 0f),
                    end = Offset(gx, h),
                    strokeWidth = 1f,
                )
            }

            // 임계선 — 값보다 먼저 그려 배경처럼 깔린다.
            thresholds.forEach { t ->
                if (t.value in lo..hi) {
                    drawLine(
                        color = t.color.copy(alpha = 0.35f),
                        start = Offset(0f, y(t.value)),
                        end = Offset(w, y(t.value)),
                        strokeWidth = 1.2f,
                    )
                }
            }

            // 값 — 공백을 건너뛰며 구간별로 잇는다.
            fun series(pts: List<Sample>, c: Color, stroke: Float, filled: Boolean) {
                var seg = mutableListOf<Sample>()
                fun flush() {
                    if (seg.size >= 2) {
                        // ★ 선 아래를 그라데이션으로 채운다(참고 워치앱 방식) — 값의 크기가
                        //   선 하나보다 면으로 훨씬 빨리 읽힌다. 아래로 갈수록 투명해져
                        //   격자·임계선을 가리지 않는다.
                        if (filled) {
                            val area = Path().apply {
                                moveTo(x(seg.first().atMs), h)
                                seg.forEach { lineTo(x(it.atMs), y(it.value)) }
                                lineTo(x(seg.last().atMs), h)
                                close()
                            }
                            drawPath(
                                area,
                                brush = Brush.verticalGradient(
                                    listOf(c.copy(alpha = 0.38f), c.copy(alpha = 0f)),
                                    startY = 0f,
                                    endY = h,
                                ),
                            )
                        }
                        val path = Path().apply {
                            moveTo(x(seg.first().atMs), y(seg.first().value))
                            seg.drop(1).forEach { lineTo(x(it.atMs), y(it.value)) }
                        }
                        drawPath(path, c, style = Stroke(width = stroke, cap = StrokeCap.Round))
                    } else if (seg.size == 1) {
                        // 외톨이 점 — 선으로 못 이으니 점으로 남긴다(SpO₂ 처럼 성긴 지표).
                        drawCircle(c, radius = h * 0.06f, center = Offset(x(seg[0].atMs), y(seg[0].value)))
                    }
                    seg = mutableListOf()
                }
                pts.forEach { s ->
                    if (seg.isNotEmpty() && s.atMs - seg.last().atMs > maxGapMs) flush()
                    seg.add(s)
                }
                flush()
            }
            // 보조를 먼저(가늘게) — 주 계열이 위에 온다.
            // ⚠ 보조는 **채우지 않는다.** 두 면이 겹치면 체온 판별(피부온 대 주변온)이
            //   뭉개진다 — 겹쳐 그리는 이유가 두 선의 기울기 비교이기 때문이다(R-25).
            series(visibleOverlay, overlayTint.copy(alpha = 0.75f), h * 0.035f, filled = false)
            series(visible, tint, h * 0.055f, filled = true)

            // 최신 점 — 눈이 '지금' 을 먼저 찾게 한다. 색 고리 위에 흰 알(참고 워치앱 방식).
            visible.last().let {
                val c = Offset(x(it.atMs), y(it.value))
                drawCircle(tint, radius = h * 0.11f, center = c)
                drawCircle(VgColors.Primary, radius = h * 0.06f, center = c)
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(windowLabel(windowMs), color = VgColors.Secondary, fontSize = 8.sp)
            if (label != null && overlayLabel != null) {
                Row(
                    Modifier.weight(1f),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    LegendDot(tint); Text(label, color = VgColors.Secondary, fontSize = 8.sp)
                    Box(Modifier.size(width = 7.dp, height = 1.dp))
                    LegendDot(overlayTint); Text(overlayLabel, color = VgColors.Secondary, fontSize = 8.sp)
                }
            } else {
                Box(Modifier.weight(1f))
            }
            Text("지금", color = VgColors.Secondary, fontSize = 8.sp)
        }
    }
}

/** 범례 점 — 선 색과 같은 색의 작은 원. 글자 앞에 붙어 "이 색이 이것" 을 말한다. */
@Composable
private fun LegendDot(c: Color) {
    Box(
        Modifier
            .padding(end = 2.dp)
            .size(5.dp)
            .clip(androidx.compose.foundation.shape.CircleShape)
            .background(c),
    )
}

/** 세로 격자 칸 수. 시간 폭을 눈으로 나눠 주되 촘촘하면 값이 안 보인다. */
private const val GRID_DIVISIONS = 4

internal fun windowLabel(ms: Long): String = when {
    ms < 60 * 60_000L -> "${ms / 60_000}분 전"
    else -> "${ms / 3_600_000}시간 전"
}
