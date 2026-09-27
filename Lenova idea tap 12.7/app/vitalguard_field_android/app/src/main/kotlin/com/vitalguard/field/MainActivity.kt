package com.vitalguard.field

import android.graphics.Color
import android.Manifest
import android.app.Activity
import android.content.IntentSender
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.vitalguard.field.capture.CaptureActivityHost
import com.vitalguard.field.audio.MicrophoneActivityHost
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.vitalguard.field.ui.theme.VgTheme

class MainActivity : ComponentActivity(), CaptureActivityHost, MicrophoneActivityHost {
    private val model: FieldViewModel by viewModels {
        FieldViewModel.Factory(application as FieldApplication)
    }
    override val activity: Activity get() = this
    private val scannerLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        model.capture?.native?.onActivityResult(it.resultCode, it.data)
    }
    private val locationLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        model.capture?.native?.onLocationPermissionResult(it.values.any { granted -> granted })
    }
    private val cameraLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        model.capture?.native?.onCameraPermissionResult(it)
    }
    private val microphoneLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        model.microphone.onResult(it)
    }
    override fun requestMicrophonePermission() { microphoneLauncher.launch(Manifest.permission.RECORD_AUDIO) }
    override fun onPause() { model.records.inactive(); super.onPause() }
    override fun onStop() { if (!isChangingConfigurations) model.stopRecordAudio(); super.onStop() }
    override fun onSaveInstanceState(outState: Bundle) { model.records.inactive(); super.onSaveInstanceState(outState) }
    override fun launchScanner(sender: IntentSender) { scannerLauncher.launch(IntentSenderRequest.Builder(sender).build()) }
    override fun requestLocationPermission() {
        locationLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }
    override fun requestCameraPermission() { cameraLauncher.launch(Manifest.permission.CAMERA) }
    override fun onDestroy() { model.microphone.detach(this); model.capture?.native?.detach(this); super.onDestroy() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT))
        model.capture?.native?.attach(this)
        model.microphone.attach(this)
        setContent { VgTheme { FieldApp(model) } }
    }
}
