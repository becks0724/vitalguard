package com.vitalguard.field.data.record

import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlin.math.*

data class InkEditorState(
    val loading: Boolean = true, val busy: Boolean = false, val error: String? = null,
    val strokes: List<InkStroke> = emptyList(), val visibleStrokes: List<InkStroke> = emptyList(), val activeCount: Int = 0,
    val tool: InkTool = InkTool.pen, val widthMultiplier: Double = 1.0, val color: Long = 0xFFDC2626,
    val zoom: Double = 1.0, val pan: InkOffset = InkOffset(), val originalOnly: Boolean = false, val fitWidth: Boolean = false,
    val imageSize: InkSize? = null, val dirty: Boolean = false, val revision: Int = 0,
    val operationId: String? = null, val undoAvailable: Boolean = false,
) {
    val untouched get() = strokes.isEmpty() && !dirty
    val canSave get() = !loading && !busy && activeCount == 0 && imageSize != null && !untouched
}

// ViewModel 소유, Android/Compose와 독립. 화면 제거 뒤에도 이미 받은 점의 쓰기를 끝낸다.
class InkEditorController(
    private val field: FieldController, private val queue: OutboxController, val origin: CalendarMedia,
    val owner: String, private val renderer: InkRenderer, private val scope: CoroutineScope,
) : AutoCloseable {
    private var closed = false
    private val mutable = MutableStateFlow(InkEditorState())
    val state = mutable.asStateFlow()
    private val s get() = mutable.value
    private val writes = DraftWrites(scope)
    private val session = RecordSession(field, queue, owner)
    val draftKey = "annotation:${origin.id}"
    var baseBytes: ByteArray? = null; private set
    private var draftSiteName = field.state.value.site?.site_name ?: "현장 정보 없음"
    private val active = linkedMapOf<Long, InkStroke>()
    private val history = mutableListOf<List<InkStroke>>()
    private val touches = linkedMapOf<Long, InkOffset>()
    private val ignoredTouches = mutableSetOf<Long>()
    private var spanPerZoom: Double? = null
    private var viewport = InkSize(0.0, 0.0)
    private var density = 1.0
    private fun update(block: (InkEditorState) -> InkEditorState) { mutable.value = block(s) }
    private fun publish() {
        val visible = (s.strokes + active.values.filter { it.tool != InkTool.eraser }).toMutableList()
        s.imageSize?.let { size -> active.values.filter { it.tool == InkTool.eraser }.forEach { eraseInkStrokes(visible, it, size) } }
        update { it.copy(visibleStrokes = visible.toList(), activeCount = active.size, undoAvailable = history.isNotEmpty() || it.strokes.isNotEmpty()) }
    }
    suspend fun load() {
        require(origin.json["local"] == true) { "로컬 사진만 편집할 수 있습니다" }
        update { it.copy(loading = true, error = null) }
        try {
            requireEditablePhoto(queue, origin.id, owner)
            val data = field.local.read(owner, draftKey)?.let(Json::decodeObject)
            val saved = (data?.get("strokes") as? List<*>).orEmpty().map { InkStroke.fromJson(requireNotNull(it.jsonObjectOrNull())) }
            val bytes = field.photoBytes(origin)
            val size = renderer.dimensions(bytes)
            if (closed) return
            baseBytes = bytes
            draftSiteName = if (data != null) data["siteName"] as? String ?: "작성 현장명 미기록" else draftSiteName
            history.clear()
            val migrated = saved.any { it.tool == InkTool.eraser }
            update { it.copy(loading = false, imageSize = size, strokes = restoreInkStrokes(saved, size),
                operationId = data?.get("clientOperationId") as? String, dirty = data?.get("dirty") == true || migrated,
                revision = ((data?.get("revision") as? Number)?.toInt() ?: 0) + if (migrated) 1 else 0) }
            publish()
            persist().await()
            if (!closed && queue.account == owner) session.remember(origin, ink = true)
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(loading = false, error = "원본 또는 작업본을 열지 못했습니다: ${e.message}") } }
    }
    fun persist(): Deferred<Unit> {
        if (closed || baseBytes == null || s.imageSize == null) return CompletableDeferred(Unit)
        val pending = active.values.filter { it.tool != InkTool.eraser }
        val snapshot = Json.encode(linkedMapOf("origin" to origin.json + mapOf("media_url" to null, "thumbnail_url" to null),
            "strokes" to (s.strokes + pending).map { it.toJson() }, "status" to "draft", "schemaVersion" to 1,
            "clientOperationId" to s.operationId, "siteName" to draftSiteName, "dirty" to (s.dirty || pending.isNotEmpty()),
            "revision" to s.revision + pending.size))
        return writes.submit { field.local.write(owner, draftKey, snapshot) }
    }
    private fun autosave() {
        val pending = persist()
        scope.launch { try { pending.await() } catch (e: CancellationException) { throw e
        } catch (_: Exception) { update { it.copy(error = "기기 저장에 실패했습니다. 화면을 닫기 전에 다시 저장해 주세요.") } } }
    }
    fun selectTool(tool: InkTool) { if (!s.busy && active.isEmpty()) update { it.copy(tool = tool) } }
    fun selectWidth(width: Double) { if (!s.busy && active.isEmpty()) update { it.copy(widthMultiplier = width) } }
    fun selectColor(color: Long) { if (!s.busy && active.isEmpty()) update { it.copy(color = color) } }
    fun toggleOriginal() { if (!s.busy && active.isEmpty()) update { it.copy(originalOnly = !it.originalOnly) } }
    fun toggleFit() { if (!s.busy && active.isEmpty()) { clearTouches(); update { it.copy(fitWidth = !it.fitWidth, zoom = 1.0, pan = InkOffset()) } } }
    fun rectFor(size: InkSize = viewport): InkRect {
        val image = s.imageSize ?: return InkRect(0.0, 0.0, 0.0, 0.0)
        val scale = if (s.fitWidth) size.width / image.width else min(size.width / image.width, size.height / image.height)
        val width = image.width * scale * s.zoom; val height = image.height * scale * s.zoom
        return InkRect((size.width - width) / 2 + s.pan.x, (size.height - height) / 2 + s.pan.y, width, height)
    }
    fun viewport(size: InkSize, density: Double) {
        if (viewport != size || this.density != density) { finishActive(); clearTouches(); viewport = size; this.density = density; autosave() }
    }
    fun penDown(id: Long, position: InkOffset, pressure: Double) {
        if (closed || s.busy || s.loading || s.originalOnly) return
        val rect = rectFor(); val point = rect.point(position, pressure) ?: return
        ignoredTouches += touches.keys; clearTouches()
        val width = when (s.tool) { InkTool.eraser -> 28; InkTool.marker -> 18; else -> 4 }
        active[id] = InkStroke(s.tool, s.color, width * density * s.widthMultiplier / rect.width, listOf(point))
        publish(); autosave()
    }
    fun penMove(id: Long, position: InkOffset, pressure: Double) {
        val stroke = active[id] ?: return
        val rect = rectFor(); val point = rect.point(position, pressure) ?: return
        val last = stroke.points.last()
        if (((point.x - last.x) * rect.width).pow(2) + ((point.y - last.y) * rect.height).pow(2) < 1.0) return
        active[id] = stroke.copy(points = stroke.points + point); publish(); autosave()
    }
    fun penUp(id: Long) { finishPointer(id, cancelled = false); autosave() }
    fun penCancel(id: Long) { finishPointer(id, cancelled = true); autosave() }
    private fun finishPointer(id: Long, cancelled: Boolean) {
        val stroke = active.remove(id) ?: return
        if (!cancelled) {
            val before = s.strokes
            val next = before.toMutableList()
            val changed = if (stroke.tool == InkTool.eraser) eraseInkStrokes(next, stroke, requireNotNull(s.imageSize)) else { next.add(stroke); true }
            if (changed) { history.add(before); update { it.copy(strokes = next.toList(), dirty = true, revision = it.revision + 1) } }
        }
        publish()
    }
    // ACTION_CANCEL / FLAG_CANCELED: 그리기/지우개 모두 폐기하고 즉시 초안을 덮어쓴다.
    fun cancelPointers() { active.keys.toList().forEach { finishPointer(it, true) }; clearTouches(); ignoredTouches.clear(); autosave() }
    fun cancelPen() { active.keys.toList().forEach { finishPointer(it, true) }; autosave() }
    // 회전/백그라운드: 받은 잉크만 확정, 미확정 지우개는 원본처럼 폐기한다.
    fun finishActive() { active.keys.toList().forEach { finishPointer(it, active[it]?.tool == InkTool.eraser) } }
    suspend fun flush() { finishActive(); clearTouches(); persist().await() }
    private fun clearTouches() { touches.clear(); spanPerZoom = null }
    private fun rebase() {
        val p = touches.values.toList()
        val span = if (p.size == 2) sqrt((p.last() - p.first()).squared) else 0.0
        spanPerZoom = if (span > 0) span / s.zoom else null
    }
    fun touchDown(id: Long, position: InkOffset) {
        if (active.isNotEmpty()) { ignoredTouches += id; return }
        if (s.busy || id in ignoredTouches || touches.size >= 2) return
        touches[id] = position; rebase()
    }
    fun touchMove(id: Long, position: InkOffset) {
        if (id !in touches) return
        if (active.isNotEmpty() || s.busy) { ignoredTouches += touches.keys; clearTouches(); return }
        val before = touches.values.toList(); touches[id] = position; val after = touches.values.toList()
        val previousFocal = (before.first() + before.last()) * .5; val focal = (after.first() + after.last()) * .5
        val zoom = spanPerZoom?.let { (sqrt((after.last() - after.first()).squared) / it).coerceIn(1.0, 4.0) } ?: s.zoom
        val center = InkOffset(viewport.width / 2, viewport.height / 2)
        update { it.copy(pan = focal + (center + it.pan - previousFocal) * (zoom / it.zoom) - center, zoom = zoom) }
        if (spanPerZoom == null) rebase()
    }
    fun touchEnd(id: Long) { ignoredTouches.remove(id); if (touches.remove(id) != null) rebase() }
    fun undo() {
        if (s.busy || active.isNotEmpty() || !s.undoAvailable) return
        val next = if (history.isNotEmpty()) history.removeAt(history.lastIndex) else s.strokes.dropLast(1)
        update { it.copy(strokes = next, dirty = true, revision = it.revision + 1) }; publish(); autosave()
    }
    fun clearAll() {
        if (s.busy || active.isNotEmpty() || s.strokes.isEmpty()) return
        history.clear(); update { it.copy(strokes = emptyList(), dirty = true, revision = it.revision + 1) }; publish(); autosave()
    }
    suspend fun leave(): Boolean = try { flush(); session.close(); true } catch (e: CancellationException) { throw e
    } catch (_: Exception) { update { it.copy(error = "초안을 저장하지 못했습니다. 저장 공간을 확인해 주세요.") }; false }
    override fun close() { closed = true; active.clear(); clearTouches(); ignoredTouches.clear() }
    suspend fun save(): Boolean {
        if (closed || !s.canSave) return false
        update { it.copy(busy = true, error = null) }
        try {
            val photo = requireEditablePhoto(queue, origin.id, owner)
            fun previous(): List<OutboxEntry> = queue.dependents(origin.id).filter { it.kind == OutboxKind.ink }.also { items ->
                if (items.any { it.needsVerification || queue.isBusy(it) || it.phase !in setOf(OutboxPhase.waiting, OutboxPhase.failed) })
                    throw ApiFailure("이전 주석의 전송 상태를 먼저 확인해 주세요. 전송 중·결과 불명·완료 주석은 바꿀 수 없습니다.")
            }
            previous(); persist().await()
            val bytes = encodeInk(s.strokes)
            inkUploadSizeError(bytes.size)?.let { throw ApiFailure(it) }
            val png = renderer.render(requireNotNull(baseBytes), s.strokes)
            requireEditablePhoto(queue, origin.id, owner)
            try {
                previous().forEach { queue.discard(it.id) }
                val item = queue.enqueue(OutboxKind.ink, bytes, origin.site_id?.let { mapOf("siteId" to it) }.orEmpty(),
                    photo.siteName, owner, sourceKey = "$draftKey:${s.revision}", annotationDraftId = origin.id,
                    dependsOn = origin.id, draftKeys = listOf(draftKey), previewBytes = png)
                update { it.copy(operationId = item.id, dirty = false) }
            } finally { persist().await() } // 이전 리비전 discard가 지운 현재 초안을 실패 시에도 복원.
            session.close(); return true
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(error = "주석을 저장하지 못했습니다: ${e.message}") }; return false
        } finally { update { it.copy(busy = false) } }
    }
}
