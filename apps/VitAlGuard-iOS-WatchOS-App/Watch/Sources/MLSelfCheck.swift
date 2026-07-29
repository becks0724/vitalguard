// v5 모델용 온디바이스 스키마 자가검증.
// 학습 출력 정답지는 모델 버전마다 달라지므로, 번들 로드와 88개 특성 입력·확률 출력을 확인한다.
import Foundation

enum MLSelfCheck {
    static func run() -> String {
        let samples = Array(repeating: [Double](repeating: 0, count: 6), count: 150)
        guard FeatureExtractor.extract(samples, fs: FallMLPipeline.fs).count == 88 else {
            return "v5 피처 스키마 불일치 ❌"
        }
        guard let pipeline = FallMLPipeline() else {
            return "v5 모델 미탑재 ❌"
        }
        let tasks = ["work_veto", "impact", "recovery"]
        let probabilities = tasks.map { pipeline.prob(task: $0, samples) }
        guard probabilities.allSatisfy({ $0.isFinite && (0...1).contains($0) }) else {
            return "v5 모델 출력 스키마 불일치 ❌"
        }
        return "v5 모델 스키마 검증 ✅ · 3/3 로드 완료"
    }
}
