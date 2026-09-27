package com.vitalguard.field

import com.vitalguard.field.audio.*
import com.vitalguard.field.data.record.RecordWorkspace
import com.vitalguard.field.data.record.RecordCalendarController
import com.vitalguard.field.data.live.ConnectivityWatcher
import com.vitalguard.field.ui.record.AndroidInkRenderer
import com.vitalguard.field.data.mock.MockVoiceRecorder
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.vitalguard.field.data.contracts.AuthStage
import com.vitalguard.field.data.OutboxController
import com.vitalguard.field.capture.CaptureController
import com.vitalguard.field.ui.outbox.OutboxUiController
import com.vitalguard.field.ui.record.RecordActions
import com.vitalguard.field.ui.auth.AuthUiController
import com.vitalguard.field.ui.shell.ShellController
import com.vitalguard.field.ui.site.SiteSummaryController
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

class FieldViewModel(application: FieldApplication) : ViewModel() {
    val controller = application.controller(viewModelScope)
    val outbox = OutboxController(controller, viewModelScope)
    val calendar = RecordCalendarController(controller, outbox, viewModelScope)
    val recordActions = RecordActions(outbox, viewModelScope, calendar::removed)
    val outboxUi = OutboxUiController(outbox, viewModelScope)
    val capture = if (application.captureEnabledForTests == false) null else CaptureController(application, controller, outbox, viewModelScope)
    val auth = AuthUiController(controller, application.internetProbe(), viewModelScope)
    private val events = Channel<String>(Channel.BUFFERED)
    val messages = events.receiveAsFlow()
    val shell = ShellController(controller, viewModelScope, ::snackbar)
    val site = SiteSummaryController(controller, viewModelScope)
    val microphone = MicrophoneAccess(application)
    private val speech: com.vitalguard.field.data.contracts.SpeechInput by lazy { application.speech(controller.isMock, microphone) { (recorder as? DeviceVoiceRecorder)?.isBusy == true } }
    private val recorder: com.vitalguard.field.data.contracts.VoiceRecorder by lazy { application.recorder(viewModelScope, controller.isMock, microphone) { (speech as? DeviceSpeechInput)?.isBusy == true } }
    val records = RecordWorkspace(controller, outbox, AndroidInkRenderer(), speech, recorder, viewModelScope, ::snackbar)
    private val connectivity = if (controller.isMock || application.controllerFactoryForTests != null) null
        else ConnectivityWatcher(application, viewModelScope, controller::connectivityChanged)
    init {
        val previousFlusher = controller.beforeLock
        controller.beforeLock = {
            try { records.flush() } finally { previousFlusher?.invoke() }
        }
        viewModelScope.launch {
            var account: String? = null
            combine(controller.state, shell.state) { field, shell -> field to shell }.collect { (field, _) ->
                val next = if (field.authStage == AuthStage.ready) field.user?.id else null
                if (account != next) {
                    site.setVisible(false)
                    account = next
                    records.bindAccount(next)
                    calendar.bindAccount(next)
                    shell.bindAccount(next)
                    site.reset()
                    capture?.reset()
                    if (next != null) viewModelScope.launch { outbox.load() }
                }
                site.setVisible(next != null && shell.state.value.destination == 0)
                outboxUi.setVisible(next != null && shell.state.value.destination == 3)
                calendar.setVisible(next != null && shell.state.value.destination == 2)
            }
        }
        viewModelScope.launch { outbox.items.collect {
            records.pruneFinished()
            // 조회로 부모의 완료가 확인된 경우에도 저장된 추가분의 대기가 이어진다.
            records.launch { outbox.resumeAutomatic() }
        } }
        viewModelScope.launch {
            var wasOffline = false
            controller.state.map { Triple(it.authStage, it.user?.id, it.offline) }.distinctUntilChanged().collect { (stage, _, offline) ->
                val restored = wasOffline && !offline
                wasOffline = offline
                if (stage == AuthStage.ready && !offline) {
                    records.launch {
                        outbox.load()
                        outbox.resumeAutomatic(networkRestored = restored)
                    }
                    if (restored) calendar.refresh()
                }
            }
        }
        viewModelScope.launch { controller.initialize() }
    }
    suspend fun restoreRecord() { if (records.restoreSession()) shell.select(2) }
    fun selectDestination(index: Int) {
        if (shell.state.value.destination == 2 && index != 2) records.launch { records.closeDetail(); records.flush(); shell.select(index) }
        else shell.select(index)
    }
    fun stopRecordAudio() {
        (speech as? DeviceSpeechInput)?.onStop()
        (recorder as? DeviceVoiceRecorder)?.onStop()
        (recorder as? MockVoiceRecorder)?.autoStop("background")
        records.background()
    }
    fun snackbar(message: String) { events.trySend(message) }
    override fun onCleared() {
        connectivity?.close()
        calendar.close()
        records.close()
        controller.beforeLock = null
        auth.close()
        site.close()
        capture?.close()
        outboxUi.close()
        outbox.close()
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
