package com.vitalguard.field.ui.site

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.vitalguard.field.ui.theme.*

@Composable
fun SiteScreen(state: SiteSummaryState, onRefresh: () -> Unit = {}, onNextStage: () -> Unit = {},
    onOpenDetail: (String) -> Unit = { onNextStage() }, onOpenCctv: () -> Unit = onNextStage,
    onOpenAlerts: () -> Unit = onNextStage) {
    GlassDashboard(state, onRefresh, onOpenDetail, onOpenCctv, onOpenAlerts)
}

@Composable
fun SignalMark(level: String?) {
    val (symbol, label, color) = when (level) {
        "normal" -> Triple("✓", "정상", VgColors.ok)
        "warn" -> Triple("!", "주의", VgColors.warn)
        "danger" -> Triple("!!", "위험", VgColors.danger)
        "idle" -> Triple("—", "데이터 없음 또는 전원 대기", VgColors.surfaceStrong)
        else -> Triple("?", "상태 확인 불가", VgColors.surfaceStrong)
    }
    val shape = if (level == "danger") CircleShape else RoundedCornerShape(6.dp)
    // 글자를 확대해도 위험 표식이 타원/캡슐로 변하지 않도록 정사각형을 유지한다.
    val side = (24f * LocalDensity.current.fontScale + 8f).coerceAtLeast(32f).dp
    Box(Modifier.size(side)
        .clip(shape).background(color).border(1.dp, VgColors.ink, shape)
        .clearAndSetSemantics { contentDescription = label }.padding(4.dp), contentAlignment = Alignment.Center) {
        Text(symbol, color = VgColors.ink, fontWeight = FontWeight.Bold)
    }
}
