package com.vitalguard.field.ui.auth

import com.vitalguard.field.data.contracts.*
import java.time.Clock
import java.time.Duration
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

data class ConnectionDialog(val title: String, val body: String)
fun connectionDialog(hasInternet: Boolean?) = ConnectionDialog(
    if (hasInternet == false) "인터넷에 연결되어 있지 않습니다" else "서버에 연결할 수 없습니다",
    when (hasInternet) {
        false -> "기기의 Wi-Fi 가 꺼져 있거나 연결이 끊겼습니다. Wi-Fi 를 켜고 연결한 뒤 다시 로그인해 주세요."
        true -> "인터넷은 연결되어 있습니다. 서버가 응답하지 않으니 잠시 후 다시 시도해 주세요. 계속되면 관리자에게 문의해 주세요."
        null -> "인터넷 연결을 확인한 뒤 다시 로그인해 주세요. 계속되면 관리자에게 문의해 주세요."
    },
)

data class AuthFormState(
    val id: String = "", val password: String = "", val code: String = "",
    val remember: Boolean = true, val obscure: Boolean = true,
    val seconds: Long = 0, val dialog: ConnectionDialog? = null,
) {
    override fun toString() = "AuthFormState(credentials=redacted)"
}

// 비밀번호·TOTP는 ViewModel 메모리에만 둔다. SavedStateHandle/Bundle/파일에 쓰지 않는다.
class AuthUiController(
    private val controller: FieldController,
    private val probe: InternetProbe,
    private val scope: CoroutineScope,
    private val clock: Clock = Clock.systemUTC(),
) : AutoCloseable {
    private val mutable = MutableStateFlow(AuthFormState())
    val state = mutable.asStateFlow()
    private var revision = 0
    private val watcher: Job = scope.launch {
        controller.state.map { it.lockedUntil }.distinctUntilChanged().collectLatest { until ->
            do {
                val seconds = until?.let { Duration.between(clock.instant(), it).toMillis() / 1000 + 1 } ?: 0
                mutable.value = mutable.value.copy(seconds = seconds.coerceAtLeast(0))
                if (seconds <= 0) break
                delay(1000)
            } while (true)
        }
    }
    private val stageWatcher = scope.launch {
        controller.state.map { it.authStage }.distinctUntilChanged().collect { stage ->
            if (stage == AuthStage.ready) {
                ++revision
                mutable.value = AuthFormState()
            }
        }
    }
    fun id(value: String) { mutable.value = state.value.copy(id = value) }
    fun password(value: String) { mutable.value = state.value.copy(password = value) }
    fun code(value: String) { mutable.value = state.value.copy(code = value.filter { it in '0'..'9' }.take(6)) }
    fun remember(value: Boolean) { mutable.value = state.value.copy(remember = value) }
    fun togglePassword() { mutable.value = state.value.copy(obscure = !state.value.obscure) }
    fun dismissDialog() { mutable.value = state.value.copy(dialog = null) }
    fun cancel() {
        ++revision
        mutable.value = state.value.copy(password = "", code = "", dialog = null)
        scope.launch { controller.cancelSignIn() }
    }
    fun submit() {
        val field = controller.state.value
        if (field.busy || field.lockedUntil?.isAfter(clock.instant()) == true) return
        val form = state.value
        val totp = field.authStage == AuthStage.totp
        if (totp && form.code.length != 6) return
        if (!totp && (form.id.isBlank() || form.password.isEmpty())) return
        val expected = ++revision
        dismissDialog()
        scope.launch {
            if (totp) controller.submitTotp(form.code)
            else {
                controller.signIn(form.id.trim(), form.password, form.remember)
                // 성공 시 stageWatcher가 먼저 폼을 비워도 안전하다.
                if (expected == revision) mutable.value = state.value.copy(password = "")
            }
            if (expected != revision) return@launch
            val failure = controller.state.value.loginFailure ?: return@launch
            if (!failure.networkUnreachable) return@launch
            val internet = try { probe.hasInternet() } catch (e: Exception) {
                if (e is CancellationException) throw e
                null
            }
            if (expected != revision || controller.state.value.loginFailure !== failure) return@launch
            mutable.value = state.value.copy(dialog = connectionDialog(internet))
        }
    }
    override fun close() {
        ++revision
        watcher.cancel()
        stageWatcher.cancel()
        mutable.value = AuthFormState()
    }
}
