package com.vitalguard.field.pilot

import android.app.Application
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vitalguard.field.pilot.capture.CaptureFailure
import com.vitalguard.field.pilot.capture.CaptureMode
import com.vitalguard.field.pilot.capture.CaptureNative
import com.vitalguard.field.pilot.capture.CapturePipeline
import com.vitalguard.field.pilot.capture.CaptureRecord
import com.vitalguard.field.pilot.capture.CapturedOriginal
import com.vitalguard.field.pilot.capture.DeviceCapturePipelinePort
import com.vitalguard.field.pilot.capture.cameraPermissionDeniedMessage
import com.vitalguard.field.pilot.capture.captureProcessingMessage
import com.vitalguard.field.pilot.capture.scannerPreparationMessage
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class PilotScreen { Record, Camera, Result }

data class CameraUiState(
    val permissionGranted: Boolean = false,
    val ready: Boolean = false,
    val taking: Boolean = false,
    val error: String? = null,
    val generation: Int = 0,
)

data class PilotUiState(
    val screen: PilotScreen = PilotScreen.Record,
    val scannerReady: Boolean? = null,
    val busy: Boolean = false,
    val operationMessage: String? = null,
    val camera: CameraUiState = CameraUiState(),
    val records: List<CaptureRecord> = emptyList(),
    val selectedId: String? = null,
) {
    val selectedRecord: CaptureRecord? get() = records.firstOrNull { it.file.id == selectedId }
}

/** 회전으로 Activity가 재생성되어도 처리 작업과 화면 상태는 이 ViewModel에 남는다. */
class CaptureViewModel(application: Application) : AndroidViewModel(application) {
    val native = CaptureNative(application)
    private val port = DeviceCapturePipelinePort(application, native)
    private val pipeline = CapturePipeline(port)
    private val mutableState = MutableStateFlow(PilotUiState())
    val state = mutableState.asStateFlow()
    private var permissionJob: Job? = null
    private var cleared = false
    private var activePhotoId: String? = null

    init {
        viewModelScope.launch {
            val ready = native.prepareScanner()
            mutableState.update { it.copy(scannerReady = ready) }
        }
    }

    fun openCamera() {
        if (state.value.busy) return
        val generation = state.value.camera.generation + 1
        mutableState.update {
            it.copy(
                screen = PilotScreen.Camera, busy = true, operationMessage = captureProcessingMessage,
                camera = CameraUiState(generation = generation),
            )
        }
        obtainCameraPermission(generation)
    }

