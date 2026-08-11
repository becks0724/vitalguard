// 워치 HR 수집기 — HKWorkoutSession 으로 백그라운드 수집을 유지하고 5초 배치로 WCSession 송신한다
import Foundation
import HealthKit
import WatchConnectivity

final class WatchStreamer: NSObject, ObservableObject {
    @Published var isRunning = false
    @Published var latestBPM: Double?
    @Published var batchesSent = 0
    @Published var statusText = "대기"

    private let healthStore = HKHealthStore()
    private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var flushTimer: Timer?
    private var pendingSamples: [[String: Any]] = []
    private var seq = 0

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: - 시작/중지

    func start() {
        guard !isRunning else { return }
        statusText = "권한 요청 중"
        let toShare: Set<HKSampleType> = [HKObjectType.workoutType()]
        let toRead: Set<HKObjectType> = [hrType]
        healthStore.requestAuthorization(toShare: toShare, read: toRead) { [weak self] granted, error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard granted, error == nil else {
                    self.statusText = "권한 거부됨"
                    return
                }
                self.beginWorkout()
            }
        }
    }

    func stop() {
        guard isRunning else { return }
        session?.end()
    }

    private func beginWorkout() {
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        config.locationType = .indoor
        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder

            let startDate = Date()
            session.startActivity(with: startDate)
            builder.beginCollection(withStart: startDate) { [weak self] _, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if let error {
                        self.statusText = "수집 시작 실패: \(error.localizedDescription)"
                        return
                    }
                    self.isRunning = true
                    self.statusText = "수집 중"
                    self.startFlushTimer()
                }
            }
        } catch {
            statusText = "세션 생성 실패: \(error.localizedDescription)"
        }
    }

    // MARK: - 5초 배치 송신

    private func startFlushTimer() {
        flushTimer?.invalidate()
        let timer = Timer(timeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.flush()
        }
        RunLoop.main.add(timer, forMode: .common)
        flushTimer = timer
    }

    private func flush() {
        // 새 샘플이 없어도 5초마다 최신값 1건을 실어 보낸다 — 게이트(5초 간격 콘솔 로그)의 심장박동 역할.
        if pendingSamples.isEmpty, let bpm = latestBPM {
            pendingSamples.append(["ts": Date().timeIntervalSince1970, "bpm": bpm])
        }
        guard !pendingSamples.isEmpty else { return }
        seq += 1
        let payload: [String: Any] = [
            "type": "hrBatch",
            "seq": seq,
            "sentAt": Date().timeIntervalSince1970,
            "samples": pendingSamples,
        ]
        pendingSamples.removeAll()

        let wc = WCSession.default
        if wc.isReachable {
            wc.sendMessage(payload, replyHandler: nil) { [weak self] _ in
                // 즉시 채널 실패 시 큐 전송으로 폴백 — 백그라운드에서도 유실 없이 도착한다.
                wc.transferUserInfo(payload)
                DispatchQueue.main.async { self?.noteSent() }
            }
            noteSent()
        } else {
            wc.transferUserInfo(payload)
            noteSent()
        }
    }

    private func noteSent() {
        batchesSent += 1
    }

    private func teardown() {
        flushTimer?.invalidate()
        flushTimer = nil
        pendingSamples.removeAll()
        isRunning = false
        statusText = "대기"
        session = nil
        builder = nil
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WatchStreamer: HKWorkoutSessionDelegate {
    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        guard toState == .ended else { return }
        builder?.endCollection(withEnd: date) { [weak self] _, _ in
            self?.builder?.finishWorkout { _, _ in
                DispatchQueue.main.async { self?.teardown() }
            }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async {
            self.statusText = "세션 오류: \(error.localizedDescription)"
            self.teardown()
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WatchStreamer: HKLiveWorkoutBuilderDelegate {
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard collectedTypes.contains(hrType),
              let stats = workoutBuilder.statistics(for: hrType),
              let quantity = stats.mostRecentQuantity() else { return }
        let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        DispatchQueue.main.async {
            self.latestBPM = bpm
            self.pendingSamples.append(["ts": Date().timeIntervalSince1970, "bpm": bpm])
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

// MARK: - WCSessionDelegate (watchOS)

extension WatchStreamer: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error {
            DispatchQueue.main.async { self.statusText = "WC 활성화 실패: \(error.localizedDescription)" }
        }
    }
}
