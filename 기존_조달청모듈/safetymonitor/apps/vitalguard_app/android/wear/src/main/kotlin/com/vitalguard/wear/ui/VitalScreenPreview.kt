// 제품 화면 미리보기 — 실기 없이 상태 8종을 IDE 에서 확인한다(각 상태마다 색·줄 구성이 다르다)
package com.vitalguard.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.wear.tooling.preview.devices.WearDevices

/** 미리보기용 차트 표본 — 5분 창 안에서 오르내리는 근무 심박. */
private const val DEMO_NOW = 1_787_000_000_000L
private val demoTimeline = (0..60).map {
    TimelinePoint(
        atMs = DEMO_NOW - (60 - it) * 5_000L,
        bpm = 88 + ((it * 13) % 17) - 8,
    )
}

private const val ROUND = WearDevices.LARGE_ROUND
private const val SMALL = WearDevices.SMALL_ROUND

@Preview(name = "1 대기", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewIdle() = VitalScreen(VitalUiState(workerName = "장우진"), {})

@Preview(name = "2 정상", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewNormal() = VitalScreen(
    VitalUiState(
        workerName = "장우진",
        timeline = demoTimeline, nowMs = DEMO_NOW, bpmRange = 95 to 102,  bpm = 88, bpmAgeSec = 4, spo2 = 97, spo2AgeSec = 240,
        skinTempC = 36.1, ambientTempC = 28.4, stillSec = 8.0,
        collecting = true, batteryPct = 78, lastUploadAgeSec = 35,
    ),
    {},
)

@Preview(name = "3 주의(심박)", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewCaution() = VitalScreen(
    VitalUiState(
        workerName = "장우진",
        timeline = demoTimeline, nowMs = DEMO_NOW, bpmRange = 95 to 102,  bpm = 118, spo2 = 95, bpmAgeSec = 30, spo2AgeSec = 90,
        skinTempC = 36.9, ambientTempC = 31.2, stillSec = 25.0,
        collecting = true, batteryPct = 54, lastUploadAgeSec = 12,
    ),
    {},
)

@Preview(name = "4 위험(온열)", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewDangerHeat() = VitalScreen(
    VitalUiState(
        workerName = "장우진",
        timeline = demoTimeline, nowMs = DEMO_NOW, bpmRange = 95 to 102,  bpm = 141, spo2 = 94, bpmAgeSec = 4, spo2AgeSec = 30,
        skinTempC = 37.8, ambientTempC = 35.6, stillSec = 40.0,
        collecting = true, batteryPct = 41, lastUploadAgeSec = 8,
    ),
    {},
)

/** SpO₂ 저하 — 밀폐공간 작업의 핵심 위험 신호. */
@Preview(name = "5 위험(SpO₂)", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewDangerSpo2() = VitalScreen(
    VitalUiState(
        workerName = "장우진",
        timeline = demoTimeline, nowMs = DEMO_NOW, bpmRange = 95 to 102,  bpm = 104, bpmAgeSec = 8, spo2 = 86, spo2AgeSec = 15,
        skinTempC = 36.0, collecting = true, batteryPct = 60, lastUploadAgeSec = 20,
    ),
    {},
)

/** 무동작 — 붕괴(실신) 후보. 90초 넘으면 주황으로 뜬다. */
@Preview(name = "6 무동작", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewStill() = VitalScreen(
    VitalUiState(
        workerName = "장우진",
        timeline = demoTimeline, nowMs = DEMO_NOW, bpmRange = 95 to 102,  bpm = 62, bpmAgeSec = 70, stillSec = 320.0, skinTempC = 35.8,
        collecting = true, batteryPct = 33, lastUploadAgeSec = 45,
    ),
    {},
)

/** 서버 장애 — 08-25 실제 상황. 큐 적체가 화면에 보여야 한다. */
@Preview(name = "7 전송대기", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewQueued() = VitalScreen(
    VitalUiState(
        workerName = "장우진",
        timeline = demoTimeline, nowMs = DEMO_NOW, bpmRange = 95 to 102,  bpm = 90, bpmAgeSec = 4, spo2 = 96, spo2AgeSec = 600,
        skinTempC = 36.3, collecting = true, queued = 283, batteryPct = 12,
    ),
    {},
)

/** 작은 워치 — 잘림 확인용. 정보가 가장 많은 상태로 본다. */
@Preview(name = "8 작은워치", device = SMALL, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable
fun PreviewSmallRound() = VitalScreen(
    VitalUiState(
        workerName = "장우진",
        timeline = demoTimeline, nowMs = DEMO_NOW, bpmRange = 95 to 102,  bpm = 141, spo2 = 86, bpmAgeSec = 4, spo2AgeSec = 30,
        skinTempC = 37.8, ambientTempC = 35.6, stillSec = 200.0,
        collecting = true, queued = 12, batteryPct = 41, lastUploadAgeSec = 8,
    ),
    {},
)

/** 글꼴 확대 — 접근성 설정을 최대로 올린 사용자에게 레이아웃이 버티는지. */
@Preview(name = "9 큰글꼴", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true, fontScale = 1.24f)
@Composable
fun PreviewLargeFont() = VitalScreen(
    VitalUiState(
        workerName = "장우진",
        timeline = demoTimeline, nowMs = DEMO_NOW, bpmRange = 95 to 102,  bpm = 118, spo2 = 91, bpmAgeSec = 22, spo2AgeSec = 45,
        skinTempC = 37.1, stillSec = 95.0,
        collecting = true, batteryPct = 62, lastUploadAgeSec = 22,
    ),
    {},
)
