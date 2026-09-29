package com.vitalguard.field.data.profile

import com.vitalguard.field.data.contracts.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class MemberProfileState(val visible: Boolean = false, val loading: Boolean = false,
    val profile: MemberProfile? = null, val error: String? = null)

class MemberProfileController(private val field: FieldController, private val scope: CoroutineScope) : AutoCloseable {
    private val mutable = MutableStateFlow(MemberProfileState())
    val state = mutable.asStateFlow()
    private var account: String? = null
    private var generation = 0
    private var closed = false
    private val observer = scope.launch {
        field.state.map { it.user?.id?.takeIf { _ -> it.authStage == AuthStage.ready } }.distinctUntilChanged().collect {
            account = it; generation++; mutable.value = MemberProfileState()
        }
    }
    fun open() { mutable.value = state.value.copy(visible = true); refresh() }
    fun dismiss() { generation++; mutable.value = state.value.copy(visible = false, loading = false) }
    fun refresh() {
        val owner = account ?: return
        if (closed || !state.value.visible || state.value.loading) return
        val expected = ++generation
        mutable.value = state.value.copy(loading = true, error = null)
        scope.launch {
            try {
                val result = field.memberProfile()
                if (result.username != owner) throw ApiFailure("현재 계정의 회원정보를 확인할 수 없습니다")
                if (current(owner, expected)) mutable.value = state.value.copy(profile = result)
            } catch (e: CancellationException) { throw e
            } catch (_: Exception) {
                if (current(owner, expected)) mutable.value = state.value.copy(profile = null, error = "회원정보를 불러오지 못했습니다")
            } finally {
                if (current(owner, expected)) mutable.value = state.value.copy(loading = false)
            }
        }
    }
    private fun current(owner: String, expected: Int) = !closed && state.value.visible && account == owner && generation == expected &&
        field.state.value.authStage == AuthStage.ready && field.state.value.user?.id == owner
    override fun close() { closed = true; generation++; observer.cancel(); mutable.value = MemberProfileState() }
}
