package com.vitalguard.field.ui.record

import com.vitalguard.field.ui.theme.*
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import com.vitalguard.field.R
import com.vitalguard.field.capture.*
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.*
import com.vitalguard.field.audio.DeviceCommentAudioPlayer
import com.vitalguard.field.ui.shell.ActionDock
import com.vitalguard.field.ui.theme.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun PhotoDetail(controller: FieldController, outbox: OutboxController, actions: RecordActions, photoId: String,
    windowWidthDp: Int, onBack: () -> Unit, onEditor: () -> Unit, onInput: () -> Unit,
) {
    val field by controller.state.collectAsStateWithLifecycle()
    val entries by outbox.items.collectAsStateWithLifecycle()
    val busyIds by outbox.busyIds.collectAsStateWithLifecycle()
    val actionStates by actions.state.collectAsStateWithLifecycle()
    val photo = entries.firstOrNull { it.id == photoId && it.kind == OutboxKind.photo }
    val children = entries.filter { it.dependsOn == photoId }.sortedBy { it.createdAt }
    LaunchedEffect(photoId, photo == null) {
        if (photo == null) { outbox.load(); if (outbox.entry(photoId) == null) onBack() }
    }
    if (photo == null) { Text("달력으로 돌아갑니다."); return }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val detail = remember(controller, photo.owner, photo.id) { RecordDetailController(controller, fromOutbox(photo), scope) }
    val playback = remember(controller, photo.owner, photo.id) {
        CommentPlaybackController(controller, DeviceCommentAudioPlayer(context), scope)
    }
    val detailState by detail.state.collectAsStateWithLifecycle()
    val playing by playback.state.collectAsStateWithLifecycle()
    LaunchedEffect(detail) { detail.refresh() }
    LaunchedEffect(detailState.media) { playback.clearErrors() }
    DisposableEffect(detail, playback) { onDispose { detail.close(); playback.close() } }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { playback.stop() }
    val action = actionStates[actions.stateKey(photo)] ?: RecordActionState()
    val availability = photoActions(photo, children, busyIds, field.offline, action.busy)
    PhotoDetailContent(photo, children, availability, field.offline, windowWidthDp >= 1000, action.error,
        onBack = onBack, onEditor = onEditor, onInput = onInput, onDelete = { actions.discard(photo) },
        media = detailState.media, serverLoading = detailState.loading, serverError = detailState.error,
        onRefresh = if (photo.receipt != null) (detail::refresh) else null,
        preview = { AnnotatedPhotoPreview(controller, detailState.media, children, Modifier.fillMaxSize()) },
        commentContent = { comment -> ServerCommentCard(comment, playing.activeId == comment.id,
            playing.activeId == comment.id && playing.loading, playing.errors[comment.id], { playback.toggle(comment) }) },
        attachment = { child -> Attachment(controller.local, child,
            onDelete = if (!availability.processing && canDiscard(child)) ({ actions.discard(photo, child.id) }) else null) })
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PhotoDetailContent(
    photo: OutboxEntry, attachments: List<OutboxEntry>, availability: PhotoActionAvailability = photoActions(photo, attachments, emptySet(), false),
    offline: Boolean = false, wide: Boolean = false, error: String? = null,
    onBack: () -> Unit = {}, onEditor: () -> Unit = {}, onInput: () -> Unit = {}, onDelete: () -> Unit = {},
    preview: @Composable () -> Unit = { ImagePlaceholder(Modifier.fillMaxSize()) },
    attachment: @Composable (OutboxEntry) -> Unit = { Text("${it.kindLabel} · ${it.statusLabel}") },
    media: CalendarMedia = fromOutbox(photo), serverLoading: Boolean = false, serverError: String? = null,
    onRefresh: (() -> Unit)? = null,
    commentContent: @Composable (MediaComment) -> Unit = { ServerCommentCard(it) },
) {
    val combined = RecordAttachments(media, attachments)
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    var showOcr by rememberSaveable { mutableStateOf(false) }
    val scroll = rememberScrollState()
    val detailContent: @Composable ColumnScope.() -> Unit = {
        StateLabel(photo.phase.visualState(), photo.statusLabel, Modifier.testTag("photo-bundle-status"))
        Text("사진 상세를 닫으면 저장한 기록이 자동으로 전송됩니다.")
        if (photo.phase == OutboxPhase.completed) Text("서버 원본은 보존되며 새 주석·메모·음성만 추가됩니다.")
        if (availability.processing) LinearProgressIndicator(Modifier.fillMaxWidth())
        photo.message?.let { Text(it) }
        error?.let { Text(it) }
        if (offline) StateLabel(StateKind.offline, "오프라인입니다. 연결 후 전송할 수 있습니다.")
        if (availability.uncertain) Text("전송 이력 탭에서 서버 반영 여부를 조회하거나 미등록 확인 후 재시도해 주세요.")
        if (availability.reauthenticate) Text("작성 계정으로 다시 로그인한 뒤 전송 이력 탭에서 재개해 주세요.")
        Spacer(Modifier.height(16.dp))
        Text("${captureRecordedTime(media.captured_at)} · ${photo.siteName}")
        media.road_address?.let { Text(it) }
        if (media.latitude != null && media.longitude != null) Text("${media.latitude}, ${media.longitude}")
        ActionIconButton(R.drawable.ic_scan, if (showOcr) "원문 OCR 접기" else "원문 OCR 보기", { showOcr = !showOcr }, Modifier.testTag("photo-ocr-toggle"), size = 56.dp)
        if (showOcr) SelectionContainer { Text(media.ocr_text ?: "OCR 원문 없음", Modifier.padding(16.dp)) }
        Spacer(Modifier.height(16.dp))
        if (serverLoading) LinearProgressIndicator(Modifier.fillMaxWidth().testTag("photo-detail-loading"))
        serverError?.let { Text(it, Modifier.testTag("photo-detail-load-error")); Text("이전에 받은 기록을 표시합니다.") }
        if (onRefresh != null) ActionIconButton(R.drawable.ic_refresh, "기록 새로고침", onRefresh, Modifier.testTag("photo-detail-refresh"), enabled = !serverLoading, size = 56.dp)
        Text(combined.counts, Modifier.testTag("photo-attachment-counts"), style = MaterialTheme.typography.titleLarge)
        if (combined.inkCountUnverified) Text("서버가 최신 주석본만 제공하여 같은 날의 전체 주석 수는 미확인입니다.")
        combined.comments.forEach { comment -> key(comment.id) { commentContent(comment) } }
        combined.local.forEach { child -> key(child.id) { attachment(child) } }
    }
    Scaffold(containerColor = Color.Transparent, contentWindowInsets = WindowInsets(0, 0, 0, 0), topBar = {
        TopAppBar(title = { Text(media.title ?: "현장 사진") }, expandedHeight = vgToolbarHeight(LocalDensity.current.fontScale),
            windowInsets = WindowInsets(0, 0, 0, 0), navigationIcon = { VgBackButton(Modifier.testTag("photo-back"), onClick = onBack) })
    }, bottomBar = {
        ActionDock {
            FlowRow(Modifier.fillMaxWidth().testTag("photo-detail-actions"), horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                ActionIconButton(R.drawable.ic_record, "주석 그리기", onEditor, Modifier.testTag("photo-open-editor"), enabled = availability.editable)
                ActionIconButton(R.drawable.ic_note, "메모·음성 붙이기", onInput, Modifier.testTag("photo-open-input"), enabled = availability.editable)
                ActionIconButton(R.drawable.ic_trash, "사진 삭제", { confirmDelete = true }, Modifier.testTag("delete-bundle"), enabled = availability.deletable)
            }
        }
    }) { padding ->
        if (wide) Row(Modifier.fillMaxSize().padding(padding).padding(20.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            Box(Modifier.weight(1f).fillMaxHeight()) { preview() }
            Column(Modifier.weight(1f).fillMaxHeight().testTag("photo-detail-pane").verticalScroll(scroll),
                verticalArrangement = Arrangement.spacedBy(8.dp), content = detailContent)
        } else Column(Modifier.fillMaxSize().padding(padding).verticalScroll(scroll).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.fillMaxWidth().height(360.dp)) { preview() }
            Spacer(Modifier.height(20.dp))
            detailContent()
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("이 사진을 삭제할까요?") },
        text = { Text(if (photo.phase == OutboxPhase.completed) "서버 사진과 딸린 기록을 삭제합니다. 삭제 가능 여부는 서버에서 확인합니다."
            else "기기에 보관한 사진과 딸린 주석·메모·음성을 함께 삭제합니다.") },
        dismissButton = { TextButton({ confirmDelete = false }) { Text("취소") } },
        confirmButton = { Button({ confirmDelete = false; onDelete() }, Modifier.testTag("confirm-delete-bundle")) { Text("삭제") } })
}

@Composable
fun ServerCommentCard(comment: MediaComment, active: Boolean = false, loading: Boolean = false,
    playbackError: String? = null, onPlay: (() -> Unit)? = null) {
    GlassCard(Modifier.fillMaxWidth().testTag("server-comment-${comment.id}")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${comment.author_name ?: comment.author_id ?: "작성자 미제공"} · ${comment.created_at?.let { captureRecordedTime(it) } ?: "시각 미기록"}")
            if (comment.isVoice) {
                Text("음성 · ${comment.audio_ms?.takeIf { it >= 0 }?.let(::voiceTime) ?: "길이 미확인"}")
                val reason = playbackError ?: if (calendarVoiceUrl(comment) == null) voiceUrlUnavailable else null
                ActionIconButton(if (loading || active) R.drawable.ic_stop else R.drawable.ic_play,
                    if (loading) "불러오기 취소" else if (active) "재생 정지" else "음성 재생", { onPlay?.invoke() },
                    Modifier.testTag("server-voice-play-${comment.id}"),
                    enabled = onPlay != null && calendarVoiceUrl(comment) != null && playbackError != auxiliaryAccessDenied, size = 56.dp)
                reason?.let { Text(it, Modifier.testTag("server-voice-error-${comment.id}")) }
            } else {
                Text("메모")
                SelectionContainer { Text(comment.body) }
            }
        }
    }
}

