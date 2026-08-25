// 활동 수집 — 걸음·층·칼로리. 스트레스 지수와 심박 작업게이트의 재료다(승인 불필요 경로)
package com.vitalguard.wear.source

import android.content.Context
import android.util.Log
import androidx.health.services.client.HealthServices
import androidx.health.services.client.PassiveListenerCallback
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.PassiveListenerConfig

/**
 * Health Services `PassiveMonitoringClient` 로 활동 3종을 받는다.
 *
 * ★ 왜 이 경로인가(실측 ④, 08-24) — `STEPS`·`FLOORS`·`CALORIES` 는 **전 Wear OS 기기 보장**이고
 *   **삼성 파트너 승인이 필요 없다.** 삼성 SDK 가 개발자 모드에 묶여 있는 것과 대조된다.
 *
 * ★ Delta 타입을 쓴다 — `STEPS_TOTAL`(누적)이 아니라 `STEPS`(구간 증분).
 *   서버 상한이 구간 값 기준이라 누적을 보내면 스트립된다.
 *
 * ⚠ 배치로 온다 — MCU 에 모았다가 간헐 전달한다([[R-12]] 의 그 거동). 그래서 도착 시각이
 *   아니라 **증분의 합**만 의미가 있고, flush 가 그 합을 소비한다.
 */
class ActivitySource(private val context: Context) : TrackerSource {

    private val client = HealthServices.getClient(context).passiveMonitoringClient
    private var listener: TrackerListener? = null
    private var registered = false

    private val callback = object : PassiveListenerCallback {
        override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
            // ⚠ 어떤 DataType 이 실제로 오는지 먼저 본다 — 걸음이 0 일 때 "안 온 것" 인지
            //   "0 으로 온 것" 인지 구별해야 한다(무음 실패를 값으로 가른다).
            val arrived = dataPoints.dataTypes.joinToString { it.name }
            val stepPts = dataPoints.getData(DataType.STEPS)
            val floorPts = dataPoints.getData(DataType.FLOORS)
            val kcalPts = dataPoints.getData(DataType.CALORIES)
            // ★ DAILY 병행 구독(08-25) — 이 기기는 `STEPS` 를 안 보내고 `Calories` 만 왔다
            //   (실측: `도착[Calories] 걸음0건`). DAILY 계열은 **오늘 자정 이후 누계**를
            //   값으로 주므로 그대로 더하면 누적이 된다 — 직전 누계와의 **차이**만 쓴다.
            //   ⚠ 자정을 넘으면 누계가 0 으로 리셋된다. 그때 음수 증분이 나오므로 버린다.
            val stepDaily = dataPoints.getData(DataType.STEPS_DAILY).maxOfOrNull { it.value }
            val floorDaily = dataPoints.getData(DataType.FLOORS_DAILY).maxOfOrNull { it.value }

            val steps = stepPts.sumOf { it.value }.toInt()
                .takeIf { it > 0 } ?: dailyDelta(stepDaily?.toDouble(), lastStepDaily) { lastStepDaily = it }
            val floors = floorPts.sumOf { it.value }.toInt()
                .takeIf { it > 0 } ?: dailyDelta(floorDaily, lastFloorDaily) { lastFloorDaily = it }
            val kcal = kcalPts.sumOf { it.value }
            seen++
            if (seen % 3 == 1) {
                Log.i(
                    TAG,
                    "도착[$arrived] 걸음${stepPts.size}건=$steps · 층${floorPts.size}건=$floors · " +
                        "칼로리${kcalPts.size}건=${"%.2f".format(kcal)}",
                )
            }
            // 누계는 증분과 **따로** 흘린다 — 증분이 0 인 배치에도 누계는 갱신돼야 한다.
            listener?.onDailyTotals(stepDaily?.toInt(), floorDaily?.toInt())
            if (steps == 0 && floors == 0 && kcal <= 0.0) return
            listener?.onActivityDelta(steps, floors, kcal, System.currentTimeMillis())
        }

        override fun onPermissionLost() {
            // 삼키지 않는다 — 백그라운드 권한이 빠지면 여기로만 알 수 있다(R-13 규율).
            Log.w(TAG, "활동 권한 상실 — 설정에서 '항상 허용' 확인 필요")
        }
    }

    override fun start(listener: TrackerListener) {
        this.listener = listener
        val config = PassiveListenerConfig.Builder()
            // 구간형(STEPS)과 누계형(STEPS_DAILY)을 **둘 다** 구독한다 — 기기마다 무엇을
            // 보내는지 다르고, 실측에서 이 워치는 구간형 걸음을 안 보냈다.
            .setDataTypes(
                setOf(
                    DataType.STEPS, DataType.FLOORS, DataType.CALORIES,
                    DataType.STEPS_DAILY, DataType.FLOORS_DAILY,
                ),
            )
            .build()
        runCatching {
            client.setPassiveListenerCallback(config, callback)
            registered = true
            Log.i(TAG, "활동 수집 시작 (걸음·층·칼로리)")
        }.onFailure { Log.w(TAG, "활동 수집 시작 실패: $it") }
    }

    override fun stop() {
        if (registered) {
            runCatching { client.clearPassiveListenerCallbackAsync() }
            registered = false
        }
        listener = null
    }

    private var seen = 0
    /** DAILY 누계의 직전 값 — 증분을 뽑는 기준점. null = 아직 기준이 없다(첫 표본은 버린다). */
    private var lastStepDaily: Double? = null
    private var lastFloorDaily: Double? = null

    /**
     * 누계 → 증분. **첫 표본은 0 을 낸다** — 기준점이 없으면 "오늘 걸은 전부" 가 한 번에
     * 실려 서버 상한(steps 5000)에 걸린다. 자정 리셋(음수)도 버리고 기준만 갱신한다.
     */
    private inline fun dailyDelta(now: Double?, prev: Double?, save: (Double) -> Unit): Int {
        if (now == null) return 0
        save(now)
        if (prev == null) return 0
        val d = now - prev
        return if (d > 0) d.toInt() else 0
    }

    companion object {
        const val TAG = "VgActivity"
    }
}
