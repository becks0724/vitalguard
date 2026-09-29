package com.vitalguard.field.ui.cctv

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.R
import com.vitalguard.field.data.cctv.*
import com.vitalguard.field.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

@Composable
fun CctvPeriodSlider(s: CctvState, onPeriod: (Int) -> Unit, modifier: Modifier = Modifier) {
    var choice by remember(s.periodMillis) { mutableFloatStateOf(s.periodMillis.toFloat()) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Slider(choice, onValueChange = { choice = (it / 500).roundToInt() * 500f },
            onValueChangeFinished = { onPeriod(choice.roundToInt()) }, valueRange = 0f..2000f, steps = 3,
            enabled = s.periodLoaded && !s.periodSaving,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("cctv-period-slider")
                .semantics { contentDescription = "CCTV 영상 갱신 간격"; stateDescription = cctvPeriodLabel(choice.roundToInt()) })
        Layout(content = {
            CCTV_PERIOD_OPTIONS.forEach { interval ->
                Text(cctvPeriodLabel(interval), style = MaterialTheme.typography.labelMedium, maxLines = 1,
                    color = if (choice.roundToInt() == interval) MaterialTheme.colorScheme.primary else DashboardColors.secondary,
                    fontWeight = if (choice.roundToInt() == interval) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier.testTag("cctv-tick-$interval"))
            }
        }, modifier = Modifier.fillMaxWidth()) { measurables, constraints ->
            val labels = measurables.map { it.measure(constraints.copy(minWidth = 0, minHeight = 0, maxWidth = constraints.maxWidth / 3)) }
            val height = labels.maxOf { it.height }
            val positions = labels.mapIndexed { index, label ->
                when (index) { 0 -> 0; labels.lastIndex -> constraints.maxWidth - label.width
                    else -> (constraints.maxWidth * index.toFloat() / labels.lastIndex - label.width / 2f).roundToInt() }
            }
            val gap = 4.dp.roundToPx()
            val staggered = (0 until labels.lastIndex).any { positions[it] + labels[it].width + gap > positions[it + 1] }
            layout(constraints.maxWidth, if (staggered) height * 2 + gap else height) {
                labels.forEachIndexed { index, label ->
                    label.place(positions[index], if (staggered && index % 2 == 1) height + gap else 0)
                }
            }
        }
    }
}

@Composable
fun CctvScreen(controller: CctvController, onBack: () -> Unit, onSettings: () -> Unit) {
    val s by controller.state.collectAsStateWithLifecycle()
    CctvContent(s, onBack, onSettings, controller::camera)
}

@Composable
fun CctvContent(s: CctvState, onBack: () -> Unit = {}, onSettings: () -> Unit = {}, onCamera: (String) -> Unit = {}) {
    // Decode off the UI thread; camera change also drops the previous image immediately.
    key(s.cameraId) {
        val bitmap by produceState<ImageBitmap?>(null, s.bytes) {
            value = withContext(Dispatchers.Default) { s.bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
        }
        var expanded by rememberSaveable { mutableStateOf(false) }
        BoxWithConstraints(Modifier.fillMaxSize().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp).testTag("cctv-screen")) {
            val controlsMaxHeight = maxHeight * .42f
            val wide = maxWidth.value / LocalDensity.current.fontScale >= 650
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                GlassCard(Modifier.fillMaxWidth().heightIn(max = controlsMaxHeight).testTag("cctv-controls")) {
                    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            VgBackButton(Modifier.testTag("cctv-back"), onClick = onBack)
                            Text("현장 CCTV", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                            if (wide) CameraTabs(s.cameraId, onCamera)
                            IconButton(onSettings, Modifier.size(56.dp).testTag("cctv-open-settings").semantics { contentDescription = "영상 설정" }) {
                                VgIcon(R.drawable.ic_settings)
                            }
                        }
                        if (!wide) CameraTabs(s.cameraId, onCamera)
                        Text(if (s.receivedAt == null) "수신 전 · ${cctvPeriodLabel(s.periodMillis)}" else
                            "${s.ageSeconds ?: 0}초 전 수신 · ${cctvPeriodLabel(s.periodMillis)}", Modifier.testTag("cctv-receipt"),
                            style = MaterialTheme.typography.labelMedium, color = DashboardColors.secondary)
                        if (s.error != null) StateNotice(StateKind.failed, "영상 수신 실패", s.error, Modifier.testTag("cctv-error"))
                        else if (!s.active) StateLabel(StateKind.info, "갱신 중지")
                        if (s.stale) StateLabel(StateKind.stale, "오래된 영상", Modifier.testTag("cctv-stale"))
                    }
                }
                GlassCard(Modifier.weight(1f).fillMaxWidth().testTag("cctv-video-card")) {
                    Box(Modifier.fillMaxSize().padding(4.dp).clipToBounds(), contentAlignment = Alignment.Center) {
                        bitmap?.let { frame ->
                            Image(frame, "${s.cameraId} 영상 · 눌러서 확대", Modifier.fillMaxSize()
                                .alpha(if (s.stale) .45f else 1f).testTag("cctv-image").clickable { expanded = true }, contentScale = ContentScale.Fit)
                        } ?: Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            StateIcon(if (s.loading) StateKind.loading else StateKind.empty, Modifier.size(40.dp))
                            Text(if (s.loading) "영상 수신 중" else "받은 영상이 없습니다")
                        }
                    }
                }
            }
        }
        if (expanded && bitmap != null) CctvZoomOverlay(bitmap!!, s, { expanded = false })
    }
}

