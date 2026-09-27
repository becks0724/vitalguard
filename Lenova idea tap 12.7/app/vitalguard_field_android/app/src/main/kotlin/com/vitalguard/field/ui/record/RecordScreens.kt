package com.vitalguard.field.ui.record

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.R
import com.vitalguard.field.capture.*
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.capture.CaptureActionPanel
import com.vitalguard.field.ui.shell.ActionDock
import com.vitalguard.field.ui.theme.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Port: record_screens.dart RecordHome/PhotoDetail/_Attachment.
@Composable
fun RecordHome(controller: FieldController, outbox: OutboxController, capture: CaptureUiState,
    onScan: () -> Unit, onPhoto: () -> Unit, onOpen: (String) -> Unit, onReload: () -> Unit,
) {
    val field by controller.state.collectAsStateWithLifecycle()
    val all by outbox.items.collectAsStateWithLifecycle()
    val error by outbox.loadError.collectAsStateWithLifecycle()
    LaunchedEffect(outbox) { outbox.load() }
    RecordHomeContent(all, field.offline, error, capture, onOpen, onReload, onScan, onPhoto) { item ->
        StoredImage(controller.local, item.owner, item.bytesKey, 160, Modifier.size(72.dp))
    }
}

@Composable
fun RecordHomeContent(
    entries: List<OutboxEntry>, offline: Boolean = false, loadError: String? = null,
    capture: CaptureUiState = CaptureUiState(), onOpen: (String) -> Unit = {}, onReload: () -> Unit = {},
    onScan: () -> Unit = {}, onPhoto: () -> Unit = {},
    thumbnail: @Composable (OutboxEntry) -> Unit = { ImagePlaceholder(Modifier.size(72.dp)) },
) {
    val photos = pendingPhotos(entries)
    Scaffold(containerColor = Color.Transparent, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = { ActionDock { CaptureActionPanel(capture, onScan, onPhoto) } }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).testTag("record-pending-list"),
            state = rememberLazyListState(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("보낼 기록", style = MaterialTheme.typography.headlineMedium)
                    Text("전송이 끝난 기록은 관제웹에서 봅니다.")
                    if (offline) Text("오프라인 · 촬영한 사진과 주석·메모·음성은 기기에 보관합니다.")
                    if (loadError != null) { Text(loadError); TextButton(onReload) { Text("기록 다시 열기") } }
                }
            }
            if (photos.isEmpty() && loadError == null) item { Text("보낼 기록이 없습니다. 촬영한 사진은 여기 모입니다.") }
            items(photos, key = { it.id }) { photo ->
                Card(colors = CardDefaults.cardColors(containerColor = VgColors.canvas.copy(alpha = vgCardSurfaceAlpha)),
                    modifier = Modifier.fillMaxWidth().testTag("record-photo-${photo.id}").clickable { onOpen(photo.id) }) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) { thumbnail(photo) }
                        Column(Modifier.weight(1f)) {
                            Text(photo.fields["title"] ?: "현장 사진", style = MaterialTheme.typography.titleMedium)
                            Text(listOf(captureRecordedTime(photo.fields["capturedAt"]), photo.siteName,
                                attachmentCounts(entries.filter { it.dependsOn == photo.id }), photo.statusLabel).joinToString("\n"))
                        }
                        VgIcon(R.drawable.ic_chevron_right)
                    }
                }
            }
        }
    }
}

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
    var entered by rememberSaveable(photoId) { mutableStateOf(false) }
    val completed = photo?.phase == OutboxPhase.completed && children.all { it.phase == OutboxPhase.completed }
    LaunchedEffect(photoId) {
        if (!entered) {
            outbox.load()
            val initial = outbox.entry(photoId)
            if (initial == null || initial.kind != OutboxKind.photo || initial.phase == OutboxPhase.completed) onBack()
            else entered = true
        }
    }
    LaunchedEffect(entered, photo == null, completed) { if (entered && (photo == null || completed)) onBack() }
    if (photo == null || completed) { Text("보낼 기록 목록으로 돌아갑니다."); return }
    val action = actionStates[actions.stateKey(photo)] ?: RecordActionState()
    val availability = photoActions(photo, children, busyIds, field.offline, action.busy)
    PhotoDetailContent(photo, children, availability, field.offline, windowWidthDp >= 1000, action.error,
        onBack = onBack, onEditor = onEditor, onInput = onInput, onSend = { actions.send(photo) }, onDelete = { actions.discard(photo) },
        preview = { LocalPhotoPreview(controller, photo, Modifier.fillMaxSize()) },
        attachment = { child -> Attachment(controller.local, child,
            onDelete = if (!availability.processing && canDiscard(child)) ({ actions.discard(photo, child.id) }) else null) })
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PhotoDetailContent(
    photo: OutboxEntry, attachments: List<OutboxEntry>, availability: PhotoActionAvailability = photoActions(photo, attachments, emptySet(), false),
    offline: Boolean = false, wide: Boolean = false, error: String? = null,
    onBack: () -> Unit = {}, onEditor: () -> Unit = {}, onInput: () -> Unit = {}, onSend: () -> Unit = {}, onDelete: () -> Unit = {},
    preview: @Composable () -> Unit = { ImagePlaceholder(Modifier.fillMaxSize()) },
    attachment: @Composable (OutboxEntry) -> Unit = { Text("${it.kindLabel} · ${it.statusLabel}") },
) {
    val media = fromOutbox(photo)
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    var showOcr by rememberSaveable { mutableStateOf(false) }
    val scroll = rememberScrollState()
    val detailContent: @Composable ColumnScope.() -> Unit = {
        Text(photo.statusLabel, Modifier.testTag("photo-bundle-status"))
        if (availability.processing) LinearProgressIndicator(Modifier.fillMaxWidth())
        photo.message?.let { Text(it) }
        error?.let { Text(it) }
        if (offline) Text("오프라인입니다. 연결 후 전송할 수 있습니다.")
        if (availability.uncertain) Text("전송 상태 탭에서 서버 반영 여부를 조회하거나 미등록 확인 후 재시도해 주세요.")
        if (availability.reauthenticate) Text("작성 계정으로 다시 로그인한 뒤 전송 상태 탭에서 재개해 주세요.")
        Spacer(Modifier.height(16.dp))
        Text("${captureRecordedTime(media.captured_at)} · ${photo.siteName}")
        media.road_address?.let { Text(it) }
        if (media.latitude != null && media.longitude != null) Text("${media.latitude}, ${media.longitude}")
        TextButton({ showOcr = !showOcr }, Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("photo-ocr-toggle")) { Text("원문 OCR 보기") }
        if (showOcr) SelectionContainer { Text(media.ocr_text ?: "OCR 원문 없음", Modifier.padding(16.dp)) }
        Spacer(Modifier.height(16.dp))
        Text(attachmentCounts(attachments), style = MaterialTheme.typography.titleLarge)
        attachments.forEach { child -> key(child.id) { attachment(child) } }
    }
    Scaffold(containerColor = Color.Transparent, contentWindowInsets = WindowInsets(0, 0, 0, 0), topBar = {
        TopAppBar(title = { Text(media.title ?: "현장 사진") }, expandedHeight = vgToolbarHeight(LocalDensity.current.fontScale),
            windowInsets = WindowInsets(0, 0, 0, 0), navigationIcon = { VgIconButton(R.drawable.ic_back, "기록으로", onClick = onBack) })
    }, bottomBar = {
        ActionDock {
            FlowRow(Modifier.fillMaxWidth().testTag("photo-detail-actions"), horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedButton(onEditor, Modifier.sizeIn(minWidth = 160.dp, minHeight = 64.dp).testTag("photo-open-editor"), enabled = availability.editable) { Text("주석 그리기") }
                OutlinedButton(onInput, Modifier.sizeIn(minWidth = 160.dp, minHeight = 64.dp).testTag("photo-open-input"), enabled = availability.editable) { Text("메모·음성 붙이기") }
                Button(onSend, Modifier.sizeIn(minWidth = 160.dp, minHeight = 64.dp).testTag("send-bundle"), enabled = availability.sendable) { Text("전송") }
                OutlinedButton({ confirmDelete = true }, Modifier.sizeIn(minWidth = 160.dp, minHeight = 64.dp).testTag("delete-bundle"),
                    enabled = availability.deletable) { Text("삭제") }
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
        text = { Text("기기에 보관한 사진과 딸린 주석·메모·음성을 함께 삭제합니다.") },
        dismissButton = { TextButton({ confirmDelete = false }) { Text("취소") } },
        confirmButton = { Button({ confirmDelete = false; onDelete() }, Modifier.testTag("confirm-delete-bundle")) { Text("삭제") } })
}

@Composable
private fun Attachment(store: LocalStore, item: OutboxEntry, onDelete: (() -> Unit)?) {
    val text by produceState<String?>(null, item.owner, item.bytesKey) {
        if (item.kind == OutboxKind.text) try { value = store.readBytes(item.owner, item.bytesKey)?.toString(Charsets.UTF_8)
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) { value = "메모를 읽지 못했습니다" }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${item.kindLabel} · ${item.statusLabel}")
            item.message?.let { Text(it) }
            when (item.kind) {
                OutboxKind.ink -> StoredImage(store, item.owner, "outbox-preview:${item.id}", 720, Modifier.fillMaxWidth().height(180.dp))
                OutboxKind.text -> SelectionContainer { Text(text ?: "메모를 불러오는 중입니다") }
                OutboxKind.voice -> Text("음성 · ${voiceTime(item.fields["audioMs"]?.toIntOrNull() ?: 0)}")
                else -> Unit
            }
            TextButton({ onDelete?.invoke() }, Modifier.align(Alignment.End).testTag("discard-${item.id}"), enabled = onDelete != null) { Text("지우기") }
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
private fun LocalPhotoPreview(controller: FieldController, photo: OutboxEntry, modifier: Modifier) {
    var error by remember(photo.id) { mutableStateOf<String?>(null) }
    var loaded by remember(photo.id) { mutableStateOf(false) }
    val bitmap by produceState<ImageBitmap?>(null, controller, photo.owner, photo.id) {
        try { value = decodeImage(controller.photoBytes(fromOutbox(photo)), 2400)
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
