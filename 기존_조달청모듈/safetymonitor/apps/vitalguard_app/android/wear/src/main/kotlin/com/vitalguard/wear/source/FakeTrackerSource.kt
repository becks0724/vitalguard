// 리플레이 페이크 — 기록된 이벤트 열을 그대로 재생한다. 종단 시험이 실기 없이 돈다
package com.vitalguard.wear.source

sealed class TrackerEvent {
    abstract val atMs: Long

    data class Hr(val bpm: Int, val ibiMs: List<Int>, val ibiStatus: List<Int>, override val atMs: Long) : TrackerEvent()
    data class Spo2(val pct: Int, override val atMs: Long) : TrackerEvent()
    data class SkinTemp(val objectC: Double, val ambientC: Double?, override val atMs: Long) : TrackerEvent()
    data class Accel(val magG: Double, override val atMs: Long) : TrackerEvent()
}

class FakeTrackerSource(private val events: List<TrackerEvent>) : TrackerSource {
    private var listener: TrackerListener? = null

    override fun start(listener: TrackerListener) { this.listener = listener }
    override fun stop() { listener = null }

    /** upToMs 까지의 이벤트를 시각순으로 흘린다 — 시험이 가상 시계로 구간을 전진시킨다. */
    private var cursor = 0
    fun replayUntil(upToMs: Long) {
        val l = listener ?: return
        while (cursor < events.size && events[cursor].atMs <= upToMs) {
            when (val e = events[cursor]) {
                is TrackerEvent.Hr -> l.onHeartRate(e.bpm, e.ibiMs, e.ibiStatus, e.atMs)
                is TrackerEvent.Spo2 -> l.onSpo2(e.pct, e.atMs)
                is TrackerEvent.SkinTemp -> l.onSkinTemp(e.objectC, e.ambientC, e.atMs)
                is TrackerEvent.Accel -> l.onAccelMagG(e.magG, e.atMs)
            }
            cursor++
        }
    }
}
