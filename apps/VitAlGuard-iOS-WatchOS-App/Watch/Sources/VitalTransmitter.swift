// 수집된 심박을 관제 수집 API로 전송하고, 실패 시 버퍼링 후 재전송하는 전송기
// VitalSampleSchema 와 동일 페이로드(workerId/ts ISO/heartRate/batteryPct). 분석은 폰·서버가 수행, 워치는 raw 전송만.
import Foundation
import CoreLocation
import WatchKit
import WatchConnectivity

struct FallHrTrajectory {
    let preMean10s: Double?
    let impactHr: Double?
    let postMean30s: Double?
    let postPeak30s: Double?
    let deltaMean: Double?
    let deltaPeak: Double?
}

@MainActor
final class VitalTransmitter {
    // (ok, 상태문구, 버퍼건수, 이번에 전송된 샘플수) 콜백 — WorkoutManager 가 @Published 로 반영.
    // 배칭이라 한 번의 전송으로 여러 샘플이 나가므로 sentDelta 로 누적 카운트를 올린다.
    var onResult: ((Bool, String, Int, Int) -> Void)?

    // 서버 주소는 앱이 관리한다. 워치 전송은 이 주소에 직접 접속하지 않고 iPhone으로 릴레이한다.
    private var endpoint: URL? { ConnectionSettings.currentURL() }

    // 작업자 식별 — 설정(UserDefaults)에서 매 전송 시 동적으로 읽는다(설정에서 바꾸면 즉시 반영).
    // workerId 는 사원번호 파생. reserved test prefix(test_/smoke_/infra_)는 피한다.
    private var workerId: String { ConnectionSettings.currentWorkerId() }
    private var workerName: String { ConnectionSettings.currentWorkerName() }
    private var employeeId: String { ConnectionSettings.currentEmployeeId() }

    // 배칭 — 라디오 기상 횟수를 줄이려고 HR 샘플을 윈도에 모았다가 주기마다 1배열로 전송.
    // flushInterval 을 낮추면 대시보드 신선도↑·배터리 소모↑ (5초면 종전 동작). 30초가 기본.
    private var pending: [[String: Any]] = []   // 현재 윈도 누적분(아직 미전송)
    private var backlog: [[String: Any]] = []   // 전송 실패분(오프라인 재시도 큐)
    private let maxBacklog = 300
    private var lastFlushAt: Date?
    private var flushInterval: TimeInterval { ConnectionSettings.currentSyncIntervalSeconds() }

    // 윈도 강제 플러시 타이머 — 샘플 유입이 멈춰도 윈도가 영영 안 비는 걸 막는다(보조 아닌 주 경로).
    // 윈도가 열릴 때(첫 샘플) flushInterval 후 1회 발화하도록 무장하고, 어떤 flush 든 일어나면 해제한다.
    // 샘플 도착 시의 enqueuePending 플러시는 이제 보조(타이머가 도착 전에 비워줌).
    private var flushTimer: DispatchSourceTimer?
    private var latestLocation: CLLocation?
    private var mlPipelineActive = false

    // 전송 실패분(backlog)을 UserDefaults 에 영속화 — 앱 종료/크래시 후에도 미전송 데이터를
    // 잃지 않도록 복원(AF2). backlog 변경 시마다 저장하고, init 에서 복원한다.
    // v1 대기열은 실측 검증 게이트가 없던 앱이 남긴 값이다. 새 버전에서 이를 재전송하면
    // 오래된/검증 불가 값이 관제에 섞일 수 있으므로 한 번 폐기하고, 이후에는 v2만 사용한다.
    private let backlogKey = "vital_backlog_v2"
    private let legacyBacklogKeys = ["vital_backlog_v1"]

    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init() {
        WKInterfaceDevice.current().isBatteryMonitoringEnabled = true
        discardLegacyBacklog()
        restoreBacklog()
    }

    private func discardLegacyBacklog() {
        for key in legacyBacklogKeys {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }

    // 앱 시작 시 영속 backlog 복원 — 직전 실행에서 미전송으로 남은 샘플을 다음 전송에 함께 보낸다.
    private func restoreBacklog() {
        guard let data = UserDefaults.standard.data(forKey: backlogKey),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }
        backlog = arr
        trimBacklog()
    }

