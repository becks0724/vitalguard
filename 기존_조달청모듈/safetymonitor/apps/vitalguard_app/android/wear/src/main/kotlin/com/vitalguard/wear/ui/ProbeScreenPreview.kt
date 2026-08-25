// 미리보기 — 실기·서비스 없이 Android Studio 안에서 원형/사각·크기별로 화면을 확인한다
package com.vitalguard.wear.ui

import androidx.compose.runtime.Composable
import androidx.wear.tooling.preview.devices.WearDevices
import androidx.compose.ui.tooling.preview.Preview

/** 상태 4종을 각각 다른 미리보기로 둔다 — 색·줄바꿈이 상태마다 달라 한 장으론 못 본다. */
private val demoActions = listOf(
    ProbeAction("① 권한 요청") {},
    ProbeAction("② 삼성 SDK 트래커") {},
    ProbeAction("③ Health Services") {},
    ProbeAction("④ 심박 시작", VgColors.Green) {},
    ProbeAction("⑤ 생존 로그") {},
    ProbeAction("⑥ 심박 중지", VgColors.Red) {},
    ProbeAction("⑦ 본수집 시작", VgColors.Green) {},
    ProbeAction("⑧ 본수집 중지", VgColors.Red) {},
)

@Preview(device = WearDevices.LARGE_ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Preview(device = WearDevices.SMALL_ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewIdle() = ProbeScreen(ProbeUiState(), demoActions)

@Preview(device = WearDevices.LARGE_ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewRunning() = ProbeScreen(
    ProbeUiState(bpm = 72, running = true, samples = 128),
    demoActions,
)

/** 큐 적체 — 서버 장애 때 화면이 이렇게 보여야 한다(08-25 실제 상황 재현). */
@Preview(device = WearDevices.LARGE_ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewQueueBacklog() = ProbeScreen(
    ProbeUiState(bpm = 88, running = true, samples = 640, queued = 283),
    demoActions,
)

@Preview(device = WearDevices.LARGE_ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewWithOutput() = ProbeScreen(
    ProbeUiState(
        bpm = 90,
        running = true,
        samples = 42,
        output = "SDK 연결 성공\n지원 트래커 21종\n  PPG_GREEN\n  HEART_RATE_CONTINUOUS",
    ),
    demoActions,
)
