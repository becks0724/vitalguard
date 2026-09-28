package com.vitalguard.field.ui.site

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vitalguard.field.R
import com.vitalguard.field.data.models.parseInstantOrNull
import com.vitalguard.field.data.models.GasReading
import com.vitalguard.field.data.models.gasMeasurement
import com.vitalguard.field.ui.theme.*
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

fun compactGasValue(reading: GasReading?, waiting: Boolean): String = when {
    waiting || reading?.value == null -> "미수신"
    reading.unit == null -> "단위 미수신"
    else -> gasMeasurement(reading, false)
}

@Composable
fun GasCloudSymbol(key: String, modifier: Modifier = Modifier) {
    val (symbol, name) = when (key) { "o2" -> "O₂" to "산소"; "co" -> "CO" to "일산화탄소"; else -> "H₂S" to "황화수소" }
    val scale = LocalDensity.current.fontScale.coerceAtLeast(1f)
    Box(modifier.size((72 * scale).dp, (50 * scale).dp).clearAndSetSemantics { contentDescription = "$symbol $name" },
        contentAlignment = Alignment.Center) {
        VgIcon(R.drawable.ic_gas_cloud, modifier = Modifier.fillMaxSize(), tint = DashboardColors.secondary.copy(alpha = .65f))
        Text(symbol, Modifier.padding(top = (7 * scale).dp), fontSize = 16.sp, color = DashboardColors.text)
    }
}

@Composable
fun GasReceipt(raw: String?, modifier: Modifier = Modifier) {
    val stamp = parseInstantOrNull(raw)?.let {
        DateTimeFormatter.ofPattern("uuuu.MM.dd HH:mm").format(it.atOffset(ZoneOffset.ofHours(9)))
    } ?: "—"
    Row(modifier.testTag("gas-last-receipt").clearAndSetSemantics {
        contentDescription = if (stamp == "—") "가스 수신 시각 미확인" else "가스 마지막 수신 $stamp KST"
    },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        VgIcon(R.drawable.ic_receipt_clock, modifier = Modifier.size(16.dp), tint = DashboardColors.secondary)
        Text(stamp, style = MaterialTheme.typography.bodySmall, color = DashboardColors.secondary)
    }
}
