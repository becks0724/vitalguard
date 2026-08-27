// ML 3종 모듈 — 단일 진입점 (Wear OS 판, Swift FallMLModule 과 동일 계약).
// 계약: 12초 윈도(ImuWindow, 충격 전 2s + 후 10s) 하나를 넣으면 판정+증거+추적정보를 돌려준다.
// 판정 권한: veto(기각) · recovery(위험/회복) 만. impact 는 증거 첨부 전용(거부권 없음, fail-open).
// 모듈 관리: ML 담당(김태곤). 모델·임계 교체는 이 모듈 폴더 교체로만 — 통합 코드는 불변.
package com.vitalguard.ml

import android.content.Context
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.sqrt

class FallMLModule private constructor(private val pipeline: FallMLPipeline) {
    companion object {
        /** 모듈 버전 — 모델 교체·로직 변경 시 반드시 올릴 것 (추적성의 기준점) */
        const val VERSION = "6.1.3"

        /** assets 에 모델 3개(.onnx)가 없으면 null — 통합측은 null 이면 ML 기능 비활성으로 처리. */
        fun create(context: Context): FallMLModule? =
            FallMLPipeline.create(context)?.let { FallMLModule(it) }
    }

    enum class Decision(val raw: String) {
        VETO_WORK("veto_work"),   // 작업동작 확실 → 알림 없음
        DANGER("danger"),         // 비회복 위험 → 카운트다운 진입
        NO_DANGER("no_danger")    // 회복/무해 → 알림 없음
    }

    class Verdict(
        val decision: Decision,
        val workProb: Double,          // work_veto p (기각 임계 0.675)
        val nonrecoveryProb: Double,   // recovery p (위험 임계 0.35, 애매하면 위험)
        val impactProb: Double,        // impact p — 증거 전용(판정 관여 없음)
        // ── 추적성(traceability) — 신고 payload·로그에 그대로 실을 것 ──
        val moduleVersion: String,
        val sampleCount: Int,
        val effectiveHz: Double,       // 스로틀링 실측치 (샘플수÷스팬)
        val peakG: Double,
        val judgedAt: Instant
    ) {
        /** 서버 전송·로그용 — 이 map 이 DB에 남으면 사후 완전 재현 가능 */
        val trace: Map<String, Any>
            get() = mapOf(
                "module_version" to moduleVersion,
                "decision" to decision.raw,
                "p_work" to workProb, "p_nonrecovery" to nonrecoveryProb, "p_impact" to impactProb,
                "samples" to sampleCount, "effective_hz" to effectiveHz, "peak_g" to peakG,
                "judged_at" to judgedAt.truncatedTo(ChronoUnit.SECONDS).toString()
            )
    }

    /** 12초 윈도 1개 → 판정. spanSec = 윈도 벽시계 길이(로거 설정과 일치시킬 것). */
    fun assess(window: ImuWindow, spanSec: Double = 12.0): Verdict {
        val probs = pipeline.probs(window)                     // veto 3s · impact ±1s 슬라이스
        // recovery 모델 부재 시 안전측(위험)으로 — 미탐이 오탐보다 비싸다(봉합 헌법).
        val rec = pipeline.nonrecoveryProb(window, spanSec) ?: 1.0

        val decision = when {
            probs.first >= FallMLPipeline.VETO_THRESHOLD -> Decision.VETO_WORK
            rec >= FallMLPipeline.RECOVERY_THRESHOLD -> Decision.DANGER
            else -> Decision.NO_DANGER
        }

        var peakSq = 0.0
        for (r in window.samples) {
            val x = r[0].toDouble(); val y = r[1].toDouble(); val z = r[2].toDouble()
            val m2 = x * x + y * y + z * z
            if (m2 > peakSq) peakSq = m2
        }

        return Verdict(
            decision = decision,
            workProb = probs.first,
            nonrecoveryProb = rec,
            impactProb = probs.second,
            moduleVersion = VERSION,
            sampleCount = window.samples.size,
            effectiveHz = window.samples.size / spanSec,
            peakG = sqrt(peakSq),
            judgedAt = Instant.now()
        )
    }
}
