// 규칙(FallDetector 후보) × ML(FallMLPipeline) 융합 레이어 — 기존 코드는 훅 몇 줄로만 연결.
//
// 타이밍: 규칙 후보는 충격+1.2초쯤, ML용 6축 윈도(IMUWindowLogger)는 충격+2초에 나온다
// → 시각으로 짝을 맞춰(pairWindowSec) 둘 다 도착하면 융합 판정을 낸다.
//
// 융합 규칙 (fail-open: ML이 없거나 늦으면 규칙 판정이 그대로 통과 — 알림을 잃지 않는다):
//   · 규칙 .fall + wv≥0.675            → 작업동작 확실 → 알림 억제 (오탐↓)
//   · 규칙 .fall + imp<0.710           → 낙상 충격 근거 부족 → 알림 억제 (흔들기/손목 작업 오탐↓)
//   · 규칙 .fall + imp≥0.710           → 알림
//   · 규칙 .rejectedNoCorroboration + imp≥0.710 + wv<0.675 → ML 구제 알림 (미탐↓)
//   · 그 외 음성                        → 무알림
//
// 스레딩: ingest(candidate:)/ingest(window:) 모두 메인 큐에서 호출할 것(가이드 참조).
import Foundation

final class MLFusion {
    struct Verdict {
        let candidate: FallCandidate
        let wvProb: Double?            // nil = ML 미가용(모델 미탑재/윈도 미도착)
        let impProb: Double?
        let vetoedByML: Bool           // 규칙 발화를 veto가 억제
        let rejectedByImpactML: Bool   // 규칙 발화였지만 낙상 충격 확률이 낮아 억제
        let rescuedByML: Bool          // 규칙 기각을 impact ML이 구제
        var shouldAlert: Bool {
            if vetoedByML { return false }
            if rejectedByImpactML { return false }
            if rescuedByML { return true }
            return candidate.isFall
        }
    }

    var onVerdict: ((Verdict) -> Void)?

    private let pipeline = FallMLPipeline()
    private let pairWindowSec = 4.0    // 후보↔윈도 짝맞춤 허용 시차
    private var pendingCandidate: (FallCandidate, Date)?
    private var pendingWindow: (ImuWindow, Date)?

    func ingest(candidate: FallCandidate) {
        pendingCandidate = (candidate, Date())
        tryFuse()
        // ML 윈도가 pairWindowSec 안에 안 오면 규칙 단독 판정으로 방출(fail-open).
        DispatchQueue.main.asyncAfter(deadline: .now() + pairWindowSec) { [weak self] in
            self?.flushIfStale()
        }
    }

    func ingest(window: ImuWindow) {
        pendingWindow = (window, Date())
        tryFuse()
    }

    private func tryFuse() {
        guard let (cand, ct) = pendingCandidate, let (win, wt) = pendingWindow,
              abs(ct.timeIntervalSince(wt)) <= pairWindowSec else { return }
        pendingCandidate = nil
        pendingWindow = nil
        guard let pl = pipeline else {
            onVerdict?(Verdict(candidate: cand, wvProb: nil, impProb: nil,
                               vetoedByML: false, rejectedByImpactML: false, rescuedByML: false))
            return
        }
        let p = pl.probs(win)
        let vetoed = cand.isFall && p.wv >= FallMLPipeline.vetoThreshold
        let rejectedByImpact = cand.isFall
            && !vetoed
            && p.imp < FallMLPipeline.impactThreshold
        let rescued = cand.decision == .rejectedNoCorroboration
            && p.imp >= FallMLPipeline.impactThreshold
            && p.wv < FallMLPipeline.vetoThreshold
        onVerdict?(Verdict(candidate: cand, wvProb: p.wv, impProb: p.imp,
                           vetoedByML: vetoed, rejectedByImpactML: rejectedByImpact, rescuedByML: rescued))
    }

    private func flushIfStale() {
        guard let (cand, ct) = pendingCandidate, Date().timeIntervalSince(ct) >= pairWindowSec else { return }
        pendingCandidate = nil
        onVerdict?(Verdict(candidate: cand, wvProb: nil, impProb: nil,
                           vetoedByML: false, rejectedByImpactML: false, rescuedByML: false))   // 규칙 단독 통과
    }
}