    // backlog 를 UserDefaults 에 저장(비었으면 키 제거). 모든 backlog 변경 직후 호출.
    private func persistBacklog() {
        if backlog.isEmpty {
            UserDefaults.standard.removeObject(forKey: backlogKey)
            return
        }
        if let data = try? JSONSerialization.data(withJSONObject: backlog) {
            UserDefaults.standard.set(data, forKey: backlogKey)
        }
    }

    // 모든 샘플 공통 필드(식별자/ts/배터리).
    private func basePayload() -> [String: Any] {
        var payload: [String: Any] = [
            "workerId": workerId,
            "ts": iso.string(from: Date()),
            "source": "VitAlGuard-WatchVitals",
        ]
        // 빈 문자열은 스키마(min 1) 위반 → 값 있을 때만 동봉.
        if !workerName.isEmpty { payload["workerName"] = workerName }
        if !employeeId.isEmpty { payload["employeeId"] = employeeId }
        if let latestLocation {
            payload["latitude"] = (latestLocation.coordinate.latitude * 1_000_000).rounded() / 1_000_000
            payload["longitude"] = (latestLocation.coordinate.longitude * 1_000_000).rounded() / 1_000_000
            payload["locationAccuracyMeters"] = (latestLocation.horizontalAccuracy * 10).rounded() / 10
            payload["locationTimestamp"] = iso.string(from: latestLocation.timestamp)
        }
        let level = WKInterfaceDevice.current().batteryLevel
        if level >= 0 { payload["batteryPct"] = Int((level * 100).rounded()) }
        payload["watchDeviceName"] = WKInterfaceDevice.current().name
        payload["watchDeviceModel"] = WKInterfaceDevice.current().model
        payload["watchDeviceLocalizedModel"] = WKInterfaceDevice.current().localizedModel
        payload["watchSystemVersion"] = WKInterfaceDevice.current().systemVersion
        // iPhone과 관제 수신 측이 "모델이 실제 Watch에서 검증되어 동작 중"인지
        // 알 수 있도록 정상 생체 스냅샷에도 상태만 동봉한다. 이는 낙상 이벤트가 아니다.
        payload["mlFallPipelineActive"] = mlPipelineActive
        return payload
    }

    func updateMLPipelineStatus(isActive: Bool) {
        mlPipelineActive = isActive
    }

    func updateLocation(_ location: CLLocation) {
        guard location.horizontalAccuracy > 0 else { return }
        latestLocation = location
    }

    // 정상 폴 — HR(연속) + 최신 SpO₂(있으면 동봉). 배칭 윈도에 누적.
    func send(heartRate: Double, spo2: Double?, heartRateMeasuredAt: Date? = nil, spo2MeasuredAt: Date? = nil) {
        guard canTransmitMeasuredWatchData else {
            onResult?(false, "실물 Apple Watch 확인 전송 보류", backlog.count, 0)
            return
        }
        guard let heartRate = validatedHeartRate(heartRate) else {
            onResult?(false, "실측 심박 대기 — 전송 보류", backlog.count, 0)
            return
        }
        var payload = basePayload()
        payload["source"] = "VitAlGuard-WatchVitals"
        payload["heartRate"] = Int(heartRate.rounded())
        if let spo2 = validatedSpO2(spo2) { payload["spo2"] = Int(spo2.rounded()) }
        if let heartRateMeasuredAt { payload["heartRateMeasuredAt"] = iso.string(from: heartRateMeasuredAt) }
        if let spo2MeasuredAt { payload["spo2MeasuredAt"] = iso.string(from: spo2MeasuredAt) }
        enqueuePending(payload)
    }