@Composable
private fun CameraTabs(selected: String, onSelect: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CCTV_CAMERAS.forEach { camera ->
            FilterChip(selected == camera, { onSelect(camera) }, label = { Text(camera) },
                modifier = Modifier.heightIn(min = 56.dp).testTag("cctv-camera-$camera"))
        }
    }
}

@Composable
private fun CctvZoomOverlay(bitmap: ImageBitmap, s: CctvState, onClose: () -> Unit) {
    var scale by remember(s.cameraId) { mutableFloatStateOf(1f) }
    var offset by remember(s.cameraId) { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        GlassCard(Modifier.fillMaxSize().systemBarsPadding().padding(12.dp).testTag("cctv-zoom-overlay")) {
            Column(Modifier.fillMaxSize().background(Color(0xEE172126)).padding(8.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    VgBackButton(Modifier.testTag("cctv-zoom-close"), onClick = onClose)
                    Text(s.cameraId, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    ActionIconButton(R.drawable.ic_fit, "원래 크기", { scale = 1f; offset = Offset.Zero }, Modifier.testTag("cctv-zoom-reset"), size = 56.dp)
                }
                Text(if (s.stale || s.error != null) "마지막 수신 영상 · ${s.ageSeconds ?: 0}초 전" else "두 손가락으로 확대 · 드래그로 이동",
                    style = MaterialTheme.typography.labelMedium, color = DashboardColors.secondary)
                Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().testTag("cctv-zoom-gesture")
                    .semantics { stateDescription = "${(scale * 100).roundToInt()}%" }
                    .onSizeChanged { viewport = it; scale = 1f; offset = Offset.Zero }
                    .pointerInput(s.cameraId, bitmap.width, bitmap.height) {
                        detectTransformGestures { centroid, pan, zoom, _ ->
                            val next = (scale * zoom).coerceIn(1f, 5f)
                            val center = Offset(viewport.width / 2f, viewport.height / 2f)
                            val proposed = (offset - (centroid - center)) * (next / scale) + (centroid - center) + pan
                            val fit = minOf(viewport.width.toFloat() / bitmap.width, viewport.height.toFloat() / bitmap.height)
                            val boundX = ((bitmap.width * fit * next - viewport.width) / 2).coerceAtLeast(0f)
                            val boundY = ((bitmap.height * fit * next - viewport.height) / 2).coerceAtLeast(0f)
                            offset = Offset(proposed.x.coerceIn(-boundX, boundX), proposed.y.coerceIn(-boundY, boundY))
                            scale = next
                        }
                    }, contentAlignment = Alignment.Center) {
                    Image(bitmap, "확대한 ${s.cameraId} 영상", Modifier.fillMaxSize().graphicsLayer {
                        scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y
                    }, contentScale = ContentScale.Fit)
                }
            }
        }
    }
}
