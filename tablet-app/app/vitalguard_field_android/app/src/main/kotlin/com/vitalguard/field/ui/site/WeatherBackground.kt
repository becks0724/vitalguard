package com.vitalguard.field.ui.site

import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.vitalguard.field.data.models.*
import java.time.Duration
import kotlin.math.sin
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.roundToInt
import kotlin.random.Random

enum class WeatherPreviewMode(val label: String, val icon: Int, val effects: WeatherEffects) {
    rain("비", com.vitalguard.field.R.drawable.ic_rain, WeatherEffects("rain")),
    snow("눈", com.vitalguard.field.R.drawable.ic_snow, WeatherEffects("snow")),
    wind("강풍", com.vitalguard.field.R.drawable.ic_wind, WeatherEffects(windDanger = true)),
}
data class WeatherPreviewControl(val mode: WeatherPreviewMode? = null, val select: (WeatherPreviewMode?) -> Unit = {})
val LocalWeatherPreview = staticCompositionLocalOf { WeatherPreviewControl() }

val LocalWeatherEffects = staticCompositionLocalOf { WeatherEffects() }

fun weatherBackgroundEffects(state: SiteSummaryState, visible: Boolean, offline: Boolean): WeatherEffects {
    val w = state.data?.weather ?: return WeatherEffects()
    val fetched = parseInstantOrNull(w.fetchedAt) ?: return WeatherEffects()
    val age = Duration.between(fetched, state.now).seconds
    if (!visible || offline || state.forbidden || state.failed || state.stale || !w.ok ||
        w.stale != false || w.persisted == true || age !in 0..299) return WeatherEffects()
    return w.effects
}

private data class WeatherParticle(val x: Float, val y: Float, val depth: Float, val speed: Float, val phase: Float)
private fun wrap(value: Float, length: Float): Float = ((value % length) + length) % length

