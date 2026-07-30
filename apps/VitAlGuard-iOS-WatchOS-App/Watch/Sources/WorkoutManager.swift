// 워치 워크아웃 세션으로 심박을 연속 수집하고 전송기로 넘기는 핵심 매니저
// 잠금-검증의 골자 — 워치가 live builder 콜백으로 HR 을 받으므로(폰 HealthKit 읽기 아님)
// iPhone 잠금과 무관하게 수집이 지속된다.
import Foundation
import AVFoundation
import CoreLocation
import CoreMotion
import HealthKit
import WatchKit

@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    private static let nfcFeatureEnabled = true
    private static let unresolvedFallIncidentKey = "vitalguard.watch.unresolvedFallIncidentID"
    private static let unresolvedFallIncidentAtKey = "vitalguard.watch.unresolvedFallIncidentAt"
    private static let unresolvedFallIncidentWorkerKey = "vitalguard.watch.unresolvedFallIncidentWorkerID"
    // 이전 세션이 종료되어도 중복 경보 억제는 짧게 유지하되, 이후 실제 낙상까지 막지 않는다.
    private static let unresolvedFallIncidentTTL: TimeInterval = 5 * 60
    @Published var authorized = false
    @Published var isRunning = false
    @Published var latestHeartRate: Double?
    @Published var latestSpO2: Double?
    @Published var latestRespiratoryRate: Double?
    @Published var latestHRV: Double?
    @Published var latestSteps: Int?
    @Published var latestActiveEnergyKcal: Double?
    @Published var latestExerciseTimeMinutes: Double?
    @Published var latestStandTimeMinutes: Double?
    @Published var latestMoveTimeMinutes: Double?
    @Published var latestWristTemperatureC: Double?
    @Published var latestBloodPressureSystolic: Double?
    @Published var latestBloodPressureDiastolic: Double?
    @Published var latestECGStatus = "--"
    @Published var latestAltitudeMeters: Double?
    @Published var latestBarometricPressureKPa: Double?
    @Published var latestAccelerationMagnitudeG: Double?
    @Published var latestRotationRateRadS: Double?
    @Published var latestSleepingBreathingDisturbances: Double?
    @Published var latestSleepingBreathingDisturbancesStatus = "--"
    @Published var latestWristTemperatureUpdatedAt: Date?
    @Published var latestLocation: CLLocation?
    @Published var lastSensorSyncAt: Date?
    @Published var fallCount = 0
    @Published var lastFallText: String?
    @Published var sentCount = 0
    @Published var bufferedCount = 0
    @Published var lastStatus = "대기"
    @Published var lastError: String?
    @Published var activeFallPrompt: ActiveFallPrompt?
    /// 실제 Watch 번들에서 모델·피처 검증까지 통과했는지 표시한다.
    @Published private(set) var mlPipelineStatus = "ML 자가검증 대기"

    var ecgStatusText: String {
        latestECGStatus
    }

    var bloodPressureAlertText: String {
        if let systolic = latestBloodPressureSystolic, let diastolic = latestBloodPressureDiastolic {
            return "\(Int(systolic.rounded()))/\(Int(diastolic.rounded()))"
        }
        return "--"
    }

    private let store = HKHealthStore()
    private let transmitter = VitalTransmitter()
    private let speech = AVSpeechSynthesizer()
    private lazy var spo2Reader = SpO2Reader(store: store)
    private lazy var stressReader = StressInputsReader(store: store)
    private var altimeter: CMAltimeter?
    private var fallDetector: FallDetector?
    private var fallMLFusion: MLFusion?
    private var fallIMULogger: IMUWindowLogger?
    private var mlFirstShadowPipeline: MLFirstShadowPipeline?
    private let watchLocationManager = CLLocationManager()
    private var lastStressAt: Date?
    private var lastAltitudeUpdateAt: Date?
    private var hrHistory: [HeartRatePoint] = []
    private var fallPromptTask: Task<Void, Never>?
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var backgroundSyncTimer: DispatchSourceTimer?
    private var backgroundSyncTimerInterval: TimeInterval?
    private var evidenceCaptureUntil: Date?
    private var lastHeartRateTransmitAt: Date?
    private var lastHeartRateAt: Date?
    private var lastSpO2MeasuredAt: Date?
    private var isSpo2EvidenceConditionActive = false
    private var isSensorSnapshotReadInFlight = false
    private var nfcScanResultToken: NSObjectProtocol?
    private var fallAlertClearToken: NSObjectProtocol?
    private var powerModeChangeToken: NSObjectProtocol?
    private var updatePolicyChangeToken: NSObjectProtocol?
    private var didRunMLSelfCheck = false
    private var mlFusionEnabled = false
    private let hrType = HKQuantityType(.heartRate)
    private let spo2Type = HKQuantityType(.oxygenSaturation)
    private let hrPreWindowSec: TimeInterval = 10
    private let hrPostWindowSec: TimeInterval = 30
    private let hrHistoryKeepSec: TimeInterval = 90
    private let fallPromptTimeoutSec: TimeInterval = 20
    private let spo2EvidenceThreshold = 92.0
    private let spo2EvidenceFreshnessSec: TimeInterval = 2 * 60
    private var manualSyncRequestToken: NSObjectProtocol?
    private static let wristTemperatureValidRange: ClosedRange<Double> = 20.0...45.0
    private static let wristTemperatureCacheRetention: TimeInterval = 24 * 60 * 60

    private var unresolvedFallIncidentID: String? {
        let defaults = UserDefaults.standard
        let identifier = defaults
            .string(forKey: Self.unresolvedFallIncidentKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !identifier.isEmpty else { return nil }
        let markedAt = defaults.double(forKey: Self.unresolvedFallIncidentAtKey)
        let recordedWorker = defaults.string(forKey: Self.unresolvedFallIncidentWorkerKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let currentWorker = ConnectionSettings.currentWorkerId().trimmingCharacters(in: .whitespacesAndNewlines)
        guard markedAt > 0,
              Date().timeIntervalSince1970 - markedAt <= Self.unresolvedFallIncidentTTL,
              !recordedWorker.isEmpty,
              recordedWorker == currentWorker else {
            clearStoredFallIncident()
            return nil
        }
        return identifier
    }

    private func markFallIncidentUnresolved(_ candidateId: String) {
        guard !candidateId.isEmpty else { return }
        UserDefaults.standard.set(candidateId, forKey: Self.unresolvedFallIncidentKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.unresolvedFallIncidentAtKey)
        UserDefaults.standard.set(ConnectionSettings.currentWorkerId(), forKey: Self.unresolvedFallIncidentWorkerKey)
    }

    private func clearFallIncidentIfMatches(_ candidateId: String) {
        guard let unresolved = unresolvedFallIncidentID else { return }
        guard candidateId.isEmpty || unresolved == candidateId else { return }
        clearStoredFallIncident()
    }

    private func clearStoredFallIncident() {
        UserDefaults.standard.removeObject(forKey: Self.unresolvedFallIncidentKey)
        UserDefaults.standard.removeObject(forKey: Self.unresolvedFallIncidentAtKey)
        UserDefaults.standard.removeObject(forKey: Self.unresolvedFallIncidentWorkerKey)
    }

    private struct HeartRatePoint {
        let at: Date
        let bpm: Double
    }

    struct ActiveFallPrompt: Identifiable {
        let id: String
        let detectedAt: Date
        let peakG: Double
        let stillSec: Double
        let peakRotationRadS: Double
        let startedHeartRate: Double?
        var remainingSec: Int
    }

    private enum FallPromptOutcome: String {
        case dismissed
        case manualSos = "manual_sos"
        case autoEscalated = "auto_escalated"
        case safetyHold = "safety_hold_no_on_wrist"
    }

    override init() {
        super.init()
        transmitter.onResult = { [weak self] ok, status, buffered, sent in
            guard let self else { return }
            if ok { self.sentCount += sent }
            self.lastStatus = status
            self.bufferedCount = buffered
        }
        spo2Reader.onUpdate = { [weak self] pct, measuredAt in
            guard let self else { return }
            self.latestSpO2 = pct
            self.lastSpO2MeasuredAt = measuredAt
            self.handleSafetySignalIfNeeded(spo2: pct, spo2MeasuredAt: measuredAt)
            if self.isEvidenceCaptureActive() || ConnectionSettings.currentSensorPowerMode() == .extreme {
                self.publishMeasuredSnapshot()
            }
        }
        manualSyncRequestToken = NotificationCenter.default.addObserver(
            forName: .vitalguardWatchManualSyncRequest,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.manualSyncNow()
            }
        }
        if Self.nfcFeatureEnabled {
            nfcScanResultToken = NotificationCenter.default.addObserver(
                forName: .vitalguardWatchNfcScanResult,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                Task { @MainActor in
                    self?.updateNfcStatus(from: notification.userInfo)
                }
            }
        }
        fallAlertClearToken = NotificationCenter.default.addObserver(
            forName: .vitalguardWatchFallAlertClear,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in
                self?.clearFallPromptFromPhone(notification.userInfo)
            }
        }
        powerModeChangeToken = NotificationCenter.default.addObserver(
            forName: .vitalguardWatchPowerModeDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.applyCurrentPowerMode()
            }
        }
        updatePolicyChangeToken = NotificationCenter.default.addObserver(
            forName: .vitalguardWatchUpdatePolicyDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.applyCurrentPowerMode()
            }
        }
        watchLocationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        watchLocationManager.distanceFilter = 250
        watchLocationManager.allowsBackgroundLocationUpdates = false
        watchLocationManager.delegate = self
    }

    var locationPermissionText: String {
        switch watchLocationManager.authorizationStatus {
        case .authorizedAlways: return "항상 허용"
        case .authorizedWhenInUse: return "앱 사용 중 허용"
        case .denied: return "거부됨"
        case .restricted: return "제한됨"
        case .notDetermined: return "아직 묻지 않음"
        @unknown default: return "확인 필요"
        }
    }

    func requestAlwaysLocationPermission() {
        watchLocationManager.requestAlwaysAuthorization()
    }

    private func requestWatchLocationPermissionIfNeeded() {
        guard CLLocationManager.locationServicesEnabled() else {
            return
        }
        let status = watchLocationManager.authorizationStatus
        switch status {
        case .notDetermined:
            if ConnectionSettings.currentSensorPowerMode() == .lowPower {
                watchLocationManager.requestWhenInUseAuthorization()
            } else {
                watchLocationManager.requestAlwaysAuthorization()
            }
        case .authorizedWhenInUse, .authorizedAlways:
            configureLocationUpdatesForCurrentMode()
        default:
            break
        }
    }

    private func configureLocationUpdatesForCurrentMode(requestFreshLocation: Bool = true) {
        guard ConnectionSettings.locationBasedUpdatesEnabled() else {
            watchLocationManager.stopUpdatingLocation()
            return
        }
        let mode = ConnectionSettings.currentSensorPowerMode()
        // Sensor accuracy may vary by power mode, but the dashboard contract
        // remains the user-selected boundary on both iPhone and Watch.
        let dashboardRadius = ConnectionSettings.currentLocationUpdateRadiusMeters()
        switch mode {
        case .extreme:
            watchLocationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            watchLocationManager.distanceFilter = dashboardRadius
            watchLocationManager.allowsBackgroundLocationUpdates = true
            watchLocationManager.startUpdatingLocation()
        case .balanced:
            // watchOS는 지역 이탈 콜백을 제공하지 않으므로 시스템 거리 필터를 사용한다.
            watchLocationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            watchLocationManager.distanceFilter = dashboardRadius
            watchLocationManager.allowsBackgroundLocationUpdates = true
            watchLocationManager.startUpdatingLocation()
        case .lowPower:
            watchLocationManager.desiredAccuracy = kCLLocationAccuracyKilometer
            watchLocationManager.distanceFilter = dashboardRadius
            watchLocationManager.allowsBackgroundLocationUpdates = true
            watchLocationManager.startUpdatingLocation()
        }
    }

    private func requestSafetyLocation() {
        let status = watchLocationManager.authorizationStatus
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        watchLocationManager.requestLocation()
    }

    private func configureFallMonitoringForCurrentMode() {
        guard fallDetector == nil else { return }
        let mode = ConnectionSettings.currentSensorPowerMode()
        let detector = FallDetector(sampleHz: 50, eventSampleHz: 50, motionPublishInterval: mode == .lowPower ? 5 : 1)
        detector.onMotionSample = { [weak self] accelerationMagnitudeG, rotationRateRadS in
            guard let self else { return }
            self.latestAccelerationMagnitudeG = accelerationMagnitudeG
            self.latestRotationRateRadS = rotationRateRadS
        }
        detector.onCandidate = { [weak self] candidate in
            Task { @MainActor in self?.handleCandidate(candidate) }
        }
        if mlFusionEnabled {
            let fusion = MLFusion()
            let logger = IMUWindowLogger(fs: 50, preSec: 1, postSec: 2, logThresholdG: 1.5, refractorySec: 0.8)
            let shadow = MLFirstShadowPipeline()
            logger.onWindow = { [weak fusion] window in Task { @MainActor in fusion?.ingest(window: window) } }
            fusion.onVerdict = { [weak self] verdict in
                Task { @MainActor in self?.handleCandidate(verdict.candidate, shouldAlert: verdict.shouldAlert, mlVerdict: verdict) }
            }
            shadow.onObservation = { [weak self] observation in self?.handleMLFirstObservation(observation) }
            detector.imuLogger = logger
            detector.onIMUSample = { [weak shadow] sample in shadow?.ingest(sample) }
            detector.onCandidate = { [weak fusion] candidate in Task { @MainActor in fusion?.ingest(candidate: candidate) } }
            fallMLFusion = fusion
            fallIMULogger = logger
            mlFirstShadowPipeline = shadow
        }
        fallDetector = detector
    }

    private func stopFallMonitoring() {
        fallDetector?.stop()
        fallDetector = nil
        fallMLFusion = nil
        fallIMULogger = nil
        mlFirstShadowPipeline = nil
    }

    private func applyCurrentPowerMode() {
        guard isRunning else { return }
        stopFallMonitoring()
        configureFallMonitoringForCurrentMode()
        fallDetector?.start()
        configureLocationUpdatesForCurrentMode()
        if ConnectionSettings.currentSensorPowerMode() == .extreme || isEvidenceCaptureActive() {
            startAltitudeUpdates()
        } else {
            stopAltitudeUpdates()
        }
        startBackgroundSyncTimer()
        lastStatus = "배터리 모드 적용"
    }

    deinit {
        if let manualSyncRequestToken {
            NotificationCenter.default.removeObserver(manualSyncRequestToken)
        }
        if let nfcScanResultToken {
            NotificationCenter.default.removeObserver(nfcScanResultToken)
        }
        if let fallAlertClearToken {
            NotificationCenter.default.removeObserver(fallAlertClearToken)
        }
        if let powerModeChangeToken {
            NotificationCenter.default.removeObserver(powerModeChangeToken)
        }
        if let updatePolicyChangeToken {
            NotificationCenter.default.removeObserver(updatePolicyChangeToken)
        }
    }

    private func updateNfcStatus(from userInfo: [AnyHashable: Any]?) {
        guard Self.nfcFeatureEnabled else { return }
        guard let userInfo else {
            lastStatus = "NFC 조회 실패: 응답 데이터가 없습니다."
            return
        }
        guard let rawStatus = userInfo["status"] as? String else {
            lastStatus = "NFC 조회 응답 형식이 올바르지 않습니다."
            return
        }
        switch rawStatus {
        case "requesting":
            lastStatus = "NFC 조회 요청 중"
            lastError = nil
        case "success", "failure":
            let result = rawStatus == "success" ? "완료" : "실패"
            if rawStatus == "success" {
                lastStatus = "NFC 조회 \(result): 아이폰에서 태그 정보가 확인되었습니다."
                lastError = nil
            } else if let message = userInfo["message"] as? String {
                lastStatus = "NFC 조회 \(result): \(message)"
                lastError = message
            } else {
                lastStatus = "NFC 조회 \(result): 아이폰에서 태그 정보를 확인하지 못했습니다."
                lastError = "아이폰에서 태그 정보를 확인하지 못했습니다."
            }
        default:
            if let message = userInfo["message"] as? String {
                lastStatus = "NFC 조회: \(message)"
            } else {
                lastStatus = "NFC 조회 상태를 수신했습니다."
            }
            lastError = nil
        }
    }

    private func handleCandidate(
        _ candidate: FallCandidate,
        shouldAlert: Bool? = nil,
        mlVerdict: MLFusion.Verdict? = nil
    ) {
        let candidateId = UUID().uuidString.lowercased()
        let now = Date()
        let impactAt = now.addingTimeInterval(-candidate.stillSec)
        let preTrajectory = trajectoryAroundImpact(impactAt: impactAt)
        let existingIncidentID = unresolvedFallIncidentID
        let requestedAlert = shouldAlert ?? candidate.isFall
        let finalShouldAlert = requestedAlert && existingIncidentID == nil
        if finalShouldAlert {
            activateEvidenceCaptureWindow(reason: "낙상 후보")
            lastFallText = String(
                format: "낙상 후보 %.1fG · 정지 %.1fs — 확인 대기", candidate.peakG, candidate.stillSec
            )
        } else if mlVerdict?.vetoedByML == true {
            lastFallText = String(format: "작업 동작 ML 판정으로 낙상 알림 억제 · work %.2f", mlVerdict?.wvProb ?? 0)
        }
        transmitter.sendFallCandidate(
            candidateId: candidateId,
            decision: candidate.decision.rawValue,
            isFall: finalShouldAlert,
            peakG: candidate.peakG,
            stillSec: candidate.stillSec,
            freefallPreceded: candidate.freefallPreceded,
            peakRotationRadS: candidate.peakRotationRadS,
            heartRate: latestHeartRate,
            spo2: latestSpO2,
            hrTrajectory: preTrajectory,
            ruleIsFall: candidate.isFall,
            mlWorkVetoProb: mlVerdict?.wvProb,
            mlImpactProb: mlVerdict?.impProb,
            mlRecoveryProb: nil,
            mlVetoedByML: mlVerdict?.vetoedByML ?? false,
            mlRejectedByImpactML: false,
            mlRescuedByML: false,
            mlShouldAlert: mlVerdict?.shouldAlert
        )
        if requestedAlert, existingIncidentID != nil {
            lastFallText = "미해결 낙상 사건 확인 대기 — 추가 경보 억제"
        }
        if finalShouldAlert {
            beginFallPrompt(
                candidateId: candidateId,
                peakG: candidate.peakG,
                stillSec: candidate.stillSec,
                peakRotationRadS: candidate.peakRotationRadS,
                detectedAt: now
            )
            schedulePostImpactFollowup(candidateId: candidateId, impactAt: impactAt)
        }
    }

    /// Shadow results are UI-only: no alert, ACK, SOS, or network incident is created here.
    private func handleMLFirstObservation(_ observation: MLFirstShadowPipeline.Observation) {
        guard observation.isModelCandidate else { return }
        switch observation.phase {
        case .fast:
            lastStatus = String(format: "ML-우선 관전 후보 · impact %.2f / work %.2f", observation.impact.probability, observation.workVeto.probability)
        case .recovery:
            if let recovery = observation.recovery {
                lastStatus = String(format: "ML-우선 recovery 관전 · 비회복 %.2f (%@)", recovery.probability, recovery.label ? "위험" : "회복 신호")
            }
        }
    }

    // 워치 단독 SOS — 작업자가 워치에서 직접 발신. 최신 HR/SpO₂ 동봉(즉시 전송).
    func sendSos() {
        lastStatus = "SOS 전송"
        transmitter.sendSos(heartRate: latestHeartRate, spo2: latestSpO2)
    }

    func dismissActiveFallPrompt() {
        completeFallPrompt(.dismissed)
    }

    func clearFallPromptFromPhone(_ userInfo: [AnyHashable: Any]?) {
        let candidateId = (userInfo?["candidateId"] as? String)
            ?? (userInfo?["fallCandidateId"] as? String)
            ?? ""
        clearFallIncidentIfMatches(candidateId)
        if let prompt = activeFallPrompt, candidateId.isEmpty || prompt.id == candidateId {
            fallPromptTask?.cancel()
            fallPromptTask = nil
            activeFallPrompt = nil
            transmitter.sendFallPromptResult(candidateId: prompt.id, outcome: FallPromptOutcome.dismissed.rawValue, responseSec: max(0, Date().timeIntervalSince(prompt.detectedAt)))
        }
        lastStatus = "아이폰에서 낙상 경고 해제"
        lastFallText = "iPhone 응답: 위급 상황 아님"
    }

    func escalateActiveFallPromptToSos() {
        completeFallPrompt(.manualSos)
    }

    // 설정 화면 연결 테스트 패스스루.
    func testConnection() async -> String {
        await transmitter.testConnection()
    }

    // HR 콜백에 피기백한 설정 기반 sub-cadence — 워치 센서 입력 읽어 전송(폰/웹 연동 주기와 동일).
    private func maybeReadStress() {
        let now = Date()
        let boosted = isEvidenceCaptureActive(now: now)
        guard boosted || ConnectionSettings.currentSensorPowerMode() == .extreme || ConnectionSettings.timeBasedUpdatesEnabled() else {
            return
        }
        if let last = lastStressAt, now.timeIntervalSince(last) < ConnectionSettings.currentSensorReadIntervalSeconds(boosted: boosted) { return }
        lastStressAt = now
        readAndTransmitSensorSnapshot(forceFlush: boosted)
    }

    func manualSyncNow() {
        lastStatus = "수동 업데이트"
        readAndTransmitSensorSnapshot(forceFlush: true)
    }

    private func readAndTransmitSensorSnapshot(forceFlush: Bool = false) {
        guard !isSensorSnapshotReadInFlight else { return }
        isSensorSnapshotReadInFlight = true
        Task {
            defer { isSensorSnapshotReadInFlight = false }
            let boosted = await MainActor.run { self.isEvidenceCaptureActive() }
            var inputs = await stressReader.read(window: ConnectionSettings.currentSensorReadIntervalSeconds(boosted: boosted))
            inputs.relativeAltitudeMeters = latestAltitudeMeters
            latestHRV = inputs.hrvSdnnMs
            latestRespiratoryRate = inputs.respiratoryRate
            latestSteps = inputs.steps.map { Int($0.rounded()) }
            latestActiveEnergyKcal = inputs.activeEnergyKcal
            latestExerciseTimeMinutes = inputs.exerciseTimeMinutes
            latestStandTimeMinutes = inputs.standTimeMinutes
            latestMoveTimeMinutes = inputs.moveTimeMinutes
            if let wristTemperature = inputs.wristTemperatureC,
               Self.isValidWristTemperature(wristTemperature) {
                latestWristTemperatureC = wristTemperature
                latestWristTemperatureUpdatedAt = inputs.wristTemperatureUpdatedAt ?? Date()
            } else if shouldReuseCachedWristTemperature(at: Date()) {
                inputs.wristTemperatureC = latestWristTemperatureC
            } else {
                latestWristTemperatureC = nil
                latestWristTemperatureUpdatedAt = nil
            }
            latestBloodPressureSystolic = inputs.bloodPressureSystolic
            latestBloodPressureDiastolic = inputs.bloodPressureDiastolic
            latestECGStatus = inputs.ecgClassification ?? "--"
            latestSleepingBreathingDisturbances = inputs.sleepingBreathingDisturbances
            latestSleepingBreathingDisturbancesStatus = inputs.sleepingBreathingDisturbancesClassification ?? "--"
            inputs.relativeAltitudeMeters = latestAltitudeMeters
            inputs.barometricPressureKPa = latestBarometricPressureKPa
            inputs.accelerationMagnitudeG = latestAccelerationMagnitudeG
            inputs.rotationRateRadS = latestRotationRateRadS
            handleSafetySignalIfNeeded(ecg: latestECGStatus)
            lastSensorSyncAt = Date()
            // 시간 기반 타이머가 실행 중이더라도, 직전 90초 안에 워치가 측정한 유효 심박이
            // 없으면 과거 HealthKit 합계·기본값만 반복 전송하지 않는다.
            guard hasRecentOnWristEvidence else {
                lastStatus = "실측 심박 대기 — 전송 보류"
                return
            }
            transmitter.sendStress(inputs, heartRate: latestHeartRate, spo2: latestSpO2, heartRateMeasuredAt: lastHeartRateAt, spo2MeasuredAt: lastSpO2MeasuredAt, forceFlush: forceFlush || boosted)
            publishMeasuredSnapshot()
        }
    }

    private func beginFallPrompt(
        candidateId: String,
        peakG: Double,
        stillSec: Double,
        peakRotationRadS: Double,
        detectedAt: Date
    ) {
        // 새 후보가 이미 열린 확인 프롬프트를 자동 SOS로 바꾸면 오탐이 연쇄 경보가 된다.
        // 기존 프롬프트의 사용자 응답 또는 타임아웃만 처리하고, 새 후보는 억제한다.
        guard activeFallPrompt == nil else {
            lastFallText = "낙상 확인 대기 중 — 추가 후보 억제"
            return
        }

        activeFallPrompt = ActiveFallPrompt(
            id: candidateId,
            detectedAt: detectedAt,
            peakG: peakG,
            stillSec: stillSec,
            peakRotationRadS: peakRotationRadS,
            startedHeartRate: latestHeartRate,
            remainingSec: Int(fallPromptTimeoutSec)
        )
        markFallIncidentUnresolved(candidateId)
        lastStatus = "낙상 확인 대기"
        playPromptAlert()
        fallPromptTask?.cancel()
        fallPromptTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for remaining in stride(from: Int(self.fallPromptTimeoutSec), through: 1, by: -1) {
                guard var prompt = self.activeFallPrompt, prompt.id == candidateId else { return }
                prompt.remainingSec = remaining
                self.activeFallPrompt = prompt
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
            }
            self.completeFallPrompt(.autoEscalated)
        }
    }

    private func completeFallPrompt(_ outcome: FallPromptOutcome) {
        guard let prompt = activeFallPrompt else { return }
        fallPromptTask?.cancel()
        fallPromptTask = nil
        activeFallPrompt = nil
        let resolvedOutcome: FallPromptOutcome =
            outcome == .autoEscalated && !hasRecentOnWristEvidence ? .safetyHold : outcome
        clearFallIncidentIfMatches(prompt.id)

        let responseSec = max(0, Date().timeIntervalSince(prompt.detectedAt))
        transmitter.sendFallPromptResult(
            candidateId: prompt.id,
            outcome: resolvedOutcome.rawValue,
            responseSec: responseSec
        )

        switch resolvedOutcome {
        case .dismissed:
            lastStatus = "낙상 후보 해제"
            lastFallText = String(
                format: "후보 해제 %.1f초", responseSec
            )
        case .manualSos:
            lastStatus = "낙상 후보 SOS 전송"
            lastFallText = String(
                format: "후보 SOS 요청 %.1f초", responseSec
            )
            transmitter.sendPromptSos(
                candidateId: prompt.id,
                responseSec: responseSec,
                heartRate: latestHeartRate,
                spo2: latestSpO2
            )
        case .autoEscalated:
            fallCount += 1
            lastStatus = "낙상 자동 에스컬레이션"
            lastFallText = String(
                format: "낙상 경보 %.1fG · 응답없음 %.1f초", prompt.peakG, responseSec
            )
            transmitter.sendFallEscalation(
                candidateId: prompt.id,
                responseSec: responseSec,
                heartRate: latestHeartRate,
                spo2: latestSpO2
            )
        case .safetyHold:
            lastStatus = "낙상 경보 안전 보류"
            lastFallText = "착용·심박 신호 미확인"
        }
    }

    private func playPromptAlert() {
        WKInterfaceDevice.current().play(.notification)
        let utterance = AVSpeechUtterance(
            string: "낙상 감지. 괜찮으면 해제, 도움이 필요하면 SOS를 누르세요."
        )
        utterance.voice = AVSpeechSynthesisVoice(language: "ko-KR")
        utterance.rate = 0.42
        speech.stopSpeaking(at: .immediate)
        speech.speak(utterance)
    }

    private func recordHeartRate(_ bpm: Double, at now: Date) {
        lastHeartRateAt = now
        hrHistory.append(HeartRatePoint(at: now, bpm: bpm))
        pruneHrHistory(reference: now)
    }

    private func pruneHrHistory(reference now: Date) {
        hrHistory.removeAll { now.timeIntervalSince($0.at) > hrHistoryKeepSec }
    }

    private func trajectoryAroundImpact(impactAt: Date, reference now: Date? = nil) -> FallHrTrajectory {
        pruneHrHistory(reference: now ?? Date())
        let preStart = impactAt.addingTimeInterval(-hrPreWindowSec)
        let postEnd = impactAt.addingTimeInterval(hrPostWindowSec)

        let pre = hrHistory.filter { $0.at >= preStart && $0.at <= impactAt }
        let post = hrHistory.filter { $0.at > impactAt && $0.at <= postEnd }
        let impactHr = hrHistory.last(where: { $0.at <= impactAt })?.bpm
        let preMean = pre.isEmpty ? nil : pre.reduce(0) { $0 + $1.bpm } / Double(pre.count)
        let postMean = post.isEmpty ? nil : post.reduce(0) { $0 + $1.bpm } / Double(post.count)
        let postPeak = post.map(\.bpm).max()

        return FallHrTrajectory(
            preMean10s: preMean,
            impactHr: impactHr,
            postMean30s: postMean,
            postPeak30s: postPeak,
            deltaMean: (preMean != nil && postMean != nil) ? (postMean! - preMean!) : nil,
            deltaPeak: (preMean != nil && postPeak != nil) ? (postPeak! - preMean!) : nil
        )
    }

    private func schedulePostImpactFollowup(candidateId: String, impactAt: Date) {
        let waitNs = max(0, impactAt.addingTimeInterval(hrPostWindowSec).timeIntervalSinceNow)
        Task { @MainActor [weak self] in
            guard let self else { return }
            if waitNs > 0 {
                try? await Task.sleep(nanoseconds: UInt64(waitNs * 1_000_000_000))
            }
            let followup = self.trajectoryAroundImpact(impactAt: impactAt)
            self.transmitter.sendFallHrFollowup(candidateId: candidateId, trajectory: followup)
        }
    }

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            lastError = "이 기기에서 HealthKit 사용 불가"
            return
        }
        let toShare: Set<HKSampleType> = [HKObjectType.workoutType()]
        var toRead = StressInputsReader.readTypes
        toRead.insert(hrType)
        toRead.insert(spo2Type)
        do {
            try await store.requestAuthorization(toShare: toShare, read: toRead)
            authorized = true
            lastError = nil
        } catch {
            lastError = "권한 요청 실패: \(error.localizedDescription)"
        }
    }

    func start() {
        guard !isRunning else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        config.locationType = .unknown
        do {
            let session = try HKWorkoutSession(healthStore: store, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            // 잠금 우회에 필요한 심박만 센서에서 모은다. .other 기본 수집셋의 거리/기초대사
            // 자동수집은 본 PoC 가 쓰지 않으므로 비활성화(센서 시간 낭비 제거). 활동에너지는
            // 스트레스 입력(StressInputsReader)이 사용하므로 유지. disableCollection 은
            // 기본셋에 없는 타입엔 무해(no-op)하므로 안전하다.
            let dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            dataSource.disableCollection(for: HKQuantityType(.distanceWalkingRunning))
            dataSource.disableCollection(for: HKQuantityType(.basalEnergyBurned))
            builder.dataSource = dataSource
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder
            runMLSelfCheckIfNeeded()

            let startDate = Date()
            session.startActivity(with: startDate)
            isRunning = true
            lastError = nil
            lastStatus = "수집 시작"
            lastStressAt = nil
            isSpo2EvidenceConditionActive = false
            requestWatchLocationPermissionIfNeeded()
            spo2Reader.start()
            configureFallMonitoringForCurrentMode()
            fallDetector?.start()
            configureLocationUpdatesForCurrentMode()
            if ConnectionSettings.currentSensorPowerMode() == .extreme {
                startAltitudeUpdates()
            } else {
                stopAltitudeUpdates()
            }
            startBackgroundSyncTimer()
            readAndTransmitSensorSnapshot(forceFlush: true)
            Task {
                do {
                    try await builder.beginCollection(at: startDate)
                } catch {
                    self.lastError = "수집 시작 실패: \(error.localizedDescription)"
                }
            }
        } catch {
            lastError = "세션 생성 실패: \(error.localizedDescription)"
        }
    }

    func recoverActiveWorkoutSession() {
        Task { [weak self] in
            guard let self else { return }
            do {
                guard let recovered = try await self.store.recoverActiveWorkoutSession() else {
                    self.lastStatus = "복구할 활성 워크아웃 없음"
                    return
                }
                let recoveredBuilder = recovered.associatedWorkoutBuilder()
                let dataSource = HKLiveWorkoutDataSource(healthStore: self.store, workoutConfiguration: recovered.workoutConfiguration)
                dataSource.disableCollection(for: HKQuantityType(.distanceWalkingRunning))
                dataSource.disableCollection(for: HKQuantityType(.basalEnergyBurned))
                recoveredBuilder.dataSource = dataSource
                recovered.delegate = self
                recoveredBuilder.delegate = self
                self.session = recovered
                self.builder = recoveredBuilder
                self.isRunning = recovered.state == .running
                self.lastStatus = self.isRunning ? "워크아웃 복구됨" : "워크아웃 복구됨(일시 정지)"
                self.lastError = nil
                self.runMLSelfCheckIfNeeded()
                guard self.isRunning else { return }
                self.lastStressAt = nil
                self.requestWatchLocationPermissionIfNeeded()
                self.spo2Reader.start()
                self.configureFallMonitoringForCurrentMode()
                self.fallDetector?.start()
                self.configureLocationUpdatesForCurrentMode()
                self.startBackgroundSyncTimer()
                self.readAndTransmitSensorSnapshot(forceFlush: true)
            } catch {
                self.lastError = "워크아웃 복구 실패: \(error.localizedDescription)"
                self.lastStatus = "워크아웃 복구 실패"
                WKInterfaceDevice.current().play(.failure)
            }
        }
    }

    private func runMLSelfCheckIfNeeded() {
        guard !didRunMLSelfCheck else { return }
        didRunMLSelfCheck = true
        let result = MLSelfCheck.run()
        if result.contains("❌") || result.contains("없음") || result.contains("미탑재") {
            mlFusionEnabled = false
            mlPipelineStatus = "ML 3모델 비활성 · 낙상 감시 중지"
            transmitter.updateMLPipelineStatus(isActive: false)
            lastError = "ML 자가검증 실패: \(result.replacingOccurrences(of: "\n", with: " / "))"
            lastStatus = "ML 자가검증 실패 - 낙상 감시 중지"
        } else {
            mlFusionEnabled = true
            mlPipelineStatus = "ML-first 관전 · v5 스키마 검증 완료"
            transmitter.updateMLPipelineStatus(isActive: true)
            lastStatus = "ML 자가검증 완료 · ML-first 관전 활성"
        }
    }

    func stop() {
        guard isRunning, let session else { return }
        // stopActivity → 델리게이트의 .stopped 전이에서 endCollection+finishWorkout+end 수행.
        session.stopActivity(with: Date())
        lastStatus = "정지 중…"
    }

    private func finishAndEnd(at date: Date) async {
        fallPromptTask?.cancel()
        fallPromptTask = nil
        activeFallPrompt = nil
        isSpo2EvidenceConditionActive = false
        transmitter.flushPending()   // 윈도에 남은 미전송 샘플 마저 전송.
        stopBackgroundSyncTimer()
        spo2Reader.stop()
        stopFallMonitoring()
        stopAltitudeUpdates()
        watchLocationManager.stopUpdatingLocation()
        guard let builder, let session else { return }
        do {
            try await builder.endCollection(at: date)
            _ = try await builder.finishWorkout()
        } catch {
            lastError = "세션 종료 실패: \(error.localizedDescription)"
        }
        session.end()
        self.session = nil
        self.builder = nil
        isRunning = false
        lastStatus = "정지됨"
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        if toState == .stopped {
            Task { @MainActor in await self.finishAndEnd(at: date) }
        }
    }

    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didFailWithError error: Error
    ) {
        Task { @MainActor in
            self.lastError = "세션 오류: \(error.localizedDescription)"
            self.isRunning = false
            self.isSpo2EvidenceConditionActive = false
            self.spo2Reader.stop()
            self.stopFallMonitoring()
            self.stopAltitudeUpdates()
            self.watchLocationManager.stopUpdatingLocation()
            self.stopBackgroundSyncTimer()
            self.session = nil
            self.builder = nil
            self.lastStatus = "세션 오류 - 앱 재실행 시 복구 시도"
            WKInterfaceDevice.current().play(.failure)
        }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        let hrType = HKQuantityType(.heartRate)
        guard collectedTypes.contains(hrType) else { return }
        let unit = HKUnit(from: "count/min")
        guard let stats = workoutBuilder.statistics(for: hrType),
              let quantity = stats.mostRecentQuantity() else { return }
        let bpm = quantity.doubleValue(for: unit)
        let measuredAt = stats.mostRecentQuantityDateInterval()?.end ?? Date()
        Task { @MainActor in
            let now = Date()
            self.recordHeartRate(bpm, at: measuredAt)
            self.latestHeartRate = bpm
            self.handleSafetySignalIfNeeded(heartRate: bpm)
            if self.shouldTransmitHeartRate(now: now) {
                self.transmitter.send(heartRate: bpm, spo2: self.latestSpO2, heartRateMeasuredAt: measuredAt, spo2MeasuredAt: self.lastSpO2MeasuredAt)
            }
            if self.isEvidenceCaptureActive(now: now) || ConnectionSettings.currentSensorPowerMode() == .extreme {
                self.publishMeasuredSnapshot()
            }
            self.maybeReadStress()
        }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

private extension WorkoutManager {
    var hasRecentOnWristEvidence: Bool {
        // Simulator 값은 실물 Watch 실측으로 취급하지 않는다. 이 조건은 시간·날짜와 무관하다.
        #if targetEnvironment(simulator)
        return false
        #else
        guard let heartRate = latestHeartRate,
              heartRate.isFinite,
              (20...250).contains(heartRate),
              let lastHeartRateAt
        else { return false }
        return Date().timeIntervalSince(lastHeartRateAt) <= 90
        #endif
    }

    var measuredSnapshot: MeasuredVitalSnapshot {
        MeasuredVitalSnapshot(
            heartRate: latestHeartRate,
            spo2: latestSpO2,
            ecgStatus: latestECGStatus == "--" ? nil : latestECGStatus,
            steps: latestSteps,
            wristTemperatureC: latestWristTemperatureC,
            bloodPressureSystolic: latestBloodPressureSystolic,
            bloodPressureDiastolic: latestBloodPressureDiastolic,
            hrvSdnnMs: latestHRV,
            respiratoryRate: latestRespiratoryRate,
            activeEnergyKcal: latestActiveEnergyKcal,
            exerciseTimeMinutes: latestExerciseTimeMinutes,
            standTimeMinutes: latestStandTimeMinutes,
            moveTimeMinutes: latestMoveTimeMinutes,
            relativeAltitudeMeters: latestAltitudeMeters,
            barometricPressureKPa: latestBarometricPressureKPa,
            accelerationMagnitudeG: latestAccelerationMagnitudeG,
            rotationRateRadS: latestRotationRateRadS,
            sleepingBreathingDisturbances: latestSleepingBreathingDisturbances,
            sleepingBreathingDisturbancesClassification: latestSleepingBreathingDisturbancesStatus == "--" ? nil : latestSleepingBreathingDisturbancesStatus,
            latitude: latestLocation?.coordinate.latitude,
            longitude: latestLocation?.coordinate.longitude,
            locationAccuracyMeters: latestLocation?.horizontalAccuracy,
            updatedAt: Date()
        )
    }

    private func shouldReuseCachedWristTemperature(at now: Date) -> Bool {
        guard let wristTemperature = latestWristTemperatureC,
              let cachedAt = latestWristTemperatureUpdatedAt else { return false }
        return Self.isValidWristTemperature(wristTemperature) &&
            now.timeIntervalSince(cachedAt) <= Self.wristTemperatureCacheRetention
    }

    private static func isValidWristTemperature(_ value: Double) -> Bool {
        let rounded = (value * 10).rounded() / 10
        return wristTemperatureValidRange.contains(rounded)
    }

    func publishMeasuredSnapshot() {
        // WatchConnectivity로 iPhone에 전달하는 스냅샷도 동일한 실측 게이트를 적용한다.
        // 그래야 iPhone이 별도 경로로 관제에 전달할 때도 빈/과거 데이터가 섞이지 않는다.
        guard hasRecentOnWristEvidence else { return }
        ConnectionSettings.publishMeasuredVitals(measuredSnapshot)
    }

    func isEvidenceCaptureActive(now: Date = Date()) -> Bool {
        guard let until = evidenceCaptureUntil else { return false }
        if until > now { return true }
        evidenceCaptureUntil = nil
        if ConnectionSettings.currentSensorPowerMode() == .lowPower {
            stopAltitudeUpdates()
        }
        return false
    }

    func activateEvidenceCaptureWindow(reason: String) {
        let until = Date().addingTimeInterval(ConnectionSettings.eventEvidenceDurationSeconds())
        if let current = evidenceCaptureUntil, current > Date() { return }
        evidenceCaptureUntil = until
        lastStatus = "\(reason) 증거 수집"
        requestSafetyLocation()
        startAltitudeUpdates()
        startBackgroundSyncTimer()
        readAndTransmitSensorSnapshot(forceFlush: true)
    }

    func shouldTransmitHeartRate(now: Date) -> Bool {
        let boosted = isEvidenceCaptureActive(now: now)
        guard ConnectionSettings.shouldTransmitLiveHeartRate(boosted: boosted, lastSentAt: lastHeartRateTransmitAt, now: now) else { return false }
        lastHeartRateTransmitAt = now
        return true
    }

    func handleSafetySignalIfNeeded(heartRate: Double? = nil, spo2: Double? = nil, spo2MeasuredAt: Date? = nil, ecg: String? = nil) {
        if let heartRate, heartRate >= 130 || heartRate <= 45 {
            activateEvidenceCaptureWindow(reason: "심박 이상")
        }
        if let spo2, let spo2MeasuredAt {
            handleFreshSpO2SafetySignal(spo2, measuredAt: spo2MeasuredAt)
        }
        if let ecg, !ecg.isEmpty, ecg != "--", ecg != "동리듬" {
            activateEvidenceCaptureWindow(reason: "ECG 이상")
        }
    }

    private func handleFreshSpO2SafetySignal(_ spo2: Double, measuredAt: Date) {
        let now = Date()
        guard measuredAt <= now, now.timeIntervalSince(measuredAt) <= spo2EvidenceFreshnessSec, spo2.isFinite, (50...100).contains(spo2) else { return }
        guard spo2 < spo2EvidenceThreshold else {
            isSpo2EvidenceConditionActive = false
            return
        }
        guard !isSpo2EvidenceConditionActive else { return }
        isSpo2EvidenceConditionActive = true
        activateEvidenceCaptureWindow(reason: "산소포화도 이상")
    }

    func startBackgroundSyncTimer() {
        guard ConnectionSettings.timeBasedUpdatesEnabled()
                || isEvidenceCaptureActive()
                || ConnectionSettings.currentSensorPowerMode() == .extreme else {
            stopBackgroundSyncTimer()
            return
        }
        let interval = max(5, ConnectionSettings.currentBackgroundSyncIntervalSeconds(boosted: isEvidenceCaptureActive()))
        if backgroundSyncTimer != nil, backgroundSyncTimerInterval == interval { return }
        stopBackgroundSyncTimer()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .seconds(Int(min(15, interval / 5))))
        timer.setEventHandler { [weak self] in
            Task { @MainActor in
                guard let self, self.isRunning else { return }
                let boosted = self.isEvidenceCaptureActive()
                let desiredInterval = ConnectionSettings.currentBackgroundSyncIntervalSeconds(boosted: boosted)
                if self.backgroundSyncTimerInterval != desiredInterval {
                    self.startBackgroundSyncTimer()
                }
                if ConnectionSettings.currentSensorPowerMode() != .extreme {
                    self.configureLocationUpdatesForCurrentMode(requestFreshLocation: true)
                }
                self.readAndTransmitSensorSnapshot(
                    forceFlush: boosted || ConnectionSettings.currentSensorPowerMode() == .extreme
                )
            }
        }
        backgroundSyncTimer = timer
        backgroundSyncTimerInterval = interval
        timer.resume()
    }

    func stopBackgroundSyncTimer() {
        backgroundSyncTimer?.cancel()
        backgroundSyncTimer = nil
        backgroundSyncTimerInterval = nil
    }

    func startAltitudeUpdates() {
        guard CMAltimeter.isRelativeAltitudeAvailable() else {
            latestAltitudeMeters = nil
            return
        }
        let altimeter = self.altimeter ?? CMAltimeter()
        self.altimeter = altimeter
        altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
            guard let self, let data else { return }
            Task { @MainActor in
                let now = Date()
                if let lastAltitudeUpdateAt = self.lastAltitudeUpdateAt,
                   now.timeIntervalSince(lastAltitudeUpdateAt) < 15 {
                    return
                }
                self.lastAltitudeUpdateAt = now
                self.latestAltitudeMeters = data.relativeAltitude.doubleValue
                self.latestBarometricPressureKPa = data.pressure.doubleValue
                self.publishMeasuredSnapshot()
            }
        }
    }

    func stopAltitudeUpdates() {
        altimeter?.stopRelativeAltitudeUpdates()
        altimeter = nil
        lastAltitudeUpdateAt = nil
    }
}

extension WorkoutManager: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last, latest.horizontalAccuracy > 0 else { return }
        Task { @MainActor in
            guard ConnectionSettings.locationBasedUpdatesEnabled(),
                  ConnectionSettings.shouldPublishLocation(latest, after: self.latestLocation) else { return }
            // Only a boundary-approved location becomes payload state, so
            // regular vital updates cannot leak intermediate GPS drift.
            self.latestLocation = latest
            self.transmitter.updateLocation(latest)
            self.readAndTransmitSensorSnapshot(forceFlush: true)
            self.publishMeasuredSnapshot()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.lastError = "GPS 오류: \(error.localizedDescription)"
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        Task { @MainActor in
            self.configureLocationUpdatesForCurrentMode()
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didChangeAuthorization status: CLAuthorizationStatus
    ) {
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        Task { @MainActor in
            self.configureLocationUpdatesForCurrentMode()
        }
    }
}
