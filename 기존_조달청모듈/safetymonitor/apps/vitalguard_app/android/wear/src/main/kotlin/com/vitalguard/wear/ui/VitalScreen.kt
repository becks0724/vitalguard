// 작업자 제품 화면 — iOS ContentView 의 규칙을 워치8 신호에 맞춰 옮긴다(0건 생략·중지에만 확인)
package com.vitalguard.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Text
import com.vitalguard.wear.core.Severity

@Composable
fun VitalScreen(
    state: VitalUiState,
    onToggleCollect: () -> Unit,
    onOpenDiagnostics: () -> Unit = {},
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize().background(VgColors.Background),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item { HeartHero(state) }
        item { SecondaryMetrics(state) }
        item { StatusBar(state) }
        item { CollectButton(state, onToggleCollect) }
        // 진단은 눈에 띄지 않게 — 작업자 화면에 실측 버튼이 서면 안 된다.
        item { DiagnosticsLink(onOpenDiagnostics) }
    }
}

/** ♥ + 큰 심박 — 색이 곧 판정이다. 측정 전엔 회색 `--`. */
@Composable
private fun HeartHero(state: VitalUiState) {
    val tint = state.severity.color()
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        state.workerName?.let {
            Text(it, color = VgColors.Secondary, fontSize = 11.sp)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("♥", color = tint, fontSize = 20.sp)
            Text(
                state.bpm?.toString() ?: "--",
                color = VgColors.Primary,
                fontSize = 44.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 5.dp),
            )
            Text("bpm", color = VgColors.Secondary, fontSize = 11.sp)
        }
        // 위험·주의일 때만 낱말을 띄운다 — 정상일 때 라벨은 소음이다.
        if (state.severity == Severity.CAUTION || state.severity == Severity.DANGER) {
            Text(state.severity.label, color = tint, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/** 보조 지표 — **측정된 것만** 줄에 오른다(0 채움 금지). 없으면 줄 자체가 사라진다. */
@Composable
private fun SecondaryMetrics(state: VitalUiState) {
    val rows = buildList {
        state.spo2?.let { pct ->
            val age = state.spo2AgeSec?.let { " · ${ageLabel(it)}" } ?: ""
            add(MetricRow("SpO₂", "$pct%$age", spo2Tint(state)))
        }
        state.coreTempC?.let { core ->
            val ambient = state.ambientTempC?.let { " · 주변 ${fmt1(it)}°" } ?: ""
            add(MetricRow("체온", "${fmt1(core)}°$ambient", state.coreTempTint()))
        }
        if (state.steps > 0) add(MetricRow("걸음", "%,d".format(state.steps), VgColors.Secondary))
        state.stillSec?.let {
            if (it >= 60) add(MetricRow("무동작", stillLabel(it), stillTint(it)))
        }
    }
    if (rows.isEmpty()) return
    Column(modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
        Divider()
        rows.forEach { r ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(r.label, color = VgColors.Secondary, fontSize = 12.sp)
                Text(r.value, color = r.tint, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** 수집·전송 상태 — 큐가 쌓이면 주황. 서버 장애의 유일한 가시 신호다(08-25 실황). */
@Composable
private fun StatusBar(state: VitalUiState) {
    val (text, tint) = when {
        !state.collecting -> "수집 중지됨" to VgColors.Idle
        state.queued > 0 -> "전송 대기 ${state.queued}건" to VgColors.Caution
        state.lastUploadAgeSec != null -> "전송됨 · ${ageLabel(state.lastUploadAgeSec)}" to VgColors.Normal
        else -> "수집 중" to VgColors.Normal
    }
    Column(modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
        Divider()
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text, color = tint, fontSize = 12.sp, textAlign = TextAlign.Center)
            state.batteryPct?.let {
                Text(
                    "  🔋$it%",
                    color = if (it <= 15) VgColors.Danger else VgColors.Secondary,
                    fontSize = 11.sp,
                )
            }
        }
    }
}

/**
 * 시작/중지 — **[시작]에는 확인이 없고 [중지]에만 있다.**
 * 켜는 쪽 오탭은 손해가 없고, 끄는 쪽은 사람이 알아챌 때까지 수집이 멎는다(iOS 08-20 사고).
 */
@Composable
private fun CollectButton(state: VitalUiState, onToggle: () -> Unit) {
    Chip(
        onClick = onToggle,
        label = {
            Text(
                if (state.collecting) "중지" else "시작",
                color = Color.Black,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
        },
        colors = ChipDefaults.primaryChipColors(
            backgroundColor = if (state.collecting) VgColors.Danger else VgColors.Normal,
        ),
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
    )
}

@Composable
private fun DiagnosticsLink(onClick: () -> Unit) {
    Chip(
        onClick = onClick,
        label = { Text("진단", color = VgColors.Secondary, fontSize = 12.sp) },
        colors = ChipDefaults.secondaryChipColors(backgroundColor = VgColors.Pill),
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
    )
}

@Composable
private fun Divider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(VgColors.Divider))
}

private data class MetricRow(val label: String, val value: String, val tint: Color)

private fun fmt1(v: Double) = "%.1f".format(v)

/** 값의 나이 — 초·분·시로 줄여 적는다(워치 폭이 좁다). */
internal fun ageLabel(sec: Long): String = when {
    sec < 60 -> "${sec}초 전"
    sec < 3600 -> "${sec / 60}분 전"
    else -> "${sec / 3600}시간 전"
}

private fun stillLabel(sec: Double): String = ageLabel(sec.toLong()).removeSuffix(" 전")

private fun stillTint(sec: Double) =
    if (sec >= com.vitalguard.wear.core.Thresholds.COLLAPSE_STILL_SEC) VgColors.Caution
    else VgColors.Secondary

private fun spo2Tint(state: VitalUiState) =
    com.vitalguard.wear.core.spo2Severity(state.spo2).color()

private fun VitalUiState.coreTempTint() =
    com.vitalguard.wear.core.coreTempSeverity(coreTempC).color()
