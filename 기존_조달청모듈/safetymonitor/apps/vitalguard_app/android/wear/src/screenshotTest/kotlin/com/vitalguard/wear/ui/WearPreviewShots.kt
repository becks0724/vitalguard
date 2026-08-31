// 워치 프리뷰 → PNG 래퍼 — main 의 @Preview 함수를 그대로 호출해 빌드만으로 그림을 뽑는다(원본은 안 옮긴다)
package com.vitalguard.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.wear.tooling.preview.devices.WearDevices
import com.android.tools.screenshot.PreviewTest

// 원본 파일의 장치 상수는 private 이라 같은 값을 다시 선언한다. 배경·시스템UI 도 원본과 같게.
private const val ROUND = WearDevices.LARGE_ROUND
private const val SMALL = WearDevices.SMALL_ROUND

// ── VitalScreen 9종 (VitalScreenPreview.kt) ──
@PreviewTest @Preview(name = "1 대기", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotIdle() = PreviewIdle()

@PreviewTest @Preview(name = "2 정상", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotNormal() = PreviewNormal()

@PreviewTest @Preview(name = "3 주의(심박)", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotCaution() = PreviewCaution()

@PreviewTest @Preview(name = "4 위험(온열)", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotDangerHeat() = PreviewDangerHeat()

@PreviewTest @Preview(name = "5 위험(SpO2)", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotDangerSpo2() = PreviewDangerSpo2()

@PreviewTest @Preview(name = "6 무동작", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotStill() = PreviewStill()

@PreviewTest @Preview(name = "7 전송대기", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotQueued() = PreviewQueued()

@PreviewTest @Preview(name = "8 작은워치", device = SMALL, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotSmallRound() = PreviewSmallRound()

@PreviewTest @Preview(name = "9 큰글꼴", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true, fontScale = 1.24f)
@Composable fun ShotLargeFont() = PreviewLargeFont()

// ── ProbeScreen 4함수·5장 (ProbeScreenPreview.kt) ──
// @PreviewTest 는 반복 불가 — 다중 @Preview 에는 한 번만 단다(컴파일러가 잡았다)
@PreviewTest
@Preview(name = "probe idle", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Preview(name = "probe idle small", device = SMALL, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotProbeIdle() = PreviewProbeIdle()

@PreviewTest @Preview(name = "probe running", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotProbeRunning() = PreviewProbeRunning()

@PreviewTest @Preview(name = "probe backlog", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotProbeQueueBacklog() = PreviewProbeQueueBacklog()

@PreviewTest @Preview(name = "probe output", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotProbeOutput() = PreviewProbeOutput()
