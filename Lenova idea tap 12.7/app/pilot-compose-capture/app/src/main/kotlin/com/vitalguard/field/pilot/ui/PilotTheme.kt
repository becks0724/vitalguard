package com.vitalguard.field.pilot.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

@Composable
fun PilotTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Color(0xFF245E4D),
            onPrimary = Color.White,
            primaryContainer = Color(0xFFD0EBDE),
            secondaryContainer = Color(0xFFE1EBE5),
            background = Color(0xFFF7F9F7),
            surface = Color(0xFFF7F9F7),
        ),
        content = content,
    )
}
