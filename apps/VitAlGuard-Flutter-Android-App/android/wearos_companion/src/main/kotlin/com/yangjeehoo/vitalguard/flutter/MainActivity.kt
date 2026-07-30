package com.yangjeehoo.vitalguard.flutter

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.google.android.gms.wearable.Wearable

class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(24, 24, 24, 24)
            setBackgroundColor(Color.BLACK)
        }
        layout.addView(TextView(this).apply { text = "VitAlGuard Watch"; textSize = 18f; setTextColor(Color.WHITE); gravity = Gravity.CENTER })
        layout.addView(TextView(this).apply { text = currentIdentity(); textSize = 11f; setTextColor(Color.LTGRAY); gravity = Gravity.CENTER })
        status = TextView(this).apply {
            gravity = Gravity.CENTER; textSize = 12f; setPadding(16, 18, 16, 18)
            background = rounded(Color.rgb(18, 18, 18), Color.DKGRAY, 28)
        }
        renderStatus(currentStatus(), hasSyncedSession())
        layout.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 14 })
        layout.addView(Button(this).apply {
            text = "휴대폰 세션 요청"; setTextColor(Color.WHITE); setOnClickListener { requestPhoneSync() }
            background = rounded(Color.rgb(48, 48, 48), Color.rgb(105, 105, 105), 48)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 12 })
        setContentView(layout)
    }

    private fun rounded(fill: Int, stroke: Int, radius: Int) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = radius.toFloat()
        setColor(fill)
        setStroke(1, stroke)
    }

    override fun onResume() { super.onResume(); renderStatus(currentStatus(), hasSyncedSession()) }

    private fun renderStatus(message: String, success: Boolean?, failure: Boolean = false) {
        status.text = message
        status.setTextColor(when { success == true -> Color.rgb(0, 168, 102); failure -> Color.rgb(255, 49, 49); else -> Color.LTGRAY })
    }

    private fun currentStatus(): String {
        val prefs = getSharedPreferences("vitalguard_watch", MODE_PRIVATE)
        return prefs.getString("session_status", "휴대폰 세션을 기다리는 중입니다.\n실측 센서 권한은 시계에서 별도로 승인해야 합니다.")!!
    }

    private fun currentIdentity(): String {
        val prefs = getSharedPreferences("vitalguard_watch", MODE_PRIVATE)
        return prefs.getString("session_identity", "휴대폰 로그인 대기")!!
    }

    private fun requestPhoneSync() {
        Wearable.getNodeClient(this).connectedNodes.addOnSuccessListener { nodes ->
            nodes.forEach { node -> Wearable.getMessageClient(this).sendMessage(node.id, "/vitalguard/request-session", ByteArray(0)) }
            if (nodes.isEmpty()) renderStatus("휴대폰 릴레이 연결 실패", success = false, failure = true)
            else renderStatus("휴대폰에 세션을 요청했습니다.", success = null)
        }.addOnFailureListener {
            renderStatus("휴대폰 릴레이 연결 실패", success = false, failure = true)
        }
    }
}
    private fun hasSyncedSession(): Boolean = getSharedPreferences("vitalguard_watch", MODE_PRIVATE).getBoolean("session_synced", false)
