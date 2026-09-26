package com.vitalguard.field

import com.vitalguard.field.capture.*

import java.time.Instant
import java.util.Locale
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureLogicTest {
    // 원본 capture_ocr_test.dart의 동일 좌표/정확도/작업자 표본.
    @Test fun gpsUsesFiveOrSixDigitsAccordingToAccuracy() {
        fun line(accuracy: Double) = captureStampLines(
            capturedAt, CaptureFix(35.1234567, 127.1234567, accuracy), null, "홍길동", "EMP-6861",
        )[1]
        assertTrue(line(44.0).startsWith("35.12346, 127.12346"))
        assertTrue(line(10.0).startsWith("35.123457, 127.123457"))
        assertTrue(Regex("-?\\d{1,3}\\.(\\d{4,}),\\s*-?\\d{1,3}\\.(\\d{4,})").containsMatchIn(line(44.0)))
        assertEquals(5, captureCoordinateDigits(10.0001))
        assertEquals(6, captureCoordinateDigits(10.0))
        assertEquals(6, captureCoordinateDigits(null))
    }

    @Test fun missingLocationIsAnExplicitLine() {
        assertEquals(
            listOf("[2026-08-19 14:07:17]", "위치 미확보", "작업자/ID: 홍길동, EMP-6861"),
            captureStampLines(capturedAt, null, null, "홍길동", "EMP-6861"),
        )
    }

    @Test fun coordinatesOlderThanSixtySecondsCarryTheirAge() {
        val line = captureStampLines(
            capturedAt, CaptureFix(35.12345, 127.12345, measuredAt = capturedAt.minusSeconds(185)),
            null, "홍길동", "EMP-6861",
        )[1]
        assertTrue(line.contains("(3분 전 좌표)"))
    }

    @Test fun estimatedAddressStaysOnOneLineAndShowsItsSource() {
        val lines = captureStampLines(
            capturedAt, CaptureFix(35.12345, 127.12345),
            CaptureAddress("광주광역시\n동구 금남로 1", deviceEstimated = true), "홍길동", "EMP-6861",
        )
        assertEquals("광주광역시 동구 금남로 1 (기기 추정)", lines[1])
    }

    @Test fun timestampIsKstAndDiscardsSubseconds() {
        assertEquals("2026-08-19 14:07:17", captureKstStamp(capturedAt))
        assertEquals("2026-08-19T14:07:17+09:00", captureKstIso(capturedAt.plusMillis(999)))
        assertEquals("2027-01-01T00:00:00+09:00", captureKstIso(Instant.parse("2026-12-31T15:00:00Z")))
    }

    @Test fun uploadFieldsPreserveCoordinatesAndNeverAddIdentity() {
        val fields = captureUploadFields(
            capturedAt, "현장 사진", "페이지 1\n안전난간 점검",
            CaptureFix(35.12345, 127.12345, 44.0),
            CaptureAddress("광주광역시 동구 금남로 1", true), "site-1",
        )
        assertEquals(mapOf(
            "dateKey" to "2026-08-19", "capturedAt" to "2026-08-19T14:07:17+09:00",
            "title" to "현장 사진", "ocrText" to "페이지 1\n안전난간 점검",
            "roadAddress" to "광주광역시 동구 금남로 1 (기기 추정)",
            "latitude" to "35.123450", "longitude" to "127.123450", "siteId" to "site-1",
        ), fields)
        assertFalse(fields.keys.any { it in setOf("uploader", "workerName", "workerId") })
    }

    @Test fun optionalFieldsAreOmittedInsteadOfSerializedAsNull() {
        for (site in listOf(null, "")) {
            assertEquals(
                setOf("dateKey", "capturedAt", "title", "ocrText"),
                captureUploadFields(capturedAt, "현장 사진", "", null, null, site).keys,
            )
        }
    }

    // 추가 경계: 원본의 60초 조건·분 반올림·미래 좌표 clamp·개행 정리를 고정한다.
    @Test fun ageBoundariesAndWorkerNewlinesMatchDart() {
        fun lines(age: Long) = captureStampLines(
            capturedAt, CaptureFix(35.0, 127.0, 10.5, capturedAt.minusSeconds(age)),
            null, " 홍\n길동 ", " EMP\r\n6861 ",
        )
        assertFalse(lines(59)[1].contains("분 전"))
        assertTrue(lines(60)[1].contains("(1분 전 좌표)"))
        assertTrue(lines(90)[1].contains("(2분 전 좌표)"))
        assertFalse(lines(-60)[1].contains("분 전"))
        assertTrue(lines(0)[1].contains("(±11m)"))
        assertEquals("작업자/ID: 홍 길동, EMP 6861", lines(0).last())
    }

    @Test fun formattingDoesNotDependOnDeviceLocaleOrTimezone() {
        val locale = Locale.getDefault()
        val timezone = TimeZone.getDefault()
        try {
            Locale.setDefault(Locale.GERMANY)
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
            assertEquals("2026-08-19 14:07:17", captureKstStamp(capturedAt))
            assertEquals("35.123450", captureUploadFields(capturedAt, "현장 사진", "", CaptureFix(35.12345, 127.12345), null)["latitude"])
        } finally {
            Locale.setDefault(locale)
            TimeZone.setDefault(timezone)
        }
    }
}
