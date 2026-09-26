package com.vitalguard.field

// Port: hold_bundle_ui_test.dart 목록/상세. 고정 2장; HTTP·Keystore·네이티브·타이머 없음.
// 렌더링/참조 PNG 생성은 Gradle 금지 작업에서 실행하지 않는다.
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.capture.CaptureUiState
import com.vitalguard.field.data.*
import com.vitalguard.field.ui.record.*
import com.vitalguard.field.ui.shell.VgBackground
import com.vitalguard.field.ui.theme.VgTheme
import java.time.Instant

private val previewPhoto = OutboxEntry("preview-photo", "preview-account", OutboxKind.photo, mapOf(
    "clientOperationId" to "preview-photo", "dateKey" to "2026-09-26", "capturedAt" to "2026-09-26T09:14:22+09:00",
    "title" to "현장 사진", "siteId" to "site-a", "roadAddress" to "광주광역시 동구 금남로 1 (기기 추정)",
    "latitude" to "35.123450", "longitude" to "127.123450", "ocrText" to "페이지 1\n안전난간 점검"),
    "작성 현장 A", Instant.parse("2026-09-26T00:14:22Z"), mock = true)
private val previewText = OutboxEntry("preview-note", previewPhoto.owner, OutboxKind.text, mapOf("clientOperationId" to "preview-note"),
    previewPhoto.siteName, previewPhoto.createdAt, mock = true, dependsOn = previewPhoto.id)

@Composable
private fun PreviewPhoto(modifier: Modifier) {
    // 결정적인 화면 표본. 기기 사진이나 네트워크 이미지를 읽지 않는다.
    Canvas(modifier) {
        drawRect(Color(0xFFE3EBED))
        drawRect(Color(0xFFC7CECC), topLeft = Offset(0f, size.height * .42f), size = Size(size.width, size.height * .58f))
        val left = size.width * .1f; val right = size.width * .9f
        for (y in listOf(.42f, .64f)) drawLine(Color(0xFFD99435), Offset(left, size.height * y), Offset(right, size.height * y), size.height * .025f)
        for (x in listOf(.12f, .38f, .64f, .88f)) drawLine(Color(0xFF7A8584), Offset(size.width * x, size.height * .38f), Offset(size.width * x, size.height * .85f), size.width * .022f)
    }
}
@PreviewTest
@Preview(name = "PendingRecords866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable
fun PendingRecordsPreview() {
    VgTheme {
        Box(Modifier.fillMaxSize()) {
            VgBackground(Modifier.matchParentSize())
            RecordHomeContent(listOf(previewPhoto, previewText, previewPhoto.copy(id = "second", fields = previewPhoto.fields + mapOf("title" to "서류 스캔 · 페이지 1", "clientOperationId" to "second"),
                createdAt = previewPhoto.createdAt.minusSeconds(60))), capture = CaptureUiState(scannerReady = false),
                thumbnail = { PreviewPhoto(Modifier.size(72.dp)) })
        }
    }
}
@PreviewTest
@Preview(name = "LocalPhotoDetail1385", device = "spec:width=1385dp,height=866dp,dpi=340", locale = "ko", showBackground = true)
@Composable
fun LocalPhotoDetailPreview() {
    VgTheme {
        Box(Modifier.fillMaxSize()) {
            VgBackground(Modifier.matchParentSize())
            PhotoDetailContent(previewPhoto, listOf(previewText), wide = true,
                preview = { PreviewPhoto(Modifier.fillMaxSize()) }, attachment = {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text("메모 · ${it.statusLabel}"); Text("안전난간 고정 상태를 점검했습니다.")
                            TextButton({}) { Text("지우기") }
                        }
                    }
                })
        }
    }
}
