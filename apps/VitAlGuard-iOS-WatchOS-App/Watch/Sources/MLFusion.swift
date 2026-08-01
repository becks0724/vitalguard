import Foundation

/// Existing rule-alert path with ML work-motion and impact suppression. A
/// missing model or unmatched window is held rather than emitted as an alert;
/// ML-first shadow observations remain separate from this alert path.
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
        guard let pipeline else { return }
        let predictions = pipeline.fastPredictions(window)
        // v5 is an ML-gated alert path. A malformed/failed prediction is not
        // evidence that the candidate is safe; drop the candidate instead of
        // letting a nil probability bypass both suppressors.
        guard predictions.workVeto.isValid, predictions.impact.isValid else { return }
        let workVetoProbability = predictions.workVeto.probability
        let impactProbability = predictions.impact.probability
        let rejectedByImpact = candidate.isFall && (
            impactProbability < FallMLPipeline.impactSuppressBelow
                || (candidate.peakG < FallMLPipeline.strongFallThresholdG
                    && impactProbability < FallMLPipeline.impactThreshold)
        )
        let vetoed = candidate.isFall && (
            workVetoProbability >= FallMLPipeline.vetoThreshold || rejectedByImpact
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
        guard let (_, candidateAt) = pendingCandidate, Date().timeIntervalSince(candidateAt) >= pairWindowSec else { return }
        pendingCandidate = nil
        pendingWindow = nil
    }
}
