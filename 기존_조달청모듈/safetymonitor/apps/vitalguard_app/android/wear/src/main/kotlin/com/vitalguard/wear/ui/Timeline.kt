// 심박 표본 타입 — 요약 화면의 범위(최저~최고) 계산이 쓴다. 그리기는 TrendChart 가 맡는다
package com.vitalguard.wear.ui

/** 한 점 = 한 표본. 화면이 들고 있는 최근 값만 그린다(서버 조회 없음). */
data class TimelinePoint(val atMs: Long, val bpm: Int)

/** 차트가 덮는 시간 폭 — 근무 중 "지금 오르고 있나" 를 보려면 시간 단위가 아니라 분 단위다. */
const val CHART_WINDOW_MS = 5 * 60_000L