    // 잠금/백그라운드 유지용 heartbeat — 새 심박 이벤트가 잠시 없어도 최신 스냅샷과 GPS를 관제에 남긴다.
    func sendSnapshot(_ snapshot: MeasuredVitalSnapshot, forceFlush: Bool = true) {
        guard canTransmitMeasuredWatchData else {
            onResult?(false, "실물 Apple Watch 확인 전송 보류", backlog.count, 0)
            return
        }
        guard let heartRate = validatedHeartRate(snapshot.heartRate) else {
            onResult?(false, "실측 심박 대기 — 백그라운드 전송 보류", backlog.count, 0)
            return
        }
        var payload = basePayload()
        payload["source"] = "VitAlGuard-WatchVitals"
        payload["heartbeat"] = true
        payload["source"] = "VitAlGuard-Watch-background"
        payload["heartRate"] = Int(heartRate.rounded())
        if let spo2 = validatedSpO2(snapshot.spo2) { payload["spo2"] = Int(spo2.rounded()) }
        if let ecgStatus = snapshot.ecgStatus { payload["ecgStatus"] = ecgStatus }
        if let steps = snapshot.steps { payload["steps"] = steps }
        if let wristTemperatureC = snapshot.wristTemperatureC {
            let rounded = (wristTemperatureC * 10).rounded() / 10
            payload["wristTemperatureC"] = rounded
            payload["wristTemperature"] = rounded
            payload["wristTempC"] = rounded
            payload["wristTemp"] = rounded
            payload["skinTempC"] = rounded
            payload["skin_temp_c"] = rounded
            payload["skinTemperatureC"] = rounded
            payload["skinTemperature"] = rounded
            payload["skin_temp"] = rounded
            payload["wrist_temp_c"] = rounded
            payload["wrist_temp"] = rounded
            payload["bodyTempC"] = rounded
            payload["bodyTemp"] = rounded
            payload["bodyTemperatureCelsius"] = rounded
            payload["bodyTemperatureC"] = rounded
            payload["body_temp_c"] = rounded
            payload["body_temp"] = rounded
            payload["bodytemperature"] = rounded
            payload["wristTemperatureAvailable"] = true
            payload["skinTemperatureLabel"] = "수면 손목온도"
        }
        if let systolic = snapshot.bloodPressureSystolic { payload["bloodPressureSystolic"] = Int(systolic.rounded()) }
        if let diastolic = snapshot.bloodPressureDiastolic { payload["bloodPressureDiastolic"] = Int(diastolic.rounded()) }
        if let hrv = snapshot.hrvSdnnMs { payload["hrvSdnnMs"] = (hrv * 10).rounded() / 10 }
        if let respiratoryRate = snapshot.respiratoryRate { payload["respiratoryRate"] = (respiratoryRate * 10).rounded() / 10 }
        if let activeEnergyKcal = snapshot.activeEnergyKcal { payload["activeEnergyKcal"] = (activeEnergyKcal * 100).rounded() / 100 }
        if let exerciseTimeMinutes = snapshot.exerciseTimeMinutes { payload["exerciseTimeMinutes"] = (exerciseTimeMinutes * 10).rounded() / 10 }
        if let standTimeMinutes = snapshot.standTimeMinutes { payload["standTimeMinutes"] = (standTimeMinutes * 10).rounded() / 10 }
        if let moveTimeMinutes = snapshot.moveTimeMinutes { payload["moveTimeMinutes"] = (moveTimeMinutes * 10).rounded() / 10 }
        if let altitude = snapshot.relativeAltitudeMeters { payload["relativeAltitudeMeters"] = (altitude * 10).rounded() / 10 }
        if let pressure = snapshot.barometricPressureKPa { payload["barometricPressureKPa"] = (pressure * 100).rounded() / 100 }
        if let acceleration = snapshot.accelerationMagnitudeG { payload["accelerationMagnitudeG"] = (acceleration * 100).rounded() / 100 }
        if let rotation = snapshot.rotationRateRadS { payload["rotationRateRadS"] = (rotation * 100).rounded() / 100 }
        if let disturbances = snapshot.sleepingBreathingDisturbances {
            payload["sleepingBreathingDisturbances"] = (disturbances * 100).rounded() / 100
        }
        if let disturbanceStatus = snapshot.sleepingBreathingDisturbancesClassification {
            payload["sleepingBreathingDisturbancesClassification"] = disturbanceStatus
            payload["sleepApneaRisk"] = disturbanceStatus
        }
        if let latitude = snapshot.latitude { payload["latitude"] = (latitude * 1_000_000).rounded() / 1_000_000 }
        if let longitude = snapshot.longitude { payload["longitude"] = (longitude * 1_000_000).rounded() / 1_000_000 }
        if let accuracy = snapshot.locationAccuracyMeters { payload["locationAccuracyMeters"] = (accuracy * 10).rounded() / 10 }
        if forceFlush {
            pending.append(payload)
            flush(force: true)
        } else {
            enqueuePending(payload)
        }
    }

