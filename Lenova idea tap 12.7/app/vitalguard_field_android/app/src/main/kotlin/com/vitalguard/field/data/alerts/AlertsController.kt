package com.vitalguard.field.data.alerts

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import java.time.Clock
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

enum class AlertWritePhase { idle, sending, confirmed, failed, uncertain, conflict, retryReady }
data class AlertsState(
    val data: SiteStatus? = null, val loading: Boolean = false, val readFailed: Boolean = false,
    val forbidden: Boolean = false, val authorized: Boolean = false, val offline: Boolean = false,
    val writes: Map<String, AlertWritePhase> = emptyMap(), val failures: Map<String, String> = emptyMap(),
    val reopened: Set<String> = emptySet(), val closed: Set<String> = emptySet(),
    val pending: List<AlertItem> = emptyList(), val selected: AlertItem? = null, val now: Instant = Instant.EPOCH,
) {
    val items get() = data?.alerts?.items.orEmpty()
    val sending get() = writes.values.any { it == AlertWritePhase.sending }
    fun phase(id: String) = writes[id] ?: AlertWritePhase.idle
}

/** Owns GET reconciliation and explicit, single-flight POSTs. No outbox or automatic POST retry. */
class AlertsController(private val field: FieldController, private val scope: CoroutineScope,
    private val clock: Clock = Clock.systemUTC()) : AutoCloseable {
    private val mutable = MutableStateFlow(AlertsState(now = clock.instant()))
    val state = mutable.asStateFlow()
    private var account: String? = null
    private var observed: SiteStatus? = null
    private var generation = 0
    private var disposed = false
    private var visible = false
    private var foreground = false
    private var poll: Job? = null
    private val pending = linkedMapOf<String, AlertItem>()
    private val dismissed = mutableMapOf<String, AlertItem>()
    private fun current(expected: Int) = !disposed && expected == generation &&
        account != null && field.state.value.user?.id == account && field.state.value.authStage == AuthStage.ready
    private val observer = scope.launch {
        field.state.collect { f ->
            val next = f.user?.id?.takeIf { f.authStage == AuthStage.ready }
            if (account != next) {
                account = next; generation++; observed = null; pending.clear(); dismissed.clear()
                mutable.value = AlertsState(authorized = next != null, offline = f.offline, now = clock.instant())
                sync()
            }
            mutable.value = state.value.copy(authorized = next != null, offline = f.offline, forbidden = f.siteStatusForbidden)
            if (next == null || f.siteStatusForbidden) {
                pending.clear(); dismissed.clear(); observed = null
                mutable.value = state.value.copy(data = null, writes = emptyMap(), failures = emptyMap(),
                    pending = emptyList(), selected = null, reopened = emptySet(), closed = emptySet())
            } else if (observed !== f.siteStatusSnapshot && !state.value.loading && !state.value.sending) {
                accept(f.siteStatusSnapshot, false)
            }
            observed = f.siteStatusSnapshot
        }
    }
    fun setVisible(value: Boolean) { if (visible != value) { visible = value; sync() } }
    fun setForeground(value: Boolean) { if (foreground != value) { foreground = value; sync() } }
    private fun sync() {
        poll?.cancel()
        if (!visible || !foreground || account == null || disposed) return
        refresh()
        poll = scope.launch {
            var ticks = 0
            while (true) {
                delay(1000); mutable.value = state.value.copy(now = clock.instant())
                if (++ticks % 60 == 0 && !state.value.forbidden) refresh()
            }
        }
    }
    private fun accept(next: SiteStatus?, reconcile: Boolean) {
        if (next == null) return
        if (!next.alerts.ok || !next.alerts.itemsAvailable) {
            mutable.value = state.value.copy(readFailed = true); return
        }
        val writes = state.value.writes.toMutableMap()
        val reopened = state.value.reopened.toMutableSet()
        val closed = state.value.closed.toMutableSet()
        for (row in next.alerts.items) {
            val old = state.value.items.firstOrNull { it.id == row.id }
            if (old != null && !old.sameOccurrence(row)) {
                writes.remove(row.id); reopened.remove(row.id); closed.remove(row.id)
            } else if (old != null && old.acknowledged && !row.acknowledged) {
                reopened += row.id; closed -= row.id
                if (writes[row.id] != AlertWritePhase.uncertain) writes.remove(row.id)
            } else if (old != null && !old.acknowledged && row.acknowledged) {
                closed += row.id; reopened -= row.id
            }
            if (reconcile && writes[row.id] == AlertWritePhase.uncertain) {
                writes[row.id] = if (row.acknowledged) AlertWritePhase.confirmed else AlertWritePhase.retryReady
            }
            if (row.acknowledged) pending.remove(row.id)
            else if (dismissed[row.id]?.sameOccurrence(row) != true) {
                if (pending[row.id]?.sameOccurrence(row) == false) pending.remove(row.id)
                pending[row.id] = row
            }
        }
        // An omitted row is not proof of acknowledgement, absence or a safe retry.
        mutable.value = state.value.copy(data = next, readFailed = false, writes = writes,
            reopened = reopened, closed = closed, pending = pending.values.toList(), now = clock.instant())
    }
    fun refresh(manual: Boolean = false) { scope.launch { read(manual) } }
    private suspend fun read(manual: Boolean) {
        val s = state.value
        if (disposed || !s.authorized || s.loading || s.sending || (!manual && (s.forbidden || s.offline))) return
        val expected = generation
        mutable.value = s.copy(loading = true)
        try {
            val next = field.siteStatus()
            if (!current(expected)) return
            observed = next
            accept(next, true)
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) {
            if (current(expected)) mutable.value = state.value.copy(readFailed = true,
                data = if (field.state.value.siteStatusForbidden) null else state.value.data)
        } finally {
            if (expected == generation && !disposed) mutable.value = state.value.copy(loading = false, now = clock.instant())
        }
    }
    fun select(row: AlertItem?) { mutable.value = state.value.copy(selected = row) }
    fun dismiss(row: AlertItem) {
        dismissed[row.id] = row; pending.remove(row.id)
        mutable.value = state.value.copy(pending = pending.values.toList())
    }
    fun canAck(displayed: AlertItem): Boolean {
        val s = state.value
        val current = s.items.firstOrNull { it.id == displayed.id } ?: return false
        return current(generation) && s.authorized && !s.forbidden && !s.offline &&
            !field.state.value.offline && !field.state.value.siteStatusForbidden &&
            !s.loading && !s.sending && !s.readFailed &&
            current.workerId != null && current.ts != null && current.sameOccurrence(displayed) && !current.acknowledged &&
            s.phase(current.id) in setOf(AlertWritePhase.idle, AlertWritePhase.failed, AlertWritePhase.retryReady)
    }
    fun acknowledge(displayed: AlertItem) { scope.launch {
        if (!canAck(displayed)) return@launch
        val expected = generation
        val id = displayed.id
        mutable.value = state.value.copy(writes = state.value.writes + (id to AlertWritePhase.sending), failures = state.value.failures - id)
        try {
            val changed = field.ackAlert(id)
            if (!current(expected)) return@launch
            mutable.value = state.value.copy(writes = state.value.writes + (id to
                if (changed) AlertWritePhase.confirmed else AlertWritePhase.conflict))
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            if (!current(expected)) return@launch
            val rejected = e is ApiFailure && !e.uncertainWrite && e.status?.let { it in 400..499 } == true
            val message = when ((e as? ApiFailure)?.status) {
                401 -> "로그인을 확인한 뒤 서버 상태를 다시 조회해 주세요"
                403 -> "대응 확인 권한이 없습니다. 관리자에게 문의해 주세요"
                404 -> "대상을 찾을 수 없습니다. 서버 상태를 다시 조회해 주세요"
                429 -> "요청이 많습니다. 잠시 후 서버 상태를 다시 조회해 주세요"
                else -> "요청이 거부되었습니다. 서버 상태를 다시 조회해 주세요"
            }
            mutable.value = state.value.copy(writes = state.value.writes + (id to
                if (rejected) AlertWritePhase.failed else AlertWritePhase.uncertain), failures = state.value.failures + (id to message))
        }
        if (current(expected) && state.value.phase(id) != AlertWritePhase.failed) read(true)
    } }
    override fun close() { disposed = true; generation++; poll?.cancel(); observer.cancel(); pending.clear(); dismissed.clear() }
}
