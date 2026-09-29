package com.vitalguard.field.ui.outbox

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.vitalguard.field.R
import com.vitalguard.field.data.OutboxEntry
import com.vitalguard.field.ui.theme.*
import kotlin.math.roundToInt

@Composable
fun OutboxInfoButton(item: OutboxEntry) {
    var open by remember(item.id) { mutableStateOf(false) }
    var anchorLeft by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val margin = with(density) { 8.dp.roundToPx() }
    val inset = with(density) { (56.dp * (1f - actionIconVisualScale) / 2).roundToPx() }
    val provider = remember(margin, inset) { object : PopupPositionProvider {
        override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
            return IntOffset((anchorBounds.left + inset - popupContentSize.width).coerceAtLeast(margin),
                (anchorBounds.center.y - popupContentSize.height / 2).coerceIn(margin, (windowSize.height - popupContentSize.height - margin).coerceAtLeast(margin)))
        }
    } }
    Box(Modifier.size(56.dp).onGloballyPositioned { anchorLeft = it.boundsInWindow().left.roundToInt() }
        .testTag("outbox-info-anchor-${item.id}")) {
        ActionIconButton(R.drawable.ic_info, if (open) "기록 정보 닫기" else "기록 정보", { open = !open },
            Modifier.testTag("outbox-details-${item.id}"), size = 56.dp)
        if (open) {
            val width = with(density) { (anchorLeft + inset - margin).coerceAtLeast(1).toDp() }.coerceAtMost(360.dp)
            Popup(popupPositionProvider = provider, onDismissRequest = { open = false },
                properties = PopupProperties(focusable = true, dismissOnBackPress = true, dismissOnClickOutside = true)) {
                OutboxInfoBubble(item.siteId, item.id, Modifier.width(width)
                    .heightIn(max = (LocalConfiguration.current.screenHeightDp - 32).coerceAtLeast(100).dp)
                    .testTag("outbox-info-bubble-${item.id}"), onTap = { open = false })
            }
        }
    }
}

@Composable
fun OutboxInfoBubble(siteId: String?, operationId: String, modifier: Modifier = Modifier, onTap: (() -> Unit)? = null) {
    val background = DashboardColors.sidebar
    Row(if (onTap != null) modifier.clickable(onClick = onTap) else modifier, verticalAlignment = Alignment.CenterVertically) {
        Surface(Modifier.weight(1f), color = background, shape = RoundedCornerShape(8.dp),
            border = BorderStroke(1.dp, DashboardColors.line), shadowElevation = 6.dp) {
            SelectionContainer {
                Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("현장 ID ${siteId ?: "미제공"}", color = DashboardColors.text)
                    Text("작업 ID $operationId", color = DashboardColors.text)
                }
            }
        }
        Canvas(Modifier.size(8.dp, 16.dp)) {
            drawPath(Path().apply { moveTo(0f, 0f); lineTo(size.width, size.height / 2); lineTo(0f, size.height); close() }, background)
        }
    }
}
