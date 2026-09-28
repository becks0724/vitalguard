package com.vitalguard.field.data.cctv

import com.vitalguard.field.data.contracts.*
import java.time.Clock
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

const val CCTV_CAMERA_ID = "CAM-03"
const val CCTV_PERIOD_PREFERENCE_KEY = "settings:cctv-period-seconds"
val CCTV_PERIOD_OPTIONS = listOf(2, 5, 10)
data class CctvState(val bytes: ByteArray? = null, val receivedAt: Instant? = null,
    val now: Instant = Instant.EPOCH, val error: String? = null, val loading: Boolean = false,
    val active: Boolean = false, val periodSeconds: Int = 5, val failures: Int = 0,
    val periodLoaded: Boolean = false, val periodSaving: Boolean = false, val periodError: String? = null) {
    val delaySeconds get() = minOf(60, periodSeconds * (1 shl failures.coerceAtMost(6)))
    val ageSeconds get() = receivedAt?.let { Duration.between(it, now).seconds.coerceAtLeast(0) }
    val stale get() = ageSeconds?.let { it > periodSeconds * 3 } == true
}

class CctvController(private val field: FieldController, private val frames: CctvFrames,
    private val scope: CoroutineScope, private val clock: Clock = Clock.systemUTC()) : AutoCloseable {
    private val mutable = MutableStateFlow(CctvState(now = clock.instant()))
    val state = mutable.asStateFlow()
    private var visible = false
    private var foreground = false
    private var disposed = false
    private var account: String? = null
    private var preferenceGeneration = 0
    private var generation = 0
    private var flight: Job? = null
    private var timer: Job? = null
    private var ticker: Job? = null
    private val observer = scope.launch {
        field.state.map { it.user?.id?.takeIf { _ -> it.authStage == AuthStage.ready } }.distinctUntilChanged().collectLatest { owner ->
            stop(); account = owner; preferenceGeneration++
            mutable.value = CctvState(now = clock.instant())
            val expected = preferenceGeneration
            if (owner != null) {
                try {
                    val saved = field.local.read(owner, CCTV_PERIOD_PREFERENCE_KEY)?.toIntOrNull()
                    if (!currentPreference(owner, expected)) return@collectLatest
                    mutable.value = state.value.copy(periodSeconds = saved?.takeIf { it in CCTV_PERIOD_OPTIONS } ?: 5, periodLoaded = true)
                } catch (e: CancellationException) { throw e
                } catch (_: Exception) {
                    if (!currentPreference(owner, expected)) return@collectLatest
                    mutable.value = state.value.copy(periodLoaded = true,
                        periodError = "갱신 간격을 읽지 못했습니다. 사용할 간격을 선택해 다시 저장해 주세요.")
                }
            }
            sync()
        }
    }
    private fun currentPreference(owner: String, expected: Int) = !disposed && account == owner &&
        expected == preferenceGeneration && field.state.value.authStage == AuthStage.ready && field.state.value.user?.id == owner
    fun setVisible(value: Boolean) { if (visible != value) { visible = value; sync() } }
    fun setForeground(value: Boolean) { if (foreground != value) { foreground = value; sync() } }
    private fun current(expected: Int) = !disposed && state.value.active && expected == generation &&
        field.state.value.authStage == AuthStage.ready && field.state.value.user?.id == account
    private fun stop() {
        generation++; timer?.cancel(); ticker?.cancel(); frames.cancel()
        mutable.value = state.value.copy(active = false)
        // A shared auth refresh/ticket request finishes once; its late result cannot open the gate.
    }
    private fun sync() {
        val active = visible && foreground && account != null && state.value.periodLoaded && !disposed
        if (!active) { stop(); return }
        if (state.value.active) return
        mutable.value = state.value.copy(active = true, now = clock.instant())
        ticker = scope.launch { while (true) { delay(1000); mutable.value = state.value.copy(now = clock.instant()) } }
        request()
    }
    fun period(seconds: Int) {
        require(seconds in CCTV_PERIOD_OPTIONS)
        val owner = account ?: return
        val expected = preferenceGeneration
        val previous = state.value
        if (!currentPreference(owner, expected) || !previous.periodLoaded || previous.periodSaving ||
            (previous.periodSeconds == seconds && previous.periodError == null)) return
        mutable.value = previous.copy(periodSaving = true, periodError = null)
        scope.launch {
            try {
                // Save to the captured owner. Late results never update a different account/session.
                field.local.write(owner, CCTV_PERIOD_PREFERENCE_KEY, seconds.toString())
                if (currentPreference(owner, expected)) {
                    mutable.value = state.value.copy(periodSeconds = seconds, periodSaving = false)
                    if (flight == null) schedule()
                }
            } catch (e: CancellationException) {
                if (currentPreference(owner, expected)) mutable.value = state.value.copy(periodSaving = false)
                throw e
            } catch (_: Exception) {
                if (currentPreference(owner, expected)) mutable.value = state.value.copy(periodSaving = false,
                    periodError = "갱신 간격을 저장하지 못했습니다. 다시 선택해 주세요.")
            }
        }
    }
    fun retry() { timer?.cancel(); if (flight == null) request() }
    private fun schedule() {
        timer?.cancel()
        if (state.value.active && !disposed) timer = scope.launch { delay(state.value.delaySeconds * 1000L); request() }
    }
    private fun request() {
        if (!state.value.active || disposed || flight != null) return
        val expected = generation
        // LAZY assignment prevents a synchronously completed test gateway from leaving a stale job reference.
        val job = scope.launch(start = CoroutineStart.LAZY) {
            mutable.value = state.value.copy(loading = true)
            try {
                val ticket = try { field.cctvTicket(CCTV_CAMERA_ID) } catch (e: ApiFailure) {
                    throw CctvFailure(when (e.status) {
                        401, 403 -> "이 현장 CCTV를 볼 권한이 없습니다"
                        404 -> if (e.code == "unknown camera") "등록되지 않은 카메라입니다" else "서버에 CCTV 경로가 없습니다. 관리자에게 서버 배포 확인을 요청해 주세요"
                        429 -> "요청이 많습니다. 잠시 후 다시 시도합니다"
                        503 -> if (field.isMock) "모의 데이터에는 CCTV 영상이 없습니다" else "서버에 CCTV 설정이 없습니다"
                        else -> cctvUnreachable
                    })
                }
                if (!current(expected)) return@launch
                cctvStreamUri(ticket.gateApi)
                if (ticket.expiresAt <= clock.millis()) throw CctvFailure("CCTV 이용 시간이 만료되었습니다. 다시 시도합니다")
                val bytes = frames.fetch(ticket)
                if (!current(expected)) return@launch
                mutable.value = state.value.copy(bytes = bytes, receivedAt = clock.instant(), now = clock.instant(), error = null, failures = 0)
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                if (current(expected)) mutable.value = state.value.copy(error = (e as? CctvFailure)?.message ?: cctvUnreachable,
                    failures = (state.value.failures + 1).coerceAtMost(6))
            } finally {
                flight = null
                if (!disposed) mutable.value = state.value.copy(loading = false, now = clock.instant())
                if (!disposed && state.value.active) {
                    if (expected != generation) request() else schedule()
                }
            }
        }
        flight = job; job.start()
    }
    override fun close() { disposed = true; stop(); observer.cancel(); mutable.value = CctvState(now = clock.instant()) }
}
