// 설정 페이지 — 세로 스와이프 맨 아래. 로그인/로그아웃이 여기 산다(08-26 사용자 지시)
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.delay
import kotlin.math.cos
import kotlin.math.sin

/** 톱니 개수 — 8개면 40dp 에서도 톱니가 뭉치지 않고 "설정" 으로 읽힌다. */
internal const val GEAR_TEETH = 8

/** 개발자(진단) 화면에 들어가는 톱니 연속 탭 수 — 안드로이드 설정의 빌드번호 연타와 같은 방식. */
private const val DEV_TAP_COUNT = 10

/**
 * 연타로 인정하는 탭 간격 상한. 이보다 뜸하면 처음부터 다시 센다.
 * ⚠ 안드로이드 원본에는 이 제한이 없다(화면을 벗어나야 초기화). 여기는 로그인·로그아웃 때문에
 *   평소에도 들르는 면이라, 제한이 없으면 며칠에 걸친 탭이 쌓여 우발 진입한다.
 */
private const val DEV_TAP_WINDOW_MS = 1_500L

/** 남은 횟수를 보여 주기 시작하는 지점 — 안드로이드 토스트와 같은 역할(성공·실패를 눈으로 가른다). */
private const val DEV_TAP_HINT_FROM = 5

/**
 * 톱니 표적의 가로 폭. 그리는 톱니는 30dp 그대로 두고 **가로만** 넓힌다 —
 * 30dp 를 정확히 열 번 노리는 건 워치에서 무리이고, 세로를 키우면 40mm(206dp) 에서 아래가 밀린다.
 */
private val GEAR_TAP_WIDTH = 96.dp

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
    /** 진단 화면 진입 — 톱니바퀴를 [DEV_TAP_COUNT] 번 연타한다(09-15 사용자 지시). */
    onOpenDiagnostics: () -> Unit = {},
) {
    val loggedIn = !workerId.isNullOrBlank()

    // 연타 카운터. 창은 타임스탬프가 아니라 이 효과 자체다 — 탭마다 키가 바뀌어 대기가 처음부터
    // 다시 걸리고, 다음 탭이 늦으면 그 대기가 끝나 0 으로 돌아간다.
    var devTaps by remember { mutableIntStateOf(0) }
    LaunchedEffect(devTaps) {
        if (devTaps > 0) {
            delay(DEV_TAP_WINDOW_MS)
            devTaps = 0
        }
    }
    Column(
        modifier = Modifier.fillMaxSize().background(VgColors.Background).padding(horizontal = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Column(
            modifier = Modifier
                .width(GEAR_TAP_WIDTH)
                .pointerInput(Unit) {
                    detectTapGestures(
                        onTap = {
                            val n = devTaps + 1
                            if (n >= DEV_TAP_COUNT) {
                                devTaps = 0
                                onOpenDiagnostics()
                            } else {
                                devTaps = n
                            }
                        },
                    )
                },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            GearIcon(VgColors.Secondary, Modifier.size(30.dp))
            // 남은 횟수가 라벨 자리를 잠시 빌린다 — 안드로이드 토스트 자리다. 겹쳐 그리지 않으므로
            // 배치가 안 흔들리고, 원형 가장자리에 별도 줄을 두는 것과 달리 잘릴 일도 없다.
            val counting = devTaps >= DEV_TAP_HINT_FROM
            Text(
                if (counting) "개발자 ${DEV_TAP_COUNT - devTaps}번 남음" else "설정",
                color = if (counting) VgColors.Accent else VgColors.Secondary,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp),
            )
        }

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
