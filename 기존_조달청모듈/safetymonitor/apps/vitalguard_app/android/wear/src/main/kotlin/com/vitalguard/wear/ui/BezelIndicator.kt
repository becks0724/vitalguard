// 좌우 사이드 인디케이터 — 원형 베젤을 따라 도는 세로 아크 2종(좌=위치 띠 · 우=눈금 부채꼴)
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * 각도 규약 — 0° = 3시(우), +시계방향. 좌우 대칭으로 잡는다.
 *   우측 -35°~ +35°  (3시 중심 · 70°)
 *   좌측 145°~ 215°  (9시 중심 · 70°)
 * 12시·6시를 비우는 이유 — 위는 TimeText, 아래는 버튼이 앉는다.
 */
object Bezel {
    const val RIGHT_START = -35f
    const val LEFT_START = 145f
    const val SWEEP = 70f
}

/** 좌측 = 굵은 띠 + 점 마커. **범위 안 위치**를 보여준다(누적이 아니다). */
data class BezelBand(
    val startDeg: Float,
    val sweepDeg: Float,
    /** 0=아래끝, 1=위끝. null 이면 마커를 안 그린다(미측정). */
    val fraction: Float?,
    val color: Color,
)

/** 우측 = 눈금 부채꼴. **차오르는 값**에 쓴다(누적·잔량). 눈금 길이가 끝으로 갈수록 길어진다. */
data class BezelTicks(
    val startDeg: Float,
    val sweepDeg: Float,
    val fraction: Float?,
    val color: Color,
    val count: Int = 16,
)

@Composable
fun BezelIndicator(
    band: BezelBand?,
    ticks: BezelTicks?,
    modifier: Modifier = Modifier,
    /** 반지름 대비 아크 중심 — 1.0 이 화면 가장자리. 원형 마스크에 안 잘리는 하한이 0.90 근처다. */
    radiusRatio: Float = 0.90f,
) {
    Canvas(modifier = modifier.fillMaxSize()) {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val r = minOf(cx, cy)

        band?.let { drawBand(it, cx, cy, r, radiusRatio) }
        ticks?.let { drawTicks(it, cx, cy, r, radiusRatio) }
    }
}

/** 굵은 띠 — 트랙을 깔고 **아래에서 위로 채운다**(08-25 사용자 요청 · 종전은 점). */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawBand(
    b: BezelBand,
    cx: Float,
    cy: Float,
    r: Float,
    ratio: Float,
) {
    val arcR = r * ratio
    val width = r * 0.075f
    // 트랙 — 범위 전체. 값이 없어도 "여기까지가 범위" 는 보여야 한다.
    drawArc(
        color = VgColors.Track,
        startAngle = b.startDeg,
        sweepAngle = b.sweepDeg,
        useCenter = false,
        topLeft = Offset(cx - arcR, cy - arcR),
        size = Size(arcR * 2, arcR * 2),
        style = Stroke(width = width, cap = StrokeCap.Round),
    )
    val f = b.fraction ?: return
    // ★ 채움 방향 — **시작각에서 끝각으로** 자란다. 좌측 띠는 145°(아래)에서 215°(위)로
    //   가므로 값이 클수록 위로 찬다. 이것이 "게이지" 의 직관이다.
    //   ⚠ 종전 점 표시는 `1f - f` 로 위치를 뒤집어 **높은 심박이 오히려 아래**에 찍혔다
    //     (주석은 반대로 적혀 있었다). 채움으로 바꾸면서 방향도 바로잡는다.
    //     각도 규약 확인 = sin(145°)>0 → 화면 아래 · sin(215°)<0 → 화면 위(y 는 아래로 증가).
    if (f <= 0f) return
    drawArc(
        color = b.color,
        startAngle = b.startDeg,
        sweepAngle = b.sweepDeg * f,
        useCenter = false,
        topLeft = Offset(cx - arcR, cy - arcR),
        size = Size(arcR * 2, arcR * 2),
        style = Stroke(width = width, cap = StrokeCap.Round),
    )
}

/** 눈금 부채꼴 — 끝으로 갈수록 길어져 "차오름" 이 형태로도 읽힌다(사진 우측). */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawTicks(
    t: BezelTicks,
    cx: Float,
    cy: Float,
    r: Float,
    ratio: Float,
) {
    if (t.count <= 1) return
    val outer = r * ratio + r * 0.035f
    val stroke = (r * 0.022f).coerceAtLeast(2f)
    val filled = t.fraction?.let { (it * t.count).roundToInt() } ?: 0
    for (i in 0 until t.count) {
        val p = i / (t.count - 1f)
        val deg = t.startDeg + t.sweepDeg * p
        val rad = Math.toRadians(deg.toDouble())
        val dx = cos(rad).toFloat()
        val dy = sin(rad).toFloat()
        // 길이가 0.35 → 1.0 으로 자란다. 짧은 쪽이 시작(낮은 값)이다.
        val len = r * 0.085f * (0.35f + 0.65f * p)
        val inner = outer - len
        drawLine(
            color = if (i < filled) t.color else VgColors.Track,
            start = Offset(cx + dx * inner, cy + dy * inner),
            end = Offset(cx + dx * outer, cy + dy * outer),
            strokeWidth = stroke,
            cap = StrokeCap.Round,
        )
    }
}
