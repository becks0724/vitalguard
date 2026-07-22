// 워치 HealthKit 에서 최신 산소포화도(SpO₂) 샘플을 구독해 최신값을 보관하는 리더
// SpO₂ 는 백그라운드 간헐 스팟 측정이라 HR 같은 연속 스트림이 아님 — anchored query 로
// 새 샘플 유입 시에만 갱신한다. 워치는 풀 HealthKit 스토어라 폰 잠금 영향 없이 읽힌다.
import Foundation
import HealthKit

final class SpO2Reader {
    // 최신 SpO₂ 퍼센트(0~100) — 항상 메인 큐에서 호출.
    var onUpdate: ((Double) -> Void)?

    private let store: HKHealthStore
    private let type = HKQuantityType(.oxygenSaturation)
    private var query: HKAnchoredObjectQuery?

    init(store: HKHealthStore) { self.store = store }

    func start() {
        guard query == nil else { return }
        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = {
            [weak self] _, samples, _, _, _ in
            guard let self,
                  let latest = (samples as? [HKQuantitySample])?
                    .filter(StressInputsReader.isAppleWatchSample)
                    .max(by: { $0.endDate < $1.endDate }) else { return }
            let pct = latest.quantity.doubleValue(for: .percent()) * 100.0
            OperationQueue.main.addOperation { self.onUpdate?(pct) }
        }
        let q = HKAnchoredObjectQuery(
            type: type,
            predicate: nil,
            anchor: nil,
            limit: HKObjectQueryNoLimit,
            resultsHandler: handler
        )
        q.updateHandler = handler
        store.execute(q)
        query = q
    }

    func stop() {
        if let q = query { store.stop(q) }
        query = nil
    }
}
