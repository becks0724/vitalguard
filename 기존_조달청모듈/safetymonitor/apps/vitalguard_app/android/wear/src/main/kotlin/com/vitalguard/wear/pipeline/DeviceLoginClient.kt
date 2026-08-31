// 워치 QR 로그인(기기 승인) 클라이언트 — start 로 코드·secret·QR 행렬을 받고, poll 로 승인된 토큰을 1회 받는다
package com.vitalguard.wear.pipeline

import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * 왜 이 흐름인가(2026-08-29 사용자 지시). 워치 화면이 좁아 아이디·비번 입력이 어렵다. 워치는 코드(+QR)만 보이고
 * 폰 브라우저(/pair)가 관제웹 계정으로 승인한다. 토큰은 QR 로 나가지 않는다 — start 때 받은 `secret` 을 든
 * poll 에만 내려온다(QR 사진·코드 엿보기로는 못 가져간다). secret 은 **메모리에만** 둔다(ConfigStore 저장 금지).
 */
sealed class DeviceStart {
    data class Ok(
        val code: String,
        val secret: String,
        val expiresInSec: Int,
        val pairUrl: String,
        val qrSize: Int,
        /** 서버 qrMatrix.rows 그대로 — '1' 이 검은 칸. 워치는 라이브러리 없이 정사각형만 그린다. */
        val qrRows: List<String>,
    ) : DeviceStart()
    data class Failed(val message: String) : DeviceStart()
}

sealed class DevicePoll {
    object Pending : DevicePoll()
    data class Approved(val token: String, val workerId: String, val workerName: String?) : DevicePoll()
    /** 만료·이미 소비됨 — 새 코드를 발급받아야 한다. */
    object Expired : DevicePoll()
    data class Failed(val message: String) : DevicePoll()
}

class DeviceLoginClient(baseUrl: String, private val open: (URL) -> HttpURLConnection = defaultOpen) {
    private val base = baseUrl.trimEnd('/')
    private val startUrl = URL("$base/api/app-auth/device/start")

    fun start(): DeviceStart = runCatching {
        val conn = open(startUrl)
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
            parseStart(code, text)
        } finally {
            conn.disconnect()
        }
    }.onFailure {
        Log.w(TAG, "QR 로그인 시작 예외: ${it.javaClass.simpleName}: ${it.message} → $startUrl")
    }.getOrElse { DeviceStart.Failed("서버에 연결하지 못했습니다. 통신 상태를 확인하세요.") }

    fun poll(code: String, secret: String): DevicePoll = runCatching {
        val url = URL("$base/api/app-auth/device/poll?code=${enc(code)}&secret=${enc(secret)}")
        val conn = open(url)
        try {
            conn.requestMethod = "GET"
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
            parsePoll(status, text)
        } finally {
            conn.disconnect()
        }
    }.onFailure {
        // ⚠ secret 은 로그에 싣지 않는다 — URL 을 그대로 찍으면 새어 나간다.
        Log.w(TAG, "QR 로그인 확인 예외: ${it.javaClass.simpleName}: ${it.message}")
    }.getOrElse { DevicePoll.Failed("서버에 연결하지 못했습니다. 통신 상태를 확인하세요.") }

    internal fun parseStart(status: Int, text: String): DeviceStart {
        val json = runCatching { JSONObject(text) }.getOrNull()
        if (status in 200..299 && json?.optBoolean("ok") == true) {
            val code = json.optString("code").takeIf { it.isNotBlank() } ?: return DeviceStart.Failed("서버가 코드를 주지 않았습니다.")
            val secret = json.optString("secret").takeIf { it.length >= 32 } ?: return DeviceStart.Failed("서버가 비밀값을 주지 않았습니다.")
            val qr = json.optJSONObject("qr")
            val size = qr?.optInt("size") ?: 0
            val rowsArr = qr?.optJSONArray("rows")
            val rows = (0 until (rowsArr?.length() ?: 0)).map { rowsArr!!.getString(it) }
            // 행렬이 깨졌으면(행 수 ≠ size 또는 행 길이 ≠ size) 코드 글자만으로도 승인은 되지만 QR 은 못 그린다 — 빈 행렬로 내린다.
            val validRows = if (size > 0 && rows.size == size && rows.all { it.length == size }) rows else emptyList()
            return DeviceStart.Ok(
                code = code,
                secret = secret,
                expiresInSec = json.optInt("expiresInSec").takeIf { it > 0 } ?: 300,
                pairUrl = json.optString("pairUrl"),
                qrSize = if (validRows.isEmpty()) 0 else size,
                qrRows = validRows,
            )
        }
        return DeviceStart.Failed(
            when (json?.optString("error")) {
                "too_many_requests" -> "요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요."
                "app_auth_not_configured" -> "서버에 앱 로그인이 설정되어 있지 않습니다."
                else -> "QR 로그인을 시작하지 못했습니다 (HTTP $status)."
            },
        )
    }

    internal fun parsePoll(status: Int, text: String): DevicePoll {
        val json = runCatching { JSONObject(text) }.getOrNull()
        if (status == 404) return DevicePoll.Expired          // 코드 없음/불일치 — 새 코드로
        if (status !in 200..299 || json?.optBoolean("ok") != true) {
            return DevicePoll.Failed(
                if (json?.optString("error") == "too_many_requests") "확인 요청이 너무 잦습니다."
                else "승인 상태를 확인하지 못했습니다 (HTTP $status).",
            )
        }
        return when (json.optString("status")) {
            "pending" -> DevicePoll.Pending
            "expired" -> DevicePoll.Expired
            "approved" -> {
                val token = json.optString("token").takeIf { it.isNotBlank() } ?: return DevicePoll.Failed("서버가 토큰을 주지 않았습니다.")
                // ★ AuthClient 와 같은 규칙 — 사번이 비면 업로드가 401 로 조용히 죽는다. 여기서 막는다.
                val workerId = json.optString("workerId").takeIf { it.isNotBlank() && it != "null" }
                    ?: return DevicePoll.Failed("이 계정에 사번이 없습니다. 관리자에게 사번 등록을 요청하세요.")
                val name = json.optString("workerName").takeIf { it.isNotBlank() && it != "null" }
                DevicePoll.Approved(token, workerId, name)
            }
            else -> DevicePoll.Failed("알 수 없는 응답입니다.")
        }
    }

    companion object {
        const val TAG = "VgAuth"
        /** 워치 폴링 주기(ms) — 서버 poll 한도(IP 당 분당 60)의 1/4. */
        const val POLL_INTERVAL_MS = 4_000L
        private val defaultOpen: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }
        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    }
}
