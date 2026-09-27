package com.vitalguard.field.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vitalguard.field.R
import com.vitalguard.field.data.contracts.FieldState
import com.vitalguard.field.ui.placeholder.PlaceholderScreen
import com.vitalguard.field.ui.site.SiteScreen
import com.vitalguard.field.ui.site.SiteSummaryState
import com.vitalguard.field.ui.theme.*
import kotlin.math.max

@Composable
fun FieldShell(
    field: FieldState, shell: ShellState, site: SiteSummaryState, isMock: Boolean, windowWidthDp: Int,
    onWidth: (Int) -> Unit, onToggle: () -> Unit, onSelect: (Int) -> Unit, onLogout: () -> Unit,
    onRefresh: () -> Unit, onNextStage: () -> Unit,
    recordContent: @Composable () -> Unit = { PlaceholderScreen("기록", 2) },
    outboxContent: @Composable () -> Unit = { PlaceholderScreen("전송 이력", 3) },
    siteContent: @Composable () -> Unit = { SiteScreen(site, onRefresh, onNextStage) },
    alertsContent: @Composable () -> Unit = { PlaceholderScreen("경보", 1) },
    settingsContent: @Composable () -> Unit = { PlaceholderScreen("설정", 4) },
    globalAlertContent: @Composable () -> Unit = {},
    drawWallpaper: Boolean = true,
) {
    LaunchedEffect(windowWidthDp) { onWidth(windowWidthDp) }
    val collapsed = shell.recordEditorOpen || (shell.collapsed ?: (windowWidthDp < vgTwoPaneMinWidth))
    val siteName = field.site?.site_name ?: "현장 정보 없음"
    val userName = field.user?.name ?: field.user?.id ?: "사용자 정보 없음"
    val scale = LocalDensity.current.fontScale.coerceAtLeast(1f)
    var receiptDetails by rememberSaveable { mutableStateOf(false) }
    val receiptState = when {
        shell.destination <= 1 && field.siteStatusForbidden -> StateKind.locked to "접근 권한 없음"
        field.offline -> StateKind.offline to "오프라인"
        shell.destination == 0 && site.failed -> StateKind.failed to "수신 실패"
        shell.destination == 0 && site.loading -> StateKind.loading to "갱신 중"
        shell.destination == 0 && site.stale -> StateKind.stale to "오래된 자료"
        shell.destination == 1 && field.siteStatusSnapshot?.alerts?.ok == false -> StateKind.failed to "경보 수신 실패"
        shell.destination <= 1 && field.siteStatusSnapshot != null -> StateKind.ready to "수신 완료"
        shell.destination <= 1 -> StateKind.empty to "수신 대기"
        shell.destination == 4 -> StateKind.info to "기기에 저장"
        else -> StateKind.empty to "기기에 보관 · 자동 전송"
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
    if (drawWallpaper) DashboardBackdrop(Modifier.matchParentSize())
    val horizontalMargin = if (maxWidth >= 1000.dp) 32.dp else 16.dp
    val verticalMargin = if (maxHeight >= 600.dp) 20.dp else 8.dp
    DashboardWorkspace(Modifier.fillMaxSize().padding(horizontal = horizontalMargin, vertical = verticalMargin)) {
    Row(Modifier.fillMaxSize().padding(10.dp)) {
        DashboardTheme { CompositionLocalProvider(LocalContentColor provides DashboardColors.text) {
            FieldRail(collapsed, userName, isMock, shell, onToggle, onSelect, onLogout)
        } }
        Box(Modifier.weight(1f).fillMaxHeight()) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().height((64 * scale).dp).testTag("shell-receipt-slot")
                    .padding(horizontal = 24.dp).clip(RoundedCornerShape(14.dp))
                    .background(if (field.offline) Color(0xFF4C4437) else Color.Transparent)
                    .padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("현장 · $siteName", Modifier.weight(2f).verticalScroll(rememberScrollState()),
                        color = DashboardColors.text, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.width(16.dp))
                    VerticalDivider(Modifier.height(28.dp), color = DashboardColors.line)
                    Spacer(Modifier.width(16.dp))
                    key(shell.destination, field.offline) {
                        Box(Modifier.weight(3f).testTag("shell-receipt-scroll").verticalScroll(rememberScrollState())) {
                            DashboardTheme {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    StateIcon(receiptState.first)
                                    Text(receiptState.second, Modifier.weight(1f).testTag("shell-receipt")
                                        .semantics { stateDescription = shellReceipt(shell.destination, field) }, color = DashboardColors.text)
                                    VgIconButton(R.drawable.ic_state_info, "상태 자세히", Modifier.testTag("shell-receipt-details"), onClick = { receiptDetails = true })
                                }
                            }
                        }
                    }
                }
                val pages = rememberSaveableStateHolder()
                Box(Modifier.weight(1f).fillMaxWidth().testTag("shell-content")) {
                    // IndexedStack 대응: 탭별 스크롤/rememberSaveable 보존, 요청/자료는 ViewModel에 유지.
                    pages.SaveableStateProvider(shell.destination) {
                        val page: @Composable () -> Unit = {
                        when (shell.destination) {
                            0 -> siteContent()
                            1 -> alertsContent()
                            2 -> recordContent()
                            3 -> outboxContent()
                            4 -> settingsContent()
                        }
                        }
                        DashboardTheme { page() }
                    }
                }
                // Port: global_alert_strip.dart. 내용은 3단계, 슬롯은 상태와 관계없이 항상 예약.
                Box(Modifier.fillMaxWidth().height((max(56f, 16 * scale * 1.3f * 2 + 24) + 16).dp)
                    .testTag("global-alert-slot").semantics { stateDescription = if (shell.recordEditorOpen) "편집 중 경보 표시 지연" else "경보 표시 영역" }) {
                    DashboardTheme { globalAlertContent() }
                }
            }
        }
    }
    }
    }
    if (receiptDetails) DashboardTheme {
        AlertDialog(onDismissRequest = { receiptDetails = false }, icon = { StateIcon(receiptState.first, Modifier.size(32.dp)) },
            title = { Text(receiptState.second) }, text = { Text(shellReceipt(shell.destination, field), Modifier.verticalScroll(rememberScrollState())) },
            containerColor = DashboardColors.sidebar, confirmButton = { TextButton({ receiptDetails = false }) { Text("확인") } })
    }
}

