// TrackerSource 실구현 1호 — 순정 wake-up 심박 + 선형가속도. 삼성 SDK 실패 시에도 도는 대조군이다
package com.vitalguard.wear.source

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

/**
 * 삼성 Sensor SDK 소스(3-2 예정)와 같은 심에 꽂히는 프레임워크 소스. IBI 는 순정 API 에
 * 없으므로 빈 목록 — HRV 는 삼성 소스에서만 나온다(그 격차가 곧 삼성 SDK 의 존재 이유다).
 */
class SensorTrackerSource(context: Context) : TrackerSource, SensorEventListener {

    private val manager = context.getSystemService(SensorManager::class.java)
    private var listener: TrackerListener? = null

    override fun start(listener: TrackerListener) {
        this.listener = listener
        // wake-up(true) 이어야 화면 꺼짐에서도 온다 — 프로브 ⑤와 같은 계약.
        manager.getDefaultSensor(Sensor.TYPE_HEART_RATE, true)?.let {
            manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
        // 선형가속도 = 중력 제거값 — iOS userAcceleration 과 같은 의미라 0.03g 임계가 그대로 선다.
        (manager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION, true)
            ?: manager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION))?.let {
            manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
    }

    override fun stop() {
        manager.unregisterListener(this)
        listener = null
    }

    /**
     * ★ 측정 시각은 **도착 시각이 아니라 `event.timestamp`** 다 (2026-08-24 실측이 강제한 수정).
     *
     * wake-up 센서는 화면이 꺼지면 표본을 센서 허브 FIFO 에 모았다가 CPU 가 깰 때 몰아서 준다.
     * 12.2분 시험에서 219초 공백 뒤 221건이 2초 안에 쏟아졌다(공백 초 = 직후 건수, 5회 모두 일치).
     * 유실은 0이었지만, 도착 시각을 측정 시각으로 쓰면 그 221건이 **전부 같은 순간에 잰 값**이 되어
     * 최대 3.7분이 어긋난다. 서버 계약이 `heartRateMeasuredAt` 을 따로 두는 이유가 정확히 이것이다.
     *
     * `event.timestamp` 는 부팅 후 경과 나노초(elapsedRealtimeNanos 기준)라 벽시계로 환산한다.
     */
    private fun eventWallClockMs(event: SensorEvent): Long =
        System.currentTimeMillis() - (android.os.SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000L

    override fun onSensorChanged(event: SensorEvent) {
        val l = listener ?: return
        val atMs = eventWallClockMs(event)
        when (event.sensor.type) {
            Sensor.TYPE_HEART_RATE -> {
                val bpm = event.values[0].toInt()
                if (bpm > 0) l.onHeartRate(bpm, emptyList(), emptyList(), atMs)
            }
            Sensor.TYPE_LINEAR_ACCELERATION -> {
                val (x, y, z) = event.values
                val magG = Math.sqrt((x * x + y * y + z * z).toDouble()) / SensorManager.GRAVITY_EARTH
                l.onAccelMagG(magG, atMs)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
