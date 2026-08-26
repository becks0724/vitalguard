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
import com.vitalguard.wear.source.OffBodySource
import com.vitalguard.wear.source.ActivitySource
import com.vitalguard.wear.source.CompositeTrackerSource
import com.vitalguard.wear.source.SamsungTrackerSource
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
    private lateinit var offBody: OffBodySource
    /** 센서가 붙어 있는가 — 벗으면 떼고 차면 다시 붙인다(서비스는 계속 산다). */
    private var sensing = false
    private var uploadBlockedUntilMs = 0L
    /** 심박 재구독 횟수 — 로그에 남겨 "몇 번째 되살림인가" 를 볼 수 있게 한다. */
    private var hrRevives = 0

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
        offBody = OffBodySource(this)
        val battery = getSystemService(BatteryManager::class.java)
        engine = CollectorEngine(
            // 삼성이 주(SpO₂·체온·IBI), 순정이 바닥(심박·가속도) — 삼성이 막혀도 수집은 산다.
            source = CompositeTrackerSource(
                primary = SamsungTrackerSource(this),
                fallback = SensorTrackerSource(this),
                // 활동 3종 — 승인 불필요 경로(Health Services). 스트레스·작업게이트의 재료다.
                extras = listOf(ActivitySource(this)),
            ),
            queue = queue,
            batteryPct = {
                battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 1..100 }
            },
            // ⚠ 못 읽는 기기는 Int.MIN_VALUE 또는 0 을 준다 — 그대로 실으면 "0µAh 남음" 이 된다.
            //   갤럭시워치9 실측값은 388,908µAh(=388mAh · 정격 445mAh) 대역이다.
            batteryChargeUah = {
                battery.getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER).takeIf { it > 0L }
            },
            latestFix = { now -> gps.currentFix(now) },
        )
        pipeline = UploadPipeline(queue, HttpTransport(config.baseUrl))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // ⚠ OngoingActivity 는 **NotificationCompat.Builder** 를 요구한다(플랫폼 Notification.Builder 는
        //   못 받는다 — 바이트코드 확인). 그래서 알림 생성부를 androidx 쪽으로 옮긴다.
        val builder = androidx.core.app.NotificationCompat.Builder(this, CH)
            .setContentTitle("VitAlGuard 수집 중")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_WORKOUT)

        // ★ 진행 중 활동 선언 — 시계 화면 복귀를 막는 정식 수단(운동 앱이 쓰는 것).
        //   탭하면 우리 화면으로 돌아온다. 08-26 실측에서 앰비언트만으로는 약 1분 뒤 시계로
        //   돌아갔다(앰비언트 진입 11:16:10 → 해제 11:17:09 → 시계). 그 자리를 이것으로 시도한다.
        val touch = android.app.PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
        androidx.wear.ongoing.OngoingActivity.Builder(this, FGS_NOTIFICATION_ID, builder)
            .setStaticIcon(android.R.drawable.stat_notify_sync)
            .setTouchIntent(touch)
            .setStatus(
                androidx.wear.ongoing.Status.forPart(
                    androidx.wear.ongoing.Status.TextPart("생체 수집 중"),
                ),
            )
            .build()
            .apply(this)

        // 60초 규칙 — 시작 즉시 승격. 타입은 매니페스트 선언(health|location)과 같아야 한다.
        startForeground(
            FGS_NOTIFICATION_ID,
            builder.build(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
        )
        // ★ 착용 상태가 수집을 켜고 끈다 — 시작 버튼이 없는 운용의 핵심.
        //   서비스 자체는 계속 산다(벗었다 다시 차면 사람 개입 없이 재개된다).
        offBody.start { wornNow -> if (wornNow) beginSensing() else endSensing() }
        if (offBody.worn) beginSensing()
        handler.removeCallbacks(tick)
        handler.postDelayed(tick, FLUSH_INTERVAL_MS)
        running = true
        liveEngine = engine
        Log.i(TAG, "수집 시작 (flush ${FLUSH_INTERVAL_MS / 1000}s · 서버 ${config.baseUrl})")
        return START_STICKY
    }

    /** 착용 시작 — 센서를 붙인다. 이미 붙어 있으면 아무것도 안 한다(중복 등록 방지). */
    private fun beginSensing() {
        if (sensing) return
        sensing = true
        worn = true
        collecting = true
        gps.start()
        engine.start(System.currentTimeMillis())
        Log.i(TAG, "착용 — 수집 개시")
    }

    /** 벗음 — 센서를 뗀다. **큐는 지우지 않는다**(미전송분은 다시 찼을 때 함께 올라간다). */
    private fun endSensing() {
        if (!sensing) return
        sensing = false
        worn = false
        collecting = false
        engine.stop()
        gps.stop()
        Log.i(TAG, "벗음 — 수집 중지 (큐 ${queue.size}건 보존)")
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
                        lastUploadAtMs = now
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
            reviveHrIfStalled(now)
            handler.postDelayed(this, FLUSH_INTERVAL_MS)
        }
    }

    /**
     * ★ 죽은 심박 스트림을 되살린다.
     *
     * 08-26 실기 — 심박이 `12:22:30` 을 끝으로 28분간 한 건도 안 왔는데 앱은 `collecting=true`
     * 였고 화면엔 마지막 값 `101` 이 그대로 남아 있었다. 서버는 옳게 "연결끊김" 을 냈는데
     * **워치만 정상인 척했다.** 앱이 스트림 사망을 감지하는 장치가 아예 없었던 것이 원인이다.
     *
     * ⚠ 이건 표시 문제가 아니라 안전 문제다 — 심박이 끊긴 것을 앱이 모르면
     * **쓰러진 작업자와 센서 고장을 구별할 수 없다.**
     *
     * 재구독은 `stop()`+`start()` 다. 큐·칼만 심박원본(hrLog)은 보존되고(그쪽을 안 건드린다),
     * 화면 스냅숏과 IBI 창만 비워진다 — 낡은 값이 사라지는 것은 의도한 효과다.
     */
    private fun reviveHrIfStalled(now: Long) {
        if (!sensing) return
        val silence = engine.hrSilenceMs(now) ?: return
        if (silence < HR_STALL_MS) return
        hrRevives++
        Log.w(TAG, "심박 침묵 ${silence / 1000}초 — 트래커 재구독 (${hrRevives}회째)")
        engine.stop()
        engine.start(now)
    }

    override fun onDestroy() {
        running = false
        liveEngine = null
        handler.removeCallbacks(tick)
        worker.quitSafely()
        offBody.stop()
        endSensing()
        Log.i(TAG, "수집 종료 — 큐 ${queue.size}건 보존")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CH = "vg-collector"

        /**
         * 포그라운드 알림 id. **`startForeground` 와 `OngoingActivity` 가 같은 값을 써야 한다** —
         * 어긋나면 진행중활동이 어느 알림에도 안 붙고 **조용히** 효과가 사라진다(예외도 로그도 없다).
         * 숫자를 두 곳에 적지 않으려고 상수로 둔다([[L-106]]).
         */
        private const val FGS_NOTIFICATION_ID = 2

        /**
         * 심박 침묵 한계 — 이 시간을 넘기면 트래커가 죽은 것으로 보고 재구독한다.
         *
         * 근거(08-26 실측 · wearos 심박 도착 간격 149구간) — 중앙값 **120.7초** · p75 129.4 ·
         * p90 **209.2초**. 정상 간격에도 200초대가 나오므로 문턱이 그 위로 넉넉해야 재구독이
         * 정상 동작에 튀지 않는다. 5분은 p90 의 1.4배이고, 안전 장비에서 5분간 심박이 없는 것은
         * 어느 쪽이든(사람이든 센서든) 확인이 필요한 상태다.
         */
        const val HR_STALL_MS = 300_000L

        /**
         * 화면이 "낡았다" 고 말하기 시작하는 나이. **서버 `STALE_MS_WEAROS`(150초)와 같은 값** —
         * 관제웹이 연결끊김으로 보는 시점과 워치가 낡았다고 말하는 시점이 어긋나면
         * "워치는 멀쩡한데 관제만 끊김" 이라는 오해가 다시 생긴다. 두 화면이 같은 시점을 봐야 한다.
         */
        const val HR_STALE_MS = 150_000L
        const val TAG = "VgCollector"
        /**
         * 전송 주기 — 60초 → **120초**(08-25 발열 실측 후 조정).
         *
         * 근거 — 10분 착용에 피부온 +2.3℃ · 배터리 15%. LTE 기상은 발열·배터리의 큰 축이고,
         * 기상 횟수를 절반으로 줄인다. ⚠ 관제 신선도(STALE_MS 60초)와의 간극은 더 벌어지지만,
         * **지금은 발열이 체온 판정을 오염시키는 쪽이 더 급하다**(R-14 는 heartbeat 별도 송신으로
         * 따로 푼다). 큐가 그 사이를 흡수하므로 유실은 없다.
         */
        const val FLUSH_INTERVAL_MS = 120_000L

        /** 화면 표시용 — 큐 적체는 서버 장애의 유일한 가시 신호다(08-25 실황이 필요를 증명). */
        @Volatile var queuedCount = 0
            internal set

        /** 화면이 시작/중지 상태를 읽는다 — 서비스 바인딩 없이 상태만 노출. */
        @Volatile var running = false
            private set

        /** 착용 여부 — 화면이 "차면 시작됩니다" 안내를 띄울지 판단한다. */
        @Volatile var worn = true
            private set

        /**
         * **실제로 센서를 읽고 있는가.** `running`(서비스 생존)과 다르다 —
         * 벗으면 서비스는 살아 있지만 수집은 멎는다. 화면은 이쪽을 봐야 한다
         * (08-25 실기: 벗었는데 "수집 중" 으로 남아 있었다).
         */
        @Volatile var collecting = false
            private set

        /** 화면이 최신 생체값을 읽는 통로 — 엔진 스냅숏을 그대로 넘긴다(업로드 경로와 별개). */
        @Volatile var liveEngine: CollectorEngine? = null
            private set

        /** 마지막 업로드 성공 시각(epoch ms). null = 아직 한 번도 못 올림. */
        @Volatile var lastUploadAtMs: Long? = null
            private set
    }
}