@Composable
private fun FieldRail(
    collapsed: Boolean, userName: String, isMock: Boolean, shell: ShellState,
    onToggle: () -> Unit, onSelect: (Int) -> Unit, onLogout: () -> Unit,
) {
    BoxWithConstraints(Modifier.width(if (collapsed) 80.dp else 256.dp).fillMaxHeight()
        .clip(RoundedCornerShape(24.dp)).background(DashboardColors.sidebar)
        .testTag(if (collapsed) "rail-collapsed" else "rail-expanded")) {
        val viewportHeight = maxHeight
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = viewportHeight)
            .padding(horizontal = 12.dp, vertical = 16.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.fillMaxWidth()) {
                if (collapsed) {
                    Box(Modifier.fillMaxWidth().height(56.dp)) {
                        if (isMock) Box(Modifier.offset(x = (-12).dp, y = 8.dp).size(6.dp, 40.dp)
                            .background(DashboardColors.accent).testTag("mock-rail-marker").semantics { contentDescription = "모의 데이터" })
                        VgIconButton(R.drawable.ic_chevron_right, "레일 펼치기",
                            Modifier.align(Alignment.Center).testTag("rail-collapse-toggle"), enabled = !shell.recordEditorOpen, onClick = onToggle)
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text("VitAlGuard", color = DashboardColors.text, fontSize = 23.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-.6).sp)
                            Text("현장 관리", color = DashboardColors.secondary, fontSize = 12.sp)
                        }
                        VgIconButton(R.drawable.ic_chevron_left, "레일 접기", Modifier.testTag("rail-collapse-toggle"), onClick = onToggle)
                    }
                    if (isMock) Text("모의 데이터", Modifier.padding(start = 12.dp, bottom = 16.dp).testTag("mock-label"), color = DashboardColors.secondary)
                }
                Spacer(Modifier.height(16.dp))
                if (!collapsed) RailGroupTitle("상황")
                RailItem(0, "현장", R.drawable.ic_site, collapsed, shell.destination, onSelect)
                Spacer(Modifier.height(vgGapTap))
                RailItem(1, "경보", R.drawable.ic_alert, collapsed, shell.destination, onSelect)
                Spacer(Modifier.height(24.dp))
                if (!collapsed) RailGroupTitle("기록")
                RailItem(2, "기록", R.drawable.ic_record, collapsed, shell.destination, onSelect)
                Spacer(Modifier.height(vgGapTap))
                RailItem(3, "전송 이력", R.drawable.ic_outbox, collapsed, shell.destination, onSelect)
                Spacer(Modifier.height(16.dp))
            }
            Column(Modifier.fillMaxWidth()) {
                HorizontalDivider(Modifier.testTag("rail-footer-divider"), color = DashboardColors.line)
                Spacer(Modifier.height(8.dp))
                RailItem(4, "설정", R.drawable.ic_settings, collapsed, shell.destination, onSelect)
                Spacer(Modifier.height(vgGapTap))
                if (collapsed) {
                    Box(Modifier.fillMaxWidth().height(56.dp), contentAlignment = Alignment.Center) {
                        VgIcon(R.drawable.ic_person, userName, Modifier.size(20.dp), tint = DashboardColors.secondary)
                    }
                    VgIconButton(R.drawable.ic_logout, "로그아웃", enabled = !shell.loggingOut, onClick = onLogout)
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        VgIcon(R.drawable.ic_person, modifier = Modifier.size(20.dp), tint = DashboardColors.secondary)
                        Spacer(Modifier.width(12.dp))
                        Text(userName, Modifier.weight(1f), color = DashboardColors.text)
                    }
                    Spacer(Modifier.height(16.dp))
                    OutlinedButton(onLogout, Modifier.fillMaxWidth().heightIn(min = vgTapMin), enabled = !shell.loggingOut) {
                        VgIcon(R.drawable.ic_logout)
                        Spacer(Modifier.width(8.dp))
                        Text("로그아웃")
                    }
                }
            }
        }
    }
}

