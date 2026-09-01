// 수집 엔진 — 소스 → 파생(core) → 병합(SampleBuilder) → 큐 적재. 시계는 주입받는다(시험 가능성)
package com.vitalguard.wear

import com.vitalguard.wear.core.HistoryWindow
import com.vitalguard.wear.core.CoreTempKalman
import com.vitalguard.wear.core.HrSample
import com.vitalguard.wear.core.MetricHistory
import com.vitalguard.wear.core.MotionTracker
import com.vitalguard.wear.core.Sdnn
import com.vitalguard.wear.core.Stress
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
    /** 배터리 충전카운터(µAh) — 퍼센트보다 약 100배 촘촘하다. 못 읽는 기기면 null. */
    private val batteryChargeUah: () -> Long? = { null },
    /** 심박 트래커 마지막 재구독 시각(epoch ms). 한 번도 없었으면 null — 없음도 지문이다. */
    private val hrLastReviveAtMs: () -> Long? = { null },
    private val latestFix: (nowMs: Long) -> LocationFix? = { null },   // 배치당 1회 조회(iOS 규칙)
) : TrackerListener {

    private val builder = SampleBuilder()

    /**
     * 화면 표시용 최신 스냅숏 — **업로드 경로와 별개다**(iOS PhoneReceiver 의 그 규칙).
     * 여기서 무엇을 하든 서버로 가는 값은 안 변한다. 화면만 본다.
     */
    @Volatile var lastBpm: Int? = null

    /**
     * 마지막 심박이 **들어온** 시각. 두 곳이 쓴다.
     *  ① 화면 — "이 숫자는 언제 잰 것인가". 없으면 낡은 값이 현재값처럼 보인다
     *     (08-26 실기: 심박 스트림이 죽은 뒤 28분간 화면에 `101` 이 그대로 남았다).
     *  ② 서비스 — 스트림 사망 판정. SpO₂ 에는 `lastSpo2AtMs` 로 이미 있던 장치가 심박엔 없었다.
     */
    @Volatile var lastBpmAtMs: Long? = null

    /** 마지막 `start()` 시각 — 한 건도 못 받은 경우의 침묵 길이를 여기서 잰다. */
    @Volatile private var sensingSinceMs: Long? = null
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

    /** 지표 이력 — 상세 페이지의 추이 차트가 읽는다. 창 길이는 수집 주기에 맞춘다. */
    val heartHistory = MetricHistory(HistoryWindow.HEART_MS)
    val spo2History = MetricHistory(HistoryWindow.SPO2_MS)
    val skinTempHistory = MetricHistory(HistoryWindow.TEMP_MS)
    val ambientHistory = MetricHistory(HistoryWindow.TEMP_MS)
    val stressHistory = MetricHistory(HistoryWindow.STRESS_MS)
    /** 걸음 — 누계라 우상향한다. 기울기가 "지금 얼마나 움직이는가" 다. */
    val stepsHistory = MetricHistory(HistoryWindow.STEPS_MS)

    /**
     * 칼만 심부체온 추정용 심박 원본. **`heartHistory` 를 못 쓴다** — 그쪽은 창이 15분이고
     * 봉우리 보존 방식으로 솎아내서 극값이 남는다. 칼만은 1분 **평균**을 요구하므로 솎으면
     * 값이 왜곡된다. 여기는 안 솎고 그대로 들되 창(180분) 밖만 버린다.
     * 갤럭시 심박은 약 2분 간격이라 180분이어도 90점 안팎이다(메모리 부담 없음).
     */
    private val hrLog = ArrayDeque<HrSample>()

    /** 칼만 입력 스냅샷 — 화면이 읽는다. 복사본이라 호출자가 들고 있어도 안전하다. */
    @Synchronized
    fun hrSamples(): List<HrSample> = hrLog.toList()
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
        sensingSinceMs = nowMs
        lastBpmAtMs = null
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
        sensingSinceMs = null
        lastBpmAtMs = null
        lastBpm = null
        lastSpo2 = null
        lastSpo2AtMs = null
        lastSkinTempC = null
        lastAmbientTempC = null
        lastHrvMs = null
        motionStopped = true
    }

    /**
     * 심박이 끊긴 지 얼마인가(ms). 한 건도 못 받았으면 `start()` 이후 경과.
     * 수집 중이 아니면 null — 벗은 상태의 침묵은 고장이 아니다.
     */
    fun hrSilenceMs(nowMs: Long): Long? {
        val since = lastBpmAtMs ?: sensingSinceMs ?: return null
        return (nowMs - since).coerceAtLeast(0L)
    }

    // ── TrackerListener ──────────────────────────────────────────────

    @Synchronized
    override fun onHeartRate(bpm: Int, ibiMs: List<Int>, ibiStatus: List<Int>, atMs: Long) {
        if (bpm > 0) {
            builder.heartRate(bpm, atMs)
            lastBpm = bpm
            lastBpmAtMs = atMs
            samples++
            heartHistory.add(atMs, bpm.toDouble())
            // 칼만용 원본 — 솎지 않는다. 창 밖만 버린다.
            hrLog.addLast(HrSample(atMs, bpm))
            val hrCutoff = atMs - CoreTempKalman.WINDOW_MINUTES * 60_000L
            while (hrLog.isNotEmpty() && hrLog.first().tsMs < hrCutoff) hrLog.removeFirst()
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
        spo2History.add(atMs, pct.toDouble())
    }

    @Synchronized
    override fun onSkinTemp(objectC: Double, ambientC: Double?, atMs: Long) {
        builder.skinTemp(objectC, ambientC)
        lastSkinTempC = objectC
        lastAmbientTempC = ambientC
        skinTempHistory.add(atMs, objectC)
        ambientC?.let { ambientHistory.add(atMs, it) }
    }

    @Synchronized
    override fun onAccelMagG(magG: Double, atMs: Long) {
        motion.onSample(magG, atMs)
    }

    /** 오늘 누계(자정 이후) — 화면 계기 전용. 서버로는 증분만 보낸다(상한 때문). */
    @Volatile var dailySteps: Int? = null

    @Synchronized
    override fun onDailyTotals(steps: Int?, floors: Int?) {
        steps?.let {
            dailySteps = it
            stepsHistory.add(System.currentTimeMillis(), it.toDouble())
        }
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
     * 모션 변동폭(밀리g) — 화면·표본이 쓰던 값을 **위치 게이트도** 읽는다.
     * 창 60개가 안 차면 null(부분 창 금지 규칙 그대로).
     */
    fun motionVarNow(): Int? = if (motionStopped) null else motion.variabilityMg()

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
            // ★ 화면과 **같은 게이트**를 쓴다(stillSecNow). 종전엔 여기만 게이트를 안 거쳐
            //   벗어 둔 워치가 "N초째 무동작" 행을 계속 올렸다 — R-22 가 화면에서 막은 바로 그
            //   그림을 전송 경로가 그대로 재현한 것이다(08-25 서버 세션이 심박 없는 행 22건으로
            //   관측). 미착용이면 실을 것이 없으니 buildAndReset 이 null 을 내고 행이 안 생긴다.
            stillSec = stillSecNow(nowMs),
            variabilityMg = motion.variabilityMg(),
            batteryPct = batteryPct(),
            batteryChargeUah = batteryChargeUah(),
            hrLastReviveAtMs = hrLastReviveAtMs(),
            fix = latestFix(nowMs),
        ) ?: return false
        // 스트레스 이력 — 활동 재료가 모이는 flush 시점에 계산해 담는다.
        Stress.compute(
            heartRate = lastBpm,
            hrvSdnnMs = lastHrvMs,
            activeEnergyKcal = windowKcal.takeIf { it > 0 },
            steps = windowSteps.takeIf { it > 0 },
            floors = windowFloors.takeIf { it > 0 },
        ).index?.let { stressHistory.add(nowMs, it.toDouble()) }

        queue.add(sample)
        // 구간 누계를 비운다 — 전송된 값을 다음 구간에 다시 세면 활동이 부풀려진다.
        windowSteps = 0
        windowFloors = 0
        windowKcal = 0.0
        return true
    }
}
