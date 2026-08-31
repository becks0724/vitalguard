// 착용 감지 — 차면 수집 시작, 벗으면 중지. 버튼 없는 운용의 근거가 되는 센서다
package com.vitalguard.wear.source

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log

/**
 * 기기 실측(08-25 · SM-L355N) —
 * ```
 * offbody_detect  Wakeup | type: android.sensor.low_latency_offbody_detect(34) | perm: n/a
 * ```
 * ★ **권한이 필요 없고(perm: n/a) wake-up 이라 화면이 꺼져도 온다.** 그래서 착용 상태를
 *   근거로 수집을 켜고 끄는 운용이 성립한다.
 *
 * 값 규약 — `1.0` 착용 / `0.0` 미착용 (Android 표준 TYPE_LOW_LATENCY_OFFBODY_DETECT).
 */
class OffBodySource(context: Context) : SensorEventListener {

    private val manager = context.getSystemService(SensorManager::class.java)
    private val sensor: Sensor? =
        manager.getDefaultSensor(Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT, true)
            ?: manager.getDefaultSensor(Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT)

    /** 센서가 없으면 판단 불가 — 그때는 **항상 착용으로 본다**(수집이 멎는 쪽보다 안전). */
    val supported: Boolean get() = sensor != null

    @Volatile
    var worn: Boolean = true
        private set

    /**
     * 첫 실측 이벤트가 왔는가 — 오기 전의 `worn=true` 는 **기본값이지 관측이 아니다.**
     * 자동 로그아웃이 이 구별로 "재시작 직후의 기본값" 을 착용 증거로 오독하지 않는다.
     */
    @Volatile
    var observed: Boolean = false
        private set

    private var onChange: ((Boolean) -> Unit)? = null

    fun start(onChange: (Boolean) -> Unit) {
        this.onChange = onChange
        val s = sensor
        if (s == null) {
            Log.w(TAG, "착용 감지 센서 없음 — 항상 착용으로 간주한다")
            return
        }
        manager.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL)
        Log.i(TAG, "착용 감지 시작 (wakeUp=${s.isWakeUpSensor})")
    }

    fun stop() {
        manager.unregisterListener(this)
        onChange = null
    }

    override fun onSensorChanged(event: SensorEvent) {
        val nowWorn = event.values.firstOrNull()?.let { it >= 0.5f } ?: return
        observed = true
        if (nowWorn != worn) {
            worn = nowWorn
            Log.i(TAG, if (nowWorn) "착용 감지 — 수집 시작" else "벗음 감지 — 수집 중지")
            onChange?.invoke(nowWorn)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    companion object {
        const val TAG = "VgOffBody"
    }
}
