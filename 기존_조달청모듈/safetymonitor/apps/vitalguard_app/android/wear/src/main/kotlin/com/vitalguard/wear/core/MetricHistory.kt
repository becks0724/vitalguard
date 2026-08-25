// 지표 이력 — 화면이 추이를 그리려면 값 하나가 아니라 시계열이 필요하다
package com.vitalguard.wear.core

/** 한 표본 = (시각, 값). 지표마다 단위가 달라 값은 Double 로 통일한다. */
data class Sample(val atMs: Long, val value: Double)

/**
 * 고정 창 시계열 버퍼.
 *
 * ★ 왜 화면이 직접 들고 있나 — 서버 조회로 이력을 가져오면 LTE 를 더 쓰고, 08-25 에 줄인
 *   발열이 되돌아온다([[R-25]]). 근무 중 추이는 **워치가 방금 잰 것**으로 충분하다.
 *
 * ⚠ 앱을 재시작하면 비워진다(메모리 전용). 긴 이력은 서버가 갖고 있고, 관제웹이 그것을 본다.
 *   워치 화면의 목적은 "지금 오르고 있나" 이지 하루치 회고가 아니다.
 *
 * @param windowMs 창 길이. 지표마다 다르다 — 심박은 촘촘하고 SpO₂ 는 5분 주기라 더 길게 본다.
 * @param maxPoints 상한. 창이 길어도 점이 화면 폭보다 많으면 의미가 없다.
 */
class MetricHistory(
    val windowMs: Long,
    private val maxPoints: Int = 240,
) {
    /**
     * 점 사이 최소 간격 = 창 ÷ 상한.
     *
     * ⚠ **이것이 없으면 창이 조용히 짧아진다.** 심박이 1초에 한 번 들어오면 240점 상한이
     *   4분 만에 차고, 15분 창이라 적어 둔 차트가 실제로는 최근 4분만 보여 준다.
     *   들어오는 속도를 모르는 채로도 창을 지키려면 **간격을 코드가 강제해야** 한다.
     */
    private val minGapMs: Long = (windowMs / maxPoints).coerceAtLeast(1L)

    private val points = ArrayDeque<Sample>()

    /** 현재 간격의 시작 시각 — 대표값의 시각과 **따로** 둔다(같이 쓰면 간격이 안 닫힌다). */
    private var bucketStartMs = 0L

    /**
     * 현재 간격의 첫 값 — "얼마나 튀는가" 를 재는 기준.
     * ⚠ 기준을 대표값 자신으로 두면 비교가 자기 자신과의 거리(=0)가 되어,
     *   방금 살린 봉우리를 바로 다음 평범한 표본이 밀어낸다.
     */
    private var bucketFirst = 0.0

    /** 현재 간격의 대표값. 아직 확정 전이지만 조회에는 포함된다(끝점이 '지금' 이어야 한다). */
    private var pending: Sample? = null

    /**
     * 표본 추가.
     *
     * ★ 한 간격 안에 여러 표본이 오면 **평균이 아니라 가장 튀는 값**을 남긴다.
     *   평균을 내면 임계를 넘긴 순간이 지워진다 — 안전 데이터에서 가장 하면 안 되는 일이다.
     */
    @Synchronized
    fun add(atMs: Long, value: Double) {
        val p = pending
        if (p == null) {
            bucketStartMs = atMs
            bucketFirst = value
            pending = Sample(atMs, value)
            return
        }
        if (atMs - bucketStartMs < minGapMs) {
            val ref = points.lastOrNull()?.value ?: bucketFirst
            if (kotlin.math.abs(value - ref) > kotlin.math.abs(p.value - ref)) {
                pending = Sample(atMs, value)
            }
            return
        }
        push(p)
        bucketStartMs = atMs
        bucketFirst = value
        pending = Sample(atMs, value)
    }

    /** 확정 점 적재 — 창 밖은 버린다(상한 겸용). */
    private fun push(s: Sample) {
        points.addLast(s)
        while (points.isNotEmpty() && s.atMs - points.first().atMs > windowMs) points.removeFirst()
        while (points.size > maxPoints) points.removeFirst()
    }

    /** 확정 점 + 대표값. 시간순이 보장된다(대표값은 항상 마지막 확정 점보다 늦다). */
    @Synchronized
    fun snapshot(): List<Sample> {
        val p = pending ?: return points.toList()
        return ArrayList<Sample>(points.size + 1).apply { addAll(points); add(p) }
    }

    @Synchronized
    fun clear() {
        points.clear()
        pending = null
        bucketStartMs = 0L
        bucketFirst = 0.0
    }

    /** 창 안 최소·최대 — 차트 세로축을 값에 맞춰 늘리는 데 쓴다(고정 축이면 변화가 안 보인다). */
    @Synchronized
    fun range(): Pair<Double, Double>? {
        val all = snapshotLocked()
        if (all.isEmpty()) return null
        return all.minOf { it.value } to all.maxOf { it.value }
    }

    @Synchronized
    fun latest(): Double? = pending?.value ?: points.lastOrNull()?.value

    @Synchronized
    fun size(): Int = points.size + (if (pending == null) 0 else 1)

    private fun snapshotLocked(): List<Sample> =
        pending?.let { points + it } ?: points.toList()
}

/**
 * 지표별 창 길이 — **수집 주기에 맞춘다.**
 * 촘촘한 지표에 긴 창을 주면 점이 뭉치고, 성긴 지표에 짧은 창을 주면 점이 두어 개뿐이다.
 */
object HistoryWindow {
    /** 심박 — 상시 수집. 15분 ÷ 240점 = 약 3.8초마다 한 점으로 솎인다. */
    const val HEART_MS = 15 * 60_000L
    /** SpO₂ — 5분 주기 단발이라 1시간을 봐야 점이 12개다. */
    const val SPO2_MS = 60 * 60_000L
    /** 피부온·주변온 — 상시지만 천천히 변한다. 발열 판별에는 30분이 필요하다([[R-25]]). */
    const val TEMP_MS = 30 * 60_000L
    /** 스트레스 — 활동 배치가 성기므로 길게 본다. */
    const val STRESS_MS = 30 * 60_000L
    /** 걸음 — 근무 흐름을 보려면 길게. 누계라 값이 뒤로 가지 않는다. */
    const val STEPS_MS = 60 * 60_000L
}
