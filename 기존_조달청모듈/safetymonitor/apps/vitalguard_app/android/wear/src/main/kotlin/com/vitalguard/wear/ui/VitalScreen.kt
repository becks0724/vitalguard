// 작업자 화면 — Material 3 Expressive 원형 게이지. 숫자가 아니라 "호가 어디까지 찼나"로 읽힌다
package com.vitalguard.wear.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import com.vitalguard.wear.core.Severity
import com.vitalguard.wear.core.Thresholds
import com.vitalguard.wear.core.coreTempSeverity
import com.vitalguard.wear.core.spo2Severity

/** 큰 화면 분기 — Wear OS 공식 브레이크포인트. 40mm 와 44mm 가 여기서 갈린다. */
private const val LARGE_DISPLAY_BREAKPOINT = 225

@Composable
fun VitalScreen(
    state: VitalUiState,
    onToggleCollect: () -> Unit,
    onOpenDiagnostics: () -> Unit = {},
) {
    val widthDp = LocalConfiguration.current.screenWidthDp
    val large = widthDp >= LARGE_DISPLAY_BREAKPOINT
    // ⚠ 절대 dp 가 아니라 화면 비율로 준다 — 원형에서 가장자리 잘림을 막는 공식 규칙.
    val sideMargin = (widthDp * 0.155f).dp   // 베젤 눈금과 본문이 겹치지 않는 하한
    val bubble = (widthDp * (if (large) 0.215f else 0.225f)).dp

    Box(Modifier.fillMaxSize().background(VgColors.Background)) {
        // 베젤 눈금 — 본문을 밀지 않고 가장자리에 겹쳐 그린다(원형에서 유일하게 남는 공간).
        BezelIndicator(band = hrBand(state), ticks = stillTicks(state))
        TimeText()   // 워치 표준 — 시계를 보려고 앱을 나가지 않게 한다
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = sideMargin, vertical = (widthDp * 0.10f).dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // 좌 = 주값(심박) · 우 = 버블 3단. 원형에서 가로 폭이 가장 넓은 가운데 띠를 쓴다.
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                HeartPill(state, large, modifier = Modifier.weight(1f))
                BubbleColumn(state, bubble)
            }
            StatusLine(state)
            ActionRow(state, onToggleCollect, onOpenDiagnostics)
        }
    }
}

/** 중앙 필 — 심박이 주값이다. 색이 곧 판정이고, 위험·주의일 때만 낱말이 붙는다. */
@Composable
private fun HeartPill(state: VitalUiState, large: Boolean, modifier: Modifier = Modifier) {
    val tint = state.severity.color()
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        state.workerName?.let { Text(it, color = VgColors.Secondary, fontSize = 11.sp) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            // 이모지 ♥ 대신 VitAlGuard 심볼 — 다른 앱 아이콘과 혼동되지 않고, 판정색으로 물든다.
            Image(
                painter = painterResource(com.vitalguard.wear.R.drawable.ic_vitalguard),
                contentDescription = null,
                colorFilter = ColorFilter.tint(tint),
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(if (large) 26.dp else 22.dp),
            )
            Text(
                state.bpm?.toString() ?: "--",
                color = VgColors.Primary,
                fontSize = if (large) 46.sp else 38.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 5.dp),
            )
            Text("bpm", color = VgColors.Secondary, fontSize = 11.sp)
        }
        if (state.severity == Severity.CAUTION || state.severity == Severity.DANGER) {
            Text(state.severity.label, color = tint, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * 버블 3종 — SpO₂ · 체온 · 무동작. **위험 판정에 직접 쓰이는 값만** 올린다(사용자 결정 08-25).
 * 걸음·주변온은 화면에서 뺐다 — 위험도와 직접 관련이 낮아 자리를 차지할 값이 아니다.
 */
@Composable
private fun BubbleColumn(state: VitalUiState, diameter: androidx.compose.ui.unit.Dp) {
    Column(
        verticalArrangement = Arrangement.spacedBy(3.dp),
        horizontalAlignment = Alignment.End,
    ) {
        // SpO₂ — 호는 위험선(88)~정상(100) 구간. 호가 비면 그대로 위험이다.
        LabeledBubble(
            value = state.spo2?.toString() ?: "--",
            label = "SpO₂",
            fraction = gaugeFraction(state.spo2?.toDouble(), 85.0, 100.0),
            severity = spo2Severity(state.spo2),
            diameter = diameter,
        )
        // 심부 체온 — 정상 36 부터 위험선 38.0 을 넘는 38.5 까지.
        LabeledBubble(
            value = state.coreTempC?.let { "%.1f".format(it) } ?: "--",
            label = "체온",
            fraction = gaugeFraction(state.coreTempC, 36.0, 38.5),
            severity = coreTempSeverity(state.coreTempC),
            diameter = diameter,
        )
        // 무동작 — 붕괴 후보선(90초)에서 호가 가득 찬다. 차오르는 것 자체가 경고다.
        LabeledBubble(
            value = state.stillSec?.let { stillShort(it) } ?: "--",
            label = "무동작",
            fraction = gaugeFraction(state.stillSec, 0.0, Thresholds.COLLAPSE_STILL_SEC),
            severity = stillSeverity(state.stillSec),
            diameter = diameter,
        )
    }
}

/** 라벨을 원 **왼쪽**에 세로로 붙인다 — 원 안은 숫자만 남겨 3단에서도 값이 읽힌다. */
@Composable
private fun LabeledBubble(
    value: String,
    label: String,
    fraction: Float?,
    severity: Severity,
    diameter: androidx.compose.ui.unit.Dp,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(label, color = VgColors.Secondary, fontSize = 9.sp)
        VitalBubble(
            value = value,
            fraction = fraction,
            severity = severity,
            diameter = diameter,
        )
    }
}

/** 전송 상태 — 큐가 쌓이면 주황. 서버 장애의 유일한 가시 신호다(08-25 실황). */
@Composable
private fun StatusLine(state: VitalUiState) {
    // 한 줄에 다 담는다 — 원형 하단은 폭이 급격히 좁아져 두 항목이 서로를 밀어낸다.
    // 정상일 때는 짧게(`전송 49s`), 이상일 때만 길어진다(iOS transmitLine 과 같은 규칙).
    val (text, tint) = when {
        !state.collecting -> "중지됨" to VgColors.Idle
        state.queued > 0 -> "대기 ${state.queued}건" to VgColors.Caution
        state.lastUploadAgeSec != null -> "전송 ${shortAge(state.lastUploadAgeSec)}" to VgColors.Normal
        else -> "수집 중" to VgColors.Normal
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = tint, fontSize = 11.sp)
        state.batteryPct?.let {
            Text(
                " · $it%",
                color = if (it <= 15) VgColors.Danger else VgColors.Secondary,
                fontSize = 11.sp,
            )
        }
    }
}

