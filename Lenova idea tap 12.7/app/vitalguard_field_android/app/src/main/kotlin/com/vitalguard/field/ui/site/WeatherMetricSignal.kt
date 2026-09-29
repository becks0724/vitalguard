package com.vitalguard.field.ui.site

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.vitalguard.field.data.models.parseInstantOrNull
import com.vitalguard.field.ui.theme.DashboardColors
import com.vitalguard.field.ui.theme.SignalColors
import java.time.Duration

fun weatherMetricSignal(state: SiteSummaryState, metricId: String, value: Double?): String? {
    val weather = state.data?.weather ?: return null
    val at = parseInstantOrNull(weather.fetchedAt) ?: return null
    if (!weather.ok || state.failed || state.forbidden || state.stale || weather.stale != false ||
        weather.persisted == true || Duration.between(at, state.now).seconds !in 0..299 || value?.isFinite() != true) return null
    return weather.metricLevels[metricId]
}

/** Same layered strokes as the dashboard's static neon border. Normal stays an uncoloured line. */
@Composable
fun WeatherMetricDivider(level: String?, modifier: Modifier = Modifier) {
    val glow = when (level) { "warn" -> SignalColors.caution; "danger" -> SignalColors.danger; else -> null }
    Box(modifier.fillMaxWidth().height(1.dp).semantics {
        stateDescription = when (level) { "warn" -> "주의"; "danger" -> "위험"; "normal" -> "정상"; else -> "판정 없음" }
    }) {
        HorizontalDivider(color = DashboardColors.line)
        if (glow != null) Canvas(Modifier.matchParentSize()) {
            // The card clips only its outer rounded shape; glow extends above and below this 1dp line.
            for ((width, alpha) in listOf(18f to .08f, 11f to .16f, 6f to .30f, 2.5f to .98f)) {
                drawLine(glow.copy(alpha = alpha), Offset(0f, size.height / 2), Offset(size.width, size.height / 2), width.dp.toPx(), StrokeCap.Butt)
            }
        }
    }
}


fun indoorEnvironmentFresh(state: SiteSummaryState): Boolean {
    val snapshot = state.data ?: return false
    val gas = snapshot.gas
    val environment = gas.environment ?: return false
    val received = state.receivedAt ?: return false // cached snapshots do not restart a sensor's expiry
    val checked = parseInstantOrNull(environment.checkedAt) ?: return false
    val snapshotAt = parseInstantOrNull(snapshot.fetchedAt) ?: return false
    val validity = environment.validForMs ?: return false
    val waitingForOtherSections = Duration.between(checked, snapshotAt).toMillis().coerceAtLeast(0)
    val elapsed = Duration.between(received, state.now).toMillis().coerceAtLeast(0)
    return gas.ok && !state.failed && !state.forbidden && validity > waitingForOtherSections + elapsed
}
