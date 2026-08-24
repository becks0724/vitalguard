// 실측 프로브 화면 — iOS ContentView 의 디자인 문법을 이식: 검정 바탕·큰 심박·의미색·필 버튼
package com.vitalguard.wear

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.vitalguard.wear.pipeline.ConfigStore

class MainActivity : Activity() {

    // iOS 워치 화면과 같은 팔레트 — 시스템색 근사값.
    private object Palette {
        const val BG = 0xFF000000.toInt()
        const val PRIMARY = 0xFFFFFFFF.toInt()
        const val SECONDARY = 0xFF9E9E9E.toInt()   // .secondary
        const val PILL = 0xFF2C2C2E.toInt()        // 어두운 회색 필 버튼
        const val GREEN = 0xFF30D158.toInt()       // 시작·정상
        const val RED = 0xFFFF453A.toInt()         // 중지·심박 하트
        const val CYAN = 0xFF64D2FF.toInt()        // SpO₂ 계열(결과 출력)
    }

    private lateinit var output: TextView
    private lateinit var bpmText: TextView
    private lateinit var statusText: TextView
    private var allowNoAuth = false
    private val poll = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val w = resources.displayMetrics.widthPixels
        val h = resources.displayMetrics.heightPixels

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Palette.BG)
            setPadding((w * 0.14).toInt(), (h * 0.16).toInt(), (w * 0.14).toInt(), (h * 0.22).toInt())
        }

        // ── 헤더: ♥ 72 bpm — iOS 와 같은 큰 숫자 + 단위 ──
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.CENTER_HORIZONTAL
        }
        header.addView(TextView(this).apply {
            text = "♥ "
            textSize = 22f
            setTextColor(Palette.RED)
        })
        bpmText = TextView(this).apply {
            text = "--"
            textSize = 38f
            setTextColor(Palette.PRIMARY)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
        }
        header.addView(bpmText)
        header.addView(TextView(this).apply {
            text = " bpm"
            textSize = 12f
            setTextColor(Palette.SECONDARY)
        })
        column.addView(header)

        statusText = TextView(this).apply {
            text = "대기"
            textSize = 12f
            setTextColor(Palette.SECONDARY)
            gravity = Gravity.CENTER
            setPadding(0, 2, 0, 12)
        }
        column.addView(statusText)

        // ── 필 버튼 — iOS tint 문법: 위험/시작만 색, 나머지는 회색 필 ──
        fun pill(label: String, tint: Int = Palette.PILL, onClick: () -> Unit) {
            column.addView(TextView(this).apply {
                text = label
                textSize = 14f
                setTextColor(if (tint == Palette.PILL) Palette.PRIMARY else Color.BLACK)
                gravity = Gravity.CENTER
                setPadding(0, 22, 0, 22)
                background = GradientDrawable().apply {
                    cornerRadius = 48f
                    setColor(tint)
                }
                setOnClickListener { onClick() }
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = 10 })
        }

        pill("① 권한 요청") { requestSensorPermissions() }
        pill("② 삼성 SDK 트래커") {
            show("삼성 SDK 연결 중…")
            SensorSdkProbe.run(this) { runOnUiThread { show(it) } }
        }
        pill("③ Health Services") {
            show("Health Services 조회 중…")
            HealthServicesProbe.run(this) { runOnUiThread { show(it) } }
        }
        pill("④ 심박 시작", Palette.GREEN) {
            startForegroundService(Intent(this, HrForegroundService::class.java))
            show("수집을 시작했습니다.\n화면을 끄고 10분 뒤 ⑤로 확인하세요.")
        }
        pill("⑤ 생존 로그") { show(HrForegroundService.tail().ifEmpty { "로그 없음" }) }
        pill("⑥ 심박 중지", Palette.RED) {
            stopService(Intent(this, HrForegroundService::class.java))
            show("심박 수집을 중지했습니다.")
        }
        pill("⑦ 본수집 시작", Palette.GREEN) {
            val cfg = ConfigStore(this)
            if (cfg.uploadConfig() == null && !allowNoAuth) {
                allowNoAuth = true
                show("토큰 미주입 상태입니다.\nMac 에서 주입해 드립니다 — ①~⑤ 실측을 먼저 진행하세요.\n(한 번 더 누르면 자격 없이 수집만 시작)")
                return@pill
            }
            startForegroundService(Intent(this, CollectorService::class.java))
            show("본수집 시작 — 큐·업로드는 logcat 으로 관찰합니다.")
        }
        pill("⑧ 본수집 중지", Palette.RED) {
            stopService(Intent(this, CollectorService::class.java))
            show("본수집을 중지했습니다. 큐는 보존됩니다.")
        }

        output = TextView(this).apply {
            textSize = 12f
            setTextColor(Palette.CYAN)
            setPadding(0, 8, 0, 0)
        }
        column.addView(output)

        setContentView(ScrollView(this).apply {
            setBackgroundColor(Palette.BG)
            addView(column)
        })
        absorbConfigExtras()
    }

    /** iOS 화면과 같은 3초 폴링 — 스트림이 죽어도 헤더는 3초 안에 되살아난다. */
    private val refresh = object : Runnable {
        override fun run() {
            bpmText.text = HrForegroundService.lastBpm?.toString() ?: "--"
            if (HrForegroundService.running) {
                statusText.text = "수집 중 · 표본 ${HrForegroundService.sampleCount()}"
                statusText.setTextColor(Palette.GREEN)
            } else {
                statusText.text = "대기"
                statusText.setTextColor(Palette.SECONDARY)
            }
            poll.postDelayed(this, 3_000)
        }
    }

    override fun onResume() {
        super.onResume()
        poll.post(refresh)
    }

    override fun onPause() {
        poll.removeCallbacks(refresh)
        super.onPause()
    }

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
        if (missing.isEmpty()) show("권한 전부 있음") else requestPermissions(missing.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        show(
            perms.zip(results.toTypedArray()).joinToString("\n") { (p, r) ->
                "${p.substringAfterLast('.')} = ${if (r == PackageManager.PERMISSION_GRANTED) "허용" else "거부"}"
            },
        )
    }

    private fun show(text: String) {
        output.text = text
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
        if (absorbed > 0) show("자격 주입 ${absorbed}개 항목 저장됨 (worker=${cfg.workerId})")
    }
}
