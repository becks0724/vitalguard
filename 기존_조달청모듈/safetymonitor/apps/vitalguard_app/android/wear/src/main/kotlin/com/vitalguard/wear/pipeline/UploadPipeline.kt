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
    // 서버 source 화이트리스트 값 — 갤럭시(Wear OS) 전용. 서버가 이 값으로 dataOrigin 을
    // `wearos_data_vitalguard` 로 확정해 애플(`watchos_…`)과 가른다. 가르는 이유는 이름이 아니라
    // **체온의 성격**이다 — 이쪽은 손목 온도를 실측해 보내고, 애플은 실시간 송출이 없어 손목값에
    // 고정 오프셋을 더한 추정치다. 같은 출처로 섞이면 어느 쪽 값인지 되짚을 수 없다.
    //
    // ⚠ 이 값을 바꾸려면 **서버(`classifyVitalDataOrigin`)를 먼저 배포**해야 한다. 화이트리스트
    // 밖 source 는 store.ts 가 null 로 판정해 버리는데 그 거부는 `persistFailed` 를 세우지 않아,
    // 워치는 201 을 성공으로 읽고 큐에서 원본을 지운다 = 조용한 유실.
    // 가드가 이 문자열과 서버 화이트리스트를 대조한다(2026-08-25-watch-source-origin.guard.test.ts).
    private val sourceTag = "VitAlGuard-GalaxyWatch"

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
