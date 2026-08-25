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
            val steps = stepPts.sumOf { it.value }.toInt()
            val floors = floorPts.sumOf { it.value }.toInt()
            val kcal = kcalPts.sumOf { it.value }
            seen++
            if (seen % 3 == 1) {
                Log.i(
                    TAG,
                    "도착[$arrived] 걸음${stepPts.size}건=$steps · 층${floorPts.size}건=$floors · " +
                        "칼로리${kcalPts.size}건=${"%.2f".format(kcal)}",
                )
            }
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
            .setDataTypes(setOf(DataType.STEPS, DataType.FLOORS, DataType.CALORIES))
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

    companion object {
        const val TAG = "VgActivity"
    }
}
