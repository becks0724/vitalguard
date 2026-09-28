package com.vitalguard.field.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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
import com.vitalguard.field.data.cctv.CCTV_PERIOD_OPTIONS
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
                Text("영상 화면을 보고 있을 때 새 이미지를 받는 간격입니다.")
                FlowRow(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    CCTV_PERIOD_OPTIONS.forEach { seconds ->
                        val chosen = cctv.periodSeconds == seconds
                        OutlinedButton({ onCctvPeriod(seconds) },
                            Modifier.widthIn(min = 112.dp).heightIn(min = vgTapMin).testTag("settings-cctv-period-$seconds")
                                .semantics { selected = chosen; role = Role.RadioButton },
                            enabled = cctv.periodLoaded && !cctv.periodSaving,
                            colors = ButtonDefaults.outlinedButtonColors(containerColor = if (chosen)
                                MaterialTheme.colorScheme.primaryContainer else androidx.compose.ui.graphics.Color.Transparent,
                                contentColor = MaterialTheme.colorScheme.onSurface)) {
                            RadioButton(chosen, null, enabled = cctv.periodLoaded && !cctv.periodSaving)
                            Spacer(Modifier.width(8.dp)); Text("${seconds}초")
                        }
                    }
                }
                Text("2초는 자주 갱신하고, 10초는 통신량을 줄입니다. 기본값은 5초입니다.")
                Text("영상 화면을 나가거나 앱을 내리면 갱신을 멈춥니다. 이 기기에서 현재 계정의 선택을 기억합니다.")
                if (!cctv.periodLoaded || cctv.periodSaving) StateLabel(StateKind.loading,
                    if (cctv.periodSaving) "저장 중…" else "선택을 불러오는 중…")
                cctv.periodError?.let { StateNotice(StateKind.failed, "설정 저장 확인 필요", it, Modifier.testTag("cctv-setting-error")) }
            }
        }
        GlassCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("실행 버튼 위치", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("잡는 손에 맞춰 자주 쓰는 버튼을 화면 하단 왼쪽 또는 오른쪽에 놓습니다.")
                FlowRow(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    ActionSide.entries.forEach { side ->
                        val isSelected = placement.side == side
                        OutlinedButton(onClick = { onSelect(side) },
                            modifier = Modifier.widthIn(min = 180.dp).heightIn(min = vgTapMin)
                                .testTag("action-side-${side.name}").semantics { selected = isSelected; role = Role.RadioButton },
                            enabled = placement.loaded && !placement.saving,
                            colors = ButtonDefaults.outlinedButtonColors(containerColor = if (isSelected)
                                MaterialTheme.colorScheme.primaryContainer else androidx.compose.ui.graphics.Color.Transparent, contentColor = MaterialTheme.colorScheme.onSurface)) {
                            RadioButton(isSelected, onClick = null, enabled = placement.loaded && !placement.saving)
                            Spacer(Modifier.width(12.dp))
                            Text(if (side == ActionSide.left) "왼손" else "오른손")
                        }
                    }
                }
                Text("기록의 촬영·스캔, 사진의 펜·댓글, 펜 편집의 도구·저장에 적용됩니다.")
                Text("이 기기에서 현재 계정의 선택을 기억합니다.")
                if (!placement.loaded || placement.saving) StateLabel(StateKind.loading, if (placement.saving) "저장 중…" else "선택을 불러오는 중…")
                placement.error?.let { StateNotice(StateKind.failed, "설정 저장 확인 필요", it, Modifier.testTag("action-side-error")) }
            }
        }
        Text("앱 버전 ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium)
    }
}
