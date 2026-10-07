package com.vitalguard.field

// Ports: site_status_test.dart, site_screen_test.dart의 섹션 문구/KST/없는 수치.
// alertTime 사례는 alerts_contract_test.dart의 시각 표시 테스트에서 이식.
import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.site.SiteSummaryState
import java.time.Instant
import java.util.TimeZone
import org.junit.Assert.*
import org.junit.Test

class SiteStatusModelTest {
    @Test fun partialFailureIsIndependentAndAbsentOrInvalidCountsAreNeverZero() {
        val result = SiteStatus(siteStatusReply() + mapOf(
            "gas" to mapOf("ok" to true, "level" to "unknown", "error" to "private"),
            "workers" to mapOf("ok" to true, "level" to "idle"),
            "aed" to mapOf("ok" to true, "level" to "normal", "total" to -1),
            "alerts" to mapOf("ok" to true, "unacked" to null),
        ))
        assertFalse(result.gas.ok); assertNull(result.gas.summary); assertTrue(result.weather.ok)
        assertNull(result.workers.normal); assertNull(result.aed.total)
        assertNull(result.alerts.unacked); assertNull(result.alerts.siteScoped)
        listOf(-1, 1.5, Double.NaN, Double.POSITIVE_INFINITY, "0", true).forEach { value ->
            assertNull(SiteStatusSection(mapOf("ok" to true, "level" to "normal", "total" to value)).total)
        }
    }
    @Test fun zeroIdleNeverReceivedAndFailureHaveDifferentText() {
        val data = SiteStatus(siteStatusReply())
        assertEquals("기상 특보 0건", signalText("weather", data.weather))
        assertEquals("정상 0명 · 대기 0명", signalText("workers", data.workers))
        assertEquals("가스 경보 0건", signalText("gas", data.gas))
        assertEquals("장비 0대 · 점검 필요 0건", signalText("aed", data.aed))
        assertEquals("미대응 경보 0건", alertsText(data.alerts))
        for (id in listOf("weather", "workers", "gas", "aed")) {
            assertEquals("데이터 없음 · 한 번도 받지 못함", signalText(id, null))
            assertEquals("수신 실패 · 이 항목의 상태를 확인할 수 없습니다", signalText(id, SiteStatusSection(mapOf("ok" to false))))
            val idle = SiteStatusSection(mapOf("ok" to true, "level" to "idle"))
            assertEquals(if (id == "aed") "장비 수 데이터 없음 · 요약 데이터 없음" else "데이터 없음 · 수신 또는 전원 대기", signalText(id, idle))
        }
        assertEquals("정상 인원 데이터 없음 · 대기 인원 데이터 없음",
            signalText("workers", SiteStatusSection(mapOf("ok" to true, "level" to "normal"))))
        assertEquals("데이터 없음 · 요약을 받지 못함",
            signalText("gas", SiteStatusSection(mapOf("ok" to true, "level" to "normal"))))
        assertEquals("데이터 없음 · 한 번도 받지 못함", alertsText(null))
        assertEquals("경보 수신 실패 · 미대응 건수를 확인할 수 없습니다", alertsText(SiteStatusAlerts(null)))
        assertEquals("데이터 없음 · 미대응 건수를 받지 못함", alertsText(SiteStatusAlerts(mapOf("ok" to true))))
    }
    @Test fun utcReceiptAndAlertTimeIgnoreDeviceTimezoneAndCrossYear() {
        val original = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
            assertEquals("마지막 수신 2026-09-15 00:13:04 KST", siteStatusReceipt(NOW))
            assertEquals("마지막 수신 2027-01-01 00:00:00 KST", siteStatusReceipt("2026-12-31T15:00:00Z"))
            assertEquals("마지막 수신 없음 · 데이터 없음 (한 번도 받지 못함)", siteStatusReceipt(null))
            assertEquals("2026-09-15 00:13:04 KST", alertTime(NOW))
            assertEquals("2026-09-15 00:13:04 KST", alertTime("2026-09-15T00:13:04+0900"))
            assertEquals("시각 정보 없음", alertTime(null))
            assertEquals("invalid (서버 값)", alertTime("invalid"))
            assertEquals("2026-09-15T00:13:04 (서버 값)", alertTime("2026-09-15T00:13:04"))
        } finally { TimeZone.setDefault(original) }
    }
    @Test fun staleStartsAtFiveMinutesAndDoesNotAlterServerTimestamp() {
        val data = SiteStatus(siteStatusReply())
        assertFalse(SiteSummaryState(data, now = Instant.parse(NOW).plusSeconds(299)).stale)
        assertTrue(SiteSummaryState(data, now = Instant.parse(NOW).plusSeconds(300)).stale)
        assertEquals(NOW, data.fetchedAt)
    }
    @Test fun aedDaysAndAlertRowsDoNotInventServerFields() {
        assertEquals("데이터 없음", aedDueText(null)); assertEquals("3일 지남", aedDueText(-3))
        assertEquals("0일 남음 · 오늘 교환 예정", aedDueText(0)); assertEquals("3일 남음", aedDueText(3))
        val row = mapOf("id" to "1", "worker_id" to "w", "type" to "absence", "ack_at" to null)
        assertNull(AlertItem.tryParse(row - "ack_at"))
        assertNull(AlertItem.tryParse(row + ("ack_at" to "")))
        assertNull(AlertItem.tryParse(row + ("type" to "invented")))
        val alerts = SiteStatusAlerts(mapOf("ok" to true, "items" to listOf(row, row)))
        assertTrue(alerts.itemsAvailable); assertEquals(2, alerts.omittedItems); assertTrue(alerts.items.isEmpty())
        assertEquals("장기 미수신", AlertItem.tryParse(row)!!.type.label)
    }
}
