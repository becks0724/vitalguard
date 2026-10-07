package com.vitalguard.field.pilot

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.pilot.ui.PilotTheme
import com.vitalguard.field.pilot.ui.RecordScreen

// 한 장만 렌더한다. 시계/랜덤/기기 포트가 없는 고정 입력, 866dp·340dpi 세로 태블릿.
@PreviewTest
@Preview(
    name = "RecordScannerNotReady",
    device = "spec:width=866dp,height=1385dp,dpi=340",
    locale = "ko",
    showBackground = true,
)
@Composable
fun RecordScannerNotReadyPreview() {
    PilotTheme { RecordScreen(scannerReady = false) }
}
