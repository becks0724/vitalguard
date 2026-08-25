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

/**
 * 각도 규약 — 0° = 3시(우), +시계방향. 좌우 대칭으로 잡는다.
 *   우측 -35°~ +35°  (3시 중심 · 70°)
 *   좌측 145°~ 215°  (9시 중심 · 70°)
 * 12시·6시를 비우는 이유 — 위는 TimeText, 아래는 버튼이 앉는다.
 */
object Bezel {
    /** 좌측 — 아래(145°)에서 위(215°)로. */
    const val LEFT_START = 145f
    const val SWEEP = 70f

    /**
     * 우측 — **아래(35°)에서 위(-35°)로.** 화면 좌우라 각의 부호가 반대여서 sweep 이 음수다.
     * 이렇게 두면 좌우가 같은 규약을 쓴다 = "비율 0 은 아래, 1 은 위".
     */
    const val RIGHT_START = 35f
    const val RIGHT_SWEEP = -70f
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

    /**
     * 비율 구간 하나를 호로. **칸 사이를 띄우려면 Butt 캡이어야 한다**(Round 는 틈을 메운다).
     * ⚠ sweep 이 음수일 수 있다 — 좌측은 아래(145°)에서 위로, 우측은 아래(35°)에서 위로
     *   가는데 화면 좌우라 각의 부호가 반대다. 그래서 각을 정렬한 뒤 그린다.
     */
    fun arc(fromF: Float, toF: Float, color: Color) {
        val gap = GAP_DEG / 2f
        val a0 = b.startDeg + b.sweepDeg * fromF
        val a1 = b.startDeg + b.sweepDeg * toF
        val s = minOf(a0, a1) + gap
        val e = maxOf(a0, a1) - gap
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

    // ★ **현재 구간만 밝게**(08-25 사용자 결정).
    val cur = currentZone(b.zones, b.fraction) ?: return
    arc(cur.from, cur.to, cur.color)
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
