// ML 파이프라인 (핸드오프판) — 실데이터 학습 모델 3개의 온디바이스 추론.
// 미니앱(IMU_ML_Test)에서 실기기 검증 완료된 코드 그대로 + 융합용 probs() 추가.
// 임계값 출처 = thresholds.json (4명 LOSO OOF로 산출).
import Foundation
import CoreML

final class FallMLPipeline {
    static let vetoThreshold = 0.675      // work_veto precision≥0.95 운영점 — 이 이상이면 "작업 확실" 기각
    // v5 impact model operating point. The model is never a standalone alert source.
    static let impactThreshold = 0.3876582891869371
    static let recoveryThreshold = 0.35   // 비회복 asym(애매하면 위험 쪽)
    static let fs = 50.0

    private let workVeto: MLModel
    private let impact: MLModel
    private let recovery: MLModel

    struct Prediction {
        let probability: Double
        /// Uses the Core ML model's learned label, not a physical G threshold.
        let label: Bool
    }

    struct FastPredictions {
        let workVeto: Prediction
        let impact: Prediction
    }

    /// 세 모델이 모두 번들에 있고 로드될 때만 활성화한다.
    /// 이 앱의 낙상 판정은 ML 전용이므로 부분 로드는 허용하지 않는다.
    init?() {
        guard let wvURL = Bundle.main.url(forResource: "work_veto", withExtension: "mlmodelc"),
              let impURL = Bundle.main.url(forResource: "impact", withExtension: "mlmodelc"),
              let recoveryURL = Bundle.main.url(forResource: "recovery", withExtension: "mlmodelc"),
              let wv = try? MLModel(contentsOf: wvURL),
              let imp = try? MLModel(contentsOf: impURL),
              let rec = try? MLModel(contentsOf: recoveryURL) else { return nil }
        workVeto = wv
        impact = imp
        recovery = rec
    }

    /// ML 전용 감지기가 제공한 시계열에서 (작업확률, 낙상충격확률)을 계산한다.
    func probs(samples floatSamples: [[Float]], impactIndex: Int) -> (wv: Double, imp: Double) {
        let samples = floatSamples.map { $0.map(Double.init) }
        let center = min(max(impactIndex, 0), max(0, samples.count - 1))
        let wv = prob(workVeto, slice(samples, center: center, sec: 3.0))
        let im = prob(impact, slice(samples, center: center, sec: 2.0))
        return (wv, im)
    }

    func probs(_ window: ImuWindow) -> (wv: Double, imp: Double) {
        let result = fastPredictions(window)
        return (result.workVeto.probability, result.impact.probability)
    }

    /// Raw-IMU ML-first fast pass. The boolean labels are solely model output.
    func fastPredictions(_ window: ImuWindow) -> FastPredictions {
        let samples = window.samples.map { $0.map(Double.init) }
        return FastPredictions(
            workVeto: prediction(workVeto, slice(samples, center: window.impactIndex, sec: 3.0)),
            impact: prediction(impact, slice(samples, center: window.impactIndex, sec: 2.0))
        )
    }

    /// 회복 모델의 비회복 확률. spanSec은 실제 윈도 길이로, 센서 스로틀링에도 유효 샘플레이트를 보존한다.
    func nonrecoveryProb(samples floatSamples: [[Float]], spanSec: Double) -> Double {
        let samples = floatSamples.map { $0.map(Double.init) }
        return prob(recovery, samples, fs: Double(samples.count) / max(spanSec, 0.1))
    }

    func nonrecoveryPrediction(_ window: ImuWindow, spanSec: Double) -> Prediction? {
        let samples = window.samples.map { $0.map(Double.init) }
        return prediction(recovery, samples, fs: Double(samples.count) / max(1, spanSec))
    }

    /// 자가검증용 — task 이름으로 해당 모델 확률 조회.
    func prob(task: String, _ samples: [[Double]]) -> Double {
        switch task {
        case "work_veto": return prob(workVeto, samples)
        case "impact": return prob(impact, samples)
        case "recovery": return prob(recovery, samples)
        default: return 0
        }
    }

    /// real_loader._slice 동일: 충격 중심 n샘플 (짧으면 전체).
    private func slice(_ samples: [[Double]], center c: Int, sec: Double) -> [[Double]] {
        let n = Int(sec * Self.fs)
        let T = samples.count
        if T <= n { return samples }
        let s = max(0, min(c - n / 2, T - n))
        return Array(samples[s..<(s + n)])
    }

    private func prob(_ model: MLModel, _ samples: [[Double]], fs: Double = FallMLPipeline.fs) -> Double {
        prediction(model, samples, fs: fs).probability
    }

    private func prediction(_ model: MLModel, _ samples: [[Double]], fs: Double = FallMLPipeline.fs) -> Prediction {
        let feat = FeatureExtractor.extract(samples, fs: fs)
        guard let arr = try? MLMultiArray(shape: [88], dataType: .double) else { return Prediction(probability: 0, label: false) }
        for (i, v) in feat.enumerated() { arr[i] = NSNumber(value: v) }
        guard let inp = try? MLDictionaryFeatureProvider(dictionary: ["features": arr]),
              let out = try? model.prediction(from: inp),
              let dict = out.featureValue(for: "classProbability")?.dictionaryValue else { return Prediction(probability: 0, label: false) }
        let probability = dict[Int64(1) as NSNumber]?.doubleValue ?? dict[1 as NSNumber]?.doubleValue ?? 0
        let label = out.featureValue(for: "label")?.int64Value == 1
        return Prediction(probability: probability, label: label)
    }
}
