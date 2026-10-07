package com.vitalguard.field

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.data.ActionPlacementState
import com.vitalguard.field.data.ActionSide
import com.vitalguard.field.ui.settings.SettingsContent
import com.vitalguard.field.ui.theme.VgTheme

@PreviewTest @Preview(name = "Settings866", device = "spec:width=866dp,height=1385dp,dpi=340", locale = "ko", showBackground = true)
@Composable fun SettingsStage4Preview() { GlassPreviewSurface { SettingsContent(ActionPlacementState(ActionSide.left, loaded = true)) } }

@PreviewTest @Preview(name = "SettingsCompactLargeText", device = "spec:width=480dp,height=640dp,dpi=160", fontScale = 2f, locale = "ko", showBackground = true)
@Composable fun SettingsCompactStage4Preview() { GlassPreviewSurface { SettingsContent(ActionPlacementState(loaded = true, error = "실행 위치를 저장하지 못했습니다. 다시 선택해 주세요.")) } }
