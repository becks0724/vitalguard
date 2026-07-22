// C2 — 온디바이스 자가검증. 파이썬 정답지(ml_selfcheck.json)와 Swift 결과를 대조.
//   ① FeatureExtractor 88피처 == numpy extract (허용 1e-5 절대오차(정답지 반올림 감안, 관측 7e-7))
//   ② Core ML 확률 == sklearn predict_proba (허용 0.01 — SVM 정규화 차 + 변환오차)
// 설정 화면의 [ML 자가검증] 버튼에서 실행. 전부 ✅ 면 파이프라인 이식 성공.
import Foundation

enum MLSelfCheck {
    private struct Slice: Decodable {
        let axes: [[Double]]
        let fs: Double
        let features: [Double]
        let prob: Double
    }
    private struct Case_: Decodable {
        let name: String
        let slices: [String: Slice]
    }
    private struct Root: Decodable { let cases: [Case_] }

    static func run() -> String {
        guard let url = Bundle.main.url(forResource: "ml_selfcheck", withExtension: "json"),
              let root = try? JSONDecoder().decode(Root.self, from: Data(contentsOf: url)) else {
            return "ml_selfcheck.json 없음 — 타깃에 추가 필요"
        }
        let pipeline = FallMLPipeline()
        var lines: [String] = []
        var maxFeatDiff = 0.0
        for c in root.cases {
            for (task, s) in c.slices.sorted(by: { $0.key < $1.key }) {
                let feat = FeatureExtractor.extract(s.axes, fs: s.fs)
                let fd = zip(feat, s.features).map { abs($0 - $1) }.max() ?? .infinity
                maxFeatDiff = max(maxFeatDiff, fd)
                var probPart = "모델 미탑재"
                if let p = pipeline {
                    let got = p.prob(task: task, s.axes)
                    let ok = abs(got - s.prob) < 0.01
                    probPart = String(format: "p %.3f/%.3f %@", got, s.prob, ok ? "✅" : "❌")
                }
                lines.append("\(c.name)·\(task) feat\(fd < 1e-5 ? "✅" : "❌") \(probPart)")
            }
        }
        lines.append(String(format: "피처 최대오차 %.1e", maxFeatDiff))
        return lines.joined(separator: "\n")
    }
}
