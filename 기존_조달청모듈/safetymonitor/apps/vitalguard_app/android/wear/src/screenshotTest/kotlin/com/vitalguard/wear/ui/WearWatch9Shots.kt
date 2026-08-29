// 워치9 44mm 실제 스펙(480×480 · 340dpi) 프리뷰 — LARGE_ROUND(454)와 별도로 한 벌 더 둔다(08-29 사용자 결정 ②B)
package com.vitalguard.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest

/**
 * 실기 `wm size` 480×480 · `wm density` 340. LARGE_ROUND(454 · 320dpi)와 논리 크기는 226dp 로 거의 같지만
 * 밀도가 달라 글자·여백이 조금씩 어긋난다 — 08-29 에 "상세 보조줄 잘림" 판정이 프리뷰(454)와 실기에서 갈렸다.
 * ⚠ 454·384 판을 지우지 않는다 — 워치9 외 원형 기기(워치4~8 · 40mm 396px)의 대표는 그쪽이다.
 */
// ⚠ 구형 문법 `spec:shape=Round,width=480,height=480,unit=px,dpi=340` 은 스크린샷 렌더러가 못 읽어 1080×2400(폰 기본값)으로 떨어진다(실측).
private const val WATCH9 = "spec:width=480px,height=480px,dpi=340,isRound=true"

@PreviewTest @Preview(name = "w9 1 대기", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9Idle() = PreviewIdle()
@PreviewTest @Preview(name = "w9 2 정상", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9Normal() = PreviewNormal()
@PreviewTest @Preview(name = "w9 3 주의(심박)", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9Caution() = PreviewCaution()
@PreviewTest @Preview(name = "w9 4 위험(온열)", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9DangerHeat() = PreviewDangerHeat()
@PreviewTest @Preview(name = "w9 5 위험(SpO2)", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9DangerSpo2() = PreviewDangerSpo2()
@PreviewTest @Preview(name = "w9 6 무동작", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9Still() = PreviewStill()
@PreviewTest @Preview(name = "w9 7 전송대기", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9Queued() = PreviewQueued()
@PreviewTest @Preview(name = "w9 9 큰글꼴", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true, fontScale = 1.24f)
@Composable fun W9LargeFont() = PreviewLargeFont()

@PreviewTest @Preview(name = "w9 p1 심박 추이", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageHeart() = ShotPageHeart()
@PreviewTest @Preview(name = "w9 p2 산소포화도 추이", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageSpo2() = ShotPageSpo2()
@PreviewTest @Preview(name = "w9 p3 체온 추이", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageTemp() = ShotPageTemp()
@PreviewTest @Preview(name = "w9 p3 체온 추이(워밍업)", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageTempWarmup() = ShotPageTempWarmup()
@PreviewTest @Preview(name = "w9 p4 스트레스 추이", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageStress() = ShotPageStress()
@PreviewTest @Preview(name = "w9 p5 오늘 걸음", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageSteps() = ShotPageSteps()
@PreviewTest @Preview(name = "w9 p6 설정 로그인됨", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageSettingsIn() = ShotPageSettingsIn()
@PreviewTest @Preview(name = "w9 p6 설정 로그아웃", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageSettingsOut() = ShotPageSettingsOut()
@PreviewTest @Preview(name = "w9 p7 로그인 QR", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageLoginQr() = ShotPageLoginQr()
@PreviewTest @Preview(name = "w9 p7 로그인 QR 만료", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageLoginQrExpired() = ShotPageLoginQrExpired()
@PreviewTest @Preview(name = "w9 p7 로그인 직접입력", device = WATCH9, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W9PageLogin() = ShotPageLogin()
