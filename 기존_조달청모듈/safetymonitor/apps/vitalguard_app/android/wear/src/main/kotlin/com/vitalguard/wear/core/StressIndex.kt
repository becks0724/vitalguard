// 스트레스 지수 — 서버 packages/analyzers/src/stress-index.ts 의 **같은 공식·같은 상수** 이식
package com.vitalguard.wear.core

import kotlin.math.exp
import kotlin.math.roundToInt

/** 활동 상태 — 스트레스와 심박 작업게이트가 공유하는 단일 분류(서버와 같은 뜻). */
enum class ActivityState { REST, LIGHT, HEAVY }

data class StressResult(
    val calibrating: Boolean,
    val index: Int?,
    val level: Severity,
    val activity: ActivityState?,
)

/**
 * ⚠ **손으로 옮긴 사본이다**([[L-106]] ①). 서버가 공식·상수를 바꾸면 여기도 갈린다.
 * 3단계 F 에서 두 파일의 숫자를 대조하는 가드를 세운다. 지금은 시험이 값으로 못 박는다.
 *
 * 왜 워치가 직접 계산하나 — 서버 `me/vitals` 는 조회 시점에 60초 신선도 게이트를 통과해야
 * 지수를 내는데(R-14), 워치 flush 가 60초라 **조회 타이밍에 따라 꺼진다.**
 * 화면은 방금 잰 값을 들고 있으므로 직접 계산하는 편이 정확하고 즉시성이 있다.
 */
object Stress {

    // population reference — 개인 baseline 이 없을 때 fallback(서버와 같은 값).
    const val HRV_MEAN = 50.0
    const val HRV_STD = 18.0
    const val HR_REST = 68.0
    const val HR_LIGHT = 95.0
    const val HR_HEAVY = 125.0
    const val RESPIRATORY = 14.0

    // 활동지수 가중치·임계
    private const val W_ENERGY = 1.0
    private const val W_STEPS = 0.5
    private const val W_FLIGHTS = 2.0
    private const val TH_REST = 2.5
    private const val TH_HIGH = 6.0

    // 신호 결합 가중치 + 로지스틱 스케일
    private const val A = 0.5
    private const val B = 0.4
    private const val C = 0.1
    private const val K = 1.2
    private const val RAW_MID = 1.5

    /** 활동별 HRV 신뢰도 — 움직임이 많으면 HRV 가 부정확해 신호1 비중을 줄인다. */
    private fun hrvConfidence(a: ActivityState) = when (a) {
        ActivityState.REST -> 1.0
        ActivityState.LIGHT -> 0.5
        ActivityState.HEAVY -> 0.2
    }

    /** 지수 → 레벨. 서버는 <40 정상 / 40~69 주의 / ≥70 위험. */
    const val LEVEL_CAUTION = 40
    const val LEVEL_DANGER = 70

    /** 계기 축 — 지수 스케일 그대로 0~100. */
    const val GAUGE_MAX = 100.0

    private fun clip(x: Double, lo: Double, hi: Double) = x.coerceIn(lo, hi)

    /** 활동 분류 — 셋 다 없으면 null(데이터 전무). 서버 `classifyActivity` 와 같은 식. */
    fun classifyActivity(kcal: Double?, steps: Int?, floors: Int?): ActivityState? {
        if (kcal == null && steps == null && floors == null) return null
        val a = W_ENERGY * (kcal ?: 0.0) +
            W_STEPS * ((steps ?: 0) / 100.0) +
            W_FLIGHTS * (floors ?: 0)
        return when {
            a < TH_REST -> ActivityState.REST
            a < TH_HIGH -> ActivityState.LIGHT
            else -> ActivityState.HEAVY
        }
    }

    /**
     * 스트레스 지수 0~100.
     * **보정 중 조건** — HRV 도 없고 (심박+활동맥락)도 없으면 계산하지 않는다(index=null).
     */
    fun compute(
        heartRate: Int?,
        hrvSdnnMs: Double?,
        activeEnergyKcal: Double?,
        steps: Int?,
        floors: Int?,
        restingHeartRate: Double? = null,
        walkingHeartRate: Double? = null,
        respiratoryRate: Double? = null,
    ): StressResult {
        val activity = classifyActivity(activeEnergyKcal, steps, floors)
        val hasHrv = hrvSdnnMs != null
        val hasExcess = heartRate != null && activity != null
        if (!hasHrv && !hasExcess) {
            return StressResult(calibrating = true, index = null, level = Severity.IDLE, activity = activity)
        }
        // 활동 데이터가 없으면 rest 가정(보수적) — 서버와 같은 처리.
        val act = activity ?: ActivityState.REST

        val zHrv = if (hasHrv) (HRV_MEAN - hrvSdnnMs!!) / HRV_STD else 0.0

        var zHr = 0.0
        if (heartRate != null) {
            val expected = when (act) {
                ActivityState.REST -> restingHeartRate ?: HR_REST
                ActivityState.LIGHT -> walkingHeartRate ?: HR_LIGHT
                ActivityState.HEAVY -> HR_HEAVY
            }
            val excess = heartRate - expected
            zHr = if (excess > 0) excess / expected else 0.0
        }

        val zRr = if (respiratoryRate != null) (respiratoryRate - RESPIRATORY) / RESPIRATORY else 0.0

        val conf = hrvConfidence(act)
        val aEff = A * conf
        val bEff = B + (A - aEff)   // 줄인 만큼 신호2 로 재분배

        val raw = aEff * clip(zHrv, 0.0, 3.0) +
            bEff * clip(zHr, 0.0, 0.5) * 6 +
            C * clip(zRr, 0.0, 0.5) * 6

        val index = (100.0 / (1.0 + exp(-K * (raw - RAW_MID)))).roundToInt()
        val level = when {
            index >= LEVEL_DANGER -> Severity.DANGER
            index >= LEVEL_CAUTION -> Severity.CAUTION
            else -> Severity.NORMAL
        }
        return StressResult(calibrating = false, index = index, level = level, activity = act)
    }
}
