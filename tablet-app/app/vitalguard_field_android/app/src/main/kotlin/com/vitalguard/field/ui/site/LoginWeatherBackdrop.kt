package com.vitalguard.field.ui.site

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.delay
import java.time.Duration

internal data class LoginWeatherSnapshot(val effects: WeatherEffects, val deadline: Long, val boot: Int) {
    fun visible(now: Long, currentBoot: Int): WeatherEffects =
        if (boot >= 0 && boot == currentBoot && now >= 0 && now < deadline && deadline - now <= 300_000) effects else WeatherEffects()
}

/** Store only display modes, never an account, location, measurement, or a manual preview. */
@Composable
fun rememberLoginWeatherEffects(state: SiteSummaryState, authenticated: Boolean, offline: Boolean): WeatherEffects {
    val context = LocalContext.current.applicationContext
    val prefs = remember(context) { context.getSharedPreferences("weather-backdrop-display", Context.MODE_PRIVATE) }
    val boot = remember(context) { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1) }
    fun read(): WeatherEffects {
        val mode = prefs.getString("precipitation", "unknown")?.takeIf { it in setOf("none", "rain", "snow", "mixed") } ?: "unknown"
        return LoginWeatherSnapshot(WeatherEffects(mode, prefs.getBoolean("wind", false)), prefs.getLong("deadline", 0), prefs.getInt("boot", -1))
            .visible(SystemClock.elapsedRealtime(), boot)
    }
    val weather = state.data?.weather
    LaunchedEffect(authenticated, weather?.fetchedAt, weather?.effects) {
        if (!authenticated || offline || boot < 0 || weather == null || !weather.ok || state.failed || state.forbidden || weather.stale != false || weather.persisted == true) return@LaunchedEffect
        val at = parseInstantOrNull(weather.fetchedAt) ?: return@LaunchedEffect
        val remaining = 300_000 - Duration.between(at, state.now).toMillis()
        if (remaining !in 1..300_000) return@LaunchedEffect
        prefs.edit().putString("precipitation", weather.effects.precipitation).putBoolean("wind", weather.effects.windDanger)
            .putLong("deadline", SystemClock.elapsedRealtime() + remaining).putInt("boot", boot).apply()
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val value by produceState(WeatherEffects(), authenticated, lifecycle) {
        value = if (authenticated) WeatherEffects() else read()
        if (!authenticated) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { value = read(); delay(1000) }
        }
    }
    return value
}
