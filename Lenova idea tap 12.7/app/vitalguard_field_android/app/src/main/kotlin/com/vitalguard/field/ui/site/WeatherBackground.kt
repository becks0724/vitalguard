package com.vitalguard.field.ui.site

import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.vitalguard.field.data.models.*
import java.time.Duration
import kotlin.math.sin

val LocalWeatherEffects = staticCompositionLocalOf { WeatherEffects() }

fun weatherBackgroundEffects(state: SiteSummaryState, visible: Boolean, offline: Boolean): WeatherEffects {
    val w = state.data?.weather ?: return WeatherEffects()
    val fetched = parseInstantOrNull(w.fetchedAt) ?: return WeatherEffects()
    val age = Duration.between(fetched, state.now).seconds
    if (!visible || offline || state.forbidden || state.failed || state.stale || !w.ok ||
        w.stale != false || w.persisted == true || age !in 0..299) return WeatherEffects()
    return w.effects
}

/** One background-only canvas; no bitmap blur, particle widgets or idle animation. */
@Composable
fun WeatherBackground(modifier: Modifier = Modifier, effects: WeatherEffects = LocalWeatherEffects.current) {
    if (!effects.active) return
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    val motionEnabled = remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    }
    if (!motionEnabled) return
    val seconds = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(lifecycle, effects) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var start = 0L
            var last = 0L
            while (true) withFrameNanos { frame ->
                if (start == 0L) start = frame
                if (frame - last >= 33_000_000L) {
                    seconds.floatValue = ((frame - start) / 1_000_000_000.0 % 120).toFloat()
                    last = frame
                }
            }
        }
    }
    Canvas(modifier.testTag("weather-background-effects")) {
        val t = seconds.floatValue
        if (effects.rain) repeat(36) { i ->
            val x = ((i * .618034f + t * if (effects.windDanger) .11f else .025f) % 1f) * size.width
            val y = ((i * .381966f + t * (.48f + i % 3 * .07f)) % 1f) * (size.height + 35) - 35
            drawLine(Color(0xFFDBF1FA).copy(alpha = .22f + i % 3 * .06f), Offset(x, y),
                Offset(x - (if (effects.windDanger) 20 else 5).dp.toPx(), y + 23.dp.toPx()), 1.3.dp.toPx(), StrokeCap.Round)
        }
        if (effects.snow) repeat(28) { i ->
            val x = ((i * .618034f + t * (if (effects.windDanger) .08f else .009f)) % 1f) * size.width + sin(t + i) * 12.dp.toPx()
            val y = ((i * .381966f + t * (.065f + i % 4 * .008f)) % 1f) * size.height
            drawCircle(Color.White.copy(alpha = .30f + i % 3 * .10f), (1.5f + i % 3 * .7f).dp.toPx(), Offset(x, y))
        }
        if (effects.windDanger) repeat(8) { i ->
            val p = (t * .22f + i * .137f) % 1f
            val x = p * (size.width + 240.dp.toPx()) - 240.dp.toPx()
            val y = size.height * (.08f + i * .116f)
            val length = (110 + i % 3 * 30).dp.toPx()
            val path = Path().apply {
                moveTo(x, y); cubicTo(x + length * .35f, y - 12.dp.toPx(), x + length * .75f, y + 13.dp.toPx(), x + length, y)
            }
            drawPath(path, Color.White.copy(alpha = sin(p * Math.PI).toFloat() * .26f), style = Stroke(1.5.dp.toPx(), cap = StrokeCap.Round))
        }
    }
}