/** Full wallpaper layer, below the enclosing frosted panel. No particles are drawn over cards. */
@Composable
fun WeatherBackground(modifier: Modifier = Modifier, effects: WeatherEffects = LocalWeatherEffects.current) {
    if (!effects.active) return
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    val motionEnabled = remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    }
    if (!motionEnabled) return
    val particles = remember {
        val random = Random(9031)
        List(320) { WeatherParticle(random.nextFloat(), random.nextFloat(), random.nextFloat(), random.nextFloat(), random.nextFloat() * 6.283f) }
    }
    val mist = rememberWindAtmosphere(effects.windDanger)
    val seconds = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(lifecycle, effects) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var start = 0L
            var last = 0L
            while (true) withFrameNanos { frame ->
                if (start == 0L) start = frame
                if (frame - last >= 33_000_000L) {
                    seconds.floatValue = ((frame - start) / 1_000_000_000.0 % 3600).toFloat()
                    last = frame
                }
            }
        }
    }
    Canvas(modifier.testTag("weather-background-effects").drawWithCache {
        // Cached edge shading belongs to the photograph; UI panels are rendered afterwards.
        val shade = if (effects.windDanger) .72f else if (effects.rain) .65f else .58f
        val horizontal = Brush.horizontalGradient(0f to Color.Black.copy(alpha = shade),
            .09f to Color.Black.copy(alpha = shade * .48f), .28f to Color.Transparent,
            .72f to Color.Transparent, .91f to Color.Black.copy(alpha = shade * .48f), 1f to Color.Black.copy(alpha = shade))
        val vertical = Brush.verticalGradient(0f to Color.Black.copy(alpha = shade),
            .11f to Color.Black.copy(alpha = shade * .34f), .30f to Color.Transparent,
            .72f to Color.Transparent, .91f to Color.Black.copy(alpha = shade * .45f), 1f to Color.Black.copy(alpha = shade))
        onDrawBehind { drawRect(horizontal); drawRect(vertical) }
    }) {
        val t = seconds.floatValue
        val gust = .5f + .5f * sin(t * .67f + .55f * sin(t * .19f))
        val travelWidth = size.width + 180.dp.toPx()
        val travelHeight = size.height + 100.dp.toPx()
        if (effects.rain) particles.forEach { p ->
            val x = wrap(p.x * travelWidth + t * (12f + p.speed * 20f) * density + sin(t * .43f + p.phase) * 16.dp.toPx(), travelWidth) - 90.dp.toPx()
            val y = wrap(p.y * travelHeight + t * (250f + p.depth * 570f + p.speed * 140f) * density, travelHeight) - 60.dp.toPx()
            val length = (7f + p.depth * 23f).dp.toPx()
            val slant = .14f + p.speed * .10f + if (effects.windDanger) gust * .75f else gust * .06f
            val end = Offset(x - length * slant, y + length)
            val opacity = .16f + p.depth * .57f
            val thickness = (.45f + p.depth * .95f).dp.toPx()
            drawLine(Color(0xFFDDEDF8).copy(alpha = opacity * .38f), Offset(x, y), end, thickness, StrokeCap.Round)
            drawLine(Color(0xFFE9F5FF).copy(alpha = opacity), Offset(x - length * slant * .64f, y + length * .64f), end, thickness, StrokeCap.Round)
        }
        if (effects.snow) repeat(168) { i ->
            val p = particles[i]
            val drift = sin(t * (.28f + p.speed * .38f) + p.phase) * (18f + p.depth * 45f).dp.toPx()
            val x = wrap(p.x * travelWidth + t * (5f + p.speed * 15f + if (effects.windDanger) 65f else 0f) * density + drift, travelWidth) - 90.dp.toPx()
            val y = wrap(p.y * travelHeight + t * (17f + p.depth * 47f + p.speed * 14f) * density, travelHeight) - 50.dp.toPx()
            val radius = (.8f + p.depth * p.depth * 5.2f).dp.toPx()
            val opacity = .28f + p.depth * .55f
            drawCircle(Color.White.copy(alpha = opacity * .12f), radius * 1.8f, Offset(x, y))
            drawCircle(Color.White.copy(alpha = opacity * .25f), radius * 1.28f, Offset(x, y))
            drawCircle(Color.White.copy(alpha = opacity), radius * .80f, Offset(x, y))
        }
        if (effects.windDanger) {
            // Broad translucent dust masses sweep over the photograph. No isolated curly strokes.
            mist?.let { texture ->
                repeat(4) { layer ->
                    val width = size.width * (1.25f + layer * .08f)
                    val height = size.height * (.62f + layer % 2 * .17f)
                    val cycle = size.width + width
                    val x = wrap(t * (85f + layer * 31f) * density + layer * cycle * .247f + sin(t * .37f) * 100.dp.toPx(), cycle) - width
                    val y = size.height * (layer * .24f - .18f) + sin(t * .21f + layer) * 25.dp.toPx()
                    drawImage(texture, dstOffset = IntOffset(x.roundToInt(), y.roundToInt()),
                        dstSize = IntSize(width.roundToInt(), height.roundToInt()), alpha = .34f + gust * .55f, filterQuality = FilterQuality.Low)
                }
            }
            repeat(144) { i ->
                val p = particles[i]
                val x = wrap(p.x * travelWidth + t * (165f + p.speed * 370f) * density + sin(t * .48f + p.phase) * 35.dp.toPx(), travelWidth) - 90.dp.toPx()
                val y = wrap(p.y * size.height - t * (4f + p.speed * 13f) * density + sin(t * (.7f + p.speed) + p.phase) * 16.dp.toPx(), size.height)
                val length = (2f + p.depth * p.depth * 15f).dp.toPx()
                val opacity = (.16f + p.depth * .38f) * (.5f + gust * .5f)
                drawLine(Color(0xFFE9E3D8).copy(alpha = opacity), Offset(x, y), Offset(x + length, y - length * .10f),
                    (.6f + p.depth * .8f).dp.toPx(), StrokeCap.Round)
            }
        }
    }
}
