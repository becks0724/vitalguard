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
    fraction: Float?,
    severity: Severity,
    diameter: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier,
) {
    val tint = severity.color()
    Box(modifier = modifier.size(diameter), contentAlignment = Alignment.Center) {
        // ⚠ colors 를 안 주면 M3 기본 테마색(보라)이 이긴다 — 08-25 실기에서 세 버블이 전부
        //   같은 보라로 떠 판정색이 죽어 있었다. indicator·track 을 모두 명시한다.
        CircularProgressIndicator(
            progress = { fraction ?: 0f },
            modifier = Modifier.size(diameter),
            // 12시에서 시작해 한 바퀴가 아니라, 아래쪽을 비워 값이 읽히게 한다(이미지와 같은 형태).
            startAngle = 135f,
            endAngle = 45f,
            colors = ProgressIndicatorDefaults.colors(
                indicatorColor = tint,
                trackColor = VgColors.Track,
                // 미측정(IDLE)이면 호가 아예 없어야 하는데, 일부 테마가 트랙을 강조색으로 칠한다.
                disabledIndicatorColor = VgColors.Idle,
                disabledTrackColor = VgColors.Track,
            ),
            strokeWidth = 5.dp,
        )
        // 값만 원 안에. 라벨은 호출부가 원 **밖**에 둔다 — 3단 세로에서는 원이 작아
        // 두 줄을 넣으면 숫자가 읽히지 않는다(참조 워치페이스도 값만 넣는다).
        Text(
            value,
            color = VgColors.Primary,
            fontSize = (diameter.value * 0.34f).sp,
            fontWeight = FontWeight.Bold,
        )
    }
}
