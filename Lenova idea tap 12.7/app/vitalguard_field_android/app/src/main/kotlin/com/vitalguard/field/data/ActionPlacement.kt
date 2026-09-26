package com.vitalguard.field.data

import com.vitalguard.field.data.contracts.LocalStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

// Port: action_placement.dart. 2a는 계정별 읽기만; 설정 토글/저장은 4단계.
enum class ActionSide { left, right }
const val vgActionSidePreferenceKey = "settings:action-side"
data class ActionPlacementState(val side: ActionSide = ActionSide.right, val loaded: Boolean = false, val error: String? = null)
class ActionPlacement(private val local: LocalStore, val accountId: String) {
    private val mutable = MutableStateFlow(ActionPlacementState())
    val state = mutable.asStateFlow()
    suspend fun load() {
        try {
            val side = if (local.read(accountId, vgActionSidePreferenceKey) == "left") ActionSide.left else ActionSide.right
            mutable.value = ActionPlacementState(side, loaded = true)
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) {
            mutable.value = mutable.value.copy(loaded = true, error = "실행 위치를 읽지 못했습니다. 사용할 쪽을 선택해 다시 저장해 주세요.")
        }
    }
}
