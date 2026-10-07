package com.vitalguard.field.capture

import android.content.Context
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.core.content.ContextCompat
import com.vitalguard.field.data.OutboxController
import com.vitalguard.field.data.contracts.FieldController
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

// Port: 파일럿 CaptureViewModel. 메인 FieldViewModel의 scope로 회전 중 요청을 유지한다.
data class CameraUiState(val permissionGranted: Boolean = false, val ready: Boolean = false,
    val taking: Boolean = false, val error: String? = null, val generation: Int = 0)
data class CaptureNavigation(val serial: Long, val photoId: String? = null, val batchIds: List<String> = emptyList())
data class CaptureUiState(val scannerReady: Boolean? = null, val busy: Boolean = false,
    val operationMessage: String? = null, val cameraOpen: Boolean = false,
    val camera: CameraUiState = CameraUiState(), val navigation: CaptureNavigation? = null)

class CaptureController(context: Context, private val field: FieldController, private val outbox: OutboxController,
    private val scope: CoroutineScope,
) : AutoCloseable {
    private val app = context.applicationContext
    val native = CaptureNative(app)
    private val mutable = MutableStateFlow(CaptureUiState())
    val state = mutable.asStateFlow()
    private var permissionJob: Job? = null
    private var processJob: Job? = null
    private var prepareJob: Job? = null
    private var activePhotoId: String? = null
    private var author: CaptureAuthor? = null
    private var serial = 0L
    private var closed = false
    fun prepareScanner() {
        if (prepareJob?.isActive == true || state.value.scannerReady != null) return
        prepareJob = scope.launch {
            val ready = native.prepareScanner()
            mutable.update { it.copy(scannerReady = ready) }
        }
    }
    fun openCamera(): Boolean {
        if (state.value.busy) return false
        author = captureAuthor(field.state.value)
        val generation = state.value.camera.generation + 1
        mutable.update { it.copy(cameraOpen = true, busy = true, operationMessage = captureProcessingMessage,
            camera = CameraUiState(generation = generation)) }
        obtainCameraPermission(generation)
        return true
    }
    private fun obtainCameraPermission(generation: Int) {
        permissionJob = scope.launch {
            try {
                val granted = native.requestCameraPermission()
                updateCamera(generation) { it.copy(permissionGranted = granted, error = if (granted) null else cameraPermissionDeniedMessage) }
            } catch (error: CancellationException) { throw error
            } catch (error: Exception) { cameraError(generation, error) }
        }
    }
    fun retryCamera() {
        if (state.value.camera.taking || state.value.camera.error == cameraPermissionDeniedMessage) return
        val generation = state.value.camera.generation + 1
        mutable.update { it.copy(camera = CameraUiState(generation = generation)) }
        obtainCameraPermission(generation)
    }
    fun cameraBinding(generation: Int) = updateCamera(generation) { it.copy(ready = false) }
    fun cameraReady(generation: Int) = updateCamera(generation) { if (it.error == null) it.copy(ready = true) else it }
    fun cameraError(generation: Int, error: Throwable) = updateCamera(generation) {
        it.copy(ready = false, taking = activePhotoId != null, error = cameraErrorMessage(error))
    }
    private fun updateCamera(generation: Int, transform: (CameraUiState) -> CameraUiState) {
        mutable.update { if (it.cameraOpen && it.camera.generation == generation) it.copy(camera = transform(it.camera)) else it }
    }
    fun takePhoto(capture: ImageCapture) {
        val current = state.value
        val captureAuthor = author ?: return
        if (!current.cameraOpen || !current.camera.ready || current.camera.taking || activePhotoId != null) return
        val generation = current.camera.generation
        val photoId = UUID.randomUUID().toString()
        activePhotoId = photoId
        updateCamera(generation) { it.copy(taking = true) }
        val original = CapturedOriginal(File(app.cacheDir, "photo-$photoId.jpg").absolutePath, Instant.now())
        val file = File(original.path)
        try {
            capture.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(app),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                        if (closed || activePhotoId != photoId) { file.delete(); return }
                        activePhotoId = null
                        mutable.update { it.copy(cameraOpen = false, camera = it.camera.copy(taking = false, ready = false),
                            navigation = CaptureNavigation(++serial)) }
                        processJob = scope.launch { process(listOf(original.path), original.capturedAt, CaptureMode.photo, captureAuthor) }
                    }
                    override fun onError(exception: ImageCaptureException) {
                        file.delete()
                        if (activePhotoId == photoId) {
                            activePhotoId = null
                            if (!closed) cameraError(generation, exception)
                        }
                    }
                })
        } catch (error: Exception) {
            activePhotoId = null; file.delete(); cameraError(generation, error)
        }
    }
    fun scanDocuments() {
        if (state.value.busy) return
        val captureAuthor = captureAuthor(field.state.value)
        mutable.update { it.copy(busy = true, operationMessage = captureProcessingMessage) }
        processJob = scope.launch {
            try {
                val paths = native.scanDocuments()
                if (paths.isNullOrEmpty()) mutable.update { it.copy(busy = false, operationMessage = null) }
                else {
                    mutable.update { it.copy(scannerReady = true) }
                    process(paths, Instant.now(), CaptureMode.document, captureAuthor)
                }
            } catch (error: CancellationException) { throw error
            } catch (error: Exception) {
                mutable.update { it.copy(busy = false, operationMessage = operationError(error),
                    scannerReady = if (error.message == scannerPreparationMessage) false else it.scannerReady) }
            }
        }
    }
    private suspend fun process(paths: List<String>, capturedAt: Instant, mode: CaptureMode, captureAuthor: CaptureAuthor) {
        var port: DeviceCapturePipelinePort? = null
        try {
            port = DeviceCapturePipelinePort(app, native, field, outbox, captureAuthor)
            val result = CapturePipeline(port).process(paths, capturedAt, mode,
                captureAuthor.workerName, captureAuthor.workerId, captureAuthor.siteId)
            if (outbox.account != captureAuthor.owner) return
            mutable.update { it.copy(busy = false, operationMessage = result.operationMessage,
                navigation = CaptureNavigation(++serial, result.queuedIds.firstOrNull(), result.queuedIds)) }
        } catch (error: CancellationException) { throw error
        } catch (error: Exception) { mutable.update { it.copy(busy = false, operationMessage = operationError(error)) }
        } finally {
            port?.close()
            // 포트 생성 실패/취소도 포함. 파이프라인 finally와 중복 삭제는 안전하다.
            withContext(NonCancellable + Dispatchers.IO) { paths.forEach { runCatching { File(it).delete() } } }
        }
    }
    fun consumeNavigation(value: CaptureNavigation) {
        mutable.update { if (it.navigation == value) it.copy(navigation = null) else it }
    }
    fun backToRecord(): Boolean {
        if (activePhotoId != null || state.value.camera.taking) return false
        permissionJob?.cancel()
        mutable.update { it.copy(cameraOpen = false, busy = false, operationMessage = null) }
        return true
    }
    fun reset() {
        permissionJob?.cancel(); processJob?.cancel()
        activePhotoId = null; author = null
        mutable.update { CaptureUiState(scannerReady = it.scannerReady, camera = CameraUiState(generation = it.camera.generation + 1)) }
    }
    override fun close() { closed = true; reset(); prepareJob?.cancel(); native.close() }
}
fun cameraErrorMessage(error: Throwable): String = when (error) {
    is SecurityException -> cameraPermissionDeniedMessage
    is CaptureFailure -> error.message
    else -> error.message?.takeIf { it.isNotEmpty() }?.let { "카메라를 열지 못했습니다: $it" } ?: "카메라를 열지 못했습니다."
}
private fun operationError(error: Exception) = if (error is CaptureFailure) error.message else "촬영 기록을 처리하지 못했습니다."
