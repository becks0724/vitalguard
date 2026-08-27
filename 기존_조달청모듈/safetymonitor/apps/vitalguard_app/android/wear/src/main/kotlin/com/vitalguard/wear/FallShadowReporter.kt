// 낙상 섀도 보고 — 판정을 서버에 남긴다. **경보는 안 보낸다** (애플워치 P7 1단계의 wear 이식)
package com.vitalguard.wear

import com.vitalguard.ml.CountdownGuard
import com.vitalguard.ml.FallMLModule
import com.vitalguard.wear.pipeline.IsoMs
import java.util.UUID

/**
 * 애플워치 섀도 계약(WatchStreamer 2026-08-27 · `aea1c18`)의 wear 이식 — 어휘·키·단계 동일.
 *
 * ★ `fallDetected`·`fallDecision` 은 싣지 않는다 — 하나라도 실리면 서버 `recordAlert` 가
 *   텔레그램을 울린다. 오탐률을 재는 동안 경보가 나가면 안 된다(3단계에서 워치가 싣기 시작).
 *
 * 항목 2종:
 * - **candidate** — 모든 판정마다 1건. `fallTrace`(모듈 추적성 계약)를 통째로 싣는다.
 *   기각·무해는 결말이 그 자리에서 확정된다(`not_alerted`). ts = 판정 시각(밀리초)이라
 *   병합 샘플(flush ts)과 UNIQUE(worker_id, ts) 충돌이 없다 — 애플이 심박 항목에 얹은
 *   이유(배치 내 ts 중복)가 wear 의 flush당 1항목 구조에는 없어서 단독 행으로 보낸다.
 * - **prompt_result** — danger 카운트다운의 결말. 서버가 `fallCandidateId` 로 후보 행을
 *   UPDATE 하고 조기 반환하므로(행 삽입 없음) 애플과 같이 단독 항목으로 보낸다.
 *
 * 카운트다운은 모듈의 CountdownGuard 를 **헤드리스로** 돌린다 — wear 는 아직 카운트다운
 * 화면이 없어(다음 단계) 결말이 `moved_cancelled`(지속 움직임)·`auto_escalated`(무반응)
 * 둘뿐이다. `dismissed`("낙상 아님" 버튼)는 UI 가 생길 때 `cancelByUser()` 로 배선한다.
 * 섀도라 무해하다 — 애플도 실감지 진동을 빼서 착용자가 모르는 채 같은 결말이 쌓인다.
 *
 * 스레드 계약: onVerdict·feed 는 IMU 콜백 스레드에서 불린다(상태 접근 단일 스레드).
 * enqueue 는 호출측이 큐 스레드로 넘긴다(CollectorService 는 handler.post).
 */
class FallShadowReporter(
    private val enqueue: (Map<String, Any>) -> Unit,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
    private val guard = CountdownGuard()
    private var activeCandidateId: String? = null
    private var countdownStartedAtMs = 0L

    init {
        guard.onAutoCancel = { outcome("moved_cancelled") }
        guard.onConfirm = { outcome("auto_escalated") }
        // onManualCancel("dismissed") — 카운트다운 UI 단계에서 배선
    }

    /** 판정 1건 → candidate 항목 1건. danger 면 30초 확인 창을 연다. */
    fun onVerdict(v: FallMLModule.Verdict) {
        val id = UUID.randomUUID().toString()
        val item = LinkedHashMap<String, Any>()
        item["ts"] = IsoMs.format(nowMs())
        item["fallCandidateId"] = id
        // 후보 행의 표식 — 서버 갱신 경로가 `fall_candidate = 1` 인 행만 찾는다.
        item["fallCandidate"] = true
        item["fallUpdatePhase"] = "candidate"
        // 피크 G — 기존 필드에 그대로 맞는다(애플과 동일 키).
        item["accelMagnitudeG"] = v.peakG
        // ★ 추적성은 모듈의 계약이다(README) — 이것이 없으면 사후 재현이 불가능하다.
        item["fallTrace"] = v.trace
        // 기각·무해는 여기서 결말 확정(카운트다운이 안 열리므로 후속 항목이 없다).
        if (v.decision != FallMLModule.Decision.DANGER) item["fallPromptOutcome"] = "not_alerted"
        enqueue(item)

        if (v.decision == FallMLModule.Decision.DANGER) {
            // 진행 중 카운트다운이 있으면 애플과 같은 규칙 — 새 후보가 이긴다(이전 후보는 결말 없음).
            activeCandidateId = id
            countdownStartedAtMs = nowMs()
            guard.start(countdownStartedAtMs)
        }
    }

    /** 매 가속 샘플 호출(IMU 콜백에서) — 카운트다운이 열려 있을 때만 일한다. */
    fun feed(totalG: Double) {
        if (activeCandidateId != null) guard.feed(totalG, nowMs())
    }

    private fun outcome(outcome: String) {
        val id = activeCandidateId ?: return
        val item = LinkedHashMap<String, Any>()
        item["ts"] = IsoMs.format(nowMs())
        item["fallCandidateId"] = id
        item["fallUpdatePhase"] = "prompt_result"
        item["fallPromptOutcome"] = outcome
        // 0.1초 정밀도 — 애플(frs) 반올림 규칙과 동일.
        item["fallPromptResponseSec"] = ((nowMs() - countdownStartedAtMs) / 100L) / 10.0
        enqueue(item)
        activeCandidateId = null
    }
}
