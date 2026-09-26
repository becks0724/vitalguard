package com.vitalguard.field.ui.capture

import android.view.Surface
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageCapture
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LiveData
import androidx.lifecycle.Observer
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.vitalguard.field.capture.CameraUiState
import com.vitalguard.field.capture.CaptureController
import com.vitalguard.field.capture.CaptureFailure

@Composable
fun CameraRoute(state: CameraUiState, model: CaptureController, onBack: () -> Unit) {
    var capture by remember(state.generation) { mutableStateOf<ImageCapture?>(null) }
    CameraScreen(
        state = state,
        onCapture = { capture?.let(model::takePhoto) },
        onRetry = model::retryCamera,
        onBack = onBack,
        preview = {
            if (state.permissionGranted) {
                CameraPreview(
                    generation = state.generation,
                    onBinding = { model.cameraBinding(state.generation) },
                    onReady = { capture = it; model.cameraReady(state.generation) },
                    onError = { model.cameraError(state.generation, it) },
                    onRelease = { capture = null },
                )
            }
        },
    )
}

@Composable
private fun CameraPreview(
    generation: Int,
    onBinding: () -> Unit,
    onReady: (ImageCapture) -> Unit,
    onError: (Throwable) -> Unit,
    onRelease: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val view = remember(context) {
        PreviewView(context).apply {
            // TextureView 모드는 회전/Compose 합성에서 SurfaceView보다 일관되게 배치된다.
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
        }
    }
    AndroidView(factory = { view }, modifier = Modifier.fillMaxSize())
    DisposableEffect(lifecycle, view, generation) {
        onBinding()
        val future = ProcessCameraProvider.getInstance(context.applicationContext)
        val executor = ContextCompat.getMainExecutor(context)
        var disposed = false
        var provider: ProcessCameraProvider? = null
        var boundPreview: Preview? = null
        var boundCapture: ImageCapture? = null
        var cameraStates: LiveData<CameraState>? = null
        var cameraObserver: Observer<CameraState>? = null
        future.addListener({
            if (!disposed) {
                try {
                    val cameras = future.get()
                    provider = cameras
                    if (!cameras.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) {
                        throw CaptureFailure("사용할 수 있는 카메라가 없습니다.")
                    }
                    val rotation = view.display?.rotation ?: Surface.ROTATION_0
                    val preview = Preview.Builder().setTargetRotation(rotation).build()
                    val imageCapture = ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                        .setTargetRotation(rotation)
                        .build()
                    boundPreview = preview
                    boundCapture = imageCapture
                    preview.setSurfaceProvider(view.surfaceProvider)
                    val camera = cameras.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                    val observer = Observer<CameraState> { cameraState ->
                        if (!disposed) {
                            if (cameraState.error != null) {
                                onError(CaptureFailure("카메라를 열지 못했습니다."))
                            } else if (cameraState.type == CameraState.Type.OPEN) {
                                onReady(imageCapture)
                            }
                        }
                    }
                    cameraStates = camera.cameraInfo.cameraState
                    cameraObserver = observer
                    cameraStates?.observe(lifecycle, observer)
                } catch (error: Exception) {
                    onError(error)
                }
            }
        }, executor)
        onDispose {
            disposed = true
            cameraObserver?.let { cameraStates?.removeObserver(it) }
            onRelease()
            // 이 화면 소유 UseCase만 해제한다. 새 Activity의 바인딩을 지우지 않는다.
            boundPreview?.let { provider?.unbind(it) }
            boundCapture?.let { provider?.unbind(it) }
        }
    }
}
