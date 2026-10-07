package com.vitalguard.field.ui.theme

import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import kotlin.math.max
import com.vitalguard.field.R

object VgColors {
    val primary = Color(0xFF0D74CE)
    val primaryActive = Color(0xFF0A5FAD)
    val primarySubtle = Color(0x140D74CE)
    val canvas = Color(0xFFFFFFFF)
    val surfaceSoft = Color(0xFFFAFAFA)
    val surfaceStrong = Color(0xFFF0F0F3)
    val hairline = Color(0xFFF0F0F3)
    val hairlineStrong = Color(0xFFDCDEE0)
    val ink = Color(0xFF171717)
    val body = Color(0xFF60646C)
    val muted = Color(0xFF999999) // 본문에 사용하지 않는다.
    val ok = Color(0xFF10B981)
    val warn = Color(0xFFF59E0B)
    val danger = Color(0xFFEF4444)
    val okTint = Color(0xFFE7F8F2)
    val warnTint = Color(0xFFFEF3DC)
    val dangerTint = Color(0xFFFDE8E8)
}
val vgTapMin = 56.dp
val vgTapPrimary = 64.dp
val vgGapTap = 16.dp
val vgRadiusCard = 16.dp
const val vgCardSurfaceAlpha = 0.88f
fun vgToolbarHeight(fontScale: Float) = max(56f, 22f * fontScale * 1.4f + 16f).dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VgTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides vgTapMin) {
        MaterialTheme(
            colorScheme = lightColorScheme(
                primary = VgColors.primary, onPrimary = Color.White,
                secondary = VgColors.primaryActive, onSecondary = Color.White,
                background = VgColors.canvas, onBackground = VgColors.ink,
                surface = VgColors.canvas, onSurface = VgColors.ink,
                onSurfaceVariant = VgColors.body, outline = VgColors.body,
                outlineVariant = VgColors.hairlineStrong,
                error = VgColors.danger, onError = VgColors.ink,
            ),
            content = content,
        )
    }
}

@Composable
fun VgIcon(resource: Int, description: String? = null, modifier: Modifier = Modifier, tint: Color = LocalContentColor.current) {
    Icon(painterResource(resource), description, modifier, tint)
}

@Composable
fun VgIconButton(resource: Int, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick, modifier.sizeIn(minWidth = vgTapMin, minHeight = vgTapMin), enabled) {
        VgIcon(resource, label)
    }
}

/** Shared previous-screen control; keep the full glove-sized hit area around the chevron. */
@Composable
fun VgBackButton(modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick, modifier.sizeIn(minWidth = vgTapMin, minHeight = vgTapMin), enabled) {
        VgIcon(R.drawable.ic_previous, "이전", Modifier.size(28.dp))
    }
}
