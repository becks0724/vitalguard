package com.vitalguard.field.data.models

import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

// Port: lib/data/models/site_status.dart. 구성 요소별 실패 격리, 없는 수치는 null.
private val levels = setOf("normal", "warn", "danger", "idle")
private val zonedSuffix = Regex("(Z|[+-]\\d{2}:?\\d{2})$")
private val compactOffset = Regex("([+-]\\d{2})(\\d{2})$")
private val kst = ZoneOffset.ofHours(9)
private val displayTime = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss", Locale.ROOT)

fun parseInstant(value: String): Instant {
    val normalized = value.replace(compactOffset, "$1:$2")
    return if (zonedSuffix.containsMatchIn(value)) OffsetDateTime.parse(normalized).toInstant()
    else LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant()
}

fun parseInstantOrNull(value: String?): Instant? = try {
    value?.let(::parseInstant)
} catch (_: Exception) { null }

private fun zonedTime(value: Any?): String? =
    (value as? String)?.takeIf { zonedSuffix.containsMatchIn(it) && parseInstantOrNull(it) != null }
private fun text(value: Any?): String? = when (value) {
    is String, is Number -> value.toString().trim().takeIf { it.isNotEmpty() }
    else -> null
}
private fun gasText(value: Any?): String? = (value as? String)?.takeIf { it.isNotBlank() }
private fun finiteNumber(value: Any?): Double? = (value as? Number)?.toDouble()?.takeIf { it.isFinite() }
private fun count(value: Any?): Int? = finiteNumber(value)?.takeIf {
    it >= 0 && it == floor(it) && it <= Int.MAX_VALUE
}?.toInt()
private fun signedDays(value: Any?): Int? = finiteNumber(value)?.takeIf {
    it == floor(it) && it >= Int.MIN_VALUE && it <= Int.MAX_VALUE
}?.toInt()
private fun coordinate(value: Any?, limit: Int): Double? = finiteNumber(value)?.takeIf { abs(it) <= limit }
private fun sectionLevel(value: Any?): String? = (value as? String)?.takeIf { it in levels }
private fun warningSeverity(value: Any?): String? = (value as? String)?.takeIf { it in setOf("normal", "caution", "danger") }
private fun sectionRow(value: Any?) =
    value.jsonObjectOrNull()?.takeIf { it["ok"] == true && sectionLevel(it["level"]) != null }

private fun <T : Any> uniqueRows(rows: List<*>, parse: (Any?) -> T?, key: (T) -> String): List<T> {
    val parsed = rows.mapNotNull(parse)
    val duplicates = parsed.groupingBy(key).eachCount().filterValues { it > 1 }.keys
    return parsed.filter { key(it) !in duplicates }
}

class SiteStatus(json: JsonObject) {
    val fetchedAt: String = (json["fetchedAt"] as? String)?.takeIf {
        json["ok"] == true && Regex("(Z|\\+00:00)$").containsMatchIn(it) && parseInstantOrNull(it) != null
    } ?: throw IllegalArgumentException("현장 수신 시각을 확인할 수 없습니다")
    val weather = SiteStatusWeather(json["weather"])
    val workers = SiteStatusWorkers(json["workers"])
    val gas = SiteStatusGas(json["gas"])
    val aed = SiteStatusAed(json["aed"])
    val alerts = SiteStatusAlerts(json["alerts"])
}

open class SiteStatusSection private constructor(row: JsonObject?, @Suppress("UNUSED_PARAMETER") parsed: Unit) {
    constructor(value: Any?) : this(sectionRow(value), Unit)
    // row는 생성자 임시 인자다. 오류 원문/미선택 개인정보 Map을 인스턴스에 보관하지 않는다.
    val ok = row != null
    val level = row?.get("level") as? String
    val summary = (row?.get("summary") as? String)?.trim()?.takeIf { it.isNotEmpty() }
    val normal = count(row?.get("normal"))
    val waiting = count(row?.get("waiting"))
    val total = count(row?.get("total"))
}

class SiteStatusAed private constructor(value: Any?, rows: List<*>?) : SiteStatusSection(value) {
    constructor(value: Any?) : this(value, sectionRow(value)?.get("devices") as? List<*>)
    val devicesAvailable = rows != null
    val devices = uniqueRows(rows.orEmpty(), AedDevice::tryParse) { it.deviceId }
    val omittedDevices = (rows?.size ?: 0) - devices.size
}

class AedDevice private constructor(row: JsonObject, val deviceId: String) {
    val loc = text(row["loc"])
    val level = sectionLevel(row["level"])
    val summary = text(row["summary"])
    val batteryDueDays = signedDays(row["batteryDueDays"])
    val padsDueDays = signedDays(row["padsDueDays"])
    companion object {
        fun tryParse(value: Any?): AedDevice? {
            val row = value.jsonObjectOrNull() ?: return null
            return AedDevice(row, text(row["deviceId"]) ?: return null)
        }
    }
}

