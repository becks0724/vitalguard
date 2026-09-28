package com.vitalguard.field

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vitalguard.field.ui.theme.*

@Composable
fun GlassPreviewSurface(content: @Composable () -> Unit) {
    VgTheme { DashboardTheme { DashboardBackdrop(Modifier.fillMaxSize()) {
        DashboardWorkspace(Modifier.fillMaxSize().padding(12.dp)) { content() }
    } } }
}
