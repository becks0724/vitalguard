package com.vitalguard.field

import android.app.Application
import com.vitalguard.field.audio.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.MockSpeechInput
import com.vitalguard.field.data.mock.MockVoiceRecorder
import com.vitalguard.field.data.contracts.FieldController
import com.vitalguard.field.data.contracts.InternetProbe
import com.vitalguard.field.data.live.DeviceLocalStore
import com.vitalguard.field.data.live.LiveGateway
import com.vitalguard.field.data.live.NetworkNative
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.mock.MockGateway
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.CoroutineScope

// 구현 선택은 이 조립 지점만 담당한다. 화면은 contracts/화면 상태만 의존한다.
class FieldApplication : Application() {
    // Instrumentation은 Activity 시작 전에 주입한다. Intent/설정으로 이 값을 바꿀 수 없다.
    var controllerFactoryForTests: ((CoroutineScope) -> FieldController)? = null
    var captureEnabledForTests: Boolean? = null
    var internetProbeForTests: InternetProbe? = null
    fun controller(scope: CoroutineScope): FieldController = controllerFactoryForTests?.invoke(scope)
        ?: FieldCoordinator(if (BuildConfig.VG_MOCK) MockGateway() else LiveGateway(),
            if (BuildConfig.VG_MOCK) MemoryStore() else DeviceLocalStore(this), scope)
    var speechFactoryForTests: (() -> SpeechInput)? = null
    var recorderFactoryForTests: ((CoroutineScope) -> VoiceRecorder)? = null
    fun speech(isMock: Boolean, microphone: MicrophoneAccess, busy: () -> Boolean): SpeechInput =
        speechFactoryForTests?.invoke() ?: if (isMock) MockSpeechInput() else DeviceSpeechInput(this, microphone, busy)
    fun recorder(scope: CoroutineScope, isMock: Boolean, microphone: MicrophoneAccess, busy: () -> Boolean): VoiceRecorder =
        recorderFactoryForTests?.invoke(scope) ?: if (isMock) MockVoiceRecorder(scope) else DeviceVoiceRecorder(this, microphone, busy)
    fun internetProbe(): InternetProbe = internetProbeForTests ?: NetworkNative(this)
}
