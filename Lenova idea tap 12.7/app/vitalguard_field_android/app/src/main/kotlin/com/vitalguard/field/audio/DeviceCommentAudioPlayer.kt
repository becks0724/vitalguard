package com.vitalguard.field.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import com.vitalguard.field.data.record.CommentAudioPlayer
import kotlinx.coroutines.*
import java.io.File
import java.util.UUID

/** 서명 URL 다운로드는 FieldController에서 끝낸다. MediaPlayer에는 기기 임시 파일만 준다. */
class DeviceCommentAudioPlayer(context: Context) : CommentAudioPlayer {
    private val cache = context.applicationContext.cacheDir
    private var player: MediaPlayer? = null
    private var file: File? = null
    override suspend fun play(bytes: ByteArray, onStopped: (String?) -> Unit) {
        stop()
        val source = File(cache, "calendar-voice-${UUID.randomUUID()}.m4a")
        try {
            withContext(Dispatchers.IO) { source.writeBytes(bytes) }
            currentCoroutineContext().ensureActive()
            val current = MediaPlayer()
            player = current; file = source
            current.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            current.setDataSource(source.absolutePath)
            current.setOnPreparedListener {
                if (player === it) try { it.start() } catch (_: Exception) {
                    stop(); onStopped("음성을 재생하지 못했습니다")
                }
            }
            current.setOnCompletionListener { if (player === it) { stop(); onStopped(null) } }
            current.setOnErrorListener { failed, _, _ ->
                if (player === failed) { stop(); onStopped("음성을 재생하지 못했습니다") }; true
            }
            current.prepareAsync()
        } catch (e: Exception) {
            source.delete()
            if (file == source) stop()
            throw e
        }
    }
    override fun stop() {
        val old = player; player = null
        runCatching { old?.release() }
        file?.delete(); file = null
    }
}
