package com.vitalguard.field.ui.outbox

import com.vitalguard.field.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

fun historyEntries(items: List<OutboxEntry>) = items.filter { !it.serverReference && it.phase != OutboxPhase.waiting }
fun historyPhase(item: OutboxEntry) = if (item.phase == OutboxPhase.reauthenticate) OutboxPhase.failed else item.phase

// 전송 이력 진입은 결과 불명 조회만 담당한다. 자동 쓰기는 기록 닫힘/네트워크 복귀가 담당한다.
class OutboxUiController(val queue: OutboxController, private val scope: CoroutineScope) : AutoCloseable {
    private var foreground = false
    private var visible = false
    private var generation = 0
    private var closed = false
    private val mutableLookupEnabled = MutableStateFlow(false)
    val lookupEnabled = mutableLookupEnabled.asStateFlow()
    private val mutableError = MutableStateFlow<String?>(null)
    val error = mutableError.asStateFlow()
    val canLookup get() = !closed && visible && foreground && queue.account != null
    private val accountObserver = scope.launch {
        queue.field.state.map { queue.account }.distinctUntilChanged().collect {
            generation++
            mutableLookupEnabled.value = canLookup
            mutableError.value = null
            loadAndCheck()
        }
    }
    fun setVisible(value: Boolean) {
        if (visible == value) return
        visible = value; generation++; mutableLookupEnabled.value = canLookup
        if (canLookup) loadAndCheck()
    }
    fun setForeground(value: Boolean) {
        if (foreground == value) return
        foreground = value; generation++; mutableLookupEnabled.value = canLookup
        if (value) run { queue.purgeExpired() }
        if (canLookup) loadAndCheck()
    }
    fun run(action: suspend () -> Unit) {
        val owner = queue.account
        scope.launch {
            mutableError.value = null
            try { action()
            } catch (e: CancellationException) { throw e
            } catch (_: Exception) {
                if (owner == queue.account) mutableError.value = "처리를 완료하지 못했습니다. 기기 저장 상태와 서버 반영 여부를 확인해 주세요."
            }
        }
    }
    fun loadAndCheck() {
        val expected = generation
        run {
            queue.load()
            if (!canLookup || expected != generation || queue.loadError.value != null) return@run
            queue.verifyUncertain(automatic = true) { canLookup && expected == generation }
            queue.clearCompletedDrafts()
        }
    }
    fun verify(item: OutboxEntry? = null) {
        val expected = generation
        run {
            if (item == null) queue.verifyUncertain { canLookup && expected == generation }
            else queue.verify(item) { canLookup && expected == generation }
            queue.clearCompletedDrafts()
        }
    }
    fun send(item: OutboxEntry, confirmAbsent: Boolean = false) = run {
        if (queue.field.state.value.offline) return@run
        if (confirmAbsent) queue.confirmAbsent(item)
        if (item.kind == OutboxKind.photo) queue.sendBundle(item.id, retry = true) else queue.send(item, retry = true)
        queue.clearCompletedDrafts()
    }
    fun signOut() = run { queue.field.signOut() }
    override fun close() { closed = true; generation++; accountObserver.cancel() }
}
