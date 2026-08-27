import ActivityKit
import CoreLocation
import Foundation

enum AppMode: String, Codable, Hashable {
    case admin
    case worker
}

/// iPhone, Watch, and the control dashboard share this boundary contract.
/// A position is published only on the first valid fix or after movement beyond
/// the configured radius from the last dashboard-confirmed position.
enum VitAlGuardLocationUpdatePolicy {
    static let minimumRadiusMeters: CLLocationDistance = 100
    static let maximumRadiusMeters: CLLocationDistance = 5_000

    static func clampedRadius(_ value: Double) -> CLLocationDistance {
        min(maximumRadiusMeters, max(minimumRadiusMeters, value.rounded()))
    }

    static func shouldPublish(
        location: CLLocation,
        after lastPublishedLocation: CLLocation?,
        radiusMeters: CLLocationDistance
    ) -> Bool {
        let radius = clampedRadius(radiusMeters)
        guard location.horizontalAccuracy > 0, location.horizontalAccuracy <= radius else { return false }
        guard let lastPublishedLocation else { return true }
        return location.distance(from: lastPublishedLocation) >= radius
    }
}

/// 평시 위치 전송은 작업시간과 작업구역 안에서만 허용한다.
/// 사고 이벤트는 이 정책과 무관하게 incident_snapshot 으로 별도 저장한다.
enum VitAlGuardWorkTrackingPolicy {
    static let defaultStartMinutes = 7 * 60
    static let defaultEndMinutes = 19 * 60

    static func isWithinWorkHours(
        date: Date = Date(),
        calendar: Calendar = Calendar(identifier: .gregorian),
        startMinutes: Int = defaultStartMinutes,
        endMinutes: Int = defaultEndMinutes
    ) -> Bool {
        var localCalendar = calendar
        localCalendar.timeZone = .current
        let components = localCalendar.dateComponents([.hour, .minute], from: date)
        guard let hour = components.hour, let minute = components.minute else { return false }
        let current = hour * 60 + minute
        let start = max(0, min(1_439, startMinutes))
        let end = max(0, min(1_439, endMinutes))
        if start == end { return false }
        return start < end ? (start...end).contains(current) : current >= start || current <= end
    }

    static func isWithinWorkArea(
        location: CLLocation,
        center: CLLocation,
        radiusMeters: CLLocationDistance
    ) -> Bool {
        guard location.horizontalAccuracy > 0 else { return false }
        return location.distance(from: center) <= VitAlGuardLocationUpdatePolicy.clampedRadius(radiusMeters)
    }
}

enum VitAlGuardQuickAction: String, Codable, Hashable {
    case sos
    case callManager
    case shareLocation
    case openCamera
    case scanQRCode

    var title: String {
        switch self {
        case .sos: return "SOS"
        case .callManager: return "관리자 호출"
        case .shareLocation: return "위치 공유"
        case .openCamera: return "증빙 촬영"
        case .scanQRCode: return "QR 스캔"
        }
    }

    var dashboardReason: String {
        switch self {
        case .sos: return "action_button_sos"
        case .callManager: return "action_button_manager_call"
        case .shareLocation: return "action_button_location_share"
        case .openCamera: return "action_button_camera"
        case .scanQRCode: return "action_button_qr_scan"
        }
    }
}

struct VitAlGuardActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var mode: String
        var title: String
        var status: String
        var detail: String
        var safetyIndex: Int
        var updatedAt: Date
        var interfaceStyle: String = "system"
    }

    var userId: String
}

enum VitAlGuardDashboardShared {
    static let safetyMonitor = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app"
    static let appAPI = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/api/mock/vital"

