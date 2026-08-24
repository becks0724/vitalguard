// 실측 프로브 진입 화면 — 버튼 4개·결과 텍스트. 제품 UI 아님(버리는 코드 — context-notes R-05).
package com.vitalguard.wear

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {

    private lateinit var output: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24, 48, 24, 48)
        }
        output = TextView(this).apply { textSize = 10f }

        fun button(label: String, onClick: () -> Unit) = column.addView(
            Button(this).apply {
                text = label
                setOnClickListener { onClick() }
            },
        )

        button("① 권한 요청") { requestSensorPermissions() }
        button("② 삼성 SDK 트래커") {
            show("삼성 SDK 연결 중…")
            SensorSdkProbe.run(this) { runOnUiThread { show(it) } }
        }
        button("③ Health Services") {
            show("Health Services 조회 중…")
            HealthServicesProbe.run(this) { runOnUiThread { show(it) } }
        }
        button("④ 심박 FGS 시작") {
            startForegroundService(Intent(this, HrForegroundService::class.java))
            show("FGS 시작됨 — 화면 끄고 10분 뒤 ⑤로 판독")
        }
        button("⑤ 생존 로그") { show(HrForegroundService.tail().ifEmpty { "로그 없음" }) }
        button("⑥ FGS 중지") {
            stopService(Intent(this, HrForegroundService::class.java))
            show("FGS 중지됨")
        }

        column.addView(output)
        setContentView(ScrollView(this).apply { addView(column) })
    }

    /** API 36+ 는 health 권한, 35 이하는 BODY_SENSORS 계열 — 매니페스트의 신·구 병기와 짝. */
    private fun requestSensorPermissions() {
        val wanted = if (Build.VERSION.SDK_INT >= 36) {
            arrayOf(
                "android.permission.health.READ_HEART_RATE",
                "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
            )
        } else {
            // 백그라운드는 전경 승인 뒤 별도 요청이 규칙이라 여기선 전경만 — 실측 ⑥에서 단계를 센다
            arrayOf(android.Manifest.permission.BODY_SENSORS)
        }
        val missing = wanted.filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
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
}