    // 낙상 후보 — 활성화 요소 전부(충격G/정지초/자유낙하 전조/회전 피크/판정 사유) + 직전 HR/SpO₂.
    // 양성은 여기서 즉시 낙상 경보로 확정하지 않고, 워치 확인 프롬프트용 pending 후보로 먼저 저장한다.
    func sendFallCandidate(
        candidateId: String,
        decision: String,
        isFall: Bool,
        peakG: Double,
        stillSec: Double,
        freefallPreceded: Bool,
        peakRotationRadS: Double,
        heartRate: Double?,
        spo2: Double?,
        hrTrajectory: FallHrTrajectory,
        ruleIsFall: Bool,
        mlWorkVetoProb: Double?,
        mlImpactProb: Double?,
        mlRecoveryProb: Double?,
        mlVetoedByML: Bool,
        mlRejectedByImpactML: Bool,
        mlRescuedByML: Bool,
        mlShouldAlert: Bool?
    ) {
        // 관제웹은 후보행도 낙상 이벤트로 표시할 수 있다. Watch 경보로 확정되지 않은
        // 후보(ML 기각·미착용·미해결 사건)는 전송하지 않아 유령 낙상 행을 막는다.
        guard isFall else { return }
        var payload = basePayload()
        payload["fallCandidate"] = true
        payload["fallCandidateId"] = candidateId
        payload["fallDecision"] = decision
        payload["fallRuleIsFall"] = ruleIsFall
        payload["fallUpdatePhase"] = "candidate"
        payload["accelMagnitudeG"] = (peakG * 100).rounded() / 100
        payload["motionStillSec"] = (stillSec * 10).rounded() / 10
        payload["freefallPreceded"] = freefallPreceded
        payload["peakRotationRadS"] = (peakRotationRadS * 100).rounded() / 100
        if let mlWorkVetoProb { payload["mlWorkVetoProb"] = (mlWorkVetoProb * 1_000).rounded() / 1_000 }
        if let mlImpactProb { payload["mlImpactProb"] = (mlImpactProb * 1_000).rounded() / 1_000 }
        if let mlRecoveryProb { payload["mlRecoveryProb"] = (mlRecoveryProb * 1_000).rounded() / 1_000 }
        payload["fallDetectionMode"] = "ml_three_model"
        if let mlShouldAlert { payload["mlShouldAlert"] = mlShouldAlert }
        payload["mlVetoedByML"] = mlVetoedByML
        payload["mlRejectedByImpactML"] = mlRejectedByImpactML
        payload["mlRescuedByML"] = mlRescuedByML
        // A missing outcome is interpreted by the phone as a pending prompt.
        // Mark rejected candidates explicitly so they cannot become an alert.
        payload["fallPromptOutcome"] = isFall ? "pending" : "not_alerted"
        if let heartRate { payload["heartRate"] = Int(heartRate.rounded()) }
        if let spo2 { payload["spo2"] = Int(spo2.rounded()) }
        if let v = hrTrajectory.preMean10s { payload["hrPreMean10s"] = (v * 10).rounded() / 10 }
        if let v = hrTrajectory.impactHr { payload["hrAtImpact"] = Int(v.rounded()) }
        // post-impact HR follow-up 는 초기 후보행이 먼저 생겨야 같은 candidateId 로 업데이트 가능하다.
        // 따라서 양성/음성 공통으로 후보행은 즉시 전송해 DB 기준행을 확정한다.
        pending.append(payload)
        flush(force: true)
    }

