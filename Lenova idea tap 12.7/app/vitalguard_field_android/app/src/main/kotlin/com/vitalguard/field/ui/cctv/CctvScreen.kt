package com.vitalguard.field.ui.cctv

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.data.cctv.*
import com.vitalguard.field.data.models.alertTime

@Composable
fun CctvScreen(controller: CctvController, onBack: () -> Unit) {
    val s by controller.state.collectAsStateWithLifecycle()
    CctvContent(s, onBack, controller::period, controller::retry)
}

@Composable
fun CctvContent(s: CctvState, onBack: () -> Unit = {}, onPeriod: (Int) -> Unit = {}, onRetry: () -> Unit = {}) {
    val bitmap = remember(s.bytes) { s.bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
    BoxWithConstraints(Modifier.fillMaxSize().padding(24.dp).testTag("cctv-screen")) {
        val controlsHeight = maxHeight * .65f
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Large text can scroll inside the controls; the entire camera frame remains visible below.
            Column(Modifier.fillMaxWidth().heightIn(max = controlsHeight).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedButton(onBack, Modifier.heightIn(min = 56.dp).testTag("cctv-back")) { Text("현장 요약으로") }
                Text("현장 CCTV · CAM-03", style = MaterialTheme.typography.headlineSmall)
                Text("스냅샷 갱신 영상 · 소리 없이 첫 이미지를 받아 표시합니다")
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    for (seconds in listOf(2, 5, 10)) FilterChip(s.periodSeconds == seconds, { onPeriod(seconds) },
                        label = { Text("${seconds}초") }, modifier = Modifier.heightIn(min = 56.dp).testTag("cctv-period-$seconds"))
                    OutlinedButton(onRetry, Modifier.heightIn(min = 56.dp).testTag("cctv-retry"), enabled = !s.loading) { Text("다시 받기") }
                }
                Text(if (s.receivedAt == null) "수신 전 · ${s.periodSeconds}초 간격" else
                    "${alertTime(s.receivedAt.toString())} 수신 · ${s.ageSeconds}초 전 · ${s.periodSeconds}초 간격", Modifier.testTag("cctv-receipt"))
                if (s.loading && bitmap == null) Text("영상 수신 중")
                if (!s.active) Text("갱신 중지 · 이 화면으로 돌아오면 다시 받습니다")
                s.error?.let { Text(it, Modifier.testTag("cctv-error")); Text("재시도 간격 ${s.delaySeconds}초 · 연결되면 ${s.periodSeconds}초 간격으로 돌아갑니다") }
                if (s.stale) Text("오래된 영상 · 현재 현장 상태와 다를 수 있습니다", Modifier.testTag("cctv-stale"))
            }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (bitmap != null) Image(bitmap, "마지막 수신 CCTV 영상",
                    Modifier.fillMaxSize().alpha(if (s.stale) .45f else 1f).testTag("cctv-image"), contentScale = ContentScale.Fit)
                else if (!s.loading) Text("받은 영상이 없습니다")
            }
        }
    }
}
