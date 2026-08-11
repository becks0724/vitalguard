// iOS WCSession 수신부 — 워치 HR 배치를 받아 콘솔에 기록한다 (Phase 0. 큐·업로드는 Phase 1)
import Foundation
import WatchConnectivity
import os

final class PhoneReceiver: NSObject, WCSessionDelegate {
    static let shared = PhoneReceiver()

    private let log = Logger(subsystem: "com.vitalguard.vitalguardApp", category: "PhoneReceiver")

    private override init() {
        super.init()
    }

    func activate() {
        guard WCSession.isSupported() else {
            log.error("WCSession 미지원 기기")
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    private func handle(_ payload: [String: Any], via channel: String) {
        guard payload["type"] as? String == "hrBatch" else {
            log.notice("알 수 없는 페이로드 수신(\(channel, privacy: .public)): \(String(describing: payload), privacy: .public)")
            return
        }
        let seq = payload["seq"] as? Int ?? -1
        let samples = payload["samples"] as? [[String: Any]] ?? []
        let latest = samples.last?["bpm"] as? Double
        let latestText = latest.map { String(format: "%.0f", $0) } ?? "--"
        log.notice("[HR] seq=\(seq, privacy: .public) 채널=\(channel, privacy: .public) 샘플=\(samples.count, privacy: .public)건 최신=\(latestText, privacy: .public)bpm")
        // Phase 1 — 수신 배치를 업로드 파이프라인에 넘긴다(설정 없으면 파이프라인이 무시).
        VitalPipeline.shared.ingest(payload: payload)
        // Phase 2 — 표시용 최신값을 Flutter 스트림으로 전달(경로는 표시 전용, 서버 전송과 무관).
        if let bpm = latest {
            var event: [String: Any] = ["type": "hr", "bpm": bpm, "seq": seq, "channel": channel]
            if let ts = samples.last?["ts"] as? Double {
                event["measuredAtMs"] = Int(ts * 1000)
            }
            VitalBridge.shared.emit(event)
        }
    }

    // MARK: - WCSessionDelegate (iOS)

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error {
            log.error("WC 활성화 실패: \(error.localizedDescription, privacy: .public)")
        } else {
            log.notice("WC 활성화 완료 state=\(activationState.rawValue, privacy: .public) paired=\(session.isPaired, privacy: .public) watchAppInstalled=\(session.isWatchAppInstalled, privacy: .public)")
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // 워치 교체 등으로 세션이 해제되면 즉시 재활성화한다.
        session.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handle(message, via: "sendMessage")
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handle(userInfo, via: "transferUserInfo")
    }
}
