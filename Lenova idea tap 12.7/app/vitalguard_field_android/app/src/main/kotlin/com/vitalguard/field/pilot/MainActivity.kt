package com.vitalguard.field.pilot

import android.Manifest
import android.app.Activity
import android.content.IntentSender
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.pilot.capture.CaptureActivityHost
import com.vitalguard.field.pilot.ui.CameraRoute
import com.vitalguard.field.pilot.ui.PilotTheme
import com.vitalguard.field.pilot.ui.RecordScreen
import com.vitalguard.field.pilot.ui.ResultScreen

class MainActivity : ComponentActivity(), CaptureActivityHost {
    private lateinit var model: CaptureViewModel
    override val activity: Activity get() = this

    // 매번 같은 순서로 등록한다. 회전 후에도 Registry가 결과를 새 Activity로 전달한다.
    private val scannerLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        model.native.onActivityResult(it.resultCode, it.data)
    }
    private val locationLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        model.native.onLocationPermissionResult(it.values.any { granted -> granted })
    }
    private val cameraLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        model.native.onCameraPermissionResult(it)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model = ViewModelProvider(this)[CaptureViewModel::class.java]
        model.native.attach(this)
        setContent {
            PilotTheme {
                val state by model.state.collectAsStateWithLifecycle()
                BackHandler(enabled = state.screen != PilotScreen.Record || state.busy) { model.backToRecord() }
                when (state.screen) {
                    PilotScreen.Record -> RecordScreen(
                        scannerReady = state.scannerReady, busy = state.busy,
                        operationMessage = state.operationMessage, records = state.records,
                        onScan = model::scanDocuments, onPhoto = model::openCamera, onRecord = model::showResult,
                    )
                    PilotScreen.Camera -> CameraRoute(state.camera, model)
                    PilotScreen.Result -> state.selectedRecord?.let {
                        ResultScreen(it, onBack = model::backToRecord)
                    } ?: RecordScreen(onScan = model::scanDocuments, onPhoto = model::openCamera)
                }
            }
        }
    }

    override fun launchScanner(sender: IntentSender) {
        scannerLauncher.launch(IntentSenderRequest.Builder(sender).build())
    }

    override fun requestLocationPermission() {
        locationLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    override fun requestCameraPermission() { cameraLauncher.launch(Manifest.permission.CAMERA) }

    override fun onDestroy() {
        model.native.detach(this)
        // close()는 ViewModel.onCleared에서만 호출한다. 회전은 작업 취소가 아니다.
        super.onDestroy()
    }
}
