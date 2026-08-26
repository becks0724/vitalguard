// 워치 단독 로그인 — 관제웹 계정(ID/비번)으로 30일 JWT 를 받는다 (POST /api/app-auth/login)
package com.vitalguard.wear.pipeline

import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 로그인 결과. 실패는 **사용자에게 보일 한국어 문구까지 함께** 든다 —
 * 워치 화면은 좁아서 코드만 던지면 작업자가 무엇을 고쳐야 할지 알 수 없다.
 */
sealed class LoginResult {
    data class Ok(val token: String, val workerId: String, val workerName: String?) : LoginResult()
    data class Failed(val message: String) : LoginResult()
}

class AuthClient(baseUrl: String, private val open: (URL) -> HttpURLConnection = defaultOpen) {
    private val endpoint = URL(baseUrl.trimEnd('/') + "/api/app-auth/login")

    fun login(id: String, password: String): LoginResult {
        if (id.isBlank() || password.isBlank()) return LoginResult.Failed("아이디와 비밀번호를 모두 입력하세요.")
        val body = JSONObject().put("id", id).put("password", password).toString()
        return runCatching {
            val conn = open(endpoint)
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 15_000
                conn.readTimeout = 15_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.readText().orEmpty()
                parse(code, text)
            } finally {
                conn.disconnect()
            }
        }.onFailure {
            // ⚠ 비밀번호는 절대 로그에 싣지 않는다. 남기는 것은 사유뿐이다.
            Log.w(TAG, "로그인 예외: ${it.javaClass.simpleName}: ${it.message} → $endpoint")
        }.getOrElse { LoginResult.Failed("서버에 연결하지 못했습니다. 통신 상태를 확인하세요.") }
    }

    internal fun parse(code: Int, text: String): LoginResult {
        val json = runCatching { JSONObject(text) }.getOrNull()
        if (code in 200..299 && json?.optBoolean("ok") == true) {
            val token = json.optString("token").takeIf { it.isNotBlank() }
                ?: return LoginResult.Failed("서버가 토큰을 주지 않았습니다.")
            val user = json.optJSONObject("user")
            // ★ 사번이 비면 수집 라우트가 401 을 낸다 — 서버 주석이 그 사고를 기록해 뒀다.
            //   빈 채로 저장하면 로그인은 성공한 척하고 업로드만 조용히 죽는다. 여기서 막는다.
            val workerId = user?.optString("workerId")?.takeIf { it.isNotBlank() && it != "null" }
                ?: return LoginResult.Failed("이 계정에 사번이 없습니다. 관리자에게 사번 등록을 요청하세요.")
            val name = user.optString("name").takeIf { it.isNotBlank() && it != "null" }
            return LoginResult.Ok(token, workerId, name)
        }
        val reason = json?.optString("error").orEmpty()
        return LoginResult.Failed(message(code, reason, json))
    }

    private fun message(code: Int, reason: String, json: JSONObject?): String = when (reason) {
        "invalid_credentials" -> "아이디 또는 비밀번호가 맞지 않습니다."
        "not_approved" -> "승인 대기 중인 계정입니다. 관리자에게 문의하세요."
        "too_many_attempts" -> {
            val sec = json?.optInt("retryAfterSec")?.takeIf { it > 0 }
            if (sec != null) "시도가 너무 잦습니다. ${sec}초 뒤에 다시 시도하세요." else "시도가 너무 잦습니다. 잠시 뒤 다시 시도하세요."
        }
        "invalid_request" -> "아이디와 비밀번호를 모두 입력하세요."
        "app_auth_not_configured" -> "서버에 앱 로그인이 설정되어 있지 않습니다."
        else -> "로그인에 실패했습니다 (HTTP $code)."
    }

    companion object {
        const val TAG = "VgAuth"
        private val defaultOpen: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }
    }
}