    func sendFallPromptResult(candidateId: String, outcome: String, responseSec: Double) {
        var payload = basePayload()
        payload["fallCandidateId"] = candidateId
        payload["fallUpdatePhase"] = "prompt_result"
        payload["fallPromptOutcome"] = outcome
        payload["fallPromptResponseSec"] = (responseSec * 10).rounded() / 10
        pending.append(payload)
        flush(force: true)
    }

    func sendFallHrFollowup(candidateId: String, trajectory: FallHrTrajectory) {
        var payload = basePayload()
        payload["fallCandidateId"] = candidateId
        payload["fallUpdatePhase"] = "post_impact_followup"
        if let v = trajectory.postMean30s { payload["hrPostMean30s"] = (v * 10).rounded() / 10 }
        if let v = trajectory.postPeak30s { payload["hrPostPeak30s"] = Int(v.rounded()) }
        if let v = trajectory.deltaMean { payload["hrDeltaMean"] = (v * 10).rounded() / 10 }
        if let v = trajectory.deltaPeak { payload["hrDeltaPeak"] = (v * 10).rounded() / 10 }
        pending.append(payload)
        flush(force: true)
    }

    func sendFallEscalation(
        candidateId: String,
        responseSec: Double,
        heartRate: Double?,
        spo2: Double?
    ) {
        var payload = basePayload()
        payload["fallDetected"] = true
        payload["fallCandidateId"] = candidateId
        payload["fallPromptOutcome"] = "auto_escalated"
        payload["fallPromptResponseSec"] = (responseSec * 10).rounded() / 10
        if let heartRate { payload["heartRate"] = Int(heartRate.rounded()) }
        if let spo2 { payload["spo2"] = Int(spo2.rounded()) }
        pending.append(payload)
        flush(force: true)
    }

    func sendPromptSos(
        candidateId: String,
        responseSec: Double,
        heartRate: Double?,
        spo2: Double?
    ) {
        var payload = basePayload()
        payload["manualSos"] = true
        payload["fallCandidateId"] = candidateId
        payload["fallPromptOutcome"] = "manual_sos"
        payload["fallPromptResponseSec"] = (responseSec * 10).rounded() / 10
        if let heartRate { payload["heartRate"] = Int(heartRate.rounded()) }
        if let spo2 { payload["spo2"] = Int(spo2.rounded()) }
        pending.append(payload)
        flush(force: true)
    }

    // 워치 단독 SOS — 작업자가 워치에서 직접 발신(폰 잠금/워치만 착용 대비). 긴급이라 즉시 전송.
    func sendSos(heartRate: Double?, spo2: Double?) {
        var payload = basePayload()
        payload["manualSos"] = true
        if let heartRate { payload["heartRate"] = Int(heartRate.rounded()) }
        if let spo2 { payload["spo2"] = Int(spo2.rounded()) }
        pending.append(payload)
        flush(force: true)
    }

