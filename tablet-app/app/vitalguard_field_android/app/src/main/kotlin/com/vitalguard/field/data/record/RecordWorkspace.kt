package com.vitalguard.field.data.record

import com.vitalguard.field.data.OutboxController
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// ViewModel 수명으로 화면 컨트롤러/복구 요청을 소유한다. NavHost 재생성은 초안을 다시 읽지 않는다.
class RecordWorkspace(
    private val field: FieldController, private val queue: OutboxController,
    private val renderer: InkRenderer, private val speech: SpeechInput, private val recorder: VoiceRecorder,
    private val scope: CoroutineScope, private val message: (String) -> Unit,
) : AutoCloseable {
    var editor: InkEditorController? = null; private set
    var input: RecordInputController? = null; private set
    private val mutableRecovery = MutableStateFlow<RecordRecovery?>(null)
    val recovery = mutableRecovery.asStateFlow()
    private val mutableDetail = MutableStateFlow<String?>(null)
    val detail = mutableDetail.asStateFlow()
    private val mutableClosed = MutableStateFlow(0L)
    val closedDetail = mutableClosed.asStateFlow()
    private var batch = emptyList<String>()
    private val closing = Mutex()
    private var owner: String? = null
    private var epoch = 0
    private var restored = false
    private val loading = mutableListOf<Job>()
    fun bindAccount(value: String?) {
        if (owner == value) return
        ++epoch; owner = value; restored = false
        loading.forEach { it.cancel() }; loading.clear()
        input?.close(); input = null; editor?.close(); editor = null; mutableRecovery.value = null
        mutableDetail.value = null; batch = emptyList()
    }
    fun openDetail(id: String, batchIds: List<String> = listOf(id)) {
        mutableDetail.value = id; batch = batchIds
        batchIds.forEach(queue::beginReview)
    }
    suspend fun closeDetail() = closing.withLock {
        val id = mutableDetail.value ?: return@withLock
        val account = owner ?: return@withLock
        flush()
        if (account != owner || id != mutableDetail.value) return@withLock
        val sending = batch.toList()
        // 로컬 저장만 기다린다. 서버 응답을 기다리며 상세/탭을 붙잡지 않는다.
        sending.forEach { queue.readyBundle(it) }
        forget(id); RecordSession(field, queue, account).close()
        mutableDetail.value = null; batch = emptyList(); mutableClosed.value++
        launch { if (queue.account == account) sending.forEach { queue.sendBundle(it, automatic = true) } }
    }
    suspend fun restoreSession(): Boolean {
        val account = owner ?: return false
        if (restored) return false
        restored = true
        val expected = epoch
        try {
            val saved = RecordSession(field, queue, account).read()
            if (expected != epoch) return false
            mutableRecovery.value = saved
            return saved != null
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) {
            if (expected == epoch) message("작성하던 기록을 열지 못했습니다. 같은 사진에서 초안을 다시 열어 주세요.")
            return false
        }
    }
    fun consumeRecovery(value: RecordRecovery) { if (mutableRecovery.value == value) mutableRecovery.value = null }
    fun editor(id: String): InkEditorController {
        editor?.takeIf { it.origin.id == id && it.owner == owner }?.let { return it }
        check(editor == null) { "작성 중인 주석을 먼저 보관해 주세요" }
        val account = requireNotNull(owner)
        val media = fromOutbox(requireNotNull(queue.entry(id)))
        return InkEditorController(field, queue, media, account, renderer, scope).also {
            editor = it; loading += scope.launch { it.load() }
        }
    }
    fun input(id: String): RecordInputController {
        input?.takeIf { it.media.id == id && it.owner == owner }?.let { return it }
        check(input == null) { "작성 중인 메모를 먼저 보관해 주세요" }
        val account = requireNotNull(owner)
        val media = fromOutbox(requireNotNull(queue.entry(id)))
        return RecordInputController(field, queue, media, account, speech, recorder, scope).also {
            input = it; loading += scope.launch { it.restore() }
        }
    }
    suspend fun finishEditor(value: InkEditorController) {
        if (editor !== value) return
        editor = null; value.close()
        input?.remember() // 입력 화면에서 편집기를 열었으면 원래 R-06 세션으로 돌아간다.
    }
    fun finishInput(value: RecordInputController) { if (input === value) { input = null; value.close() } }
    fun pruneFinished() {
        if (queue.account != owner) return
        listOfNotNull(editor?.origin?.id, input?.media?.id).distinct().forEach { id ->
            val photo = queue.entry(id)
            if (photo == null) forget(id)
        }
    }
    fun forget(id: String) {
        if (editor?.origin?.id == id) { editor?.close(); editor = null }
        if (input?.media?.id == id) { input?.close(); input = null }
    }
    suspend fun flush() = supervisorScope {
        val ink = editor; val note = input
        val tasks = listOf(
            async { ink?.state?.first { !it.busy }; ink?.flush(); Unit },
            async { note?.state?.first { !it.saving }; note?.flush(); Unit },
        )
        var failure: Exception? = null
        tasks.forEach { try { it.await() } catch (e: CancellationException) { throw e
            } catch (e: Exception) { if (failure == null) failure = e } }
        failure?.let { throw it }
    }
    fun inactive() {
        editor?.finishActive()
        val ink = editor?.persist(); val note = input?.persist()
        launch { ink?.await(); note?.await() }
    }
    fun background() = launch { if (mutableDetail.value != null) closeDetail() else flush() }
    fun launch(action: suspend () -> Unit) {
        scope.launch {
            try { action() } catch (e: CancellationException) { throw e
            } catch (_: Exception) { message("초안 보존 상태를 확인해 주세요") }
        }
    }
    override fun close() { loading.forEach { it.cancel() }; loading.clear(); editor?.close(); input?.close(); speech.close(); recorder.close() }
}
