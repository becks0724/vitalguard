// 심박 기반 심부체온 추정 — 관제웹 analyzers/core-temp-estimator.ts 의 이식본(USARIEM Buller 2013 EKF)
package com.vitalguard.wear.core

/**
 * ★ 왜 워치에 이식하나. 기기 자체 발열이 피부온 센서를 오염시킨다([[R-25]] 실측 — 10분에 피부온
 * +2.33℃, 그런데 주변온이 +2.51℃ 로 **더** 올랐다). **이 추정은 심박만 쓰므로 그 오염에
 * 구조적으로 면역이다.** 피부온 옆에 나란히 두면 두 값이 벌어지는 것 자체가 발열 신호다.
 *
 * ★ 계수는 논문값 그대로다. 임의 조정하지 않는다 — 정답(실측 심부체온)이 없어 자체 보정은
 * 검증 불가능한 조작이 된다. 원본 주석과 같은 규율이고, 이식본이 갈라지면 안 된다.
 *
 * 원리 — 심부체온이 오르면 체온 조절(피부 혈류 증가)로 심박이 예측 가능한 2차 곡선을 따라
 * 오른다. 이 관측 모델을 거꾸로 타서 1분 평균 심박 시계열에서 체온을 추정한다.
 * 문헌 검증 RMSE 0.21~0.30℃(삼킨 캡슐 실측 대비·야외 작업 부하).
 *
 * 한계(표기가 짊어질 것) — ① 심박 억제 약물은 과소추정(놓침 방향) ② 긴장·카페인·탈수는
 * 과대추정(오경보 방향) ③ 임계 근처 ±0.5℃ 회색지대 ④ "측정" 아닌 "추정".
 */
object CoreTempKalman {
    /** 세션 시작 기준 심부체온(℃). PSI 의 Tc0 도 이 값을 쓴다 — 숫자를 두 곳에 두지 않는다. */
    const val CT0 = 37.1

    // 문헌 계수(Buller 2013) — 과정 잡음 γ=0.022℃/분 · 관측 잡음 σ=18.88bpm
    // 관측 모델 HR = b₂·CT² + b₁·CT + b₀ (CT 37.1℃ ↔ HR ≈ 83bpm · 38.5℃ ↔ ≈ 137bpm)
    private const val GAMMA_SQ = 0.022 * 0.022
    private const val SIGMA_SQ = 18.88 * 18.88
    private const val B0 = -7887.1
    private const val B1 = 384.4286
    private const val B2 = -4.5714

    /** 워밍업 하한 — 유효 1분 버킷이 이 수 미만이면 추정을 내지 않는다(초기값 편향 구간). */
    const val MIN_BUCKETS = 30

    /**
     * 세션 경계 — 심박 공백이 이 분수를 넘으면 미착용으로 보고 필터를 리셋한다.
     * 밤새 벗어둔 워치의 궤적이 이어진 척 그려지는 것을 막는다.
     */
    const val SESSION_GAP_MINUTES = 60

    /** 광학 심박 오측 가드 — 범위 밖 bpm 은 버킷에 넣지 않는다. */
    private const val BPM_MIN = 30
    private const val BPM_MAX = 220

    /**
     * ⚠ 갤럭시워치는 심박이 **약 2분에 한 번** 온다(08-26 실측 중앙값 120.7초).
     * 그래서 버킷 30개를 채우려면 애플워치(1분 간격)의 30분이 아니라 **약 60분** 연속 착용이
     * 필요하다. 창을 서버(`CORE_TEMP_WINDOW_MINUTES`)와 같은 180분으로 잡아 여유를 둔다.
     */
    const val WINDOW_MINUTES = 180

    private fun expectedHr(ct: Double): Double = B2 * ct * ct + B1 * ct + B0

    data class Point(val tsMs: Long, val tempC: Double)

    /** 1분 버킷 평균으로 접는다 — 오측은 버리고 분 오름차순으로 돌려준다. */
    internal fun minuteBuckets(points: List<HrSample>): List<Pair<Long, Double>> {
        val sums = HashMap<Long, DoubleArray>()   // minute -> [sum, n]
        for (p in points) {
            if (p.bpm < BPM_MIN || p.bpm > BPM_MAX) continue
            val minute = Math.floorDiv(p.tsMs, 60_000L)
            val b = sums.getOrPut(minute) { doubleArrayOf(0.0, 0.0) }
            b[0] += p.bpm.toDouble()
            b[1] += 1.0
        }
        return sums.entries.map { it.key to it.value[0] / it.value[1] }.sortedBy { it.first }
    }

