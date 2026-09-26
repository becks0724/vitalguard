package com.vitalguard.field.ui.shell

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max

enum class VgBackdrop { dark, light }
data class BackdropPalette(val gradient: List<Color>, val line: Color, val gridOpacity: Float, val contourOpacity: Float)
fun backdropPalette(backdrop: VgBackdrop) = if (backdrop == VgBackdrop.dark)
    BackdropPalette(listOf(Color(0xFF171D24), Color(0xFF202C35), Color(0xFF26323B)), Color(0xFF6F8794), .05f, .06f)
else BackdropPalette(listOf(Color(0xFFE4E9E9), Color(0xFFE7EBEA), Color(0xFFEFF0ED)), Color(0xFF94A5AB), .025f, .03f)

// Port: vg_background.dart. 앱은 light만 사용한다. 중앙 70%에는 격자를 그리지 않는다.
@Composable
fun VgBackground(modifier: Modifier = Modifier, backdrop: VgBackdrop = VgBackdrop.light) {
    val palette = backdropPalette(backdrop)
    Canvas(modifier.testTag("vg-background")) {
        if (size.width <= 0 || size.height <= 0) return@Canvas
        drawRect(Brush.linearGradient(0f to palette.gradient[0], .54f to palette.gradient[1], 1f to palette.gradient[2],
            start = Offset.Zero, end = Offset(size.width, size.height)))
        fun edgeStrength(p: Offset): Float {
            val distance = max(abs(p.x / size.width - .5f), abs(p.y / size.height - .5f))
            val t = ((distance - .35f) / .15f).coerceIn(0f, 1f)
            return t * t * (3 - 2 * t)
        }
        fun fadedLine(start: Offset, end: Offset) {
            val delta = end - start
            val segments = max(1, ceil(delta.getDistance() / (30 * density)).toInt())
            for (i in 0 until segments) {
                val a = start + delta * (i.toFloat() / segments)
                val b = start + delta * ((i + 1f) / segments)
                val strength = edgeStrength((a + b) / 2f)
                if (strength > 0) drawLine(palette.line.copy(alpha = palette.gridOpacity * strength), a, b, density)
            }
        }
        val spacing = (size.minDimension / 9f).coerceIn(64 * density, 120 * density)
        val rise = size.height * .58f
        var y = 0f
        while (y <= size.height) { fadedLine(Offset(0f, y), Offset(size.width, y)); y += spacing * .5f }
        var x = -size.height
        while (x <= size.width + size.height) {
            fadedLine(Offset(x, 0f), Offset(x + rise, size.height))
            fadedLine(Offset(x, 0f), Offset(x - rise, size.height))
            x += spacing
        }
        val curves = listOf(
            floatArrayOf(-.04f,.10f,.22f,.035f,.68f,.15f,1.04f,.07f),
            floatArrayOf(-.04f,.91f,.30f,.84f,.72f,.98f,1.04f,.87f),
            floatArrayOf(.08f,-.04f,.02f,.28f,.15f,.70f,.06f,1.04f),
            floatArrayOf(.93f,-.04f,1.01f,.30f,.86f,.72f,.96f,1.04f),
        )
        curves.forEach { p ->
            val path = Path().apply {
                moveTo(p[0]*size.width, p[1]*size.height)
                cubicTo(p[2]*size.width,p[3]*size.height,p[4]*size.width,p[5]*size.height,p[6]*size.width,p[7]*size.height)
            }
            drawPath(path, palette.line.copy(alpha = palette.contourOpacity), style = Stroke(1.4f*density, cap = StrokeCap.Round))
        }
    }
}
