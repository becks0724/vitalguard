// ML 3종 모듈 — 단일 진입점 (팀원 통합 API).
// 계약: 12초 윈도(ImuWindow, 충격 전 2s + 후 10s) 하나를 넣으면 판정+증거+추적정보를 돌려준다.
// 판정 권한: veto(기각) · recovery(위험/회복) 만. impact 는 증거 첨부 전용(거부권 없음, fail-open).
// 모듈 관리: ML 담당(김태곤). 모델·임계 교체는 이 모듈 폴더 교체로만 — 통합 코드는 불변.
import Foundation

final class FallMLModule {
    /// 모듈 버전 — 모델 교체·로직 변경 시 반드시 올릴 것 (추적성의 기준점)
    static let version = "6.2.0"

    /// 경보 게이트(G) — danger 라도 윈도 피크가 이 값 미만이면 카운트다운(=경보)에 못 들어간다.
    /// 수집 게이트(IMUWindowLogger 1.5)와는 별개다 — 판정·섀도 기록은 계속되므로,
    /// 이 게이트가 놓치는 낙상은 데이터로 남아 사후 실측이 가능하다.
    /// 근거: 섀도 7일 1,431건에서 2.8G 적용 시 오탐 87% 감소(5.29→0.65건/h·애플) ·
    ///   단 트랙A 스윕(낙상 189윈도)의 피크 P50=2.76G 라 매트 기준 낙상 절반이 이 게이트 아래다
    ///   (완충 최악 하한). 증량 재학습 후 2.0~2.2 하향 검토(2026-08-28 결정 1).
    static let alertGateG = 2.8

    struct Verdict {
        enum Decision: String {
            case vetoWork = "veto_work"       // 작업동작 확실 → 알림 없음
            case danger = "danger"            // 비회복 위험 → 카운트다운 진입
            case noDanger = "no_danger"       // 회복/무해 → 알림 없음
        }
        let decision: Decision
        let workProb: Double           // work_veto p (기각 임계 0.675)
        let nonrecoveryProb: Double    // recovery p (위험 임계 0.35, 애매하면 위험)
        let impactProb: Double         // impact p — 증거 전용(판정 관여 없음)
        // ── 추적성(traceability) — 신고 payload·로그에 그대로 실을 것 ──
        let moduleVersion: String
        let sampleCount: Int
        let effectiveHz: Double        // 스로틀링 실측치 (샘플수÷스팬)
        let peakG: Double
        let judgedAt: Date

        /// 경보 게이트 통과 여부 — danger 여도 false 면 카운트다운을 열지 않는다(기록은 남는다).
        var alertGatePassed: Bool { peakG >= FallMLModule.alertGateG }

        /// 서버 전송·로그용 — vital_samples.raw_json 에 남는다(전용 컬럼 없음, 2026-08-28 확인).
        /// ★ 키 계약은 additive-only 다 — 기존 키의 이름·타입·의미는 바꾸지 않고 추가만 한다.
        ///   서버가 이 모양을 근거로 컬럼·도착 가드를 만들 수 있게 고정한 것(결정 4). 모양 판별자는
        ///   module_version. 키 목록의 정본은 통합가이드 "추적정보(trace) 계약" 절.
        var trace: [String: Any] {
            ["module_version": moduleVersion,
             "decision": decision.rawValue,
             "p_work": workProb, "p_nonrecovery": nonrecoveryProb, "p_impact": impactProb,
             "samples": sampleCount, "effective_hz": effectiveHz, "peak_g": peakG,
             "alert_gate_g": FallMLModule.alertGateG, "alert_gate_passed": alertGatePassed,
             "judged_at": ISO8601DateFormatter().string(from: judgedAt)]
        }
    }

    private let pipeline: FallMLPipeline

    /// 번들에 모델 3개(.mlmodelc)가 없으면 nil — 통합측은 nil 이면 ML 기능 비활성으로 처리.
    init?() {
        guard let p = FallMLPipeline() else { return nil }
        pipeline = p
    }

    /// 12초 윈도 1개 → 판정. spanSec = 윈도 벽시계 길이(로거 설정과 일치시킬 것).
    func assess(_ window: ImuWindow, spanSec: Double = 12.0) -> Verdict {
        let probs = pipeline.probs(window)                       // veto 3s · impact ±1s 슬라이스
        // recovery 모델 부재 시 안전측(위험)으로 — 미탐이 오탐보다 비싸다(봉합 헌법).
        let rec = pipeline.nonrecoveryProb(window, spanSec: spanSec) ?? 1.0

        let decision: Verdict.Decision
        if probs.wv >= FallMLPipeline.vetoThreshold {
            decision = .vetoWork
        } else if rec >= FallMLPipeline.recoveryThreshold {
            decision = .danger
        } else {
            decision = .noDanger
        }

        var peakSq = 0.0
        for r in window.samples {
            let x = Double(r[0]), y = Double(r[1]), z = Double(r[2])
            let m2 = x * x + y * y + z * z
            if m2 > peakSq { peakSq = m2 }
        }

        return Verdict(decision: decision,
                       workProb: probs.wv,
                       nonrecoveryProb: rec,
                       impactProb: probs.imp,
                       moduleVersion: Self.version,
                       sampleCount: window.samples.count,
                       effectiveHz: Double(window.samples.count) / spanSec,
                       peakG: peakSq.squareRoot(),
                       judgedAt: Date())
    }
}
