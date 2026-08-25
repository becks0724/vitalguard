// 실시간 심박 추이 차트 — 최근 몇 분의 변화를 선으로. 24시간 축은 근무 중 변화를 못 보여준다
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text

/** 한 점 = 한 표본. 화면이 들고 있는 최근 값만 그린다(서버 조회 없음). */
data class TimelinePoint(val atMs: Long, val bpm: Int)

/** 차트가 덮는 시간 폭 — 근무 중 "지금 오르고 있나" 를 보려면 시간 단위가 아니라 분 단위다. */
const val CHART_WINDOW_MS = 5 * 60_000L

/**
 * 실시간 심박 선 차트.
 *
 * ★ 세로 축은 **표본의 최소~최대에 맞춰 늘린다**(고정 40~130 이 아니라).
 *   근무 중 심박은 90~100 안에서 움직이는데 고정 축이면 선이 납작해져 변화가 안 보인다.
 *   대신 축 폭이 좁아지지 않게 최소 20bpm 은 확보한다.
 */
@Composable
fun HeartChart(
    points: List<TimelinePoint>,
    nowMs: Long,
    tint: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    val window = points.filter { nowMs - it.atMs <= CHART_WINDOW_MS }
    Column(modifier = modifier.fillMaxWidth()) {
        Canvas(modifier = Modifier.fillMaxWidth().height(30.dp)) {
            val w = size.width
            val h = size.height
            // 기준선 — 표본이 없어도 "여기가 차트" 는 보인다.
            drawLine(
                color = VgColors.Track,
                start = Offset(0f, h - 1f),
                end = Offset(w, h - 1f),
                strokeWidth = 1.5f,
            )
            if (window.size < 2) return@Canvas

            val bpms = window.map { it.bpm }
            val mid = (bpms.min() + bpms.max()) / 2f
            val span = maxOf((bpms.max() - bpms.min()).toFloat(), 20f)
            val lo = mid - span / 2f
            val hi = mid + span / 2f

            fun x(p: TimelinePoint) = w - ((nowMs - p.atMs) / CHART_WINDOW_MS.toFloat()) * w
            fun y(p: TimelinePoint) = h - ((p.bpm - lo) / (hi - lo)).coerceIn(0f, 1f) * (h * 0.88f) - h * 0.06f

            val path = Path().apply {
                moveTo(x(window.first()), y(window.first()))
                window.drop(1).forEach { lineTo(x(it), y(it)) }
            }
            drawPath(
                path = path,
                color = tint,
                style = Stroke(width = h * 0.09f, cap = StrokeCap.Round),
            )
            // 최신 점 — 지금 값이 어디인지 눈이 먼저 찾는다.
            val last = window.last()
            drawCircle(color = tint, radius = h * 0.11f, center = Offset(x(last), y(last)))
        }
        Row(modifier = Modifier.fillMaxWidth()) {
            Text("5분 전", color = VgColors.Secondary, fontSize = 8.sp, modifier = Modifier.weight(1f))
            Text("지금", color = VgColors.Secondary, fontSize = 8.sp)
        }
    }
}
