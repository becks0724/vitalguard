// 워치 인앱 설정 스토어 — 연동 URL + 작업자 프로필(이름/사원번호) 편집·영속
// 정식 HTTPS 대시보드 API를 기본값으로 사용하고, iPhone 앱에서 받은 로그인/연동 정보를 함께 반영한다.
// 작업자 식별자(workerId)는 사원번호에서 파생 → 대시보드에서 폰/다른 워치와 자동 분리.
import Foundation
import Combine
import WatchConnectivity
import CoreLocation
import Security

private enum WatchAppCredentialStore {
    private static let service = "com.yangjeehoo.vitalguard.watch.dashboard"
    private static let account = "appAuthJWT"

    static func save(_ token: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        guard !token.isEmpty, let data = token.data(using: .utf8) else { return }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func load() -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var raw: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &raw) == errSecSuccess,
              let data = raw as? Data,
              let token = String(data: data, encoding: .utf8) else { return "" }
        return token
    }
}

enum WatchSensorPowerMode: String, CaseIterable, Hashable {
    case extreme
    case balanced
    case lowPower

    var title: String {
        switch self {
        case .extreme: return "익스트림"
        case .balanced: return "균형"
        case .lowPower: return "저전력"
        }
    }

    var detail: String {
        switch self {
        case .extreme:
            return "실시간 전송 우선. 배터리 소모가 가장 큽니다."
        case .balanced:
            return "모든 센서를 유지하되 HealthKit 동기화 중심으로 전송을 줄입니다."
        case .lowPower:
            return "평상시 전송을 줄이고 이상 징후 시 30분 증거 수집으로 전환합니다."
        }
    }
}

enum WatchAppMode: String {
    case admin
    case worker

    var title: String {
        switch self {
        case .admin: return "관리자"
        case .worker: return "근로자"
        }
    }
}

enum WatchDashboardConnectionState: Equatable {
    case connected
    case delayed
    case offline

    var title: String {
        switch self {
        case .connected: return "관제웹 연결됨"
        case .delayed: return "관제웹 지연"
        case .offline: return "관제웹 연결 안됨"
        }
    }

    var detail: String {
        switch self {
        case .connected: return "대시보드 응답 정상"
        case .delayed: return "응답이 늦거나 확인 중"
        case .offline: return "네트워크 또는 서버 확인 필요"
        }
    }

    var activeIndex: Int {
        switch self {
        case .connected: return 0
        case .delayed: return 1
        case .offline: return 2
        }
    }
}

final class ConnectionSettings: NSObject, ObservableObject, WCSessionDelegate {
    static let nfcFeatureEnabled = true
    private static var lastMeasuredVitalsPublishAt: Date?
    private static let measuredVitalsPublishInterval: TimeInterval = 60
    private enum SyncRequest: String {
        case sessionSync = "watchSessionSync"
        case manualSync = "watchManualSync"
        case watchNfcScan = "watchNfcScan"
        case watchNfcScanResult = "watchNfcScanResult"
        case fallAlertClear = "fallAlertClear"
    }

    // 기본값 — 빌드 설정(RECEIVER_URL_DEFAULT) 미주입/무효 시의 최종 폴백.
    static let defaultURLString =
        "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/api/mock/vital"
    private static let fallbackURLString = defaultURLString
    static let defaultWorkerName = "워치PoC"
    static let defaultEmployeeId = "EMP-9001"

    private static let urlKey = "receiverURL"
    private static let nameKey = "workerName"
    private static let empKey = "employeeId"
    private static let loginIdKey = "watchLoginId"
    private static let appModeKey = "watchAppMode"
    private static let serverRoleKey = "watchServerRole"
    private static let canManageDashboardKey = "watchCanManageDashboard"
    private static let syncIntervalKey = "watchSyncIntervalSeconds"
    private static let timeBasedUpdatesEnabledKey = "watchTimeBasedUpdatesEnabled"
    private static let locationBasedUpdatesEnabledKey = "watchLocationBasedUpdatesEnabled"
    private static let locationUpdateRadiusMetersKey = "watchLocationUpdateRadiusMeters"
    private static let sensorPowerModeKey = "watchSensorPowerMode"
    private static let energyEfficiencyMigrationKey = "watchEnergyEfficiencyMigration.v1"
    private static let languageCodeKey = "watchLanguageCode"
    // 마지막으로 적용된 번들 기본 URL 의 스탬프. 새 빌드에서 defaultURLString 이 바뀌면(재설치)
    // 저장된 옛 URL 을 자동으로 새 기본값으로 교체 → 터널 회전 후 재설치 시 인앱 수정 없이 즉시 반영.
    private static let urlStampKey = "receiverURLStamp"

