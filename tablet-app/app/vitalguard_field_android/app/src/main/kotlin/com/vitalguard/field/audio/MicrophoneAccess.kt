package com.vitalguard.field.audio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import com.vitalguard.field.data.contracts.ApiFailure
import kotlinx.coroutines.CompletableDeferred

fun interface MicrophoneActivityHost { fun requestMicrophonePermission() }

// Activity를 ViewModel에 보관하지 않는다. 회전 후 새 host에 재연결한다.
class MicrophoneAccess(private val context: Context) {
    private var host: MicrophoneActivityHost? = null
    private data class Request(val owner: String, val result: CompletableDeferred<Unit>)
    private var pending: Request? = null
    fun attach(host: MicrophoneActivityHost) { this.host = host }
    fun detach(host: MicrophoneActivityHost) { if (this.host === host) this.host = null }
    suspend fun request(owner: String) {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) return
        if (pending != null) throw ApiFailure("다른 음성 입력이 끝난 뒤 녹음해 주세요", code = "microphone_busy")
        val activity = host ?: throw ApiFailure("마이크 권한이 필요합니다", code = "microphone_denied")
        val request = Request(owner, CompletableDeferred())
        pending = request
        try { activity.requestMicrophonePermission() } catch (e: Exception) { pending = null; throw e }
        request.result.await()
    }
    fun onResult(granted: Boolean) {
        val request = pending ?: return
        pending = null
        if (granted) request.result.complete(Unit)
        else request.result.completeExceptionally(ApiFailure("마이크 권한이 필요합니다", code = "microphone_denied"))
    }
    fun cancel(owner: String) {
        pending?.takeIf { it.owner == owner }?.result?.completeExceptionally(ApiFailure("녹음 준비가 중단됐습니다", code = "recording_cancelled"))
        // 취소한 요청의 늦은 권한 결과가 다음 요청을 시작하지 않도록 결과 수신 때까지 슬롯 유지.
    }
}
