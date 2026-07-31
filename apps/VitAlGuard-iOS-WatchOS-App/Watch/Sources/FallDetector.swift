import Foundation
import CoreMotion

/// Legacy safety detector. Its rule-derived candidates keep the existing alert
/// path alive while the ML-first pipeline runs independently in shadow mode.
struct FallCandidate {
    enum Decision: String {
        case fall
        case rejectedNoCorroboration = "rejected_no_corroboration"
        case rejectedTimeout = "rejected_timeout"
    }

    let decision: Decision
    let peakG: Double
    let stillSec: Double
    let freefallPreceded: Bool
    let peakRotationRadS: Double

    var isFall: Bool { decision == .fall }
}

final class FallDetector {
    var onCandidate: ((FallCandidate) -> Void)?
    var onMotionSample: ((_ accelerationMagnitudeG: Double, _ rotationRateRadS: Double) -> Void)?
    var onMovement: (() -> Void)?
    /// Raw samples for ML-first shadow inference. This is never derived from a
    /// rule candidate, so the 2.8G threshold cannot gate ML observations.
    var onIMUSample: ((ImuSample) -> Void)?
    var imuLogger: IMUWindowLogger?

    private let motion = CMMotionManager()
    private let queue = OperationQueue()
    private let sampleHz: Double
    private let eventSampleHz: Double
    private let motionPublishInterval: TimeInterval
    private let impactThresholdG = 2.8
    private let freefallG = 0.6
    private let freefallLookbackSec = 0.8
    private let stillBandG = 0.3
    private let stillRequiredSec = 1.2
    private let postWindowSec = 4.0
    private let tumbleRotThresholdRadS = 6.0
    private let refractorySec = 8.0
    private let maxIntegrationDtSec = 0.1
    private let movementBandG = 0.15
    private let movementRotRadS = 0.8

    private var eventSampleBoostUntil: Date?
    private var impactAt: Date?
    private var impactPeakG = 0.0
    private var lowActivityAccum: TimeInterval = 0
    private var lastSampleAt: Date?
    private var peakRotation = 0.0
    private var freefallPrecededImpact = false
    private var lastFreefallAt: Date?
    private var lastFallAt: Date?
    private var lastMotionPublishAt: Date?
    private var lastMovementNotifyAt: Date?

    init(sampleHz: Double = 50, eventSampleHz: Double = 50, motionPublishInterval: TimeInterval = 1) {
        self.sampleHz = max(10, sampleHz)
        self.eventSampleHz = max(self.sampleHz, eventSampleHz)
        self.motionPublishInterval = max(1, motionPublishInterval)
        queue.name = "com.vitalguard.fall-detector"
        queue.qualityOfService = .utility
        queue.maxConcurrentOperationCount = 1
    }

    func start() {
        guard motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = 1 / sampleHz
        motion.startDeviceMotionUpdates(to: queue) { [weak self] motionData, _ in
            guard let self, let motionData else { return }
            let ax = motionData.userAcceleration.x + motionData.gravity.x
            let ay = motionData.userAcceleration.y + motionData.gravity.y
            let az = motionData.userAcceleration.z + motionData.gravity.z
            let totalG = (ax * ax + ay * ay + az * az).squareRoot()
            let rotation = motionData.rotationRate
            let rotationMagnitude = (rotation.x * rotation.x + rotation.y * rotation.y + rotation.z * rotation.z).squareRoot()
            let now = Date()
            self.updateSamplingRateIfNeeded(totalG: totalG, at: now)
            self.publishMotionSampleIfNeeded(totalG: totalG, rotationMagnitude: rotationMagnitude, at: now)
            self.imuLogger?.ingest(ax: ax, ay: ay, az: az, gx: rotation.x, gy: rotation.y, gz: rotation.z, totalG: totalG, at: now)
            self.onIMUSample?(ImuSample(at: now, axes: [Float(ax), Float(ay), Float(az), Float(rotation.x), Float(rotation.y), Float(rotation.z)]))
            self.process(totalG: totalG, rotationMagnitude: rotationMagnitude, at: now)
        }
    }

    func stop() {
        if motion.isDeviceMotionActive { motion.stopDeviceMotionUpdates() }
        queue.addOperation { [weak self] in
            self?.eventSampleBoostUntil = nil
            self?.resetEvent()
        }
    }

    private func process(totalG: Double, rotationMagnitude: Double, at now: Date) {
        let moved = abs(totalG - 1) > movementBandG || rotationMagnitude > movementRotRadS
        if moved, lastMovementNotifyAt.map({ now.timeIntervalSince($0) > 0.5 }) ?? true {
            lastMovementNotifyAt = now
            OperationQueue.main.addOperation { [weak self] in self?.onMovement?() }
        }
        if let lastFallAt, now.timeIntervalSince(lastFallAt) < refractorySec { return }
        if totalG <= freefallG { lastFreefallAt = now }
        if totalG >= impactThresholdG {
            impactAt = now
            impactPeakG = max(impactPeakG, totalG)
            peakRotation = max(peakRotation, rotationMagnitude)
            if let lastFreefallAt, now.timeIntervalSince(lastFreefallAt) <= freefallLookbackSec { freefallPrecededImpact = true }
            lowActivityAccum = 0
            lastSampleAt = now
            return
        }
        guard let impactAt else { return }
        peakRotation = max(peakRotation, rotationMagnitude)
        if now.timeIntervalSince(impactAt) > postWindowSec { resolve(.rejectedTimeout); return }
        let dt = min(now.timeIntervalSince(lastSampleAt ?? now), maxIntegrationDtSec)
        lastSampleAt = now
        if abs(totalG - 1) < stillBandG { lowActivityAccum += dt }
        if lowActivityAccum >= stillRequiredSec {
            resolve(freefallPrecededImpact || peakRotation >= tumbleRotThresholdRadS ? .fall : .rejectedNoCorroboration)
        }
    }

    private func updateSamplingRateIfNeeded(totalG: Double, at now: Date) {
        if totalG <= freefallG || totalG >= 1.8 { eventSampleBoostUntil = now.addingTimeInterval(5) }
        let targetHz = (eventSampleBoostUntil.map { $0 > now } ?? false) ? eventSampleHz : sampleHz
        let targetInterval = 1 / targetHz
        if abs(motion.deviceMotionUpdateInterval - targetInterval) > 0.0001 { motion.deviceMotionUpdateInterval = targetInterval }
    }

    private func publishMotionSampleIfNeeded(totalG: Double, rotationMagnitude: Double, at now: Date) {
        if let lastMotionPublishAt, now.timeIntervalSince(lastMotionPublishAt) < motionPublishInterval { return }
        lastMotionPublishAt = now
        OperationQueue.main.addOperation { [weak self] in self?.onMotionSample?(totalG, rotationMagnitude) }
    }

    private func resolve(_ decision: FallCandidate.Decision) {
        if decision == .fall { lastFallAt = Date() }
        let candidate = FallCandidate(decision: decision, peakG: impactPeakG, stillSec: lowActivityAccum, freefallPreceded: freefallPrecededImpact, peakRotationRadS: peakRotation)
        resetEvent()
        OperationQueue.main.addOperation { [weak self] in self?.onCandidate?(candidate) }
    }

    private func resetEvent() {
        impactAt = nil
        impactPeakG = 0
        lowActivityAccum = 0
        lastSampleAt = nil
        peakRotation = 0
        freefallPrecededImpact = false
    }
}
