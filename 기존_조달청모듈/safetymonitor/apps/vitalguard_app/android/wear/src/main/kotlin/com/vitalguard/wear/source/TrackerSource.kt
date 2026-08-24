// 수집원 심(seam) — 실기 삼성 SDK 와 시험 페이크가 같은 얼굴로 꽂힌다. 워치 도착일 잔여 = 실소스 1파일
package com.vitalguard.wear.source

/** 수집 이벤트 수신자 — CollectorEngine 이 구현한다. 시각은 전부 epoch ms(측정 시각). */
interface TrackerListener {
    fun onHeartRate(bpm: Int, ibiMs: List<Int>, ibiStatus: List<Int>, atMs: Long)
    fun onSpo2(pct: Int, atMs: Long)
    fun onSkinTemp(objectC: Double, ambientC: Double?, atMs: Long)
    fun onAccelMagG(magG: Double, atMs: Long)
}

interface TrackerSource {
    fun start(listener: TrackerListener)
    fun stop()
}
