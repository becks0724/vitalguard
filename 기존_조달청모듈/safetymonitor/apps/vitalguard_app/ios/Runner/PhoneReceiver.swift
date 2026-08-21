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

    /// 표시용 최신 스냅숏 — 워치가 보낸 값을 Flutter 화면용으로만 누적한다.
    ///
    /// ⚠ **업로드 경로가 아니다.** 서버로 가는 값은 `VitalPipeline` 이 payload 원본에서 직접 만들고,
    /// 여기서 무엇을 하든 그 값은 변하지 않는다. Flutter 에는 표시용 복사본만 밀어준다 —
    /// 수집·큐·업로드가 Dart 를 경유하면 백그라운드에서 Flutter 엔진이 안 깨어나 수집이 끊긴다.
    ///
    /// ⚠ **누계의 기준점은 이 앱 프로세스가 받기 시작한 시점**이라 워치 세션 누계와 다를 수 있다
    /// (iOS 가 WCSession 수신으로 앱을 재기동하면 0 부터 다시 센다). 화면이 그 기준을 함께 적는다.
    private struct DisplaySnapshot {
        var bpm: Double?
        var bpmAt: Date?
        var spo2: Double?
        var spo2At: Date?
        /// 무동작 지속(초) — 못 잰 것은 0 이 아니라 nil 이다(워치가 값을 안 싣는다).
        var stillSec: Double?
        var steps = 0
        var flights = 0
        /// 이산 6종 — 종류별 누계 건수와 최신 값. 0 건은 화면에서 생략된다(워치와 같은 규칙).
        var discreteCounts: [String: Int] = [:]
        var discreteValues: [String: Double] = [:]
        /// 워치 배터리(%). 워치가 모니터링을 못 켜면 아예 안 실린다 — 0 이 아니라 nil 이다.
        var batteryPct: Int?
    }

    /// 설정 화면 진단용 — **마지막으로 워치 배치가 도착한 시각**.
    ///
    /// ★ EventChannel 이 아니라 여기서 읽는 이유 — 화면이 스트림으로만 이 값을 알면,
    ///   스트림이 끊겼을 때 화면도 함께 얼어 "언제부터 안 오는지" 를 못 보여준다
    ///   (2026-08-20 실측 — 서버는 12건/분 받는데 폰 화면만 7분 41초 전에 멈춰 있었다).
    ///   설정 화면은 3초마다 `status` 를 직접 물으므로 이 경로는 스트림과 독립이다.
    /// 화면이 **스트림 없이도** 현재 값을 가져갈 수 있는 경로.
    ///
    /// ★ 2026-08-20 실측 — EventChannel 이 끊기면 Dart 화면이 마지막 값에 얼어붙는데
    ///   네이티브는 계속 수집·업로드한다(서버 12건/분 · 화면 19분 전). 하루에 두 번 났다.
    ///   스트림은 **즉시성**을 위한 것이고, 이 경로가 **정확성**을 보장한다 —
    ///   화면이 주기적으로·당겨서 여기를 물으면 스트림이 죽어도 3초 안에 되살아난다.
    func currentDisplaySnapshot() -> [String: Any] {
        displayEvent(seq: lastSeq, channel: lastChannel)
    }

    var lastVitalAt: Date? { snapshot.bpmAt }
    var watchBatteryPct: Int? { snapshot.batteryPct }

    /// 워치 화면(`ContentView.discreteLine`)과 같은 순서.
    private static let discreteKeys = ["pe", "dl", "rhr", "whr", "rr", "hrv"]

    /// WCSession 델리게이트 콜백은 세션당 하나의 백그라운드 큐로 직렬 전달되므로 이 상태는 별도 잠금 없이 다룬다.
    private var snapshot = DisplaySnapshot()
    /// 마지막으로 emit 한 배치 번호·채널 — 스냅숏 조회가 같은 값을 낼 수 있어야 한다.
    private var lastSeq = -1
    private var lastChannel = "none"

    /// 마지막 배치의 워치→폰 전달 지연(초) — 봉투 `sentAt`(워치 전송 시각)과 도착 시각의 차.
    ///
    /// 2026-08-21 사용자 결정 ⓐ(docs/seam-contracts/findings.md A-1)로 처음 읽는다 — 그 전까지
    /// `sentAt` 은 워치가 보내지만 아무도 안 읽는 쓰기 전용 봉투 필드였다. 08-14 전달 지연
    /// 진단이 `ts − 측정시각`(워치 내부 배칭 5초 포함)으로 우회 추정하던 값의 직접 측정판이다.
    /// ⚠ 워치·폰 두 시계의 차라 음수가 나올 수 있다 — 시계 오차이지 미래 배달이 아니므로
    /// 여기서는 그대로 두고, 표시(설정 화면)가 0 으로 접는다.
    private(set) var lastBatchLagSec: Double?

    /// 표시 스냅숏을 비운다 — **계정이 바뀔 때만** 부른다.
    ///
    /// ★ 이 스냅숏은 계정을 모른다. `steps`·`discreteCounts` 가 앱 프로세스 수명 내내 누적되고
    /// 배치마다 전량 emit 되므로, 비우지 않으면 계정을 바꾼 뒤 **직전 작업자의 걸음·이산 건수·
    /// 마지막 심박이 새 계정의 값으로 보인다.** 업로드 큐는 이미 `purgeQueue` 로 폐기되므로
    /// 서버 귀속은 안전하고 **화면만 거짓을 말하는** 형태다(2026-08-18 발견).
    ///
    /// 워치는 로그인 상태와 무관하게 계속 보내므로 로그아웃 중에도 스냅숏은 자란다 —
    /// 그래서 로그아웃에서도 부른다. 비운 직후 빈 이벤트를 보내 화면이 옛 값을 들고 있지 않게 한다.
    func resetSnapshot(reason: String) {
        snapshot = DisplaySnapshot()
        log.notice("[HR] 표시 스냅숏 초기화 — \(reason, privacy: .public)")
        VitalBridge.shared.emit(displayEvent(seq: -1, channel: "reset"))
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
        // 전달 지연 — sendMessage(즉시)·transferUserInfo(큐 배달) 어느 채널이든 봉투는 같다.
        if let sentAt = payload["sentAt"] as? Double {
            lastBatchLagSec = Date().timeIntervalSince1970 - sentAt
        }
        let samples = payload["samples"] as? [[String: Any]] ?? []
        // 배치에 spo2 단독 항목이 섞일 수 있어 "마지막 항목"이 아니라 "bpm 있는 마지막 항목"을 찾는다.
        let latestHr = samples.last(where: { $0["bpm"] is Double })
        let latest = latestHr?["bpm"] as? Double
        let latestText = latest.map { String(format: "%.0f", $0) } ?? "--"
        let spo2Count = samples.filter { $0["spo2"] is Double }.count
        let spo2Text = spo2Count > 0 ? " spo2=\(spo2Count)건" : ""
        // 활동 에너지(온열 ①) — 배치에 실린 증분 합. 워치 화면 누적과 대조하는 현장 검증 지표.
        let aeSum = samples.compactMap { $0["ae"] as? Double }.reduce(0, +)
        let aeText = aeSum > 0 ? String(format: " ae=+%.2fkcal", aeSum) : ""
        log.notice("[HR] seq=\(seq, privacy: .public) 채널=\(channel, privacy: .public) 샘플=\(samples.count, privacy: .public)건 최신=\(latestText, privacy: .public)bpm\(spo2Text, privacy: .public)\(aeText, privacy: .public)")
        // Phase 1 — 수신 배치를 업로드 파이프라인에 넘긴다(설정 없으면 파이프라인이 무시).
        VitalPipeline.shared.ingest(payload: payload)
        // Phase 2 — 표시용 스냅숏을 Flutter 스트림으로 전달(경로는 표시 전용, 서버 전송과 무관).
        //
        // ★ 심박 없는 배치도 내보낸다. SpO₂·무동작 지속은 심박과 무관하게 단독으로 오고,
        //   **미착용 구간(심박 0건)이 무동작 지속의 핵심 용도**라 심박을 조건으로 걸면
        //   정작 봐야 할 구간이 화면에서 통째로 빠진다.
        if !samples.isEmpty {
            updateSnapshot(with: samples)
            lastSeq = seq
            lastChannel = channel
            VitalBridge.shared.emit(displayEvent(seq: seq, channel: channel))
        }
    }

    /// 배치에서 표시용 값만 뽑아 스냅숏에 반영한다.
    ///
    /// ⚠ **활동 에너지(`ae`)는 일부러 넣지 않는다.** 상시 `HKWorkoutSession` 때문에 애플이 하루 종일을
    /// "운동 중" 으로 간주해 앉아 있어도 시간당 약 288 kcal 로 산출한다(2026-08-15 실측 · 분당 최소 2.40 ·
    /// 평균 4.81). **약 4 배 과대**라 그대로 띄우면 작업자에게 틀린 수치를 보여주게 된다.
    /// 축을 바로잡기 전까지 화면에 올리지 않는다 — `apps/dashboard-web/docs/heat-activity-axis/checklist.md`.
    private func updateSnapshot(with samples: [[String: Any]]) {
        for s in samples {
            if let bpm = s["bpm"] as? Double {
                snapshot.bpm = bpm
                if let t = s["ts"] as? Double { snapshot.bpmAt = Date(timeIntervalSince1970: t) }
            }
            if let spo2 = s["spo2"] as? Double {
                snapshot.spo2 = spo2
                // SpO₂ 는 측정 시각이 따로 실린다(전송 시각과 다르다) — 없으면 항목 시각으로 내린다.
                let at = (s["spo2Ts"] as? Double) ?? (s["ts"] as? Double)
                snapshot.spo2At = at.map { Date(timeIntervalSince1970: $0) }
            }
            if let still = s["still"] as? Double { snapshot.stillSec = still }
            if let bat = s["bat"] as? Int { snapshot.batteryPct = bat }
            // 걸음·오른층은 구간 증분 계약이라 더해야 누계가 된다.
            if let stp = s["stp"] as? Int { snapshot.steps += stp }
            if let flt = s["flt"] as? Int { snapshot.flights += flt }
            for key in Self.discreteKeys {
                guard let value = s[key] as? Double else { continue }
                snapshot.discreteCounts[key, default: 0] += 1
                snapshot.discreteValues[key] = value
            }
        }
    }

    /// 스냅숏을 Flutter 이벤트로 옮긴다. 없는 값은 키 자체를 빼서 화면이 "0" 과 "모름" 을 구분하게 한다.
    ///
    /// 심박은 마지막으로 받은 값이 남는다(측정 시각도 함께 보내므로 화면이 나이를 적는다).
    /// **판정은 하지 않는다** — 몇 초부터 이상인지는 관제 화면이 정할 일이고 여기서 값을 감추면
    /// 08-14 의 "마지막 심박을 영원히 복사" 와 반대 방향의 같은 거짓말이 된다.
    private func displayEvent(seq: Int, channel: String) -> [String: Any] {
        var event: [String: Any] = ["type": "hr", "seq": seq, "channel": channel]
        if let bpm = snapshot.bpm { event["bpm"] = bpm }
        if let at = snapshot.bpmAt { event["measuredAtMs"] = Int(at.timeIntervalSince1970 * 1000) }
        if let spo2 = snapshot.spo2 { event["spo2"] = spo2 }
        if let at = snapshot.spo2At { event["spo2AtMs"] = Int(at.timeIntervalSince1970 * 1000) }
        if let still = snapshot.stillSec { event["stillSec"] = still }
        if snapshot.steps > 0 { event["steps"] = snapshot.steps }
        if snapshot.flights > 0 { event["flights"] = snapshot.flights }
        if !snapshot.discreteCounts.isEmpty {
            event["discreteCounts"] = snapshot.discreteCounts
            event["discreteValues"] = snapshot.discreteValues
        }
        return event
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