@Composable
private fun RailGroupTitle(label: String) {
    Text(label, Modifier.padding(start = 16.dp, bottom = 8.dp), color = DashboardColors.secondary, fontWeight = FontWeight.Medium, fontSize = 12.sp)
}

@Composable
private fun RailItem(index: Int, label: String, icon: Int, collapsed: Boolean, destination: Int, onSelect: (Int) -> Unit) {
    val selected = destination == index
    val foreground = if (selected) DashboardColors.accent else DashboardColors.secondary
    Row(Modifier.fillMaxWidth().heightIn(min = vgTapMin).clip(RoundedCornerShape(16.dp))
        .background(if (selected) Color(0xFF3C4A50) else Color.Transparent)
        .testTag("rail-destination-$index").semantics { contentDescription = label }
        .selectable(selected, role = Role.Tab, onClick = { onSelect(index) })
        .padding(horizontal = if (collapsed) 8.dp else 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        if (collapsed) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                VgIcon(icon, modifier = Modifier.size(20.dp), tint = foreground)
            }
        } else {
            VgIcon(icon, modifier = Modifier.size(20.dp), tint = foreground)
            Spacer(Modifier.width(16.dp))
            Text(label, Modifier.weight(1f), color = foreground, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
        }
        Box(Modifier.size(8.dp).then(if (selected)
            Modifier.background(DashboardColors.accent, CircleShape).testTag("rail-selection-dot") else Modifier))
    }
}