    /**
     * 심박 시계열 → 심부체온 추정 궤적. 순수 함수(시계·I/O 없음) — 같은 입력이면 같은 출력.
     * 60분 초과 공백에서 세션을 끊어 리셋하고, 각 세션의 워밍업 구간은 점을 내지 않는다.
     */
    fun estimateSeries(points: List<HrSample>): List<Point> {
        val out = ArrayList<Point>()
        var ct = CT0
        var v = 0.0            // 상태 분산 — 문헌 초기값 0(첫 스텝부터 γ² 로 자란다)
        var prevMinute: Long? = null
        var segBuckets = 0
        for ((minute, hr) in minuteBuckets(points)) {
            val gap = if (prevMinute == null) 1L else minute - prevMinute!!
            if (gap > SESSION_GAP_MINUTES) {
                ct = CT0
                v = 0.0
                segBuckets = 0
            }
            // 예측 — 결측 분만큼 과정 잡음을 누적(공백이 길수록 다음 관측이 강하게 끌어당긴다)
            v += GAMMA_SQ * minOf(gap, SESSION_GAP_MINUTES.toLong()).toDouble()
            // 보정(확장 칼만 — 관측 모델을 현재 추정점에서 선형화)
            val m = 2 * B2 * ct + B1
            val k = (v * m) / (m * m * v + SIGMA_SQ)
            ct += k * (hr - expectedHr(ct))
            v *= 1 - k * m
            segBuckets += 1
            if (segBuckets >= MIN_BUCKETS) out.add(Point(minute * 60_000L, ct))
            prevMinute = minute
        }
        return out
    }

    /** 궤적의 마지막 점. 워밍업 미달이면 null. **나이 판정은 호출자 몫** — 순수 함수를 유지한다. */
    fun estimate(points: List<HrSample>): Double? = estimateSeries(points).lastOrNull()?.tempC

    /**
     * ★ **지금 쓸 수 있는** 추정치. 마지막 추정점이 [maxAgeMs] 보다 늙었으면 null.
     *
     * ⚠ 왜 필요한가 — 심박이 끊겨도 창(180분)에 옛 표본이 남아 있어 [estimate] 는 **최대 3시간**
     * 더 값을 낸다. 그러면 30분 전 심박에서 나온 체온으로 지금을 판정하게 된다.
     * 08-26 실기에서 심박이 28분간 끊긴 채 화면·서버가 계속 값을 보여준 것이 정확히 이 형태다.
     *
     * ★ 이건 **칼만으로 옮기면서 새로 생긴 성질**이다. 종전 피부온 파생은 값이 표본과 함께 와서
     * 자동으로 신선했다 — 판정 근거가 표본보다 임의로 늙을 수 있다는 문제가 없었다.
     *
     * 버킷 시각은 분의 **시작**이라 나이가 최대 59초 과대평가된다 — 그만큼 여유를 준다.
     */
    fun estimateFresh(points: List<HrSample>, nowMs: Long, maxAgeMs: Long): Double? {
        val last = estimateSeries(points).lastOrNull() ?: return null
        return if (nowMs - last.tsMs - 60_000L <= maxAgeMs) last.tempC else null
    }

    /** 워밍업까지 남은 버킷 수 — 화면이 "몇 분 더" 를 말할 수 있게 한다. 다 찼으면 0. */
    fun bucketsRemaining(points: List<HrSample>): Int {
        var segBuckets = 0
        var prevMinute: Long? = null
        for ((minute, _) in minuteBuckets(points)) {
            val gap = if (prevMinute == null) 1L else minute - prevMinute!!
            if (gap > SESSION_GAP_MINUTES) segBuckets = 0
            segBuckets += 1
            prevMinute = minute
        }
        return (MIN_BUCKETS - segBuckets).coerceAtLeast(0)
    }
}

/** 칼만 입력 한 점. */
data class HrSample(val tsMs: Long, val bpm: Int)
