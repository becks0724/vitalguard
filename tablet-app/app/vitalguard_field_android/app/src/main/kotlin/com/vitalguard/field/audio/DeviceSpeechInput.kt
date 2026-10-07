package com.vitalguard.field.audio

import android.content.Context
import android.content.Intent
import android.os.*
import android.speech.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.JsonObject
import kotlinx.coroutines.flow.*

// MainActivity.kt vitalguard/stt의 제품 입력 경로. 진단 화면/로그/온라인 fallback 없음.
class DeviceSpeechInput(
    private val context: Context, private val microphone: MicrophoneAccess, private val recorderBusy: () -> Boolean,
) : SpeechInput {
    private val mutable = MutableSharedFlow<JsonObject>(extraBufferCapacity = 32)
    override val events = mutable.asSharedFlow()
    private val handler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var active: String? = null
    private var pending = false
    private var generation = 0
    private var deadline: Runnable? = null
    val isBusy get() = active != null || pending
    override suspend fun available() = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    private fun intent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
    }
    override suspend fun start(runId: String) {
        if (recorderBusy()) throw ApiFailure("녹음이나 미리듣기가 끝난 뒤 말로 입력해 주세요", code = "microphone_busy")
        if (isBusy) throw ApiFailure("이미 측정 또는 마이크 권한 요청 중입니다", code = "busy")
        if (!available()) throw ApiFailure("온디바이스 인식기 또는 이벤트 연결이 없습니다", code = "not_available")
        require(runId.isNotBlank()) { "측정 ID와 읽을 문장이 필요합니다" }
        val expected = ++generation
        pending = true
        try {
            microphone.request("speech")
            if (expected != generation || !pending) return
            if (recorderBusy()) throw ApiFailure("녹음이 끝난 뒤 말로 입력해 주세요", code = "microphone_busy")
            // API 31 이전은 available에서 중단. 일반 createSpeechRecognizer를 호출하지 않는다.
            val sr = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            recognizer = sr; active = runId; pending = false
            sr.setRecognitionListener(object : RecognitionListener {
                private fun current() = active == runId && recognizer === sr
                override fun onReadyForSpeech(params: Bundle?) { if (current()) emit("status", mapOf("state" to "ready")) }
                override fun onBeginningOfSpeech() { if (current()) emit("status", mapOf("state" to "speech")) }
                override fun onEndOfSpeech() { if (current()) { emit("status", mapOf("state" to "waiting_final")); arm(runId, 15000) } }
                override fun onPartialResults(partialResults: Bundle?) { if (current()) emit("partial", mapOf("results" to results(partialResults))) }
                override fun onResults(results: Bundle?) { if (current()) finish("final", mapOf("results" to results(results))) }
                override fun onError(error: Int) { if (current()) finish("error", mapOf("code" to error, "name" to errorName(error))) }
                override fun onRmsChanged(rmsdB: Float) { }
                override fun onBufferReceived(buffer: ByteArray?) { }
                override fun onEvent(eventType: Int, params: Bundle?) { }
            })
            sr.startListening(intent())
            emit("started", mapOf("engine" to "createOnDeviceSpeechRecognizer", "language" to "ko-KR"))
            arm(runId, 90000)
        } catch (e: Exception) {
            if (expected == generation) { active = null; recognizer?.destroy(); recognizer = null }
            throw e
        } finally { if (expected == generation) pending = false }
    }
    private fun results(bundle: Bundle?) = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.take(5).orEmpty()
    private fun emit(type: String, extra: JsonObject = emptyMap()) {
        mutable.tryEmit(mapOf("type" to type, "runId" to active, "sentence" to "현장 기록 자유 발화", "diagnostic" to false) + extra)
    }
    private fun arm(id: String, delay: Long) {
        deadline?.let(handler::removeCallbacks)
        deadline = Runnable { if (active == id) finish("diagnostic_error", mapOf("reason" to "callback_timeout", "timeoutMs" to delay)) }
            .also { handler.postDelayed(it, delay) }
    }
    private fun finish(type: String, extra: JsonObject = emptyMap()) {
        if (active == null) return
        emit(type, extra); active = null
        deadline?.let(handler::removeCallbacks); deadline = null
        val old = recognizer; recognizer = null; old?.destroy()
    }
    override suspend fun stop(cancel: Boolean) {
        if (cancel || pending) cancel("user_or_screen_cancelled") else active?.let {
            try { recognizer?.stopListening(); emit("status", mapOf("state" to "waiting_final")); arm(it, 15000)
            } catch (e: Exception) { finish("diagnostic_error", mapOf("reason" to e.toString())) }
        }
    }
    private fun cancel(reason: String) { ++generation; pending = false; microphone.cancel("speech"); finish("cancelled", mapOf("reason" to reason)) }
    fun onStop() = cancel("activity_stopped")
    override fun close() { onStop(); handler.removeCallbacksAndMessages(null) }
    private fun errorName(code: Int) = when (code) {
        1 -> "ERROR_NETWORK_TIMEOUT"; 2 -> "ERROR_NETWORK"; 3 -> "ERROR_AUDIO"; 4 -> "ERROR_SERVER"
        5 -> "ERROR_CLIENT"; 6 -> "ERROR_SPEECH_TIMEOUT"; 7 -> "ERROR_NO_MATCH"; 8 -> "ERROR_RECOGNIZER_BUSY"
        9 -> "ERROR_INSUFFICIENT_PERMISSIONS"; 10 -> "ERROR_TOO_MANY_REQUESTS"; 11 -> "ERROR_SERVER_DISCONNECTED"
        12 -> "ERROR_LANGUAGE_NOT_SUPPORTED"; 13 -> "ERROR_LANGUAGE_UNAVAILABLE"; 14 -> "ERROR_CANNOT_CHECK_SUPPORT"
        15 -> "ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS"; else -> "UNKNOWN_ERROR"
    }
}
