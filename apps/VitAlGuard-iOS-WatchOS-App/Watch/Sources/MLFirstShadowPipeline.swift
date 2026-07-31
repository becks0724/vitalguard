// ML-first 전환을 위한 관전 파이프라인.
// 기존 규칙 후보를 입력으로 사용하지 않고, 원시 6축 IMU 스트림으로만 세 모델을 실행한다.
import Foundation

final class MLFirstShadowPipeline {
    struct Observation {
        enum Phase { case fast, recovery }
        let phase: Phase
        let observedAt: Date
        let eventAt: Date
        let impact: FallMLPipeline.Prediction
        let workVeto: FallMLPipeline.Prediction
        let isModelCandidate: Bool
        let recovery: FallMLPipeline.Prediction?
    }

    var onObservation: ((Observation) -> Void)?

    private struct PendingRecovery {
        let eventAt: Date
        let impact: FallMLPipeline.Prediction
        let workVeto: FallMLPipeline.Prediction
    }

    private let queue = DispatchQueue(label: "com.vitalguard.ml-first-shadow", qos: .utility)
    private let pipeline = FallMLPipeline()
    private let fs = FallMLPipeline.fs
    private let fastWindowSec = 3.0
    private let impactLookaheadSec = 1.0
    private let evaluationStrideSec = 0.5
    private let recoveryPreSec = 2.0
    private let recoveryPostSec = 10.0
    private let sampleRetentionSec = 14.0
    private var samples: [ImuSample] = []
    private var lastEvaluationAt: Date?
    private var pendingRecovery: PendingRecovery?

    /// Raw samples arrive from the same motion stream as the legacy detector.
    /// No candidate, alert, ACK, SOS, or server event is emitted from this method.
    func ingest(_ sample: ImuSample) {
        queue.async { [weak self] in self?.ingestOnQueue(sample) }
    }

    private func ingestOnQueue(_ sample: ImuSample) {
        guard let pipeline else { return }
        samples.append(sample)
        trimSamples(endingAt: sample.at)
        resolveRecoveryIfReady(pipeline: pipeline, at: sample.at)
        guard shouldEvaluate(at: sample.at), let fastWindow = makeFastWindow() else { return }
        lastEvaluationAt = sample.at
        let fast = pipeline.fastPredictions(fastWindow.window)
        guard fast.workVeto.isValid, fast.impact.isValid else { return }
        let isCandidate = fast.impact.label && !fast.workVeto.label
        emit(Observation(phase: .fast, observedAt: sample.at, eventAt: fastWindow.eventAt, impact: fast.impact, workVeto: fast.workVeto, isModelCandidate: isCandidate, recovery: nil))
        if isCandidate, pendingRecovery == nil {
            pendingRecovery = PendingRecovery(eventAt: fastWindow.eventAt, impact: fast.impact, workVeto: fast.workVeto)
        }
    }

    private func shouldEvaluate(at now: Date) -> Bool {
        guard let lastEvaluationAt else { return true }
        return now.timeIntervalSince(lastEvaluationAt) >= evaluationStrideSec
    }

    private func makeFastWindow() -> (window: ImuWindow, eventAt: Date)? {
        let required = Int(fastWindowSec * fs)
        guard samples.count >= required else { return nil }
        let windowSamples = Array(samples.suffix(required))
        let lookahead = Int(impactLookaheadSec * fs)
        let impactIndex = max(0, windowSamples.count - lookahead - 1)
        return (ImuWindow(fs: fs, samples: windowSamples.map(\.axes), impactIndex: impactIndex), windowSamples[impactIndex].at)
    }

    private func resolveRecoveryIfReady(pipeline: FallMLPipeline, at now: Date) {
        guard let pendingRecovery else { return }
        let dueAt = pendingRecovery.eventAt.addingTimeInterval(recoveryPostSec)
        guard now >= dueAt else { return }
        defer { self.pendingRecovery = nil }
        let start = pendingRecovery.eventAt.addingTimeInterval(-recoveryPreSec)
        let recoverySamples = samples.filter { $0.at >= start && $0.at <= dueAt }
        guard recoverySamples.count >= Int(fs * 6) else { return }
        let spanSec = max(1, recoverySamples.last!.at.timeIntervalSince(recoverySamples.first!.at))
        let window = ImuWindow(fs: Double(recoverySamples.count) / spanSec, samples: recoverySamples.map(\.axes), impactIndex: recoverySamples.firstIndex { $0.at >= pendingRecovery.eventAt } ?? 0)
        let recovery = pipeline.nonrecoveryPrediction(window, spanSec: spanSec)
        emit(Observation(phase: .recovery, observedAt: now, eventAt: pendingRecovery.eventAt, impact: pendingRecovery.impact, workVeto: pendingRecovery.workVeto, isModelCandidate: true, recovery: recovery))
    }

    private func trimSamples(endingAt now: Date) {
        let cutoff = now.addingTimeInterval(-sampleRetentionSec)
        if let firstKept = samples.firstIndex(where: { $0.at >= cutoff }), firstKept > 0 { samples.removeFirst(firstKept) }
    }

    private func emit(_ observation: Observation) {
        DispatchQueue.main.async { [weak self] in self?.onObservation?(observation) }
    }
}
