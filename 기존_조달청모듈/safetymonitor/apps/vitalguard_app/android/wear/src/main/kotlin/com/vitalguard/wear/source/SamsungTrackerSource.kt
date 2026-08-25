// 삼성 Sensor SDK 실소스 — SpO₂·피부온·주변온·IBI 는 이 경로로만 온다(순정 SensorManager 엔 없다)
package com.vitalguard.wear.source

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.samsung.android.service.health.tracking.ConnectionListener
import com.samsung.android.service.health.tracking.HealthTracker
import com.samsung.android.service.health.tracking.HealthTrackerException
import com.samsung.android.service.health.tracking.HealthTrackingService
import com.samsung.android.service.health.tracking.data.DataPoint
import com.samsung.android.service.health.tracking.data.HealthTrackerType
import com.samsung.android.service.health.tracking.data.ValueKey

/**
 * 실측 ②③(08-24)에서 이 워치가 트래커 **21종 전량**을 지원함을 확인했다.
 * 그중 이 트랙이 쓰는 셋만 붙인다 —
 *   · `HEART_RATE_CONTINUOUS`      상시. HR + **IBI_LIST**(HRV 원재료)
 *   · `SKIN_TEMPERATURE_CONTINUOUS` 상시. 피부온 + **주변온**(애플에 없는 신호)
 *   · `SPO2_ON_DEMAND`             단발. 주기 호출로 iOS 의 산발 측정과 동등 이상(R-01)
 *
 * ⚠ **파트너 미승인이면 트래커 시작에서 `SDK_POLICY_ERROR` 가 난다.** 그때는 개발자 모드
 *   (설정 > 앱 > Health Sensor Service > 제목 10회 탭)로 넘긴다. 오류를 삼키지 않고 로그에 남긴다.
 * ⚠ 연결·트래커 시작이 실패해도 **수집 전체가 죽으면 안 된다** — 심박은 순정 소스가 계속 낸다.
 */
