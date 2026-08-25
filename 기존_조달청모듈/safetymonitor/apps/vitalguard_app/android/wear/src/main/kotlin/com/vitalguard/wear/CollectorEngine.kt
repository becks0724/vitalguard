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

    /**
     * 화면 표시용 최신 스냅숏 — **업로드 경로와 별개다**(iOS PhoneReceiver 의 그 규칙).
     * 여기서 무엇을 하든 서버로 가는 값은 안 변한다. 화면만 본다.
     */
    @Volatile var lastBpm: Int? = null
        private set
    @Volatile var lastSpo2: Int? = null
        private set
    @Volatile var lastSpo2AtMs: Long? = null
        private set
    @Volatile var lastSkinTempC: Double? = null
        private set
    @Volatile var lastAmbientTempC: Double? = null
        private set
    @Volatile var samples = 0
        private set
    /** 화면 표시용 HRV — 전송용(창 주기당 1회)과 달리 창이 차면 늘 최신값을 보여준다. */
    @Volatile var lastHrvMs: Double? = null
        private set
    /** 화면 표시용 활동 누계 — 착용 세션 동안의 합(전송용 구간 증분과 별개). */
    @Volatile var lastSteps = 0
        private set
    @Volatile var lastFloors = 0
        private set
    /** 직전 flush 구간의 활동 — 스트레스 지수의 '활동 맥락' 재료(구간 합이지 누계 아님). */
    @Volatile var windowSteps = 0
        private set
    @Volatile var windowFloors = 0
        private set
    @Volatile var windowKcal = 0.0
        private set
    private val motion = MotionTracker()
    private val ibiWindow = mutableListOf<Pair<Long, Int>>()   // (측정시각, ibi)
    private var ibiStatusWindow = mutableListOf<Int>()
    private var hrvWindowMs = 300_000L                          // SDNN 표준 5분 창 — 실측 후 확정
    private var lastHrvEmitMs: Long? = null
    /** 벗은 상태 — 무동작이 계속 늘어나면 "쓰러져 있음" 으로 오독된다. */
    @Volatile private var motionStopped = false   // MIN_VALUE 초기값은 뺄셈 오버플로로 영영 안 실린다(시험이 잡음)

    @Synchronized
    fun start(nowMs: Long) {
        motionStopped = false
        // ★ 착용이 끊긴 구간을 사이에 두고 IBI 를 이어 붙이면 SDNN 이 왜곡된다 —
        //   SDNN 은 "연속된 박동" 의 변동이지 시간이 벌어진 두 토막의 차이가 아니다.
        ibiWindow.clear()
        ibiStatusWindow.clear()
        lastHrvMs = null
        motion.start(nowMs)
        source.start(this)
    }

    /**
     * 수집 중지 — **표시용 스냅숏을 비운다.**
     * 08-25 실기: 워치를 벗은 뒤에도 체온 37.8℃ 가 화면에 남아 있었다. 측정이 끝난 값이
     * 현재값처럼 보이면 관제·작업자 모두 오독한다(iOS `gateStaleVitals` 가 막는 그 사고).
     * ⚠ 큐와 IBI 창은 건드리지 않는다 — 미전송분은 다시 찼을 때 함께 올라간다.
     */
    @Synchronized
    fun stop() {
        source.stop()
        lastBpm = null
        lastSpo2 = null
        lastSpo2AtMs = null
        lastSkinTempC = null
        lastAmbientTempC = null
        lastHrvMs = null
        motionStopped = true
    }

    // ── TrackerListener ──────────────────────────────────────────────

    @Synchronized
    override fun onHeartRate(bpm: Int, ibiMs: List<Int>, ibiStatus: List<Int>, atMs: Long) {
        if (bpm > 0) {
            builder.heartRate(bpm, atMs)
            lastBpm = bpm
            samples++
        }
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
        // 화면용은 매번 갱신한다 — 전송용 게이트(창 주기당 1회)와 목적이 다르다.
        // 심박을 함께 넘긴다 — 배치가 통째로 어긋난 IBI 를 걸러낼 유일한 대조 기준이다.
        lastHrvMs = Sdnn.sdnnMs(ibiWindow.map { it.second }, ibiStatusWindow, lastBpm)
    }

    @Synchronized
    override fun onSpo2(pct: Int, atMs: Long) {
        builder.spo2(pct, atMs)
        lastSpo2 = pct
        lastSpo2AtMs = atMs
    }

    @Synchronized
    override fun onSkinTemp(objectC: Double, ambientC: Double?, atMs: Long) {
        builder.skinTemp(objectC, ambientC)
        lastSkinTempC = objectC
        lastAmbientTempC = ambientC
    }

    @Synchronized
    override fun onAccelMagG(magG: Double, atMs: Long) {
        motion.onSample(magG, atMs)
    }

    /**
     * 활동 증분 — 구간 합을 그대로 누산한다. flush 가 소비하면 0 으로 돌아간다.
     * 스트레스 지수가 '활동 맥락' 으로 쓰고, 서버 심박 위험판정이 '작업 게이트' 로 쓴다.
     */
    @Synchronized
    override fun onActivityDelta(steps: Int, floors: Int, kcal: Double, atMs: Long) {
        if (steps > 0) builder.addSteps(steps)
        if (floors > 0) builder.addFlights(floors)
        if (kcal > 0) builder.addEnergyKcal(kcal)
        lastSteps += steps
        lastFloors += floors
        windowSteps += steps
        windowFloors += floors
        windowKcal += kcal
    }

    // ── flush ────────────────────────────────────────────────────────

    /** 화면 표시용 무동작 지속 — flush 와 같은 계산을 쓴다(화면과 전송이 같은 값을 본다). */
    fun stillSecNow(nowMs: Long): Double? =
        if (motionStopped) null else motion.stillSec(nowMs)

    /**
     * 주기 flush — HRV 는 **창 주기당 1회만** 싣는다. 매 flush 마다 겹친 창을 재계산해 실으면
     * 구 앱이 만든 "같은 HRV 하루 수천 행" 의 가짜 밀도를 재현한다(VitalPipeline 주석의 그 사고).
     * 부족하면 키 생략 — 0 금지. 반환 = 적재 여부.
     */
    @Synchronized
    fun flush(nowMs: Long): Boolean {
        val lastEmit = lastHrvEmitMs
        if (lastEmit == null || nowMs - lastEmit >= hrvWindowMs) {
            Sdnn.sdnnMs(ibiWindow.map { it.second }, ibiStatusWindow, lastBpm)?.let {
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
        // 구간 누계를 비운다 — 전송된 값을 다음 구간에 다시 세면 활동이 부풀려진다.
        windowSteps = 0
        windowFloors = 0
        windowKcal = 0.0
        return true
    }
}