    // 스트레스 입력 60초 sub-cadence — raw 7종 + 최신 HR/SpO₂. 배칭 윈도에 누적(다음 flush 에 동반).
    func sendStress(_ s: StressInputs, heartRate: Double?, spo2: Double?, heartRateMeasuredAt: Date? = nil, spo2MeasuredAt: Date? = nil, forceFlush: Bool = false) {
        // 백그라운드 타이머가 HealthKit의 과거 일일 합계만 반복 전송하지 않도록, 현재
        // 워치에서 얻은 유효 심박이 있을 때만 이 경로를 연다. 실제 낙상/SOS는 별도 경로다.
        guard canTransmitMeasuredWatchData else {
            onResult?(false, "실물 Apple Watch 확인 전송 보류", backlog.count, 0)
            return
        }
        guard let heartRate = validatedHeartRate(heartRate) else {
            onResult?(false, "실측 심박 대기 — 주기 전송 보류", backlog.count, 0)
            return
        }
        var payload = basePayload()
        payload["source"] = "VitAlGuard-WatchVitals"
        payload["heartRate"] = Int(heartRate.rounded())
        if let spo2 = validatedSpO2(spo2) { payload["spo2"] = Int(spo2.rounded()) }
        if let heartRateMeasuredAt { payload["heartRateMeasuredAt"] = iso.string(from: heartRateMeasuredAt) }
        if let spo2MeasuredAt { payload["spo2MeasuredAt"] = iso.string(from: spo2MeasuredAt) }
        if let v = s.hrvSdnnMs { payload["hrvSdnnMs"] = (v * 100).rounded() / 100 }
        if let v = s.restingHeartRate { payload["restingHeartRate"] = Int(v.rounded()) }
        if let v = s.walkingHeartRate { payload["walkingHeartRate"] = Int(v.rounded()) }
        if let v = s.respiratoryRate { payload["respiratoryRate"] = (v * 10).rounded() / 10 }
        if let v = s.activeEnergyKcal { payload["activeEnergyKcal"] = (v * 100).rounded() / 100 }
        if let v = s.exerciseTimeMinutes { payload["exerciseTimeMinutes"] = (v * 10).rounded() / 10 }
        if let v = s.standTimeMinutes { payload["standTimeMinutes"] = (v * 10).rounded() / 10 }
        if let v = s.moveTimeMinutes { payload["moveTimeMinutes"] = (v * 10).rounded() / 10 }
        if let v = s.flightsClimbed { payload["flightsClimbed"] = Int(v.rounded()) }
        if let v = s.steps { payload["steps"] = Int(v.rounded()) }
        if let v = s.wristTemperatureC {
            let rounded = (v * 10).rounded() / 10
            payload["wristTemperatureC"] = rounded
            payload["wristTemperature"] = rounded
            payload["wristTempC"] = rounded
            payload["wristTemp"] = rounded
            payload["skinTempC"] = rounded
            payload["skin_temp_c"] = rounded
            payload["skinTemperatureC"] = rounded
            payload["skinTemperature"] = rounded
            payload["skin_temp"] = rounded
            payload["wrist_temp_c"] = rounded
            payload["wrist_temp"] = rounded
            payload["bodyTempC"] = rounded
            payload["bodyTemp"] = rounded
            payload["bodyTemperatureCelsius"] = rounded
            payload["bodyTemperatureC"] = rounded
            payload["body_temp_c"] = rounded
            payload["body_temp"] = rounded
            payload["bodytemperature"] = rounded
            payload["wristTemperatureAvailable"] = true
            payload["skinTemperatureLabel"] = "수면 손목온도"
        }
        if let v = s.bloodPressureSystolic { payload["bloodPressureSystolic"] = Int(v.rounded()) }
        if let v = s.bloodPressureDiastolic { payload["bloodPressureDiastolic"] = Int(v.rounded()) }
        if let v = s.ecgClassification { payload["ecgStatus"] = v }
        if let v = s.ecgAverageHeartRate { payload["ecgAverageHeartRate"] = Int(v.rounded()) }
        if let v = s.relativeAltitudeMeters { payload["relativeAltitudeMeters"] = (v * 10).rounded() / 10 }
        if let v = s.barometricPressureKPa { payload["barometricPressureKPa"] = (v * 100).rounded() / 100 }
        if let v = s.accelerationMagnitudeG { payload["accelerationMagnitudeG"] = (v * 100).rounded() / 100 }
        if let v = s.rotationRateRadS { payload["rotationRateRadS"] = (v * 100).rounded() / 100 }
        if let v = s.sleepingBreathingDisturbances {
            payload["sleepingBreathingDisturbances"] = (v * 100).rounded() / 100
        }
        if let v = s.sleepingBreathingDisturbancesClassification {
            payload["sleepingBreathingDisturbancesClassification"] = v
            payload["sleepApneaRisk"] = v
        }
        enqueuePending(payload)
        if forceFlush { flush(force: true) }
    }

    // 세션 종료 시 윈도에 남은 미전송분을 마저 전송.
    func flushPending() { flush(force: true) }

    // 설정 화면용 연결 테스트. 워치는 iPhone 릴레이에만 연결하고 서버 인증은 iPhone이 담당한다.
    func testConnection() async -> String {
        guard WCSession.isSupported() else { return "iPhone 릴레이를 지원하지 않는 기기입니다" }
        let session = WCSession.default
        session.activate()
        return session.isReachable ? "iPhone 릴레이 연결됨" : "iPhone 연결 대기 중"
    }

