package com.vitalguard.field.data.models

import java.util.Locale

fun metricValue(value: Double?, unit: String, digits: Int = 1): String =
    (value?.let { String.format(Locale.ROOT, "%.${digits}f", it) } ?: "데이터 없음") + if (value == null || unit.isEmpty()) "" else " $unit"
fun gasMeasurement(item: GasReading?, waiting: Boolean): String = when {
    waiting -> "측정 대기 · 수신·전원 대기"
    item?.value == null -> "측정값 없음 · 값을 받지 못했습니다"
    item.unit == null -> "측정값 표시 보류 · 단위를 받지 못했습니다"
    item.key == "o2" && item.unit == "%" -> metricValue(item.value, item.unit, 1)
    else -> "${item.value} ${item.unit}"
}
fun workerLocation(item: WorkerItem, redacted: Boolean?): String = when (redacted) {
    true -> "위치 가림 · 개인정보 보호 설정 적용"
    null -> "위치 표시 보류 · 가림 여부 확인 후 표시합니다"
    false -> if (item.latitude == null || item.longitude == null) "위치 데이터 없음 · 서버에서 좌표를 받지 못했습니다"
        else "마지막 수신 위치 · 위도 ${item.latitude} · 경도 ${item.longitude}\n위치 정확도 ${metricValue(item.locationAccuracyMeters, "m", 0)}"
}
enum class WorkerFilter(val label: String) {
    all("전체"), normal("정상"), caution("주의"), danger("위험"), idle("대기"), stale("끊김");
    fun matches(item: WorkerItem) = when (this) { all -> true; stale -> item.stale == true; else -> item.tone == name }
    fun count(data: SiteStatusWorkers): Int? = when (this) {
        all -> data.total; normal -> data.normal; caution -> data.caution; danger -> data.danger; idle -> data.waiting; stale -> data.stale
    }
}