    static func normalizedEndpoint(from raw: String?) -> String {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return appAPI }
        guard var components = URLComponents(string: trimmed) else { return appAPI }
        if components.scheme == nil {
            components.scheme = "https"
        }
        if components.path.isEmpty || components.path == "/" {
            components.path = "/api/mock/vital"
        } else if components.path == "/api/mock" {
            components.path = "/api/mock/vital"
        }
        return components.url?.absoluteString ?? appAPI
    }

    static func payload(
        loginId: String,
        employeeId: String,
        workerName: String,
        mode: AppMode,
        reason: String,
        isFallDetected: Bool = false,
        date: Date = Date()
    ) -> [String: Any] {
        let workerId = employeeId.isEmpty ? loginId : employeeId

        var output: [String: Any] = [
            "workerId": workerId,
            "ts": ISO8601DateFormatter().string(from: date),
            "jobTitle": mode == .admin ? "안전 관리자" : "현장 근로자",
            "manualSos": reason == "sos",
            "fallDetected": isFallDetected && reason != "fall_demo",
            "source": simulatorVitalSource(),
            "appMode": mode.rawValue,
            "syncReason": reason
        ]
        if !workerName.isEmpty { output["workerName"] = workerName }
        if !employeeId.isEmpty { output["employeeId"] = employeeId }
        if !loginId.isEmpty {
            output["loginId"] = loginId
        }
#if targetEnvironment(simulator)
        output["simulatorDeviceModel"] = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? "iPhone Simulator"
        output["simulatorIdentifier"] = ProcessInfo.processInfo.environment["SIMULATOR_UDID"]
#endif
        return output
    }

    private static func simulatorVitalSource() -> String {
#if targetEnvironment(simulator)
        return "VitAlGuard-Mock-iOS"
#else
        return "VitAlGuard-iPhone"
#endif
    }
}

enum VitAlGuardSharedStorage {
    static let appGroupIdentifier = "group.com.yangjeehoo.vitalguard"
    private static let snapshotKey = "preview.watchSnapshot"
    private static let syncKey = "preview.lastWatchSync"
    private static let appModeKey = "preview.appMode"
    private static let quickActionKey = "preview.quickAction"
    private static let quickActionDateKey = "preview.quickActionDate"
    private static let walletIdentityKey = "preview.walletIdentity"
    private static let walletQRPNGDataKey = "preview.walletQRPNGData"
    private static let walletBarcodePNGDataKey = "preview.walletBarcodePNGData"
    private static let walletSyncKey = "preview.lastWalletSync"
    private static let heartRateHistoryKey = "preview.heartRateHistory"
    // 홈 심박 카드가 덮는 시간 창. 1분에 한 점만 남기므로 3시간이면 최대 180점이다.
    private static let heartRateHistoryWindow: TimeInterval = 3 * 60 * 60
    private static let heartRateHistoryBucket: TimeInterval = 60
    private static let heartRatePlausibleRange = 25.0...250.0
    private static let wristTemperatureKeys: Set<String> = [
        "wristTemperatureC",
        "wristTemperature",
        "wristTempC",
        "wristTemp",
        "wrist_temp_c",
        "wrist_temp",
        "skinTempC",
        "skin_temp_c",
        "skinTemperatureC",
        "skinTemperature",
        "skin_temp",
        "skinTemp",
        "bodyTempC",
        "bodyTemp",
        "bodyTemperatureCelsius",
        "bodyTemperatureC",
        "bodyTemperature",
        "body_temp_c",
        "body_temp",
        "bodytemperature",
        "watch_wristTemperatureC",
        "watch_skinTempC",
        "watch_skin_temp_c",
        "watch_skinTemperatureC",
        "watch_skinTemperature",
        "watch_wristTemperature",
        "watch_wristTempC",
        "watch_wristTemp",
        "watch_bodyTempC",
        "watch_bodyTemp",
        "watch_bodyTemperature"
    ]
    private static let wristTemperatureRange = 20.0...45.0
    private static let wristTemperatureFahrenheitRange = 84.0...120.0