    private fun obtainCameraPermission(generation: Int) {
        permissionJob = viewModelScope.launch {
            try {
                val granted = native.requestCameraPermission()
                updateCamera(generation) {
                    it.copy(permissionGranted = granted, error = if (granted) null else cameraPermissionDeniedMessage)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                cameraError(generation, error)
            }
        }
    }

    fun retryCamera() {
        val current = state.value
        if (current.camera.taking || current.camera.error == cameraPermissionDeniedMessage) return
        val generation = current.camera.generation + 1
        mutableState.update { it.copy(camera = CameraUiState(generation = generation)) }
        obtainCameraPermission(generation)
    }

    fun cameraBinding(generation: Int) = updateCamera(generation) { it.copy(ready = false) }

    fun cameraReady(generation: Int) = updateCamera(generation) {
        if (it.error == null) it.copy(ready = true) else it
    }

    fun cameraError(generation: Int, error: Throwable) = updateCamera(generation) {
        it.copy(ready = false, taking = activePhotoId != null, error = cameraErrorMessage(error))
    }

    private fun updateCamera(generation: Int, transform: (CameraUiState) -> CameraUiState) {
        mutableState.update {
            if (it.screen == PilotScreen.Camera && it.camera.generation == generation) {
                it.copy(camera = transform(it.camera))
            } else it
        }
    }

    fun takePhoto(capture: ImageCapture) {
        val current = state.value
        if (current.screen != PilotScreen.Camera || !current.camera.ready || current.camera.taking || activePhotoId != null) return
        val generation = current.camera.generation
        val photoId = UUID.randomUUID().toString()
        activePhotoId = photoId
        updateCamera(generation) { it.copy(taking = true) }
        // Flutter와 같이 셔터를 누른 시각을 고정한다. OCR 완료 시각으로 바꾸지 않는다.
        val original = CapturedOriginal(
            File(getApplication<Application>().cacheDir, "photo-$photoId.jpg").absolutePath,
            Instant.now(),
        )
        val file = File(original.path)
        try {
            capture.takePicture(
                ImageCapture.OutputFileOptions.Builder(file).build(),
                ContextCompat.getMainExecutor(getApplication()),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                        if (cleared || activePhotoId != photoId) { file.delete(); return }
                        activePhotoId = null
                        mutableState.update {
                            it.copy(screen = PilotScreen.Record, camera = it.camera.copy(taking = false, ready = false))
                        }
                        viewModelScope.launch { process(listOf(original.path), original.capturedAt, CaptureMode.photo) }
                    }

                    override fun onError(exception: ImageCaptureException) {
                        file.delete()
                        if (activePhotoId == photoId) {
                            activePhotoId = null
                            if (!cleared) cameraError(generation, exception)
                        }
                    }
                },
            )
        } catch (error: Exception) {
            activePhotoId = null
            file.delete()
            cameraError(generation, error)
        }
    }

    fun scanDocuments() {
        if (state.value.busy) return
        mutableState.update { it.copy(busy = true, operationMessage = captureProcessingMessage) }
        viewModelScope.launch {
            try {
                val paths = native.scanDocuments()
                if (paths.isNullOrEmpty()) {
                    mutableState.update { it.copy(busy = false, operationMessage = null) }
                } else {
                    mutableState.update { it.copy(scannerReady = true) }
                    process(paths, Instant.now(), CaptureMode.document)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(
                        busy = false,
                        operationMessage = operationError(error),
                        scannerReady = if (error.message == scannerPreparationMessage) false else it.scannerReady,
                    )
                }
            }
        }
    }

    private suspend fun process(paths: List<String>, capturedAt: Instant, mode: CaptureMode) {
        try {
            val result = pipeline.process(
                originalPaths = paths, capturedAt = capturedAt, mode = mode,
                // 파일럿은 로그인하지 않는다. 본 앱에서는 JWT 사용자의 이름/workerId를 사용한다.
                workerName = "파일럿", workerId = "-", siteId = null,
            )
            val single = result.records.singleOrNull()?.takeIf { result.failed == 0 }
            mutableState.update {
                it.copy(
                    screen = if (single != null) PilotScreen.Result else PilotScreen.Record,
                    busy = false,
                    operationMessage = result.operationMessage,
                    records = it.records + result.records,
                    selectedId = single?.file?.id,
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            mutableState.update { it.copy(busy = false, operationMessage = operationError(error)) }
        }
    }

    fun showResult(id: String) {
        if (state.value.busy || state.value.records.none { it.file.id == id }) return
        mutableState.update { it.copy(screen = PilotScreen.Result, selectedId = id) }
    }

    fun backToRecord() {
        val current = state.value
        if (activePhotoId != null || current.camera.taking || (current.screen == PilotScreen.Record && current.busy)) return
        permissionJob?.cancel()
        mutableState.update {
            it.copy(
                screen = PilotScreen.Record, busy = false,
                operationMessage = if (current.screen == PilotScreen.Camera) null else it.operationMessage,
            )
        }
    }

    override fun onCleared() {
        cleared = true
        native.close()
        port.close()
        super.onCleared()
    }
}

fun cameraErrorMessage(error: Throwable): String = when (error) {
    is SecurityException -> cameraPermissionDeniedMessage
    is CaptureFailure -> error.message
    else -> error.message?.takeIf { it.isNotEmpty() }?.let { "카메라를 열지 못했습니다: $it" }
        ?: "카메라를 열지 못했습니다."
}

private fun operationError(error: Exception): String =
    if (error is CaptureFailure) error.message else "촬영 기록을 처리하지 못했습니다."
