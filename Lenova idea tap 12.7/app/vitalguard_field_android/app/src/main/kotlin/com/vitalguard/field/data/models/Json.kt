package com.vitalguard.field.data.models

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

// 플랫폼 객체는 이 경계에서만 사용한다. 계약과 서버 모델은 JVM Map/List 값이다.
typealias JsonObject = Map<String, Any?>

fun Any?.jsonObjectOrNull(): JsonObject? =
    (this as? Map<*, *>)?.takeIf { it.keys.all { key -> key is String } }
        ?.entries?.associate { (key, value) -> key as String to value }

object Json {
    fun decode(value: String): Any? {
        val reader = JSONTokener(value)
        val result = unwrap(reader.nextValue())
        require(reader.nextClean() == '\u0000') { "JSON 형식을 확인할 수 없습니다" }
        return result
    }

    fun decodeObject(value: String): JsonObject =
        decode(value).jsonObjectOrNull() ?: error("JSON 형식을 확인할 수 없습니다")

    fun encode(value: Any?): String = when (val wrapped = wrap(value)) {
        is JSONObject, is JSONArray -> wrapped.toString()
        JSONObject.NULL -> "null"
        is String -> JSONObject.quote(wrapped)
        else -> wrapped.toString()
    }

    private fun wrap(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is Map<*, *> -> JSONObject().apply {
            value.forEach { (key, item) -> put(key as String, wrap(item)) }
        }
        is Iterable<*> -> JSONArray().apply { value.forEach { put(wrap(it)) } }
        else -> value
    }

    private fun unwrap(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { unwrap(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { unwrap(value.get(it)) }
        else -> value
    }
}
