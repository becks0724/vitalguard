// 워치 워크아웃 세션으로 심박을 연속 수집하고 전송기로 넘기는 핵심 매니저
// 잠금-검증의 골자 — 워치가 live builder 콜백으로 HR 을 받으므로(폰 HealthKit 읽기 아님)
// iPhone 잠금과 무관하게 수집이 지속된다.
import Foundation
import AVFoundation
import HealthKit
import WatchKit

@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    @Published var authorized = false
    @Published var isRunning = false
    @Published var latestHeartRate: Double?
    @Published var latestSpO2: Double?
    @Published var fallCount = 0
    @Published var lastFallText: String?
    @Published var sentCount = 0
    @Published var bufferedCount = 0
    @Published var lastStatus = "대기"
    @Published var lastError: String?
    @Published var activeFallPrompt: ActiveFallPrompt?

    private let store = HKHealthStore()
    private let transmitter = VitalTransmitter()
    private let speech = AVSpeechSynthesizer()
    private lazy var spo2Reader = SpO2Reader(store: store)
    private lazy var stressReader = StressInputsReader(store: store)
    private let fallDetector = FallDetector()
    private var lastStressAt: Date?
    private var hrHistory: [HeartRatePoint] = []
    private var fallPromptTask: Task<Void, Never>?
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let hrType = HKQuantityType(.heartRate)
    private let spo2Type = HKQuantityType(.oxygenSaturation)
    private let hrPreWindowSec: TimeInterval = 10
    private let hrPostWindowSec: TimeInterval = 30
    private let hrHistoryKeepSec: TimeInterval = 90
    private let fallPromptTimeoutSec: TimeInterval = 20
    // 무동작 게이트 — 프롬프트 시작 후 이 유예(초)가 지난 뒤의 움직임만 '활동'으로 본다(낙상 직후 잔여 정리 무시).
    private let fallMovementGraceSec: TimeInterval = 1.5
    // FallDetector.onMovement 로 갱신되는 '마지막 착용자 움직임 시각'. 프롬프트 무동작 판정에 사용.
    private var lastMovementAt: Date?

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
        case movedCancelled = "moved_cancelled" // 프롬프트 중 착용자 움직임 감지 → 자동 취소(멀쩡).
    }

    override init() {
        super.init()
        transmitter.onResult = { [weak self] ok, status, buffered, sent in
            guard let self else { return }
            if ok { self.sentCount += sent }
            self.lastStatus = status
            self.bufferedCount = buffered
        }
        spo2Reader.onUpdate = { [weak self] pct in
            self?.latestSpO2 = pct
        }
        fallDetector.onCandidate = { [weak self] candidate in
            self?.handleCandidate(candidate)
        }
        // 착용자 움직임 신호 — 낙상 프롬프트 무동작 게이트가 이 시각을 본다(움직이면 자동 취소).
        fallDetector.onMovement = { [weak self] in
            self?.lastMovementAt = Date()
        }
    }

    // 낙상 후보 해소(양성/음성 공통) — 후보행은 항상 ML 수집용으로 전송한다.
    // 양성은 즉시 경보로 확정하지 않고 워치 확인 프롬프트를 띄운 뒤, 해제/SOS/무응답 결과로 후속 처리한다.
    private func handleCandidate(_ candidate: FallCandidate) {
        let candidateId = UUID().uuidString.lowercased()
        let now = Date()
        let impactAt = now.addingTimeInterval(-candidate.stillSec)
        let preTrajectory = trajectoryAroundImpact(impactAt: impactAt)
        if candidate.isFall {
            lastFallText = String(
                format: "낙상 후보 %.1fG · 정지 %.1fs — 확인 대기", candidate.peakG, candidate.stillSec
            )
        }
        transmitter.sendFallCandidate(
            candidateId: candidateId,
            decision: candidate.decision.rawValue,
            isFall: candidate.isFall,
            peakG: candidate.peakG,
            stillSec: candidate.stillSec,
            freefallPreceded: candidate.freefallPreceded,
            peakRotationRadS: candidate.peakRotationRadS,
            heartRate: latestHeartRate,
            spo2: latestSpO2,
            hrTrajectory: preTrajectory
        )
        if candidate.isFall {
            beginFallPrompt(
                candidateId: candidateId,
                peakG: candidate.peakG,
                stillSec: candidate.stillSec,
                peakRotationRadS: candidate.peakRotationRadS,
                detectedAt: now
            )
        }
        schedulePostImpactFollowup(candidateId: candidateId, impactAt: impactAt)
    }

    // 실제 낙상이 어려운 데모/검증용 수동 트리거 — 알고리즘 무관 합성 양성(자유낙하 전조 가정).
    func simulateFall() {
        handleCandidate(
            FallCandidate(
                decision: .fall,
                peakG: 3.4,
                stillSec: 1.5,
                freefallPreceded: true,
                peakRotationRadS: 7.0
            )
        )
    }

    // 워치 단독 SOS — 작업자가 워치에서 직접 발신. 최신 HR/SpO₂ 동봉(즉시 전송).
    func sendSos() {
        lastStatus = "SOS 전송"
        transmitter.sendSos(heartRate: latestHeartRate, spo2: latestSpO2)
    }

    func dismissActiveFallPrompt() {
        completeFallPrompt(.dismissed)
    }

    func escalateActiveFallPromptToSos() {
        completeFallPrompt(.manualSos)
    }

    // 설정 화면 연결 테스트 패스스루.
    func testConnection() async -> String {
        await transmitter.testConnection()
    }

    // HR 콜백에 피기백한 60초 sub-cadence — 스트레스 입력 읽어 전송(폰과 동일 주기).
    private func maybeReadStress() {
        let now = Date()
        if let last = lastStressAt, now.timeIntervalSince(last) < 60 { return }
        lastStressAt = now
        Task {
            let inputs = await stressReader.read()
            transmitter.sendStress(inputs, heartRate: latestHeartRate, spo2: latestSpO2)
        }
    }

    private func beginFallPrompt(
        candidateId: String,
        peakG: Double,
        stillSec: Double,
        peakRotationRadS: Double,
        detectedAt: Date
    ) {
        // 프롬프트 중 새 후보 발생 = 또 다른 충격 = 착용자 활동 중 → 이전 것을 취소(에스컬레이션 아님).
        // (기존엔 .autoEscalated 라 오탐이 몰리면 경보가 연달아 나갔다.)
        if activeFallPrompt != nil {
            completeFallPrompt(.movedCancelled)
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
        lastStatus = "낙상 확인 대기"
        playPromptAlert()
        // 무동작 게이트 기준선 — 이 시각(유예 포함) 이후의 움직임만 '활동'으로 본다. 프롬프트 이전 움직임은 무시.
        let movementGraceUntil = detectedAt.addingTimeInterval(fallMovementGraceSec)
        fallPromptTask?.cancel()
        fallPromptTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for remaining in stride(from: Int(self.fallPromptTimeoutSec), through: 1, by: -1) {
                guard var prompt = self.activeFallPrompt, prompt.id == candidateId else { return }
                // ★ 무동작 게이트: 유예 후 착용자 움직임이 감지되면 = 멀쩡 → 자동 취소(에스컬레이션 아님).
                //   진짜 낙상/실신은 미동이 없어 이 분기를 안 타고 아래 승격으로 간다 → 미탐 안 오름.
                if let moved = self.lastMovementAt, moved > movementGraceUntil {
                    self.completeFallPrompt(.movedCancelled)
                    return
                }
                prompt.remainingSec = remaining
                self.activeFallPrompt = prompt
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
            }
            // 20초 내내 미동 없음 = 진짜 무동작 → 승격. (마지막 1초 구간의 움직임도 최종 확인.)
            if let moved = self.lastMovementAt, moved > movementGraceUntil {
                self.completeFallPrompt(.movedCancelled)
                return
            }
            self.completeFallPrompt(.autoEscalated)
        }
    }

    private func completeFallPrompt(_ outcome: FallPromptOutcome) {
        guard let prompt = activeFallPrompt else { return }
        fallPromptTask?.cancel()
        fallPromptTask = nil
        activeFallPrompt = nil

        let responseSec = max(0, Date().timeIntervalSince(prompt.detectedAt))
        transmitter.sendFallPromptResult(
            candidateId: prompt.id,
            outcome: outcome.rawValue,
            responseSec: responseSec
        )

        switch outcome {
        case .dismissed:
            lastStatus = "낙상 후보 해제"
            lastFallText = String(
                format: "후보 해제 %.1f초", responseSec
            )
        case .movedCancelled:
            lastStatus = "낙상 후보 자동 취소(움직임 감지)"
            lastFallText = String(
                format: "움직임 감지 — 자동 취소 %.1f초", responseSec
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

            let startDate = Date()
            session.startActivity(with: startDate)
            isRunning = true
            lastError = nil
            lastStatus = "수집 시작"
            lastStressAt = nil
            spo2Reader.start()
            fallDetector.start()
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
        transmitter.flushPending()   // 윈도에 남은 미전송 샘플 마저 전송.
        spo2Reader.stop()
        fallDetector.stop()
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
            self.spo2Reader.stop()
            self.fallDetector.stop()
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
        Task { @MainActor in
            self.recordHeartRate(bpm, at: Date())
            self.latestHeartRate = bpm
            self.transmitter.send(heartRate: bpm, spo2: self.latestSpO2)
            self.maybeReadStress()
        }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
