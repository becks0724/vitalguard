package com.vitalguard.field.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.CompositionLocalProvider

/** Opaque navigation, translucent content. Fixed neutral backdrop bounds keep text legible. */
object DashboardColors {
    val backdrop = Color(0xFF303638)
    val backdropLight = Color(0xFF41484A)
    val sidebar = Color(0xFF303537)
    val card = Color(0x24FFFFFF)
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

/** Drawn once per size; no backdrop blur, bitmap fetch, timer or decorative network request. */
@Composable
fun DashboardBackdrop(modifier: Modifier = Modifier) {
    Canvas(modifier.testTag("dashboard-backdrop")) {
        drawRect(Brush.linearGradient(listOf(DashboardColors.backdropLight, DashboardColors.backdrop),
            start = Offset.Zero, end = Offset(size.width * .8f, size.height)))
        drawRect(Brush.radialGradient(listOf(Color.White.copy(alpha = .04f), Color.Transparent),
            center = Offset(size.width * .48f, size.height * .2f), radius = size.maxDimension * .58f))
        // Architectural panes sit behind the glass without looking like live site imagery.
        val edge = Color.White.copy(alpha = .022f)
        val x = size.width * .76f
        drawLine(edge, Offset(x, 0f), Offset(x - size.width * .17f, size.height), 1.dp.toPx())
        drawLine(edge, Offset(size.width * .07f, 0f), Offset(size.width * .07f, size.height), 1.dp.toPx())
        drawOval(edge, topLeft = Offset(size.width * .34f, -size.height * .52f),
            size = Size(size.width * .95f, size.height * 1.7f), style = Stroke(1.dp.toPx()))
        val grain = Color.White.copy(alpha = .024f)
        // Deterministic sparse grain; no random recomposition shimmer.
        val gap = 13.dp.toPx()
        var y = 0f; var row = 0
        while (y < size.height) {
            var xx = if (row % 2 == 0) 0f else gap / 2
            while (xx < size.width) { drawCircle(grain, .45.dp.toPx(), Offset(xx, y)); xx += gap }
            y += gap; row++
        }
    }
}
