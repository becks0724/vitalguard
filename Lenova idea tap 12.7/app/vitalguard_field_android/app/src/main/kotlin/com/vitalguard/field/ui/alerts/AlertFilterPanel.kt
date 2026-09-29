package com.vitalguard.field.ui.alerts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.vitalguard.field.R
import com.vitalguard.field.data.models.AlertType
import com.vitalguard.field.ui.theme.*

@Composable
fun AlertFilterPanel(acknowledged: Boolean, type: String?, onStatus: (Boolean) -> Unit, onType: (String?) -> Unit,
    onReset: () -> Unit, onApply: () -> Unit, onClose: () -> Unit) {
    var category by remember { mutableIntStateOf(0) }
    Column(Modifier.widthIn(max = 560.dp).testTag("alerts-filter-panel")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            VgIcon(R.drawable.ic_filter); Spacer(Modifier.width(8.dp))
            Text("조회 필터", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            ActionIconButton(R.drawable.ic_close, "필터 닫기", onClose, Modifier.testTag("alerts-filter-close"), size = 56.dp)
        }
        HorizontalDivider(color = Color.White.copy(alpha = .16f))
        Row(Modifier.fillMaxWidth().height((LocalConfiguration.current.screenHeightDp * .45f).coerceIn(190f, 370f).dp)) {
            Column(Modifier.weight(.38f).fillMaxHeight().background(Color.White.copy(alpha = .035f))
                .verticalScroll(rememberScrollState()).selectableGroup()) {
                listOf("대응 상태", "경보 종류").forEachIndexed { index, text ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp)
                        .background(if (category == index) DashboardColors.accent.copy(alpha = .12f) else Color.Transparent)
                        .testTag("alerts-filter-category-$index")
                        .selectable(category == index, role = Role.Tab) { category = index }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(text, color = if (category == index) DashboardColors.accent else DashboardColors.text, fontWeight = FontWeight.Medium)
                    }
                }
            }
            VerticalDivider(color = Color.White.copy(alpha = .16f))
            Column(Modifier.weight(.62f).fillMaxHeight().verticalScroll(rememberScrollState()).selectableGroup().testTag("alerts-filter-options")) {
                if (category == 0) listOf(false, true).forEach { done ->
                    FilterOption(if (done) "대응완료" else "미대응", acknowledged == done,
                        if (done) "alerts-filter-acked" else "alerts-filter-unacked") { onStatus(done) }
                } else (listOf<String?>(null) + AlertType.entries.map { it.name }).forEach { name ->
                    FilterOption(AlertType.entries.firstOrNull { it.name == name }?.label ?: "전체 종류", type == name,
                        "alerts-type-${name ?: "all"}") { onType(name) }
                }
            }
        }
        HorizontalDivider(color = Color.White.copy(alpha = .16f))
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            ActionIconButton(R.drawable.ic_refresh, "필터 초기화", onReset, Modifier.testTag("alerts-filter-reset"), size = 56.dp)
            Spacer(Modifier.weight(1f))
            ActionIconButton(R.drawable.ic_check, "필터 적용", onApply, Modifier.testTag("alerts-filter-apply"), size = 56.dp)
        }
    }
}

@Composable
private fun FilterOption(label: String, chosen: Boolean, tag: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).testTag(tag).selectable(chosen, role = Role.RadioButton, onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(chosen, null); Spacer(Modifier.width(8.dp)); Text(label, Modifier.weight(1f))
    }
    HorizontalDivider(color = Color.White.copy(alpha = .08f))
}
