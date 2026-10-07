package com.vitalguard.vitalguard_field

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
import androidx.core.app.ActivityCompat
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.util.UUID
import java.security.MessageDigest
import org.json.JSONObject

class RecorderNative(
    private val activity: MainActivity,
    messenger: BinaryMessenger,
    private val speechBusy: () -> Boolean,
) {
    companion object {
        const val MICROPHONE_PERMISSION_REQUEST = 4103
        private const val MAX_DURATION_MS = 180_000
        private const val MAX_BYTES = 10L * 1024 * 1024
    }

    private val channel = MethodChannel(messenger, "vitalguard/recorder")
    private val main = Handler(Looper.getMainLooper())
    private var recorder: MediaRecorder? = null
    private var recordingFile: File? = null
    private var lastRecording: Map<String, Any>? = null
    private var pendingStart: MethodChannel.Result? = null
    private var draftKey: String? = null
    private var startedAt = 0L
    private var player: MediaPlayer? = null
    private var previewFile: File? = null
    private val deadline = Runnable { autoStop("maxDuration") }

    val isBusy: Boolean get() = recorder != null || pendingStart != null || player != null

    init {
        channel.setMethodCallHandler(::handle)
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "start" -> requestStart(call.argument<String>("draftKey"), result)
                "recover" -> result.success(recover(requireNotNull(call.argument<String>("draftKey"))))
                "stop" -> {
                    cancelPending()
                    result.success(finish("manual"))
                }
                "cancel" -> {
                    cancel(call.argument<String>("path"))
                    result.success(null)
                }
                "play" -> play(call, result)
                "stopPlay" -> {
                    stopPlay()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        } catch (error: Exception) {
            result.error("recorder_failed", error.message ?: "녹음 처리에 실패했습니다", null)
        }
    }

    private fun hasPermission() =
        activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun requestStart(key: String?, result: MethodChannel.Result) {
        if (isBusy || speechBusy()) {
            result.error("microphone_busy", "다른 음성 입력이 끝난 뒤 녹음해 주세요", null)
            return
        }
        // CaptureNative.requestLocation과 동일하게 결과를 보관하고 권한 콜백에서 재개한다.
        lastRecording = null
        recordingFile = null
        draftKey = key
        pendingStart = result
        if (!hasPermission()) {
            try {
                ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(Manifest.permission.RECORD_AUDIO),
                    MICROPHONE_PERMISSION_REQUEST,
                )
            } catch (error: Exception) {
                pendingStart = null
                throw error
            }
            return
        }
        begin()
    }

    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != MICROPHONE_PERMISSION_REQUEST) return false
        if (pendingStart == null) return true // 취소·백그라운드 이후 늦게 온 승인.
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            begin()
        } else {
            pendingStart?.error("microphone_denied", "마이크 권한이 필요합니다", null)
            pendingStart = null
        }
        return true
    }

    @Suppress("DEPRECATION")
    private fun begin() {
        val pending = pendingStart ?: return
        pendingStart = null
        if (speechBusy()) {
            pending.error("microphone_busy", "다른 음성 입력이 끝난 뒤 녹음해 주세요", null)
            return
        }
        if (!hasPermission()) {
            pending.error("microphone_denied", "마이크 권한이 필요합니다", null)
            return
        }
        // cacheDir는 OS 정리 대상이다. 초안은 앱 전용 filesDir에 계정·사진별로 보관한다.
        val folder = draftKey?.let(::draftDirectory) ?: activity.cacheDir
        val file = File(folder, "voice-recording-${UUID.randomUUID()}.aac")
        try {
            check(draftKey == null || !File(folder, "draft.json").exists()) {
                "이 사진의 이전 녹음이 남아 있습니다. 먼저 복원한 녹음을 확인해 주세요"
            }
            lastRecording = null
            recordingFile = file
            val source = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(activity) else MediaRecorder()
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
            // 시작 전에 경로를 기록한다. onStop 이후 Dart가 종료돼도 원본을 찾는다.
            writeJournal(mapOf("path" to file.absolutePath, "reason" to "interrupted"))
            source.start()
            startedAt = SystemClock.elapsedRealtime()
            main.postDelayed(deadline, MAX_DURATION_MS.toLong())
            pending.success(null)
        } catch (error: Exception) {
            releaseRecorder()
            file.delete()
            clearJournal(file)
            recordingFile = null
            pending.error("recording_start_failed", error.message ?: "녹음을 시작하지 못했습니다", null)
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
            writeJournal(it) // Flutter 콜백보다 먼저 원자적으로 보관한다.
            lastRecording = it
        }
    }

    private fun draftDirectory(key: String): File {
        val id = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        return File(activity.filesDir, "voice-drafts/$id").also { it.mkdirs() }
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
            finish(reason)?.let { channel.invokeMethod("stopped", it) }
        } catch (error: Exception) {
            channel.invokeMethod("error", mapOf("message" to error.message))
        }
    }

    private fun cancelPending() {
        pendingStart?.error("recording_cancelled", "녹음 준비가 중단됐습니다", null)
        pendingStart = null
    }

    private fun ownedFile(path: String): File {
        val file = File(path).canonicalFile
        val privateDraft = file.parentFile?.parentFile == File(activity.filesDir, "voice-drafts").canonicalFile
        require((file.parentFile == activity.cacheDir.canonicalFile || privateDraft) && file.name.startsWith("voice-") && file.extension in setOf("m4a", "aac")) {
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

    private fun cancel(path: String?) {
        val requested = path?.let(::ownedFile)
        // 이전 사진의 전송 완료 콜백이 새 사진의 녹음을 중단하지 않게 경로를 대조한다.
        if (requested != null && requested != recordingFile?.canonicalFile) {
            delete(requested)
            return
        }
        cancelPending()
        runCatching { recorder?.stop() }
        releaseRecorder()
        stopPlay()
        delete(recordingFile)
        recordingFile = null
        lastRecording = null
    }

    private fun play(call: MethodCall, result: MethodChannel.Result) {
        if (recorder != null || pendingStart != null || speechBusy()) {
            result.error("microphone_busy", "음성 입력이 끝난 뒤 들어 주세요", null)
            return
        }
        val audio = call.argument<ByteArray>("audio")
        if (audio == null || audio.isEmpty() || audio.size > MAX_BYTES) {
            result.error("invalid_audio", "재생할 녹음을 확인해 주세요", null)
            return
        }
        stopPlay()
        try {
            val file = File(activity.cacheDir, "voice-preview-${UUID.randomUUID()}.m4a")
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
                        stopPlay()
                        channel.invokeMethod("playbackStopped", mapOf("message" to "녹음을 재생하지 못했습니다"))
                    }
                }
            }
            preview.setOnCompletionListener {
                if (player === it) stopPlay()
            }
            preview.setOnErrorListener { current, _, _ ->
                if (player === current) {
                    stopPlay()
                    channel.invokeMethod("playbackStopped", mapOf("message" to "녹음을 재생하지 못했습니다"))
                }
                true
            }
            preview.prepareAsync()
            result.success(null)
        } catch (error: Exception) {
            stopPlay()
            throw error
        }
    }

    private fun stopPlay() {
        val previous = player
        player = null
        runCatching { previous?.release() }
        previewFile?.delete()
        previewFile = null
        if (previous != null) channel.invokeMethod("playbackStopped", null)
    }

    fun onStop() {
        cancelPending()
        autoStop("background")
        stopPlay()
    }

    fun close() {
        onStop() // 유효한 녹음은 삭제하지 않고 Flutter 초안에서 정리한다.
        main.removeCallbacksAndMessages(null)
        channel.setMethodCallHandler(null)
    }
}
