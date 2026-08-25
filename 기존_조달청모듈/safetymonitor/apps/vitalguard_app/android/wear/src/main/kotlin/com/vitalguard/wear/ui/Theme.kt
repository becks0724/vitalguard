// 워치 색 팔레트 — 위험도 4단계는 관제웹 신호등과 같은 뜻을 갖는다(작업자와 관제가 같은 색을 본다)
package com.vitalguard.wear.ui

import androidx.compose.ui.graphics.Color
import com.vitalguard.wear.core.Severity

object VgColors {
    val Background = Color(0xFF000000)
    val Primary = Color(0xFFFFFFFF)
    val Secondary = Color(0xFF9E9E9E)
    val Divider = Color(0xFF2C2C2E)
    val Pill = Color(0xFF2C2C2E)

    // 위험도 — OLED 검정 위에서 대비가 확보되는 값으로 골랐다.
    val Normal = Color(0xFF30D158)   // 정상 · 시작 버튼
    val Caution = Color(0xFFFF9F0A)  // 주의 · 큐 적체
    val Danger = Color(0xFFFF453A)   // 위험 · 중지 버튼
    val Idle = Color(0xFF6E6E73)     // 대기(미측정)

    val Accent = Color(0xFF64D2FF)   // 보조 정보
    /** 호의 빈 부분 — 배경보다 밝아 "여기까지가 범위" 를 보여준다(이미지의 회색 트랙). */
    val Track = Color(0xFF2C2C2E)
}

/** 위험도 → 색. 화면 어디서든 같은 매핑을 쓴다. */
fun Severity.color(): Color = when (this) {
    Severity.IDLE -> VgColors.Idle
    Severity.NORMAL -> VgColors.Normal
    Severity.CAUTION -> VgColors.Caution
    Severity.DANGER -> VgColors.Danger
}
