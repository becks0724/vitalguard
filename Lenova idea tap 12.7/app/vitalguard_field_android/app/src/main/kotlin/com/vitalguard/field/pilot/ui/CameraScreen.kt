package com.vitalguard.field.pilot.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vitalguard.field.pilot.CameraUiState
import com.vitalguard.field.pilot.R
import com.vitalguard.field.pilot.capture.cameraPermissionDeniedMessage

/** 기기 카메라와 분리해 오류/권한 UI를 실기기 Compose 테스트에서 직접 검증한다. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CameraScreen(
    state: CameraUiState,
    onCapture: () -> Unit = {},
    onRetry: () -> Unit = {},
    onBack: () -> Unit = {},
    preview: @Composable () -> Unit = {},
) {
    Scaffold(
        containerColor = Color(0xFF15201D),
        topBar = {
            TopAppBar(
                title = { Text("사진 촬영") },
                navigationIcon = {
                    IconButton(onClick = onBack, enabled = !state.taking, modifier = Modifier.size(64.dp)) {
                        Icon(painterResource(R.drawable.ic_back), contentDescription = "기록으로")
                    }
                },
            )
        },
    ) { insets ->
        Box(Modifier.fillMaxSize().padding(insets)) {
            if (state.error != null) {
                Column(
                    modifier = Modifier.align(Alignment.Center).verticalScroll(rememberScrollState()).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Icon(painterResource(R.drawable.ic_camera), contentDescription = null, tint = Color.White, modifier = Modifier.size(48.dp))
                    Text(
                        state.error, modifier = Modifier.testTag("camera-error"),
                        color = Color.White, textAlign = TextAlign.Center, fontSize = 18.sp,
                    )
                    if (state.error != cameraPermissionDeniedMessage) {
                        OutlinedButton(
                            onClick = onRetry, modifier = Modifier.heightIn(min = 64.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                        ) { Text("다시 시도") }
                    }
                }
            } else {
                // 준비 중에도 PreviewView를 구성해야 CameraX가 장치 바인딩을 시작할 수 있다.
                preview()
                if (!state.ready && !state.taking) {
                    Column(
                        Modifier.align(Alignment.Center).padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        CircularProgressIndicator(color = Color.White)
                        Spacer(Modifier.height(16.dp))
                        Text("카메라 권한과 장치를 확인하는 중입니다.", color = Color.White, textAlign = TextAlign.Center)
                    }
                }
                if (state.ready || state.taking) {
                    Button(
                        onClick = onCapture, enabled = state.ready && !state.taking,
                        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp)
                            .width(240.dp).heightIn(min = 64.dp).testTag("take-picture"),
                    ) {
                        if (state.taking) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(painterResource(R.drawable.ic_camera), contentDescription = null)
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(if (state.taking) "촬영 중…" else "촬영")
                    }
                }
            }
        }
    }
}
