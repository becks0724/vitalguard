// 호 게이지 — Canvas 로 직접 그린다. 값이 곧 호 길이라 그리기와 값이 어긋날 여지를 없앤다
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import com.vitalguard.wear.core.Severity

/**
 * 값 → 호가 찬 비율. **범위를 명시적으로 받는다** — "97%" 가 안전한지는 88~100 이라는
 * 맥락이 있어야 답할 수 있고, 그 맥락을 호의 길이가 대신 말한다.
 * 값이 없으면 null — 호는 비고 숫자는 `--` 가 된다(0 으로 채우지 않는다).
 */
internal fun gaugeFraction(value: Double?, min: Double, max: Double): Float? {
    if (value == null) return null
    return ((value - min) / (max - min)).coerceIn(0.0, 1.0).toFloat()
}

/** 호의 기하 — 7시 방향에서 시작해 시계방향으로 300° (아래쪽 60°를 비워 값이 읽힌다). */
private const val ARC_START = 120f
private const val ARC_SWEEP = 300f

/** 구간 트랙의 흐림 — 베젤 띠(0.22)보다 살짝 진하게. 버블이 작아 같은 값이면 색이 안 읽힌다. */
private const val GAUGE_TRACK_ALPHA = 0.30f

/**
 * 원형 버블 — 트랙(전체 범위) 위에 값만큼 호를 덮어 그린다.
 *
 * ★ M3 `CircularProgressIndicator` 를 쓰지 않는다 — startAngle > endAngle 조합에서
 *   호가 안 그려지는 문제를 08-25 실기에서 만났다(값은 정상이었다: tempFrac 0.79).
 *   여기서는 sweep 을 직접 계산하므로 **비율이 곧 호 길이**이고 어긋날 여지가 없다.
 *
 * `zones` 를 주면 트랙이 **구간 그라데이션**이 된다(08-29 사용자 요청 · 좌우 베젤 띠와 같은 브러시).
 *   "어디부터 위험인가" 를 트랙이 말하고, 채움(값)은 종전대로 현재 판정색 단색이다 —
 *   채움까지 스펙트럼으로 칠하면 정상 SpO₂ 도 아래쪽 빨강·주황을 지나 올라와 위험처럼 읽힌다.
 */
@Composable
fun VitalBubble(
    value: String,
    fraction: Float?,
    severity: Severity,
    diameter: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier,
    zones: List<BezelZone> = emptyList(),
) {
    val tint = severity.color()
    Box(modifier = modifier.size(diameter), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(diameter)) {
            val stroke = size.minDimension * 0.11f
            val inset = stroke / 2f
            val d = size.minDimension - stroke
            // 트랙 — 값이 없어도 "여기까지가 범위" 는 보인다. 구간이 있으면 그 색이 흐리게 흐른다.
            if (zones.isEmpty()) {
                drawArc(
                    color = VgColors.Track,
                    startAngle = ARC_START,
                    sweepAngle = ARC_SWEEP,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = Size(d, d),
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            } else {
                val band = BezelBand(ARC_START, ARC_SWEEP, fraction, tint, zones)
                drawArc(
                    brush = Brush.sweepGradient(
                        colorStops = band.gradientStops(GAUGE_TRACK_ALPHA),
                        center = Offset(size.width / 2f, size.height / 2f),
                    ),
                    startAngle = ARC_START,
                    sweepAngle = ARC_SWEEP,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = Size(d, d),
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
            // 값 — 비율만큼만 덮는다. 0 이면 아무것도 안 그린다(미측정과 최저값이 같아 보이지 않게).
            val f = fraction ?: 0f
            if (f > 0f) {
                drawArc(
                    color = tint,
                    startAngle = ARC_START,
                    sweepAngle = ARC_SWEEP * f,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = Size(d, d),
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
        }
        // 값만 원 안에. 라벨은 호출부가 원 밖에 둔다.
        Text(
            value,
            color = VgColors.Primary,
            fontSize = (diameter.value * 0.30f).sp,
            fontWeight = FontWeight.Bold,
        )
    }
}
