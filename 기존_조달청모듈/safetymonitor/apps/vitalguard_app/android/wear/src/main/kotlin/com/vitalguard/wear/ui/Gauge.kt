// 호(arc) 게이지 — 숫자 대신 "안전 범위 어디에 있나"를 보여준다. 장갑 낀 손이 1초에 읽는 단위
package com.vitalguard.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.ProgressIndicatorDefaults
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

/**
 * 원형 버블 하나 — 호 + 값 + 라벨. 이미지의 그 단위다.
 * ⚠ 지름은 화면 대비 비율로 준다(퍼센트 기반 마진 규칙) — 40mm/44mm 에서 같은 비례로 보인다.
 */
@Composable
fun VitalBubble(
    value: String,
    label: String,
    fraction: Float?,
    severity: Severity,
    diameter: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier,
) {
    val tint = severity.color()
    Box(modifier = modifier.size(diameter), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            progress = { fraction ?: 0f },
            modifier = Modifier.size(diameter),
            // 12시에서 시작해 한 바퀴가 아니라, 아래쪽을 비워 값이 읽히게 한다(이미지와 같은 형태).
            startAngle = 135f,
            endAngle = 45f,
            colors = ProgressIndicatorDefaults.colors(
                indicatorColor = tint,
                trackColor = VgColors.Track,
            ),
            strokeWidth = 5.dp,
        )
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                value,
                color = VgColors.Primary,
                fontSize = (diameter.value * 0.26f).sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                label,
                color = VgColors.Secondary,
                fontSize = (diameter.value * 0.14f).sp,
            )
        }
    }
}