    // 윈도에 샘플을 쌓고, 첫 샘플로 윈도를 열고, flushInterval 경과 시 배열로 전송.
    private func enqueuePending(_ payload: [String: Any]) {
        pending.append(payload)
        // 강제 타이머가 안 떠 있으면(첫 샘플 또는 직전 flush 후 새 윈도) flushInterval 후 발화하도록 무장.
        // → 이후 샘플 유입이 멈춰도 윈도가 비워진다. 샘플 도착 시의 아래 즉시 flush 는 보조 경로.
        if flushTimer == nil { armFlushTimer() }
        let now = Date()
        guard let last = lastFlushAt else {
            lastFlushAt = now   // 첫 샘플이 윈도 시작점.
            return
        }
        if now.timeIntervalSince(last) >= flushInterval { flush() }
    }

    private func validatedHeartRate(_ value: Double?) -> Double? {
        guard let value, value.isFinite, (20...250).contains(value) else { return nil }
        return value
    }

    // 시뮬레이터는 어떤 주기·시간대에서도 관제 원본으로 보낼 수 없다.
    // 실물 Apple Watch에서 들어온 값만 전송 경로에 진입한다.
    private var canTransmitMeasuredWatchData: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return true
        #endif
    }

    private func validatedSpO2(_ value: Double?) -> Double? {
        guard let value, value.isFinite, (50...100).contains(value) else { return nil }
        return value
    }

    // 윈도 강제 플러시 타이머 무장 — flushInterval 후 1회 발화. 윈도가 아직 비지 않았으면 강제 전송.
    private func armFlushTimer() {
        flushTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + flushInterval)
        timer.setEventHandler { [weak self] in
            // @MainActor 격리로 hop(기존 델리게이트 콜백과 동일한 Task { @MainActor } 패턴).
            Task { @MainActor in self?.flush() }
        }
        flushTimer = timer
        timer.resume()
    }

    // 누적 윈도를 1배열로 전송. 라디오 기상은 이 순간 1회뿐.
    private func flush(force: Bool = false) {
        flushTimer?.cancel()        // 어떤 flush 든 윈도를 닫으므로 강제 타이머 해제(다음 샘플이 재무장).
        flushTimer = nil
        guard force || !pending.isEmpty else { return }
        lastFlushAt = Date()
        let batch = pending
        pending.removeAll()
        guard !batch.isEmpty else { return }
        relayBatchToPhone(batch)
    }

    private func relayBatchToPhone(_ batch: [[String: Any]]) {
        guard WCSession.isSupported() else {
            backlog.insert(contentsOf: batch, at: 0); trimBacklog()
            onResult?(false, "iPhone 릴레이 미지원 → 버퍼", backlog.count, 0)
            return
        }
        let payload: [String: Any] = [
            "source": "VitAlGuard-Watch",
            "watchVitalBatch": batch
        ]
        let session = WCSession.default
        session.activate()
        guard session.isReachable else {
            session.transferUserInfo(payload)
            onResult?(true, "iPhone 전달 대기열 (\(batch.count)건)", backlog.count, batch.count)
            return
        }
        session.sendMessage(payload, replyHandler: { [weak self] reply in
            Task { @MainActor in
                guard reply["status"] as? String == "vitalsRelayed" else {
                    self?.backlog.insert(contentsOf: batch, at: 0)
                    self?.trimBacklog()
                    self?.onResult?(false, "iPhone 릴레이 확인 실패 → 버퍼", self?.backlog.count ?? 0, 0)
                    return
                }
                self?.onResult?(true, "iPhone 릴레이 완료 (\(batch.count)건)", self?.backlog.count ?? 0, batch.count)
            }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in
                self?.backlog.insert(contentsOf: batch, at: 0)
                self?.trimBacklog()
                self?.onResult?(false, "iPhone 릴레이 실패 → 버퍼", self?.backlog.count ?? 0, 0)
            }
        })
    }

    private func trimBacklog() {
        if backlog.count > maxBacklog { backlog.removeFirst(backlog.count - maxBacklog) }
        persistBacklog()
    }

}
