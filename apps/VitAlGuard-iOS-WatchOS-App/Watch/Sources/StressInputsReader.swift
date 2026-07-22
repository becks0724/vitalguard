// 워치 HealthKit 에서 스트레스 알고리즘 입력 7종을 읽는 리더 (폰 readStressInputs 미러)
// 분석은 안 함 — raw 수집만. 지수 산출은 packages/analyzers(computeStressIndex) 단일 소스가 서버/대시보드에서 수행.
// 워치는 워크아웃 세션 중 자기 HealthKit 을 읽으므로 iPhone 잠금 중에도 입력 수집이 지속된다.
import Foundation
import HealthKit
import WatchKit

struct StressInputs {
    var hrvSdnnMs: Double?
    var restingHeartRate: Double?
    var walkingHeartRate: Double?
    var respiratoryRate: Double?
    var activeEnergyKcal: Double?
    var exerciseTimeMinutes: Double?
    var standTimeMinutes: Double?
    var moveTimeMinutes: Double?
    var flightsClimbed: Double?
    var steps: Double?
    var wristTemperatureC: Double?
    var wristTemperatureUpdatedAt: Date?
    var bloodPressureSystolic: Double?
    var bloodPressureDiastolic: Double?
    var ecgClassification: String?
    var ecgAverageHeartRate: Double?
    var relativeAltitudeMeters: Double?
    var barometricPressureKPa: Double?
    var accelerationMagnitudeG: Double?
    var rotationRateRadS: Double?
    var sleepingBreathingDisturbances: Double?
    var sleepingBreathingDisturbancesClassification: String?
}

struct MeasuredVitalSnapshot {
    var heartRate: Double?
    var spo2: Double?
    var ecgStatus: String?
    var steps: Int?
    var wristTemperatureC: Double?
    var bloodPressureSystolic: Double?
    var bloodPressureDiastolic: Double?
    var hrvSdnnMs: Double?
    var respiratoryRate: Double?
    var activeEnergyKcal: Double?
    var exerciseTimeMinutes: Double?
    var standTimeMinutes: Double?
    var moveTimeMinutes: Double?
    var relativeAltitudeMeters: Double?
    var barometricPressureKPa: Double?
    var accelerationMagnitudeG: Double?
    var rotationRateRadS: Double?
    var sleepingBreathingDisturbances: Double?
    var sleepingBreathingDisturbancesClassification: String?
    var latitude: Double?
    var longitude: Double?
    var locationAccuracyMeters: Double?
    var updatedAt = Date()

