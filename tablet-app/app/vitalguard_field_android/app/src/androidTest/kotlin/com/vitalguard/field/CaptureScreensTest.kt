package com.vitalguard.field

// Port: capture_ocr_test.dart의 촬영/스캔 미준비·권한 거절 UI. 네이티브 포트는 만들지 않는다.
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.capture.*
import com.vitalguard.field.ui.capture.CameraScreen
import com.vitalguard.field.ui.record.RecordCalendarContent
import java.time.LocalDate
import com.vitalguard.field.ui.theme.VgTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CaptureScreensTest {
    @get:Rule val compose = createComposeRule()
    @Test fun unpreparedScannerKeepsBoth64DpActionsAndShowsExactMessage() {
        var photos = 0
        val state = mutableStateOf(CaptureUiState(scannerReady = false))
        compose.setContent { VgTheme {
            RecordCalendarContent(LocalDate.parse("2026-09-27"), emptyList(), capture = state.value,
                onScan = { state.value = state.value.copy(operationMessage = scannerPreparationMessage) },
                onPhoto = { photos++; state.value = state.value.copy(operationMessage = "기기에 저장됨 · 1건 · 상세를 닫으면 자동 전송됩니다") })
        } }
        compose.onNodeWithTag("scanner-not-ready").assertTextEquals(scannerPreparationMessage)
        compose.onNodeWithTag("document-scan").assertHeightIsAtLeast(64.dp).assertIsEnabled().performClick()
        compose.onNodeWithTag("capture-status").assertTextEquals(scannerPreparationMessage)
        compose.onNodeWithTag("photo-capture").assertHeightIsAtLeast(64.dp).assertIsEnabled().performClick()
        compose.onNodeWithTag("capture-status").assertTextEquals("기기에 저장됨 · 1건 · 상세를 닫으면 자동 전송됩니다")
        compose.runOnIdle { assertEquals(1, photos) }
    }
    @Test fun onlyNonPermissionCameraErrorsOfferRetry() {
        val state = mutableStateOf(CameraUiState(error = "카메라를 열지 못했습니다."))
        var retries = 0
        compose.setContent { VgTheme { CameraScreen(state.value, onRetry = { retries++ }) } }
        compose.onNodeWithContentDescription("다시 시도").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, retries); state.value = CameraUiState(error = cameraPermissionDeniedMessage) }
        compose.onNodeWithTag("camera-error").assertTextEquals(cameraPermissionDeniedMessage)
        compose.onNodeWithContentDescription("다시 시도").assertDoesNotExist(); compose.onNodeWithTag("take-picture").assertDoesNotExist()
    }
}
