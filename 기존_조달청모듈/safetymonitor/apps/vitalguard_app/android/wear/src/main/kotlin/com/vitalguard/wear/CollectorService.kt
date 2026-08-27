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
import com.vitalguard.ml.FallMLModule
import com.vitalguard.ml.FallShadowReporter
import com.vitalguard.ml.ImuWindowLogger
import com.vitalguard.ml.MLSelfCheck
import com.vitalguard.wear.source.GpsLocationSource
import com.vitalguard.wear.source.ImuSource
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
    /**
     * 낙상 ML — 6축 IMU 전용 통로. 기존 `onAccelMagG`(무동작·변동폭) 경로와 **별개**다.
     * ⚠ 셋 중 하나라도 서지 않으면 ML 은 통째로 쉰다(자이로 없음 · assets 없음). 낙상 판정이
     *   없는 것과 **틀린 판정이 나가는 것**은 다른 문제이고, 후자가 훨씬 비싸다.
     */
    private lateinit var imu: ImuSource
    private var fallMl: FallMLModule? = null
    private lateinit var imuLogger: ImuWindowLogger
    private lateinit var fallShadow: FallShadowReporter
    /**
     * 센서가 붙어 있는가 — 벗으면 떼고 차면 다시 붙인다(서비스는 계속 산다).
     * ⚠ `@Volatile` = 쓰기는 메인, 읽기는 수집 스레드와 IMU 감시 경로 둘이다. 종전에도 교차
     *   읽기였지만 내 변경이 그 빈도를 늘리므로 가시성을 명시한다.
     */
    @Volatile private var sensing = false
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

        // ── 낙상 ML 3종 모듈 (v6.1.0) ────────────────────────────────────────────
        // 모듈 계약 = 12초 윈도(충격 전 2s + 후 10s) 하나를 넣으면 판정이 나온다.
        // 판정은 로그 + **섀도 보고**(FallShadowReporter — 서버 적재, 경보 없음)로 낸다.
        // 카운트다운 화면("낙상 아님" 버튼)은 다음 단계다 — 지금 결말은 자동 2종뿐.
        imu = ImuSource(this)
        imuLogger = ImuWindowLogger()          // 기본값 = fs 50 · pre 2s · post 10s · 게이트 1.8G
        fallMl = FallMLModule.create(this)     // assets 에 onnx 3개가 없으면 null
        if (fallMl == null) Log.w(TAG, "낙상 ML 비활성 — assets 모델 로드 실패")
        // 항목 생성은 IMU 스레드, 큐 적재는 수집 스레드 — 큐(플러시와 같은 스레드) 계약 유지.
        fallShadow = FallShadowReporter(enqueue = { item -> handler.post { queue.add(item) } })
        imuLogger.onWindow = { w ->
            val ml = fallMl
            if (ml != null) {
                val v = ml.assess(w)
                // ★ 추적성은 모듈의 계약이다(README) — trace 를 통째로 남긴다. 이 줄이 있어야
                //   나중에 "왜 그렇게 판정했나" 를 원시 윈도 없이도 되짚을 수 있다.
                Log.i(TAG, "낙상판정 ${v.trace}")
                warnIfInferenceLooksDead(v)
                fallShadow.onVerdict(v)
            }
        }

        // ★ 자가검증을 **버튼에 두지 않고 기동 시 1회 자동 실행**한다.
        //   "모델이 로드됐다" 와 "특징추출·추론 수치가 파이썬 정답지와 맞는다" 는 다른 말이다.
        //   버튼만 두면 아무도 안 누른 채 배포되고, 그 차이는 낙상이 나야 드러난다.
        //   ⚠ 메인 스레드에서 돌리면 안 된다 — 6슬라이스 × (88피처 + ONNX 추론) 이다.
        handler.post {
            val report = runCatching { MLSelfCheck.run(this) }.getOrElse { "자가검증 예외: $it" }
            Log.i(TAG, "ML 자가검증 (모듈 ${FallMLModule.VERSION})\n$report")
        }
    }

    /**
     * recovery 추론이 죽었는지 **지문으로** 잡는다 — 모듈은 안 고치고 관측만 붙인다.
     *
     * ★ 모듈의 `prob()` 은 모든 예외를 `0.0` 으로 삼킨다. 그 0.0 이 `0.35` 미만이라 판정은
     *   `no_danger` 가 된다 — 즉 **추론이 실패하면 조용히 "위험 아님"** 이 된다. 코드가 선언한
     *   의도("애매하면 위험")와 정반대다. 애플워치 판(Swift 원본)도 같은 성질이라 포팅 결함이
     *   아니고, 계약상 모듈 내부는 못 고친다(폴더 통째 교체라 고쳐도 다음 판에 되돌아간다).
     * ★ 지문 = 확률이 **정확히** 0.0. 학습된 모델이 그 값을 낼 일은 사실상 없다.
     * ⚠ 판정은 바꾸지 않는다. 여기서 위험측으로 뒤집으면 모듈의 계약을 호스트가 몰래 덮는 것이고,
     *   ML 담당의 답이 오기 전에 임계 동작을 바꾸는 셈이다. 지금 필요한 것은 **증거**다.
     */
    private fun warnIfInferenceLooksDead(v: FallMLModule.Verdict) {
        if (v.nonrecoveryProb == 0.0) {
            Log.e(TAG, "★ recovery 추론 실패 의심 — p=0.0 이라 판정이 ${v.decision.raw} 로 떨어졌다. " +
                "실패면 '위험 아님'이 아니라 '모름'이어야 한다. trace=${v.trace}")
        }
        // work_veto·impact 는 0.0 이어도 안전측이다(기각 안 함 · 증거 전용). 사실만 남긴다.
        if (v.workProb == 0.0 || v.impactProb == 0.0) {
            Log.w(TAG, "추론 확률에 정확한 0.0 이 섞였다 — work=${v.workProb} impact=${v.impactProb}")
        }
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
        // ML 은 착용 중에만 돈다 — 벗은 워치의 6축 50Hz 는 전력만 쓴다.
        if (fallMl != null && imu.supported) {
            imu.start { r ->
                fallShadow.feed(r.totalG)    // 카운트다운 열려 있을 때만 일한다(평시 no-op)
                imuLogger.ingest(r.ax, r.ay, r.az, r.gx, r.gy, r.gz, r.totalG, r.atNs)
                watchdogFromImu()
            }
        }
        Log.i(TAG, "착용 — 수집 개시 (낙상ML=${if (fallMl != null && imu.supported) "on" else "off"})")
    }

    /** 벗음 — 센서를 뗀다. **큐는 지우지 않는다**(미전송분은 다시 찼을 때 함께 올라간다). */
    private fun endSensing() {
        if (!sensing) return
        sensing = false
        worn = false
        collecting = false
        engine.stop()
        gps.stop()
        imu.stop()
        Log.i(TAG, "벗음 — 수집 중지 (큐 ${queue.size}건 보존)")
    }

    /**
     * ★ 심박 감시를 `tick` 밖으로 — 순환을 끊는다.
     *
     * 종전에는 `reviveHrIfStalled` 가 `tick` **안**에서만 불렸다. 그런데 `tick` 은
     * `handler.postDelayed` 로 도는데 그것은 `uptimeMillis` 기준이라 **CPU 가 절전에 들면 함께
     * 멈춘다**. 즉 심박이 죽은 바로 그 상황(기기가 조용해진 상황)에서 되살리는 장치도 같이 죽었다.
     * 08-27 실측 = EMP-admin3470 워치에서 심박이 **6,132초(1.7시간)** 끊겼는데 재구독이 한 번도
     * 안 돌았다(300초면 돌았어야 한다).
     *
     * 시계를 바꾼다 — IMU 표본 스트림은 Dozing 에서도 살아 있는 것이 실측됐다(8분간 59.6Hz ·
     * 배칭 0). 그 위에 `elapsedRealtime`(절전에도 진행)로 30초 스로틀을 건다.
     *
     * ⚠ 이것은 `tick` 의 검사를 **대체하지 않고 더한다.** IMU 는 ML 이 켜져 있고 착용 중일 때만
     *   돈다 — ML 을 끄면 이 시계도 사라지므로, 그때는 종전 경로가 그대로 남아야 한다.
     * ⚠ 실제 재구독은 **수집 스레드로 넘겨서** 한다. IMU 스레드에서 `engine.stop()/start()` 를
     *   직접 부르면 flush 와 겹칠 수 있다(`@Synchronized` 가 자료 경쟁은 막지만 순서는 안 지킨다).
     */
    private var lastStallCheckRt = 0L

    private fun watchdogFromImu() {
        val rt = android.os.SystemClock.elapsedRealtime()
        if (!shouldCheckStall(rt, lastStallCheckRt)) return
        lastStallCheckRt = rt
        handler.post { reviveHrIfStalled(System.currentTimeMillis()) }
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
         * 심박 침묵 검사 주기(ms). IMU 는 59.6Hz 로 오므로 매 표본 검사하면 초당 60번 post 한다.
         * 30초면 `HR_STALL_MS`(300초)의 10분의 1이라 감지가 늦어지는 몫은 최대 30초다.
         */
        const val STALL_CHECK_MS = 30_000L

        /**
         * 검사할 때가 됐나. **첫 호출(last=0)은 즉시 통과한다** — 착용 직후를 건너뛰면
         * 그 구간의 침묵을 영영 못 본다.
         * ⚠ `lastRt == 0L` 을 따로 두는 이유 = 뺄셈만으로는 **부팅 직후에만** 첫 검사가 밀린다
         *   (`elapsedRealtime` 이 아직 30초 미만). 재현이 드물어 더 위험한 형태라 규칙으로 박는다.
         * ⚠ 기준 시계는 반드시 `elapsedRealtime` 이다. `uptimeMillis` 를 쓰면 절전에서 멈춰
         *   이 수리가 고치려는 바로 그 병을 그대로 옮겨 온다.
         */
        internal fun shouldCheckStall(nowRt: Long, lastRt: Long): Boolean =
            lastRt == 0L || nowRt - lastRt >= STALL_CHECK_MS

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
