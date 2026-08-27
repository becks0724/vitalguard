// iOS 업로드 파이프라인 — 워치 HR 배치를 로컬 큐에 영속하고 관제 서버(/api/app/vital)에 JWT 로 업로드한다
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
            // 위치 — 생체가 도착했다는 것이 곧 "근무 중"이라 여기서 추적을 살린다(별도 근무시간 개념 없음).
            // 좌표는 새 행을 만들지 않고 기존 샘플의 빈 컬럼을 채운다(행 수·요청 수 불변).
            // ⚠ 배치당 한 번만 읽는다 — 샘플마다 읽으면 같은 fix 를 반복 조회할 뿐이다.
            // nil 이면 신선한 fix 가 없다는 뜻이므로 **아무것도 싣지 않는다**(묵은 좌표 금지).
            if !samples.isEmpty { LocationProvider.shared.noteVitalsActive() }
            let fix = LocationProvider.shared.currentFix()
            for s in samples {
                let bpm = s["bpm"] as? Double
                let spo2 = s["spo2"] as? Double
                let ae = s["ae"] as? Double
                // 스트레스 입력 — 워치는 짧은 키로 보내고 여기서 서버 스키마 이름으로 바꾼다.
                let hrv = s["hrv"] as? Double
                let rhr = s["rhr"] as? Double
                let whr = s["whr"] as? Double
                let rr = s["rr"] as? Double
                let stp = s["stp"] as? Int
                let flt = s["flt"] as? Int
                // 온열 환경·강도 입력 — pe = 절대적 운동 강도(MET), dl = 일광 시간(분).
                let pe = s["pe"] as? Double
                let dl = s["dl"] as? Double
                // 무동작 지속(초) — 워치 CMMotionManager 기준. 값이 없으면 못 잰 것이지 0 이 아니다.
                let still = s["still"] as? Double
                let bat = s["bat"] as? Int
                // 세션 계측(2026-08-19 · §4-7) — sst = 세션 시작 epoch 초, sar = 자동 재개 여부.
                let sst = s["sst"] as? Double
                let sar = s["sar"] as? Int
                // 세션 **종료** 지문(2026-08-20 · docs/watch-auto-resume) — 직전 세션이 어떻게
                // 끝났는지. 새 세션 첫 배치에만 실린다.
                let seAt = s["seAt"] as? Double
                let seBy = s["seBy"] as? Int
                let srAt = s["srAt"] as? Double
                let srN = s["srN"] as? Int
                // 오류 종료의 도메인#코드(2026-08-22) — 시스템 종료의 "왜" 가 DB 에 닿는 유일한 길.
                let seErr = s["seErr"] as? String
                // 모션 변동폭(밀리g) — 착용 판별 후보 축의 재료. 판정에는 안 쓴다.
                let mv = s["mv"] as? Int
                // 워치 하드웨어 모델(2026-08-25) — 어느 기기가 보냈는지. 출처(watchos/wearos)가
                // 벤더를 가르고 이 값이 모델을 가른다.
                let wdm = s["wdm"] as? String
                // 낙상 ML 판정(2026-08-27 · 섀도) — 워치가 짧은 키로 보내고 여기서 서버 이름으로 바꾼다.
                // fcid 는 후보 상관 ID(UUID) · fph 는 단계(candidate/prompt_result) ·
                // fpo 는 결말 · frs 는 응답 시간(초) · fpg 는 피크 G · ftr 은 추적 dict.
                let fcid = s["fcid"] as? String
                let fph = s["fph"] as? String
                let fpo = s["fpo"] as? String
                let frs = s["frs"] as? Double
                let fpg = s["fpg"] as? Double
                let ftr = s["ftr"] as? [String: Any]
                // ⚠ 낙상 결말 항목은 생체가 하나도 없다 — 이 관문에 fcid 를 안 넣으면
                //   여기서 통째로 버려지고 후보 행이 영원히 미완결로 남는다.
                guard bpm != nil || spo2 != nil || ae != nil
                    || hrv != nil || rhr != nil || whr != nil || rr != nil
                    || stp != nil || flt != nil || pe != nil || dl != nil || still != nil
                    || fcid != nil
                else { continue }
                var v: [String: Any] = ["ts": sentAt]
                if let bpm {
                    v["heartRate"] = bpm
                    if let t = s["ts"] as? Double {
                        v["heartRateMeasuredAt"] = self.isoMs.string(from: Date(timeIntervalSince1970: t))
                    }
                }
                // SpO₂ 는 기회 측정 — 워치가 측정 1건당 1항목만 보내고(복사 전송 없음),
                // ts(측정 시각)를 spo2MeasuredAt 으로 실어 화면·판정이 값의 나이를 알게 한다.
                if let spo2 {
                    v["spo2"] = spo2
                    // 심박 항목에 병합돼 온 경우 측정 시각은 spo2Ts 에 따로 실린다(항목 ts 는 심박
                    // 측정 시각이라 그대로 쓰면 SpO₂ 나이가 틀어진다). 단독 항목이면 ts 가 곧 측정 시각.
                    if let t = (s["spo2Ts"] as? Double) ?? (s["ts"] as? Double) {
                        v["spo2MeasuredAt"] = self.isoMs.string(from: Date(timeIntervalSince1970: t))
                    }
                }
                // 활동 에너지(온열 ①) — 직전 배치 이후 5초 구간의 소모 증분(kcal).
                // 서버 스키마 activeEnergyKcal 의 '구간 합' 계약에 그대로 맞는다(분당 소모율은 서버 집계).
                if let ae {
                    v["activeEnergyKcal"] = ae
                }
                // 스트레스 입력 — 값이 실린 것만 붙인다(빈 필드를 0 으로 채우면 '측정했는데 0'이 된다).
                // ⚠ 워치가 측정 순간에만 싣는다(복사 전송 금지) — 여기서도 carry-forward 를 넣지 않는다.
                //   구 앱이 같은 HRV 를 5초마다 재전송해 DB 에 하루 수천 행의 가짜 밀도를 만들었다.
                if let hrv { v["hrvSdnnMs"] = hrv }
                if let rhr { v["restingHeartRate"] = rhr }
                if let whr { v["walkingHeartRate"] = whr }
                if let rr { v["respiratoryRate"] = rr }
                // 걸음·오른층은 5초 구간 증분(누적 아님) — 서버 스키마 상한(steps 5000·flights 500)은
                // 구간 값 기준이라, 하루 누적을 보내면 통째로 스트립된다.
                if let stp { v["steps"] = stp }
                if let flt { v["flightsClimbed"] = flt }
                // 온열 B안 입력 — MET 은 ACGIH TLV 의 대사율, 일광 분은 WBGT 실외/실내 분기용.
                // 일광은 '구간 합'이다(하루 누적을 보내면 걸음·오른층처럼 서버 상한에서 스트립된다).
                if let pe { v["physicalEffortMet"] = pe }
                if let dl { v["timeInDaylightMin"] = dl }
                // 무동작 지속 — 서버 스키마 `motionStillSec`. 스키마·DB 컬럼·insert 매핑은
                // 구 앱 시절부터 있었고 신규 앱이 안 보내 27,831행 중 0건이었다(2026-08-15 실측).
                if let still { v["motionStillSec"] = still }
                // 워치 배터리(2026-08-18) — `motionStillSec` 과 같은 형태의 결손이었다. 스키마·컬럼·
                // insert 가 구 앱 시절부터 있는데 신규 앱이 안 보내 10,189행 중 **0건**이었다.
                // 08-18 진단에서 긴 공백 3건이 전부 수집 정지로 확정됐는데 **방전·충전·앱 종료를
                // 가를 신호가 이것 하나뿐**이라 우선순위가 올라갔다(레벨의 시간 변화가 가른다).
                if let bat { v["batteryPct"] = bat }
                // 낙상 ML 판정 — 서버 계약이 구 앱(fall-ml) 시절부터 완비돼 있어 스키마·컬럼·insert
                // 모두 그대로 쓴다. 신규는 `fallTrace` 하나뿐(확률 3종·모듈 버전·실효Hz 보관처).
                // ⚠ **섀도 단계라 `fallDetected`·`fallDecision` 은 싣지 않는다** — 그 둘 중 하나라도
                //   실리면 서버가 양성으로 세고 recordAlert 가 텔레그램을 울린다. 오탐률을 재는
                //   동안은 경보가 나가면 안 된다. 3단계에서 워치가 그 키를 보내기 시작한다.
                if let fcid {
                    v["fallCandidateId"] = fcid
                    // 후보 행의 표식 — 서버 갱신 경로가 `fall_candidate = 1` 인 행만 찾는다.
                    v["fallCandidate"] = true
                }
                if let fph { v["fallUpdatePhase"] = fph }
                if let fpo { v["fallPromptOutcome"] = fpo }
                if let frs { v["fallPromptResponseSec"] = frs }
                // 피크 G — 기존 필드에 그대로 맞는다(서버 상한 20G).
                if let fpg { v["accelMagnitudeG"] = fpg }
                if let ftr { v["fallTrace"] = ftr }
                // 세션 계측 — `sessionStartedAt` 이 바뀌는 지점이 곧 HKWorkoutSession 재시작이고
                // `sessionAutoResumed` 가 그 주체(자동 복구 vs 사람이 [시작])를 가른다.
                // ⚠ 위 guard 에 넣지 않는다 — 이 값만으로 행을 만들면 안 된다(배터리와 같은 계약).
                if let sst {
                    v["sessionStartedAt"] = self.isoMs.string(from: Date(timeIntervalSince1970: sst))
                    if let sar { v["sessionAutoResumed"] = sar == 1 }
                }
                // 종료 지문 — **없는 것도 지문이다**(H2 = 델리게이트가 안 왔다). 그래서 키가
                // 없으면 억지로 만들지 않고 그대로 비운다. 서버는 NULL 로 받는다.
                if let seAt {
                    v["sessionEndSeenAt"] = self.isoMs.string(from: Date(timeIntervalSince1970: seAt))
                    if let seBy { v["sessionEndByUser"] = seBy == 1 }
                    if let seErr { v["sessionEndError"] = seErr }
                }
                if let srAt {
                    v["sessionResumeTriedAt"] = self.isoMs.string(from: Date(timeIntervalSince1970: srAt))
                    if let srN { v["sessionResumeTries"] = srN }
                }
                // ⚠ 위 guard 에 넣지 않는다 — 이 값만으로 행을 만들면 안 된다.
                if let mv { v["motionVariabilityMg"] = mv }
                if let wdm { v["watchDeviceModel"] = wdm }
                // 좌표 4종(위·경도·정확도·측위시각)을 한 덩어리로 얹는다. 정확도와 측위시각이 없으면
                // 관제가 값의 품질·나이를 못 재므로 좌표만 따로 싣지 않는다.
                if let fix { v.merge(fix) { current, _ in current } }
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

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            self.work.async {
                if let error {
                    self.log.warning("업로드 실패(네트워크): \(error.localizedDescription, privacy: .public) — 30초 후 재시도, 큐 \(self.pending.count, privacy: .public)건")
                    finish()
                    self.scheduleRetry(after: 30)
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? -1
                let reply = Self.parseReply(data)
                switch status {
                case 200...299:
                    self.pending.removeFirst(min(batch.count, self.pending.count))
                    self.persist()
                    self.log.notice("[UP] \(batch.count, privacy: .public)건 업로드 성공(\(status, privacy: .public)) — 서버 저장 \(reply.accepted ?? -1, privacy: .public)건, 잔여 큐 \(self.pending.count, privacy: .public)건")
                    // ★ 201 이어도 서버는 조용히 버릴 수 있다(미등록 source·검증 실패). 큐에서는 이미 지운 뒤라
                    //   이 로그가 유일한 흔적이다 — 세지 않으면 유실이 어디에도 안 남는다.
                    //   재전송하지 않는 이유 = 폐기 사유가 내용에 있어 다시 보내도 같은 결과다(무한 재시도 방지).
                    if let accepted = reply.accepted, accepted < batch.count {
                        self.log.error("[UP] ★ 서버 폐기 \(batch.count - accepted, privacy: .public)건 — 보낸 \(batch.count, privacy: .public) 저장 \(accepted, privacy: .public) · dropped=\(reply.dropped ?? -1, privacy: .public)(검증실패 \(reply.droppedInvalid ?? -1, privacy: .public))")
                    }
                    VitalBridge.shared.emit(["type": "pipeline", "pending": self.pending.count, "uploadOk": true])
                    finish()
                    // 잔여가 있으면 즉시 다음 배치.
                    self.uploadLocked()
                case 401, 403:
                    self.log.error("업로드 인증 거부(\(status, privacy: .public)) — 서버: \(reply.message ?? "(본문 없음)", privacy: .public) — 토큰 확인 필요, 5분 후 재시도")
                    VitalBridge.shared.emit(["type": "pipeline", "pending": self.pending.count, "uploadOk": false, "authRejected": true])
                    finish()
                    self.scheduleRetry(after: 300)
                default:
                    self.log.warning("업로드 실패(HTTP \(status, privacy: .public)) — 서버: \(reply.message ?? "(본문 없음)", privacy: .public) — 30초 후 재시도")
                    // 503 부분 저장은 재전송이 중복 행을 만든다(서버 route.ts 주석 참조). 빈도를 여기서 관측한다.
                    if let saved = reply.accepted, saved > 0 {
                        self.log.error("[UP] ★ 부분 저장 후 실패 — 이미 저장 \(saved, privacy: .public)건 · 저장실패 \(reply.persistFailures ?? -1, privacy: .public)건. 재전송이 중복을 만든다")
                    }
                    finish()
                    self.scheduleRetry(after: 30)
                }
            }
        }
        task.resume()
    }

    // MARK: - 서버 응답 본문

    /// 서버가 돌려준 판정 결과. 폰이 보낸 건수와 서버가 실제로 저장한 건수가 갈리는 것을 보려고 읽는다.
    /// ⚠ 생체 수치(`sample`·`last`)는 일부러 꺼내지 않는다 — 로그로 새어 나갈 이유가 없다.
    private struct ServerReply {
        var accepted: Int?
        var dropped: Int?
        var droppedInvalid: Int?
        var persistFailures: Int?
        var message: String?
    }

    /// 배치 경로 응답만 해석한다(폰은 항상 배열을 보내므로 단건 경로로 갈 일이 없다).
    /// 계약 = 201 `{ok,accepted,dropped,droppedInvalid,last}` · 503 `{ok,error,accepted,persistFailures}` · 그 외 `{ok,error}`.
    private static func parseReply(_ data: Data?) -> ServerReply {
        guard let data, !data.isEmpty,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return ServerReply() }

        var reply = ServerReply()
        reply.accepted = obj["accepted"] as? Int
        reply.dropped = obj["dropped"] as? Int
        reply.droppedInvalid = obj["droppedInvalid"] as? Int
        reply.persistFailures = obj["persistFailures"] as? Int

        // error 는 문자열이 보통이지만 400(Zod)은 객체다 — 그대로 찍으면 길어서 잘라 둔다.
        if let text = obj["error"] as? String {
            reply.message = text
        } else if let value = obj["error"],
                  let encoded = try? JSONSerialization.data(withJSONObject: value, options: []),
                  let text = String(data: encoded, encoding: .utf8) {
            reply.message = text.count > 300 ? String(text.prefix(300)) + "…(생략)" : text
        }
        return reply
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