@Composable
private fun AnnotatedPhotoPreview(controller: FieldController, media: CalendarMedia, children: List<OutboxEntry>, modifier: Modifier) {
    val combined = RecordAttachments(media, children)
    var showInk by rememberSaveable(media.id) { mutableStateOf(false) }
    val localInk = combined.localInk.lastOrNull { it.phase != OutboxPhase.completed }
        ?: combined.localInk.lastOrNull { it.receipt?.get("id") == combined.latestAnnotationId }
        ?: if (combined.latestAnnotationId == null) combined.localInk.lastOrNull() else null
    val inkId = combined.latestAnnotationId ?: localInk?.receipt?.get("id") as? String
    Column(modifier) {
        if (localInk != null || inkId != null) Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("주석본 보기", Modifier.weight(1f))
            Switch(showInk, { showInk = it }, Modifier.testTag("photo-annotation-toggle"))
        }
        if (showInk && (localInk != null || inkId != null)) key(media.id, inkId, localInk?.id) {
            var error by remember { mutableStateOf<String?>(null) }
            var loaded by remember { mutableStateOf(false) }
            val bitmap by produceState<ImageBitmap?>(null, controller, inkId, localInk?.id) {
                try {
                    val preview = localInk?.let { controller.local.readBytes(it.owner, "outbox-preview:${it.id}") }
                    if (preview != null) value = decodeImage(preview, 2400)
                    else {
                        val bytes = if (inkId != null) controller.photoBytes(CalendarMedia(mapOf("id" to inkId)))
                            else localInk?.let { controller.local.readBytes(it.owner, it.bytesKey) }
                                ?: throw ApiFailure("주석본이 기기에 없습니다")
                        // 2b 벡터 JSON과 과거 PNG/JPEG 주석본을 모두 표시한다.
                        value = decodeImage(bytes, 2400) ?: run {
                            val json = Json.decodeObject(bytes.toString(Charsets.UTF_8))
                            require((json["v"] as? Number)?.toInt() == 1) { "주석본 형식을 확인할 수 없습니다" }
                            val strokes = (json["strokes"] as? List<*>)?.map { InkStroke.fromJson(requireNotNull(it.jsonObjectOrNull())) }
                                ?: throw ApiFailure("주석본 형식을 확인할 수 없습니다")
                            val original = controller.photoBytes(media)
                            val renderer = AndroidInkRenderer()
                            decodeImage(renderer.render(original, restoreInkStrokes(strokes, renderer.dimensions(original))), 2400)
                        }
                    }
                } catch (e: CancellationException) { throw e
                } catch (e: Exception) { error = e.message ?: "주석본을 불러오지 못했습니다"
                } finally { loaded = true }
            }
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                when {
                    error != null -> Text(error!!, Modifier.testTag("photo-annotation-error"))
                    !loaded -> CircularProgressIndicator()
                    bitmap == null -> Text("주석본을 표시하지 못했습니다")
                    else -> Image(bitmap!!, "주석본", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                }
            }
        } else key(media.id) { PhotoPreview(controller, media, Modifier.fillMaxWidth().weight(1f)) }
    }
}

