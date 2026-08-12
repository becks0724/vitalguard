// iOS 업로드 파이프라인 — 워치 HR 배치를 로컬 큐에 영속하고 관제 서버(/api/mock/vital)에 JWT 로 업로드한다
import Foundation
import UIKit
import BackgroundTasks
import os

final class VitalPipeline {
    static let shared = VitalPipeline()
    static let bgTaskId = "com.vitalguard.upload"

    private let log = Logger(subsystem: "com.vitalguard.vitalguardApp", category: "VitalPipeline")
    private let work = DispatchQueue(label: "com.vitalguard.vital-pipeline")
    // 서버 계약 — 배치 최대 500건/요청, 큐는 로컬 상한을 두고 오래된 것부터 폐기한다.
    private let maxBatchPerRequest = 500
    private let maxQueue = 5_000

    private struct Config {
        let baseURL: URL
        let token: String
        let workerId: String
        let workerName: String?
    }

    // 기본 업로드 대상 = 프로덕션 관제 서버. 개발 터널 시험은 PoCConfig.plist 의 DevBaseURLOverride 로만.
    private static let productionBaseURL = URL(string: "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app")!

    static func resolvedBaseURL() -> URL {
        if let url = Bundle.main.url(forResource: "PoCConfig", withExtension: "plist"),
           let data = try? Data(contentsOf: url),
           let dict = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
           let override = dict["DevBaseURLOverride"] as? String,
           override.hasPrefix("http"),
           let overrideURL = URL(string: override) {
            return overrideURL
        }
        return productionBaseURL
    }

    private var config: Config?
    private var pending: [[String: Any]] = []
    private var uploading = false

