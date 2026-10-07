package com.vitalguard.field.ui.record

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.R
import com.vitalguard.field.data.record.*
import com.vitalguard.field.data.ActionSide
import com.vitalguard.field.ui.shell.LocalActionPlacement
import com.vitalguard.field.ui.theme.*
import kotlinx.coroutines.CancellationException

@Composable
fun RecordEditorScreen(editor: InkEditorController, run: (suspend () -> Unit) -> Unit, onClosed: suspend () -> Unit) {
    val state by editor.state.collectAsStateWithLifecycle()
    var confirmLeave by rememberSaveable(editor.draftKey) { mutableStateOf(false) }
    var confirmClear by rememberSaveable(editor.draftKey) { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var previewError by remember(editor) { mutableStateOf<String?>(null) }
    val bytes = editor.baseBytes
    val bitmap by produceState<Bitmap?>(null, bytes) {
        if (bytes != null) try { value = AndroidInkRenderer().preview(bytes); previewError = null
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { previewError = "원본 또는 작업본을 열지 못했습니다: ${e.message}" }
    }
    val leave: () -> Unit = {
        if (!state.busy && !leaving) {
            leaving = true
            run { try { if (editor.leave()) onClosed() } finally { leaving = false } }
        }
    }
    val back: () -> Unit = {
        if (!state.busy && !leaving) {
            editor.finishActive()
            run { editor.persist().await() }
            if (editor.state.value.strokes.isNotEmpty()) confirmLeave = true else leave()
        }
    }
    BackHandler(onBack = back)
    RecordEditorContent(state.copy(error = previewError ?: state.error), onBack = back,
        onTool = editor::selectTool, onWidth = editor::selectWidth, onColor = editor::selectColor,
        onUndo = editor::undo, onClear = { confirmClear = true }, onOriginal = editor::toggleOriginal,
        onFit = editor::toggleFit, onSave = { run { if (editor.save()) onClosed() } },
        onReload = { run { editor.load() } }) {
        if (bitmap != null) InkCanvas(editor, state, bitmap!!, Modifier.fillMaxSize())
        else if (state.loading || state.error == null && previewError == null) CircularProgressIndicator()
    }
    if (confirmClear) AlertDialog(onDismissRequest = { confirmClear = false }, title = { Text("주석을 모두 지울까요?") },
        text = { Text("완료한 모든 획을 지웁니다. 이 작업은 되돌릴 수 없습니다.") },
        dismissButton = { TextButton({ confirmClear = false }, Modifier.heightIn(min = 56.dp)) { Text("취소") } },
        confirmButton = { Button({ confirmClear = false; editor.clearAll() }, Modifier.heightIn(min = 56.dp).testTag("editor-confirm-clear"),
            colors = ButtonDefaults.buttonColors(containerColor = VgColors.danger, contentColor = VgColors.ink)) { Text("전체 지우기") } })
    if (confirmLeave) AlertDialog(onDismissRequest = { confirmLeave = false }, title = { Text("작성 중인 주석을 보관하고 나갈까요?") },
        text = { Text("그린 획은 이 기기에 초안으로 보관됩니다. 같은 사진에서 이어서 작성할 수 있습니다.") },
        dismissButton = { TextButton({ confirmLeave = false }, Modifier.heightIn(min = 56.dp)) { Text("계속 작성") } },
        confirmButton = { Button({ confirmLeave = false; leave() }, Modifier.heightIn(min = 56.dp).testTag("editor-keep-draft")) { Text("초안 보관 후 나가기") } })
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun RecordEditorContent(
    state: InkEditorState, onBack: () -> Unit = {}, onTool: (InkTool) -> Unit = {}, onWidth: (Double) -> Unit = {},
    onColor: (Long) -> Unit = {}, onUndo: () -> Unit = {}, onClear: () -> Unit = {}, onOriginal: () -> Unit = {},
    onFit: () -> Unit = {}, onSave: () -> Unit = {}, onReload: () -> Unit = {}, canvas: @Composable BoxScope.() -> Unit,
) {
    val available = !state.busy && state.activeCount == 0
    val leftHand = LocalActionPlacement.current.side == ActionSide.left
    val saveControl: @Composable () -> Unit = {
        EditorToolGroup("저장", "editor-save-tools") {
            ActionIconButton(R.drawable.ic_save, if (state.busy) "저장 중" else if (state.untouched) "주석 저장 · 표시할 내용이 없습니다" else "주석 저장", onSave,
                Modifier.testTag("editor-save"), enabled = state.canSave)
        }
    }
    Scaffold(containerColor = Color.Transparent, contentWindowInsets = WindowInsets(0, 0, 0, 0), topBar = {
        TopAppBar(title = { Text("펜으로 표시하기") }, expandedHeight = vgToolbarHeight(LocalDensity.current.fontScale),
            windowInsets = WindowInsets(0, 0, 0, 0), navigationIcon = {
                VgBackButton(Modifier.testTag("editor-back"), !state.busy, onBack)
            })
    }, bottomBar = {
        GlassCard(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).testTag("editor-actions"),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (leftHand) { saveControl(); EditorToolDivider() }
                Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()).testTag("editor-scroll-tools"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                EditorToolGroup("그리기", "editor-drawing-tools") {
                    listOf(InkTool.pen to "펜", InkTool.marker to "형광펜", InkTool.rectangle to "사각형", InkTool.eraser to "지우개").forEach { (tool, label) ->
                        EditorButton("tool-${tool.name}", label, available, state.tool == tool, { onTool(tool) }) {
                            EditorGlyph(tool.name, if (state.tool == tool) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
                EditorToolDivider()
                EditorToolGroup("굵기", "editor-width-tools") {
                    listOf(Triple("thin", "가늘게", .5), Triple("normal", "보통", 1.0), Triple("thick", "굵게", 2.0)).forEach { (id, label, width) ->
                        EditorButton("width-$id", label, available, state.widthMultiplier == width, { onWidth(width) }, outline = true) {
                            val color = MaterialTheme.colorScheme.onSurface
                            Canvas(Modifier.size(28.dp)) { drawCircle(color, (if (width == .5) 4 else if (width == 1.0) 7 else 11).dp.toPx()) }
                        }
                    }
                }
                EditorToolDivider()
                EditorToolGroup("색상", "editor-color-tools") {
                    listOf(Triple("red", "빨간 펜", 0xFFDC2626L), Triple("black", "검정 펜", 0xFF171717L), Triple("blue", "파란 펜", 0xFF0D74CEL)).forEach { (id, label, color) ->
                        EditorButton("color-$id", label, available, state.color == color, { onColor(color) }, outline = true) {
                            Canvas(Modifier.size(32.dp)) {
                                drawCircle(Color.White, 16.dp.toPx())
                                drawCircle(Color(color), 14.dp.toPx(), style = Stroke(2.dp.toPx()))
                                if (state.color == color) drawCircle(Color(color), 10.dp.toPx())
                            }
                        }
                    }
                }
                EditorToolDivider()
                EditorToolGroup("편집", "editor-edit-actions") {
                    EditorButton("undo", "마지막 획 되돌리기", available && state.undoAvailable, onClick = onUndo) { EditorGlyph("undo") }
                    EditorButton("clear-all", "전체 지우기", available && state.strokes.isNotEmpty(), onClick = onClear) { EditorGlyph("clear") }
                }
                EditorToolDivider()
                EditorToolGroup("보기", "editor-view-tools") {
                    EditorButton("original-only", "원본만 보기", available, state.originalOnly, onOriginal) { EditorGlyph("image", if (state.originalOnly) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface) }
                    EditorButton("fit-width", if (state.fitWidth) "전체 보기 · 확대·이동 초기화" else "폭 맞춤 · 확대·이동 초기화", available, state.fitWidth, onFit) {
                        EditorGlyph("fit", if (state.fitWidth) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface)
                    }
                }
                }
                if (!leftHand) { EditorToolDivider(); saveControl() }
            }
        }
    }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).clipToBounds(), contentAlignment = Alignment.Center) {
            Box(Modifier.fillMaxSize().testTag("editor-photo-viewport"), contentAlignment = Alignment.Center, content = canvas)
            // Error overlays never shrink or move the pen canvas.
            Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(44.dp).padding(horizontal = 12.dp)
                .then(if (state.error != null) Modifier.verticalScroll(rememberScrollState()) else Modifier).testTag("editor-message-slot")) { state.error?.let { Text(it) } }
            if (state.imageSize == null && !state.loading) ActionIconButton(R.drawable.ic_refresh, "원본 다시 열기", onReload)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditorButton(id: String, label: String, enabled: Boolean, selected: Boolean = false, onClick: () -> Unit,
    outline: Boolean = false, content: @Composable BoxScope.() -> Unit) {
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
    Box(Modifier.size(56.dp).testTag("editor-$id")
        .background(if (selected && !outline) MaterialTheme.colorScheme.primary else Color.Transparent, RoundedCornerShape(8.dp))
        .border(2.dp, if (selected && outline) MaterialTheme.colorScheme.primary else Color.Transparent, RoundedCornerShape(8.dp))
        .semantics { contentDescription = label }
        .selectable(selected, enabled, Role.Button, onClick = onClick), contentAlignment = Alignment.Center, content = content)
    }
}

@Composable
private fun EditorGlyph(name: String, color: Color = MaterialTheme.colorScheme.onSurface) {
    Canvas(Modifier.size(28.dp)) {
        val w = size.width; val h = size.height; val stroke = 2.dp.toPx()
        fun line(x: Float, y: Float, x2: Float, y2: Float) = drawLine(color, Offset(w*x, h*y), Offset(w*x2, h*y2), stroke, StrokeCap.Round)
        when (name) {
            "pen", "marker" -> { line(.25f,.75f,.75f,.25f); line(.25f,.75f,.2f,.85f); line(.2f,.85f,.35f,.8f); if (name == "marker") line(.2f,.95f,.9f,.95f) }
            "rectangle", "image" -> { drawRect(color, Offset(w*.15f,h*.2f), Size(w*.7f,h*.6f), style=Stroke(stroke)); if(name=="image") { line(.2f,.7f,.4f,.45f); line(.4f,.45f,.65f,.7f) } }
            "eraser" -> { line(.15f,.6f,.6f,.15f); line(.6f,.15f,.85f,.4f); line(.85f,.4f,.4f,.85f); line(.4f,.85f,.15f,.6f); line(.4f,.85f,.9f,.85f) }
            "undo" -> { line(.3f,.2f,.1f,.4f); line(.1f,.4f,.35f,.55f); drawArc(color, -150f, 245f, false, Offset(w*.25f,h*.3f), Size(w*.6f,h*.5f), style=Stroke(stroke)) }
            "clear" -> { line(.2f,.25f,.8f,.25f); line(.35f,.12f,.65f,.12f); line(.3f,.35f,.35f,.85f); line(.7f,.35f,.65f,.85f); line(.35f,.85f,.65f,.85f) }
            else -> { for (x in listOf(.15f,.85f)) { line(x,.25f,x,.75f); line(x,.25f,if(x<.5f) .35f else .65f,.25f); line(x,.75f,if(x<.5f) .35f else .65f,.75f) }; line(.3f,.5f,.7f,.5f) }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun InkCanvas(editor: InkEditorController, state: InkEditorState, bitmap: Bitmap, modifier: Modifier) {
    val density = LocalDensity.current.density.toDouble()
    val imagePaint = remember { Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG) }
    Canvas(modifier.testTag("ink-canvas").semantics { stateDescription = "완료한 획 ${state.strokes.size}" }
        .onSizeChanged { editor.viewport(InkSize(it.width.toDouble(), it.height.toDouble()), density) }
        .motionEventSpy { event ->
            // Compose Release와 별개인 Android의 사후 팜 리젝션 취소도 먼저 반영한다.
            if (event.actionMasked == MotionEvent.ACTION_CANCEL) editor.cancelPointers()
            else if ((event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_POINTER_UP) &&
                event.flags and 0x20 != 0 && event.getToolType(event.actionIndex) == MotionEvent.TOOL_TYPE_STYLUS) editor.cancelPen() // FLAG_CANCELED(API 33)
        }
        .pointerInput(editor) {
            try {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Main)
                        // 같은 이벤트에서는 펜을 먼저 처리하여 새 손바닥 접촉을 이동으로 쓰지 않는다.
                        for (change in event.changes.sortedBy { if (it.type == PointerType.Stylus) 0 else 1 }) {
                            val id = change.id.value
                            val position = InkOffset(change.position.x.toDouble(), change.position.y.toDouble())
                            if (change.type == PointerType.Stylus) {
                                when {
                                    change.isConsumed -> editor.penCancel(id)
                                    change.changedToDownIgnoreConsumed() -> editor.penDown(id, position, change.pressure.toDouble())
                                    change.changedToUpIgnoreConsumed() -> if (event.type == PointerEventType.Release) editor.penUp(id) else editor.penCancel(id)
                                    change.pressed -> editor.penMove(id, position, change.pressure.toDouble())
                                    else -> editor.penCancel(id)
                                }
                                change.consume()
                            } else if (change.type == PointerType.Touch) {
                                when {
                                    change.changedToDownIgnoreConsumed() -> editor.touchDown(id, position)
                                    !change.pressed || change.isConsumed -> editor.touchEnd(id)
                                    else -> editor.touchMove(id, position)
                                }
                                change.consume()
                            }
                        }
                    }
                }
            } finally { editor.cancelPointers() } // pointerInput 교체/취소 시 활성 획 확정 금지.
        }) {
        val target = editor.rectFor(InkSize(size.width.toDouble(), size.height.toDouble()))
        val rect = RectF(target.left.toFloat(), target.top.toFloat(), (target.left + target.width).toFloat(), (target.top + target.height).toFloat())
        drawIntoCanvas { canvas ->
            canvas.nativeCanvas.drawBitmap(bitmap, null, rect, imagePaint)
            if (!state.originalOnly) paintInk(canvas.nativeCanvas, rect, state.visibleStrokes)
        }
    }
}


@Composable
private fun EditorToolGroup(label: String, tag: String, content: @Composable RowScope.() -> Unit) {
    Column(Modifier.testTag(tag), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = DashboardColors.secondary)
        Row(Modifier.height(64.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp), content = content)
    }
}
@Composable
private fun EditorToolDivider() { VerticalDivider(Modifier.height(56.dp), color = DashboardColors.line) }