@Composable
private fun Attachment(store: LocalStore, item: OutboxEntry, onDelete: (() -> Unit)?) {
    val text by produceState<String?>(item.receipt?.get("body") as? String, item.owner, item.bytesKey, item.receipt) {
        if (item.kind == OutboxKind.text && value == null) try { value = store.readBytes(item.owner, item.bytesKey)?.toString(Charsets.UTF_8)
            ?: if (item.phase == OutboxPhase.completed) "서버에 저장된 메모입니다. 달력 기록을 새로 불러와 주세요." else "메모를 읽지 못했습니다"
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) { value = "메모를 읽지 못했습니다" }
    }
    GlassCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${item.kindLabel} · ${item.statusLabel}")
            item.message?.let { Text(it) }
            when (item.kind) {
                OutboxKind.ink -> StoredImage(store, item.owner, "outbox-preview:${item.id}", 720, Modifier.fillMaxWidth().height(180.dp))
                OutboxKind.text -> SelectionContainer { Text(text ?: "메모를 불러오는 중입니다") }
                OutboxKind.voice -> Text("음성 · ${voiceTime(item.fields["audioMs"]?.toIntOrNull() ?: 0)}")
                else -> Unit
            }
            ActionIconButton(R.drawable.ic_trash, "첨부 지우기", { onDelete?.invoke() }, Modifier.testTag("discard-${item.id}"), enabled = onDelete != null, size = 56.dp)
        }
    }
}