    @Published var urlString: String {
        didSet {
            let normalized = Self.normalizedReceiverURLString(urlString)
            if urlString != normalized {
                urlString = normalized
                return
            }
            UserDefaults.standard.set(urlString, forKey: Self.urlKey)
        }
    }
    @Published var workerName: String {
        didSet { UserDefaults.standard.set(workerName, forKey: Self.nameKey) }
    }
    @Published var employeeId: String {
        didSet { UserDefaults.standard.set(employeeId, forKey: Self.empKey) }
    }
    @Published var loginId: String {
        didSet { UserDefaults.standard.set(loginId, forKey: Self.loginIdKey) }
    }
    @Published var appMode: WatchAppMode {
        didSet { UserDefaults.standard.set(appMode.rawValue, forKey: Self.appModeKey) }
    }
    @Published var serverRole: String {
        didSet { UserDefaults.standard.set(serverRole, forKey: Self.serverRoleKey) }
    }
    @Published var canManageDashboard: Bool {
        didSet { UserDefaults.standard.set(canManageDashboard, forKey: Self.canManageDashboardKey) }
    }
    @Published var languageCode: String {
        didSet { UserDefaults.standard.set(languageCode, forKey: Self.languageCodeKey) }
    }
    @Published var sensorPowerMode: WatchSensorPowerMode {
        didSet {
            UserDefaults.standard.set(sensorPowerMode.rawValue, forKey: Self.sensorPowerModeKey)
            guard sensorPowerMode != oldValue else { return }
            NotificationCenter.default.post(name: .vitalguardWatchPowerModeDidChange, object: nil)
        }
    }
    @Published private var translationCache: [String: String] = [:]
    @Published var syncIntervalSeconds: Double {
        didSet {
            let clamped = Self.clampedSyncInterval(syncIntervalSeconds)
            if syncIntervalSeconds != clamped {
                syncIntervalSeconds = clamped
                return
            }
            UserDefaults.standard.set(syncIntervalSeconds, forKey: Self.syncIntervalKey)
        }
    }
    @Published var timeBasedUpdatesEnabled: Bool {
        didSet {
            UserDefaults.standard.set(timeBasedUpdatesEnabled, forKey: Self.timeBasedUpdatesEnabledKey)
            if timeBasedUpdatesEnabled != oldValue {
                NotificationCenter.default.post(name: .vitalguardWatchUpdatePolicyDidChange, object: nil)
            }
        }
    }
    @Published var locationBasedUpdatesEnabled: Bool {
        didSet {
            UserDefaults.standard.set(locationBasedUpdatesEnabled, forKey: Self.locationBasedUpdatesEnabledKey)
            if locationBasedUpdatesEnabled != oldValue {
                NotificationCenter.default.post(name: .vitalguardWatchUpdatePolicyDidChange, object: nil)
            }
        }
    }
    @Published var locationUpdateRadiusMeters: Double {
        didSet {
            let clamped = Self.clampedLocationUpdateRadius(locationUpdateRadiusMeters)
            if locationUpdateRadiusMeters != clamped {
                locationUpdateRadiusMeters = clamped
                return
            }
            UserDefaults.standard.set(locationUpdateRadiusMeters, forKey: Self.locationUpdateRadiusMetersKey)
            if locationUpdateRadiusMeters != oldValue {
                NotificationCenter.default.post(name: .vitalguardWatchUpdatePolicyDidChange, object: nil)
            }
        }
    }
    @Published var dashboardConnectionState: WatchDashboardConnectionState = .delayed
    private var dashboardConnectionTimer: Timer?
    private var isDashboardConnectionCheckInFlight = false