class SamsungTrackerSource(
    private val context: Context,
    /** SpO₂ 주기. 확정값이 아니다 — 실측 ⑦(백그라운드 성공률) 뒤 3단계에서 정한다(R-08). */
    private val spo2IntervalMs: Long = 5 * 60_000,
) : TrackerSource {

    private var service: HealthTrackingService? = null
    private var hrTracker: HealthTracker? = null
    private var tempTracker: HealthTracker? = null
    private var spo2Tracker: HealthTracker? = null
    private var listener: TrackerListener? = null
    private val handler = Handler(Looper.getMainLooper())

    override fun start(listener: TrackerListener) {
        this.listener = listener
        val connection = object : ConnectionListener {
            override fun onConnectionSuccess() {
                val svc = service ?: return
                startContinuous(svc)
                handler.post(spo2Tick)
                Log.i(TAG, "삼성 SDK 연결 — 상시 트래커 기동")
            }

            override fun onConnectionEnded() {
                Log.i(TAG, "삼성 SDK 연결 종료")
            }

            override fun onConnectionFailed(e: HealthTrackerException) {
                // 삼키지 않는다 — 08-24 에 삼킨 예외가 원인을 몇 시간 숨겼다(R-13).
                Log.w(TAG, "삼성 SDK 연결 실패 code=${e.errorCode} " +
                    "(미승인 서명이면 개발자 모드 필요) · 심박은 순정 소스가 계속 낸다")
            }
        }
        runCatching {
            service = HealthTrackingService(connection, context).also { it.connectService() }
        }.onFailure { Log.w(TAG, "삼성 SDK 서비스 생성 실패: $it") }
    }

    private fun startContinuous(svc: HealthTrackingService) {
        hrTracker = track(svc, HealthTrackerType.HEART_RATE_CONTINUOUS) { dp ->
            val bpm = dp.getValue(ValueKey.HeartRateSet.HEART_RATE) ?: return@track
            val hrStatus = dp.getValue(ValueKey.HeartRateSet.HEART_RATE_STATUS)
            val ibi = dp.getValue(ValueKey.HeartRateSet.IBI_LIST) ?: emptyList()
            val ibiStatus = dp.getValue(ValueKey.HeartRateSet.IBI_STATUS_LIST) ?: emptyList()
            // ⚠ 상태가 정상이 아니면 bpm 이 0 이거나 신뢰 못 할 값이다 — 싣지 않는다.
            //   다만 **왜 안 실렸는지는 남긴다**(무음 실패 금지 · R-13).
            if (bpm > 0 && (hrStatus == null || hrStatus >= 0)) {
                hrSeen++
                if (hrSeen % 30 == 1) Log.i(TAG, "삼성 심박 $bpm bpm (status=$hrStatus · IBI ${ibi.size}개)")
                // 시각은 **벽시계로 통일** — DataPoint.timestamp 의 기준이 기기마다 다를 수 있다.
                listener?.onHeartRate(bpm, ibi, ibiStatus, System.currentTimeMillis())
            } else {
                hrRejected++
                if (hrRejected % 30 == 1) Log.w(TAG, "삼성 심박 미채택 bpm=$bpm status=$hrStatus (착용 확인)")
            }
        }
        tempTracker = track(svc, HealthTrackerType.SKIN_TEMPERATURE_CONTINUOUS) { dp ->
            val obj = dp.getValue(ValueKey.SkinTemperatureSet.OBJECT_TEMPERATURE) ?: return@track
            val ambient = dp.getValue(ValueKey.SkinTemperatureSet.AMBIENT_TEMPERATURE)
            Log.i(TAG, "삼성 피부온 ${obj}℃ · 주변 ${ambient}℃")
            listener?.onSkinTemp(obj.toDouble(), ambient?.toDouble(), System.currentTimeMillis())
        }
    }

    /** SpO₂ 는 단발이라 주기로 켰다 끈다 — 상시 트래커가 없기 때문이다(AAR 열거형 실측 확인). */
    private val spo2Tick = object : Runnable {
        override fun run() {
            val svc = service
            if (svc != null && spo2Tracker == null) {
                spo2Tracker = track(svc, HealthTrackerType.SPO2_ON_DEMAND) { dp ->
                    val pct = dp.getValue(ValueKey.SpO2Set.SPO2)
                    val status = dp.getValue(ValueKey.SpO2Set.STATUS)
                    // 측정 완료 상태에서만 싣는다 — 계산 중(진행값)을 실으면 가짜 값이 올라간다.
                    if (pct != null && pct > 0 && status == SPO2_STATUS_COMPLETE) {
                        listener?.onSpo2(pct, dp.timestamp)
                        stopSpo2()
                    }
                }
            }
            handler.postDelayed(this, spo2IntervalMs)
        }
    }

    private fun stopSpo2() {
        runCatching { spo2Tracker?.unsetEventListener() }
        spo2Tracker = null
    }

    private fun track(
        svc: HealthTrackingService,
        type: HealthTrackerType,
        onPoint: (DataPoint) -> Unit,
    ): HealthTracker? = runCatching {
        svc.getHealthTracker(type).apply {
            setEventListener(object : HealthTracker.TrackerEventListener {
                override fun onDataReceived(points: List<DataPoint>) = points.forEach(onPoint)
                override fun onFlushCompleted() = Unit
                override fun onError(error: HealthTracker.TrackerError) {
                    Log.w(TAG, "$type 오류: $error" +
                        if (error == HealthTracker.TrackerError.SDK_POLICY_ERROR)
                            " — 파트너 미승인. 개발자 모드를 켜십시오." else "")
                }
            })
        }
    }.onFailure { Log.w(TAG, "$type 시작 실패: $it") }.getOrNull()

    override fun stop() {
        handler.removeCallbacks(spo2Tick)
        listOf(hrTracker, tempTracker, spo2Tracker).forEach { t ->
            runCatching { t?.unsetEventListener() }
        }
        hrTracker = null; tempTracker = null; spo2Tracker = null
        runCatching { service?.disconnectService() }
        service = null
        listener = null
    }

    private var hrSeen = 0
    private var hrRejected = 0

    companion object {
        const val TAG = "VgSamsung"
        /** SpO₂ STATUS — 측정 완료. 그 외(계산 중·실패)는 싣지 않는다. */
        private const val SPO2_STATUS_COMPLETE = 2
    }
}