private suspend fun decodeImage(bytes: ByteArray, width: Int): ImageBitmap? = withContext(Dispatchers.IO) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= width) sample *= 2
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}
@Composable
fun ImagePlaceholder(modifier: Modifier = Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) { VgIcon(R.drawable.ic_record, "사진 미리보기") }
}
@Composable
private fun StoredImage(store: LocalStore, owner: String, storageKey: String, cacheWidth: Int, modifier: Modifier) {
    val bitmap by produceState<ImageBitmap?>(null, store, owner, storageKey) {
        try { value = store.readBytes(owner, storageKey)?.let { decodeImage(it, cacheWidth) }
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) { value = null }
    }
    if (bitmap == null) ImagePlaceholder(modifier)
    else Image(bitmap!!, "사진 미리보기", modifier, contentScale = ContentScale.Fit)
}
@Composable
fun PhotoPreview(controller: FieldController, media: CalendarMedia, modifier: Modifier, cacheWidth: Int = 2400) {
    var error by remember(media.id) { mutableStateOf<String?>(null) }
    var loaded by remember(media.id) { mutableStateOf(false) }
    val bitmap by produceState<ImageBitmap?>(null, controller, media.id) {
        try { value = decodeImage(controller.photoBytes(media), cacheWidth)
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { error = e.message ?: e.toString()
        } finally { loaded = true }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        when {
            error != null -> Text(error!!)
            !loaded -> CircularProgressIndicator()
            bitmap == null -> ImagePlaceholder(Modifier.fillMaxSize())
            else -> Image(bitmap!!, "현장 사진", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        }
    }
}
