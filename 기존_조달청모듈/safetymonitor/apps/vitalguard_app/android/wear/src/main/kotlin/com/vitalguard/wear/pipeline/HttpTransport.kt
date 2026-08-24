// VitalTransport 의 실구현 — HttpURLConnection POST /api/app/vital (iOS 와 같은 헤더·15초 타임아웃)
package com.vitalguard.wear.pipeline

import java.net.HttpURLConnection
import java.net.URL

class HttpTransport(baseUrl: String) : VitalTransport {
    private val endpoint = URL(baseUrl.trimEnd('/') + "/api/app/vital")

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
                conn.responseCode
            } finally {
                conn.disconnect()
            }
        }.getOrDefault(-1)   // 네트워크 오류 = -1 — 상태기계가 30초 재시도로 읽는다
    }
}
