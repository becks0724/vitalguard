package com.vitalguard.field.data

import com.vitalguard.field.data.contracts.LocalStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

// Port: action_placement.dart. 계정이 바뀌면 새 인스턴스를 만들어 저장 소유자를 고정한다.
enum class ActionSide { left, right }
const val vgActionSidePreferenceKey = "settings:action-side"
data class ActionPlacementState(val side: ActionSide = ActionSide.right, val loaded: Boolean = false, val error: String? = null, val saving: Boolean = false)
class ActionPlacement(private val local: LocalStore, val accountId: String) {
    private val mutable = MutableStateFlow(ActionPlacementState())
    val state = mutable.asStateFlow()
    suspend fun load() {
        if (mutable.value.loaded || mutable.value.saving) return
        try {
            val side = if (local.read(accountId, vgActionSidePreferenceKey) == "left") ActionSide.left else ActionSide.right
            mutable.value = ActionPlacementState(side, loaded = true)
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) {
            mutable.value = mutable.value.copy(loaded = true, error = "작업 배치를 읽지 못했습니다. 작업 손을 선택해 다시 저장해 주세요.")
        }
    }
    suspend fun select(next: ActionSide) {
        val previous = mutable.value
        if (!previous.loaded || previous.saving || (next == previous.side && previous.error == null)) return
        mutable.value = previous.copy(side = next, saving = true, error = null)
        try {
            local.write(accountId, vgActionSidePreferenceKey, next.name)
            mutable.value = mutable.value.copy(saving = false)
        } catch (e: CancellationException) {
            mutable.value = previous.copy(saving = false)
            throw e
        } catch (_: Exception) {
            mutable.value = previous.copy(saving = false, error = "작업 배치를 저장하지 못했습니다. 다시 선택해 주세요.")
        }
    }
}