    override init() {
        let d = UserDefaults.standard
        Self.migrateEnergyEfficiencyDefaultsIfNeeded(d)
        let bundledDefaultURL = Self.bundledDefaultURLString()
        Self.migrateDefaultURLIfNeeded(d, bundledDefaultURL: bundledDefaultURL)
        urlString = d.string(forKey: Self.urlKey) ?? bundledDefaultURL
        workerName = d.string(forKey: Self.nameKey) ?? Self.defaultWorkerName
        employeeId = d.string(forKey: Self.empKey) ?? Self.defaultEmployeeId
        loginId = d.string(forKey: Self.loginIdKey) ?? ""
        let rawMode = d.string(forKey: Self.appModeKey) ?? WatchAppMode.worker.rawValue
        let initialMode = WatchAppMode(rawValue: rawMode) ?? .worker
        let initialServerRole = Self.normalizedServerRole(d.string(forKey: Self.serverRoleKey), fallbackMode: initialMode)
        appMode = initialMode
        serverRole = initialServerRole
        canManageDashboard = d.object(forKey: Self.canManageDashboardKey) as? Bool
            ?? Self.canManageDashboard(for: initialServerRole, fallbackMode: initialMode)
        languageCode = d.string(forKey: Self.languageCodeKey) ?? ""
        let rawSensorMode = d.string(forKey: Self.sensorPowerModeKey) ?? WatchSensorPowerMode.balanced.rawValue
        sensorPowerMode = WatchSensorPowerMode(rawValue: rawSensorMode) ?? .balanced
        let savedInterval = d.object(forKey: Self.syncIntervalKey) as? Double ?? 300
        syncIntervalSeconds = Self.clampedSyncInterval(savedInterval)
        timeBasedUpdatesEnabled = d.object(forKey: Self.timeBasedUpdatesEnabledKey) as? Bool ?? true
        locationBasedUpdatesEnabled = d.object(forKey: Self.locationBasedUpdatesEnabledKey) as? Bool ?? true
        let savedRadius = d.object(forKey: Self.locationUpdateRadiusMetersKey) as? Double ?? 500
        locationUpdateRadiusMeters = Self.clampedLocationUpdateRadius(savedRadius)
        super.init()
        translationCache = d.dictionary(forKey: Self.translationCacheKey) as? [String: String] ?? [:]
        activatePhoneSession()
        startDashboardConnectionMonitor()
    }

    deinit {
        dashboardConnectionTimer?.invalidate()
    }

    var isLoggedIn: Bool {
        !loginId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var serverRoleTitle: String {
        Self.serverRoleTitle(serverRole)
    }

    var permissionSummary: String {
        canManageDashboard
            ? "현장정보 저장 · 캘린더 수정/삭제 가능"
            : "조회 · 본인 파일 업로드 전용"
    }

    func signIn(id: String) {
        let normalized = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }
        loginId = normalized
        appMode = Self.mode(for: normalized)
        serverRole = Self.normalizedServerRole(nil, fallbackMode: appMode)
        canManageDashboard = Self.canManageDashboard(for: serverRole, fallbackMode: appMode)
        employeeId = Self.employeeId(for: normalized)
    }

