// 좌우 사이드 인디케이터 — 원형 베젤을 따라 도는 세로 아크 2종(좌=위치 띠 · 우=눈금 부채꼴)
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke

/**
 * 각도 규약 — 0° = 3시(우), +시계방향. 좌우 대칭으로 잡는다.
 *   우측 -60°~ +60°  (3시 중심 · 120°)
 *   좌측 120°~ 240°  (9시 중심 · 120°)
 * 12시·6시를 비우는 이유 — 위는 TimeText, 아래는 버튼이 앉는다.
 * 08-29 사용자 결정으로 위아래 25° 씩 늘렸다(70° → 120° · 후보 100/120/140 렌더 대조 후 선택).
 * 140° 부터는 위끝이 `● 수집` 상태줄에 닿는다. 이름은 띠 한가운데라 자동으로 따라간다.
 */
object Bezel {
    /** 좌측 — 아래(120°)에서 위(240°)로. */
    const val LEFT_START = 120f
    const val SWEEP = 120f

    /**
     * 우측 — **아래(60°)에서 위(-60°)로.** 화면 좌우라 각의 부호가 반대여서 sweep 이 음수다.
     * 이렇게 두면 좌우가 같은 규약을 쓴다 = "비율 0 은 아래, 1 은 위".
     */
    const val RIGHT_START = 60f
    const val RIGHT_SWEEP = -120f
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

@Composable
fun BezelIndicator(
    left: BezelBand?,
    right: BezelBand?,
    modifier: Modifier = Modifier,
    /** 반지름 대비 아크 중심 — 1.0 이 화면 가장자리. 원형 마스크에 안 잘리는 하한이 0.90 근처다. */
    radiusRatio: Float = 0.90f,
) {
    Canvas(modifier = modifier.fillMaxSize()) {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val r = minOf(cx, cy)

        left?.let { drawBand(it, cx, cy, r, radiusRatio) }
        right?.let { drawBand(it, cx, cy, r, radiusRatio) }
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

    // 트랙 — 구간 색이 **경계에서 이웃 색으로 섞이는 그라데이션**(08-29 사용자 요청 · 종전은 칸마다 단색).
    //   "어디부터 위험인가" 는 그대로 보이고, 칸 사이 틈 대신 색이 흐른다.
    val a0 = b.startDeg
    val a1 = b.startDeg + b.sweepDeg
    fun brush(alpha: Float) = Brush.sweepGradient(
        colorStops = b.gradientStops(alpha),
        center = Offset(cx, cy),
    )
    drawArc(
        brush = brush(TRACK_ALPHA),
        startAngle = minOf(a0, a1),
        sweepAngle = kotlin.math.abs(b.sweepDeg),
        useCenter = false,
        topLeft = topLeft,
        size = boxSize,
        style = Stroke(width = width, cap = StrokeCap.Butt),
    )

    // ★ **현재 구간만 밝게**(08-25 사용자 결정) — 같은 그라데이션을 그 구간만 원색으로 다시 칠한다.
    val cur = currentZone(b.zones, b.fraction) ?: return
    val gap = GAP_DEG / 2f
    val c0 = b.startDeg + b.sweepDeg * cur.from
    val c1 = b.startDeg + b.sweepDeg * cur.to
    val s = minOf(c0, c1) + gap
    val e = maxOf(c0, c1) - gap
    if (e <= s) return
    drawArc(
        brush = brush(1f),
        startAngle = s,
        sweepAngle = e - s,
        useCenter = false,
        topLeft = topLeft,
        size = boxSize,
        style = Stroke(width = width, cap = StrokeCap.Butt),
    )
}

/**
 * sweep 그라데이션 정지점 — 각 구간의 **한가운데**에 그 색을 두면 경계에서 이웃 색이 반반 섞인다.
 * 양끝은 첫·끝 구간 색을 그대로 연장한다.
 *
 * ⚠ `Brush.sweepGradient` 는 0 = 3시, 시계방향, 360° 를 0..1 로 잡는다(`drawArc` 와 같은 규약).
 *   우측 띠는 -60°~60° 라 **0° 를 가로지른다** — 그래서 0 과 1 에 같은 색(0° 의 색)을 박아 이음매를 없앤다.
 *   띠 밖 각도의 색은 안 그려지므로 무엇이든 상관없다.
 */
internal fun BezelBand.gradientStops(alpha: Float): Array<Pair<Float, Color>> {
    if (zones.isEmpty()) return arrayOf(0f to color.copy(alpha = alpha), 1f to color.copy(alpha = alpha))
    // 띠 위의 (비율, 색) — 구간 중앙 + 양끝
    val pts = listOf(0f to zones.first().color) +
        zones.map { (it.from + it.to) / 2f to it.color } +
        listOf(1f to zones.last().color)
    fun norm(deg: Float) = ((deg % 360f) + 360f) % 360f
    // 비율 → 각도 → 0..1
    val onBand = pts.map { (f, c) -> norm(startDeg + sweepDeg * f) to c }
    fun colorAtDeg(deg: Float): Color {
        // 띠 위 각도 순서로 선형 보간(띠 방향이 음수면 뒤집어 정렬)
        val ordered = if (sweepDeg >= 0) onBand else onBand.reversed()
        // 0° 를 가로지르는 띠는 각도가 접히므로 "띠 시작으로부터의 거리" 로 정렬해 보간한다
        val startN = norm(minOf(startDeg, startDeg + sweepDeg))
        fun dist(d: Float) = norm(d - startN)
        val sorted = ordered.sortedBy { dist(it.first) }
        val x = dist(deg)
        val hi = sorted.firstOrNull { dist(it.first) >= x } ?: return sorted.last().second
        val lo = sorted.lastOrNull { dist(it.first) <= x } ?: return sorted.first().second
        val span = dist(hi.first) - dist(lo.first)
        if (span <= 0f) return lo.second
        val t = (x - dist(lo.first)) / span
        return androidx.compose.ui.graphics.lerp(lo.second, hi.second, t)
    }
    val crossesZero = norm(startDeg) + kotlin.math.abs(sweepDeg) > 360f ||
        (minOf(startDeg, startDeg + sweepDeg) < 0f && maxOf(startDeg, startDeg + sweepDeg) > 0f)
    val stops = (onBand.map { it.first } + if (crossesZero) listOf(0f, 360f) else emptyList())
        .map { deg -> (if (deg >= 360f) 1f else deg / 360f) to colorAtDeg(deg).copy(alpha = alpha) }
        .sortedBy { it.first }
    return stops.toTypedArray()
}

/**
 * 지금 값이 속한 구간 하나 — **이것만 밝힌다.**
 *
 * ⚠ 누적으로 채우면 정상 심박에서도 맨 아래 서맥 위험 칸이 늘 켜져 "위험" 으로 오독된다.
 *   신호등은 "여기까지 왔다" 가 아니라 **"지금 어느 등이 켜졌나"** 다.
 *
 * 경계는 위쪽 구간에 준다(`from` 포함 · `to` 미포함) — 판정 함수의 `>=` 규약과 같은 방향이다.
 * 값이 1.0 이면 어느 구간에도 `to` 미포함으로 안 걸리므로 마지막 구간이 받는다.
 */
internal fun currentZone(zones: List<BezelZone>, fraction: Float?): BezelZone? {
    if (fraction == null || zones.isEmpty()) return null
    return zones.firstOrNull { fraction >= it.from && fraction < it.to } ?: zones.last()
}

/** 구간 사이 틈(도). 칸이 나뉘어 보일 만큼만 — 넓히면 띠가 끊겨 보인다. */
private const val GAP_DEG = 2.4f

/** 트랙(미도달 구간) 투명도. 값이 찬 구간과 구별되면서 색은 읽혀야 한다. */
private const val TRACK_ALPHA = 0.22f
