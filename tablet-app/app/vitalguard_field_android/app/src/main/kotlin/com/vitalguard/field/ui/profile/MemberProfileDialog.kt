package com.vitalguard.field.ui.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.R
import com.vitalguard.field.data.models.AppUser
import com.vitalguard.field.data.profile.*
import com.vitalguard.field.ui.theme.*

@Composable
fun MemberProfileDialog(controller: MemberProfileController, user: AppUser?) {
    val state by controller.state.collectAsStateWithLifecycle()
    if (state.visible) DashboardTheme {
        AlertDialog(onDismissRequest = controller::dismiss, containerColor = DashboardColors.sidebar,
            title = { Row(verticalAlignment = Alignment.CenterVertically) {
                Text("회원정보", Modifier.weight(1f))
                ActionIconButton(R.drawable.ic_refresh, "회원정보 새로고침", controller::refresh, size = 56.dp, enabled = !state.loading, busy = state.loading)
            } },
            text = { MemberProfileDetails(state, user) },
            confirmButton = { ActionIconButton(R.drawable.ic_close, "회원정보 닫기", controller::dismiss, Modifier.testTag("member-profile-close"), size = 56.dp) })
    }
}

@Composable
fun MemberProfileDetails(state: MemberProfileState, user: AppUser?) {
    val p = state.profile
    val role = when (p?.role ?: user?.role) { "owner", "platform_admin" -> "운영 관리자"; "admin" -> "관리자"; "site_manager" -> "현장 관리자"; "worker" -> "작업자"; else -> "—" }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).testTag("member-profile"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let { StateLabel(StateKind.failed, it) }
        listOf("이름" to (p?.name ?: user?.name), "아이디" to (p?.username ?: user?.id), "권한" to role,
            "직급" to p?.jobTitle, "소속" to p?.company, "부서" to p?.department, "사번" to p?.employeeId,
            "전화번호" to safeMaskedPhone(p?.phoneMasked), "이메일" to p?.email).forEach { (label, value) ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(label, Modifier.weight(.32f), color = DashboardColors.secondary)
                Text(value ?: "—", Modifier.weight(.68f).testTag("profile-$label"))
            }
            HorizontalDivider(color = DashboardColors.line)
        }
    }
}
