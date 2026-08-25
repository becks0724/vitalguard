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
    /** 실패 뒤 재시도 간격 — 정지 순간을 잡으려면 5분은 너무 성기다(08-25 실기 0건). */
    private val spo2RetryMs: Long = 2 * 60_000,
) : TrackerSource {

    private var service: HealthTrackingService? = null
    private var hrTracker: HealthTracker? = null
    private var tempTracker: HealthTracker? = null
    private var spo2Tracker: HealthTracker? = null
    private var listener: TrackerListener? = null
    private val handler = Handler(Looper.getMainLooper())

    override fun start(listener: TrackerListener) {
        this.listener = listener
        wornAtMs = System.currentTimeMillis()
        tempSeen = 0
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
                if (hrSeen % 3 == 1) {
                    Log.i(TAG, "삼성 심박 $bpm bpm (status=$hrStatus · IBI=$ibi · IBIstatus=$ibiStatus)")
                }
                // 시각은 **벽시계로 통일** — DataPoint.timestamp 의 기준이 기기마다 다를 수 있다.
                listener?.onHeartRate(bpm, ibi, ibiStatus, System.currentTimeMillis())
            } else {
                hrRejected++
                if (hrRejected % 30 == 1) Log.w(TAG, "삼성 심박 미채택 bpm=$bpm status=$hrStatus (착용 확인)")
            }
        }
        // ★ 상시 트래커는 그대로 두되 **화면·전송에 쓰는 표본만 솎는다**(08-25 발열 완화).
        //   센서를 껐다 켜면 재안정에 시간이 걸려 값이 더 나빠진다 — 대신 처리 빈도를 줄인다.
        tempTracker = track(svc, HealthTrackerType.SKIN_TEMPERATURE_CONTINUOUS) { dp ->
            val obj = dp.getValue(ValueKey.SkinTemperatureSet.OBJECT_TEMPERATURE) ?: return@track
            val ambient = dp.getValue(ValueKey.SkinTemperatureSet.AMBIENT_TEMPERATURE)
            // ★ 착용 직후 상승 곡선을 잡으려면 매 표본을 찍어야 한다(08-25 발열 판별 실험).
            //   피부온과 주변온이 **함께** 오르면 기기 발열, 피부온만 오르면 실제 체온이다.
            tempSeen++
            // 로그는 발열 실험 때 매 표본이 필요했다. 평시엔 5개당 1개면 충분하다.
            if (tempSeen % 5 == 1) Log.i(
                TAG,
                "피부온 ${"%.2f".format(obj)}℃ · 주변 ${"%.2f".format(ambient ?: 0f)}℃ " +
                    "· 착용후 ${(System.currentTimeMillis() - wornAtMs) / 1000}초 · #$tempSeen",
            )
            listener?.onSkinTemp(obj.toDouble(), ambient?.toDouble(), System.currentTimeMillis())
        }
    }

    /**
     * SpO₂ 는 단발이라 주기로 켰다 끈다 — 상시 트래커가 없기 때문이다(AAR 열거형 실측 확인).
     *
     * ⚠⚠ **08-25 실기 결함 — 시도가 앱 수명에 한 번뿐이었다.**
     *   종전 조건이 `spo2Tracker == null` 이라, 측정이 완료되지 않으면(움직임·접촉 불량)
     *   트래커가 null 로 안 돌아오고 **다음 주기가 통째로 건너뛰어졌다.** 완료됐을 때만
     *   `stopSpo2()` 를 불렀기 때문이다. 결과 = 연속 착용 35분에 SpO₂ 0건(서버 16행 전부 null).
     *   ⟹ 주기마다 **지난 시도를 먼저 걷어내고** 새로 시작한다. 시도에는 마감 시한을 둔다.
     */
    private val spo2Tick = object : Runnable {
        override fun run() {
            val svc = service
            if (svc != null) {
                // 지난 시도가 살아 있으면 실패로 닫는다 — 붙잡고 있으면 다음이 영영 안 온다.
                if (spo2Tracker != null) {
                    Log.i(TAG, "SpO₂ 시도 만료 — 미완료로 닫는다(시도 $spo2Attempts · 성공 $spo2Success)")
                    stopSpo2()
                }
                spo2Attempts++
                spo2LastStatus = null
                spo2Tracker = track(svc, HealthTrackerType.SPO2_ON_DEMAND) { dp ->
                    val pct = dp.getValue(ValueKey.SpO2Set.SPO2)
                    val status = dp.getValue(ValueKey.SpO2Set.STATUS)
                    // ★ 상태가 바뀔 때마다 남긴다 — 종전엔 실패가 **어디에도 안 남아**
                    //   "왜 안 오는가" 를 코드를 읽어야만 알 수 있었다([[L-112]]).
                    if (status != spo2LastStatus) {
                        spo2LastStatus = status
                        Log.i(TAG, "SpO₂ 상태=$status 값=$pct (시도 $spo2Attempts)")
                    }
                    // 측정 완료 상태에서만 싣는다 — 계산 중(진행값)을 실으면 가짜 값이 올라간다.
                    // ⚠ 완료 표본이 연달아 올 수 있다(실기 17:27 에 2건 연속) — 트래커를 이미
                    //   닫았으면 세지 않는다. 안 그러면 성공률(실측 ⑦)이 부풀려진다.
                    if (pct != null && pct > 0 && status == SPO2_STATUS_COMPLETE && spo2Tracker != null) {
                        spo2Success++
                        Log.i(TAG, "SpO₂ 성공 $pct% (시도 $spo2Attempts · 성공 $spo2Success)")
                        listener?.onSpo2(pct, dp.timestamp)
                        stopSpo2()
                        // 성공했으면 다음은 정상 주기로.
                        handler.removeCallbacks(this)
                        handler.postDelayed(this, spo2IntervalMs)
                    }
                }
            }
            // ⚠ 실패 뒤에는 **짧게** 다시 시도한다. 삼성 SpO₂ 는 정지·밀착을 요구해서
            //   작업 중에는 대부분 실패한다 — 5분 주기로는 '가만히 있는 순간' 을 놓친다.
            handler.postDelayed(this, spo2NextDelayMs(spo2Success, spo2IntervalMs, spo2RetryMs))
        }
    }

    private fun stopSpo2() {
        runCatching { spo2Tracker?.unsetEventListener() }
        spo2Tracker = null
    }

    /** 시도·성공 횟수 — 성공률을 로그 한 줄로 판정하기 위한 계기(실측 ⑦). */
    private var spo2Attempts = 0
    private var spo2Success = 0
    private var spo2LastStatus: Int? = null

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
    private var tempSeen = 0
    /** 착용(수집 시작) 시각 — 온도 상승 곡선의 기준점. */
    private var wornAtMs = System.currentTimeMillis()

    companion object {
        const val TAG = "VgSamsung"
        /** SpO₂ STATUS — 측정 완료. 그 외(계산 중·실패)는 싣지 않는다. */
        private const val SPO2_STATUS_COMPLETE = 2

        /**
         * 다음 시도까지의 간격.
         *
         * ⚠ 아직 한 번도 성공한 적이 없으면 **짧게** 다시 시도한다. 삼성 SpO₂ 는 정지·밀착을
         *   요구해 작업 중에는 대부분 실패하는데, 5분 주기로는 '가만히 있는 순간' 을 놓친다
         *   (08-25 실기 = 연속 착용 35분에 0건).
         */
        internal fun spo2NextDelayMs(success: Int, intervalMs: Long, retryMs: Long): Long =
            if (success > 0) intervalMs else retryMs
    }
}