    private lazy var queueFileURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("vital-queue.json")
    }()

    private lazy var isoMs: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private init() {}

    // MARK: - 기동

    func start() {
        work.async {
            self.config = self.loadConfig()
            self.restore()
            if let cfg = self.config {
                self.log.notice("파이프라인 가동 — 대상=\(cfg.baseURL.absoluteString, privacy: .public) workerId=\(cfg.workerId, privacy: .public) 보류 큐=\(self.pending.count, privacy: .public)건")
                self.uploadLocked()
            } else {
                self.log.notice("미로그인 — 업로드 비활성(수신·큐 적재는 계속, 로그인 후 일괄 전송)")
            }
        }
    }

    /// 로그인/로그아웃 직후 호출 — 자격을 다시 읽고 보류 큐를 밀어낸다.
    func reloadAuth() {
        work.async {
            self.config = self.loadConfig()
            if let cfg = self.config {
                self.log.notice("자격 갱신 — workerId=\(cfg.workerId, privacy: .public), 보류 큐 \(self.pending.count, privacy: .public)건 전송 시도")
                self.uploadLocked()
            } else {
                self.log.notice("로그아웃 — 업로드 비활성")
            }
        }
    }

    /// 계정 교체 시 잔여 큐 폐기 — 직전 계정 구간에 쌓인 미전송 샘플이 새 사번으로 귀속되는 것을 막는다.
    /// 로그인 직후 reloadAuth 보다 먼저 호출된다(같은 직렬 큐라 폐기가 업로드보다 앞선다).
    func purgeQueue(reason: String) {
        work.async {
            guard !self.pending.isEmpty else { return }
            let count = self.pending.count
            self.pending.removeAll()
            self.persist()
            self.log.notice("큐 \(count, privacy: .public)건 폐기 — \(reason, privacy: .public)")
            VitalBridge.shared.emit(["type": "pipeline", "pending": 0])
        }
    }

    private func loadConfig() -> Config? {
        guard let token = AuthStore.token, !token.isEmpty,
              let workerId = AuthStore.workerId, !workerId.isEmpty
        else { return nil }
        return Config(
            baseURL: Self.resolvedBaseURL(),
            token: token,
            workerId: workerId,
            workerName: AuthStore.userName
        )
    }

    // MARK: - 수신 (워치 hrBatch → VitalSample 변환)

    func ingest(payload: [String: Any]) {
        work.async {
            // 미로그인이어도 큐에는 쌓는다 — workerId 는 업로드 시점의 자격으로 붙인다(로그인 후 일괄 전송).
            let samples = payload["samples"] as? [[String: Any]] ?? []
            // 서버 계약 — ts 는 전송 시각, 측정 시각은 heartRateMeasuredAt 에 따로 싣는다.
            let sentAt = self.isoMs.string(from: Date())
            for s in samples {
                guard let bpm = s["bpm"] as? Double else { continue }
                var v: [String: Any] = [
                    "ts": sentAt,
                    "heartRate": bpm,
                ]
                if let t = s["ts"] as? Double {
                    v["heartRateMeasuredAt"] = self.isoMs.string(from: Date(timeIntervalSince1970: t))
                }
                self.pending.append(v)
            }
            if self.pending.count > self.maxQueue {
                let overflow = self.pending.count - self.maxQueue
                self.pending.removeFirst(overflow)
                self.log.warning("큐 상한(\(self.maxQueue, privacy: .public)) 초과 — 오래된 \(overflow, privacy: .public)건 폐기")
            }
            self.persist()
            VitalBridge.shared.emit(["type": "pipeline", "pending": self.pending.count])
            self.uploadLocked()
        }
    }

    var pendingCount: Int {
        work.sync { pending.count }
    }

    // MARK: - 업로드

    /// work 큐 안에서만 호출한다.
    private func uploadLocked() {
        guard let cfg = config, !pending.isEmpty, !uploading else { return }
        uploading = true

        // 백그라운드 수신(WCSession 재기동) 직후에도 업로드가 끝날 시간을 확보한다.
        var bgTask: UIBackgroundTaskIdentifier = .invalid
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "vital-upload") {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
        let finish: () -> Void = {
            self.uploading = false
            if bgTask != .invalid {
                UIApplication.shared.endBackgroundTask(bgTask)
                bgTask = .invalid
            }
        }

        // 큐에는 자격 무관 원시 샘플만 있고, workerId·source 는 전송 시점 자격으로 붙인다.
        let batch = Array(pending.prefix(maxBatchPerRequest)).map { item -> [String: Any] in
            var v = item
            v["workerId"] = cfg.workerId
            // 서버 source 화이트리스트 값 — 워치 측정 생체(watchos_data_vitalguard 로 분류됨).
            v["source"] = "VitAlGuard-WatchVitals"
            // 관제웹 작업자 행 표기용 이름 — 로그인 계정 이름을 그대로 싣는다(관제웹 프로필 입력이 있으면 그쪽이 오버라이드).
            if let name = cfg.workerName, !name.isEmpty {
                v["workerName"] = name
            }
            return v
        }
        var request = URLRequest(url: cfg.baseURL.appendingPathComponent("api/app/vital"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(cfg.token)", forHTTPHeaderField: "Authorization")
        guard let body = try? JSONSerialization.data(withJSONObject: batch) else {
            log.error("배치 직렬화 실패 — \(batch.count, privacy: .public)건 폐기")
            pending.removeFirst(batch.count)
            persist()
            finish()
            return
        }
        request.httpBody = body

        let task = URLSession.shared.dataTask(with: request) { _, response, error in
            self.work.async {
                if let error {
                    self.log.warning("업로드 실패(네트워크): \(error.localizedDescription, privacy: .public) — 30초 후 재시도, 큐 \(self.pending.count, privacy: .public)건")
                    finish()
                    self.scheduleRetry(after: 30)
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? -1
                switch status {
                case 200...299:
                    self.pending.removeFirst(min(batch.count, self.pending.count))
                    self.persist()
                    self.log.notice("[UP] \(batch.count, privacy: .public)건 업로드 성공(\(status, privacy: .public)) — 잔여 큐 \(self.pending.count, privacy: .public)건")
                    VitalBridge.shared.emit(["type": "pipeline", "pending": self.pending.count, "uploadOk": true])
                    finish()
                    // 잔여가 있으면 즉시 다음 배치.
                    self.uploadLocked()
                case 401, 403:
                    self.log.error("업로드 인증 거부(\(status, privacy: .public)) — 토큰 확인 필요, 5분 후 재시도")
                    VitalBridge.shared.emit(["type": "pipeline", "pending": self.pending.count, "uploadOk": false, "authRejected": true])
                    finish()
                    self.scheduleRetry(after: 300)
                default:
                    self.log.warning("업로드 실패(HTTP \(status, privacy: .public)) — 30초 후 재시도")
                    finish()
                    self.scheduleRetry(after: 30)
                }
            }
        }
        task.resume()
    }

    private var retryScheduled = false

    private func scheduleRetry(after seconds: TimeInterval) {
        guard !retryScheduled else { return }
        retryScheduled = true
        work.asyncAfter(deadline: .now() + seconds) {
            self.retryScheduled = false
            self.uploadLocked()
        }
    }

    // MARK: - BGTask (백그라운드 잔여 큐 소진)

    func registerBGTask() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.bgTaskId, using: nil) { task in
            self.work.async {
                self.log.notice("BGTask 기동 — 큐 \(self.pending.count, privacy: .public)건")
                self.uploadLocked()
                task.setTaskCompleted(success: true)
            }
        }
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
        ) { _ in
            self.scheduleBGTaskIfNeeded()
        }
    }

    private func scheduleBGTaskIfNeeded() {
        work.async {
            guard self.config != nil, !self.pending.isEmpty else { return }
            let request = BGProcessingTaskRequest(identifier: Self.bgTaskId)
            request.requiresNetworkConnectivity = true
            try? BGTaskScheduler.shared.submit(request)
        }
    }

    // MARK: - 큐 영속 (재기동·강제종료 생존)

    private func persist() {
        guard let data = try? JSONSerialization.data(withJSONObject: pending) else { return }
        try? data.write(to: queueFileURL, options: .atomic)
    }

    private func restore() {
        guard let data = try? Data(contentsOf: queueFileURL),
              let items = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }
        pending = items
    }
}
