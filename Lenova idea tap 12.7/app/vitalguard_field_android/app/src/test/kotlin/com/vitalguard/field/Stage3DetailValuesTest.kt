package com.vitalguard.field

import com.vitalguard.field.data.models.*
import org.junit.Assert.*
import org.junit.Test

class Stage3DetailValuesTest {
    @Test fun gasNeverGuessesAUnitOrShowsAWaitingReading() {
        val unknown = GasReading.tryParse(mapOf("key" to "co", "value" to 34))!!
        assertEquals("측정값 표시 보류 · 단위를 받지 못했습니다", gasMeasurement(unknown, false))
        val oxygen = GasReading.tryParse(mapOf("key" to "o2", "value" to 20.95, "unit" to "%"))!!
        assertEquals("21.0 %", gasMeasurement(oxygen, false))
        assertEquals("측정 대기 · 수신·전원 대기", gasMeasurement(oxygen, true))
        assertEquals(20.95, oxygen.value!!, 0.00001)
        val co = GasReading.tryParse(mapOf("key" to "co", "value" to 83, "unit" to "raw ADC"))!!
        assertEquals("83.0 raw ADC", gasMeasurement(co, false))
    }
    @Test fun zeroWeatherAndNegativeDueDatesRemainData() {
        assertEquals("0.0 m/s", metricValue(0.0 / 3.6, "m/s"))
        assertEquals("데이터 없음", metricValue(null, "℃"))
        assertEquals("5일 지남", aedDueText(-5)); assertEquals("0일 남음 · 오늘 교환 예정", aedDueText(0))
    }
    @Test fun locationNeverSurvivesMissingOrRedactedPermissionAndStaleFilterOverlapsDanger() {
        fun workers(redacted: Boolean?) = SiteStatusWorkers(mapOf("ok" to true, "level" to "danger", "piiRedacted" to redacted,
            "items" to listOf(mapOf("workerId" to "w", "tone" to "danger", "stale" to true, "latitude" to 35.1, "longitude" to 126.9))))
        for (hidden in listOf(true, null)) {
            val d = workers(hidden); val row = d.items.single()
            assertNull(row.latitude); assertNull(row.longitude); assertFalse(workerLocation(row, hidden).contains("35.1"))
            assertTrue(WorkerFilter.stale.matches(row)); assertTrue(WorkerFilter.danger.matches(row))
        }
        assertTrue(workerLocation(workers(false).items.single(), false).contains("35.1"))
    }
}
