// 수집 본체 — 센서·GPS 소스 → 엔진 → 큐 → 업로드를 FGS(health|location)로 돌린다
package com.vitalguard.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import com.vitalguard.wear.pipeline.ConfigStore
import com.vitalguard.wear.pipeline.FlushOutcome
import com.vitalguard.wear.pipeline.HttpTransport
import com.vitalguard.wear.pipeline.QueueStorage
import com.vitalguard.wear.pipeline.UploadPipeline
import com.vitalguard.wear.pipeline.VitalQueue
import com.vitalguard.wear.source.GpsLocationSource
import com.vitalguard.wear.source.SensorTrackerSource
import java.io.File

class CollectorService : Service() {

    // ★ 업로드는 **메인 스레드에서 돌리면 안 된다** — Android 가 NetworkOnMainThreadException 으로
    //   막는데, HttpTransport 의 runCatching 이 그것을 -1(네트워크 오류)로 삼켜 "30초 재시도"만
    //   무한 반복된다(2026-08-24 실기에서 큐만 쌓이고 한 건도 안 올라간 원인).
    private lateinit var worker: HandlerThread
    private lateinit var handler: Handler
    private lateinit var config: ConfigStore
    private lateinit var queue: VitalQueue
    private lateinit var engine: CollectorEngine
    private lateinit var pipeline: UploadPipeline
    private lateinit var gps: GpsLocationSource
    private var uploadBlockedUntilMs = 0L

    override fun onCreate() {
        super.onCreate()
        worker = HandlerThread("vg-collector").apply { start() }
        handler = Handler(worker.looper)
        val ch = NotificationChannel(CH, "생체 수집", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)

        config = ConfigStore(this)
        val file = File(filesDir, "vital-queue.json")
        queue = VitalQueue(object : QueueStorage {
            override fun save(text: String) { file.writeText(text) }
            override fun load(): String? = if (file.exists()) file.readText() else null
        })
        val restored = queue.restore()
        if (restored > 0) Log.i(TAG, "큐 복원 ${restored}건")

        gps = GpsLocationSource(this)
        val battery = getSystemService(BatteryManager::class.java)
        engine = CollectorEngine(
            source = SensorTrackerSource(this),
            queue = queue,
            batteryPct = {
                battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 1..100 }
            },
            latestFix = { now -> gps.currentFix(now) },
        )
        pipeline = UploadPipeline(queue, HttpTransport(config.baseUrl))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = Notification.Builder(this, CH)
            .setContentTitle("VitAlGuard 수집 중")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .build()
        // 60초 규칙 — 시작 즉시 승격. 타입은 매니페스트 선언(health|location)과 같아야 한다.
        startForeground(
            2,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
        )
        gps.start()
        engine.start(System.currentTimeMillis())
        handler.removeCallbacks(tick)
        handler.postDelayed(tick, FLUSH_INTERVAL_MS)
        running = true
        Log.i(TAG, "수집 시작 (flush ${FLUSH_INTERVAL_MS / 1000}s · 서버 ${config.baseUrl})")
        return START_STICKY
    }

    /** flush → 업로드 1회 — 재시도 대기는 FlushOutcome 이 정한 시각까지 업로드만 쉰다(수집은 계속). */
    private val tick = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            engine.flush(now)
            if (now >= uploadBlockedUntilMs) {
                when (val r = pipeline.flushOnce(config.uploadConfig())) {
                    is FlushOutcome.Sent -> {
                        queuedCount = r.remaining
                        Log.i(TAG, "업로드 ${r.count}건 · 잔여 ${r.remaining}")
                    }
                    is FlushOutcome.RetryAfterSec -> {
                        uploadBlockedUntilMs = now + r.sec * 1000L
                        queuedCount = queue.size
                        Log.w(TAG, "업로드 대기 ${r.sec}s (auth=${r.authRejected}) · 큐 ${queue.size}")
                    }
                    FlushOutcome.Idle -> if (config.uploadConfig() == null) {
                        Log.w(TAG, "자격 없음 — 큐 ${queue.size}건 적재만 (①로 토큰 주입)")
                    }
                }
            }
            handler.postDelayed(this, FLUSH_INTERVAL_MS)
        }
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacks(tick)
        worker.quitSafely()
        engine.stop()
        gps.stop()
        Log.i(TAG, "수집 종료 — 큐 ${queue.size}건 보존")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CH = "vg-collector"
        const val TAG = "VgCollector"
        // 배터리 기준 프로파일(08-24 시뮬)의 60초 배치 — 실측 ⑥이 모델을 보정하면 재확정한다.
        const val FLUSH_INTERVAL_MS = 60_000L

        /** 화면 표시용 — 큐 적체는 서버 장애의 유일한 가시 신호다(08-25 실황이 필요를 증명). */
        @Volatile var queuedCount = 0
            internal set

        /** 화면이 시작/중지 상태를 읽는다 — 서비스 바인딩 없이 상태만 노출. */
        @Volatile var running = false
            private set
    }
}
