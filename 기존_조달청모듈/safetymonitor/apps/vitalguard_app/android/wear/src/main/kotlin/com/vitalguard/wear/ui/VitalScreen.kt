// 작업자 화면 — Material 3 Expressive 원형 게이지. 숫자가 아니라 "호가 어디까지 찼나"로 읽힌다
package com.vitalguard.wear.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
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
import com.vitalguard.wear.core.skinTempSeverity
import com.vitalguard.wear.core.spo2Severity

/** 큰 화면 분기 — Wear OS 공식 브레이크포인트. 40mm 와 44mm 가 여기서 갈린다. */
private const val LARGE_DISPLAY_BREAKPOINT = 225

@Composable
fun VitalScreen(
    state: VitalUiState,
    /** 진단 화면 진입 — 화면 아무 곳이나 길게 누른다(작업자 화면에 버튼을 두지 않는다). */
    onOpenDiagnostics: () -> Unit = {},
    /** 탭 — 화면을 잠시 붙잡는다(상시 유지는 발열을 만든다 · 08-25 실측). */
    onTap: () -> Unit = {},
) {
    val widthDp = LocalConfiguration.current.screenWidthDp
    val large = widthDp >= LARGE_DISPLAY_BREAKPOINT
    // ⚠ 절대 dp 가 아니라 화면 비율로 준다 — 원형에서 가장자리 잘림을 막는 공식 규칙.
    val sideMargin = (widthDp * 0.155f).dp   // 베젤 눈금과 본문이 겹치지 않는 하한
    val bubble = (widthDp * (if (large) 0.20f else 0.21f)).dp

    Box(
        Modifier
            .fillMaxSize()
            .background(VgColors.Background)
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onLongPress = { onOpenDiagnostics() },
                )
            },
    ) {
        // 베젤 눈금 — 본문을 밀지 않고 가장자리에 겹쳐 그린다(원형에서 유일하게 남는 공간).
        BezelIndicator(band = hrBand(state), ticks = stepTicks(state))
        // 사이드 인디케이터 명칭 — 무엇을 재는 눈금인지 없으면 못 읽는다.
        BezelLabels(state)
        TimeText()   // 워치 표준 — 시계를 보려고 앱을 나가지 않게 한다
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = sideMargin, vertical = (widthDp * 0.10f).dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // ★ Wear 디자인 지침 반영(08-25) — 요약 화면은 **한눈(약 7초)** 이 기준이다.
            //   차트는 "복잡한 통계는 글랜서빌리티를 떨어뜨린다" 는 지침에 따라 **상세 페이지로 내렸다**.
            //   여기 남는 것은 ① 상태 배지 ② 큰 주값 ③ 라벨·범위 ④ 버블 3개 ⑤ 하단 상태.
            TopIcons(state)
            HeroValue(state, large)
            LabelAndRange(state)
            BubbleRow(state, bubble)
            FooterLine(state)
            // 아래로 스와이프하면 상세 — 발견성을 위해 힌트를 남긴다(지침: 작업의 명확성).
            SwipeHint()
        }
    }
}

/** ① 상단 아이콘 — 수집·전송 상태를 낱말 없이 알린다(사진의 두 원형 배지 자리). */
@Composable
private fun TopIcons(state: VitalUiState) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = 2.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(
            active = state.collecting,
            activeColor = VgColors.Normal,
            label = "수집",
        )
        Spacer(Modifier.width(8.dp))
        StatusDot(
            active = state.collecting && state.queued == 0,
            activeColor = if (state.queued > 0) VgColors.Caution else VgColors.Normal,
            label = "전송",
        )
    }
}

@Composable
private fun StatusDot(active: Boolean, activeColor: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(7.dp)
                .background(if (active) activeColor else VgColors.Idle, CircleShape),
        )
        Text(" $label", color = VgColors.Secondary, fontSize = 9.sp)
    }
}

/** ② 큰 주값 — 사진의 시각 자리에 심박이 온다. 색이 곧 판정. */
@Composable
private fun HeroValue(state: VitalUiState, large: Boolean) {
    Row(verticalAlignment = Alignment.Bottom) {
        // ★ 앱 로고를 뺐다(지침 §2) — 시스템이 앱 아이콘을 이미 보여주므로 화면 안 중복은
        //   공간만 먹는다. 대신 **판정색 점**으로 상태를 알린다(색이 곧 정보).
        Box(
            Modifier
                .size(if (large) 10.dp else 8.dp)
                .background(state.severity.color(), CircleShape)
                .padding(bottom = 6.dp),
        )
        Text(
            state.bpm?.toString() ?: "--",
            color = VgColors.Primary,
            fontSize = if (large) 44.sp else 36.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 3.dp),
        )
        Text("bpm", color = VgColors.Secondary, fontSize = 11.sp, modifier = Modifier.padding(bottom = 6.dp))
    }
}

/** ③ 라벨 + 범위 — 사진의 "심박수 … 95-102" 줄. 오늘 관측 범위를 오른쪽에 적는다. */
@Composable
private fun LabelAndRange(state: VitalUiState) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 1.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            state.workerName ?: "심박수",
            color = state.severity.color(),
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
        )
        state.bpmRange?.let { (lo, hi) ->
            Text("$lo-$hi", color = VgColors.Secondary, fontSize = 10.sp)
        }
    }
}

