package com.vitalguard.field.data.mock

import com.vitalguard.field.data.models.*

/** Deterministic, explicitly synthetic previews/instrumentation. Never merges with live data. */
fun stage3SampleStatus(now: String, acknowledged: Boolean = false, mixedWorkers: Boolean = false): SiteStatus = SiteStatus(mapOf(
    "ok" to true, "fetchedAt" to now,
    "weather" to mapOf("ok" to true, "level" to "warn", "summary" to "풍속 주의 · 모의 자료", "lat" to 35.0, "lon" to 127.0,
        "coordSource" to "site", "source" to "모의 관측", "cached" to false, "stale" to false, "fetchedAt" to now,
        "current" to mapOf("temperatureC" to 27.2, "humidityPct" to 68, "apparentTempC" to 28.1, "windKmh" to 18,
            "windGustKmh" to 36, "precipitationMm" to 0, "uvIndex" to 3.2, "pm10" to 18, "pm25" to 7, "wbgt" to 23.4,
            "obsSource" to "모의 관측", "obsAt" to now),
        "warning" to mapOf("source" to "mock", "sido" to "모의 지역", "summary" to "모의 강풍주의보", "severity" to "caution",
            "warnings" to listOf(mapOf("type" to "강풍", "level" to "주의보", "regions" to listOf("모의 현장"))),
            "preliminary" to emptyList<Any>(), "preliminarySummary" to "예비특보 없음")),
    "workers" to if (mixedWorkers) mapOf("ok" to true, "level" to "danger", "summary" to "모의 작업자 분포", "total" to 10,
        "normal" to 5, "caution" to 2, "danger" to 1, "waiting" to 2, "stale" to 0, "piiRedacted" to true, "fetchedAt" to now,
        "items" to (0 until 10).map { i ->
            val tone = when { i < 5 -> "normal"; i < 7 -> "caution"; i == 7 -> "danger"; else -> "idle" }
            mapOf("workerId" to if (i == 7) "mock-b" else "mixed-$i", "name" to "모의 작업자 ${i + 1}", "tone" to tone,
                "label" to when (tone) { "normal" -> "정상"; "caution" -> "주의"; "danger" -> "위험"; else -> "미수신" }, "stale" to false)
        }) else mapOf("ok" to true, "level" to "danger", "summary" to "모의 작업자", "total" to 2, "normal" to 1,
        "danger" to 1, "caution" to 0, "waiting" to 0, "stale" to 1, "piiRedacted" to true, "fetchedAt" to now,
        "items" to listOf(
            mapOf("workerId" to "mock-a", "name" to "모의 작업자 A", "tone" to "normal", "label" to "정상", "stale" to false,
                "heartRate" to 75, "skinTempC" to 33.2, "worn" to true, "lastSeenAt" to now, "ageSec" to 3),
            mapOf("workerId" to "mock-b", "name" to "모의 작업자 B", "tone" to "danger", "label" to "위험", "stale" to true,
                "heartRate" to 145, "latitude" to 35.0, "longitude" to 127.0, "worn" to true, "lastSeenAt" to now, "ageSec" to 400))),
    "gas" to mapOf("ok" to true, "level" to "normal", "summary" to "모의 가스 자료", "deviceId" to "mock-gas", "lastSeenAt" to now,
        "gases" to listOf(mapOf("key" to "o2", "gas" to "O₂ 산소", "level" to "normal", "value" to 20.9, "unit" to "%"),
            if (mixedWorkers) mapOf("key" to "co", "gas" to "CO 일산화탄소", "level" to "normal", "value" to 30, "unit" to "raw")
                else mapOf("key" to "co", "gas" to "CO 일산화탄소", "level" to "warn", "value" to 30),
            mapOf("key" to "h2s", "gas" to "H₂S 황화수소", "level" to "normal", "value" to 0, "unit" to "ppm"))),
    "aed" to mapOf("ok" to true, "level" to "warn", "summary" to "모의 교환 기한 확인", "total" to 1,
        "devices" to listOf(mapOf("deviceId" to "mock-aed", "loc" to "모의 관리실", "level" to "warn", "batteryDueDays" to -2, "padsDueDays" to 30))),
    "alerts" to mapOf("ok" to true, "siteScoped" to true, "unacked" to if (acknowledged) 0 else 1,
        "items" to listOf(mapOf("id" to "42", "worker_id" to "mock-b", "worker_name" to "모의 작업자 B", "type" to "fall",
            "ts" to now, "created_at" to now, "ack_at" to if (acknowledged) now else null, "ack_by" to if (acknowledged) "모의 처리자" else null))),
))