    private static var appDefaults: UserDefaults {
        UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    private static let emptyValueSentinels: Set<String> = ["", "--"]

    private static let acceptableWatchSources: Set<String> = [
        "VitAlGuard-WatchVitals",
        "VitAlGuard-Watch-background",
        "VitAlGuard-Watch"
    ]

    private static func isWatchVitalsPayload(_ payload: [String: Any]) -> Bool {
        guard JSONSerialization.isValidJSONObject(payload) else { return false }

        guard let source = payload["source"] as? String else { return false }
        if acceptableWatchSources.contains(source) { return true }

        let hasWatchNumericSignal = payload["heartRate"] != nil
            || payload["spo2"] != nil
            || payload["steps"] != nil
            || wristTemperatureKeys.contains { payload[$0] != nil }
            || payload["relativeAltitudeMeters"] != nil
            || payload["barometricPressureKPa"] != nil
            || payload["accelerationMagnitudeG"] != nil
            || payload["rotationRateRadS"] != nil
            || payload["hrvSdnnMs"] != nil
            || payload["respiratoryRate"] != nil
            || payload["activeEnergyKcal"] != nil
            || payload["exerciseTimeMinutes"] != nil
            || payload["standTimeMinutes"] != nil
            || payload["moveTimeMinutes"] != nil
            || payload["sleepingBreathingDisturbances"] != nil
            || payload["sleepingBreathingDisturbancesClassification"] != nil
            || payload["sleepApneaRisk"] != nil

        if !hasWatchNumericSignal { return false }

        let sourceLikeWatchContext = payload["request"] as? String == nil
            && payload["endpointURL"] == nil
        return sourceLikeWatchContext
    }

    private static func shouldIgnoreValue(_ key: String, value: Any) -> Bool {
        if wristTemperatureKeys.contains(key) {
            if let numeric = numericValue(value) {
                return normalizeWristTemperature(numeric) == nil
            } else {
                return true
            }
        }
        guard let stringValue = value as? String else { return false }
        return emptyValueSentinels.contains(stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func normalizeWristTemperature(_ value: Double) -> Double? {
        let rounded = (value * 10).rounded() / 10
        if wristTemperatureRange.contains(rounded) {
            return rounded
        }
        if wristTemperatureFahrenheitRange.contains(rounded) {
            return ((rounded - 32) * 5 / 9 * 10).rounded() / 10
        }
        return nil
    }

    private static func numericValue(_ value: Any) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? Float { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = value as? String {
            let normalized = value
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: ",", with: ".")
                .replacingOccurrences(of: "℃", with: "")
                .replacingOccurrences(of: "°C", with: "")
                .replacingOccurrences(of: "°", with: "")
                .replacingOccurrences(of: "C", with: "")
                .replacingOccurrences(of: "c", with: "")
                .replacingOccurrences(of: "F", with: "")
                .replacingOccurrences(of: "f", with: "")
            return Double(normalized)
        }
        return nil
    }

    private static func mergeWatchPayload(_ incoming: [String: Any], existing: [String: Any]?) -> [String: Any] {
        var merged = existing ?? [:]
        for (key, value) in incoming {
            if wristTemperatureKeys.contains(key), let numeric = numericValue(value), let normalized = normalizeWristTemperature(numeric) {
                merged["wristTemperatureC"] = normalized
                merged["wristTemperature"] = normalized
                merged["wristTempC"] = normalized
                merged["wristTemp"] = normalized
                merged["wrist_temp_c"] = normalized
                merged["wrist_temp"] = normalized
                merged["skinTempC"] = normalized
                merged["skin_temp_c"] = normalized
                merged["skinTemperatureC"] = normalized
                merged["skinTemperature"] = normalized
                merged["skin_temp"] = normalized
                merged["skinTemp"] = normalized
                merged["bodyTempC"] = normalized
                merged["bodyTemp"] = normalized
                merged["bodyTemperatureCelsius"] = normalized
                merged["bodyTemperatureC"] = normalized
                merged["bodyTemperature"] = normalized
                merged["body_temp_c"] = normalized
                merged["body_temp"] = normalized
                merged["bodytemperature"] = normalized
                continue
            }
            if shouldIgnoreValue(key, value: value) {
                continue
            }
            merged[key] = value
        }

        if merged.isEmpty {
            merged = incoming
        }

        if merged["updatedAt"] == nil {
            merged["updatedAt"] = ISO8601DateFormatter().string(from: Date())
        }
        return merged
    }

    static func saveWatchSnapshot(_ payload: [String: Any]) -> Bool {
        guard isWatchVitalsPayload(payload) else { return false }

        let existing = loadWatchSnapshot()?.values
        let merged = mergeWatchPayload(payload, existing: existing)

        guard let data = try? JSONSerialization.data(withJSONObject: merged)
        else { return false }
        let defaults = appDefaults
        defaults.set(data, forKey: snapshotKey)
        defaults.set(Date(), forKey: syncKey)
        // 병합본이 아니라 이번에 들어온 payload 의 심박만 쌓는다 — 병합본은 직전 값을 그대로 물고 온다.
        if let raw = payload["heartRate"], let bpm = numericValue(raw) {
            appendHeartRateSample(Int(bpm.rounded()))
        }
        return true
    }

    static func loadWatchSnapshot() -> (values: [String: Any], receivedAt: Date)? {
        let defaults = appDefaults
        guard let data = defaults.data(forKey: snapshotKey),
              let values = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let receivedAt = defaults.object(forKey: syncKey) as? Date ?? Date.distantPast
        return (values, receivedAt)
    }

    // 워치가 실제로 보내온 심박만 시각과 함께 쌓는다. 홈 심박 카드의 그래프·평균/최소/최대는 이 기록만 읽는다.
    static func appendHeartRateSample(_ bpm: Int, at date: Date = Date()) {
        guard heartRatePlausibleRange.contains(Double(bpm)) else { return }
        let defaults = appDefaults
        let stored = defaults.dictionary(forKey: heartRateHistoryKey)
        var times = stored?["t"] as? [Double] ?? []
        var values = stored?["v"] as? [Int] ?? []
        let stamp = date.timeIntervalSince1970
        guard times.count == values.count else {
            // 두 배열의 길이가 어긋나면 어느 시각의 값인지 말할 수 없다. 이어 붙이지 않고 버린다.
            defaults.set(["t": [stamp], "v": [bpm]], forKey: heartRateHistoryKey)
            return
        }
        // 같은 1분 버킷은 최신 값으로 덮는다 — 초 단위 수신을 그대로 쌓으면 창이 조용히 짧아진다.
        if let last = times.last, stamp - last < heartRateHistoryBucket {
            times[times.count - 1] = stamp
            values[values.count - 1] = bpm
        } else {
            times.append(stamp)
            values.append(bpm)
        }
        let cutoff = stamp - heartRateHistoryWindow
        while let first = times.first, first < cutoff {
            times.removeFirst()
            values.removeFirst()
        }
        defaults.set(["t": times, "v": values], forKey: heartRateHistoryKey)
    }

    // 창 밖 점은 읽는 쪽에서도 한 번 더 걸러 낸다 — 마지막 수신이 오래된 채 앱만 다시 열릴 수 있다.
    static func loadHeartRateHistory(now: Date = Date()) -> [(date: Date, bpm: Int)] {
        guard let stored = appDefaults.dictionary(forKey: heartRateHistoryKey),
              let times = stored["t"] as? [Double],
              let values = stored["v"] as? [Int],
              times.count == values.count
        else { return [] }
        let cutoff = now.timeIntervalSince1970 - heartRateHistoryWindow
        return zip(times, values)
            .filter { $0.0 >= cutoff }
            .map { (date: Date(timeIntervalSince1970: $0.0), bpm: $0.1) }
    }

    static func saveAppMode(_ mode: AppMode) {
        appDefaults.set(mode.rawValue, forKey: appModeKey)
    }

    static func saveWalletIdentityPayload(_ payload: [String: String]) {
        let defaults = appDefaults
        defaults.set(payload, forKey: walletIdentityKey)
        defaults.set(Date(), forKey: walletSyncKey)
    }

    static func loadAppMode() -> AppMode? {
        guard let raw = appDefaults.string(forKey: appModeKey) else { return nil }
        return AppMode(rawValue: raw)
    }

    static func saveQuickAction(_ action: VitAlGuardQuickAction) {
        let defaults = appDefaults
        defaults.set(action.rawValue, forKey: quickActionKey)
        defaults.set(Date(), forKey: quickActionDateKey)
    }

    static func consumeQuickAction() -> VitAlGuardQuickAction? {
        let defaults = appDefaults
        guard let raw = defaults.string(forKey: quickActionKey),
              let action = VitAlGuardQuickAction(rawValue: raw)
        else { return nil }
        defaults.removeObject(forKey: quickActionKey)
        defaults.removeObject(forKey: quickActionDateKey)
        return action
    }

    static func saveWalletIdentity(_ payload: [String: String], qrPNGData: Data?, barcodePNGData: Data?) {
        let defaults = appDefaults
        defaults.set(payload, forKey: walletIdentityKey)
        defaults.set(qrPNGData, forKey: walletQRPNGDataKey)
        defaults.set(barcodePNGData, forKey: walletBarcodePNGDataKey)
        defaults.set(Date(), forKey: walletSyncKey)
    }

    static func loadWalletIdentity() -> (payload: [String: String], qrPNGData: Data?, barcodePNGData: Data?, receivedAt: Date)? {
        let defaults = appDefaults
        guard let payload = defaults.dictionary(forKey: walletIdentityKey) as? [String: String] else { return nil }
        return (
            payload,
            defaults.data(forKey: walletQRPNGDataKey),
            defaults.data(forKey: walletBarcodePNGDataKey),
            defaults.object(forKey: walletSyncKey) as? Date ?? Date.distantPast
        )
    }
}
