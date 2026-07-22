import ActivityKit
import Foundation

enum AppMode: String, Codable, Hashable {
    case admin
    case worker
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
        date: Date = Date()
    ) -> [String: Any] {
        let workerId: String
        if !employeeId.isEmpty {
            workerId = employeeId
        } else if !loginId.isEmpty {
            workerId = loginId
        } else {
            workerId = mode == .admin ? "admin001" : "worker001"
        }

        var output: [String: Any] = [
            "workerId": workerId,
            "ts": ISO8601DateFormatter().string(from: date),
            "workerName": workerName.isEmpty ? (mode == .admin ? "관리자 \(workerId)" : workerId) : workerName,
            "employeeId": employeeId.isEmpty ? workerId : employeeId,
            "jobTitle": mode == .admin ? "안전 관리자" : "현장 근로자",
            "manualSos": reason == "sos",
            "fallDetected": reason == "fall" || reason == "fall_demo",
            "source": "VitAlGuard-iPhone",
            "appMode": mode.rawValue,
            "syncReason": reason
        ]
        if !loginId.isEmpty {
            output["loginId"] = loginId
        }
        return output
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
