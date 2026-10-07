package com.vitalguard.field.ui.site

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.vitalguard.field.R
import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.theme.*
import java.time.ZoneId

internal fun forecastIcon(code: Int?): Int = when (code) {
    0 -> R.drawable.ic_sun
    1, 2 -> R.drawable.ic_cloud_sun
    3 -> R.drawable.ic_cloud
    45, 48 -> R.drawable.ic_fog
    95, 96, 99 -> R.drawable.ic_thunder
    51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82 -> R.drawable.ic_rain
    71, 73, 75, 77, 85, 86 -> R.drawable.ic_snow
    else -> R.drawable.ic_weather_unknown
}

@Composable
internal fun WeatherForecastCard(weather: SiteStatusWeather, serverTime: String?, modifier: Modifier = Modifier) {
    val start = parseInstantOrNull(serverTime)?.atZone(ZoneId.of("Asia/Seoul"))?.toLocalDate()
    GlassCard(modifier.fillMaxWidth().testTag("weather-forecast")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("일주일 예보", style = MaterialTheme.typography.titleMedium)
            if (start == null) Text("미수신") else BoxWithConstraints(Modifier.fillMaxWidth()) {
                val width = maxOf(68.dp * LocalDensity.current.fontScale, (maxWidth - 6.dp * 6) / 7)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).testTag("weather-forecast-days"),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    repeat(7) { index ->
                        val date = start.plusDays(index.toLong())
                        val day = weather.forecast.firstOrNull { it.date == date }
                        Column(Modifier.width(width).testTag("weather-forecast-$date"), horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(when (index) { 0 -> "오늘"; 1 -> "내일"; else -> listOf("월", "화", "수", "목", "금", "토", "일")[date.dayOfWeek.value - 1] }, style = MaterialTheme.typography.labelMedium)
                            Text("${date.monthValue}/${date.dayOfMonth}", style = MaterialTheme.typography.labelSmall)
                            VgIcon(forecastIcon(day?.weatherCode), modifier = Modifier.size(30.dp))
                            Text(day?.label ?: if (day?.weatherCode != null) "" else "미수신", Modifier.heightIn(min = 36.dp), style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center)
                            Text(day?.highC?.let { metricValue(it, "°", 0) } ?: "—", color = DashboardColors.danger, style = MaterialTheme.typography.titleMedium)
                            Text(day?.lowC?.let { metricValue(it, "°", 0) } ?: "—", color = DashboardColors.accent, style = MaterialTheme.typography.bodyMedium)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                                VgIcon(R.drawable.ic_humidity, modifier = Modifier.size(14.dp), tint = DashboardColors.accent)
                                Text(day?.precipitationProbabilityPct?.let { metricValue(it, "%", 0) } ?: "—", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
        }
    }
}
