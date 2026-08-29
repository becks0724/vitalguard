// 로그인 전체화면 — 아이디·비밀번호 칸을 탭하면 Wear 시스템 입력이 뜬다(08-26 사용자 선택)
package com.vitalguard.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Text

/** 화면이 그리는 데 필요한 전부 — 서버·인텐트를 모르므로 미리보기가 그대로 렌더한다. */
data class LoginUiState(
    val id: String = "",
    /** ⚠ 원문을 그대로 든다. **화면에는 절대 원문을 그리지 않는다**(masked 로만 그린다). */
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
)

/** 비밀번호 표시 — 길이만 알려준다. 빈 값이면 안내 문구. */
internal fun maskedPassword(password: String): String =
    if (password.isEmpty()) "" else "●".repeat(password.length.coerceAtMost(12))

@Composable
private fun InputRow(label: String, shown: String, placeholder: String, enabled: Boolean, onTap: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .border(1.dp, VgColors.Divider, RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onTap)
            .padding(horizontal = 12.dp, vertical = 5.dp),
    ) {
        Text(label, color = VgColors.Secondary, fontSize = 9.sp)
        Text(
            shown.ifEmpty { placeholder },
            color = if (shown.isEmpty()) VgColors.Idle else VgColors.Primary,
            fontSize = 14.sp,
        )
    }
}

@Composable
fun LoginScreen(
    state: LoginUiState,
    onEditId: () -> Unit,
    onEditPassword: () -> Unit,
    onSubmit: () -> Unit,
    onCancel: () -> Unit,
) {
    TransformingLazyColumn(
        modifier = Modifier.fillMaxSize().background(VgColors.Background),
        horizontalAlignment = Alignment.CenterHorizontally,
        // ★ 세로 패딩이 없으면 첫 줄과 마지막 버튼이 둥근 가장자리에 잘린다(08-29 프리뷰·실기 대조).
        //   위아래 22dp 를 비우고 칸·버튼을 낮춰 제목·칸 2·로그인이 한 화면(226dp)에 들어온다.
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 22.dp),
    ) {
        item { Text("VitAlGuard", color = VgColors.Primary, fontSize = 14.sp, modifier = Modifier.padding(bottom = 2.dp)) }
        item { InputRow("아이디", state.id, "탭하여 입력", !state.busy, onEditId) }
        item { InputRow("비밀번호", maskedPassword(state.password), "탭하여 입력", !state.busy, onEditPassword) }
        item {
            Button(
                onClick = onSubmit,
                enabled = !state.busy,
                label = {
                    Text(
                        if (state.busy) "확인 중…" else "로그인",
                        fontSize = 13.sp,
                        color = Color.Black,
                    )
                },
                colors = ButtonDefaults.buttonColors(containerColor = VgColors.Normal),
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp).height(40.dp),
            )
        }
        state.error?.let { msg ->
            item {
                Text(
                    msg,
                    color = VgColors.Danger,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
        item {
            Button(
                onClick = onCancel,
                enabled = !state.busy,
                label = { Text("취소", fontSize = 13.sp, color = VgColors.Primary) },
                colors = ButtonDefaults.buttonColors(containerColor = VgColors.Pill),
                modifier = Modifier.fillMaxWidth().padding(top = 3.dp).height(40.dp),
            )
        }
    }
}