/** ⑤ 버블 3개 가로 — SpO₂ · 체온 · 무동작(사용자 결정 08-25). 위험 판정에 직접 쓰이는 값만. */
@Composable
private fun BubbleRow(state: VitalUiState, diameter: androidx.compose.ui.unit.Dp) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LabeledBubble(
            value = state.spo2?.toString() ?: "--",
            label = "SpO₂",
            fraction = gaugeFraction(state.spo2?.toDouble(), 85.0, 100.0),
            severity = spo2Severity(state.spo2),
            diameter = diameter,
        )
        // ★ **실측 피부온을 그대로 보여준다**(08-25 C안). 종전엔 +0.5 해서 "체온" 이라 적었는데,
        //   그 상수는 애플 수면 손목온 기준이라 삼성 실측(37.4~37.7)과 전제가 다르고,
        //   서버는 아예 다른 방법(심박+칼만)을 쓴다 — 두 값이 38.16 vs 37.4 로 갈렸다.
        //   변환식은 하루치 실측이 쌓인 뒤 3단계에서 정한다. 그때까지 라벨도 "피부온" 으로 정직하게.
        LabeledBubble(
            value = state.skinTempC?.let { "%.1f".format(it) } ?: "--",
            label = "피부온",
            fraction = gaugeFraction(
                state.skinTempC,
                Thresholds.SKIN_GAUGE_MIN_C,
                Thresholds.SKIN_GAUGE_MAX_C,
            ),
            severity = skinTempSeverity(state.skinTempC),
            diameter = diameter,
        )
        // 스트레스 지수 — 심박 + 활동맥락(또는 HRV)으로 계산한다(사용자 결정 08-25).
        // ★ 주변온이 여기 있었다. 주변온은 서버로 계속 전송되고 WBGT 재료로 쓰인다 — 화면에서만 내렸다.
        // ⚠ 재료가 없으면 보정 중이라 `--` 다(0 으로 채우지 않는다).
        //
        // ★ 여기 원래 HRV 가 있었다(08-25 A안으로 교체). 실측이 결정했다 —
        //   필터를 두 번 강화하고 문턱을 6배(5→30) 올려도 유효 표본이 **3개**였다.
        //   병목은 심박 정합 단계로, 범위 통과분의 83~92% 를 버린다. 삼성 IBI 가
        //   놓친 박동이 합쳐진 값(실제 심박의 1.5~2.5배)이라 ±30% 로는 원리적으로 못 통과한다.
        //   ⟹ 코드로 못 넘는 센서 한계다. 신뢰 못 할 값을 자리에 두느니 뺀다.
        //   HRV 계산·전송은 유지한다(서버가 표본을 모아 쓸 수 있다) — 화면에서만 내린다.
        val stress = state.stress
        LabeledBubble(
            value = stress.index?.toString() ?: "--",
            label = "스트레스",
            fraction = stress.index?.let { it / 100f },
            severity = stress.level,
            diameter = diameter,
        )
    }
}

/** 라벨을 원 **아래**에 둔다 — 가로 3개 배치에서는 옆에 붙이면 폭이 모자란다. */
@Composable
private fun LabeledBubble(
    value: String,
    label: String,
    fraction: Float?,
    severity: Severity,
    diameter: androidx.compose.ui.unit.Dp,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        VitalBubble(value = value, fraction = fraction, severity = severity, diameter = diameter)
        Text(label, color = VgColors.Secondary, fontSize = 9.sp)
    }
}

/** 스와이프 힌트 — 세로 페이저가 있다는 것을 알려야 발견된다(지침 §6 작업의 명확성). */
@Composable
private fun SwipeHint() {
    Text(
        "▾",
        color = VgColors.Idle,
        fontSize = 11.sp,
        modifier = Modifier.padding(top = 2.dp),
    )
}

/** ⑥ 하단 — 사진의 일출·일몰 자리에 전송 상태와 배터리를 넣는다. */
@Composable
private fun FooterLine(state: VitalUiState) {
    val (text, tint) = when {
        !state.worn -> "착용하면 시작됩니다" to VgColors.Idle
        !state.collecting -> "준비 중" to VgColors.Idle
        state.queued > 0 -> "대기 ${state.queued}건" to VgColors.Caution
        state.lastUploadAgeSec != null -> "전송 ${shortAge(state.lastUploadAgeSec)}" to VgColors.Normal
        else -> "수집 중" to VgColors.Normal
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 3.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = tint, fontSize = 10.sp)
        state.batteryPct?.let {
            Text(
                " · $it%",
                color = if (it <= 15) VgColors.Danger else VgColors.Secondary,
                fontSize = 10.sp,
            )
        }
    }
}

/**
 * 좌우 눈금의 이름 — **인디케이터 상단 끝**에 프레임 반지름을 따라 앉힌다.
 * 각 아크의 위쪽 끝을 계산으로 골라 배치하므로 각도를 바꾸면 이름도 따라간다([[L-106]] ①).
 */
