package com.vitalguard.field.ui.theme

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Common touch action: stable hit area, spoken name and long-press hint. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionIconButton(icon: Int, label: String, onClick: () -> Unit, modifier: Modifier = Modifier,
    enabled: Boolean = true, size: Dp = 64.dp, tint: Color = MaterialTheme.colorScheme.primary) {
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
        OutlinedButton(onClick, modifier.size(size), enabled = enabled, shape = CircleShape,
            contentPadding = PaddingValues(0.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = tint)) {
            VgIcon(icon, label, Modifier.size(28.dp))
        }
    }
}
