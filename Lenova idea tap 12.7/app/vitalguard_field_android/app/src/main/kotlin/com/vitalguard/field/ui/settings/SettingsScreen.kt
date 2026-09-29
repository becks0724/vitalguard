package com.vitalguard.field.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vitalguard.field.BuildConfig
import com.vitalguard.field.data.*
import com.vitalguard.field.data.cctv.CctvState
import com.vitalguard.field.ui.cctv.CctvPeriodSlider
import com.vitalguard.field.R
import com.vitalguard.field.ui.theme.*
import com.vitalguard.field.ui.theme.VgColors
import com.vitalguard.field.ui.theme.vgCardSurfaceAlpha

@Composable
fun SettingsContent(placement: ActionPlacementState, onSelect: (ActionSide) -> Unit = {},
    cctv: CctvState = CctvState(periodLoaded = true), onCctvPeriod: (Int) -> Unit = {}) {
    Column(Modifier.fillMaxSize().testTag("settings-scroll").verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text("설정", fontSize = 28.sp, fontWeight = FontWeight.Bold)
        GlassCard(Modifier.fillMaxWidth().testTag("settings-cctv")) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    VgIcon(R.drawable.ic_video, modifier = Modifier.size(28.dp))
                    Text("CCTV 갱신 간격", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                }
                CctvPeriodSlider(cctv, onCctvPeriod)
                if (!cctv.periodLoaded || cctv.periodSaving) StateLabel(StateKind.loading,
                    if (cctv.periodSaving) "저장 중…" else "선택을 불러오는 중…")
                cctv.periodError?.let { StateNotice(StateKind.failed, "설정 저장 확인 필요", it, Modifier.testTag("cctv-setting-error")) }
            }
        }
        GlassCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("작업 손", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                WorkHandSelector(placement, onSelect)
                if (!placement.loaded || placement.saving) StateLabel(StateKind.loading, if (placement.saving) "저장 중…" else "선택을 불러오는 중…")
                placement.error?.let { StateNotice(StateKind.failed, "설정 저장 확인 필요", it, Modifier.testTag("action-side-error")) }
            }
        }
        Text("앱 버전 ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WorkHandSelector(placement: ActionPlacementState, onSelect: (ActionSide) -> Unit) {
    val enabled = placement.loaded && !placement.saving
    Surface(Modifier.size(152.dp).testTag("work-hand-selector"), shape = CircleShape,
        color = Color.Transparent, border = BorderStroke(1.dp, DashboardColors.line)) {
        Row(Modifier.fillMaxSize().selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
            ActionSide.entries.forEach { side ->
                val chosen = placement.side == side
                val label = if (side == ActionSide.left) "왼손" else "오른손"
                val icon = when (side) {
                    ActionSide.left -> if (chosen) R.drawable.ic_hand_left_filled else R.drawable.ic_hand_left_outline
                    ActionSide.right -> if (chosen) R.drawable.ic_hand_right_filled else R.drawable.ic_hand_right_outline
                }
                Box(Modifier.weight(1f).fillMaxHeight()) {
                TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
                    tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
                    Box(Modifier.fillMaxSize().testTag("action-side-${side.name}")
                        .semantics { contentDescription = label }
                        .selectable(chosen, enabled, Role.RadioButton) { onSelect(side) }, contentAlignment = Alignment.Center) {
                        VgIcon(icon, modifier = Modifier.size(48.dp),
                            tint = (if (chosen) DashboardColors.accent else DashboardColors.secondary).copy(alpha = if (enabled) 1f else .38f))
                    }
                }
                }
            }
        }
    }
}
