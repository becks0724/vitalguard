import CoreMotion
import Foundation

/// 세 Core ML 모델만으로 낙상 후보를 만드는 Watch 감지기.
/// 원시 가속도 임계값이나 기존 규칙 기반 후보 생성을 사용하지 않는다.
struct MLThreeModelFallCandidate {
    let workVetoProbability: Double
    let impactProbability: Double
    let nonRecoveryProbability: Double
    let observedPeakG: Double
    let detectedAt: Date
}

final class MLThreeModelEngine {
    var onCandidate: ((MLThreeModelFallCandidate) -> Void)?
    var onMotionSample: ((_ accelerationMagnitudeG: Double, _ rotationRateRadS: Double) -> Void)?

    private struct Sample {
        let at: Date
        let axes: [Float]
        let totalG: Double
    }

    private struct PendingRecovery {
        let detectedAt: Date
        let workVetoProbability: Double
        let impactProbability: Double
    }

    private let motion = CMMotionManager()
    private let queue = OperationQueue()
    private let pipeline: FallMLPipeline
    private let sampleHz = 50.0
    private let analysisInterval: TimeInterval = 1.0
    private let recoveryWindowSec: TimeInterval = 12.0
    private let postImpactRecoverySec: TimeInterval = 10.0
    private let alertCooldownSec: TimeInterval = 8.0
    private var samples: [Sample] = []
    private var lastAnalysisAt: Date?
    private var lastAlertAt: Date?
    private var pendingRecovery: PendingRecovery?

    init?() {
        guard let pipeline = FallMLPipeline() else { return nil }
        self.pipeline = pipeline
        queue.name = "com.vitalguard.ml-three-model-engine"
        queue.qualityOfService = .userInitiated
        queue.maxConcurrentOperationCount = 1
        samples.reserveCapacity(Int((recoveryWindowSec + 2) * sampleHz))
    }

    func start() {
        guard motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = 1.0 / sampleHz
        motion.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
            guard let self, let motion else { return }
            self.ingest(motion, at: Date())
        }
    }

    func stop() {
        if motion.isDeviceMotionActive { motion.stopDeviceMotionUpdates() }
        queue.addOperation { [weak self] in
            self?.samples.removeAll(keepingCapacity: true)
            self?.pendingRecovery = nil
            self?.lastAnalysisAt = nil
        }
    }

    private func ingest(_ motion: CMDeviceMotion, at now: Date) {
        let acceleration = motion.userAcceleration
        let gravity = motion.gravity
        let ax = acceleration.x + gravity.x
        let ay = acceleration.y + gravity.y
        let az = acceleration.z + gravity.z
        let rotation = motion.rotationRate
        let totalG = (ax * ax + ay * ay + az * az).squareRoot()
        let rotationMagnitude = (rotation.x * rotation.x + rotation.y * rotation.y + rotation.z * rotation.z).squareRoot()
        onMotionSample?(totalG, rotationMagnitude)

        samples.append(Sample(
            at: now,
            axes: [Float(ax), Float(ay), Float(az), Float(rotation.x), Float(rotation.y), Float(rotation.z)],
            totalG: totalG
        ))
        trimSamples(reference: now)

        if let pendingRecovery {
            if now.timeIntervalSince(pendingRecovery.detectedAt) >= postImpactRecoverySec {
                evaluateRecovery(pendingRecovery, at: now)
            }
            return
        }
        guard samples.count >= Int(3 * sampleHz) else { return }
        guard lastAnalysisAt.map({ now.timeIntervalSince($0) >= analysisInterval }) ?? true else { return }
        lastAnalysisAt = now
        evaluateImpact(at: now)
    }

    private func evaluateImpact(at now: Date) {
        let start = now.addingTimeInterval(-3)
        let window = samples.filter { $0.at >= start }
        guard window.count >= Int(2 * sampleHz) else { return }
        // 최신 2초 구간의 중앙을 모델이 판단할 기준 시점으로 사용한다. 이는 IMU 값 임계가 아닌
        // 고정 길이 시계열 분할이며, 낙상 여부는 work_veto/impact 모델 출력으로만 정해진다.
        let impactIndex = max(0, window.count - Int(sampleHz))
        let probabilities = pipeline.probs(samples: window.map(\.axes), impactIndex: impactIndex)
        guard probabilities.wv < FallMLPipeline.vetoThreshold,
              probabilities.imp >= FallMLPipeline.impactThreshold else { return }
        pendingRecovery = PendingRecovery(
            detectedAt: now,
            workVetoProbability: probabilities.wv,
            impactProbability: probabilities.imp
        )
    }

    private func evaluateRecovery(_ pending: PendingRecovery, at now: Date) {
        pendingRecovery = nil
        let start = pending.detectedAt.addingTimeInterval(-(recoveryWindowSec - postImpactRecoverySec))
        let window = samples.filter { $0.at >= start && $0.at <= now }
        guard window.count >= Int(recoveryWindowSec * sampleHz * 0.5) else { return }
        let span = max(0.1, now.timeIntervalSince(window.first?.at ?? now))
        let nonRecovery = pipeline.nonrecoveryProb(samples: window.map(\.axes), spanSec: span)
        guard nonRecovery >= FallMLPipeline.recoveryThreshold else { return }
        guard lastAlertAt.map({ now.timeIntervalSince($0) >= alertCooldownSec }) ?? true else { return }
        lastAlertAt = now
        onCandidate?(MLThreeModelFallCandidate(
            workVetoProbability: pending.workVetoProbability,
            impactProbability: pending.impactProbability,
            nonRecoveryProbability: nonRecovery,
            observedPeakG: window.map(\.totalG).max() ?? 0,
            detectedAt: now
        ))
    }

    private func trimSamples(reference: Date) {
        let oldest = reference.addingTimeInterval(-(recoveryWindowSec + 2))
        if let firstKept = samples.firstIndex(where: { $0.at >= oldest }), firstKept > 0 {
            samples.removeFirst(firstKept)
        }
    }
}