fun aedDueText(days: Int?): String = when {
    days == null -> "데이터 없음"
    days < 0 -> "${-days.toLong()}일 지남"
    days == 0 -> "0일 남음 · 오늘 교환 예정"
    else -> "${days}일 남음"
}

class SiteStatusWeather private constructor(row: JsonObject?, @Suppress("UNUSED_PARAMETER") parsed: Unit) : SiteStatusSection(row) {
    constructor(value: Any?) : this(sectionRow(value), Unit)
    val lat = coordinate(row?.get("lat"), 90)
    val lon = coordinate(row?.get("lon"), 180)
    val coordSource = text(row?.get("coordSource"))
    val source = text(row?.get("source"))
    val cached = row?.get("cached") as? Boolean
    val stale = row?.get("stale") as? Boolean
    val persisted = row?.get("persisted") as? Boolean
    val fetchedAt = zonedTime(row?.get("fetchedAt"))
    val current = row?.get("current").jsonObjectOrNull()?.let(::WeatherCurrent)
    val conditions = row?.get("conditions").jsonObjectOrNull()?.let(::WeatherConditions)
    val forecast = (row?.get("forecast") as? List<*>).orEmpty().mapNotNull(WeatherForecastDay::parse).distinctBy { it.date }.take(7)
    val warning = row?.get("warning").jsonObjectOrNull()?.let(::WeatherWarning)
    val effects = row?.get("effects").jsonObjectOrNull()?.let(::WeatherEffects) ?: WeatherEffects()
    // 관제 판정이 있는 다섯 항목만 받는다. 숫자로 임계를 추측하거나 종합 level을 복제하지 않는다.
    val metricLevels = row?.get("metricLevels").jsonObjectOrNull().let { data ->
        listOf("apparent", "wind", "rain", "uv", "pm25").associateWith { key ->
            (data?.get(key) as? String)?.takeIf { it in setOf("normal", "warn", "danger") }
        }
    }
    val headlineBasis: String? get() {
        if (level != "warn" && level != "danger") return null
        return listOf("기상특보" to "발효특보", "예비특보" to "예비특보", "체감온도" to "체감온도",
            "불쾌지수" to "불쾌지수", "미세먼지 PM2.5" to "미세먼지 PM2.5", "풍속" to "풍속",
            "자외선지수" to "자외선지수", "강수량" to "강수량")
            .firstOrNull { summary?.startsWith(it.first + " ") == true }?.second
    }
}

class WeatherConditions(row: JsonObject) {
    val level = sectionLevel(row["level"])
    val summary = text(row["summary"])
}
class WeatherForecastDay private constructor(row: JsonObject, val date: java.time.LocalDate) {
    val weatherCode = finiteNumber(row["weatherCode"])?.takeIf { it % 1.0 == 0.0 }?.toInt()
    val label = text(row["label"])
    val highC = finiteNumber(row["highC"])
    val lowC = finiteNumber(row["lowC"])
    val precipitationProbabilityPct = finiteNumber(row["precipitationProbabilityPct"])?.takeIf { it in 0.0..100.0 }
    companion object {
        fun parse(value: Any?): WeatherForecastDay? {
            val row = value.jsonObjectOrNull() ?: return null
            val date = try { java.time.LocalDate.parse(row["date"] as? String ?: return null) } catch (_: Exception) { return null }
            return WeatherForecastDay(row, date)
        }
    }
}

data class WeatherEffects(val precipitation: String = "unknown", val windDanger: Boolean = false) {
    constructor(row: JsonObject) : this(
        (row["precipitation"] as? String)?.takeIf { row["precipitationSource"] == "kma-ncst" && it in setOf("none", "rain", "snow", "mixed") } ?: "unknown",
        row["windDanger"] == true,
    )
    val rain get() = precipitation == "rain" || precipitation == "mixed"
    val snow get() = precipitation == "snow" || precipitation == "mixed"
    val active get() = rain || snow || windDanger
}

class WeatherCurrent(row: JsonObject) {
    val weatherCode = finiteNumber(row["weatherCode"])?.takeIf { it % 1.0 == 0.0 }?.toInt()

    val temperatureC = finiteNumber(row["temperatureC"])
    val humidityPct = finiteNumber(row["humidityPct"])
    val apparentTempC = finiteNumber(row["apparentTempC"])
    val windKmh = finiteNumber(row["windKmh"])
    val windGustKmh = finiteNumber(row["windGustKmh"])
    val precipitationMm = finiteNumber(row["precipitationMm"])
    val uvIndex = finiteNumber(row["uvIndex"])
    val pm10 = finiteNumber(row["pm10"])
    val pm25 = finiteNumber(row["pm25"])
    val wbgt = finiteNumber(row["wbgt"])
    val obsSource = text(row["obsSource"])
    val obsAt = zonedTime(row["obsAt"])
}

