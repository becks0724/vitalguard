package com.vitalguard.field.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vitalguard.field.R
import com.vitalguard.field.data.contracts.AuthStage
import com.vitalguard.field.data.contracts.FieldState
import com.vitalguard.field.ui.theme.*

// Port: auth_screen.dart. 상태/입력은 ViewModel, 프리뷰는 고정 값만 받는다.
@Composable
fun AuthScreen(
    field: FieldState,
    form: AuthFormState,
    isMock: Boolean,
    onId: (String) -> Unit = {},
    onPassword: (String) -> Unit = {},
    onCode: (String) -> Unit = {},
    onRemember: (Boolean) -> Unit = {},
    onTogglePassword: () -> Unit = {},
    onSubmit: () -> Unit = {},
    onCancel: () -> Unit = {},
    onDismissDialog: () -> Unit = {},
) {
    var idValue by rememberAuthFieldValue(form.id)
    var passwordValue by rememberAuthFieldValue(form.password)
    var codeValue by rememberAuthFieldValue(form.code)
    val totp = field.authStage == AuthStage.totp
    val locked = form.seconds > 0
    val title = when (field.authStage) {
        AuthStage.restoring -> "로그인 상태 확인 중"
        AuthStage.totp -> "2단계 인증"
        AuthStage.denied -> "이 앱을 사용할 수 없는 계정입니다"
        AuthStage.reauthenticate -> "다시 로그인해 주세요"
        else -> "VitAlGuard 로그인"
    }
    DashboardTheme {
    val inputColors = OutlinedTextFieldDefaults.colors(
        focusedContainerColor = androidx.compose.ui.graphics.Color.Black.copy(alpha = .32f),
        unfocusedContainerColor = androidx.compose.ui.graphics.Color.Black.copy(alpha = .32f))
    Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
        VgIcon(R.drawable.ic_brand_watermark, modifier = Modifier.align(Alignment.BottomEnd).size(64.dp)
            .testTag("login-brand-watermark"), tint = androidx.compose.ui.graphics.Color.White.copy(alpha = .32f))
        DashboardWorkspace(Modifier.widthIn(max = 616.dp).fillMaxWidth().testTag("auth-glass-card"), overlay = androidx.compose.ui.graphics.Color(0x40303638), clearer = true) {
        Column(
            Modifier.widthIn(max = 616.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                .testTag("auth-scroll").padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (isMock) Text("모의 데이터 · 비밀번호 mock · 아이디 totp는 인증번호 123456", Modifier.testTag("mock-label"))
            Text(title, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            if (field.authStage == AuthStage.restoring) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (field.authStage == AuthStage.reauthenticate) {
                Text("다시 로그인 필요 · 저장 기록 보존")
            }
            if (field.authStage == AuthStage.denied) {
                Text("현장 관리자 계정으로 로그인해 주세요.")
                OutlinedButton(onCancel, Modifier.fillMaxWidth().heightIn(min = vgTapMin)) { Text("다른 계정으로 로그인") }
            } else if (field.authStage != AuthStage.restoring) {
                if (totp) {
                    Text("인증 앱 · 6자리 숫자")
                    OutlinedTextField(codeValue, { codeValue = it; onCode(it.text) },
                        Modifier.fillMaxWidth().heightIn(min = vgTapPrimary).testTag("totp-code"),
                        enabled = !field.busy && !locked, label = { Text("인증번호") }, singleLine = true, colors = inputColors,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { onSubmit() }))
                } else {
                    OutlinedTextField(idValue, { idValue = it; onId(it.text) },
                        Modifier.fillMaxWidth().heightIn(min = vgTapPrimary).testTag("login-id"),
                        enabled = !field.busy, label = { Text("아이디") }, singleLine = true, colors = inputColors,
                        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Next))
                    OutlinedTextField(passwordValue, { passwordValue = it; onPassword(it.text) },
                        Modifier.fillMaxWidth().heightIn(min = vgTapPrimary).testTag("login-password"),
                        enabled = !field.busy, label = { Text("비밀번호") }, singleLine = true, colors = inputColors,
                        visualTransformation = if (form.obscure) PasswordVisualTransformation() else VisualTransformation.None,
                        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
                        trailingIcon = {
                            VgIconButton(if (form.obscure) R.drawable.ic_eye else R.drawable.ic_eye_off,
                                if (form.obscure) "비밀번호 표시" else "비밀번호 숨기기", onClick = onTogglePassword)
                        })
                    Row(Modifier.fillMaxWidth().heightIn(min = vgTapMin)
                        .toggleable(form.remember, enabled = !field.busy, role = Role.Checkbox, onValueChange = onRemember),
                        verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(form.remember, onCheckedChange = null, enabled = !field.busy)
                        Spacer(Modifier.width(16.dp))
                        Text("이 기기에서 로그인 유지")
                    }
                }
                if (locked) Text("${form.seconds}초 뒤 다시 시도할 수 있습니다. 서버가 알려준 잠금 시간입니다.")
                if (field.message != null) Text(field.message, Modifier.testTag("auth-message"))
                Button(onSubmit, Modifier.fillMaxWidth().heightIn(min = vgTapPrimary).testTag("auth-submit"),
                    enabled = !field.busy && !locked) {
                    Text(if (field.busy) "확인 중" else if (totp) "인증번호 확인" else "로그인")
                }
                if (totp) OutlinedButton(onCancel, Modifier.fillMaxWidth().heightIn(min = vgTapMin), enabled = !field.busy) {
                    Text("아이디부터 다시 입력")
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
    }
    form.dialog?.let { dialog ->
        AlertDialog(onDismissRequest = onDismissDialog,
            title = { Text(dialog.title) },
            text = { Text(dialog.body, Modifier.verticalScroll(rememberScrollState())) },
            confirmButton = {
                Button(onDismissDialog, Modifier.heightIn(min = vgTapMin)) { Text("확인") }
            })
    }
}
}

@Composable
private fun rememberAuthFieldValue(text: String): MutableState<TextFieldValue> {
    val value = rememberSaveable(
        // 문자는 ViewModel에서 받는다. 비밀번호·인증번호를 Bundle에 쓰지 않고 선택 범위만 복원한다.
        stateSaver = Saver<TextFieldValue, List<Int>>(
            save = { listOf(it.selection.start, it.selection.end) },
            restore = { TextFieldValue(text, TextRange(it[0], it[1])) },
        ),
    ) { mutableStateOf(TextFieldValue(text, TextRange(text.length))) }
    // 필터링·초기화 등 외부 문자열 변경만 동기화한다. 일반 입력 중에는 선택·IME 조합을 유지한다.
    if (value.value.text != text) {
        value.value = TextFieldValue(text, TextRange(text.length))
    }
    return value
}
