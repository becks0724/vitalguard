// 실측 프로브 진입 — 화면은 ui/ProbeScreen 이 그리고, 여기는 상태 수집과 동작 배선만 한다
package com.vitalguard.wear

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
import com.vitalguard.wear.pipeline.DeviceLoginClient
import com.vitalguard.wear.pipeline.DevicePoll
import com.vitalguard.wear.pipeline.DeviceStart
import com.vitalguard.wear.ui.LoginMode
import com.vitalguard.wear.ui.ProbeAction
import com.vitalguard.wear.ui.QrLoginUiState
import com.vitalguard.wear.ui.QrPhase
import com.vitalguard.wear.ui.ProbeScreen
import com.vitalguard.wear.ui.ProbeUiState
import com.vitalguard.wear.ui.VgColors
import androidx.wear.ambient.AmbientLifecycleObserver
import androidx.compose.ui.draw.alpha
import com.vitalguard.wear.ui.ActivityDetailPage
import com.vitalguard.wear.ui.DETAIL_PAGE_COUNT
import com.vitalguard.wear.ui.HeartDetailPage
import com.vitalguard.wear.ui.Spo2DetailPage
import com.vitalguard.wear.ui.StepsDetailPage
import com.vitalguard.wear.ui.TempDetailPage
import com.vitalguard.wear.ui.TimelinePoint
import com.vitalguard.wear.ui.VitalScreen
import com.vitalguard.wear.ui.VitalUiState
import com.vitalguard.wear.ui.LoginScreen
import com.vitalguard.wear.ui.LoginUiState
import com.vitalguard.wear.ui.SettingsPage
import com.vitalguard.wear.pipeline.AuthClient
import com.vitalguard.wear.pipeline.LoginResult
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private var output by mutableStateOf("")
    private var allowNoAuth = false
    /** 기본은 작업자 화면. 진단은 화면 안 '진단' 버튼으로만 들어간다(실측 버튼이 앞에 서면 안 된다). */
    private var showDiagnostics by mutableStateOf(false)
    private var uiTick = 0

    /** 앰비언트(항상 켜짐) 진입 여부 — 화면을 어둡게 하고 폴링을 늦춘다. */
    private var ambient by mutableStateOf(false)

    /**
     * 앰비언트 옵저버 — **이것이 "시계로 안 돌아가게" 하는 정식 수단이다.**
     *
     * ⚠ `FLAG_KEEP_SCREEN_ON` 만으로는 안 된다. 08-25 실측에서 `dumpsys window` 에
     *   `fl=KEEP_SCREEN_ON` 이 분명히 걸려 있는데도 깨우면 시계 화면이 떴다 —
     *   Wear 는 화면 유지와 별개로 "앱에서 시계로 복귀" 규칙을 따로 갖고 있다.
     *   앰비언트를 선언하면 화면이 꺼질 자리에서 **앱이 어두운 채 남는다.**
     */
    private val ambientObserver by lazy {
        AmbientLifecycleObserver(
            this,
            object : AmbientLifecycleObserver.AmbientLifecycleCallback {
                override fun onEnterAmbient(details: AmbientLifecycleObserver.AmbientDetails) {
                    ambient = true
                    Log.i("VgUi", "앰비언트 진입 — 화면 유지, 폴링 ${AMBIENT_POLL_MS / 1000}s")
                }

                override fun onExitAmbient() {
                    ambient = false
                    Log.i("VgUi", "앰비언트 해제 — 폴링 ${ACTIVE_POLL_MS / 1000}s")
                }

                override fun onUpdateAmbient() = Unit
            },
        )
    }

    /**
     * 화면을 **앱이 앞에 있는 동안 계속** 켜 둔다(08-25 사용자 재요청 · 2회).
     *
     * ⚠⚠ **대가를 알고 켠다.** 08-25 실측 — 상시 유지로 10분에 피부온 +2.33℃ ·
     *   주변온 +2.51℃ · 배터리 15%. 센서가 기기 발열을 피부온으로 읽어 온열 판정이 오염된다.
     *   그래서 한 번 30초 조건부로 내렸었다.
     * ★ 다만 그 사이에 **판별 수단이 생겼다** — 체온 상세가 피부온·주변온을 같은 축에
     *   겹쳐 그리므로(R-27), 두 선이 나란히 오르면 발열임을 작업자가 눈으로 가른다.
     *   오염이 '조용히' 일어나지는 않는다.
     * ⟹ 더 나은 길은 Wear 앰비언트(항상 켜짐) 모드다 — 화면이 어두워진 채 앱이 남는다.
     *   그쪽이 열·배터리가 훨씬 싸다. 다음 묶음 후보로 둔다.
     */
    private fun holdScreen() {
        // 탭은 이제 아무 것도 안 붙잡는다 — 플래그가 이미 상시다. 호출부 호환으로 남긴다.
    }

    // ── 로그인 ─────────────────────────────────────────────────────────────────
    private var showLogin by mutableStateOf(false)
    private var login by mutableStateOf(LoginUiState())
    /** QR 로그인 코루틴 — 취소·모드 전환·화면 이탈 때 반드시 끊는다(secret 이 이 안에만 산다). */
    private var qrJob: Job? = null
    /** 화면이 읽는 신원. 로그인·로그아웃 즉시 갈아끼우려고 상태로 든다(prefs 를 매 프레임 읽지 않는다). */
    private var workerId by mutableStateOf<String?>(null)
    private var workerName by mutableStateOf<String?>(null)

    /**
     * 워치 텍스트 입력 = RemoteInput. 시스템 입력 화면(키보드·필기·음성)이 전체화면으로 뜨고
     * 결과가 인텐트로 돌아온다. Wear M3 에는 텍스트 필드가 없어서 이 경로가 정식 수단이다.
     */
    private val idInputLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { r -> remoteInputText(r.data, KEY_ID)?.let { login = login.copy(id = it, error = null) } }

    private val passwordInputLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { r -> remoteInputText(r.data, KEY_PASSWORD)?.let { login = login.copy(password = it, error = null) } }

    private fun remoteInputText(data: Intent?, key: String): String? =
        data?.let { android.app.RemoteInput.getResultsFromIntent(it)?.getCharSequence(key)?.toString() }

    private fun askText(launcher: androidx.activity.result.ActivityResultLauncher<Intent>, key: String, label: String) {
        val intent = androidx.wear.input.RemoteInputIntentHelper.createActionRemoteInputIntent()
        androidx.wear.input.RemoteInputIntentHelper.putRemoteInputsExtra(
            intent,
            listOf(android.app.RemoteInput.Builder(key).setLabel(label).build()),
        )
        launcher.launch(intent)
    }

    /** 로그인 시도 — 네트워크는 IO 로 빼고 결과만 화면 스레드로 돌린다. */
    private fun submitLogin() {
        if (login.busy) return
        login = login.copy(busy = true, error = null)
        lifecycleScope.launch {
            val cfg = ConfigStore(this@MainActivity)
            val result = withContext(Dispatchers.IO) {
                AuthClient(cfg.baseUrl).login(login.id.trim(), login.password)
            }
            when (result) {
                is LoginResult.Ok -> {
                    cfg.saveSession(result.token, result.workerId, result.workerName)
                    workerId = result.workerId
                    workerName = result.workerName
                    // ⚠ 비밀번호는 저장하지도 화면에 남기지도 않는다 — 상태를 통째로 비운다.
                    login = LoginUiState()
                    showLogin = false
                    Log.i(AuthClient.TAG, "로그인 성공 worker=${result.workerId}")
                }
                is LoginResult.Failed -> {
                    login = login.copy(busy = false, error = result.message)
                    Log.w(AuthClient.TAG, "로그인 실패: ${result.message}")
                }
            }
        }
    }

    private fun logout() {
        ConfigStore(this).clearSession()
        workerId = null
        workerName = null
        login = LoginUiState()
        Log.i(AuthClient.TAG, "로그아웃 — 자격을 지웠다")
    }

    /**
     * 백그라운드 자동 로그아웃(미착용 90분 · CollectorService)을 화면에 반영한다.
     * 액티비티가 재생성 없이 RESUMED 로 돌아오면 onCreate 의 신원 로딩이 다시 안 돌므로 —
     * 이게 없으면 로그아웃됐는데 요약 화면이 신원을 계속 보이고 업로드는 401 로만 운다.
     */
    override fun onResume() {
        super.onResume()
        if (ConfigStore(this).token == null && workerId != null) {
            workerId = null
            workerName = null
            login = LoginUiState()
        }
    }

    /**
     * ★ QR 로그인(기기 승인 · 2026-08-29 사용자 지시). 워치 화면이 좁아 아이디·비번 입력이 어렵다 —
     *   start → 코드·QR 표시 → 1초 카운트다운 · 4초 poll → 승인되면 **직접 로그인과 같은 성공 경로**
     *   (`saveSession` → 신원 상태 → 화면 닫기). 폰은 /pair 에서 관제웹 계정으로 승인한다.
     * ⚠ `secret` 은 이 코루틴의 지역변수뿐이다 — 저장·로그 금지. 토큰이 QR 로 안 나가는 열쇠가 이것이다.
     * ⚠ EXPIRED 는 phase 만 바꾸고 code·rows 는 남긴다(화면이 흐린 QR 위에 [재발급]을 보인다 — UI 계약).
     */
    private fun startQrLogin() {
        qrJob?.cancel()
        login = login.copy(mode = LoginMode.QR, qr = QrLoginUiState(phase = QrPhase.LOADING), busy = false, error = null)
        qrJob = lifecycleScope.launch {
            val cfg = ConfigStore(this@MainActivity)
            val client = DeviceLoginClient(cfg.baseUrl)
            val s = when (val started = withContext(Dispatchers.IO) { client.start() }) {
                is DeviceStart.Failed -> {
                    login = login.copy(qr = login.qr.copy(phase = QrPhase.ERROR, error = started.message))
                    return@launch
                }
                is DeviceStart.Ok -> started
            }
            login = login.copy(
                qr = QrLoginUiState(QrPhase.WAITING, s.code, s.qrSize, s.qrRows, s.expiresInSec),
            )
            var left = s.expiresInSec
            var sincePollMs = 0L
            while (left > 0) {
                delay(1_000)
                left -= 1
                sincePollMs += 1_000
                login = login.copy(qr = login.qr.copy(secondsLeft = left))
                if (sincePollMs < DeviceLoginClient.POLL_INTERVAL_MS) continue
                sincePollMs = 0
                when (val p = withContext(Dispatchers.IO) { client.poll(s.code, s.secret) }) {
                    DevicePoll.Pending -> Unit
                    is DevicePoll.Approved -> {
                        cfg.saveSession(p.token, p.workerId, p.workerName)
                        workerId = p.workerId
                        workerName = p.workerName
                        login = LoginUiState()
                        showLogin = false
                        Log.i(AuthClient.TAG, "QR 로그인 성공 worker=${p.workerId}")
                        return@launch
                    }
                    DevicePoll.Expired -> {
                        login = login.copy(qr = login.qr.copy(phase = QrPhase.EXPIRED, secondsLeft = 0))
                        return@launch
                    }
                    is DevicePoll.Failed -> {
                        login = login.copy(qr = login.qr.copy(phase = QrPhase.ERROR, error = p.message))
                        return@launch
                    }
                }
            }
            login = login.copy(qr = login.qr.copy(phase = QrPhase.EXPIRED, secondsLeft = 0))
        }
    }

    /** 화면을 떠나면 폴링을 끊는다 — 돌아오면 [재발급]으로 새 코드를 받는다(백그라운드 폴링 없음). */
    override fun onStop() {
        super.onStop()
        if (qrJob?.isActive == true) {
            qrJob?.cancel()
            if (showLogin && login.mode == LoginMode.QR) {
                login = login.copy(qr = login.qr.copy(phase = QrPhase.EXPIRED, secondsLeft = 0))
            }
        }
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
        // 신규 설치 경로 — onCreate 가 미뤄둔 수집 서비스를 허용 직후에 올린다.
        if (canStartHealthFgs() && !CollectorService.running) {
            startForegroundService(Intent(this, CollectorService::class.java))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        absorbConfigExtras()
        // 저장된 신원을 상태로 끌어온다 — 화면은 prefs 가 아니라 이 상태를 본다.
        ConfigStore(this).let { workerId = it.workerId; workerName = it.workerName }

        // ★ 시계 화면으로 돌아가지 않게 하는 수단 = **앰비언트**.
        //   화면이 꺼질 자리에서 앱이 어두운 채 남는다.
        //
        // ⚠⚠ **KEEP_SCREEN_ON 을 함께 걸면 안 된다.** 둘은 보완재가 아니라 배타적이다 —
        //   플래그가 화면을 아예 안 꺼지게 하므로 앰비언트 진입 자체가 일어나지 않는다.
        //   08-25 실측: 둘을 같이 걸었더니 100초를 기다려도 `mWakefulness=Awake` 였고
        //   앰비언트 콜백이 한 번도 안 왔다. 플래그를 빼야 앰비언트가 산다.
        //
        // 백그라운드 수집은 이것과 무관하게 FGS 가 유지한다.
        lifecycle.addObserver(ambientObserver)

        // ★ 시작 버튼이 없다 — 앱이 뜨면 수집 서비스가 스스로 붙고, 실제 수집 개시·중지는
        //   착용 센서가 정한다(08-25 사용자 결정 · 기기에 offbody_detect 실재 확인).
        // ⚠ 신규 설치는 런타임 권한이 0개다 — 이대로 올리면 FGS(health) 승격이 SecurityException 으로
        //   즉사한다(08-31 워치8 40mm 첫 설치 실측 · 워치9는 PoC 때 부여한 권한이 남아 있어 잠복했다).
        //   권한이 없으면 먼저 묻고, 허용 콜백에서 서비스를 올린다.
        if (canStartHealthFgs()) {
            startForegroundService(Intent(this, CollectorService::class.java))
        } else {
            requestSensorPermissions()
        }

        setContent {
            var bpm by remember { mutableStateOf<Int?>(null) }
            var running by remember { mutableStateOf(false) }
            var samples by remember { mutableStateOf(0) }
            var vitals by remember { mutableStateOf(VitalUiState()) }
            // 타임라인 표본 — 화면이 들고 있는 최근 값만(서버 조회 없이 그린다).
            val timeline = remember { mutableStateListOf<TimelinePoint>() }

            // iOS 화면과 같은 3초 폴링 — 스트림이 죽어도 화면이 3초 안에 되살아난다.
            LaunchedEffect(Unit) {
                val cfg = ConfigStore(this@MainActivity)
                while (true) {
                    // ★ 자동 로그아웃(미착용 90분)은 서비스가 조용히 한다 — 화면은 매 틱 prefs 를 다시 본다.
                    //   ⚠ onResume 에만 맡기면 못 잡는다: 이 앱은 앰비언트로 머물러 액티비티가 계속
                    //   RESUMED 라 onResume 이 다시 오지 않는다(위 ambientObserver 참조).
                    val live = cfg.token != null
                    workerId = if (live) cfg.workerId else null
                    workerName = if (live) cfg.workerName else null
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
                    // 칼만 입력 — 엔진이 든 심박 원본(솎지 않은 180분 창).
                    val hrSamples = engine?.hrSamples()
                    vitals = VitalUiState(
                        timeline = timeline.toList(),
                        nowMs = now,
                        bpmRange = if (bpms.size >= 2) bpms.min() to bpms.max() else null,
                        // 심부체온 추정 — 심박만 쓰는 칼만이라 기기 발열에 오염되지 않는다(R-25·R-30).
                        // 서버 coreTempEstimates 와 같은 알고리즘이라 두 화면이 같은 값을 말한다.
                        // ★ 신선한 것만 — 심박이 끊기면 옛 표본으로 계속 나오는 값을 끊는다.
                        //   문턱은 재구독과 같은 수다(HR_STALL_MS): 추정의 근거가 끊긴 시점 = 되살리는 시점.
                        coreTempC = hrSamples?.let {
                            com.vitalguard.wear.core.CoreTempKalman.estimateFresh(
                                it, now, CollectorService.HR_STALL_MS,
                            )
                        },
                        coreWarmupBuckets = hrSamples
                            ?.let { com.vitalguard.wear.core.CoreTempKalman.bucketsRemaining(it) }
                            ?: com.vitalguard.wear.core.CoreTempKalman.MIN_BUCKETS,
                        workerName = workerName,
                        loggedOut = workerId == null,
                        bpm = bpm,
                        spo2 = engine?.lastSpo2,
                        spo2AgeSec = engine?.lastSpo2AtMs?.let { (now - it) / 1000 },
                        bpmAgeSec = engine?.lastBpmAtMs?.let { (now - it) / 1000 },
                        skinTempC = engine?.lastSkinTempC,
                        ambientTempC = engine?.lastAmbientTempC,
                        stillSec = engine?.stillSecNow(now),
                        hrvSdnnMs = engine?.lastHrvMs,
                        windowSteps = engine?.windowSteps ?: 0,
                        sessionSteps = engine?.lastSteps ?: 0,
                        dailySteps = engine?.dailySteps,
                        windowFloors = engine?.windowFloors ?: 0,
                        windowKcal = engine?.windowKcal ?: 0.0,
                        batteryPct = batteryPct(),
                        // 서비스 생존(running)이 아니라 **실제 수집 여부**를 본다.
                        collecting = CollectorService.collecting || HrForegroundService.running,
                        worn = CollectorService.worn,
                        queued = CollectorService.queuedCount,
                        lastUploadAgeSec = CollectorService.lastUploadAtMs?.let { (now - it) / 1000 },
                        // 이력 — 상세 페이지의 추이 차트가 읽는다. 엔진이 들고 있는 것을 복사해
                        // 넘긴다(화면이 직접 쌓지 않는다 — 화면은 3초마다 갈아엎히는 상태다).
                        heartTrend = engine?.heartHistory?.snapshot() ?: emptyList(),
                        spo2Trend = engine?.spo2History?.snapshot() ?: emptyList(),
                        skinTempTrend = engine?.skinTempHistory?.snapshot() ?: emptyList(),
                        ambientTrend = engine?.ambientHistory?.snapshot() ?: emptyList(),
                        stressTrend = engine?.stressHistory?.snapshot() ?: emptyList(),
                        stepsTrend = engine?.stepsHistory?.snapshot() ?: emptyList(),
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
                                "act=${vitals.windowSteps}보(세션${vitals.sessionSteps}·오늘${vitals.dailySteps})/${vitals.windowFloors}층/" +
                                "${"%.2f".format(vitals.windowKcal)}kcal stress=${vitals.stress.index} " +
                                "[${com.vitalguard.wear.core.Sdnn.lastTrace}] " +
                                "collecting=${vitals.collecting} " +
                                "queued=${vitals.queued} tempFrac=" +
                                com.vitalguard.wear.ui.gaugeFraction(vitals.coreTempC, com.vitalguard.wear.core.Thresholds.TEMP_GAUGE_MIN_C, com.vitalguard.wear.core.Thresholds.TEMP_GAUGE_MAX_C),
                        )
                    }
                    delay(if (ambient) AMBIENT_POLL_MS else ACTIVE_POLL_MS)
                }
            }

            if (showLogin) {
                LoginScreen(
                    state = login,
                    onEditId = { askText(idInputLauncher, KEY_ID, "아이디") },
                    onEditPassword = { askText(passwordInputLauncher, KEY_PASSWORD, "비밀번호") },
                    onSubmit = { submitLogin() },
                    onCancel = { qrJob?.cancel(); showLogin = false; login = LoginUiState() },
                    onQrRefresh = { startQrLogin() },
                    onSwitchMode = { qrJob?.cancel(); login = login.copy(mode = LoginMode.MANUAL, busy = false, error = null) },
                )
            } else if (showDiagnostics) {
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
                // ★ 세로 페이저 — 가로는 워치 표준 '뒤로가기' 와 충돌해 앱이 닫힌다.
                //   0=요약(한눈) · 1~4=상세(차트·통계). 순서를 바꾸면 익힌 위치가 흐트러진다.
                val pagerState = androidx.wear.compose.foundation.pager.rememberPagerState {
                    DETAIL_PAGE_COUNT
                }
                // 앰비언트에서는 전체를 어둡게 — 밝은 면적을 줄이라는 Wear 지침.
                androidx.compose.foundation.layout.Box(
                    androidx.compose.ui.Modifier.alpha(if (ambient) com.vitalguard.wear.ui.AMBIENT_ALPHA else 1f),
                ) {
                androidx.wear.compose.material3.VerticalPagerScaffold(
                    pagerState = pagerState,
                    // ★ 요약면에서는 페이지 점을 안 그린다 — 우측 걸음 눈금과 같은 자리라
                    //   겹쳐서 둘 다 못 읽는다(08-25 사용자 보고). 상세면에서는 그대로 둔다.
                    pageIndicator = {
                        if (pagerState.currentPage != 0) {
                            androidx.wear.compose.material3.VerticalPageIndicator(pagerState)
                        }
                    },
                ) {
                    androidx.wear.compose.foundation.pager.VerticalPager(state = pagerState) { page ->
                        when (page) {
                            0 -> VitalScreen(
                                state = vitals,
                                onOpenDiagnostics = { showDiagnostics = true },
                                onTap = { holdScreen() },
                            )
                            1 -> HeartDetailPage(vitals)
                            2 -> Spo2DetailPage(vitals)
                            3 -> TempDetailPage(vitals)
                            4 -> ActivityDetailPage(vitals)
                            5 -> StepsDetailPage(vitals)
                            else -> SettingsPage(
                                workerName = workerName,
                                workerId = workerId,
                                onLogin = { login = LoginUiState(); showLogin = true; startQrLogin() },
                                onLogout = { logout() },
                            )
                        }
                    }
                }
                }
            }
        }
    }

    companion object {
        /** RemoteInput 결과 번들의 키 — 요청과 회수가 같은 문자열을 봐야 한다. */
        const val KEY_ID = "vg_login_id"
        const val KEY_PASSWORD = "vg_login_password"

        /** 평상시 화면 갱신 주기 — iOS 화면과 같은 3초. */
        const val ACTIVE_POLL_MS = 3_000L

        /**
         * 앰비언트 갱신 주기. 시스템이 1분에 한 번 깨우는 리듬에 맞춘다 —
         * 어두운 화면을 3초마다 다시 그리면 앰비언트로 아낀 전력을 그대로 반납한다.
         */
        const val AMBIENT_POLL_MS = 60_000L
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

    /** 정본은 [CollectorService.canStartHealthFgs] — 부팅 리시버와 **같은 판단**을 써야 한다. */
    private fun canStartHealthFgs(): Boolean = CollectorService.canStartHealthFgs(this)

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
