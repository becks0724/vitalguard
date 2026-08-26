// 설정 페이지 — 세로 스와이프 맨 아래. 로그인/로그아웃이 여기 산다(08-26 사용자 지시)
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Text
import kotlin.math.cos
import kotlin.math.sin

/** 톱니 개수 — 8개면 40dp 에서도 톱니가 뭉치지 않고 "설정" 으로 읽힌다. */
internal const val GEAR_TEETH = 8

/**
 * 톱니바퀴. 아이콘 라이브러리를 새로 들이지 않으려고 직접 그린다
 * (compose material-icons 는 이 모듈에 없다 — 아이콘 하나 때문에 의존을 늘리지 않는다).
 */
@Composable
fun GearIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val c = Offset(size.width / 2f, size.height / 2f)
        val r = size.minDimension / 2f
        val ring = r * 0.58f
        val w = r * 0.16f
        drawCircle(color = tint, radius = ring, center = c, style = Stroke(width = w))
        repeat(GEAR_TEETH) { i ->
            val a = (Math.PI * 2 / GEAR_TEETH * i).toFloat()
            val dx = cos(a)
            val dy = sin(a)
            drawLine(
                color = tint,
                start = Offset(c.x + dx * (ring + w * 0.3f), c.y + dy * (ring + w * 0.3f)),
                end = Offset(c.x + dx * r, c.y + dy * r),
                strokeWidth = w,
            )
        }
        drawCircle(color = tint, radius = ring * 0.34f, center = c)
    }
}

/**
 * 설정 화면. 지금 누구로 접속돼 있는지 보여주고 그 자리에서 바꾸게 한다.
 * 로그인 폼 자체는 전체화면(LoginScreen)이라 여기서는 진입만 시킨다 — 워치는 좁다.
 */
@Composable
fun SettingsPage(
    workerName: String?,
    workerId: String?,
    onLogin: () -> Unit,
    onLogout: () -> Unit,
) {
    val loggedIn = !workerId.isNullOrBlank()
    Column(
        modifier = Modifier.fillMaxSize().background(VgColors.Background).padding(horizontal = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        GearIcon(VgColors.Secondary, Modifier.size(30.dp))
        Text("설정", color = VgColors.Secondary, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))

        if (loggedIn) {
            Text(
                workerName ?: "이름 없음",
                color = VgColors.Primary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(top = 10.dp),
            )
            Text(workerId.orEmpty(), color = VgColors.Secondary, fontSize = 13.sp)
            Button(
                onClick = onLogout,
                label = { Text("로그아웃", fontSize = 14.sp, color = Color.Black) },
                colors = ButtonDefaults.buttonColors(containerColor = VgColors.Danger),
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )
        } else {
            // ★ 로그인 안 된 상태를 숨기지 않는다 — 수집은 돌아도 업로드가 안 되는 상태다.
            Text(
                "로그인해야 서버로 전송됩니다",
                color = VgColors.Caution,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
            Button(
                onClick = onLogin,
                label = { Text("로그인", fontSize = 14.sp, color = Color.Black) },
                colors = ButtonDefaults.buttonColors(containerColor = VgColors.Normal),
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )
        }
    }
}
