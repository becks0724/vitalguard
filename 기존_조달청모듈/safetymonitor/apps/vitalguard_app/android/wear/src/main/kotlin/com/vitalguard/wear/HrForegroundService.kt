// 실측 ⑤ — wake-up 심박 + FGS(health) 로 화면 꺼짐 생존을 검증한다. 60초 규칙(삼성 명시)이 피검 대상.
package com.vitalguard.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.IBinder
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class HrForegroundService : Service(), SensorEventListener {

    private lateinit var sensorManager: SensorManager
    private var hrSensor: Sensor? = null
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.KOREA)

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(CH, "심박 수집", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        sensorManager = getSystemService(SensorManager::class.java)
        // ★ 두 번째 인자 true = wake-up 버전. false 면 화면 꺼질 때 센서도 같이 멈춘다.
        hrSensor = sensorManager.getDefaultSensor(Sensor.TYPE_HEART_RATE, true)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 삼성 60초 규칙 — 포그라운드 승격은 시작 즉시. 늦으면 화면 꺼짐 60초 뒤 앱이 정지된다.
        val notification = Notification.Builder(this, CH)
            .setContentTitle("VG 심박 프로브 수집 중")
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .build()
        startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)

        val sensor = hrSensor
        if (sensor == null) {
            log("wake-up 심박 센서 없음 — 생존 시험 불가")
        } else {
            sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL)
            log("수집 시작 (wakeUp=${sensor.isWakeUpSensor})")
        }
        return START_STICKY
    }

    override fun onSensorChanged(event: SensorEvent) {
        samples++
        // 판독은 타임스탬프 연속성으로 한다 — 화면 꺼짐 구간에 공백이 있으면 생존 실패다.
        log("${event.values[0].toInt()} bpm")
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        log("accuracy=$accuracy") // 미착용(-1)·불량(0) 전환 시각도 판독 자료다
    }

    override fun onDestroy() {
        sensorManager.unregisterListener(this)
        log("수집 종료 (표본 $samples)")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun log(msg: String) {
        val line = "${fmt.format(Date())} $msg"
        Log.i(TAG, line)
        synchronized(ring) {
            ring.add(line)
            if (ring.size > RING_MAX) ring.removeAt(0)
        }
    }

    companion object {
        private const val CH = "vg-probe-hr"
        const val TAG = "VgHrProbe"
        private const val RING_MAX = 40
        private var samples = 0

        /** 화면 표시용 최근 로그 — 프로브라 정적 링으로 충분하다. */
        val ring = mutableListOf<String>()
        fun tail(n: Int = 12): String = synchronized(ring) { ring.takeLast(n).joinToString("\n") }
    }
}
