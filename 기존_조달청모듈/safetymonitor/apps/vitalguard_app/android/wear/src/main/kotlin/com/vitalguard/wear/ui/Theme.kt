// 워치 색 팔레트 — iOS ContentView 의 의미색을 그대로 옮긴다(시작=초록·중지=빨강·보조=회색)
package com.vitalguard.wear.ui

import androidx.compose.ui.graphics.Color

object VgColors {
    val Background = Color(0xFF000000)
    val Primary = Color(0xFFFFFFFF)
    val Secondary = Color(0xFF9E9E9E)
    val Pill = Color(0xFF2C2C2E)
    val Green = Color(0xFF30D158)   // 시작 · 정상
    val Red = Color(0xFFFF453A)     // 중지 · 심박 하트
    val Cyan = Color(0xFF64D2FF)    // 결과 출력
    val Orange = Color(0xFFFF9F0A)  // 주의(큐 적체 등)
}
