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

/**
 * 띠 한 구간 — 축 위의 [from, to] 비율 구간과 그 색.
 * 신호등(초록·노랑·빨강)으로 "여기부터 주의, 여기부터 위험" 을 형태로 말한다.
 */
data class BezelZone(val from: Float, val to: Float, val color: Color)

/** 좌측 = 굵은 띠. **범위 안 위치**를 채움으로 보여준다(누적이 아니다). */
data class BezelBand(
    val startDeg: Float,
    val sweepDeg: Float,
    /** 0=아래끝, 1=위끝. null 이면 채우지 않는다(미측정). */
    val fraction: Float?,
    val color: Color,
    /** 구간 분할. 비어 있으면 단색 트랙 하나로 그린다. */
    val zones: List<BezelZone> = emptyList(),
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
    val topLeft = Offset(cx - arcR, cy - arcR)
    val boxSize = Size(arcR * 2, arcR * 2)

    /** 비율 구간 하나를 호로. **칸 사이를 띄우려면 Butt 캡이어야 한다**(Round 는 틈을 메운다). */
    fun arc(fromF: Float, toF: Float, color: Color) {
        val gap = GAP_DEG / 2f
        val s = b.startDeg + b.sweepDeg * fromF + gap
        val e = b.startDeg + b.sweepDeg * toF - gap
        if (e <= s) return
        drawArc(
            color = color,
            startAngle = s,
            sweepAngle = e - s,
            useCenter = false,
            topLeft = topLeft,
            size = boxSize,
            style = Stroke(width = width, cap = StrokeCap.Butt),
        )
    }

    if (b.zones.isEmpty()) {
        // 구간이 없는 띠 — 종전처럼 단색 트랙 하나.
        drawArc(
            color = VgColors.Track,
            startAngle = b.startDeg,
            sweepAngle = b.sweepDeg,
            useCenter = false,
            topLeft = topLeft,
            size = boxSize,
            style = Stroke(width = width, cap = StrokeCap.Round),
        )
        val f = b.fraction ?: return
        if (f <= 0f) return
        drawArc(
            color = b.color,
            startAngle = b.startDeg,
            sweepAngle = b.sweepDeg * f,
            useCenter = false,
            topLeft = topLeft,
            size = boxSize,
            style = Stroke(width = width, cap = StrokeCap.Round),
        )
        return
    }

    // 트랙 — 구간마다 제 색을 흐리게 깔아 "어디부터 위험인가" 가 값 없이도 보인다.
    b.zones.forEach { arc(it.from, it.to, it.color.copy(alpha = TRACK_ALPHA)) }

    // ★ 채움 — **아래에서 위로**, 지나온 구간은 그 구간의 색 그대로 진하게.
    //   값이 오르면 초록 → 노랑 → 빨강으로 색이 넘어간다(신호등의 뜻 그대로).
    val f = b.fraction ?: return
    if (f <= 0f) return
    b.zones.forEach { z ->
        val hi = minOf(z.to, f)
        if (hi > z.from) arc(z.from, hi, z.color)
    }
}

/** 구간 사이 틈(도). 칸이 나뉘어 보일 만큼만 — 넓히면 띠가 끊겨 보인다. */
private const val GAP_DEG = 2.4f

/** 트랙(미도달 구간) 투명도. 값이 찬 구간과 구별되면서 색은 읽혀야 한다. */
private const val TRACK_ALPHA = 0.22f

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
    for (i in 0 until t.count) {
        val p = i / (t.count - 1f)
        val deg = t.startDeg + t.sweepDeg * p
        val rad = Math.toRadians(deg.toDouble())
        val dx = cos(rad).toFloat()
        val dy = sin(rad).toFloat()
        // 길이는 **위로 갈수록** 자란다(i=0 이 위). 채움도 아래에서 위로 가므로 방향이 같다.
        val len = r * 0.085f * (0.35f + 0.65f * (1f - p))
        val inner = outer - len
        drawLine(
            color = if (tickLit(i, t.count, t.fraction)) t.color else VgColors.Track,
            start = Offset(cx + dx * inner, cy + dy * inner),
            end = Offset(cx + dx * outer, cy + dy * outer),
            strokeWidth = stroke,
            cap = StrokeCap.Round,
        )
    }
}

/**
 * 눈금 하나가 켜지는가 — **아래에서 위로** 켜진다.
 *
 * ⚠ 종전엔 `i < filled` 라 **위에서 아래로** 켜졌다. 좌측 띠는 아래에서 위로 차는데
 *   우측만 반대라 같은 화면에서 두 계기가 서로 다른 말을 했고, 켜진 눈금이 하필
 *   페이지 점과 같은 자리(우상단)에 몰려 "걸음이 적용 안 된다" 로 읽혔다(08-25 사용자 보고).
 *
 * ⚠ 올림이다 — 반올림이면 눈금 반 칸 미만이 조용히 0 이 된다. 0 과 "조금" 은 구별돼야 계기다.
 *
 * @param index 0 = 위 끝, count-1 = 아래 끝.
 */
internal fun tickLit(index: Int, count: Int, fraction: Float?): Boolean {
    if (fraction == null || fraction <= 0f) return false
    val filled = kotlin.math.ceil(fraction * count).toInt().coerceAtMost(count)
    return index >= count - filled
}
