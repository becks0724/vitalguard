package com.vitalguard.field.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vitalguard.field.R
import com.vitalguard.field.data.OutboxPhase

enum class StateKind(val icon: Int) {
    offline(R.drawable.ic_state_offline), failed(R.drawable.ic_state_failed),
    loading(R.drawable.ic_refresh), stale(R.drawable.ic_state_clock),
    locked(R.drawable.ic_state_lock), ready(R.drawable.ic_state_check),
    empty(R.drawable.ic_state_empty), info(R.drawable.ic_state_info), warning(R.drawable.ic_state_failed);
    val color: Color get() = when (this) {
        failed -> DashboardColors.danger
        offline, stale, locked, warning -> DashboardColors.warning
        ready -> DashboardColors.normal
        loading -> DashboardColors.accent
        else -> DashboardColors.secondary
    }
}

fun OutboxPhase.visualState() = when (this) {
    OutboxPhase.completed -> StateKind.ready
    OutboxPhase.failed -> StateKind.failed
    OutboxPhase.uncertain -> StateKind.stale
    OutboxPhase.reauthenticate -> StateKind.locked
    OutboxPhase.sending -> StateKind.loading
    OutboxPhase.waiting -> StateKind.empty
}

@Composable
fun StateIcon(kind: StateKind, modifier: Modifier = Modifier.size(22.dp)) {
    VgIcon(kind.icon, modifier = modifier.testTag("state-icon-${kind.name}"), tint = kind.color)
}

@Composable
fun StateLabel(kind: StateKind, label: String, modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium, iconSize: Dp = 20.dp) {
    Row(modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StateIcon(kind, Modifier.size(iconSize))
        Text(label, style = style, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun StateNotice(kind: StateKind, title: String, detail: String? = null, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.Black.copy(alpha = .16f)).padding(16.dp),
        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        StateIcon(kind, Modifier.padding(top = 2.dp).size(28.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            detail?.let { Text(it, color = DashboardColors.secondary, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