    var dictionary: [String: Any] {
        var output: [String: Any] = [
            "source": "VitAlGuard-WatchVitals",
            "updatedAt": ISO8601DateFormatter().string(from: updatedAt),
            "watchDeviceName": WKInterfaceDevice.current().name,
            "watchDeviceModel": WKInterfaceDevice.current().model,
            "watchDeviceLocalizedModel": WKInterfaceDevice.current().localizedModel,
            "watchSystemVersion": WKInterfaceDevice.current().systemVersion
        ]
        if let heartRate { output["heartRate"] = Int(heartRate.rounded()) }
        if let spo2 { output["spo2"] = Int(spo2.rounded()) }
        if let ecgStatus, !ecgStatus.isEmpty, ecgStatus != "--" { output["ecgStatus"] = ecgStatus }
        if let steps { output["steps"] = steps }
        if let wristTemperatureC {
            let rounded = (wristTemperatureC * 10).rounded() / 10
            output["wristTemperatureC"] = rounded
            output["wristTemperature"] = rounded
            output["wristTempC"] = rounded
            output["wristTemp"] = rounded
            output["skinTempC"] = rounded
            output["skin_temp_c"] = rounded
            output["skinTemperatureC"] = rounded
            output["skinTemperature"] = rounded
            output["skin_temp"] = rounded
            output["wrist_temp_c"] = rounded
            output["wrist_temp"] = rounded
            output["bodyTempC"] = rounded
            output["bodyTemp"] = rounded
            output["bodyTemperatureC"] = rounded
            output["bodyTemperatureCelsius"] = rounded
            output["body_temp_c"] = rounded
            output["body_temp"] = rounded
            output["bodytemperature"] = rounded
            output["skinTemperatureLabel"] = "수면 손목온도"
            output["wristTemperatureAvailable"] = true
        }
        if let bloodPressureSystolic, let bloodPressureDiastolic {
            output["bloodPressureSystolic"] = Int(bloodPressureSystolic.rounded())
            output["bloodPressureDiastolic"] = Int(bloodPressureDiastolic.rounded())
            output["bloodPressureAvailable"] = true
        }
        if let hrvSdnnMs { output["hrvSdnnMs"] = (hrvSdnnMs * 10).rounded() / 10 }
        if let respiratoryRate { output["respiratoryRate"] = (respiratoryRate * 10).rounded() / 10 }
        if let activeEnergyKcal { output["activeEnergyKcal"] = (activeEnergyKcal * 10).rounded() / 10 }
        if let exerciseTimeMinutes { output["exerciseTimeMinutes"] = (exerciseTimeMinutes * 10).rounded() / 10 }
        if let standTimeMinutes { output["standTimeMinutes"] = (standTimeMinutes * 10).rounded() / 10 }
        if let moveTimeMinutes { output["moveTimeMinutes"] = (moveTimeMinutes * 10).rounded() / 10 }
        if let relativeAltitudeMeters { output["relativeAltitudeMeters"] = (relativeAltitudeMeters * 10).rounded() / 10 }
        if let barometricPressureKPa { output["barometricPressureKPa"] = (barometricPressureKPa * 100).rounded() / 100 }
        if let accelerationMagnitudeG { output["accelerationMagnitudeG"] = (accelerationMagnitudeG * 100).rounded() / 100 }
        if let rotationRateRadS { output["rotationRateRadS"] = (rotationRateRadS * 100).rounded() / 100 }
        if let sleepingBreathingDisturbances {
            output["sleepingBreathingDisturbances"] = (sleepingBreathingDisturbances * 100).rounded() / 100
        }
        if let sleepingBreathingDisturbancesClassification {
            output["sleepingBreathingDisturbancesClassification"] = sleepingBreathingDisturbancesClassification
            output["sleepApneaRisk"] = sleepingBreathingDisturbancesClassification
        }
        if let latitude { output["latitude"] = (latitude * 1_000_000).rounded() / 1_000_000 }
        if let longitude { output["longitude"] = (longitude * 1_000_000).rounded() / 1_000_000 }
        if let locationAccuracyMeters { output["locationAccuracyMeters"] = (locationAccuracyMeters * 10).rounded() / 10 }
        return output
    }
}

final class StressInputsReader {
    private let store: HKHealthStore
    private let bpm = HKUnit.count().unitDivided(by: .minute())
    private struct WristTemperatureCandidate {
        let value: Double
        let date: Date
        let isAppleWatchSample: Bool
        let preferredTypeOrder: Int
    }
    private static let wristTemperatureIdentifierBuckets = [
        [
            "HKQuantityTypeIdentifierAppleSleepingWristTemperature",
            "HKQuantityTypeIdentifierAppleWristTemperature"
        ],
        [
            "HKQuantityTypeIdentifierSkinTemperature",
            "HKQuantityTypeIdentifierBodyTemperature",
            "HKQuantityTypeIdentifierBasalBodyTemperature",
            "HKQuantityTypeIdentifierForeheadTemperature"
        ],
        [
            "HKQuantityTypeIdentifierEnvironmentalTemperature"
        ]
    ]

    private static let wristTemperatureIdentifiers = [
        "HKQuantityTypeIdentifierAppleWristTemperature",
        "HKQuantityTypeIdentifierAppleSleepingWristTemperature",
        "HKQuantityTypeIdentifierSkinTemperature",
        "HKQuantityTypeIdentifierBodyTemperature",
        "HKQuantityTypeIdentifierBasalBodyTemperature",
        "HKQuantityTypeIdentifierForeheadTemperature",
        "HKQuantityTypeIdentifierEnvironmentalTemperature"
    ]

    init(store: HKHealthStore) { self.store = store }

