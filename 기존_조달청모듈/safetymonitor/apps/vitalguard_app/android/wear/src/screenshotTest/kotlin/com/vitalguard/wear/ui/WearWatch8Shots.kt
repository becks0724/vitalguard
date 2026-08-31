// 워치8 40mm 실제 스펙(438×438 · 340dpi = 206dp) 프리뷰 — 워치9(480px=226dp)보다 20dp 작아 기하가 갈린다
package com.vitalguard.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest

/**
 * 실기 `wm size` 438×438 · `wm density` 340 (08-31 실측 · SM-L325N LTE). 같은 340dpi 라도 논리 206dp 라
 * 워치9(226dp)에 맞춘 고정 치수가 원 밖으로 밀린다 — QR 카드 유도식(LoginScreen)의 근거 기기.
 * ⚠ 454(LARGE_ROUND)·480(WearWatch9Shots) 레일을 지우지 않는다 — 각자 자기 기기의 대표다.
 */
private const val WATCH8 = "spec:width=438px,height=438px,dpi=340,isRound=true"

@PreviewTest @Preview(name = "w8 1 대기", device = WATCH8, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W8Idle() = PreviewIdle()
@PreviewTest @Preview(name = "w8 2 정상", device = WATCH8, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W8Normal() = PreviewNormal()
@PreviewTest @Preview(name = "w8 9 큰글꼴", device = WATCH8, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true, fontScale = 1.24f)
@Composable fun W8LargeFont() = PreviewLargeFont()

@PreviewTest @Preview(name = "w8 p1 심박 추이", device = WATCH8, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W8PageHeart() = ShotPageHeart()
@PreviewTest @Preview(name = "w8 p6 설정 로그아웃", device = WATCH8, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W8PageSettingsOut() = ShotPageSettingsOut()

@PreviewTest @Preview(name = "w8 p7 로그인 QR", device = WATCH8, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W8PageLoginQr() = ShotPageLoginQr()
@PreviewTest @Preview(name = "w8 p7 로그인 QR 만료", device = WATCH8, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W8PageLoginQrExpired() = ShotPageLoginQrExpired()
@PreviewTest @Preview(name = "w8 p7 로그인 직접입력", device = WATCH8, showSystemUi = true, backgroundColor = 0xff000000, showBackground = true)
@Composable fun W8PageLogin() = ShotPageLogin()
