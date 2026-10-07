package com.vitalguard.field.ui.help

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.vitalguard.field.ui.theme.*

@Composable
fun UsageGuideScreen(initialSection: String = "start") {
    var selection by rememberSaveable { mutableStateOf(initialSection) }
    val section = usageGuideSections.firstOrNull { it.id == selection } ?: usageGuideSections.first()
    Column(Modifier.fillMaxSize().padding(24.dp).testTag("usage-guide"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("사용 방법", style = MaterialTheme.typography.headlineSmall)
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            usageGuideSections.forEach { entry ->
                FilterChip(selection == entry.id, { selection = entry.id }, label = { Text(entry.title) },
                    leadingIcon = { VgIcon(entry.icon, modifier = Modifier.size(20.dp)) },
                    modifier = Modifier.heightIn(min = 56.dp).testTag("guide-section-${entry.id}"))
            }
        }
        key(section.id) {
            val scroll = rememberLazyListState()
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                val stackedLabel = maxWidth.value / LocalDensity.current.fontScale < 520
                GlassCard(Modifier.fillMaxSize()) {
                    LazyColumn(Modifier.fillMaxSize().testTag("guide-table"), state = scroll) {
                        item {
                            Row(Modifier.fillMaxWidth().background(DashboardColors.accent.copy(alpha = .10f)).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("기능", Modifier.weight(.3f), fontWeight = FontWeight.Bold)
                                Text("사용 방법", Modifier.weight(.7f), fontWeight = FontWeight.Bold)
                            }
                        }
                        items(section.rows, key = { it.label }) { row ->
                            Row(Modifier.fillMaxWidth().padding(16.dp).testTag("guide-row-${row.label}"), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Box(Modifier.weight(.3f)) {
                                    if (stackedLabel) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        VgIcon(row.icon, modifier = Modifier.size(24.dp), tint = DashboardColors.accent)
                                        Text(row.label, fontWeight = FontWeight.Medium)
                                    } else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        VgIcon(row.icon, modifier = Modifier.size(24.dp), tint = DashboardColors.accent)
                                        Text(row.label, fontWeight = FontWeight.Medium)
                                    }
                                }
                                Text(row.instruction, Modifier.weight(.7f))
                            }
                            HorizontalDivider(color = Color.White.copy(alpha = .12f))
                        }
                    }
                }
            }
        }
    }
}
