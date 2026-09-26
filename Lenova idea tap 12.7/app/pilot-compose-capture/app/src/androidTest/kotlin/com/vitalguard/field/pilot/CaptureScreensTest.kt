package com.vitalguard.field.pilot

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.pilot.capture.cameraPermissionDeniedMessage
import com.vitalguard.field.pilot.capture.scannerPreparationMessage
import com.vitalguard.field.pilot.ui.CameraScreen
import com.vitalguard.field.pilot.ui.PilotTheme
import com.vitalguard.field.pilot.ui.RecordScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CaptureScreensTest {
    @get:Rule val compose = createComposeRule()

    // capture_ocr_test.dart: 미준비 스캐너가 사진 촬영을 막지 않고 두 버튼은 최소 64dp.
    @Test fun unpreparedScannerShowsBothActionsAndPreparationMessage() {
        var photos = 0
        val message = mutableStateOf<String?>(null)
        compose.setContent {
            PilotTheme {
                RecordScreen(
                    scannerReady = false, operationMessage = message.value,
                    onScan = { message.value = scannerPreparationMessage },
                    onPhoto = { photos++; message.value = "기기에 저장됨 · 1건 · 주석·메모를 붙인 뒤 전송" },
                )
            }
        }
        compose.onNodeWithText("보낼 기록").assertIsDisplayed()
        compose.onNodeWithText("서류 스캔").assertIsDisplayed()
        compose.onNodeWithText("사진 촬영").assertIsDisplayed()
        compose.onNodeWithText(scannerPreparationMessage).assertIsDisplayed()
        compose.onNodeWithTag("document-scan").assertHeightIsAtLeast(64.dp).assertIsEnabled().performClick()
        compose.onNodeWithTag("capture-status").assertIsDisplayed()
        compose.onNodeWithTag("photo-capture").assertHeightIsAtLeast(64.dp).assertIsEnabled().performClick()
        compose.onNodeWithText("기기에 저장됨 · 1건 · 주석·메모를 붙인 뒤 전송").assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, photos) }
    }

    // 원본 권한 거절 회귀 + 지시서의 일반 오류 재시도/권한 오류 재시도 없음.
    @Test fun onlyNonPermissionCameraErrorsOfferRetry() {
        val state = mutableStateOf(CameraUiState(error = "카메라를 열지 못했습니다."))
        var retries = 0
        compose.setContent { PilotTheme { CameraScreen(state.value, onRetry = { retries++ }) } }
        compose.onNodeWithText("카메라를 열지 못했습니다.").assertIsDisplayed()
        compose.onNodeWithText("다시 시도").assertIsDisplayed().performClick()
        compose.runOnIdle {
            assertEquals(1, retries)
            state.value = CameraUiState(error = cameraPermissionDeniedMessage)
        }
        compose.onNodeWithTag("camera-error").assertIsDisplayed()
        compose.onNodeWithText(cameraPermissionDeniedMessage).assertIsDisplayed()
        compose.onNodeWithText("다시 시도").assertDoesNotExist()
        compose.onNodeWithTag("take-picture").assertDoesNotExist()
    }
}
