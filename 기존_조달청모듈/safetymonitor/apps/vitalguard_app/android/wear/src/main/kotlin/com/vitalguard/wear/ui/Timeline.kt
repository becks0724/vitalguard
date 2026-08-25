// 24시간 심박 타임라인 — 근무 중 추이를 한 줄로. 사진의 12AM~12PM 띠와 같은 자리다
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text

/** 한 점 = 한 시각의 심박. 화면은 최근 값만 들고 있으므로 표본이 적어도 그려져야 한다. */
data class TimelinePoint(val hourOfDay: Float, val bpm: Int)

/**
 * 24시간 축 위에 심박 표본과 **현재 위치 마커**를 그린다.
 * 값이 없으면 축만 남는다 — 빈 그래프를 0 으로 채우지 않는다(화면 전체 공통 규칙).
 */
@Composable
fun HeartTimeline(
    points: List<TimelinePoint>,
    nowHour: Float,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Canvas(modifier = Modifier.fillMaxWidth().height(22.dp)) {
            val w = size.width
            val h = size.height
            val track = h * 0.34f

            // 축 — 하루 전체. 값이 없어도 "여기가 범위" 는 보인다.
            drawLine(
                color = VgColors.Track,
                start = Offset(0f, h / 2f),
                end = Offset(w, h / 2f),
                strokeWidth = track,
                cap = StrokeCap.Round,
            )
            // 표본 — 심박 40~130 을 세로로 편다. 위가 높은 값.
            points.forEach { p ->
                val x = (p.hourOfDay / 24f).coerceIn(0f, 1f) * w
                val f = ((p.bpm - 40f) / 90f).coerceIn(0f, 1f)
                val y = h - f * h
                drawCircle(
                    color = VgColors.Accent,
                    radius = h * 0.09f,
                    center = Offset(x, y),
                )
            }
            // 현재 시각 마커 — 사진의 분홍 세로 막대 자리.
            val nx = (nowHour / 24f).coerceIn(0f, 1f) * w
            drawLine(
                color = VgColors.Primary,
                start = Offset(nx, h * 0.18f),
                end = Offset(nx, h * 0.82f),
                strokeWidth = w * 0.012f,
                cap = StrokeCap.Round,
            )
        }
        Row(modifier = Modifier.fillMaxWidth()) {
            listOf("12AM", "6", "12PM", "6", "(h)").forEachIndexed { i, label ->
                Text(
                    label,
                    color = VgColors.Secondary,
                    fontSize = 8.sp,
                    modifier = if (i == 4) Modifier else Modifier.weight(1f),
                )
            }
        }
    }
}
