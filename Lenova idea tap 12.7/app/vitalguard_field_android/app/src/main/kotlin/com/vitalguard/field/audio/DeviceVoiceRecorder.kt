package com.vitalguard.field.audio

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.AtomicFile
import android.content.Context
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.JsonObject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.util.UUID
import java.security.MessageDigest
import org.json.JSONObject

// RecorderNative.kt의 ADTS 저널/복구/재생을 유지하고 Flutter 채널만 Flow/계약으로 교체.
class DeviceVoiceRecorder(
    private val context: Context,
    private val microphone: MicrophoneAccess,
    private val speechBusy: () -> Boolean,
) : RecoverableVoiceRecorder {
    companion object {
        private const val MAX_DURATION_MS = 180_000
        private const val MAX_BYTES = 10L * 1024 * 1024
    }

    private val mutableEvents = MutableSharedFlow<JsonObject>(extraBufferCapacity = 32)
    override val events = mutableEvents.asSharedFlow()
    private fun emit(type: String, data: JsonObject = emptyMap()) { mutableEvents.tryEmit(data + ("type" to type)) }
    private val main = Handler(Looper.getMainLooper())
    private var recorder: MediaRecorder? = null
    private var recordingFile: File? = null
    private var lastRecording: Map<String, Any>? = null
    private var starting = false
    private var generation = 0
    private var draftKey: String? = null
    private var startedAt = 0L
    private var player: MediaPlayer? = null
    private var previewFile: File? = null
    private val deadline = Runnable { autoStop("maxDuration") }

    val isBusy: Boolean get() = recorder != null || starting || player != null

    private fun hasPermission() =
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    override suspend fun start() = requestStart(null)
    override suspend fun startDraft(draftKey: String) = requestStart(draftKey)
    private suspend fun requestStart(key: String?) {
        if (isBusy || speechBusy()) throw ApiFailure("다른 음성 입력이 끝난 뒤 녹음해 주세요", code = "microphone_busy")
        val expected = ++generation
        lastRecording = null
        recordingFile = null
        draftKey = key
        starting = true
        try {
            microphone.request("recorder")
            if (expected != generation || !starting) throw ApiFailure("녹음 준비가 중단됐습니다", code = "recording_cancelled")
            begin()
        } finally { if (expected == generation) starting = false }
    }
    override suspend fun stop(): VoiceRecording? {
        cancelPending()
        return finish("manual")?.let { VoiceRecording.fromJson(it) }
    }
    override suspend fun recoverDraft(draftKey: String): VoiceRecording? = recover(draftKey)?.let { VoiceRecording.fromJson(it) }
    override suspend fun read(path: String): ByteArray = withContext(Dispatchers.IO) { ownedFile(path).readBytes() }

    @Suppress("DEPRECATION")
    private fun begin() {
        if (speechBusy()) throw ApiFailure("다른 음성 입력이 끝난 뒤 녹음해 주세요", code = "microphone_busy")
        if (!hasPermission()) throw ApiFailure("마이크 권한이 필요합니다", code = "microphone_denied")
        // cacheDir는 OS 정리 대상이다. 초안은 앱 전용 filesDir에 계정·사진별로 보관한다.
        val folder = draftKey?.let(::draftDirectory) ?: context.cacheDir
        val file = File(folder, "voice-recording-${UUID.randomUUID()}.aac")
        try {
            check(draftKey == null || !File(folder, "draft.json").exists()) {
                "이 사진의 이전 녹음이 남아 있습니다. 먼저 복원한 녹음을 확인해 주세요"
            }
            lastRecording = null
            recordingFile = file
            val source = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
            recorder = source
            source.setAudioSource(MediaRecorder.AudioSource.MIC)
            // ADTS는 프레임마다 헤더가 있어 프로세스 종료로 마지막 쓰기가
            // 잘려도 앞의 소리를 읽을 수 있다. 전송본은 정지/복구 때 M4A로 만든다.
            source.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
            source.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            // 말소리용 모노 16 kHz / 32 kbps. 3분 약 720 KB + 컨테이너로 10 MiB에 여유.
            source.setAudioChannels(1)
            source.setAudioSamplingRate(16_000)
            source.setAudioEncodingBitRate(32_000)
            source.setMaxDuration(MAX_DURATION_MS)
            source.setMaxFileSize(9L * 1024 * 1024) // 컨테이너 마감 여유를 둔 보조 안전장치.
            source.setOutputFile(file.absolutePath)
            source.setOnInfoListener { current, what, _ ->
                if (recorder === current) {
                    when (what) {
                        MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED -> autoStop("maxDuration")
                        MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED -> autoStop("maxSize")
                    }
                }
            }
            source.setOnErrorListener { current, _, _ ->
                if (recorder === current) autoStop("recorderError")
            }
            source.prepare()
            // 시작 전에 경로를 기록한다. onStop 이후 앱가 종료돼도 원본을 찾는다.
            writeJournal(mapOf("path" to file.absolutePath, "reason" to "interrupted"))
            source.start()
            startedAt = SystemClock.elapsedRealtime()
            main.postDelayed(deadline, MAX_DURATION_MS.toLong())
        } catch (error: Exception) {
            releaseRecorder()
            file.delete()
            clearJournal(file)
            recordingFile = null
            throw ApiFailure(error.message ?: "녹음을 시작하지 못했습니다", code = "recording_start_failed")
        }
    }

    private fun releaseRecorder() {
        main.removeCallbacks(deadline)
        val previous = recorder
        recorder = null
        runCatching { previous?.release() }
    }

    private fun finish(reason: String): Map<String, Any>? {
        val source = recorder ?: return lastRecording
        val sourceFile = requireNotNull(recordingFile)
        val elapsed = (SystemClock.elapsedRealtime() - startedAt).coerceIn(0, MAX_DURATION_MS.toLong())
        val stopped = runCatching { source.stop() }
        releaseRecorder()
        if (sourceFile.extension == "aac" && completeAdtsLength(sourceFile.readBytes()) == 0) {
            delete(sourceFile) // 소리가 한 프레임도 없는 즉시 정지는 다시 녹음할 수 있게 한다.
            recordingFile = null
            throw IllegalStateException("녹음이 너무 짧습니다. 다시 녹음해 주세요")
        }
        val file = if (sourceFile.extension == "aac") remux(sourceFile) else sourceFile
        recordingFile = file
        // 상한 자동 정지 직후 stop()이 예외여도 완성된 m4a는 보존한다.
        // 반대로 즉시 정지해 헤더만 생긴 파일은 유효한 녹음으로 보내지 않는다.
        val metadata = MediaMetadataRetriever()
        val duration = try {
            metadata.setDataSource(file.absolutePath)
            metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        } catch (_: Exception) {
            null
        } finally {
            runCatching { metadata.release() }
        }
        if (file.length() == 0L || duration == 0L) {
            file.delete()
            clearJournal(file)
            recordingFile = null
            throw IllegalStateException("녹음이 너무 짧거나 소리를 저장하지 못했습니다. 다시 녹음해 주세요")
        }
        check(duration != null || stopped.isSuccess) {
            "중단된 녹음을 열지 못했습니다. 기기 원본은 삭제하지 않고 보관합니다"
        }
        return mapOf(
            "path" to file.absolutePath,
            "durationMs" to (duration ?: elapsed).coerceIn(0, MAX_DURATION_MS.toLong()),
            "byteLength" to file.length(),
            "reason" to if (reason == "manual" && elapsed >= MAX_DURATION_MS) "maxDuration" else reason,
        ).also {
            writeJournal(it) // Flow 이벤트보다 먼저 원자적으로 보관한다.
            lastRecording = it
        }
    }

    private fun draftDirectory(key: String): File {
        val id = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        return File(context.filesDir, "voice-drafts/$id").also { it.mkdirs() }
    }

    private fun remux(source: File): File {
        val length = completeAdtsLength(source.readBytes())
        check(length > 0) { "완료된 녹음 프레임이 없습니다. 기기 원본은 보관합니다" }
        val output = File(source.parentFile, "${source.nameWithoutExtension}.m4a")
        val pending = File("${output.path}.pending")
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
            FileInputStream(source).use { input ->
                extractor.setDataSource(input.fd, 0L, length.toLong())
                check(extractor.trackCount == 1) { "녹음 트랙을 확인해 주세요" }
                val format = extractor.getTrackFormat(0)
                check(format.getString(MediaFormat.KEY_MIME) == "audio/mp4a-latm")
                extractor.selectTrack(0)
                val writer = MediaMuxer(pending.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                muxer = writer
                val track = writer.addTrack(format)
                writer.start()
                val buffer = ByteBuffer.allocate(16 * 1024)
                val info = MediaCodec.BufferInfo()
                var samples = 0
                while (true) {
                    buffer.clear()
                    val size = extractor.readSampleData(buffer, 0)
                    if (size < 0) break
                    info.set(0, size, extractor.sampleTime, MediaCodec.BUFFER_FLAG_KEY_FRAME)
                    writer.writeSampleData(track, buffer, info)
                    samples++
                    extractor.advance()
                }
                check(samples > 0) { "복구할 녹음 프레임이 없습니다" }
                writer.stop()
                writer.release()
                muxer = null
            }
            check(pending.renameTo(output)) { "복구한 녹음을 보관하지 못했습니다" }
            return output // AAC 원본은 명시적 취소/전송 성공 때까지 함께 보관한다.
        } finally {
            runCatching { muxer?.release() }
            extractor.release()
            pending.delete()
        }
    }

    private fun writeJournal(value: Map<String, Any>) {
        val key = draftKey ?: return
        val journal = AtomicFile(File(draftDirectory(key), "draft.json"))
        val output = journal.startWrite()
        try {
            output.write(JSONObject(value).toString().toByteArray(Charsets.UTF_8))
            journal.finishWrite(output)
        } catch (error: Exception) {
            journal.failWrite(output)
            throw error
        }
    }

    private fun clearJournal(file: File) {
        val journal = AtomicFile(File(file.parentFile, "draft.json"))
        if (!journal.baseFile.exists()) return
        val saved = JSONObject(journal.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
        val savedPath = saved.optString("path")
        val sourcePath = File(file.parentFile, "${file.nameWithoutExtension}.aac").absolutePath
        if (savedPath == file.absolutePath || savedPath == sourcePath) journal.delete()
    }

    private fun recover(key: String): Map<String, Any>? {
        if (recorder != null) {
            check(draftKey == key) { "다른 사진의 녹음이 진행 중입니다" }
            return finish("interrupted")
        }
        val folder = draftDirectory(key)
        val journal = AtomicFile(File(folder, "draft.json"))
        if (!journal.baseFile.exists() && !File(folder, "draft.json.bak").exists()) return null
        val saved = JSONObject(journal.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
        val source = ownedFile(saved.getString("path"))
        check(source.parentFile == folder.canonicalFile) { "녹음 소유자가 일치하지 않습니다" }
        check(source.exists() && source.length() > 0) { "중단된 녹음 파일을 확인해 주세요" }
        val file = if (source.extension == "aac") remux(source) else source
        val metadata = MediaMetadataRetriever()
        val duration = try {
            metadata.setDataSource(file.absolutePath)
            metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        } finally {
            runCatching { metadata.release() }
        }
        check(duration != null && duration > 0) {
            "중단된 녹음을 열지 못했습니다. 기기 원본은 삭제하지 않고 보관합니다"
        }
        return mapOf(
            "path" to file.absolutePath,
            "durationMs" to duration.coerceAtMost(MAX_DURATION_MS.toLong()),
            "byteLength" to file.length(),
            "reason" to "interrupted",
        )
    }

    private fun autoStop(reason: String) {
        if (recorder == null) return
        try {
            finish(reason)?.let { emit("stopped", it) }
        } catch (error: Exception) {
            emit("error", mapOf("message" to error.message))
        }
    }

    private fun cancelPending() {
        ++generation
        starting = false
        microphone.cancel("recorder")
    }

    private fun ownedFile(path: String): File {
        val file = File(path).canonicalFile
        val privateDraft = file.parentFile?.parentFile == File(context.filesDir, "voice-drafts").canonicalFile
        require((file.parentFile == context.cacheDir.canonicalFile || privateDraft) && file.name.startsWith("voice-") && file.extension in setOf("m4a", "aac")) {
            "이 앱의 임시 녹음 파일만 삭제할 수 있습니다"
        }
        return file
    }

    private fun delete(file: File?) {
        check(file == null || !file.exists() || file.delete()) { "기기 녹음 파일을 삭제하지 못했습니다" }
        if (file != null) {
            val raw = File(file.parentFile, "${file.nameWithoutExtension}.aac")
            check(!raw.exists() || raw.delete()) { "기기 녹음 원본을 삭제하지 못했습니다" }
            clearJournal(file)
        }
    }

    override suspend fun cancel(path: String?) {
        val requested = path?.let(::ownedFile)
        // 이전 사진의 전송 완료 콜백이 새 사진의 녹음을 중단하지 않게 경로를 대조한다.
        if (requested != null && requested != recordingFile?.canonicalFile) {
            delete(requested)
            return
        }
        cancelPending()
        runCatching { recorder?.stop() }
        releaseRecorder()
        stopPlayback()
        delete(recordingFile)
        recordingFile = null
        lastRecording = null
    }

    override suspend fun play(audio: ByteArray) {
        if (recorder != null || starting || speechBusy()) {
            throw ApiFailure("음성 입력이 끝난 뒤 들어 주세요", code = "microphone_busy")
        }
        if (audio.isEmpty() || audio.size > MAX_BYTES) {
            throw ApiFailure("재생할 녹음을 확인해 주세요", code = "invalid_audio")
        }
        stopPlayback()
        try {
            val file = File(context.cacheDir, "voice-preview-${UUID.randomUUID()}.m4a")
            previewFile = file
            file.writeBytes(audio)
            val preview = MediaPlayer()
            player = preview
            preview.setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            preview.setDataSource(file.absolutePath)
            preview.setOnPreparedListener {
                if (player === it) {
                    try {
                        it.start()
                    } catch (_: Exception) {
                        stopPlayback()
                        emit("playbackStopped", mapOf("message" to "녹음을 재생하지 못했습니다"))
                    }
                }
            }
            preview.setOnCompletionListener {
                if (player === it) stopPlayback()
            }
            preview.setOnErrorListener { current, _, _ ->
                if (player === current) {
                    stopPlayback()
                    emit("playbackStopped", mapOf("message" to "녹음을 재생하지 못했습니다"))
                }
                true
            }
            preview.prepareAsync()
        } catch (error: Exception) {
            stopPlayback()
            throw error
        }
    }

    override suspend fun stopPlay() = stopPlayback()

    private fun stopPlayback() {
        val previous = player
        player = null
        runCatching { previous?.release() }
        previewFile?.delete()
        previewFile = null
        if (previous != null) emit("playbackStopped")
    }

    fun onStop() {
        cancelPending()
        autoStop("background")
        stopPlayback()
    }

    override fun close() {
        onStop() // 유효한 녹음은 삭제하지 않고 앱 초안에서 정리한다.
        main.removeCallbacksAndMessages(null)
    }
}
