package com.vitalguard.field.ui.theme

import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vitalguard.field.R

const val actionIconVisualScale = .86f

/** A smaller visible circle inside the existing glove-sized touch target. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionIconButton(icon: Int, label: String, onClick: () -> Unit, modifier: Modifier = Modifier,
    enabled: Boolean = true, size: Dp = 64.dp, iconSize: Dp = 28.dp, tint: Color = MaterialTheme.colorScheme.primary,
    busy: Boolean = false, visualScale: Float = actionIconVisualScale) {
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
        Box(modifier.size(size).clip(CircleShape)
            .semantics { contentDescription = label; if (busy) stateDescription = "처리 중" }
            .clickable(enabled = enabled && !busy, role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
            val color = tint.copy(alpha = if (enabled || busy) 1f else .38f)
            Surface(Modifier.size(size * visualScale), shape = CircleShape, color = Color.Transparent,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = if (enabled || busy) 1f else .38f))) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (busy && icon != R.drawable.ic_refresh) {
                        CircularProgressIndicator(Modifier.size(iconSize * visualScale), color = color, strokeWidth = 2.dp)
                    } else {
                        val rotation = if (busy) {
                            val transition = rememberInfiniteTransition(label = "조회 중")
                            val degrees by transition.animateFloat(0f, 360f, infiniteRepeatable(tween(850, easing = LinearEasing)), label = "새로고침 회전")
                            degrees
                        } else 0f
                        VgIcon(icon, modifier = Modifier.size(iconSize * visualScale).graphicsLayer { rotationZ = rotation }, tint = color)
                    }
                }
            }
        }
    }
}