@Composable
private fun BoxScope.BezelLabels(state: VitalUiState) {
    val w = LocalConfiguration.current.screenWidthDp
    val r = w / 2f
    val labelR = r * 0.74f
    BezelLabel("심박", topEndDeg(Bezel.LEFT_START, Bezel.SWEEP), labelR, state.severity.color())
    BezelLabel(
        "걸음",
        topEndDeg(Bezel.RIGHT_START, Bezel.SWEEP),
        labelR,
        VgColors.Secondary,
    )
}

/** 각도 → 화면 오프셋. 0°=3시·시계방향(BezelIndicator 와 같은 규약). */
@Composable
private fun BoxScope.BezelLabel(
    text: String,
    deg: Float,
    labelR: Float,
    color: androidx.compose.ui.graphics.Color,
) {
    val rad = Math.toRadians(deg.toDouble())
    Text(
        text,
        color = color,
        fontSize = 9.sp,
        fontWeight = FontWeight.Medium,
        modifier = Modifier
            .align(Alignment.Center)
            .offset(
                x = (kotlin.math.cos(rad) * labelR).toFloat().dp,
                y = (kotlin.math.sin(rad) * labelR).toFloat().dp,
            ),
    )
}

/** 두 끝 중 화면에서 **위쪽**인 각도. sin 이 작은(=y 가 작은) 쪽이 위다. */
internal fun topEndDeg(startDeg: Float, sweepDeg: Float): Float {
    val endDeg = startDeg + sweepDeg
    val ys = kotlin.math.sin(Math.toRadians(startDeg.toDouble()))
    val ye = kotlin.math.sin(Math.toRadians(endDeg.toDouble()))
    return if (ys <= ye) startDeg else endDeg
}

/** 각도 → 화면 오프셋. 0°=3시·시계방향(BezelIndicator 와 같은 규약). */
@Composable
private fun BoxScope.BezelLabel(
    text: String,
    deg: Float,
    labelR: Float,
    screenR: Float,
    color: androidx.compose.ui.graphics.Color,
) {
    val rad = Math.toRadians(deg.toDouble())
    val dx = (kotlin.math.cos(rad) * labelR).toFloat()
    val dy = (kotlin.math.sin(rad) * labelR).toFloat()
    Text(
        text,
        color = color,
        fontSize = 9.sp,
        fontWeight = FontWeight.Medium,
        modifier = Modifier
            .align(Alignment.Center)
            .offset(x = dx.dp, y = dy.dp),
    )
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
 * 우측 눈금 = **걸음 수**(사용자 결정 08-25).
 *
 * ★ 여기 원래 무동작이 있었다. 무동작은 **수집·전송은 계속하되 화면에서 내린다** —
 *   붕괴(실신) 판정은 서버가 하는 일이고, 작업자가 자기 무동작 초를 볼 이유가 없다.
 *   반대로 걸음은 작업자에게 의미 있는 활동량이고, 스트레스 지수의 활동 맥락과도 이어진다.
 *
 * 축 = 0~8000보. 근무 중 목표 대비 진행이 눈금으로 차오른다.
 * ⚠ 색을 판정색으로 쓰지 않는다 — 걸음은 위험 신호가 아니라 활동량이다.
 *   많이 걸었다고 경고할 일이 아니고, 적게 걸었다고 안전한 것도 아니다.
 */
internal fun stepTicks(state: VitalUiState): BezelTicks = BezelTicks(
    startDeg = Bezel.RIGHT_START,
    sweepDeg = Bezel.SWEEP,
    fraction = gaugeFraction(state.sessionSteps.toDouble().takeIf { it > 0 }, 0.0, STEP_GAUGE_MAX),
    color = VgColors.Accent,
)

/** 걸음 눈금 축 — 8시간 교대의 대략치. 채우는 재미가 아니라 진행 감각용이다. */
internal const val STEP_GAUGE_MAX = 8000.0

/**
 * 주변 온도 판정 — WBGT 참고. **경보가 아니라 표시**다(정식 온열 판정은 서버가 습도·복사열까지 본다).
 * 31℃ 이상 주의 · 35℃ 이상 위험 — 고용노동부 온열질환 예방 가이드의 체감온도 단계에 맞춘 표시용 값.
 */
internal fun ambientSeverity(c: Double?): Severity = when {
    c == null -> Severity.IDLE
    c >= 35.0 -> Severity.DANGER
    c >= 31.0 -> Severity.CAUTION
    else -> Severity.NORMAL
}

/**
 * HRV(SDNN) 판정 — **낮을수록 나쁘다**(심박과 반대 방향).
 * 20ms 미만은 강한 스트레스·피로의 지표로 널리 쓰인다. 다만 개인차가 커서
 * ⚠ **경보로 쓰지 않는다** — 화면 표시 전용이고, 관제 스트레스 지수는 서버가 계산한다.
 */
internal fun hrvSeverity(ms: Double?): Severity = when {
    ms == null -> Severity.IDLE
    ms < 20 -> Severity.CAUTION
    else -> Severity.NORMAL
}

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

