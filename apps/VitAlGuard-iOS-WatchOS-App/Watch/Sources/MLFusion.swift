import Foundation

/// Existing rule-alert path with ML work-motion veto. It remains fail-open when
/// a model or window is unavailable; it is intentionally separate from ML-first shadow observations.
final class MLFusion {
    struct Verdict {
        let candidate: FallCandidate
        let wvProb: Double?
        let impProb: Double?
        let vetoedByML: Bool
        let rejectedByImpactML: Bool
        var shouldAlert: Bool { !vetoedByML && candidate.isFall }
    }

    var onVerdict: ((Verdict) -> Void)?
    private let pipeline = FallMLPipeline()
    private let pairWindowSec = 4.0
    private var pendingCandidate: (FallCandidate, Date)?
    private var pendingWindow: (ImuWindow, Date)?

    func ingest(candidate: FallCandidate) {
        pendingCandidate = (candidate, Date())
        tryFuse()
        DispatchQueue.main.asyncAfter(deadline: .now() + pairWindowSec) { [weak self] in self?.flushIfStale() }
    }

    func ingest(window: ImuWindow) { pendingWindow = (window, Date()); tryFuse() }

    private func tryFuse() {
        guard let (candidate, candidateAt) = pendingCandidate, let (window, windowAt) = pendingWindow, abs(candidateAt.timeIntervalSince(windowAt)) <= pairWindowSec else { return }
        pendingCandidate = nil; pendingWindow = nil
        guard let pipeline else {
            onVerdict?(
                Verdict(
                    candidate: candidate,
                    wvProb: nil,
                    impProb: nil,
                    vetoedByML: false,
                    rejectedByImpactML: false
                )
            )
            return
        }
        let predictions = pipeline.fastPredictions(window)
        let workVetoProbability = predictions.workVeto.isValid ? predictions.workVeto.probability : nil
        let impactProbability = predictions.impact.isValid ? predictions.impact.probability : nil
        let rejectedByImpact = candidate.isFall
            && impactProbability.map { $0 < FallMLPipeline.impactSuppressBelow } == true
        let vetoed = candidate.isFall && (
            workVetoProbability.map { $0 >= FallMLPipeline.vetoThreshold } == true || rejectedByImpact
        )
        onVerdict?(
            Verdict(
                candidate: candidate,
                wvProb: workVetoProbability,
                impProb: impactProbability,
                vetoedByML: vetoed,
                rejectedByImpactML: rejectedByImpact
            )
        )
    }

    private func flushIfStale() {
        guard let (candidate, candidateAt) = pendingCandidate, Date().timeIntervalSince(candidateAt) >= pairWindowSec else { return }
        pendingCandidate = nil
        onVerdict?(
            Verdict(
                candidate: candidate,
                wvProb: nil,
                impProb: nil,
                vetoedByML: false,
                rejectedByImpactML: false
            )
        )
    }
}
