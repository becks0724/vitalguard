package com.vitalguard.field.pilot.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.vitalguard.field.pilot.capture.CaptureRecord
import com.vitalguard.field.pilot.capture.captureRecordedTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultScreen(record: CaptureRecord, onBack: () -> Unit) {
    val bitmap by produceState<ImageBitmap?>(initialValue = null, key1 = record.file.jpegPath) {
        value = withContext(Dispatchers.IO) {
            // 화면 표시용으로만 축소한다. outbox JPEG와 OCR 원본은 바꾸지 않는다.
            BitmapFactory.decodeFile(record.file.jpegPath, BitmapFactory.Options().apply { inSampleSize = 2 })?.asImageBitmap()
        }
    }
    Scaffold(topBar = { TopAppBar(title = { Text(record.fields.getValue("title")) }) }) { insets ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(insets).padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item {
                Button(onClick = onBack, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)) { Text("기록으로") }
            }
            item { Text(captureRecordedTime(record.fields["capturedAt"])) }
            item {
                bitmap?.let {
                    Image(
                        bitmap = it, contentDescription = "각인된 사진",
                        modifier = Modifier.fillMaxWidth().heightIn(max = 520.dp), contentScale = ContentScale.Fit,
                    )
                } ?: Text("사진을 불러오는 중입니다.")
            }
            item {
                ResultSection("각인 문구") {
                    record.stampLines.forEach { Text(it) }
                }
            }
            item {
                ResultSection("단계별 소요 시간") {
                    FieldRow("위치", "${record.timings.locationMs} ms")
                    FieldRow("주소", "${record.timings.addressMs} ms")
                    FieldRow("OCR", "${record.timings.ocrMs} ms")
                    FieldRow("각인", "${record.timings.stampMs} ms")
                    FieldRow("저장", "${record.timings.saveMs} ms")
                }
            }
            item {
                ResultSection("업로드 필드 · 로컬 보관") {
                    for (key in listOf("dateKey", "capturedAt", "title", "ocrText", "roadAddress", "latitude", "longitude", "siteId")) {
                        val value = if (key == "ocrText") "${record.fields[key].orEmpty().length}자" else record.fields[key] ?: "생략"
                        FieldRow(if (key == "ocrText") "ocrText 길이" else key, value)
                    }
                }
            }
            item {
                ResultSection("OCR 텍스트") {
                    SelectionContainer { Text(record.fields.getValue("ocrText")) }
                }
            }
            item {
                Text("저장 ID: ${record.file.id}", modifier = Modifier.padding(bottom = 24.dp), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun ResultSection(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        content()
    }
}

@Composable
private fun FieldRow(name: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(name, modifier = Modifier.weight(0.32f), style = MaterialTheme.typography.bodyMedium)
        Text(value, modifier = Modifier.weight(0.68f), style = MaterialTheme.typography.bodyMedium)
    }
}
