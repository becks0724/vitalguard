package com.vitalguard.field

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.stage3SampleStatus
import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.shell.*
import com.vitalguard.field.ui.site.*
import com.vitalguard.field.ui.theme.VgTheme
import com.vitalguard.field.ui.theme.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Instant

private val dashboardTime = Instant.parse("2026-09-27T06:00:00Z")
@Composable
private fun DashboardExample(width: Int, empty: Boolean = false, forbidden: Boolean = false) {
    val data = if (empty || forbidden) null else stage3SampleStatus(dashboardTime.toString())
    val site = SiteSummaryState(data, failed = empty, forbidden = forbidden, now = dashboardTime)
    val field = FieldState(authStage = AuthStage.ready, offline = empty, siteStatusSnapshot = data, siteStatusForbidden = forbidden,
        site = SiteInfo(mapOf("site_name" to "한빛 현장 · 미리보기")),
        user = AppUser(mapOf("id" to "preview", "role" to "site_manager", "name" to "현장 관리자")))
    VgTheme {
        FieldShell(field, ShellState(collapsed = width < 1000), site, true, width,
            onWidth = {}, onToggle = {}, onSelect = {}, onLogout = {}, onRefresh = {}, onNextStage = {})
    }
}

@PreviewTest @Preview(name = "DashboardLandscape", device = "spec:width=1385dp,height=866dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun DashboardLandscapePreview() = DashboardExample(1385)
@PreviewTest @Preview(name = "DashboardPortrait", device = "spec:width=866dp,height=1385dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun DashboardPortraitPreview() = DashboardExample(866)
@PreviewTest @Preview(name = "DashboardOffline", device = "spec:width=1385dp,height=866dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun DashboardOfflinePreview() = DashboardExample(1385, empty = true)
@PreviewTest @Preview(name = "DashboardLargeText", device = "spec:width=600dp,height=960dp,dpi=160", locale = "ko", fontScale = 2f, showBackground = true)
@Composable fun DashboardLargeTextPreview() = DashboardExample(600, forbidden = true)

@PreviewTest @Preview(name = "StatusIcons", device = "spec:width=600dp,height=980dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun StatusIconsPreview() {
    GlassPreviewSurface {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("상태 안내 · 미리보기")
            StateNotice(StateKind.offline, "오프라인", "기록은 기기에 보관합니다.")
            StateNotice(StateKind.failed, "수신 실패", "연결 후 새로고침해 주세요.")
            StateNotice(StateKind.loading, "갱신 중", "이전에 받은 자료를 표시합니다.")
            StateNotice(StateKind.stale, "오래된 자료", "현재 상태와 다를 수 있습니다.")
            StateNotice(StateKind.locked, "접근 권한 없음", "역할·현장 배정을 확인해 주세요.")
            StateNotice(StateKind.ready, "수신 완료", "마지막 확인값을 표시합니다.")
            StateNotice(StateKind.empty, "수신 대기", "확인할 자료를 기다립니다.")
        }
    }
}
