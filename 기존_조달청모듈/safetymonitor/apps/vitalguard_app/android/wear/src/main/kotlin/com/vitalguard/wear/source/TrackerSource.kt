// 수집원 심(seam) — 실기 삼성 SDK 와 시험 페이크가 같은 얼굴로 꽂힌다. 워치 도착일 잔여 = 실소스 1파일
package com.vitalguard.wear.source

/** 수집 이벤트 수신자 — CollectorEngine 이 구현한다. 시각은 전부 epoch ms(측정 시각). */
interface TrackerListener {
    fun onHeartRate(bpm: Int, ibiMs: List<Int>, ibiStatus: List<Int>, atMs: Long)
    fun onSpo2(pct: Int, atMs: Long)
    fun onSkinTemp(objectC: Double, ambientC: Double?, atMs: Long)
    fun onAccelMagG(magG: Double, atMs: Long)

    /**
     * 활동 증분 — **구간 합이지 누적이 아니다.** 서버 스키마 상한(steps 5000·flights 500)이
     * 구간 값 기준이라 하루 누적을 보내면 통째로 스트립된다(iOS 주석의 그 함정).
     * 스트레스 지수의 '활동 맥락'·심박 위험판정의 '작업 게이트' 재료가 된다.
     */
    fun onActivityDelta(steps: Int, floors: Int, kcal: Double, atMs: Long) = Unit
}

interface TrackerSource {
    fun start(listener: TrackerListener)
    fun stop()
}
