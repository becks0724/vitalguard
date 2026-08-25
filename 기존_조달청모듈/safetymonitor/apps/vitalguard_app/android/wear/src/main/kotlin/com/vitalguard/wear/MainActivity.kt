// 실측 프로브 진입 — 화면은 ui/ProbeScreen 이 그리고, 여기는 상태 수집과 동작 배선만 한다
package com.vitalguard.wear

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.vitalguard.wear.pipeline.ConfigStore
import com.vitalguard.wear.ui.ProbeAction
import com.vitalguard.wear.ui.ProbeScreen
import com.vitalguard.wear.ui.ProbeUiState
import com.vitalguard.wear.ui.VgColors
import com.vitalguard.wear.ui.TimelinePoint
import com.vitalguard.wear.ui.VitalScreen
import com.vitalguard.wear.ui.VitalUiState
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {

    private var output by mutableStateOf("")
    private var allowNoAuth = false
    /** 기본은 작업자 화면. 진단은 화면 안 '진단' 버튼으로만 들어간다(실측 버튼이 앞에 서면 안 된다). */
    private var showDiagnostics by mutableStateOf(false)
    private var uiTick = 0
    private val screenHandler = Handler(Looper.getMainLooper())

    /** 탭 후 화면을 켜 둘 시간(초). 상시 유지는 발열·배터리를 감당 못 한다(08-25 실측). */
    private val keepScreenOnSec = 30L

    /** 탭하면 일정 시간 화면을 붙잡는다. 시간이 지나면 워치 표준대로 꺼진다. */
    private fun holdScreen() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        screenHandler.removeCallbacksAndMessages(null)
        screenHandler.postDelayed(
            { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) },
            keepScreenOnSec * 1000,
        )
    }

    /** ComponentActivity 는 onRequestPermissionsResult 대신 결과 계약을 쓴다(권장 경로). */
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        show(
            result.entries.joinToString("\n") { (p, granted) ->
                "${p.substringAfterLast('.')} = ${if (granted) "허용" else "거부"}"
            },
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        absorbConfigExtras()

        // ★ 화면 유지는 **조건부**다(08-25 발열 실측 후 변경).
        //   상시로 걸었더니 10분에 피부온 +2.3℃ · 주변온 +2.5℃ · 배터리 15% 였다.
        //   센서가 기기 발열을 피부온으로 읽어 체온 판정이 통째로 오염됐다.
        //   ⟹ 기본은 워치 표준(수 초 뒤 시계 복귀). 화면을 탭하면 KEEP_SCREEN_ON_SEC 만큼만 유지한다.
        //   백그라운드 수집은 이 플래그와 무관하게 FGS 가 유지한다.

        // ★ 시작 버튼이 없다 — 앱이 뜨면 수집 서비스가 스스로 붙고, 실제 수집 개시·중지는
        //   착용 센서가 정한다(08-25 사용자 결정 · 기기에 offbody_detect 실재 확인).
        startForegroundService(Intent(this, CollectorService::class.java))

        setContent {
            var bpm by remember { mutableStateOf<Int?>(null) }
            var running by remember { mutableStateOf(false) }
            var samples by remember { mutableStateOf(0) }
            var vitals by remember { mutableStateOf(VitalUiState()) }
            // 타임라인 표본 — 화면이 들고 있는 최근 값만(서버 조회 없이 그린다).
            val timeline = remember { mutableStateListOf<TimelinePoint>() }

            // iOS 화면과 같은 3초 폴링 — 스트림이 죽어도 화면이 3초 안에 되살아난다.
            LaunchedEffect(Unit) {
                while (true) {
                    // 진단 화면용(HrForegroundService) 과 본수집용(CollectorService) 을 모두 본다.
                    // ★ 둘 중 실제로 도는 쪽의 값을 쓴다 — 08-25 실기에서 화면이 진단 서비스만
                    //   보고 있어 본수집 중인데도 심박이 `--` 로 남았다.
                    val engine = CollectorService.liveEngine
                    val now = System.currentTimeMillis()
                    bpm = engine?.lastBpm ?: HrForegroundService.lastBpm
                    running = CollectorService.running || HrForegroundService.running
                    samples = engine?.samples ?: HrForegroundService.sampleCount()
                    bpm?.let { b ->
                        // 3초 폴링마다 한 점 — 5분 창이면 최대 100점이라 화면 폭에 맞는다.
                        timeline.add(TimelinePoint(now, b))
                        // 창 밖 표본은 버린다(메모리 상한 겸용).
                        while (timeline.isNotEmpty() &&
                            now - timeline.first().atMs > com.vitalguard.wear.ui.CHART_WINDOW_MS
                        ) {
                            timeline.removeAt(0)
                        }
                    }
                    val bpms = timeline.map { it.bpm }
                    vitals = VitalUiState(
                        timeline = timeline.toList(),
                        nowMs = now,
                        bpmRange = if (bpms.size >= 2) bpms.min() to bpms.max() else null,
                        workerName = ConfigStore(this@MainActivity).workerName,
                        bpm = bpm,
                        spo2 = engine?.lastSpo2,
                        spo2AgeSec = engine?.lastSpo2AtMs?.let { (now - it) / 1000 },
                        skinTempC = engine?.lastSkinTempC,
                        ambientTempC = engine?.lastAmbientTempC,
                        stillSec = engine?.stillSecNow(now),
                        hrvSdnnMs = engine?.lastHrvMs,
                        windowSteps = engine?.windowSteps ?: 0,
                        windowFloors = engine?.windowFloors ?: 0,
                        windowKcal = engine?.windowKcal ?: 0.0,
                        batteryPct = batteryPct(),
                        // 서비스 생존(running)이 아니라 **실제 수집 여부**를 본다.
                        collecting = CollectorService.collecting || HrForegroundService.running,
                        worn = CollectorService.worn,
                        queued = CollectorService.queuedCount,
                        lastUploadAgeSec = CollectorService.lastUploadAtMs?.let { (now - it) / 1000 },
                    )
                    // ★ 화면 상태를 그대로 찍는다 — "화면에 안 보인다" 를 추론이 아니라
                    //   값으로 판정하기 위한 계기다(15초마다 1줄).
                    uiTick++
                    if (uiTick % 5 == 1) {
                        Log.i(
                            "VgUi",
                            "bpm=${vitals.bpm} spo2=${vitals.spo2} skin=${vitals.skinTempC} " +
                                "core=${vitals.coreTempC} amb=${vitals.ambientTempC} " +
                                "still=${vitals.stillSec} hrv=${vitals.hrvSdnnMs} " +
                                "act=${vitals.windowSteps}보/${vitals.windowFloors}층/" +
                                "${"%.2f".format(vitals.windowKcal)}kcal stress=${vitals.stress.index} " +
                                "[${com.vitalguard.wear.core.Sdnn.lastTrace}] " +
                                "collecting=${vitals.collecting} " +
                                "queued=${vitals.queued} tempFrac=" +
                                com.vitalguard.wear.ui.gaugeFraction(vitals.coreTempC, com.vitalguard.wear.core.Thresholds.TEMP_GAUGE_MIN_C, com.vitalguard.wear.core.Thresholds.TEMP_GAUGE_MAX_C),
                        )
                    }
                    delay(3_000)
                }
            }

            if (showDiagnostics) {
                ProbeScreen(
                    state = ProbeUiState(
                        bpm = bpm,
                        running = running,
                        samples = samples,
                        queued = CollectorService.queuedCount,
                        output = output,
                    ),
                    actions = listOf(ProbeAction("← 돌아가기") { showDiagnostics = false }) + actions(),
                )
            } else {
                VitalScreen(
                    state = vitals,
                    onOpenDiagnostics = { showDiagnostics = true },
                    onTap = { holdScreen() },
                )
            }
        }
    }

    /** 시작은 즉시, 중지는 한 번 더 눌러 확인 — 오탭으로 수집이 멎지 않게 한다. */
    private var confirmingStop = false

    private fun toggleCollect() {
        if (CollectorService.running) {
            if (!confirmingStop) {
                confirmingStop = true
                output = "한 번 더 누르면 수집을 중지합니다."
                return
            }
            confirmingStop = false
            stopService(Intent(this, CollectorService::class.java))
            output = "수집을 중지했습니다. 큐는 보존됩니다."
        } else {
            confirmingStop = false
            startForegroundService(Intent(this, CollectorService::class.java))
            output = ""
        }
    }

    private fun actions(): List<ProbeAction> = listOf(
        ProbeAction("① 권한 요청") { requestSensorPermissions() },
        ProbeAction("② 삼성 SDK 트래커") {
            output = "삼성 SDK 연결 중…"
            SensorSdkProbe.run(this) { runOnUiThread { show(it) } }
        },
        ProbeAction("③ Health Services") {
            output = "Health Services 조회 중…"
            HealthServicesProbe.run(this) { runOnUiThread { show(it) } }
        },
        ProbeAction("④ 심박 시작", VgColors.Normal) {
            startForegroundService(Intent(this, HrForegroundService::class.java))
            show("수집을 시작했습니다.\n화면을 끄고 10분 뒤 ⑤로 확인하세요.")
        },
        ProbeAction("⑤ 생존 로그") { show(HrForegroundService.tail().ifEmpty { "로그 없음" }) },
        ProbeAction("⑥ 심박 중지", VgColors.Danger) {
            stopService(Intent(this, HrForegroundService::class.java))
            show("심박 수집을 중지했습니다.")
        },
        ProbeAction("⑦ 본수집 시작", VgColors.Normal) {
            val cfg = ConfigStore(this)
            if (cfg.uploadConfig() == null && !allowNoAuth) {
                allowNoAuth = true
                show("토큰 미주입 상태입니다.\n한 번 더 누르면 자격 없이 수집만 시작합니다.")
                return@ProbeAction
            }
            startForegroundService(Intent(this, CollectorService::class.java))
            show("본수집 시작 — 큐·업로드는 logcat 으로 관찰합니다.")
        },
        ProbeAction("⑧ 본수집 중지", VgColors.Danger) {
            stopService(Intent(this, CollectorService::class.java))
            show("본수집을 중지했습니다. 큐는 보존됩니다.")
        },
    )

    /** API 36+ 는 health 권한, 35 이하는 BODY_SENSORS 계열 — 매니페스트의 신·구 병기와 짝. */
    private fun requestSensorPermissions() {
        val wanted = if (Build.VERSION.SDK_INT >= 36) {
            arrayOf(
                "android.permission.health.READ_HEART_RATE",
                "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
                "android.permission.health.READ_OXYGEN_SATURATION",
                "android.permission.health.READ_SKIN_TEMPERATURE",
                // ★ API 36+ 에서도 순정 SensorManager 는 이 권한을 본다 — 빼면 심박이 죽는다.
                android.Manifest.permission.BODY_SENSORS,
                android.Manifest.permission.ACTIVITY_RECOGNITION,
                "android.permission.health.READ_STEPS",
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.POST_NOTIFICATIONS,
            )
        } else {
            arrayOf(
                android.Manifest.permission.BODY_SENSORS,
                android.Manifest.permission.ACTIVITY_RECOGNITION,
                "android.permission.health.READ_STEPS",
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.POST_NOTIFICATIONS,
            )
        }
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) show("권한 전부 있음") else permissionLauncher.launch(missing.toTypedArray())
    }

    private fun batteryPct(): Int? =
        getSystemService(android.os.BatteryManager::class.java)
            ?.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
            ?.takeIf { it in 1..100 }

    private fun show(text: String) {
        output = text
        Log.i(HrForegroundService.TAG, text)
    }

    /** 실측용 자격 주입 — adb 인텐트 엑스트라를 ConfigStore 로 옮긴다(3단계 D 전까지의 경로). */
    private fun absorbConfigExtras() {
        val e = intent?.extras ?: return
        val cfg = ConfigStore(this)
        var absorbed = 0
        e.getString("token")?.let { cfg.token = it; absorbed++ }
        e.getString("workerId")?.let { cfg.workerId = it; absorbed++ }
        e.getString("workerName")?.let { cfg.workerName = it; absorbed++ }
        e.getString("baseUrl")?.let { cfg.baseUrl = it; absorbed++ }
        if (absorbed > 0) output = "자격 주입 ${absorbed}개 항목 저장됨 (worker=${cfg.workerId})"
    }
}
