package com.vitalguard.field

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.vitalguard.field.data.contracts.AuthStage
import com.vitalguard.field.ui.auth.AuthUiController
import com.vitalguard.field.ui.shell.ShellController
import com.vitalguard.field.ui.site.SiteSummaryController
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

class FieldViewModel(application: FieldApplication) : ViewModel() {
    val controller = application.controller(viewModelScope)
    val auth = AuthUiController(controller, application.internetProbe(), viewModelScope)
    private val events = Channel<String>(Channel.BUFFERED)
    val messages = events.receiveAsFlow()
    val shell = ShellController(controller, viewModelScope, ::snackbar)
    val site = SiteSummaryController(controller, viewModelScope)
    init {
        viewModelScope.launch {
            var account: String? = null
            combine(controller.state, shell.state) { field, shell -> field to shell }.collect { (field, _) ->
                val next = if (field.authStage == AuthStage.ready) field.user?.id else null
                if (account != next) {
                    site.setVisible(false)
                    account = next
                    shell.bindAccount(next)
                    site.reset()
                }
                site.setVisible(next != null && shell.state.value.destination == 0)
            }
        }
        viewModelScope.launch { controller.initialize() }
    }
    fun snackbar(message: String) { events.trySend(message) }
    override fun onCleared() {
        auth.close()
        site.close()
        controller.close()
        events.close()
    }
    class Factory(private val application: FieldApplication) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(FieldViewModel::class.java))
            @Suppress("UNCHECKED_CAST")
            return FieldViewModel(application) as T
        }
    }
}
