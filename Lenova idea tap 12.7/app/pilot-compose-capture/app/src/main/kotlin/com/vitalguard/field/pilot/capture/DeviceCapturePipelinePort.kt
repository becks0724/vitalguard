package com.vitalguard.field.pilot.capture

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class DeviceCapturePipelinePort(context: Context, private val native: CaptureNative) : CapturePipelinePort {
    private val app = context.applicationContext
    private val text = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())

    override suspend fun requestLocation(): CaptureFix? = native.requestLocation()

    // 파일럿에는 서버 로그인/JWT가 없다. 서버 주소 조회를 구현하지 않고 항상 null로 둔다.
    override suspend fun serverAddress(fix: CaptureFix): String? = null

    override suspend fun deviceAddress(fix: CaptureFix): String? = native.reverseGeocode(fix)

    override suspend fun recognizeOriginal(path: String): String = withContext(Dispatchers.IO) {
        try {
            // 반드시 원본 JPEG 경로. InputImage가 원본 EXIF 방향도 해석한다.
            text.process(InputImage.fromFilePath(app, Uri.fromFile(File(path)))).awaitResult().text
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Dart MlKitCaptureText와 동일: OCR 미지원/실패는 텍스트 미검출로 보관한다.
            ""
        }
    }

    override suspend fun stampResizeJpeg(path: String, stampLines: List<String>): ByteArray =
        native.stampResizeJpeg(path, stampLines)

    override suspend fun saveLocal(jpeg: ByteArray, fields: Map<String, String>): LocalCaptureFile =
        withContext(Dispatchers.IO) {
            val directory = File(app.filesDir, "outbox")
            check(directory.isDirectory || directory.mkdirs()) { "기기 저장 폴더를 만들지 못했습니다." }
            val id = UUID.randomUUID().toString()
            val image = File(directory, "$id.jpg")
            val json = File(directory, "$id.json")
            val imageTemp = File(directory, "$id.jpg.tmp")
            val jsonTemp = File(directory, "$id.json.tmp")
            try {
                writeSynced(imageTemp, jpeg)
                // JSON의 루트가 업로드 필드 맵이다. siteId=null과 신원 필드는 들어가지 않는다.
                writeSynced(jsonTemp, JSONObject(fields).toString(2).toByteArray(Charsets.UTF_8))
                check(imageTemp.renameTo(image)) { "사진을 기기에 저장하지 못했습니다." }
                check(jsonTemp.renameTo(json)) { "사진 정보를 기기에 저장하지 못했습니다." }
                LocalCaptureFile(id, image.absolutePath, json.absolutePath)
            } catch (error: Exception) {
                image.delete()
                json.delete()
                throw error
            } finally {
                imageTemp.delete()
                jsonTemp.delete()
            }
        }

    private fun writeSynced(file: File, bytes: ByteArray) {
        FileOutputStream(file).use { output ->
            output.write(bytes)
            output.fd.sync()
        }
    }

    fun close() { text.close() }
}
