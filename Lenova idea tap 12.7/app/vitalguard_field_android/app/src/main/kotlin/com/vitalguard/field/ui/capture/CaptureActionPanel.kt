package com.vitalguard.field.ui.capture

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.vitalguard.field.R
import com.vitalguard.field.capture.*
import com.vitalguard.field.ui.theme.VgIcon

// Port: capture_screen.dart CaptureActionPanel. 문구와 테스트 키 유지.
@Composable
fun CaptureActionPanel(state: CaptureUiState = CaptureUiState(), onScan: () -> Unit = {}, onPhoto: () -> Unit = {}) {
    Column(Modifier.fillMaxWidth().testTag("record-capture-actions"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Button(onScan, Modifier.weight(1f).heightIn(min = 64.dp).testTag("document-scan"), enabled = !state.busy) {
                VgIcon(R.drawable.ic_record); Spacer(Modifier.width(8.dp)); Text("서류 스캔")
            }
            Button(onPhoto, Modifier.weight(1f).heightIn(min = 64.dp).testTag("photo-capture"), enabled = !state.busy) {
                VgIcon(R.drawable.ic_camera); Spacer(Modifier.width(8.dp)); Text("사진 촬영")
            }
        }
        if (state.scannerReady == false) Text(scannerPreparationMessage, Modifier.testTag("scanner-not-ready"))
        state.operationMessage?.let { Text(it, Modifier.testTag("capture-status")) }
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}