    func signIn(id: String, mode: WatchAppMode) {
        let normalized = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }
        loginId = normalized
        appMode = mode
        serverRole = Self.normalizedServerRole(nil, fallbackMode: mode)
        canManageDashboard = Self.canManageDashboard(for: serverRole, fallbackMode: mode)
        employeeId = Self.employeeId(for: normalized)
    }

    func signOut() {
        loginId = ""
        appMode = .worker
        serverRole = "worker"
        canManageDashboard = false
    }

    func activatePhoneSession() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        applyPhoneContext(WCSession.default.applicationContext)
    }

    func syncLoginFromPhone() {
        activatePhoneSession()
        checkDashboardConnection()
        let request: [String: Any] = ["request": "loginContext", "source": "VitAlGuard-Watch"]
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(request, replyHandler: { [weak self] reply in
                if reply["source"] as? String == "VitAlGuard-iPhone" {
                    self?.applyPhoneContext(reply)
                }
            }, errorHandler: { _ in
                WCSession.default.transferUserInfo(request)
            })
        } else {
            WCSession.default.transferUserInfo(request)
        }
    }

    static func publishMeasuredVitals(_ snapshot: MeasuredVitalSnapshot) {
        guard WCSession.isSupported() else { return }
        let now = Date()
        if let lastMeasuredVitalsPublishAt,
           now.timeIntervalSince(lastMeasuredVitalsPublishAt) < measuredVitalsPublishInterval {
            return
        }
        lastMeasuredVitalsPublishAt = now
        let payload = snapshot.dictionary
        if WCSession.default.activationState == .notActivated {
            WCSession.default.activate()
        }
        do {
            try WCSession.default.updateApplicationContext(payload)
        } catch {
            return
        }
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
    }


    func requestManualSync(reason: String = "manual") {
        checkDashboardConnection()
        let request: [String: Any] = [
            "source": "VitAlGuard-iPhone",
            "request": SyncRequest.manualSync.rawValue,
            "requestReason": reason,
            "mode": appMode.rawValue,
            "serverRole": serverRole,
            "canManageDashboard": canManageDashboard,
            "canUploadOwnMedia": true,
            "syncIntervalSeconds": Self.clampedSyncInterval(syncIntervalSeconds),
            "timeBasedUpdatesEnabled": timeBasedUpdatesEnabled,
            "locationBasedUpdatesEnabled": locationBasedUpdatesEnabled,
            "locationUpdateRadiusMeters": Self.clampedLocationUpdateRadius(locationUpdateRadiusMeters),
            "sensorPowerMode": sensorPowerMode.rawValue,
            "endpointURL": currentURLString()
        ]
        if WCSession.default.activationState == .notActivated {
            activatePhoneSession()
        }
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(request, replyHandler: nil) { _ in
                WCSession.default.transferUserInfo(request)
            }
        } else {
            WCSession.default.transferUserInfo(request)
        }
    }

    func requestWatchNFCScan() {
        guard Self.nfcFeatureEnabled else { return }
        activatePhoneSession()
        let requestId = UUID().uuidString
        let request: [String: Any] = [
            "source": "VitAlGuard-Watch",
            "request": SyncRequest.watchNfcScan.rawValue,
            "requestId": requestId
        ]
        NotificationCenter.default.post(
            name: .vitalguardWatchNfcScanResult,
            object: nil,
            userInfo: [
                "request": SyncRequest.watchNfcScanResult.rawValue,
                "status": "requesting",
                "message": "아이폰에서 NFC 태그 조회를 요청했습니다.",
                "requestId": requestId,
                "source": "VitAlGuard-Watch"
            ]
        )
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(request, replyHandler: nil) { _ in
                WCSession.default.transferUserInfo(request)
            }
        } else {
            WCSession.default.transferUserInfo(request)
        }
    }

    private func applyPhoneContext(_ context: [String: Any]) {
        guard context["source"] as? String == "VitAlGuard-iPhone" else { return }
        let loggedIn = context["loggedIn"] as? Bool
        let incomingId = (context["loginId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let incomingMode = WatchAppMode(rawValue: context["mode"] as? String ?? "") ?? Self.mode(for: incomingId)
        let incomingServerRole = Self.normalizedServerRole(context["serverRole"] as? String, fallbackMode: incomingMode)
        let incomingCanManage = context["canManageDashboard"] as? Bool
            ?? Self.canManageDashboard(for: incomingServerRole, fallbackMode: incomingMode)
        let incomingInterval = context["syncIntervalSeconds"] as? Double
        let incomingSensorPowerMode = WatchSensorPowerMode(rawValue: context["sensorPowerMode"] as? String ?? "")
        let incomingTimeBasedUpdatesEnabled = context["timeBasedUpdatesEnabled"] as? Bool
        let incomingLocationBasedUpdatesEnabled = context["locationBasedUpdatesEnabled"] as? Bool
        let incomingLocationUpdateRadiusMeters = context["locationUpdateRadiusMeters"] as? Double
        let incomingEndpoint = (context["endpointURL"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let incomingEmployeeId = (context["employeeId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let incomingLanguageCode = (context["languageCode"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let incomingAppJWT = (context["appAuthJWT"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        if loggedIn == true, !incomingAppJWT.isEmpty {
            WatchAppCredentialStore.save(incomingAppJWT)
        } else if loggedIn == false {
            WatchAppCredentialStore.save("")
        }

        DispatchQueue.main.async {
            if loggedIn == true, !incomingId.isEmpty {
                self.loginId = incomingId
                self.appMode = incomingMode
                self.serverRole = incomingServerRole
                self.canManageDashboard = incomingCanManage
                self.employeeId = incomingEmployeeId.isEmpty ? Self.employeeId(for: incomingId) : incomingEmployeeId
            } else if loggedIn == false, !self.loginId.isEmpty, incomingId.isEmpty {
                // Older queued contexts can arrive after a fresh iPhone login. Do not let
                // an empty stale payload flip an already-synced admin watch back to worker.
            } else if loggedIn == false {
                self.loginId = ""
                self.appMode = .worker
                self.serverRole = "worker"
                self.canManageDashboard = false
            } else if !incomingId.isEmpty {
                self.loginId = incomingId
                self.appMode = incomingMode
                self.serverRole = incomingServerRole
                self.canManageDashboard = incomingCanManage
                self.employeeId = incomingEmployeeId.isEmpty ? Self.employeeId(for: incomingId) : incomingEmployeeId
            } else if context["mode"] is String, !self.loginId.isEmpty {
                self.appMode = incomingMode
                self.serverRole = incomingServerRole
                self.canManageDashboard = incomingCanManage
            }
            if let incomingInterval {
                self.syncIntervalSeconds = incomingInterval
            }
            if let incomingSensorPowerMode {
                self.sensorPowerMode = incomingSensorPowerMode
            }
            if let incomingTimeBasedUpdatesEnabled {
                self.timeBasedUpdatesEnabled = incomingTimeBasedUpdatesEnabled
            }
            if let incomingLocationBasedUpdatesEnabled {
                self.locationBasedUpdatesEnabled = incomingLocationBasedUpdatesEnabled
            }
            if let incomingLocationUpdateRadiusMeters {
                self.locationUpdateRadiusMeters = incomingLocationUpdateRadiusMeters
            }
            if !incomingEndpoint.isEmpty, URL(string: incomingEndpoint) != nil {
                self.urlString = Self.normalizedReceiverURLString(incomingEndpoint)
            }
            self.languageCode = incomingLanguageCode
        }
    }

    static func currentAppJWT() -> String { WatchAppCredentialStore.load() }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if message["request"] as? String == SyncRequest.manualSync.rawValue {
            applyPhoneContext(message)
            postManualSyncRequestIfNeeded(message)
            replyHandler(["status": "watchManualSyncAccepted", "source": "VitAlGuard-Watch"])
            return
        } else if message["request"] as? String == SyncRequest.fallAlertClear.rawValue {
            postFallAlertClear(message)
            replyHandler(["status": "fallAlertCleared", "source": "VitAlGuard-Watch"])
            return
        } else if message["request"] as? String == SyncRequest.watchNfcScanResult.rawValue {
            postWatchNFCScanResult(message)
            replyHandler(["status": "watchNfcScanResultAccepted", "source": "VitAlGuard-Watch"])
            return
        }
        if message["source"] as? String == "VitAlGuard-iPhone" || message["request"] as? String == SyncRequest.sessionSync.rawValue {
            applyPhoneContext(message)
            replyHandler(["status": "phoneContextApplied", "source": "VitAlGuard-Watch"])
            return
        }
        replyHandler(["status": "ignored"])
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if message["source"] as? String == "VitAlGuard-WatchVitals" {
            // 실측 payload는 현재 애플워치 샘플은 측정/전송 흐름에서 자체적으로 처리하고 있으므로,
            // iPhone 쪽 메시지는 동기화 요청/로그인 동기화용만 수신 처리합니다.
            return
        }
        if message["request"] as? String == SyncRequest.watchNfcScanResult.rawValue {
            postWatchNFCScanResult(message)
        }
        if message["request"] as? String == SyncRequest.fallAlertClear.rawValue {
            postFallAlertClear(message)
        } else if message["request"] as? String == SyncRequest.manualSync.rawValue {
            applyPhoneContext(message)
            postManualSyncRequestIfNeeded(message)
        } else if message["source"] as? String == "VitAlGuard-iPhone" || message["request"] as? String == SyncRequest.sessionSync.rawValue {
            applyPhoneContext(message)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        applyPhoneContext(applicationContext)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        let request = userInfo["request"] as? String
        if request == SyncRequest.manualSync.rawValue {
            applyPhoneContext(userInfo)
            postManualSyncRequestIfNeeded(userInfo)
            return
        } else if request == SyncRequest.fallAlertClear.rawValue {
            postFallAlertClear(userInfo)
            return
        } else if request == SyncRequest.watchNfcScanResult.rawValue {
            postWatchNFCScanResult(userInfo)
        }
        applyPhoneContext(userInfo)
    }

    private func postManualSyncRequestIfNeeded(_ message: [String: Any]) {
        guard (message["request"] as? String) == SyncRequest.manualSync.rawValue else { return }
        NotificationCenter.default.post(name: .vitalguardWatchManualSyncRequest, object: nil)
    }

    private func postWatchNFCScanResult(_ message: [String: Any]) {
        guard message["request"] as? String == SyncRequest.watchNfcScanResult.rawValue else { return }
        NotificationCenter.default.post(name: .vitalguardWatchNfcScanResult, object: nil, userInfo: message)
    }

    private func postFallAlertClear(_ message: [String: Any]) {
        guard message["request"] as? String == SyncRequest.fallAlertClear.rawValue else { return }
        NotificationCenter.default.post(name: .vitalguardWatchFallAlertClear, object: nil, userInfo: message)
    }

    private func currentURLString() -> String {
        Self.currentURL()?.absoluteString ?? Self.fallbackURLString
    }

    func checkDashboardConnection() {
        guard !isDashboardConnectionCheckInFlight else { return }
        guard let url = Self.dashboardBaseURL() else {
            dashboardConnectionState = .offline
            return
        }
        isDashboardConnectionCheckInFlight = true
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 5
        let startedAt = Date()
        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            guard let self else { return }
            let elapsed = Date().timeIntervalSince(startedAt)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let state: WatchDashboardConnectionState
            if error != nil || code == 0 || code >= 500 {
                state = .offline
            } else if elapsed > 2.5 || code >= 400 {
                state = .delayed
            } else {
                state = .connected
            }
            DispatchQueue.main.async {
                self.isDashboardConnectionCheckInFlight = false
                self.dashboardConnectionState = state
            }
        }.resume()
    }

    private func startDashboardConnectionMonitor() {
        dashboardConnectionTimer?.invalidate()
        checkDashboardConnection()
        let timer = Timer(timeInterval: 300, repeats: true) { [weak self] _ in
            self?.checkDashboardConnection()
        }
        timer.tolerance = 60
        RunLoop.main.add(timer, forMode: .common)
        dashboardConnectionTimer = timer
    }

    private static func dashboardBaseURL() -> URL? {
        guard let url = currentURL() else { return URL(string: "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app") }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        components?.fragment = nil
        return components?.url ?? URL(string: "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app")
    }

    private static let translationCacheKey = "watch.runtime.translation.cache"
    private static var inflightTranslationKeys = Set<String>()

    func localized(_ koreanText: String) -> String {
        guard Self.containsKorean(koreanText), let target = Self.googleTranslateCode(for: languageCode) else {
            return koreanText
        }
        let key = "\(target)|\(koreanText)"
        if let translated = translationCache[key], !translated.isEmpty {
            return translated
        }
        requestTranslationIfNeeded(text: koreanText, target: target, cacheKey: key)
        return koreanText
    }

    private func requestTranslationIfNeeded(text: String, target: String, cacheKey: String) {
        guard Self.inflightTranslationKeys.insert(cacheKey).inserted else { return }
        guard var components = URLComponents(string: "https://translate.googleapis.com/translate_a/single") else {
            Self.inflightTranslationKeys.remove(cacheKey)
            return
        }
        components.queryItems = [
            URLQueryItem(name: "client", value: "gtx"),
            URLQueryItem(name: "sl", value: "ko"),
            URLQueryItem(name: "tl", value: target),
            URLQueryItem(name: "dt", value: "t"),
            URLQueryItem(name: "q", value: text)
        ]
        guard let url = components.url else {
            Self.inflightTranslationKeys.remove(cacheKey)
            return
        }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            let translated = Self.parseGoogleTranslation(data)
            DispatchQueue.main.async {
                Self.inflightTranslationKeys.remove(cacheKey)
                guard let self, let translated, !translated.isEmpty else { return }
                self.translationCache[cacheKey] = translated
                UserDefaults.standard.set(self.translationCache, forKey: Self.translationCacheKey)
            }
        }.resume()
    }

    private static func googleTranslateCode(for rawCode: String) -> String? {
        let raw = rawCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let preferred = raw.isEmpty ? Locale.preferredLanguages.first ?? "ko" : raw
        if preferred.hasPrefix("ko") { return nil }
        if preferred.hasPrefix("zh-Hant") { return "zh-TW" }
        if preferred.hasPrefix("zh") { return "zh-CN" }
        if preferred.hasPrefix("nb") { return "no" }
        if let identifier = Locale(identifier: preferred).language.languageCode?.identifier {
            return identifier
        }
        return preferred
    }

    private static func containsKorean(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            (0xAC00...0xD7A3).contains(Int(scalar.value))
            || (0x1100...0x11FF).contains(Int(scalar.value))
            || (0x3130...0x318F).contains(Int(scalar.value))
        }
    }

    private static func parseGoogleTranslation(_ data: Data?) -> String? {
        guard let data,
              let root = try? JSONSerialization.jsonObject(with: data) as? [Any],
              let sentences = root.first as? [Any] else {
            return nil
        }
        let translated = sentences.compactMap { item -> String? in
            guard let tuple = item as? [Any] else { return nil }
            return tuple.first as? String
        }.joined()
        return translated.isEmpty ? nil : translated
    }

    static func mode(for id: String) -> WatchAppMode {
        let lowered = id.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if lowered.contains("admin")
            || lowered.contains("manager")
            || lowered.contains("adm")
            || lowered.contains("관리자") {
            return .admin
        }
        return .worker
    }

    static func normalizedServerRole(_ rawRole: String?, fallbackMode: WatchAppMode) -> String {
        let role = rawRole?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        switch role {
        case "owner", "admin", "worker":
            return role
        default:
            return fallbackMode == .admin ? "admin" : "worker"
        }
    }

    static func canManageDashboard(for role: String, fallbackMode: WatchAppMode) -> Bool {
        switch normalizedServerRole(role, fallbackMode: fallbackMode) {
        case "owner", "admin":
            return true
        default:
            return false
        }
    }

    static func serverRoleTitle(_ role: String) -> String {
        switch role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "owner":
            return "소유자"
        case "admin":
            return "관리자"
        default:
            return "근로자"
        }
    }

    static func employeeId(for loginId: String) -> String {
        let normalized = loginId.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? defaultEmployeeId : "EMP-\(normalized)"
    }

    // 번들 기본 URL 이 직전 적용본과 다르면(=새 빌드로 교체됨) 저장 URL 을 새 기본값으로 덮어쓴다.
    // 같은 빌드 내에서의 인앱 수동 편집은 스탬프가 일치하므로 보존된다(빌드당 1회만 갱신).
    private static func migrateDefaultURLIfNeeded(
        _ d: UserDefaults,
        bundledDefaultURL: String
    ) {
        if d.string(forKey: urlStampKey) != bundledDefaultURL {
            d.set(bundledDefaultURL, forKey: urlKey)
            d.set(bundledDefaultURL, forKey: urlStampKey)
        }
    }

    // 빌드 설정(RECEIVER_URL_DEFAULT) → Info.plist 경유 기본 URL. 미주입/빈값/미치환 토큰은 폴백.
    static func bundledDefaultURLString() -> String {
        let raw = Bundle.main.object(forInfoDictionaryKey: "ReceiverURLDefault") as? String
        let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !value.isEmpty,
              !value.hasPrefix("$("),
              URL(string: value) != nil
        else { return fallbackURLString }
        return value
    }

    static func normalizedReceiverURLString(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let bundledURL = URL(string: bundledDefaultURLString()),
              let components = URLComponents(string: trimmed),
              components.scheme == "https",
              components.host?.lowercased() == bundledURL.host?.lowercased(),
              components.path == "/api/mock/vital"
        else {
            return fallbackURLString
        }
        return components.url?.absoluteString ?? fallbackURLString
    }

    // 트랜스미터가 매 전송 시 최신값을 읽도록 하는 정적 접근(앱 재시작·세션 무관 즉시 반영).
    static func currentURL() -> URL? {
        let s = UserDefaults.standard.string(forKey: urlKey) ?? bundledDefaultURLString()
        return URL(string: normalizedReceiverURLString(s))
    }

    static func currentWorkerName() -> String {
        (UserDefaults.standard.string(forKey: nameKey) ?? defaultWorkerName)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func currentEmployeeId() -> String {
        (UserDefaults.standard.string(forKey: empKey) ?? defaultEmployeeId)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // workerId = 사원번호(입력 시) / 미입력 시 기본값. 항상 비어있지 않게 보장(스키마 min 1).
    static func currentWorkerId() -> String {
        let emp = currentEmployeeId()
        return emp.isEmpty ? defaultEmployeeId : emp
    }

    private static func migrateEnergyEfficiencyDefaultsIfNeeded(_ defaults: UserDefaults) {
        guard !defaults.bool(forKey: energyEfficiencyMigrationKey) else { return }
        let savedMode = defaults.string(forKey: sensorPowerModeKey)
        if savedMode == nil || savedMode == WatchSensorPowerMode.balanced.rawValue {
            defaults.set(WatchSensorPowerMode.balanced.rawValue, forKey: sensorPowerModeKey)
        }
        let savedInterval = defaults.object(forKey: syncIntervalKey) as? Double
        if savedInterval == nil || savedInterval?.rounded() == 10 {
            defaults.set(300.0, forKey: syncIntervalKey)
        }
        defaults.set(true, forKey: energyEfficiencyMigrationKey)
    }

    static func currentSyncIntervalSeconds() -> TimeInterval {
        let raw = UserDefaults.standard.object(forKey: syncIntervalKey) as? Double ?? 300
        return clampedSyncInterval(raw)
    }

    static func currentSensorPowerMode() -> WatchSensorPowerMode {
        let raw = UserDefaults.standard.string(forKey: sensorPowerModeKey) ?? WatchSensorPowerMode.balanced.rawValue
        return WatchSensorPowerMode(rawValue: raw) ?? .balanced
    }

    static func timeBasedUpdatesEnabled() -> Bool {
        UserDefaults.standard.object(forKey: timeBasedUpdatesEnabledKey) as? Bool ?? true
    }

    static func locationBasedUpdatesEnabled() -> Bool {
        UserDefaults.standard.object(forKey: locationBasedUpdatesEnabledKey) as? Bool ?? true
    }

    static func currentLocationUpdateRadiusMeters() -> CLLocationDistance {
        let raw = UserDefaults.standard.object(forKey: locationUpdateRadiusMetersKey) as? Double ?? 500
        return clampedLocationUpdateRadius(raw)
    }

    static func eventEvidenceDurationSeconds() -> TimeInterval { 30 * 60 }

    static func currentSensorReadIntervalSeconds(boosted: Bool = false) -> TimeInterval {
        if boosted { return 5 }
        switch currentSensorPowerMode() {
        case .extreme:
            return max(5, min(10, currentSyncIntervalSeconds()))
        case .balanced:
            return max(60, currentSyncIntervalSeconds())
        case .lowPower:
            return max(300, currentSyncIntervalSeconds())
        }
    }

    static func currentBackgroundSyncIntervalSeconds(boosted: Bool = false) -> TimeInterval {
        if boosted { return 5 }
        switch currentSensorPowerMode() {
        case .extreme:
            return max(5, min(10, currentSyncIntervalSeconds()))
        case .balanced:
            return max(120, currentSyncIntervalSeconds())
        case .lowPower:
            return max(600, currentSyncIntervalSeconds())
        }
    }

    static func shouldTransmitLiveHeartRate(boosted: Bool, lastSentAt: Date?, now: Date) -> Bool {
        if boosted { return true }
        let interval: TimeInterval
        switch currentSensorPowerMode() {
        case .extreme: interval = 5
        case .balanced: interval = max(60, currentSyncIntervalSeconds())
        case .lowPower: interval = 300
        }
        guard let lastSentAt else { return true }
        return now.timeIntervalSince(lastSentAt) >= interval
    }

    static func clampedSyncInterval(_ value: Double) -> Double {
        min(3599, max(5, value.rounded()))
    }

    static func clampedLocationUpdateRadius(_ value: Double) -> Double {
        min(5_000, max(100, value.rounded()))
    }

    /// Mirrors the iPhone/dashboard boundary contract. The shared Phone source
    /// is not compiled into the Watch target, so this target-local entry point
    /// preserves the same 100m...5km and last-published-position semantics.
    static func shouldPublishLocation(_ location: CLLocation, after lastPublishedLocation: CLLocation?) -> Bool {
        let radius = currentLocationUpdateRadiusMeters()
        guard location.horizontalAccuracy > 0, location.horizontalAccuracy <= radius else { return false }
        guard let lastPublishedLocation else { return true }
        return location.distance(from: lastPublishedLocation) >= radius
    }

    static func formattedInterval(_ seconds: Double) -> String {
        let value = Int(clampedSyncInterval(seconds))
        if value >= 60 {
            let minutes = value / 60
            let remainder = value % 60
            return remainder == 0 ? "\(minutes)분" : "\(minutes)분 \(remainder)초"
        }
        return "\(value)초"
    }
}

extension Notification.Name {
    static let vitalguardWatchManualSyncRequest = Notification.Name("vitalguard.watch.manualSyncRequest")
    static let vitalguardWatchNfcScanResult = Notification.Name("vitalguard.watch.nfcScanResult")
    static let vitalguardWatchFallAlertClear = Notification.Name("vitalguard.watch.fallAlertClear")
    static let vitalguardWatchPowerModeDidChange = Notification.Name("vitalguard.watch.powerModeDidChange")
    static let vitalguardWatchUpdatePolicyDidChange = Notification.Name("vitalguard.watch.updatePolicyDidChange")
}
