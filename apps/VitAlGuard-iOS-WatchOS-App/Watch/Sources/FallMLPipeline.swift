// ML 파이프라인 (핸드오프판) — 실데이터 학습 모델 3개의 온디바이스 추론.
// 미니앱(IMU_ML_Test)에서 실기기 검증 완료된 코드 그대로 + 융합용 probs() 추가.
// 임계값 출처 = thresholds.json (4명 LOSO OOF로 산출).
import Foundation
import CoreML

final class FallMLPipeline {
    static let vetoThreshold = 0.675      // work_veto precision≥0.95 운영점 — 이 이상이면 "작업 확실" 기각
    static let impactThreshold = 0.710    // impact fpr5% 운영점
    static let recoveryThreshold = 0.35   // 비회복 asym(애매하면 위험 쪽)
    static let fs = 50.0

    private let workVeto: MLModel
    private let impact: MLModel
    private let recovery: MLModel?

    struct Prediction {
        let probability: Double
        /// Core ML 모델이 학습한 기본 분류 경계의 label. 새 ML-first 관전 경로는
        /// 고정 G값 대신 이 label을 후보 제안 신호로만 사용한다.
        let label: Bool
    }

    struct FastPredictions {
        let workVeto: Prediction
        let impact: Prediction
    }

    /// 번들에 모델(.mlmodelc)이 없으면 nil — 호출부는 규칙 단독으로 동작(fail-open).
    init?() {
        guard let wvURL = Bundle.main.url(forResource: "work_veto", withExtension: "mlmodelc"),
              let impURL = Bundle.main.url(forResource: "impact", withExtension: "mlmodelc"),
              let wv = try? MLModel(contentsOf: wvURL),
              let imp = try? MLModel(contentsOf: impURL) else { return nil }
        workVeto = wv
        impact = imp
        recovery = Bundle.main.url(forResource: "recovery", withExtension: "mlmodelc")
            .flatMap { try? MLModel(contentsOf: $0) }
    }

    /// 융합용 — 충격 윈도에서 (작업확률, 낙상충격확률). 슬라이스: work_veto 3s / impact ±1s.
    func probs(_ window: ImuWindow) -> (wv: Double, imp: Double) {
        let result = fastPredictions(window)
        return (result.workVeto.probability, result.impact.probability)
    }

    /// work_veto/impact의 확률과 모델 기본 label을 함께 반환한다.
    func fastPredictions(_ window: ImuWindow) -> FastPredictions {
        let samples = window.samples.map { $0.map(Double.init) }
        let wv = prediction(workVeto, slice(samples, center: window.impactIndex, sec: 3.0))
        let im = prediction(impact, slice(samples, center: window.impactIndex, sec: 2.0))
        return FastPredictions(workVeto: wv, impact: im)
    }

    /// 회복 모드(12초 윈도) 전용 — 비회복 확률. spanSec = 윈도 벽시계 길이(스로틀링 대응 실효 fs).
    func nonrecoveryProb(_ window: ImuWindow, spanSec: Double) -> Double? {
        nonrecoveryPrediction(window, spanSec: spanSec)?.probability
    }

    /// recovery 모델의 확률과 기본 label. spanSec은 실제 윈도 벽시계 길이다.
    func nonrecoveryPrediction(_ window: ImuWindow, spanSec: Double) -> Prediction? {
        guard let m = recovery else { return nil }
        let samples = window.samples.map { $0.map(Double.init) }
        return prediction(m, samples, fs: Double(samples.count) / max(1, spanSec))
    }

    /// 자가검증용 — task 이름("work_veto"/"impact")으로 확률 조회.
    func prob(task: String, _ samples: [[Double]]) -> Double {
        prediction(task == "work_veto" ? workVeto : impact, samples).probability
    }

    /// real_loader._slice 동일: 충격 중심 n샘플 (짧으면 전체).
    private func slice(_ samples: [[Double]], center c: Int, sec: Double) -> [[Double]] {
        let n = Int(sec * Self.fs)
        let T = samples.count
        if T <= n { return samples }
        let s = max(0, min(c - n / 2, T - n))
        return Array(samples[s..<(s + n)])
    }

    private func prediction(_ model: MLModel, _ samples: [[Double]], fs: Double = FallMLPipeline.fs) -> Prediction {
        let feat = FeatureExtractor.extract(samples, fs: fs)
        guard let arr = try? MLMultiArray(shape: [88], dataType: .double) else {
            return Prediction(probability: 0, label: false)
        }
        for (i, v) in feat.enumerated() { arr[i] = NSNumber(value: v) }
        guard let inp = try? MLDictionaryFeatureProvider(dictionary: ["features": arr]),
              let out = try? model.prediction(from: inp),
              let dict = out.featureValue(for: "classProbability")?.dictionaryValue else {
            return Prediction(probability: 0, label: false)
        }
        let probability = dict[Int64(1) as NSNumber]?.doubleValue ?? dict[1 as NSNumber]?.doubleValue ?? 0
        let label = out.featureValue(for: "label")?.int64Value == 1
        return Prediction(probability: probability, label: label)
    }
}
