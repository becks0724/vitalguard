package com.vitalguard.field

import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.data.profile.*
import com.vitalguard.field.ui.profile.MemberProfileDetails
import com.vitalguard.field.ui.outbox.OutboxInfoBubble

@PreviewTest @Preview(name = "MemberProfile", device = "spec:width=600dp,height=700dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun MemberProfilePreview() { GlassPreviewSurface { Box(Modifier.padding(24.dp)) {
    MemberProfileDetails(MemberProfileState(profile = MemberProfile("field-demo", "모의 관리자", "admin", "모의 시공사", "현장관리팀", "팀장", "DEMO-01", "010-****-**70", "demo@example.invalid")), null)
} } }
@PreviewTest @Preview(name = "OutboxInfoBubble", device = "spec:width=420dp,height=240dp,dpi=160", locale = "ko", showBackground = true)
@Composable fun OutboxInfoBubblePreview() { GlassPreviewSurface { Box(Modifier.padding(24.dp)) {
    OutboxInfoBubble("SITE-DEMO", "fixture-operation-12345678", Modifier.width(360.dp))
} } }
