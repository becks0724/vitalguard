package com.vitalguard.vitalguard_field

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.ActivityCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.io.File

class MainActivity : FlutterActivity() {
    private var fieldStorage: FieldStorage? = null
    private var captureNative: CaptureNative? = null
    private var recorderNative: RecorderNative? = null
    private val handler = Handler(Looper.getMainLooper())
    private var sink: EventChannel.EventSink? = null
    private var recognizer: SpeechRecognizer? = null
    private var supportProbe: SpeechRecognizer? = null
    private var supportGeneration = 0
    private var active: Trial? = null
    private var pendingPermission: PendingStart? = null
    private var deadline: Runnable? = null
    private var lastEnvironment: Map<String, Any>? = null
    private val logFile get() = File(filesDir, "p4-stt.jsonl")

    private data class Trial(
        val id: String,
        val sentence: String,
        val startedAt: Long,
        val environmentAtStart: Map<String, Any>,
        val diagnostic: Boolean,
        var firstPartialMs: Long? = null,
        var environmentChanged: Boolean = false,
    )

    private data class PendingStart(
        val id: String, val sentence: String, val result: MethodChannel.Result, val diagnostic: Boolean,
    )

    // 실제 설정을 주기적으로 다시 읽는다. 시작/종료/콜백에도 별도 스냅숏을 남긴다.
    // 이 폴링을 물리적 네트워크 격리의 완전한 증명이라고 부르지 않는다.
    private val environmentPoll = object : Runnable {
        override fun run() {
            val current = environment()
            active?.let { if (current != it.environmentAtStart) it.environmentChanged = true }
            if (current != lastEnvironment) {
                lastEnvironment = current
                emit("environment", mapOf("environment" to current), active)
            }
            if (sink != null) handler.postDelayed(this, 1000)
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        fieldStorage = FieldStorage(this, flutterEngine.dartExecutor.binaryMessenger)
        captureNative = CaptureNative(this, flutterEngine.dartExecutor.binaryMessenger)
        recorderNative = RecorderNative(this, flutterEngine.dartExecutor.binaryMessenger) {
            active != null || pendingPermission != null
        }
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, "vitalguard/stt_events")
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                    sink = events
                    lastEnvironment = null
                    handler.removeCallbacks(environmentPoll)
                    handler.post(environmentPoll)
                }
                override fun onCancel(arguments: Any?) {
                    cancel("event_stream_closed")
                    sink = null
                    handler.removeCallbacks(environmentPoll)
                    clearSupportProbe()
                }
            })
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "vitalguard/stt")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isOnDeviceAvailable" -> {
                        val available = onDeviceAvailable()
                        emit("availability", mapOf("available" to available, "apiLevel" to Build.VERSION.SDK_INT))
                        result.success(mapOf(
                            "available" to available,
                            "environment" to environment(),
                            "logPath" to logFile.absolutePath,
                        ))
                        if (available && active == null && pendingPermission == null) probeKorean()
                    }
                    "start" -> requestStart(call, result)
                    "stop" -> {
                        if (call.argument<Boolean>("cancel") == true) {
                            cancel("user_or_screen_cancelled")
                        } else {
                            active?.let { trial ->
                                try {
                                    recognizer?.stopListening()
                                    emit("status", mapOf("state" to "waiting_final"), trial)
                                    armDeadline(trial.id, 15000)
                                } catch (e: Exception) {
                                    finish("diagnostic_error", mapOf("reason" to e.toString()))
                                }
                            }
                        }
                        result.success(null)
                    }
                    // 사람이 읽은 원문과 실제 콜백을 원형대로 가져오는 진단용 보조 메서드.
                    "readLog" -> result.success(if (logFile.exists()) logFile.readText() else "")
                    else -> result.notImplemented()
                }
            }
    }

    private fun onDeviceAvailable(): Boolean =
        Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)

    private fun environment(): Map<String, Any> {
        val connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        return mapOf(
            "airplaneMode" to (Settings.Global.getInt(contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) == 1),
            "wifiEnabled" to wifi.isWifiEnabled,
            "activeNetwork" to (connectivity.activeNetwork != null),
            "microphoneGranted" to (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED),
        )
    }

    private fun recognitionIntent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
    }

    private fun clearSupportProbe() {
        supportGeneration++
        supportProbe?.destroy()
        supportProbe = null
    }

    private fun probeKorean() {
        clearSupportProbe()
        if (Build.VERSION.SDK_INT < 33) {
            emit("support", mapOf("state" to "check_api_unavailable"))
            return
        }
        val generation = supportGeneration
        try {
            val probe = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            supportProbe = probe
            emit("support", mapOf("state" to "checking"))
            probe.checkRecognitionSupport(recognitionIntent(), mainExecutor,
                object : RecognitionSupportCallback {
                    override fun onSupportResult(support: RecognitionSupport) {
                        if (generation != supportGeneration) return
                        emit("support", mapOf(
                            "state" to "reported",
                            "installed" to support.installedOnDeviceLanguages,
                            "pending" to support.pendingOnDeviceLanguages,
                            "downloadable" to support.supportedOnDeviceLanguages,
                            "online" to support.onlineLanguages,
                        ))
                        clearSupportProbe()
                    }
                    override fun onError(error: Int) {
                        if (generation != supportGeneration) return
                        emit("support", mapOf("state" to "error", "code" to error, "name" to errorName(error)))
                        clearSupportProbe()
                    }
                })
            handler.postDelayed({
                if (generation == supportGeneration && supportProbe != null) {
                    emit("support", mapOf("state" to "no_callback"))
                    clearSupportProbe()
                }
            }, 10000)
        } catch (e: Exception) {
            emit("support", mapOf("state" to "exception", "reason" to e.toString()))
            clearSupportProbe()
        }
    }

    private fun requestStart(call: MethodCall, result: MethodChannel.Result) {
        if (recorderNative?.isBusy == true) {
            result.error("microphone_busy", "녹음이나 미리듣기가 끝난 뒤 말로 입력해 주세요", null)
            return
        }
        if (active != null || pendingPermission != null) {
            result.error("busy", "이미 측정 또는 마이크 권한 요청 중입니다", null)
            return
        }
        if (sink == null || !onDeviceAvailable()) {
            result.error("not_available", "온디바이스 인식기 또는 이벤트 연결이 없습니다", null)
            return
        }
        val id = call.argument<String>("runId")
        val sentence = call.argument<String>("sentence")
        if (id.isNullOrBlank() || sentence.isNullOrBlank()) {
            result.error("invalid_request", "측정 ID와 읽을 문장이 필요합니다", null)
            return
        }
        clearSupportProbe()
        val pending = PendingStart(id, sentence, result, call.argument<Boolean>("diagnostic") != false)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingPermission = pending
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 4101)
        } else {
            begin(pending)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (captureNative?.onRequestPermissionsResult(requestCode, grantResults) == true) return
        if (recorderNative?.onRequestPermissionsResult(requestCode, grantResults) == true) return
        if (requestCode != 4101) return
        val pending = pendingPermission ?: return
        pendingPermission = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            begin(pending)
        } else {
            // 준비 실패를 SpeechRecognizer가 반환한 오류코드인 것처럼 만들지 않는다.
            pending.result.error("microphone_denied", "마이크 권한이 없어 측정하지 않았습니다", null)
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        captureNative?.onActivityResult(requestCode, resultCode, data)
    }

    private fun begin(pending: PendingStart) {
        if (recorderNative?.isBusy == true) {
            pending.result.error("microphone_busy", "녹음이 끝난 뒤 말로 입력해 주세요", null)
            return
        }
        if (!onDeviceAvailable()) {
            pending.result.error("not_available", "온디바이스 인식기를 사용할 수 없습니다", null)
            return
        }
        try {
            // 일반 createSpeechRecognizer로 폴백하지 않는다. EXTRA_PREFER_OFFLINE만으로 보장하지 않는다.
            val sr = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            recognizer = sr
            val trial = Trial(pending.id, pending.sentence, SystemClock.elapsedRealtime(), environment(), pending.diagnostic)
            active = trial
            sr.setRecognitionListener(object : RecognitionListener {
                private fun current() = active?.id == trial.id
                override fun onReadyForSpeech(params: Bundle?) {
                    if (current()) emit("status", mapOf("state" to "ready"), trial)
                }
                override fun onBeginningOfSpeech() {
                    if (current()) emit("status", mapOf("state" to "speech"), trial)
                }
                override fun onEndOfSpeech() {
                    if (current()) {
                        emit("status", mapOf("state" to "waiting_final"), trial)
                        armDeadline(trial.id, 15000)
                    }
                }
                override fun onPartialResults(partialResults: Bundle?) {
                    if (!current()) return
                    if (trial.firstPartialMs == null) trial.firstPartialMs = SystemClock.elapsedRealtime() - trial.startedAt
                    emit("partial", mapOf("results" to (partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: emptyList<String>())), trial)
                }
                override fun onResults(results: Bundle?) {
                    if (current()) finish("final", mapOf("results" to (results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: emptyList<String>())))
                }
                override fun onError(error: Int) {
                    if (current()) finish("error", mapOf("code" to error, "name" to errorName(error)))
                }
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {} // 원음은 저장하지 않는다.
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            sr.startListening(recognitionIntent())
            emit("started", mapOf("engine" to "createOnDeviceSpeechRecognizer", "language" to "ko-KR"), trial)
            armDeadline(trial.id, 90000) // 측정 중 무응답으로 마이크가 계속 열리지 않도록 하는 진단 상한.
            pending.result.success(null)
        } catch (e: Exception) {
            active = null
            recognizer?.destroy()
            recognizer = null
            pending.result.error("start_failed", e.toString(), null)
        }
    }

    private fun armDeadline(id: String, delay: Long) {
        deadline?.let(handler::removeCallbacks)
        deadline = Runnable {
            if (active?.id == id) {
                finish("diagnostic_error", mapOf("reason" to "callback_timeout", "timeoutMs" to delay))
            }
        }.also { handler.postDelayed(it, delay) }
    }

    private fun emit(type: String, extra: Map<String, Any?> = emptyMap(), trial: Trial? = null) {
        val current = environment()
        if (trial != null && current != trial.environmentAtStart) trial.environmentChanged = true
        val event = mutableMapOf<String, Any?>("type" to type, "atEpochMs" to System.currentTimeMillis(), "environment" to current)
        if (trial != null) event.putAll(mapOf(
            "runId" to trial.id, "sentence" to trial.sentence,
            "elapsedMs" to (SystemClock.elapsedRealtime() - trial.startedAt),
            "firstPartialMs" to trial.firstPartialMs,
            "environmentAtStart" to trial.environmentAtStart,
            "environmentChanged" to trial.environmentChanged,
        ))
        event.putAll(extra)
        try {
            // 제품 입력의 미확인 후보는 진단 로그에도 저장하지 않는다(I-5).
            if (trial == null || trial.diagnostic) logFile.appendText(JSONObject(event).toString() + "\n")
        } catch (e: Exception) {
            event["logWriteError"] = e.toString()
        }
        sink?.success(event)
    }

    private fun finish(type: String, extra: Map<String, Any?>) {
        val trial = active ?: return
        emit(type, extra, trial)
        active = null // destroy 뒤의 늦은 콜백을 차단한다.
        deadline?.let(handler::removeCallbacks)
        deadline = null
        val old = recognizer
        recognizer = null
        old?.destroy()
    }

    private fun cancel(reason: String) {
        pendingPermission?.result?.error("cancelled", "권한 요청 중 화면을 벗어나 측정하지 않았습니다", null)
        pendingPermission = null
        if (active != null) finish("cancelled", mapOf("reason" to reason))
    }

    override fun onStop() {
        recorderNative?.onStop()
        cancel("activity_stopped")
        clearSupportProbe()
        super.onStop()
    }

    override fun onDestroy() {
        recorderNative?.close()
        recorderNative = null
        captureNative?.close()
        captureNative = null
        fieldStorage?.close()
        cancel("activity_destroyed")
        clearSupportProbe()
        sink = null
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun errorName(code: Int): String = when (code) {
        1 -> "ERROR_NETWORK_TIMEOUT"
        2 -> "ERROR_NETWORK"
        3 -> "ERROR_AUDIO"
        4 -> "ERROR_SERVER"
        5 -> "ERROR_CLIENT"
        6 -> "ERROR_SPEECH_TIMEOUT"
        7 -> "ERROR_NO_MATCH"
        8 -> "ERROR_RECOGNIZER_BUSY"
        9 -> "ERROR_INSUFFICIENT_PERMISSIONS"
        10 -> "ERROR_TOO_MANY_REQUESTS"
        11 -> "ERROR_SERVER_DISCONNECTED"
        12 -> "ERROR_LANGUAGE_NOT_SUPPORTED"
        13 -> "ERROR_LANGUAGE_UNAVAILABLE"
        14 -> "ERROR_CANNOT_CHECK_SUPPORT"
        15 -> "ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS"
        else -> "UNKNOWN_ERROR"
    }
}
