// 추이 차트 — 지표 하나의 시계열을 선/점으로. 워치 폭에서 '오르는가 내리는가'가 읽히는 것이 목표
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
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
    heightDp: Int = 46,
    /** 같은 축에 겹쳐 그릴 보조 계열(예 주변온). 비어 있으면 안 그린다. */
    overlay: List<Sample> = emptyList(),
    overlayTint: Color = VgColors.Accent,
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
            fun series(pts: List<Sample>, c: Color, stroke: Float) {
                var seg = mutableListOf<Sample>()
                fun flush() {
                    if (seg.size >= 2) {
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
            series(visibleOverlay, overlayTint.copy(alpha = 0.75f), h * 0.035f)
            series(visible, tint, h * 0.055f)

            // 최신 점 — 눈이 '지금' 을 먼저 찾게 한다.
            visible.last().let {
                drawCircle(tint, radius = h * 0.08f, center = Offset(x(it.atMs), y(it.value)))
            }
        }
        Row(Modifier.fillMaxWidth()) {
            Text(windowLabel(windowMs), color = VgColors.Secondary, fontSize = 8.sp, modifier = Modifier.weight(1f))
            Text("지금", color = VgColors.Secondary, fontSize = 8.sp)
        }
    }
}

internal fun windowLabel(ms: Long): String = when {
    ms < 60 * 60_000L -> "${ms / 60_000}분 전"
    else -> "${ms / 3_600_000}시간 전"
}
