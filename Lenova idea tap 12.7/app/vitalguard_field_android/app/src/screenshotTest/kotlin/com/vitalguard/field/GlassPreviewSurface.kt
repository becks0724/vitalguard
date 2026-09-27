package com.vitalguard.field

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.vitalguard.field.ui.theme.*

@Composable
fun GlassPreviewSurface(content: @Composable () -> Unit) {
    VgTheme { DashboardTheme { Box(Modifier.fillMaxSize()) { DashboardBackdrop(Modifier.matchParentSize()); content() } } }
}