    // 60초 sub-cadence 로 호출. 실시간 스트림이 아닌 HealthKit 지표는 최근 실측값/하루 누적값을
    // 함께 읽어 Watch 화면과 iPhone 화면이 빈 값으로 굳지 않게 한다.
    func read(window: TimeInterval = 60) async -> StressInputs {
        var s = StressInputs()
        s.hrvSdnnMs = await latest(.heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), lookback: 7 * 86400)
        s.restingHeartRate = await latest(.restingHeartRate, unit: bpm, lookback: 86400)
        s.walkingHeartRate = await latest(.walkingHeartRateAverage, unit: bpm, lookback: 86400)
        s.respiratoryRate = await latest(.respiratoryRate, unit: bpm, lookback: 7 * 86400)
        if let dayActiveEnergyKcal = await sum(.activeEnergyBurned, unit: .kilocalorie(), window: 86400) {
            s.activeEnergyKcal = dayActiveEnergyKcal
        } else {
            s.activeEnergyKcal = await sum(.activeEnergyBurned, unit: .kilocalorie(), window: window)
        }
        s.exerciseTimeMinutes = await sum(.appleExerciseTime, unit: .minute(), window: 86400)
        s.standTimeMinutes = await sum(.appleStandTime, unit: .minute(), window: 86400)
        if #available(watchOS 7.4, *) {
            s.moveTimeMinutes = await sum(.appleMoveTime, unit: .minute(), window: 86400)
        }
        if let dayFlightsClimbed = await sum(.flightsClimbed, unit: .count(), window: 86400) {
            s.flightsClimbed = dayFlightsClimbed
        } else {
            s.flightsClimbed = await sum(.flightsClimbed, unit: .count(), window: window)
        }
        if let daySteps = await sum(.stepCount, unit: .count(), window: 86400) {
            s.steps = daySteps
        } else {
            s.steps = await sum(.stepCount, unit: .count(), window: window)
        }
        if let latestWristTemperature = await latestWristTemperature(window: 30 * 86400) {
            s.wristTemperatureC = latestWristTemperature.value
            s.wristTemperatureUpdatedAt = latestWristTemperature.measuredAt
        }
        s.bloodPressureSystolic = await latest(.bloodPressureSystolic, unit: .millimeterOfMercury(), lookback: 86400)
        s.bloodPressureDiastolic = await latest(.bloodPressureDiastolic, unit: .millimeterOfMercury(), lookback: 86400)
        let ecg = await latestECG(lookback: 86400 * 7)
        s.ecgClassification = ecg.classification
        s.ecgAverageHeartRate = ecg.averageHeartRate
        if #available(watchOS 11.0, *) {
            let breathingDisturbances = await latestSleepingBreathingDisturbances(lookback: 30 * 86400)
            s.sleepingBreathingDisturbances = breathingDisturbances.value
            s.sleepingBreathingDisturbancesClassification = breathingDisturbances.classification
        }
        return s
    }

    // 모든 스트레스 입력 타입(권한 read 셋 구성용).
    static var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [
            HKQuantityType(.heartRateVariabilitySDNN),
            HKQuantityType(.restingHeartRate),
            HKQuantityType(.walkingHeartRateAverage),
            HKQuantityType(.respiratoryRate),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.appleExerciseTime),
            HKQuantityType(.appleStandTime),
            HKQuantityType(.flightsClimbed),
            HKQuantityType(.stepCount),
            HKQuantityType(.bloodPressureSystolic),
            HKQuantityType(.bloodPressureDiastolic),
            HKObjectType.electrocardiogramType(),
        ]
        if #available(watchOS 7.4, *) {
            types.insert(HKQuantityType(.appleMoveTime))
        }
        if #available(watchOS 11.0, *) {
            types.insert(HKQuantityType(.appleSleepingBreathingDisturbances))
        }
        for rawIdentifier in wristTemperatureIdentifiers {
            if let wristType = HKObjectType.quantityType(
                forIdentifier: HKQuantityTypeIdentifier(rawValue: rawIdentifier)
            ) {
                types.insert(wristType)
            }
        }
        return types
    }

    private func latestWristTemperature(window: TimeInterval) async -> (value: Double, measuredAt: Date)? {
        for bucket in Self.wristTemperatureIdentifierBuckets {
            if let latest = await latestWristTemperature(from: bucket, lookback: window) {
                return latest
            }
        }
        return nil
    }

    private func latestWristTemperature(from identifiers: [String], lookback: TimeInterval) async -> (value: Double, measuredAt: Date)? {
        var candidates: [WristTemperatureCandidate] = []
        var watchCandidates: [WristTemperatureCandidate] = []
        candidates.reserveCapacity(identifiers.count)
        watchCandidates.reserveCapacity(identifiers.count)

        for rawIdentifier in identifiers {
            if let candidate = await latestRawCandidate(rawIdentifier, unit: .degreeCelsius(), lookback: lookback),
               let normalized = normalizeWristTemperature(candidate.value) {
                let wristCandidate = WristTemperatureCandidate(
                    value: normalized,
                    date: candidate.date,
                    isAppleWatchSample: candidate.isAppleWatchSample,
                    preferredTypeOrder: wristTypePriority(rawIdentifier)
                )
                candidates.append(wristCandidate)
                if wristCandidate.isAppleWatchSample {
                    watchCandidates.append(wristCandidate)
                }
            }
        }

        guard !candidates.isEmpty else { return nil }
        let sourceCandidates = watchCandidates.isEmpty ? candidates : watchCandidates
        let sortedByDate = sourceCandidates.sorted { lhs, rhs in
            if lhs.date != rhs.date {
                return lhs.date > rhs.date
            }
            if lhs.isAppleWatchSample != rhs.isAppleWatchSample {
                return lhs.isAppleWatchSample && !rhs.isAppleWatchSample
            }
            return lhs.preferredTypeOrder < rhs.preferredTypeOrder
        }
        guard let first = sortedByDate.first else { return nil }
        return (first.value, first.date)
    }

    private func wristTypePriority(_ rawIdentifier: String) -> Int {
        let buckets = Self.wristTemperatureIdentifierBuckets
        for (bucketIndex, bucket) in buckets.enumerated() {
            if let index = bucket.firstIndex(of: rawIdentifier) {
                return bucketIndex * 100 + index
            }
        }
        return 999
    }

    private func normalizeWristTemperature(_ value: Double) -> Double? {
        if (84...120).contains(value) {
            let celsius = (value - 32) * 5 / 9
            return (celsius * 10).rounded() / 10
        }
        if (20...45).contains(value) {
            return (value * 10).rounded() / 10
        }
        return nil
    }

    static func isAppleWatchSample(_ sample: HKSample) -> Bool {
        let sourceName = sample.sourceRevision.source.name.lowercased()
        let sourceBundleId = sample.sourceRevision.source.bundleIdentifier.lowercased()
        if sample.device?.name?.localizedCaseInsensitiveContains("Apple Watch") == true {
            return true
        }
        if sample.device?.manufacturer?.localizedCaseInsensitiveContains("Apple") == true,
           sample.device?.model?.localizedCaseInsensitiveContains("Watch") == true {
            return true
        }
        if sample.device?.model?.localizedCaseInsensitiveContains("Watch") == true {
            return true
        }
        if sample.sourceRevision.productType?.localizedCaseInsensitiveContains("Watch") == true {
            return true
        }
        if sourceBundleId.contains("watch") {
            return true
        }
        return sourceName.contains("apple watch")
            || sourceName.contains("애플워치")
    }

    // lookback 내 Apple Watch 출처 가장 최근 1건.
    private func latest(_ id: HKQuantityTypeIdentifier, unit: HKUnit, lookback: TimeInterval) async -> Double? {
        guard let type = HKObjectType.quantityType(forIdentifier: id) else { return nil }
        let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-lookback), end: Date())
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: 20, sortDescriptors: sort) { _, samples, _ in
                let quantitySamples = samples as? [HKQuantitySample]
                let sample = quantitySamples?.first(where: Self.isAppleWatchSample) ?? quantitySamples?.first
                let v = sample?.quantity.doubleValue(for: unit)
                cont.resume(returning: v)
            }
            store.execute(q)
        }
    }

    private func latestRaw(_ rawIdentifier: String, unit: HKUnit, lookback: TimeInterval) async -> Double? {
        guard let type = HKObjectType.quantityType(
            forIdentifier: HKQuantityTypeIdentifier(rawValue: rawIdentifier)
        ) else {
            return nil
        }
        let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-lookback), end: Date())
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: 20, sortDescriptors: sort) { _, samples, _ in
                let quantitySamples = samples as? [HKQuantitySample]
                let sample = quantitySamples?.first(where: Self.isAppleWatchSample) ?? quantitySamples?.first
                let v = sample?.quantity.doubleValue(for: unit)
                cont.resume(returning: v)
            }
            store.execute(q)
        }
    }

    private func latestRawCandidate(
        _ rawIdentifier: String,
        unit: HKUnit,
        lookback: TimeInterval
    ) async -> WristTemperatureCandidate? {
        guard let type = HKObjectType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: rawIdentifier)) else {
            return nil
        }

        let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-lookback), end: Date())
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]

        return await withCheckedContinuation { (cont: CheckedContinuation<WristTemperatureCandidate?, Never>) in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: 25, sortDescriptors: sort) { _, samples, error in
                if error != nil {
                    cont.resume(returning: nil)
                    return
                }

                let quantitySamples = samples as? [HKQuantitySample]
                let candidates = quantitySamples?
                    .compactMap { sample -> WristTemperatureCandidate? in
                        let value = sample.quantity.doubleValue(for: unit)
                        return WristTemperatureCandidate(
                            value: value,
                            date: sample.endDate,
                            isAppleWatchSample: Self.isAppleWatchSample(sample),
                            preferredTypeOrder: 999
                        )
                    }
                    .sorted { lhs, rhs in
                        if lhs.date != rhs.date {
                            return lhs.date > rhs.date
                        }
                        if lhs.isAppleWatchSample != rhs.isAppleWatchSample {
                            return lhs.isAppleWatchSample && !rhs.isAppleWatchSample
                        }
                        return lhs.preferredTypeOrder < rhs.preferredTypeOrder
                    }

                let watchSample = candidates?.first(where: \.isAppleWatchSample)
                let anySample = candidates?.first
                guard let sample = watchSample ?? anySample else {
                    cont.resume(returning: nil)
                    return
                }

                cont.resume(returning: sample)
            }
            store.execute(q)
        }
    }

    // window 구간 Apple Watch 출처 누적 합.
    private func sum(_ id: HKQuantityTypeIdentifier, unit: HKUnit, window: TimeInterval) async -> Double? {
        guard let type = HKObjectType.quantityType(forIdentifier: id) else { return nil }
        let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-window), end: Date())
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: sort) { _, samples, _ in
                let total = (samples as? [HKQuantitySample])?
                    .filter(Self.isAppleWatchSample)
                    .reduce(0.0) { $0 + $1.quantity.doubleValue(for: unit) }
                cont.resume(returning: total.flatMap { $0 > 0 ? $0 : nil })
            }
            store.execute(q)
        }
    }

    private func latestECG(lookback: TimeInterval) async -> (classification: String?, averageHeartRate: Double?) {
        let type = HKObjectType.electrocardiogramType()
        let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-lookback), end: Date())
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: 1, sortDescriptors: sort) { _, samples, _ in
                guard let ecg = (samples as? [HKElectrocardiogram])?.first(where: Self.isAppleWatchSample) else {
                    cont.resume(returning: (nil, nil))
                    return
                }
                let average = ecg.averageHeartRate?.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                cont.resume(returning: (Self.ecgLabel(for: ecg.classification), average))
            }
            store.execute(q)
        }
    }

    @available(watchOS 11.0, *)
    private func latestSleepingBreathingDisturbances(lookback: TimeInterval) async -> (value: Double?, classification: String?) {
        guard let type = HKObjectType.quantityType(forIdentifier: .appleSleepingBreathingDisturbances) else {
            return (nil, nil)
        }
        let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-lookback), end: Date())
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: 20, sortDescriptors: sort) { _, samples, _ in
                let quantitySamples = samples as? [HKQuantitySample]
                guard let sample = quantitySamples?.first(where: Self.isAppleWatchSample) ?? quantitySamples?.first else {
                    cont.resume(returning: (nil, nil))
                    return
                }
                let value = sample.quantity.doubleValue(for: .count())
                let classification = HKAppleSleepingBreathingDisturbancesClassification(classifying: sample.quantity)
                    .map(Self.sleepingBreathingDisturbancesLabel)
                cont.resume(returning: (value, classification))
            }
            store.execute(q)
        }
    }

    @available(watchOS 11.0, *)
    private static func sleepingBreathingDisturbancesLabel(
        for classification: HKAppleSleepingBreathingDisturbancesClassification
    ) -> String {
        switch classification {
        case .notElevated:
            return "높지 않음"
        case .elevated:
            return "높음"
        @unknown default:
            return "알 수 없음"
        }
    }

    private static func ecgLabel(for classification: HKElectrocardiogram.Classification) -> String? {
        switch classification {
        case .sinusRhythm:
            return "동리듬"
        case .atrialFibrillation:
            return "심방세동"
        case .inconclusiveLowHeartRate:
            return "저심박 불명확"
        case .inconclusiveHighHeartRate:
            return "고심박 불명확"
        case .inconclusivePoorReading:
            return "품질 낮음"
        case .inconclusiveOther:
            return "판정 불명확"
        case .notSet:
            return nil
        case .unrecognized:
            return "알 수 없음"
        @unknown default:
            return "알 수 없음"
        }
    }
}
