package com.vitalguard.field

// Ports: widget_test.dart(메인 진입), site_screen_test.dart(요약), vg_background_test.dart(배경).
// 파일럿과 같은 PreviewTest. 시계/Keystore/HTTP/타이머 없는 고정 2장, 866dp·340dpi.
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.data.contracts.AuthStage
import com.vitalguard.field.data.contracts.FieldState
import com.vitalguard.field.data.models.SiteStatus
import com.vitalguard.field.data.mock.mockSiteStatusReply
import com.vitalguard.field.ui.auth.AuthFormState
import com.vitalguard.field.ui.auth.AuthScreen
import com.vitalguard.field.ui.shell.VgBackground
import com.vitalguard.field.ui.site.SiteScreen
import com.vitalguard.field.ui.site.SiteSummaryState
import com.vitalguard.field.ui.theme.VgTheme
import java.time.Instant

@PreviewTest
@Preview(name = "Login866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable
fun LoginPreview() {
    VgTheme {
        Surface(Modifier.fillMaxSize()) {
            AuthScreen(FieldState(authStage = AuthStage.login), AuthFormState(), isMock = true)
        }
    }
}

@PreviewTest
@Preview(name = "SiteSummary866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable
fun SiteSummaryPreview() {
    val time = "2026-09-14T15:13:04.759Z"
    VgTheme {
        Box(Modifier.fillMaxSize()) {
            VgBackground(Modifier.fillMaxSize())
            SiteScreen(SiteSummaryState(SiteStatus(mockSiteStatusReply(time)), now = Instant.parse(time)))
        }
    }
}
