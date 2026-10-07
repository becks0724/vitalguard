package com.vitalguard.field

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.ui.help.UsageGuideScreen

@PreviewTest @Preview(name = "UsageGuideLandscape", device = "spec:width=1385dp,height=866dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun UsageGuideLandscapePreview() { GlassPreviewSurface { UsageGuideScreen("transfer") } }
@PreviewTest @Preview(name = "UsageGuideCompact", device = "spec:width=480dp,height=640dp,dpi=160", fontScale = 2f, locale = "ko", showBackground = true)
@Composable fun UsageGuideCompactPreview() { GlassPreviewSurface { UsageGuideScreen() } }
