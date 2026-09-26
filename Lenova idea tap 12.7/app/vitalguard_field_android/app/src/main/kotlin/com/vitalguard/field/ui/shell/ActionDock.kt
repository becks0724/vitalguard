package com.vitalguard.field.ui.shell

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vitalguard.field.data.*

val LocalActionPlacement = compositionLocalOf { ActionPlacementState(loaded = true) }

// Port: action_dock.dart. Insets는 소비된 부모 값을 제외하고 런타임 값만 추가한다.
@Composable
fun ActionDock(modifier: Modifier = Modifier, maxWidth: Dp = 480.dp, content: @Composable () -> Unit) {
    val placement = LocalActionPlacement.current
    val requestedMaxWidth = maxWidth
    BoxWithConstraints(modifier.fillMaxWidth().windowInsetsPadding(
        WindowInsets.safeDrawing.union(WindowInsets.systemGestures).only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom))
        .padding(horizontal = 20.dp, vertical = 16.dp)) {
        val dockWidth = minOf(requestedMaxWidth, this.maxWidth * .9f)
        val dockHeight = maxHeight * .5f
        if (placement.loaded) Box(Modifier.align(if (placement.side == ActionSide.left) AbsoluteAlignment.BottomLeft else AbsoluteAlignment.BottomRight)
            .width(dockWidth).heightIn(max = dockHeight).verticalScroll(rememberScrollState())) { content() }
    }
}
