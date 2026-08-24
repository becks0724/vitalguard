// 배치 업로드 상태기계 — 배치 ≤500·자격은 전송 시점에 스탬프·재시도 간격은 iOS 와 동일(30s/300s)
package com.vitalguard.wear.pipeline

import org.json.JSONArray
import org.json.JSONObject

/** HTTP 전송 추상화 — 실기는 HttpURLConnection, 시험은 페이크/MockWebServer. 반환 = HTTP 상태(-1 = 네트워크 오류). */
fun interface VitalTransport {
    fun post(token: String, jsonBody: String): Int
}

data class UploadConfig(
    val token: String,
    val workerId: String,
    val workerName: String?,
)

/** flushOnce 의 결과 — 타이머 구동은 호출자(서비스) 몫이라 여기선 다음 행동만 알려준다. */
sealed class FlushOutcome {
    data class Sent(val count: Int, val remaining: Int) : FlushOutcome()
    data class RetryAfterSec(val sec: Int, val authRejected: Boolean = false) : FlushOutcome()
    object Idle : FlushOutcome()
}

class UploadPipeline(
    private val queue: VitalQueue,
    private val transport: VitalTransport,
    private val maxBatchPerRequest: Int = 500,
) {
    // 서버 source 화이트리스트 값 — iOS 와 같은 값을 쓴다(관제 분류가 동일 경로).
    // ⚠ 3단계에서 워치 단독을 가르는 별도 값이 필요한지 재검토한다(관제웹 화이트리스트 수정 동반).
    private val sourceTag = "VitAlGuard-WatchVitals"

    /** 미로그인(config=null)이어도 큐에는 쌓인다 — 업로드만 자격이 생길 때까지 쉰다(iOS 계약). */
    fun flushOnce(config: UploadConfig?): FlushOutcome {
        if (config == null || queue.size == 0) return FlushOutcome.Idle
        val batch = queue.peek(maxBatchPerRequest).map { item ->
            val v = LinkedHashMap(item)
            v["workerId"] = config.workerId
            v["source"] = sourceTag
            config.workerName?.takeIf { it.isNotEmpty() }?.let { v["workerName"] = it }
            v
        }
        val body = JSONArray().also { arr -> batch.forEach { arr.put(JSONObject(it)) } }.toString()
        return when (val status = transport.post(config.token, body)) {
            in 200..299 -> {
                queue.removeFirst(batch.size)
                FlushOutcome.Sent(batch.size, queue.size)
            }
            401, 403 -> FlushOutcome.RetryAfterSec(300, authRejected = true)
            else -> FlushOutcome.RetryAfterSec(30)   // 네트워크(-1)·5xx 공통 — iOS 와 같은 30초
        }
    }
}
