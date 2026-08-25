// 베젤 눈금 인디케이터 — 원형 워치에서 가장자리는 본문을 밀어내지 않는 유일한 공간이다
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * 베젤 한 구획 — 시작각에서 스윕각만큼 눈금을 깔고, 값 비율만큼 앞에서부터 채운다.
 *
 * 왜 눈금인가(연속 호가 아니라) — 참조 워치페이스가 그렇듯 **개수가 곧 눈금**이라
 * 흘끗 봐도 "몇 칸 남았나" 가 읽힌다. 연속 호는 미세한 차이를 못 보여준다.
 *
 * 각도 규약 = 12시가 -90°, 시계방향이 +. 화면 좌표계와 같다.
 */
data class BezelArc(
    val startDeg: Float,
    val sweepDeg: Float,
    val fraction: Float?,
    val color: Color,
    val ticks: Int = 14,
)

/**
 * 화면 전체에 겹쳐 그린다 — 본문 레이아웃을 한 픽셀도 밀지 않는다.
 * ⚠ 눈금은 화면 **안쪽**에 그린다. 베젤 바로 위에 그리면 원형 마스크에 잘린다.
 */
@Composable
fun BezelIndicator(
    arcs: List<BezelArc>,
    modifier: Modifier = Modifier,
    /** 반지름 대비 눈금 시작 위치 — 1.0 이 화면 가장자리다. */
    inset: Float = 0.93f,
    tickLengthRatio: Float = 0.07f,
) {
    Canvas(modifier = modifier.fillMaxSize()) {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val r = minOf(cx, cy)
        val outer = r * inset
        val inner = outer - r * tickLengthRatio
        val stroke = (r * 0.028f).coerceAtLeast(2f)

        arcs.forEach { arc ->
            if (arc.ticks <= 0) return@forEach
            // 값이 없으면 눈금만 흐리게 — 0 으로 채우지 않는다(화면 전체 공통 규칙).
            val filled = arc.fraction?.let { (it * arc.ticks).roundToInt() } ?: 0
            for (i in 0 until arc.ticks) {
                val t = if (arc.ticks == 1) 0f else i / (arc.ticks - 1f)
                val deg = arc.startDeg + arc.sweepDeg * t
                val rad = Math.toRadians(deg.toDouble())
                val dx = cos(rad).toFloat()
                val dy = sin(rad).toFloat()
                drawLine(
                    color = if (i < filled) arc.color else VgColors.Track,
                    start = Offset(cx + dx * inner, cy + dy * inner),
                    end = Offset(cx + dx * outer, cy + dy * outer),
                    strokeWidth = stroke,
                    cap = StrokeCap.Round,
                )
            }
        }
    }
}
