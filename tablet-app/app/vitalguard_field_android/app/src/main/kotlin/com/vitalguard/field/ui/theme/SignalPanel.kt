package com.vitalguard.field.ui.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

object SignalColors {
    val normal = Color(0xFF55E5A0)
    val caution = Color(0xFFFFD34E)
    val danger = Color(0xFFFF5B64)
    val waiting = Color(0xFF62CEFA)
}
enum class PanelSignal(val label: String, val color: Color?) {
    normal("정상", SignalColors.normal), caution("주의", SignalColors.caution), danger("위험", SignalColors.danger),
    unknown("상태 미확인", null), locked("접근 권한 없음", null), pending("연동 대기", null)
}

fun signalForLevel(level: String?, allowNormal: Boolean = true): PanelSignal = when (level) {
    "danger" -> PanelSignal.danger
    "warn" -> PanelSignal.caution
    "normal" -> if (allowNormal) PanelSignal.normal else PanelSignal.unknown
    else -> PanelSignal.unknown
}

/** Static neon cap: complete top edge + upper half of both sides. No blur/filter/animation. */
@Composable
fun SignalPanel(modifier: Modifier = Modifier, signal: PanelSignal = PanelSignal.unknown,
    onClick: (() -> Unit)? = null, enabled: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxWidth()) {
        Canvas(Modifier.matchParentSize().clearAndSetSemantics {}.drawWithCache {
            val inset = 1.dp.toPx()
            val radius = 24.dp.toPx().coerceAtMost(size.width / 2f).coerceAtMost(size.height / 2f)
            val path = Path().apply {
                moveTo(inset, size.height * .5f)
                lineTo(inset, inset + radius)
                arcTo(Rect(inset, inset, inset + radius * 2, inset + radius * 2), 180f, 90f, false)
                lineTo(size.width - inset - radius, inset)
                arcTo(Rect(size.width - inset - radius * 2, inset, size.width - inset, inset + radius * 2), 270f, 90f, false)
                lineTo(size.width - inset, size.height * .5f)
            }
            onDrawBehind {
                signal.color?.let { color ->
                    for ((width, alpha) in listOf(18f to .08f, 11f to .16f, 6f to .30f, 2.5f to .98f)) {
                        drawPath(path, color.copy(alpha = alpha), style = Stroke(width.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                }
            }
        }) { }
        GlassPanel(modifier.semantics { stateDescription = signal.label }, onClick, enabled, content)
    }
}
