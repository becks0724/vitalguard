// 상세 페이지 공통 부품 — 제목·큰 값·보조줄·차트를 한 틀로 묶는다(페이지마다 다시 짜지 않게)
package com.vitalguard.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text

/** 상세 한 줄 — 라벨/값 쌍. 값이 없으면 호출부가 아예 안 넣는다(0 으로 채우지 않는 규칙). */
data class DetailRow(val label: String, val value: String, val tint: Color = VgColors.Primary)

/**
 * 상세 페이지 틀.
 *
 * ⚠ **차트는 화면이 들고 있는 표본만** 그린다(5분 창). 더 긴 이력은 서버 조회가 필요하고,
 * LTE 를 더 쓰면 08-25 에 줄인 발열이 되돌아온다([[R-25]]).
 */
@Composable
fun DetailPage(
    title: String,
    value: String,
    unit: String,
    tint: Color,
    rows: List<DetailRow>,
    chart: (@Composable () -> Unit)? = null,
) {
    val w = LocalConfiguration.current.screenWidthDp
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(VgColors.Background)
            .padding(horizontal = (w * 0.14f).dp, vertical = (w * 0.10f).dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, color = tint, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                value,
                color = VgColors.Primary,
                // 차트가 주인공이라 숫자를 낮춘다 — 40sp 면 차트+보조줄이 둥근 화면에서 잘린다.
                fontSize = 34.sp,
                fontWeight = FontWeight.Bold,
            )
            if (unit.isNotEmpty()) {
                Text(
                    " $unit",
                    color = VgColors.Secondary,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
            }
        }
        chart?.let {
            Column(Modifier.fillMaxWidth().padding(top = 4.dp)) { it() }
        }
        rows.forEach { r ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 3.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(r.label, color = VgColors.Secondary, fontSize = 11.sp)
                Text(r.value, color = r.tint, fontSize = 11.sp, fontWeight = FontWeight.Medium)
            }
        }
        if (rows.isEmpty() && chart == null) {
            Text(
                "측정 대기",
                color = VgColors.Idle,
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}
