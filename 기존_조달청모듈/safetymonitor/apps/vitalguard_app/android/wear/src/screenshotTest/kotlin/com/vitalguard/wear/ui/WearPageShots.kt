// 세로 페이저 1~6번 페이지 + 로그인 — 요약 화면 뒤에 숨어 있어 프리뷰가 없던 화면들을 PNG 로 뽑는다
package com.vitalguard.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.wear.tooling.preview.devices.WearDevices
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.wear.core.Sample

private const val ROUND = WearDevices.LARGE_ROUND
private const val NOW = 1_787_000_000_000L

/** 창 길이만큼 거슬러 올라가며 표본을 만든다 — 값은 결정적(시각·난수 없음)이라 두 번 그려도 같다. */
private fun series(windowMs: Long, stepMs: Long, f: (i: Int, n: Int) -> Double): List<Sample> {
    val n = (windowMs / stepMs).toInt()
    return (0..n).map { i -> Sample(atMs = NOW - (n - i) * stepMs, value = f(i, n)) }
}

// 15분 심박 5초 간격 — 작업 중 오르내림(85~105), 끝에 살짝 상승
private val heart = series(15 * 60_000L, 5_000L) { i, n -> 88.0 + ((i * 7) % 13) - 6 + (i.toDouble() / n) * 8 }
// 1시간 SpO₂ 5분 간격 — 성긴 점, 한 번 결측(35분 지점)
private val spo2 = series(60 * 60_000L, 5 * 60_000L) { i, _ -> listOf(97.0, 98.0, 97.0, 96.0, 97.0, 95.0, 96.0, 97.0, 97.0, 96.0, 97.0, 97.0, 96.0)[i] }
    .filterIndexed { i, _ -> i != 7 }
// 30분 피부온 30초 간격 — 36.0 → 37.2 로 오르는데 주변온은 28.4 고정 = 기기 발열이 아니라 진짜 체온
private val skin = series(30 * 60_000L, 30_000L) { i, n -> 36.0 + 1.2 * (i.toDouble() / n) }
private val ambient = series(30 * 60_000L, 30_000L) { i, _ -> 28.4 + ((i % 4) * 0.05) }
// 30분 스트레스 1분 간격 — 20대에서 50대로
private val stress = series(30 * 60_000L, 60_000L) { i, n -> 22.0 + 30.0 * (i.toDouble() / n) + ((i * 5) % 7) }
// 1시간 누계 걸음 2분 간격 — 계단(간헐 이동)
private val steps = series(60 * 60_000L, 2 * 60_000L) { i, _ -> 4_200.0 + (i / 3) * 160 + (if (i % 3 == 2) 90 else 0) }

private val working = VitalUiState(
    workerName = "장우진", collecting = true, nowMs = NOW,
    bpm = 96, bpmAgeSec = 4, bpmRange = 85 to 105, hrvSdnnMs = 42.0,
    spo2 = 96, spo2AgeSec = 240,
    skinTempC = 37.2, ambientTempC = 28.4, coreTempC = 37.1,
    windowSteps = 340, windowFloors = 1, windowKcal = 12.0, sessionSteps = 2_310, dailySteps = 5_812,
    heartTrend = heart, spo2Trend = spo2, skinTempTrend = skin, ambientTrend = ambient,
    stressTrend = stress, stepsTrend = steps,
)

@PreviewTest @Preview(name = "p1 심박 추이", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageHeart() = HeartDetailPage(working)

@PreviewTest @Preview(name = "p2 산소포화도 추이", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageSpo2() = Spo2DetailPage(working)

@PreviewTest @Preview(name = "p3 체온 추이", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageTemp() = TempDetailPage(working)

@PreviewTest @Preview(name = "p4 스트레스 추이", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageStress() = ActivityDetailPage(working)

@PreviewTest @Preview(name = "p5 오늘 걸음", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageSteps() = StepsDetailPage(working)

@PreviewTest @Preview(name = "p6 설정 로그인됨", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageSettingsIn() = SettingsPage(workerName = "장우진", workerId = "EMP-6861", onLogin = {}, onLogout = {})

@PreviewTest @Preview(name = "p6 설정 로그아웃", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageSettingsOut() = SettingsPage(workerName = null, workerId = null, onLogin = {}, onLogout = {})

@PreviewTest @Preview(name = "p7 로그인 QR", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageLoginQr() = LoginScreen(state = LoginUiState(qr = sampleQrWaiting), onEditId = {}, onEditPassword = {}, onSubmit = {}, onCancel = {})

@PreviewTest @Preview(name = "p7 로그인 QR 받는중", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageLoginQrLoading() = LoginScreen(state = LoginUiState(), onEditId = {}, onEditPassword = {}, onSubmit = {}, onCancel = {})

@PreviewTest @Preview(name = "p7 로그인 QR 만료", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageLoginQrExpired() = LoginScreen(state = LoginUiState(qr = sampleQrWaiting.copy(phase = QrPhase.EXPIRED, secondsLeft = 0)), onEditId = {}, onEditPassword = {}, onSubmit = {}, onCancel = {})

@PreviewTest @Preview(name = "p7 로그인 QR 오류", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageLoginQrError() = LoginScreen(state = LoginUiState(qr = QrLoginUiState(phase = QrPhase.ERROR, error = "서버에 연결하지 못했습니다.")), onEditId = {}, onEditPassword = {}, onSubmit = {}, onCancel = {})

@PreviewTest @Preview(name = "p7 로그인 직접입력", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageLogin() = LoginScreen(state = LoginUiState(mode = LoginMode.MANUAL), onEditId = {}, onEditPassword = {}, onSubmit = {}, onCancel = {})

// 워밍업 전 상세 — 값이 없을 때 "측정 대기"·"착용 N회분 더" 가 어떻게 보이나
@PreviewTest @Preview(name = "p3 체온 추이(워밍업)", device = ROUND, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun ShotPageTempWarmup() = TempDetailPage(VitalUiState(workerName = "장우진", collecting = true, nowMs = NOW, skinTempC = 36.1, coreWarmupBuckets = 3))
