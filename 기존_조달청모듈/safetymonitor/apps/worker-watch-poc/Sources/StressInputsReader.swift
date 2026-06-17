// 워치 HealthKit 에서 스트레스 알고리즘 입력 7종을 읽는 리더 (폰 readStressInputs 미러)
// 분석은 안 함 — raw 수집만. 지수 산출은 packages/analyzers(computeStressIndex) 단일 소스가 서버/대시보드에서 수행.
// 워치는 워크아웃 세션 중 자기 HealthKit 을 읽으므로 iPhone 잠금 중에도 입력 수집이 지속된다.
import Foundation
import HealthKit

struct StressInputs {
    var hrvSdnnMs: Double?
    var restingHeartRate: Double?
    var walkingHeartRate: Double?
    var respiratoryRate: Double?
    var activeEnergyKcal: Double?
    var flightsClimbed: Double?
    var steps: Double?
}

final class StressInputsReader {
    private let store: HKHealthStore
    private let bpm = HKUnit.count().unitDivided(by: .minute())

    init(store: HKHealthStore) { self.store = store }

    // 60초 sub-cadence 로 호출. 최신값(HRV/안정·보행심박/호흡) + 구간 합(활동에너지/계단/걸음).
    func read(window: TimeInterval = 60) async -> StressInputs {
        var s = StressInputs()
        s.hrvSdnnMs = await latest(.heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), lookback: 2 * 3600)
        s.restingHeartRate = await latest(.restingHeartRate, unit: bpm, lookback: 86400)
        s.walkingHeartRate = await latest(.walkingHeartRateAverage, unit: bpm, lookback: 86400)
        s.respiratoryRate = await latest(.respiratoryRate, unit: bpm, lookback: 86400)
        s.activeEnergyKcal = await sum(.activeEnergyBurned, unit: .kilocalorie(), window: window)
        s.flightsClimbed = await sum(.flightsClimbed, unit: .count(), window: window)
        s.steps = await sum(.stepCount, unit: .count(), window: window)
        return s
    }

    // 모든 스트레스 입력 타입(권한 read 셋 구성용).
    static var readTypes: Set<HKObjectType> {
        [
            HKQuantityType(.heartRateVariabilitySDNN),
            HKQuantityType(.restingHeartRate),
            HKQuantityType(.walkingHeartRateAverage),
            HKQuantityType(.respiratoryRate),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.flightsClimbed),
            HKQuantityType(.stepCount),
        ]
    }

    // lookback 내 가장 최근 1건.
    private func latest(_ id: HKQuantityTypeIdentifier, unit: HKUnit, lookback: TimeInterval) async -> Double? {
        let type = HKQuantityType(id)
        let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-lookback), end: Date())
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: 1, sortDescriptors: sort) { _, samples, _ in
                let v = (samples?.first as? HKQuantitySample)?.quantity.doubleValue(for: unit)
                cont.resume(returning: v)
            }
            store.execute(q)
        }
    }

    // window 구간 누적 합.
    private func sum(_ id: HKQuantityTypeIdentifier, unit: HKUnit, window: TimeInterval) async -> Double? {
        let type = HKQuantityType(id)
        let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-window), end: Date())
        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, stats, _ in
                cont.resume(returning: stats?.sumQuantity()?.doubleValue(for: unit))
            }
            store.execute(q)
        }
    }
}
