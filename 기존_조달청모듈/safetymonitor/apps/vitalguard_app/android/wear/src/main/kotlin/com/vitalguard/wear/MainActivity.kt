// 실측 프로브 진입 — 화면은 ui/ProbeScreen 이 그리고, 여기는 상태 수집과 동작 배선만 한다
package com.vitalguard.wear

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.vitalguard.wear.pipeline.ConfigStore
import com.vitalguard.wear.ui.ProbeAction
import com.vitalguard.wear.ui.ProbeScreen
import com.vitalguard.wear.ui.ProbeUiState
import com.vitalguard.wear.ui.VgColors
import com.vitalguard.wear.ui.VitalScreen
import com.vitalguard.wear.ui.VitalUiState
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {

    private var output by mutableStateOf("")
    private var allowNoAuth = false
    /** 기본은 작업자 화면. 진단은 화면 안 '진단' 버튼으로만 들어간다(실측 버튼이 앞에 서면 안 된다). */
    private var showDiagnostics by mutableStateOf(false)

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

        setContent {
            var bpm by remember { mutableStateOf<Int?>(null) }
            var running by remember { mutableStateOf(false) }
            var samples by remember { mutableStateOf(0) }

            // iOS 화면과 같은 3초 폴링 — 스트림이 죽어도 헤더가 3초 안에 되살아난다.
            LaunchedEffect(Unit) {
                while (true) {
                    bpm = HrForegroundService.lastBpm
                    running = HrForegroundService.running
                    samples = HrForegroundService.sampleCount()
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
                    state = VitalUiState(
                        workerName = ConfigStore(this).workerName,
                        bpm = bpm,
                        collecting = running || CollectorService.running,
                        queued = CollectorService.queuedCount,
                    ),
                    onToggleCollect = { toggleCollect() },
                    onOpenDiagnostics = { showDiagnostics = true },
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
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.POST_NOTIFICATIONS,
            )
        } else {
            arrayOf(
                android.Manifest.permission.BODY_SENSORS,
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.POST_NOTIFICATIONS,
            )
        }
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) show("권한 전부 있음") else permissionLauncher.launch(missing.toTypedArray())
    }

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
