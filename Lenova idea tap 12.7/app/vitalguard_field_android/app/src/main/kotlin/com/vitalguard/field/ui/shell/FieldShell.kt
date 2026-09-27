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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
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
) {
    LaunchedEffect(windowWidthDp) { onWidth(windowWidthDp) }
    val collapsed = shell.recordEditorOpen || (shell.collapsed ?: (windowWidthDp < vgTwoPaneMinWidth))
    val siteName = field.site?.site_name ?: "현장 정보 없음"
    val userName = field.user?.name ?: field.user?.id ?: "사용자 정보 없음"
    val scale = LocalDensity.current.fontScale.coerceAtLeast(1f)
    Row(Modifier.fillMaxSize()) {
        FieldRail(collapsed, siteName, userName, isMock, shell, onToggle, onSelect, onLogout)
        Box(Modifier.weight(1f).fillMaxHeight()) {
            VgBackground(Modifier.matchParentSize())
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().height((52 * scale).dp).testTag("shell-receipt-slot")
                    .background(if (field.offline) Color(0xFFFFF1CD) else Color(0xFFF3F4F6))
                    .padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("현장 · $siteName", Modifier.weight(2f).verticalScroll(rememberScrollState()),
                        color = VgColors.ink, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(16.dp))
                    VerticalDivider(Modifier.height(28.dp), color = VgColors.hairlineStrong)
                    Spacer(Modifier.width(16.dp))
                    key(shell.destination, field.offline) {
                        Box(Modifier.weight(3f).testTag("shell-receipt-scroll").verticalScroll(rememberScrollState())) {
                            Text(shellReceipt(shell.destination, field), Modifier.testTag("shell-receipt"), color = VgColors.ink)
                        }
                    }
                }
                val pages = rememberSaveableStateHolder()
                Box(Modifier.weight(1f).fillMaxWidth().testTag("shell-content")) {
                    // IndexedStack 대응: 탭별 스크롤/rememberSaveable 보존, 요청/자료는 ViewModel에 유지.
                    pages.SaveableStateProvider(shell.destination) {
                        when (shell.destination) {
                            0 -> siteContent()
                            1 -> alertsContent()
                            2 -> recordContent()
                            3 -> outboxContent()
                            4 -> settingsContent()
                        }
                    }
                }
                // Port: global_alert_strip.dart. 내용은 3단계, 슬롯은 상태와 관계없이 항상 예약.
                Box(Modifier.fillMaxWidth().height((max(56f, 16 * scale * 1.3f * 2 + 24) + 16).dp)
                    .testTag("global-alert-slot").semantics { stateDescription = if (shell.recordEditorOpen) "편집 중 경보 표시 지연" else "경보 표시 영역" }) {
                    globalAlertContent()
                }
            }
        }
    }
}

@Composable
private fun FieldRail(
    collapsed: Boolean, siteName: String, userName: String, isMock: Boolean, shell: ShellState,
    onToggle: () -> Unit, onSelect: (Int) -> Unit, onLogout: () -> Unit,
) {
    BoxWithConstraints(Modifier.width(if (collapsed) 80.dp else 256.dp).fillMaxHeight()
        .background(VgColors.canvas).testTag(if (collapsed) "rail-collapsed" else "rail-expanded")
        .drawWithContent {
            drawContent()
            drawLine(VgColors.hairlineStrong, Offset(size.width - .5.dp.toPx(), 0f),
                Offset(size.width - .5.dp.toPx(), size.height), 1.dp.toPx())
        }) {
        val viewportHeight = maxHeight
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = viewportHeight)
            .padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.fillMaxWidth()) {
                if (collapsed) {
                    Box(Modifier.fillMaxWidth().height(56.dp)) {
                        if (isMock) Box(Modifier.offset(x = (-12).dp, y = 8.dp).size(6.dp, 40.dp)
                            .background(VgColors.primary).testTag("mock-rail-marker").semantics { contentDescription = "모의 데이터" })
                        VgIconButton(R.drawable.ic_chevron_right, "레일 펼치기",
                            Modifier.align(Alignment.Center).testTag("rail-collapse-toggle"), enabled = !shell.recordEditorOpen, onClick = onToggle)
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(siteName, Modifier.weight(1f), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        VgIconButton(R.drawable.ic_chevron_left, "레일 접기", Modifier.testTag("rail-collapse-toggle"), onClick = onToggle)
                    }
                    if (isMock) Text("모의 데이터", Modifier.padding(bottom = 16.dp).testTag("mock-label"))
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
                HorizontalDivider(Modifier.testTag("rail-footer-divider"), color = VgColors.hairlineStrong)
                Spacer(Modifier.height(8.dp))
                RailItem(4, "설정", R.drawable.ic_settings, collapsed, shell.destination, onSelect)
                Spacer(Modifier.height(vgGapTap))
                if (collapsed) {
                    Box(Modifier.fillMaxWidth().height(56.dp), contentAlignment = Alignment.Center) {
                        VgIcon(R.drawable.ic_person, userName, Modifier.size(20.dp))
                    }
                    VgIconButton(R.drawable.ic_logout, "로그아웃", enabled = !shell.loggingOut, onClick = onLogout)
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        VgIcon(R.drawable.ic_person, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(userName, Modifier.weight(1f))
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
    Text(label, Modifier.padding(start = 16.dp, bottom = 8.dp), color = VgColors.body, fontWeight = FontWeight.Bold)
}

@Composable
private fun RailItem(index: Int, label: String, icon: Int, collapsed: Boolean, destination: Int, onSelect: (Int) -> Unit) {
    val selected = destination == index
    val foreground = if (selected) Color.White else VgColors.ink
    Row(Modifier.fillMaxWidth().heightIn(min = vgTapMin).clip(RoundedCornerShape(8.dp))
        .background(if (selected) VgColors.primary else Color.Transparent)
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
            Modifier.background(Color.White, CircleShape).testTag("rail-selection-dot") else Modifier))
    }
}
