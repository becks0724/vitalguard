// danger 후보의 결말 항목 가드 — 카운트다운이 열렸으면 반드시 결말 1건이 큐에 실리는가
package com.vitalguard.wear

import com.vitalguard.ml.FallMLModule
import com.vitalguard.ml.FallShadowReporter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * 한 문장 보장 = **`danger` 판정 하나마다 결말 항목(`prompt_result`) 하나가 큐에 실린다.**
 *
 * ★ 왜 재는가 — 08-28 실측. 서버 DB 의 wear 후보 132건 중 `danger` 62건인데
 *   `fall_prompt_outcome` 이 채워진 행이 **0건**이다. 후보 행은 다 도착했으므로 큐·업로드·서버
 *   갱신 경로(`updateFallCandidateState`)의 문제가 아니라, **결말 항목이 애초에 안 만들어지거나
 *   안 실리거나** 둘 중 하나다. 그 갈림을 기기 없이 여기서 가른다.
 *
 * ⚠ 이 시험은 모듈(`FallShadowReporter`·`CountdownGuard`)을 **고치지 않는다** — 관측만 한다.
 *   빨간불이면 그 사실이 ML 담당 문의의 근거가 된다.
 */
class FallCountdownOutcomeTest {

    private fun dangerVerdict() = FallMLModule.Verdict(
        decision = FallMLModule.Decision.DANGER,
        workProb = 0.23, nonrecoveryProb = 0.64, impactProb = 0.25,
        moduleVersion = FallMLModule.VERSION,
        // peakG 는 경보 게이트(2.8) 위 값이어야 한다 — v6.2.0 부터 게이트 미달 danger 는
        // 카운트다운을 열지 않고 candidate 에서 not_alerted 로 확정된다(결정 1 · 2026-08-28).
        // 종전 실측값 1.89 는 이제 그 경로로 빠지므로, 이 시험의 보장(결말 항목 발행)은
        // 게이트 통과 danger 에 대해서만 성립한다.
        sampleCount = 649, effectiveHz = 54.083333333333336, peakG = 3.2,
        judgedAt = Instant.ofEpochMilli(0L),
    )

    /** 실기와 같은 조건 — 59.6Hz(≈16.8ms 간격)로 먹인다. 모듈 기본 fs 는 50 이다(어긋나는 게 요점). */
    private val STEP_MS = 17L

    @Test
    fun `무반응 30초면 결말 항목이 실린다`() {
        val items = ArrayList<Map<String, Any>>()
        var clock = 1_000_000L
        val r = FallShadowReporter(enqueue = { items.add(it) }, nowMs = { clock })

        r.onVerdict(dangerVerdict())
        assertEquals("후보 항목이 1건 나와야 한다", 1, items.size)
        assertEquals("candidate", items[0]["fallUpdatePhase"])

        // 정지 상태(움직임 없음)로 31초 — 자동취소 조건은 못 채우고 만료로 확정돼야 한다.
        repeat((31_000L / STEP_MS).toInt()) {
            clock += STEP_MS
            r.feed(1.0)
        }

        assertTrue(
            "30초가 지나도 결말 항목이 안 실렸다 — danger 후보가 결말 없이 남는다(DB 실측과 일치).\n항목=$items",
            items.size >= 2,
        )
        val end = items[1]
        assertEquals("prompt_result", end["fallUpdatePhase"])
        assertEquals("auto_escalated", end["fallPromptOutcome"])
        assertEquals("후보와 같은 id 로 갱신돼야 서버가 행을 찾는다",
            items[0]["fallCandidateId"], end["fallCandidateId"])
    }

    @Test
    fun `연속 움직임 5초면 자동 취소로 끝난다`() {
        val items = ArrayList<Map<String, Any>>()
        var clock = 1_000_000L
        val r = FallShadowReporter(enqueue = { items.add(it) }, nowMs = { clock })
        r.onVerdict(dangerVerdict())

        // 표준편차 0.15 이상을 만드는 교대 입력(±0.3G). 6초분이면 1초 버킷 5개를 넘긴다.
        repeat((6_000L / STEP_MS).toInt()) {
            clock += STEP_MS
            r.feed(if (it % 2 == 0) 1.3 else 0.7)
        }

        assertTrue(
            "지속 움직임인데 자동 취소 결말이 안 나왔다.\n항목=$items",
            items.size >= 2,
        )
        assertEquals("moved_cancelled", items[1]["fallPromptOutcome"])
    }
}
