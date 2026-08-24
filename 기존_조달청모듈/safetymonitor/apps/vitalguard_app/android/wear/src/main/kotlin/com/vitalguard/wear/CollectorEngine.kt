// 수집 엔진 — 소스 → 파생(core) → 병합(SampleBuilder) → 큐 적재. 시계는 주입받는다(시험 가능성)
package com.vitalguard.wear

import com.vitalguard.wear.core.MotionTracker
import com.vitalguard.wear.core.Sdnn
import com.vitalguard.wear.pipeline.SampleBuilder
import com.vitalguard.wear.pipeline.VitalQueue
import com.vitalguard.wear.source.LocationFix
import com.vitalguard.wear.source.TrackerListener
import com.vitalguard.wear.source.TrackerSource

/**
 * flush 주기·HRV 창 크기는 **설정 상수일 뿐 확정값이 아니다** — 실측(배터리·LTE) 뒤
 * 3단계에서 정한다(context-notes R-08). 여기서는 계약과 배선만 굳힌다.
 */
class CollectorEngine(
    private val source: TrackerSource,
    private val queue: VitalQueue,
    private val batteryPct: () -> Int?,
    private val latestFix: (nowMs: Long) -> LocationFix? = { null },   // 배치당 1회 조회(iOS 규칙)
) : TrackerListener {

    private val builder = SampleBuilder()
    private val motion = MotionTracker()
    private val ibiWindow = mutableListOf<Pair<Long, Int>>()   // (측정시각, ibi)
    private var ibiStatusWindow = mutableListOf<Int>()
    private var hrvWindowMs = 300_000L                          // SDNN 표준 5분 창 — 실측 후 확정
    private var lastHrvEmitMs: Long? = null   // MIN_VALUE 초기값은 뺄셈 오버플로로 영영 안 실린다(시험이 잡음)

    fun start(nowMs: Long) {
        motion.start(nowMs)
        source.start(this)
    }

    fun stop() {
        source.stop()
    }

    // ── TrackerListener ──────────────────────────────────────────────

    override fun onHeartRate(bpm: Int, ibiMs: List<Int>, ibiStatus: List<Int>, atMs: Long) {
        if (bpm > 0) builder.heartRate(bpm, atMs)
        ibiMs.forEachIndexed { i, ibi ->
            ibiWindow.add(atMs to ibi)
            ibiStatusWindow.add(ibiStatus.getOrElse(i) { Sdnn.STATUS_VALID })
        }
        // 창 밖 IBI 폐기 — 인덱스 정합을 위해 함께 자른다.
        val cutoff = atMs - hrvWindowMs
        while (ibiWindow.isNotEmpty() && ibiWindow[0].first < cutoff) {
            ibiWindow.removeAt(0)
            ibiStatusWindow.removeAt(0)
        }
    }

    override fun onSpo2(pct: Int, atMs: Long) {
        builder.spo2(pct, atMs)
    }

    override fun onSkinTemp(objectC: Double, ambientC: Double?, atMs: Long) {
        builder.skinTemp(objectC, ambientC)
    }

    override fun onAccelMagG(magG: Double, atMs: Long) {
        motion.onSample(magG, atMs)
    }

    // ── flush ────────────────────────────────────────────────────────

    /**
     * 주기 flush — HRV 는 **창 주기당 1회만** 싣는다. 매 flush 마다 겹친 창을 재계산해 실으면
     * 구 앱이 만든 "같은 HRV 하루 수천 행" 의 가짜 밀도를 재현한다(VitalPipeline 주석의 그 사고).
     * 부족하면 키 생략 — 0 금지. 반환 = 적재 여부.
     */
    fun flush(nowMs: Long): Boolean {
        val lastEmit = lastHrvEmitMs
        if (lastEmit == null || nowMs - lastEmit >= hrvWindowMs) {
            Sdnn.sdnnMs(ibiWindow.map { it.second }, ibiStatusWindow)?.let {
                builder.hrvSdnn(it)
                lastHrvEmitMs = nowMs
            }
        }
        val sample = builder.buildAndReset(
            sentAtMs = nowMs,
            stillSec = motion.stillSec(nowMs),
            variabilityMg = motion.variabilityMg(),
            batteryPct = batteryPct(),
            fix = latestFix(nowMs),
        ) ?: return false
        queue.add(sample)
        return true
    }
}
