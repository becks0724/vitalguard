package com.vitalguard.field.capture

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.vitalguard.field.data.OutboxController
import com.vitalguard.field.data.contracts.FieldController
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Port: 파일럿 DeviceCapturePipelinePort. 저장/서버 주소 경계만 메인 앱에 연결.
class DeviceCapturePipelinePort(context: Context, private val native: CaptureNative,
    private val controller: FieldController, private val outbox: OutboxController,
    private val author: CaptureAuthor,
) : CapturePipelinePort {
    private val app = context.applicationContext
    private val text = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
    override suspend fun requestLocation() = native.requestLocation()
    override suspend fun serverAddress(fix: CaptureFix) = controller.captureAddress(fix.latitude, fix.longitude)
    override suspend fun deviceAddress(fix: CaptureFix) = native.reverseGeocode(fix)
    override suspend fun recognizeOriginal(path: String): String = withContext(Dispatchers.IO) {
        try { text.process(InputImage.fromFilePath(app, Uri.fromFile(File(path)))).awaitResult().text
        } catch (error: CancellationException) { throw error
        } catch (_: Exception) { "" }
    }
    override suspend fun stampResizeJpeg(path: String, stampLines: List<String>) = native.stampResizeJpeg(path, stampLines)
    override suspend fun saveLocal(jpeg: ByteArray, fields: Map<String, String>): LocalCaptureFile =
        enqueueCapturedPhoto(outbox, author, jpeg, fields)
    fun close() { text.close() }
}
