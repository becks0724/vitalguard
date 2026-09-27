package com.vitalguard.field.ui.record

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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.R
import com.vitalguard.field.capture.*
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
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
    val action = actionStates[actions.stateKey(photo)] ?: RecordActionState()
    val availability = photoActions(photo, children, busyIds, field.offline, action.busy)
    PhotoDetailContent(photo, children, availability, field.offline, windowWidthDp >= 1000, action.error,
        onBack = onBack, onEditor = onEditor, onInput = onInput, onDelete = { actions.discard(photo) },
        preview = { PhotoPreview(controller, fromOutbox(photo), Modifier.fillMaxSize()) },
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
) {
    val media = fromOutbox(photo)
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    var showOcr by rememberSaveable { mutableStateOf(false) }
    val scroll = rememberScrollState()
    val detailContent: @Composable ColumnScope.() -> Unit = {
        Text(photo.statusLabel, Modifier.testTag("photo-bundle-status"))
        Text("사진 상세를 닫으면 저장한 기록이 자동으로 전송됩니다.")
        if (photo.phase == OutboxPhase.completed) Text("서버 원본은 보존되며 새 주석·메모·음성만 추가됩니다.")
        if (availability.processing) LinearProgressIndicator(Modifier.fillMaxWidth())
        photo.message?.let { Text(it) }
        error?.let { Text(it) }
        if (offline) Text("오프라인입니다. 연결 후 전송할 수 있습니다.")
        if (availability.uncertain) Text("전송 이력 탭에서 서버 반영 여부를 조회하거나 미등록 확인 후 재시도해 주세요.")
        if (availability.reauthenticate) Text("작성 계정으로 다시 로그인한 뒤 전송 이력 탭에서 재개해 주세요.")
        Spacer(Modifier.height(16.dp))
        Text("${captureRecordedTime(media.captured_at)} · ${photo.siteName}")
        media.road_address?.let { Text(it) }
        if (media.latitude != null && media.longitude != null) Text("${media.latitude}, ${media.longitude}")
        TextButton({ showOcr = !showOcr }, Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("photo-ocr-toggle")) { Text("원문 OCR 보기") }
        if (showOcr) SelectionContainer { Text(media.ocr_text ?: "OCR 원문 없음", Modifier.padding(16.dp)) }
        Spacer(Modifier.height(16.dp))
        Text(attachmentCounts(attachments), style = MaterialTheme.typography.titleLarge)
        media.comments.forEach { comment ->
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) {
                Text("${comment.author_name ?: comment.author_id ?: "작성자 미제공"} · ${comment.created_at.orEmpty()}")
                if (comment.audio_ms != null || comment.audio_storage_key != null || comment.audio_url != null) Text("음성 · ${voiceTime(comment.audio_ms ?: 0)}")
                else SelectionContainer { Text(comment.body) }
            } }
        }
        attachments.filter { child -> media.comments.none { it.id == child.receipt?.get("id") } }
            .forEach { child -> key(child.id) { attachment(child) } }
    }
    Scaffold(containerColor = Color.Transparent, contentWindowInsets = WindowInsets(0, 0, 0, 0), topBar = {
        TopAppBar(title = { Text(media.title ?: "현장 사진") }, expandedHeight = vgToolbarHeight(LocalDensity.current.fontScale),
            windowInsets = WindowInsets(0, 0, 0, 0), navigationIcon = { VgIconButton(R.drawable.ic_back, "달력으로", onClick = onBack) })
    }, bottomBar = {
        ActionDock {
            FlowRow(Modifier.fillMaxWidth().testTag("photo-detail-actions"), horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedButton(onEditor, Modifier.sizeIn(minWidth = 160.dp, minHeight = 64.dp).testTag("photo-open-editor"), enabled = availability.editable) { Text("주석 그리기") }
                OutlinedButton(onInput, Modifier.sizeIn(minWidth = 160.dp, minHeight = 64.dp).testTag("photo-open-input"), enabled = availability.editable) { Text("메모·음성 붙이기") }
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
        text = { Text(if (photo.phase == OutboxPhase.completed) "서버 사진과 딸린 기록을 삭제합니다. 삭제 가능 여부는 서버에서 확인합니다."
            else "기기에 보관한 사진과 딸린 주석·메모·음성을 함께 삭제합니다.") },
        dismissButton = { TextButton({ confirmDelete = false }) { Text("취소") } },
        confirmButton = { Button({ confirmDelete = false; onDelete() }, Modifier.testTag("confirm-delete-bundle")) { Text("삭제") } })
}

@Composable
private fun Attachment(store: LocalStore, item: OutboxEntry, onDelete: (() -> Unit)?) {
    val text by produceState<String?>(item.receipt?.get("body") as? String, item.owner, item.bytesKey, item.receipt) {
        if (item.kind == OutboxKind.text && value == null) try { value = store.readBytes(item.owner, item.bytesKey)?.toString(Charsets.UTF_8)
            ?: if (item.phase == OutboxPhase.completed) "서버에 저장된 메모입니다. 달력 기록을 새로 불러와 주세요." else "메모를 읽지 못했습니다"
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
