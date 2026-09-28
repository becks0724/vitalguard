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
import com.vitalguard.field.R
import com.vitalguard.field.data.cctv.*
import com.vitalguard.field.data.models.alertTime
import com.vitalguard.field.ui.theme.*

@Composable
fun CctvScreen(controller: CctvController, onBack: () -> Unit, onSettings: () -> Unit) {
    val s by controller.state.collectAsStateWithLifecycle()
    CctvContent(s, onBack = onBack, onRetry = controller::retry, onSettings = onSettings)
}

@Composable
fun CctvContent(s: CctvState, onBack: () -> Unit = {}, onRetry: () -> Unit = {}, onSettings: () -> Unit = {}) {
    val bitmap = remember(s.bytes) { s.bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
    BoxWithConstraints(Modifier.fillMaxSize().padding(24.dp).testTag("cctv-screen")) {
        val controlsHeight = maxHeight * .65f
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Large text can scroll inside the controls; the entire camera frame remains visible below.
            GlassCard(Modifier.fillMaxWidth().heightIn(max = controlsHeight)) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    VgBackButton(Modifier.testTag("cctv-back"), onClick = onBack)
                    Text("현장 CCTV · CAM-03", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                }
                Text("스냅샷 갱신 영상 · 소리 없이 첫 이미지를 받아 표시합니다")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onRetry, Modifier.heightIn(min = 56.dp).testTag("cctv-retry"), enabled = !s.loading) { Text("다시 받기") }
                    OutlinedButton(onSettings, Modifier.heightIn(min = 56.dp).testTag("cctv-open-settings")) {
                        VgIcon(R.drawable.ic_settings); Spacer(Modifier.width(8.dp)); Text("영상 설정")
                    }
                }
                StateLabel(if (s.receivedAt == null) StateKind.empty else StateKind.ready, if (s.receivedAt == null) "수신 전 · ${s.periodSeconds}초 간격" else
                    "${alertTime(s.receivedAt.toString())} 수신 · ${s.ageSeconds}초 전 · ${s.periodSeconds}초 간격", Modifier.testTag("cctv-receipt"))
                if (s.loading && bitmap == null) StateLabel(StateKind.loading, "영상 수신 중")
                if (!s.active) StateLabel(StateKind.info, "갱신 중지")
                s.error?.let { StateNotice(StateKind.failed, "영상 수신 실패", it, Modifier.testTag("cctv-error")) }
                if (s.stale) StateLabel(StateKind.stale, "오래된 영상 · 현재 상태와 다를 수 있습니다", Modifier.testTag("cctv-stale"))
            }
            }
            GlassCard(Modifier.weight(1f).fillMaxWidth()) {
            Box(Modifier.fillMaxSize().padding(8.dp), contentAlignment = Alignment.Center) {
                if (bitmap != null) Image(bitmap, "마지막 수신 CCTV 영상",
                    Modifier.fillMaxSize().alpha(if (s.stale) .45f else 1f).testTag("cctv-image"), contentScale = ContentScale.Fit)
                else if (!s.loading) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    StateIcon(StateKind.empty, Modifier.size(44.dp)); Text("받은 영상이 없습니다")
                }
            }
            }
        }
    }
}
