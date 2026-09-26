package com.vitalguard.field.pilot.capture

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/** capture_time_test.dart의 8개 입력/출력 그대로. 카드·상세가 공유하는 순수 표시 함수를 검증. */
@RunWith(Parameterized::class)
class CaptureTimeTest(private val source: String?, private val expected: String) {
    @Test fun timeDisplayKeepsTheOriginalField() {
        val fields = source?.let { mapOf("capturedAt" to it) }.orEmpty()
        val before = fields.toMap()
        assertEquals(expected, captureRecordedTime(fields["capturedAt"]))
        assertEquals(before, fields)
        assertEquals(source, fields["capturedAt"])
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{index}: {0}")
        fun examples(): Collection<Array<Any?>> = listOf(
            arrayOf<Any?>("2026-09-14T02:13:04.759Z", "2026-09-14 11:13:04"),
            arrayOf<Any?>("2026-09-14T11:13:04+09:00", "2026-09-14 11:13:04"),
            arrayOf<Any?>("2026-09-14T11:13:04", "2026-09-14 11:13:04"),
            arrayOf<Any?>("2026-09-14T15:13:04Z", "2026-09-15 00:13:04"),
            arrayOf<Any?>("2026-12-31T15:00:00Z", "2027-01-01 00:00:00"),
            arrayOf<Any?>(null, "촬영 시각 미기록"),
            arrayOf<Any?>("", "촬영 시각 미기록"),
            arrayOf<Any?>("invalid-time", "시각 확인 불가"),
        )
    }
}
