// VitalTransport 의 실구현 — HttpURLConnection POST /api/app/vital (iOS 와 같은 헤더·15초 타임아웃)
package com.vitalguard.wear.pipeline

import android.util.Log
import java.net.HttpURLConnection
import java.net.URL

class HttpTransport(baseUrl: String) : VitalTransport {
    private val endpoint = URL(baseUrl.trimEnd('/') + "/api/app/vital")

    /**
     * ★ 실패 사유를 반드시 남긴다 — `runCatching` 이 예외를 -1 로 삼키면 로그에는 "30초 재시도"만
     * 남아 무한 재시도의 원인을 영영 못 찾는다(2026-08-24 실기에서 실제로 그렇게 막혔다).
     */
    override fun post(token: String, jsonBody: String): Int {
        return runCatching {
            val conn = endpoint.openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 15_000
                conn.readTimeout = 15_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.outputStream.use { it.write(jsonBody.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                if (code !in 200..299) {
                    val err = runCatching {
                        conn.errorStream?.bufferedReader()?.readText()?.take(300)
                    }.getOrNull()
                    Log.w("VgCollector", "업로드 거부 HTTP $code · 본문 ${jsonBody.length}B · 응답: $err")
                }
                code
            } finally {
                conn.disconnect()
            }
        }.onFailure {
            Log.w("VgCollector", "업로드 예외: ${it.javaClass.simpleName}: ${it.message} → $endpoint")
        }.getOrDefault(-1)   // 네트워크 오류 = -1 — 상태기계가 30초 재시도로 읽는다
    }
}
