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
    val rotation = remember { Animatable(0f) }
    val latestBusy by rememberUpdatedState(busy)
    var rotationRequests by remember { mutableIntStateOf(0) }
    LaunchedEffect(icon) {
        if (icon != R.drawable.ic_refresh) return@LaunchedEffect
        var completedRequest = 0
        snapshotFlow { latestBusy to rotationRequests }.collect { (working, requested) ->
            if (working || requested > completedRequest) {
                do {
                    completedRequest = rotationRequests
                    rotation.animateTo(360f, tween(850, easing = LinearEasing))
                    rotation.snapTo(0f) // identical orientation, after a completed turn
                } while (latestBusy || rotationRequests > completedRequest)
            }
        }
    }
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
        Box(modifier.size(size).clip(CircleShape)
            .semantics { contentDescription = label; if (busy) stateDescription = "처리 중" }
            .clickable(enabled = enabled && !busy, role = Role.Button) {
                if (icon == R.drawable.ic_refresh) rotationRequests++
                onClick()
            }, contentAlignment = Alignment.Center) {
            val color = tint.copy(alpha = if (enabled || busy) 1f else .38f)
            Surface(Modifier.size(size * visualScale), shape = CircleShape, color = Color.Transparent,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = if (enabled || busy) 1f else .38f))) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (busy && icon != R.drawable.ic_refresh) {
                        CircularProgressIndicator(Modifier.size(iconSize * visualScale), color = color, strokeWidth = 2.dp)
                    } else {
                        VgIcon(icon, modifier = Modifier.size(iconSize * visualScale).graphicsLayer { rotationZ = rotation.value }, tint = color)
                    }
                }
            }
        }
    }
}
