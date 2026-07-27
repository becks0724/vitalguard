// ML-first 전환을 위한 관전 파이프라인.
//
// FallDetector의 자유낙하·G·정지 규칙을 후보 입력으로 쓰지 않는다. 같은 Core Motion
// 스트림을 직접 받아 3초 rolling window에서 impact/work_veto를, 후보 뒤 12초에서
// recovery를 실행한다. 아직 경보를 만들지 않으며, 실측으로 주 탐지 운영점을 검증한 뒤
// 기존 규칙 경로를 대체하기 위한 안전한 전환 단계다.
import Foundation

final class MLFirstShadowPipeline {
    struct Observation {
        enum Phase {
            case fast
            case recovery
        }

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

    /// FallDetector의 판정 결과가 아니라 원시 센서 샘플로 호출한다.
    func ingest(_ sample: ImuSample) {
        queue.async { [weak self] in
            self?.ingestOnQueue(sample)
        }
    }

    private func ingestOnQueue(_ sample: ImuSample) {
        guard let pipeline else { return }
        samples.append(sample)
        trimSamples(endingAt: sample.at)
        resolveRecoveryIfReady(pipeline: pipeline, at: sample.at)

        guard shouldEvaluate(at: sample.at), let fastWindow = makeFastWindow() else { return }
        lastEvaluationAt = sample.at
        let fast = pipeline.fastPredictions(fastWindow.window)

        // 여기에는 2.8G 같은 물리 규칙이 없다. Core ML이 내보낸 학습 label만 사용해
        // 관전 후보를 만든다. 이 후보는 알림·SOS·서버 사건을 만들지 않는다.
        let isCandidate = fast.impact.label && !fast.workVeto.label
        let observation = Observation(
            phase: .fast,
            observedAt: sample.at,
            eventAt: fastWindow.eventAt,
            impact: fast.impact,
            workVeto: fast.workVeto,
            isModelCandidate: isCandidate,
            recovery: nil
        )
        emit(observation)

        // 하나의 후보에 대해서만 recovery를 대기한다. 중복 감지는 12초 결과가 나온 뒤
        // 다음 후보를 관찰해 모델의 실제 이벤트 분포를 왜곡하지 않는다.
        if isCandidate, pendingRecovery == nil {
            pendingRecovery = PendingRecovery(
                eventAt: fastWindow.eventAt,
                impact: fast.impact,
                workVeto: fast.workVeto
            )
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
        // impact 모델은 충격 전후 1초 문맥이 필요하다. 최신 샘플 바로 전 1초를
        // 중심으로 잡아 미래 데이터를 요구하지 않는 rolling 추론을 만든다.
        let lookahead = Int(impactLookaheadSec * fs)
        let impactIndex = max(0, windowSamples.count - lookahead - 1)
        return (
            ImuWindow(fs: fs, samples: windowSamples.map(\.axes), impactIndex: impactIndex),
            windowSamples[impactIndex].at
        )
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
        let window = ImuWindow(
            fs: Double(recoverySamples.count) / spanSec,
            samples: recoverySamples.map(\.axes),
            impactIndex: recoverySamples.firstIndex { $0.at >= pendingRecovery.eventAt } ?? 0
        )
        let recovery = pipeline.nonrecoveryPrediction(window, spanSec: spanSec)
        emit(Observation(
            phase: .recovery,
            observedAt: now,
            eventAt: pendingRecovery.eventAt,
            impact: pendingRecovery.impact,
            workVeto: pendingRecovery.workVeto,
            isModelCandidate: true,
            recovery: recovery
        ))
    }

    private func trimSamples(endingAt now: Date) {
        let cutoff = now.addingTimeInterval(-sampleRetentionSec)
        if let firstKept = samples.firstIndex(where: { $0.at >= cutoff }), firstKept > 0 {
            samples.removeFirst(firstKept)
        }
    }

    private func emit(_ observation: Observation) {
        DispatchQueue.main.async { [weak self] in
            self?.onObservation?(observation)
        }
    }
}
