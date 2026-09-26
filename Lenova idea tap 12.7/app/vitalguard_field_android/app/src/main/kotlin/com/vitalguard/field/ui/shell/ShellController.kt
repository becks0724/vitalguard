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
data class ShellState(val destination: Int = 0, val collapsed: Boolean? = null, val loggingOut: Boolean = false)

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
    fun toggle() {
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
    fun select(index: Int) { require(index in 0..4); mutable.value = state.value.copy(destination = index) }
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

// Port: field_shell.dart receipt(), 문구/우선순위 그대로.
fun shellReceipt(destination: Int, c: FieldState): String {
    if (destination <= 1 && c.siteStatusForbidden) return "마지막 수신 정보 표시 불가 · 접근 권한 없음"
    if (c.offline) {
        val reason = "오프라인 · 서버에 연결할 수 없습니다."
        return when (destination) {
            0 -> "$reason 최신 현장 정보는 받을 수 없습니다. 이전 수신 자료입니다. 현장 요약·작업자·가스 화면이 열려 있으면 60초마다 조회를 재시도합니다. 새로 고침으로도 재시도할 수 있습니다."
            1 -> "$reason 경보 대응 확인은 연결 후 가능하며 예약되지 않습니다. 이 화면이 열려 있으면 60초마다 조회를 재시도합니다. 연결 후 경보를 다시 확인하고 대응 확인을 눌러 주세요."
            2 -> "$reason 촬영한 사진과 주석·메모·음성은 기기에 보관합니다. 연결 후 사진 상세의 전송이나 전송 상태 탭에서 보내 주세요."
            3 -> "$reason 사진·주석·메모·음성은 기기에 보관합니다. 연결 후 각 항목의 전송/재시도를 눌러 주세요. 결과 불명 항목은 서버 반영 여부부터 확인해 주세요."
            else -> "$reason 설정은 기기에 저장할 수 있습니다. 현장 요약·경보 화면을 열면 조회를 재시도합니다."
        }
    }
    if (destination <= 1) {
        if (destination == 1 && c.siteStatusSnapshot?.alerts?.ok == false) {
            return "경보 수신 실패 · 이전 수신 정보는 경보 화면에서 확인해 주세요"
        }
        return siteStatusReceipt(c.siteStatusSnapshot?.fetchedAt)
    }
    return "전송 전 기록은 기기에 보관 · 전송한 기록은 관제웹에서 봅니다"
}
