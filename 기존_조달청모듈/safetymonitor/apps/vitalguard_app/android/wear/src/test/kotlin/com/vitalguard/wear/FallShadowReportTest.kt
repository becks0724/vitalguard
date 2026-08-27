// 낙상 섀도 보고 가드 — 서버 계약(candidate·prompt_result)이 애플워치판과 같은 모양인가
package com.vitalguard.wear

import com.vitalguard.ml.FallMLModule
import com.vitalguard.ml.FallShadowReporter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * 한 문장 보장 = **워치가 서버에 남기는 낙상 항목이 애플워치 섀도 계약과 같은 키·같은 어휘다.**
 *
 * ★ 왜 여기가 위험한가. 키 하나가 틀려도 아무것도 예외를 던지지 않는다 — zod 스키마의
 *   기본값(strip)이 업로드 도중 조용히 지우고, DB 에는 그 필드만 빈 행이 쌓인다. 오탐률
 *   표를 만들 때에야 "갤럭시 데이터만 없다" 로 드러난다. 그래서 시험이 붙잡아야 한다.
 * ★ 경보 금지 가드 — `fallDetected`·`fallDecision` 이 항목에 실리면 recordAlert 가
 *   텔레그램을 울린다(섀도 위반). 두 키의 부재를 명시적으로 검사한다.
 *
 * 계약 출처 = ios/VitalWatch/WatchStreamer.swift 섀도 구현(`aea1c18`) + store.ts 갱신 경로.
 */
class FallShadowReportTest {

    private var now = 1_726_000_000_000L
    private val items = mutableListOf<Map<String, Any>>()
    private val reporter = FallShadowReporter(enqueue = { items.add(it) }, nowMs = { now })

    private fun verdict(decision: FallMLModule.Decision) = FallMLModule.Verdict(
        decision = decision,
        workProb = 0.11, nonrecoveryProb = 0.80, impactProb = 0.87,
        moduleVersion = FallMLModule.VERSION,
        sampleCount = 600, effectiveHz = 50.0, peakG = 3.2,
        judgedAt = Instant.ofEpochMilli(now),
    )

    /** 1초(50샘플)를 먹인다 — moving=true 면 ±0.5G 요동(sd 0.5), 아니면 정지(sd 0). */
    private fun feedOneSecond(moving: Boolean) {
        repeat(50) { i ->
            now += 20
            reporter.feed(if (moving && i % 2 == 0) 0.5 else if (moving) 1.5 else 1.0)
        }
    }

    @Test
    fun `기각·무해는 candidate 한 건으로 결말까지 확정된다`() {
        reporter.onVerdict(verdict(FallMLModule.Decision.VETO_WORK))
        assertEquals(1, items.size)
        val c = items[0]
        assertEquals("candidate", c["fallUpdatePhase"])
        assertEquals(true, c["fallCandidate"])
        assertEquals("not_alerted", c["fallPromptOutcome"])
        assertEquals(3.2, c["accelMagnitudeG"] as Double, 1e-9)
        // 추적성 계약 — trace 가 통째로 실려야 사후 재현이 가능하다.
        @Suppress("UNCHECKED_CAST")
        val trace = c["fallTrace"] as Map<String, Any>
        assertEquals(FallMLModule.VERSION, trace["module_version"])
        // 섀도 위반 가드 — 이 두 키가 실리면 텔레그램이 울린다.
        assertFalse(c.containsKey("fallDetected"))
        assertFalse(c.containsKey("fallDecision"))
        // 카운트다운이 안 열렸으니 이후 움직임이 결말을 또 만들면 안 된다.
        feedOneSecond(moving = true)
        assertEquals(1, items.size)
    }

    @Test
    fun `danger 는 candidate 에 결말이 없고, 지속 움직임이 moved_cancelled 를 만든다`() {
        reporter.onVerdict(verdict(FallMLModule.Decision.DANGER))
        assertEquals(1, items.size)
        assertNull(items[0]["fallPromptOutcome"])          // 결말은 카운트다운이 정한다
        repeat(5) { feedOneSecond(moving = true) }          // 연속 5초 움직임 → 자동취소
        assertEquals(2, items.size)
        val r = items[1]
        assertEquals("prompt_result", r["fallUpdatePhase"])
        assertEquals("moved_cancelled", r["fallPromptOutcome"])
        assertEquals(items[0]["fallCandidateId"], r["fallCandidateId"])
        // 결말 항목도 fallCandidate=true 를 싣는다 — 서버 빈 샘플 게이트 통과 표식(애플 폰 확장과
        // 동일 와이어 형식). v6.1.1 은 이걸 빼서 결말 54건 전량이 폐기됐다(2026-08-27 실측).
        // trace 는 후보에만 — 결말은 UPDATE 경로라 다시 싣지 않는다.
        assertEquals(true, r["fallCandidate"])
        assertFalse(r.containsKey("fallTrace"))
        assertEquals(5.0, r["fallPromptResponseSec"] as Double, 0.2)
    }

    @Test
    fun `무반응 30초는 auto_escalated 로 확정된다 — 경보 키는 여전히 없다`() {
        reporter.onVerdict(verdict(FallMLModule.Decision.DANGER))
        repeat(31) { feedOneSecond(moving = false) }        // 정지 상태로 30초 경과
        assertEquals(2, items.size)
        val r = items[1]
        assertEquals("auto_escalated", r["fallPromptOutcome"])
        assertTrue(r["fallPromptResponseSec"] as Double >= 30.0)
        assertFalse(r.containsKey("fallDetected"))
        assertFalse(r.containsKey("fallDecision"))
        // 결말 후에는 카운트다운이 닫힌다 — 추가 움직임이 항목을 만들면 안 된다.
        feedOneSecond(moving = true)
        assertEquals(2, items.size)
    }

    @Test
    fun `결말 뒤 새 danger 는 새 후보로 다시 열린다`() {
        reporter.onVerdict(verdict(FallMLModule.Decision.DANGER))
        repeat(5) { feedOneSecond(moving = true) }
        reporter.onVerdict(verdict(FallMLModule.Decision.DANGER))
        repeat(5) { feedOneSecond(moving = true) }
        assertEquals(4, items.size)
        assertTrue(items[0]["fallCandidateId"] != items[2]["fallCandidateId"])
        assertEquals(items[2]["fallCandidateId"], items[3]["fallCandidateId"])
    }
}
