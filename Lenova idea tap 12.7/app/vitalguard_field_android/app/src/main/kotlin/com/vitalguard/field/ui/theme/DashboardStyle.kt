package com.vitalguard.field.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.CompositionLocalProvider
import com.vitalguard.field.R

/** Photo → enclosing translucent workspace → glass cards; navigation stays opaque. */
object DashboardColors {
    val backdrop = Color(0xFF303638)
    val backdropLight = Color(0xFF41484A)
    val workspace = Color(0xC9303638)
    val sidebar = Color(0xFF303537)
    val offlineBar = Color(0xB32F444D)
    val card = Color(0x18FFFFFF)
    val text = Color(0xFFF8FAFA)
    val secondary = Color(0xFFF4F6F6)
    val muted = Color(0xFFF4F6F6)
    val accent = Color(0xFF62CEFA)
    val actionText = Color(0xFFF0FAFF)
    val accentInk = Color(0xFF10303E)
    val line = Color(0x28FFFFFF)
    val normal = Color(0xFF9AE5CA)
    val warning = Color(0xFFFFD498)
    val danger = Color(0xFFFFB6B4)
}

@Composable
fun DashboardTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(primary = DashboardColors.actionText, onPrimary = DashboardColors.accentInk,
            primaryContainer = Color(0xFF345562), onPrimaryContainer = DashboardColors.text,
            secondary = DashboardColors.actionText, onSecondary = DashboardColors.accentInk,
            secondaryContainer = Color(0xFF36515C), onSecondaryContainer = DashboardColors.text,
            surface = DashboardColors.sidebar, onSurface = DashboardColors.text,
            surfaceVariant = Color(0xFF515B5E), onSurfaceVariant = DashboardColors.secondary,
            surfaceContainer = Color(0xFF3B4345), surfaceContainerLow = Color(0xFF343B3D),
            surfaceContainerHigh = Color(0xFF424B4E), surfaceContainerHighest = Color(0xFF495457), surfaceContainerLowest = DashboardColors.backdrop,
            background = DashboardColors.backdrop, onBackground = DashboardColors.text,
            outline = Color(0xFF87989C), outlineVariant = DashboardColors.line,
            error = Color(0xFFFFF5F3), onError = DashboardColors.accentInk),
        typography = MaterialTheme.typography.copy(
            headlineLarge = MaterialTheme.typography.headlineLarge.copy(fontSize = 32.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-.8).sp),
            titleLarge = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Medium, letterSpacing = (-.4).sp),
            bodyMedium = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp),
        )) { CompositionLocalProvider(LocalContentColor provides DashboardColors.text, content = content) }
}

@Composable
fun GlassCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier, shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = DashboardColors.card, contentColor = DashboardColors.text),
        border = BorderStroke(1.dp, Brush.linearGradient(listOf(Color.White.copy(alpha = .28f), Color.White.copy(alpha = .07f)))),
        content = content)
}

@Composable
fun GlassPanel(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, enabled: Boolean = true,
    content: @Composable ColumnScope.() -> Unit) {
    val border = BorderStroke(1.dp, Brush.linearGradient(listOf(Color.White.copy(alpha = .28f), Color.White.copy(alpha = .07f))))
    val shape = RoundedCornerShape(24.dp)
    val inner: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
    if (onClick == null) Surface(modifier.fillMaxWidth(), shape = shape, color = DashboardColors.card,
        contentColor = DashboardColors.text, border = border, content = inner)
    else Surface(onClick, modifier.fillMaxWidth(), enabled = enabled, shape = shape, color = DashboardColors.card,
        contentColor = DashboardColors.text, border = border, content = inner)
}

/** The supplied wallpaper is bundled locally and is decorative, not a live CCTV image. */
@Composable
fun DashboardBackdrop(modifier: Modifier = Modifier) {
    Box(modifier.testTag("dashboard-backdrop")) {
        Image(painterResource(R.drawable.site_wallpaper), contentDescription = null,
            modifier = Modifier.matchParentSize(), contentScale = ContentScale.Crop, alignment = Alignment.CenterStart)
        Canvas(Modifier.matchParentSize()) {
            // Only the edges are shaded for system-bar legibility; the asset itself is unchanged.
            drawRect(Brush.verticalGradient(0f to Color.Black.copy(alpha = .32f), .15f to Color.Transparent,
                .82f to Color.Transparent, 1f to Color.Black.copy(alpha = .32f)))
        }
    }
}

@Composable
fun DashboardWorkspace(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(modifier.testTag("dashboard-workspace"), shape = RoundedCornerShape(32.dp),
        color = DashboardColors.workspace, contentColor = DashboardColors.text, shadowElevation = 18.dp,
        border = BorderStroke(1.dp, Brush.linearGradient(listOf(Color.White.copy(alpha = .34f), Color.White.copy(alpha = .10f)))),
        content = content)
}
