// 실측 프로브 화면(Compose) — 상태를 인자로만 받는 순수 화면이라 미리보기가 실기 없이 렌더된다
package com.vitalguard.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Text

/** 화면이 그리는 데 필요한 전부 — 서비스·센서를 모르므로 미리보기가 그대로 렌더한다. */
data class ProbeUiState(
    val bpm: Int? = null,
    val running: Boolean = false,
    val samples: Int = 0,
    val queued: Int = 0,
    val output: String = "",
)

/** 버튼 한 줄. tint 가 Pill 이면 회색 필, 아니면 의미색(글자는 검정) — iOS tint 문법. */
data class ProbeAction(val label: String, val tint: Color = VgColors.Pill, val onClick: () -> Unit)

@Composable
fun ProbeScreen(state: ProbeUiState, actions: List<ProbeAction>) {
    TransformingLazyColumn(
        modifier = Modifier.fillMaxSize().background(VgColors.Background),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item { HeartHeader(state) }
        item { StatusLine(state) }
        items(actions) { action ->
            Button(
                onClick = action.onClick,
                label = {
                    Text(
                        action.label,
                        fontSize = 14.sp,
                        color = if (action.tint == VgColors.Pill) VgColors.Primary else Color.Black,
                    )
                },
                colors = ButtonDefaults.buttonColors(containerColor = action.tint),
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
            )
        }
        if (state.output.isNotEmpty()) {
            item {
                Text(
                    state.output,
                    color = VgColors.Accent,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

/** ♥ 72 bpm — iOS 와 같은 구도(하트 + 큰 숫자 + 작은 단위). */
@Composable
private fun HeartHeader(state: ProbeUiState) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Text("HR", color = VgColors.Danger, fontSize = 14.sp)
        Text(
            state.bpm?.toString() ?: "--",
            color = VgColors.Primary,
            fontSize = 38.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        Text("bpm", color = VgColors.Secondary, fontSize = 12.sp)
    }
}

/** 상태 한 줄 — 큐가 쌓이면 주황으로 바꿔 적체를 화면이 스스로 말하게 한다. */
@Composable
private fun StatusLine(state: ProbeUiState) {
    val text = when {
        state.running && state.queued > 0 -> "수집 중 · 표본 ${state.samples} · 큐 ${state.queued}"
        state.running -> "수집 중 · 표본 ${state.samples}"
        state.queued > 0 -> "대기 · 큐 ${state.queued}"
        else -> "대기"
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text,
            color = when {
                state.queued > 0 -> VgColors.Caution
                state.running -> VgColors.Normal
                else -> VgColors.Secondary
            },
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 6.dp),
        )
    }
}
