// 업로드 대기 큐 — 디스크 영속·상한 5,000·오래된 것부터 폐기 (iOS VitalPipeline 의 큐 계약 이식)
package com.vitalguard.wear.pipeline

import org.json.JSONArray
import org.json.JSONObject

/** 영속 매체 추상화 — 실기는 filesDir 파일, 시험은 임시 파일/메모리. */
interface QueueStorage {
    fun save(text: String)
    fun load(): String?
}

class VitalQueue(
    private val storage: QueueStorage,
    private val maxQueue: Int = 5_000,
) {
    private val pending = mutableListOf<Map<String, Any>>()

    val size: Int get() = pending.size

    /** 프로세스 재기동 시 복원 — 깨진 저장분은 조용히 버리지 않고 건수로 보고한다. */
    fun restore(): Int {
        val text = storage.load() ?: return 0
        return runCatching {
            val arr = JSONArray(text)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val map = LinkedHashMap<String, Any>()
                for (key in obj.keys()) map[key] = obj.get(key)
                pending.add(map)
            }
            arr.length()
        }.getOrDefault(0)
    }

    /** 적재 + 상한 초과분 폐기. 반환값 = 폐기 건수(0 이면 정상). */
    fun add(sample: Map<String, Any>): Int {
        pending.add(sample)
        var dropped = 0
        while (pending.size > maxQueue) {
            pending.removeAt(0)
            dropped++
        }
        persist()
        return dropped
    }

    fun peek(limit: Int): List<Map<String, Any>> = pending.take(limit)

    fun removeFirst(count: Int) {
        repeat(minOf(count, pending.size)) { pending.removeAt(0) }
        persist()
    }

    private fun persist() {
        val arr = JSONArray()
        pending.forEach { arr.put(JSONObject(it)) }
        storage.save(arr.toString())
    }
}
