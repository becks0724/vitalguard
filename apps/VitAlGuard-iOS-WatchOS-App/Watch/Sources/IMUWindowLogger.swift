import Foundation

struct ImuSample {
    let at: Date
    let axes: [Float]
}

struct ImuWindow {
    let fs: Double
    let samples: [[Float]]
    let impactIndex: Int
}

/// A low-threshold logging window used only by the legacy ML-fusion path.
final class IMUWindowLogger {
    var onWindow: ((ImuWindow) -> Void)?

    private struct BufferedSample { let at: Date; let axes: [Float] }
    private let fs: Double
    private let preSec: Double
    private let postSec: Double
    private let logThresholdG: Double
    private let refractorySec: Double
    private let capacity: Int
    private var samples: [BufferedSample] = []
    private var oldestIndex = 0
    private var pendingImpactAt: Date?
    private var lastEmitAt: Date?

    init(fs: Double = 50, preSec: Double = 2, postSec: Double = 10, logThresholdG: Double = 1.8, refractorySec: Double = 2) {
        self.fs = fs; self.preSec = preSec; self.postSec = postSec
        self.logThresholdG = logThresholdG; self.refractorySec = refractorySec
        self.capacity = Int((preSec + postSec + 1) * fs)
        samples.reserveCapacity(capacity)
    }

    func ingest(ax: Double, ay: Double, az: Double, gx: Double, gy: Double, gz: Double, totalG: Double, at now: Date) {
        let sample = BufferedSample(at: now, axes: [Float(ax), Float(ay), Float(az), Float(gx), Float(gy), Float(gz)])
        if samples.count < capacity { samples.append(sample) } else { samples[oldestIndex] = sample; oldestIndex = (oldestIndex + 1) % capacity }
        if pendingImpactAt == nil, totalG >= logThresholdG {
            if let lastEmitAt, now.timeIntervalSince(lastEmitAt) < refractorySec { return }
            pendingImpactAt = now
        }
        if let impact = pendingImpactAt, now.timeIntervalSince(impact) >= postSec {
            emit(around: impact); pendingImpactAt = nil; lastEmitAt = now
        }
    }

    private func emit(around impact: Date) {
        let ordered = samples.count < capacity || oldestIndex == 0 ? samples : Array(samples[oldestIndex...]) + Array(samples[..<oldestIndex])
        let window = ordered.filter { $0.at >= impact.addingTimeInterval(-preSec) && $0.at <= impact.addingTimeInterval(postSec) }
        guard window.count >= Int(fs) else { return }
        let index = window.indices.min(by: { abs(window[$0].at.timeIntervalSince(impact)) < abs(window[$1].at.timeIntervalSince(impact)) }) ?? 0
        onWindow?(ImuWindow(fs: fs, samples: window.map(\.axes), impactIndex: index))
    }
}
