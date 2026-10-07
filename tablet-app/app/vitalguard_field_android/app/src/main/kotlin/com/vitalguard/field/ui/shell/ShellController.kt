package com.vitalguard.field.ui.shell

import com.vitalguard.field.data.contracts.FieldController
import com.vitalguard.field.data.contracts.FieldState
import com.vitalguard.field.data.models.siteStatusReceipt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

const val vgRailPreferenceKey = "shell:rail-collapsed"
const val vgTwoPaneMinWidth = 1000
data class ShellState(val destination: Int = 0, val collapsed: Boolean? = null, val loggingOut: Boolean = false, val recordEditorOpen: Boolean = false, val homeRevisions: List<Int> = List(6) { 0 })

class ShellController(
    private val controller: FieldController,
    private val scope: CoroutineScope,
    private val snackbar: (String) -> Unit,
) {
    private val mutable = MutableStateFlow(ShellState())
    val state = mutable.asStateFlow()
    private var account: String? = null
    private var revision = 0
    private var lastWideWindow: Boolean? = null
    fun bindAccount(value: String?) {
        if (account == value) return
        account = value
        val expected = ++revision
        lastWideWindow = null
        mutable.value = ShellState()
        if (value == null) return
        scope.launch {
            try {
                val stored = controller.local.read(value, vgRailPreferenceKey)
                if (revision == expected && account == value && stored != null) {
                    mutable.value = state.value.copy(collapsed = stored == "true")
                }
            } catch (e: Exception) { if (e is CancellationException) throw e }
        }
    }
    fun windowWidth(widthDp: Int) {
        val wide = widthDp >= vgTwoPaneMinWidth
        if (lastWideWindow == null && state.value.collapsed == null) {
            mutable.value = state.value.copy(collapsed = !wide)
        } else if (lastWideWindow != null && lastWideWindow != wide && !wide) {
            revision++
            mutable.value = state.value.copy(collapsed = true)
        }
        lastWideWindow = wide
    }
    fun editorOpen(open: Boolean) {
        mutable.value = state.value.copy(recordEditorOpen = open)
    }
    fun toggle() {
        if (state.value.recordEditorOpen) return
        val owner = account ?: return
        val previous = state.value.collapsed ?: true
        val expected = ++revision
        mutable.value = state.value.copy(collapsed = !previous)
        scope.launch {
            try { controller.local.write(owner, vgRailPreferenceKey, (!previous).toString()) }
            catch (e: Exception) {
                if (e is CancellationException) throw e
                if (expected != revision || account != owner) return@launch
                mutable.value = state.value.copy(collapsed = previous)
                snackbar("레일 접힘 상태를 저장하지 못했습니다.")
            }
        }
    }
    fun home(index: Int) {
        require(index in 0..5)
        mutable.value = state.value.copy(homeRevisions = state.value.homeRevisions.mapIndexed { i, value -> if (i == index) value + 1 else value })
    }
    fun select(index: Int) { require(index in 0..5); mutable.value = state.value.copy(destination = index) }
    fun logout() {
        if (state.value.loggingOut) return
        mutable.value = state.value.copy(loggingOut = true)
        val owner = account
        scope.launch {
            try { controller.signOut() } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (account == owner) {
                    snackbar("초안 저장 상태를 확인한 뒤 다시 로그아웃해 주세요")
                    mutable.value = state.value.copy(loggingOut = false)
                }
            }
        }
    }
}

// 상태 요약만 표시한다. 조작 안내는 사용 방법 탭에 모은다.
fun shellReceipt(destination: Int, c: FieldState): String {
    if (destination == 5) return "사용 방법"
    if (destination <= 1 && c.siteStatusForbidden) return "접근 권한 없음"
    if (c.offline) return when (destination) {
        0 -> "오프라인 · 마지막 수신 자료"
        1 -> "오프라인 · 대응 확인 불가"
        2, 3 -> "오프라인 · 기기에 보관"
        else -> "오프라인 · 기기에 저장"
    }
    if (destination <= 1) {
        if (destination == 1 && c.siteStatusSnapshot?.alerts?.ok == false) return "경보 수신 실패"
        return siteStatusReceipt(c.siteStatusSnapshot?.fetchedAt)
    }
    return if (destination == 4) "기기에 저장" else "전송 상태는 기록별 표시"
}