/**
 * 시작/중지 + 진단. **[시작]에는 확인이 없고 [중지]에만 있다**(호출부가 확인을 건다) —
 * 켜는 쪽 오탭은 손해가 없고, 끄는 쪽은 사람이 알아챌 때까지 수집이 멎는다(iOS 08-20 사고).
 */
@Composable
private fun ActionRow(
    state: VitalUiState,
    onToggle: () -> Unit,
    onDiagnostics: () -> Unit,
) {
    // 한 줄에 나란히 — 세로로 쌓으면 원형 하단 두 칸을 먹는데, 진단은 그만한 무게가 아니다.
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            onClick = onToggle,
            label = {
                Text(
                    if (state.collecting) "중지" else "시작",
                    color = Color.Black,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
            },
            colors = ButtonDefaults.buttonColors(
                containerColor = if (state.collecting) VgColors.Danger else VgColors.Normal,
            ),
            modifier = Modifier.weight(1f),
        )
        Button(
            onClick = onDiagnostics,
            label = { Text("⋯", color = VgColors.Secondary, fontSize = 16.sp) },
            colors = ButtonDefaults.buttonColors(containerColor = VgColors.Pill),
            modifier = Modifier.width(52.dp),   // 터치 타겟 하한(48dp) 은 지킨다
        )
    }
}

/**
 * 좌측 띠 = **심박이 안전대 어디인가.** 본문은 숫자를, 베젤은 위치를 말한다 —
 * "100" 만으로는 위험선까지 얼마나 남았는지 모른다. 위험 하한 40 ~ 상한 130 을 편다.
 * 위가 높은 값이다(과부하가 위로 올라간다).
 */
internal fun hrBand(state: VitalUiState): BezelBand = BezelBand(
    startDeg = Bezel.LEFT_START,
    sweepDeg = Bezel.SWEEP,
    fraction = gaugeFraction(state.bpm?.toDouble(), 40.0, 130.0),
    color = state.severity.color(),
)

/**
 * 우측 눈금 = **무동작 경과**(사용자 결정 08-25). 붕괴 후보선(90초)까지 눈금이 차오른다 —
 * 차오르는 것 자체가 경고라 숫자보다 형태가 먼저 읽힌다.
 * ⚠ 본문 버블과 같은 값이다. 버블은 초 단위 수치, 베젤은 임계까지의 거리를 맡는다.
 */
internal fun stillTicks(state: VitalUiState): BezelTicks = BezelTicks(
    startDeg = Bezel.RIGHT_START,
    sweepDeg = Bezel.SWEEP,
    fraction = gaugeFraction(state.stillSec, 0.0, Thresholds.COLLAPSE_STILL_SEC),
    color = stillSeverity(state.stillSec).color(),
)

/** 무동작은 붕괴 후보선을 넘으면 주의 — 낙상 규칙과 같은 경계(90초). */
internal fun stillSeverity(sec: Double?): Severity = when {
    sec == null -> Severity.IDLE
    sec >= Thresholds.COLLAPSE_STILL_SEC -> Severity.CAUTION
    else -> Severity.NORMAL
}

/** 버블은 폭이 좁다 — 초는 그대로, 분 이상은 줄여 적는다. */
internal fun stillShort(sec: Double): String =
    if (sec < 60) "${sec.toInt()}s" else "${(sec / 60).toInt()}m"

/** 상태줄용 초단축 표기 — 원형 하단은 글자 하나가 아깝다. */
internal fun shortAge(sec: Long): String = when {
    sec < 60 -> "${sec}s"
    sec < 3600 -> "${sec / 60}m"
    else -> "${sec / 3600}h"
}

/** 값의 나이 — 초·분·시로 줄여 적는다. */
internal fun ageLabel(sec: Long): String = when {
    sec < 60 -> "${sec}초 전"
    sec < 3600 -> "${sec / 60}분 전"
    else -> "${sec / 3600}시간 전"
}

