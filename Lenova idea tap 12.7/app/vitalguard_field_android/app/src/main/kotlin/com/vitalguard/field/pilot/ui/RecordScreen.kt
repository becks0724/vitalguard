package com.vitalguard.field.pilot.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.vitalguard.field.pilot.R
import com.vitalguard.field.pilot.capture.CaptureRecord
import com.vitalguard.field.pilot.capture.captureProcessingMessage
import com.vitalguard.field.pilot.capture.captureRecordedTime
import com.vitalguard.field.pilot.capture.scannerPreparationMessage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordScreen(
    scannerReady: Boolean? = null,
    busy: Boolean = false,
    operationMessage: String? = null,
    records: List<CaptureRecord> = emptyList(),
    onScan: () -> Unit = {},
    onPhoto: () -> Unit = {},
    onRecord: (String) -> Unit = {},
) {
    Scaffold(topBar = { TopAppBar(title = { Text("보낼 기록") }) }) { insets ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(insets).padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    FilledTonalButton(
                        onClick = onScan, enabled = !busy,
                        modifier = Modifier.weight(1f).heightIn(min = 64.dp).testTag("document-scan"),
                    ) {
                        Icon(painterResource(R.drawable.ic_document_scan), contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("서류 스캔")
                    }
                    Button(
                        onClick = onPhoto, enabled = !busy,
                        modifier = Modifier.weight(1f).heightIn(min = 64.dp).testTag("photo-capture"),
                    ) {
                        Icon(painterResource(R.drawable.ic_camera), contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("사진 촬영")
                    }
                }
            }
            if (scannerReady == false) {
                item { Text(scannerPreparationMessage, modifier = Modifier.testTag("scanner-not-ready")) }
            }
            val message = if (busy) captureProcessingMessage else operationMessage
            if (message != null) {
                item { Text(message, modifier = Modifier.testTag("capture-status")) }
            }
            if (busy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
            if (records.isNotEmpty()) {
                item { Text("저장된 기록", style = MaterialTheme.typography.titleMedium) }
                items(records, key = { it.file.id }) { record ->
                    OutlinedButton(
                        onClick = { onRecord(record.file.id) }, enabled = !busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
                    ) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                            Text(record.fields.getValue("title"))
                            Text(captureRecordedTime(record.fields["capturedAt"]), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            item { Spacer(Modifier.padding(bottom = 8.dp)) }
        }
    }
}