class WeatherWarning private constructor(row: JsonObject, activeRows: List<*>?, preliminaryRows: List<*>?) {
    constructor(row: JsonObject) : this(row, row["warnings"] as? List<*>, row["preliminary"] as? List<*>)
    val source = text(row["source"])
    val sido = text(row["sido"])
    val severity = warningSeverity(row["severity"])
    val summary = text(row["summary"])
    val preliminarySeverity = warningSeverity(row["preliminarySeverity"])
    val preliminarySummary = text(row["preliminarySummary"])
    val warningsAvailable = activeRows != null
    val preliminaryAvailable = preliminaryRows != null
    val warnings = activeRows.orEmpty().mapNotNull { WeatherWarningItem.tryParse(it, false) }
    val preliminary = preliminaryRows.orEmpty().mapNotNull { WeatherWarningItem.tryParse(it, true) }
    val omittedWarnings = (activeRows?.size ?: 0) - warnings.size
    val omittedPreliminary = (preliminaryRows?.size ?: 0) - preliminary.size
}

class WeatherWarningItem private constructor(row: JsonObject, val type: String, preliminary: Boolean) {
    val level = if (preliminary) null else text(row["level"])
    val `when` = if (preliminary) text(row["when"]) else null
    val regions = (row["regions"] as? List<*>).orEmpty().filterIsInstance<String>().filter { it.isNotBlank() }
    val otherRegionCount = count(row["otherRegionCount"])
    companion object {
        fun tryParse(value: Any?, preliminary: Boolean): WeatherWarningItem? {
            val row = value.jsonObjectOrNull() ?: return null
            return WeatherWarningItem(row, text(row["type"]) ?: return null, preliminary)
        }
    }
}

class SiteStatusGas private constructor(row: JsonObject?, rows: List<*>?) : SiteStatusSection(row) {
    constructor(value: Any?) : this(sectionRow(value), sectionRow(value)?.get("gases") as? List<*>)
    val deviceId = gasText(row?.get("deviceId"))
    val lastSeenAt = zonedTime(gasText(row?.get("lastSeenAt")))
    val environment = row?.get("environment").jsonObjectOrNull()?.takeIf { it["source"] == "gaspod" }?.let(::IndoorEnvironment)
    val power = row?.get("power").let {
        if (it is Boolean || finiteNumber(it) != null) it.toString() else gasText(it)
    }
    val gasesAvailable = rows != null
    val gases = uniqueRows(rows.orEmpty(), GasReading::tryParse) { it.key }
    val omittedGases = (rows?.size ?: 0) - gases.size
}

class IndoorEnvironment(row: JsonObject) {
    val temperatureC = finiteNumber(row["temperatureC"])
    val humidityPct = finiteNumber(row["humidityPct"])
    val pressureHpa = finiteNumber(row["pressureHpa"])
    val checkedAt = zonedTime(row["checkedAt"])
    val validForMs = finiteNumber(row["validForMs"])?.takeIf { it >= 0 && it <= 60_000 }?.toLong()
}

class GasReading private constructor(row: JsonObject, val key: String) {
    val gas = gasText(row["gas"])
    val loc = gasText(row["loc"])
    val level = sectionLevel(row["level"])
    val value = finiteNumber(row["value"])
    val unit = gasText(row["unit"])
    companion object {
        fun tryParse(value: Any?): GasReading? {
            val row = value.jsonObjectOrNull() ?: return null
            val key = (row["key"] as? String)?.takeIf { it in setOf("o2", "co", "h2s") } ?: return null
            return GasReading(row, key)
        }
    }
}

class SiteStatusWorkers private constructor(row: JsonObject?, rows: List<*>?) : SiteStatusSection(row) {
    constructor(value: Any?) : this(sectionRow(value), sectionRow(value)?.get("items") as? List<*>)
    val caution = count(row?.get("caution"))
    val danger = count(row?.get("danger"))
    val stale = count(row?.get("stale"))
    val piiRedacted = row?.get("piiRedacted") as? Boolean
    val fetchedAt = zonedTime(row?.get("fetchedAt"))
    val itemsAvailable = rows != null
    val items = uniqueRows(rows.orEmpty(), { WorkerItem.tryParse(it, piiRedacted == false) }) { it.workerId }
    val omittedItems = (rows?.size ?: 0) - items.size
}

