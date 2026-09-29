package com.vitalguard.field.ui.capture

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.vitalguard.field.R
import com.vitalguard.field.capture.*
import com.vitalguard.field.ui.theme.ActionIconButton

// Shared capture actions retain their accessible names and test keys.
@Composable
fun CaptureActionPanel(state: CaptureUiState = CaptureUiState(), onScan: () -> Unit = {}, onPhoto: () -> Unit = {}) {
    Column(Modifier.fillMaxWidth().testTag("record-capture-actions"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ActionIconButton(R.drawable.ic_scan, "서류 스캔", onScan, Modifier.testTag("document-scan"), enabled = !state.busy)
            ActionIconButton(R.drawable.ic_camera, "사진 촬영", onPhoto, Modifier.testTag("photo-capture"), enabled = !state.busy)
        }
        if (state.scannerReady == false) Text(scannerPreparationMessage, Modifier.testTag("scanner-not-ready"))
        state.operationMessage?.let { Text(it, Modifier.testTag("capture-status")) }
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}
