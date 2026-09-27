package com.vitalguard.field.ui.site

import com.vitalguard.field.data.contracts.ApiFailure
import com.vitalguard.field.data.contracts.FieldController
import com.vitalguard.field.data.models.SiteStatus
import com.vitalguard.field.data.models.parseInstant
import java.time.Clock
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

const val SITE_REFRESH_MS = 60_000L
val siteStatusStaleAfter: Duration = Duration.ofMinutes(5)
const val siteForbiddenMessage = "현재 계정의 역할 또는 현장 범위 밖입니다. 관리자에게 역할과 현장 배정을 확인해 달라고 요청해 주세요."

data class SiteSummaryState(
    val data: SiteStatus? = null,
    val loading: Boolean = false,
    val failed: Boolean = false,
    val forbidden: Boolean = false,
    val now: Instant = Instant.EPOCH,
) {
    val stale get() = data?.let { Duration.between(parseInstant(it.fetchedAt), now) >= siteStatusStaleAfter } == true
}

// Port: site_screen.dart의 _sync/_refresh. Activity와 독립적이어서 회전 중 요청/자료를 유지한다.
class SiteSummaryController(
    private val controller: FieldController,
    private val scope: CoroutineScope,
    private val clock: Clock = Clock.systemUTC(),
) : AutoCloseable {
    private val mutable = MutableStateFlow(SiteSummaryState(now = clock.instant()))
    val state = mutable.asStateFlow()
    private var visible = false
    private var foreground = false
    private var resumedOnce = false
    private var generation = 0
    private var polling: Job? = null
    private var ticker: Job? = null
    private val active get() = visible && foreground

    fun reset() {
        generation++
        polling?.cancel()
        ticker?.cancel()
        mutable.value = SiteSummaryState(controller.state.value.siteStatusSnapshot,
            forbidden = controller.state.value.siteStatusForbidden, now = clock.instant())
    }
    fun setVisible(value: Boolean) {
        if (visible == value) return
        visible = value
        sync()
    }
    fun setForeground(value: Boolean) {
        if (foreground == value) return
        foreground = value
        val manual = value && resumedOnce
        if (value) resumedOnce = true
        sync(manual)
    }
    private fun sync(manual: Boolean = false) {
        polling?.cancel()
        ticker?.cancel()
        if (!active) return
        ticker = scope.launch {
            while (true) {
                mutable.value = state.value.copy(now = clock.instant())
                delay(1000)
            }
        }
        if (state.value.forbidden && !manual) return
        scope.launch { refresh(manual) }
        if (!state.value.forbidden) startPolling()
    }
    private fun startPolling() {
        polling?.cancel()
        if (!active || state.value.forbidden) return
        polling = scope.launch {
            while (true) {
                delay(SITE_REFRESH_MS)
                // 진행 중 요청이 있어도 타이머는 유지하며 refresh가 중복을 막는다.
                scope.launch { refresh(false) }
            }
        }
    }
    fun manualRefresh() { scope.launch { refresh(true) } }
    private suspend fun refresh(manual: Boolean) {
        if (state.value.loading || !active || (state.value.forbidden && !manual)) return
        val expected = generation
        mutable.value = state.value.copy(loading = true, now = clock.instant())
        try {
            if (manual) {
                try { controller.refreshSite() } catch (e: Exception) {
                    if (e is CancellationException) throw e
                }
                if (expected != generation || !active) return
            }
            val data = controller.siteStatus()
            if (expected != generation) return
            val wasForbidden = state.value.forbidden
            mutable.value = state.value.copy(data = data, failed = false, forbidden = false, now = clock.instant())
            if (wasForbidden) startPolling()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (expected != generation) return
            val forbidden = state.value.forbidden || (e is ApiFailure && e.status in listOf(401, 403))
            mutable.value = state.value.copy(failed = true, forbidden = forbidden,
                data = if (forbidden || (e is ApiFailure && e.status == 401)) null else state.value.data)
            if (forbidden) polling?.cancel()
        } finally {
            if (expected == generation) mutable.value = state.value.copy(loading = false, now = clock.instant())
        }
    }
    override fun close() { generation++; polling?.cancel(); ticker?.cancel() }
}