class WorkerItem private constructor(row: JsonObject, val workerId: String, exposeLocation: Boolean) {
    val name = text(row["name"])
    val jobTitle = text(row["jobTitle"])
    val tone = (row["tone"] as? String)?.takeIf { it in setOf("normal", "caution", "danger", "idle") }
    val label = text(row["label"])
    val staleLabel = text(row["staleLabel"])
    val heartRate = finiteNumber(row["heartRate"])
    val spo2 = finiteNumber(row["spo2"])
    val skinTempC = finiteNumber(row["skinTempC"])
    val coreTempC = finiteNumber(row["coreTempC"])
    val worn = row["worn"] as? Boolean
    val lastSeenAt = text(row["lastSeenAt"])
    val ageSec = count(row["ageSec"])
    val stale = row["stale"] as? Boolean
    val latitude = if (exposeLocation) coordinate(row["latitude"], 90) else null
    val longitude = if (exposeLocation) coordinate(row["longitude"], 180) else null
    val locationAccuracyMeters = if (exposeLocation) finiteNumber(row["locationAccuracyMeters"])?.takeIf { it >= 0 } else null
    companion object {
        fun tryParse(value: Any?, exposeLocation: Boolean): WorkerItem? {
            val row = value.jsonObjectOrNull() ?: return null
            return WorkerItem(row, text(row["workerId"]) ?: return null, exposeLocation)
        }
    }
}

class SiteStatusAlerts private constructor(row: JsonObject?, rows: List<*>?) {
    constructor(value: Any?) : this(
        value.jsonObjectOrNull()?.takeIf { it["ok"] == true },
        value.jsonObjectOrNull()?.takeIf { it["ok"] == true }?.get("items") as? List<*>,
    )
    val ok = row != null
    val unacked = count(row?.get("unacked"))
    val siteScoped = row?.get("siteScoped") as? Boolean
    val itemsAvailable = rows != null
    val items = uniqueRows(rows.orEmpty(), AlertItem::tryParse) { it.id }
    val omittedItems = (rows?.size ?: 0) - items.size
}

enum class AlertType(val label: String) {
    sos("SOS"), fall("낙상"), vital("생체 이상"), geofence("구획 이탈"), absence("장기 미수신")
}

class AlertItem private constructor(
    val id: String, val workerId: String?, val workerName: String?, val type: AlertType,
    val ts: String?, val createdAt: String?, val ackAt: String?, val ackBy: String?,
) {
    val acknowledged get() = ackAt != null
    fun sameOccurrence(other: AlertItem) = id == other.id && workerId == other.workerId &&
        type == other.type && ts == other.ts && createdAt == other.createdAt
    companion object {
        fun tryParse(value: Any?): AlertItem? {
            val row = value.jsonObjectOrNull() ?: return null
            val id = text(row["id"]) ?: return null
            val type = AlertType.entries.firstOrNull { it.name == row["type"] } ?: return null
            if (!row.containsKey("ack_at") || (row["ack_at"] != null && text(row["ack_at"]) == null)) return null
            return AlertItem(id, text(row["worker_id"]), text(row["worker_name"]), type,
                text(row["ts"]), text(row["created_at"]), text(row["ack_at"]), text(row["ack_by"]))
        }
    }
}

fun alertTime(value: String?): String {
    if (value == null) return "시각 정보 없음"
    if (zonedTime(value) == null) return "$value (서버 값)"
    return displayTime.format(parseInstant(value).atOffset(kst)) + " KST"
}

fun siteStatusReceipt(fetchedAt: String?): String = if (fetchedAt == null)
    "마지막 수신 없음 · 데이터 없음 (한 번도 받지 못함)"
else "마지막 수신 " + displayTime.format(parseInstant(fetchedAt).atOffset(kst)) + " KST"

// Port: site_screen.dart의 _signalText/_alertsText. JVM에서 화면 문구도 함께 검증한다.
fun signalText(id: String, section: SiteStatusSection?): String {
    if (section == null) return "데이터 없음 · 한 번도 받지 못함"
    if (!section.ok) return "수신 실패 · 이 항목의 상태를 확인할 수 없습니다"
    if (section.level == "idle" && id != "aed") return "데이터 없음 · 수신 또는 전원 대기"
    if (id == "workers") {
        val normal = section.normal?.let { "정상 ${it}명" } ?: "정상 인원 데이터 없음"
        val waiting = section.waiting?.let { "대기 ${it}명" } ?: "대기 인원 데이터 없음"
        return "$normal · $waiting"
    }
    if (id == "aed") {
        val total = section.total?.let { "장비 ${it}대" } ?: "장비 수 데이터 없음"
        return "$total · " + (section.summary ?: "요약 데이터 없음")
    }
    return section.summary ?: "데이터 없음 · 요약을 받지 못함"
}

fun alertsText(alerts: SiteStatusAlerts?): String = when {
    alerts == null -> "데이터 없음 · 한 번도 받지 못함"
    !alerts.ok -> "경보 수신 실패 · 미대응 건수를 확인할 수 없습니다"
    alerts.unacked == null -> "데이터 없음 · 미대응 건수를 받지 못함"
    else -> "미대응 경보 ${alerts.unacked}건"
}
