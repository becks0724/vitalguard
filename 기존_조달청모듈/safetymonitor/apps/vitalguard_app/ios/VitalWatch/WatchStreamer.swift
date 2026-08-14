// 워치 HR 수집기 — HKWorkoutSession 으로 백그라운드 수집을 유지하고 5초 배치로 WCSession 송신한다
import Foundation
import HealthKit
import WatchConnectivity
import os

final class WatchStreamer: NSObject, ObservableObject {
    @Published var isRunning = false
    @Published var latestBPM: Double?
    @Published var latestSpO2: Double?
    @Published var latestSpO2At: Date?
    @Published var sessionEnergyKcal: Double = 0
    // 이산 측정 상태 — 실기기 게이트에서 "정말 들어오는가·몇 건인가"를 워치 화면에서 바로 본다.
    // HRV 는 표본 빈도 자체가 미지수라(작업시간 중 시간당 0~수 건 예상) 이 카운터가 판정 근거다.
    @Published var latestHrvMs: Double?
    @Published var discreteSent = 0
    @Published var batchesSent = 0
    @Published var statusText = "대기"

    private let log = Logger(subsystem: "com.vitalguard.vitalguardApp.watchkitapp", category: "WatchStreamer")
    private let healthStore = HKHealthStore()
    private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let spo2Type = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation)!
    private let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
    // 스트레스 입력 — 활동 분류용 누적 2종(걸음·오른층)과 이산 측정 4종(아래 discreteInputs).
    private let stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount)!
    private let flightsType = HKQuantityType.quantityType(forIdentifier: .flightsClimbed)!
    // 활동 에너지(온열 ①) — 이미 배치에 실어 보낸 몫. 세션 누적(sessionEnergyKcal)과의 차가 다음 증분이다.
    private var energyReportedKcal: Double = 0
    // 걸음·오른층도 같은 계약(세션 누적 − 보낸 몫 = 구간 증분).
    private var sessionSteps: Double = 0
    private var stepsReported: Double = 0
    private var sessionFlights: Double = 0
    private var flightsReported: Double = 0
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var spo2Query: HKAnchoredObjectQuery?
    private var discreteQueries: [HKAnchoredObjectQuery] = []
    private var flushTimer: Timer?
    private var pendingSamples: [[String: Any]] = []
    /// 이산 측정 대기분(키→값) — flush 에서 심박 항목에 병합한다.
    ///
    /// ★ 별도 항목으로 보내면 안 된다(2026-08-14 실측). 폰이 배치의 **모든 항목에 같은 ts**
    /// (전송 시각)를 붙이는데 서버에 `UNIQUE (worker_id, ts)` + `ON CONFLICT DO NOTHING` 이
    /// 걸려 있어, 한 배치의 두 번째 항목부터 **조용히 버려진다**. 에러도 로그도 남지 않고
    /// 워치·폰·서버가 모두 "성공"으로 보고한 채 값만 사라진다.
    /// 측정 시각은 어차피 서버 계약에 필드가 없어(심박·SpO₂ 만 보유) 병합해도 잃는 정보가 없다.
    private var pendingDiscrete: [String: Double] = [:]
    /// SpO₂ 대기분 (측정값 %, 측정 시각) — flush 에서 심박 항목에 병합한다.
    ///
    /// 이산 측정과 같은 ts 충돌 문제를 겪지만 처리가 다르다. SpO₂ 는 서버 계약에
    /// `spo2MeasuredAt` 이 있어 **측정 시각을 살려야 하는데**, 병합하면 항목의 ts 는
    /// 심박 측정 시각이 된다. 그래서 값과 시각을 함께 들고 있다가 `spo2Ts` 라는
    /// 별도 키로 실어 보낸다(폰이 그것을 spo2MeasuredAt 으로 매핑).
    ///
    /// ⚠ 한 구간에 2건 이상 오면 마지막만 남는다. SpO₂ 는 30분 게이트라 5초 배치에 겹칠 일이
    /// 거의 없고, 겹치는 경우는 앵커 재생(낡은 측정)뿐이라 실질 손실이 없다.
    private var pendingSpo2: (pct: Double, at: TimeInterval)?
    private var seq = 0

    // 스트레스 입력 중 이산 측정 4종 — Apple 이 산발적으로 기록하는 값이라 SpO₂ 와 같은
    // 앵커드 쿼리로 받는다(측정 1건 = 전송 1건).
    //
    // ⚠ 복사 전송 금지 — 구 앱은 같은 값을 5초마다 다시 실어 보내 DB 에 **가짜 밀도**를 만들었다.
    //   실측(프로덕션 DB) — 2026-07-28 하루 2,784행이 전부 `47.1ms` 한 값이었고(distinct 1),
    //   HRV 가 들어온 모든 워커·날짜가 예외 없이 distinct 1 이었다. 즉 실제 측정은 하루 1회인데
    //   행 수만 수천이라, 그 데이터로 추세를 그리면 하루 한 번 튀는 계단이 된다.
    //   여기서는 측정 시점에만 실으므로 **DB 행 수 = 실제 측정 횟수**가 된다.
    private struct DiscreteInput {
        let type: HKQuantityType
        let unit: HKUnit
        let key: String // 워치→폰 배치 키(폰 VitalPipeline 이 서버 스키마 이름으로 변환)
        let anchorKey: String
        /// 이 나이를 넘긴 표본은 버린다(nil = 나이 무관).
        ///
        /// 왜 필요한가 — 서버 계약에 `spo2MeasuredAt` 같은 '측정 시각' 필드가 이 값들에는 없어서
        /// 행의 시각이 곧 **전송 시각**이 된다. 앵커는 앱이 꺼져 있던 동안의 측정을 재실행 때
        /// 한꺼번에 돌려주므로, 그대로 실으면 **몇 시간 전 측정이 '지금'으로 찍힌다**.
        /// 순간 측정(HRV·호흡수)은 그게 곧 추세 오염이라 버리고, 일 단위 기준값
        /// (안정심박·보행심박)은 원래 하루를 대표하는 값이라 나이를 따지지 않는다.
        let maxAge: TimeInterval?
    }

    private lazy var discreteInputs: [DiscreteInput] = {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let fresh: TimeInterval = 15 * 60
        return [
            // HRV(SDNN) — 스트레스 지수에서 심박과 독립인 유일한 신호. 없으면 지수가 심박의 단조 변환이 된다.
            .init(type: HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!,
                  unit: .secondUnit(with: .milli), key: "hrv", anchorKey: "hrv.anchor", maxAge: fresh),
            // 안정심박·보행심박 — population 상수(68·95bpm)를 개인값으로 대체해 '초과심박'을 실제 초과분으로
            // 만든다. 하루 한 번 갱신되는 기준값이라 몇 시간 전에 쓰인 것도 그대로 유효하다.
            .init(type: HKQuantityType.quantityType(forIdentifier: .restingHeartRate)!,
                  unit: bpm, key: "rhr", anchorKey: "rhr.anchor", maxAge: nil),
            .init(type: HKQuantityType.quantityType(forIdentifier: .walkingHeartRateAverage)!,
                  unit: bpm, key: "whr", anchorKey: "whr.anchor", maxAge: nil),
            // 호흡수 — 가중치가 가장 낮고(0.1) Apple 은 주로 수면 중 기록한다. 수면 미착용 운용이라
            // 0건일 가능성이 크지만, 권한 시트가 어차피 다시 뜨는 김에 함께 붙여 실측으로 확정한다.
            .init(type: HKQuantityType.quantityType(forIdentifier: .respiratoryRate)!,
                  unit: bpm, key: "rr", anchorKey: "rr.anchor", maxAge: fresh),
            // 절대적 운동 강도(MET) — ACGIH/ISO 7243 은 **대사율 등급별로** WBGT 허용한계를 달리 준다.
            // 활동 kcal 은 체중이 큰 사람이 무조건 높아 작업자 간 비교가 안 되는데, 이 값은 체중으로
            // 나눈 것이라 비교가 성립한다. 워크아웃 세션과 무관하게 기록된다(HRV 같은 배타 아님 — 실측).
            .init(type: HKQuantityType.quantityType(forIdentifier: .physicalEffort)!,
                  unit: HKUnit.kilocalorie()
                      .unitDivided(by: HKUnit.hour().unitMultiplied(by: .gramUnit(with: .kilo))),
                  key: "pe", anchorKey: "pe.anchor", maxAge: fresh),
            // 일광 시간(분) — WBGT 는 직사광 유무로 공식이 갈린다(실외 0.7Tnwb+0.2Tg+0.1Ta vs 그늘 0.7Tnwb+0.3Tg).
            // 관측소 기온을 전원에게 똑같이 적용하던 환경 축을 **작업자별로** 쪼개는 유일한 워치 신호다.
            // ⚠ 소매·장갑에 광센서가 가리면 과소 추정된다(Apple 명시) — 값이 0 이어도 실외가 아니라는 뜻은 아니다.
            .init(type: HKQuantityType.quantityType(forIdentifier: .timeInDaylight)!,
                  unit: .minute(), key: "dl", anchorKey: "dl.anchor", maxAge: fresh),
        ]
    }()

    // SpO₂ 앵커 영속 — 앱 재실행에도 이미 보낸 측정을 다시 받지 않는다(측정 1건 = 전송 1건).
    private static let spo2AnchorKey = "spo2.anchor"
    private var spo2Anchor: HKQueryAnchor? {
        get { Self.loadAnchor(Self.spo2AnchorKey) }
        set { if let newValue { Self.saveAnchor(newValue, forKey: Self.spo2AnchorKey) } }
    }

    private static func loadAnchor(_ key: String) -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private static func saveAnchor(_ anchor: HKQueryAnchor, forKey key: String) {
        guard let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
        else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

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
        // ⚠ 읽기 타입을 늘리면 워치 시작 때 권한 시트가 다시 뜬다 — 사용자가 새 항목을 허용해야 하고,
        //   미허용이면 크래시 없이 그 값만 조용히 빠진다(온열 ① 실증 함정 ②).
        var toRead: Set<HKObjectType> = [hrType, spo2Type, energyType, stepsType, flightsType]
        for input in discreteInputs { toRead.insert(input.type) }
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
        sessionEnergyKcal = 0
        energyReportedKcal = 0
        sessionSteps = 0
        stepsReported = 0
        sessionFlights = 0
        flightsReported = 0
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        config.locationType = .indoor
        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            let dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            // 걸음수·오른층은 .other 워크아웃의 기본 수집 목록에 없다 — 명시로 켜야 statistics 에 잡힌다.
            // 이 둘이 활동 분류(rest/light/heavy)를 정하고, 활동 분류가 '기대 심박'을 정한다.
            dataSource.enableCollection(for: stepsType, predicate: nil)
            dataSource.enableCollection(for: flightsType, predicate: nil)
            builder.dataSource = dataSource
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
                    self.startSpO2Query()
                    self.startDiscreteQueries()
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
        // 활동 에너지(온열 ①) — 세션 누적에서 이미 보낸 몫을 뺀 5초 구간 증분만 싣는다.
        // 누적이 뒤로 가면(세션 재시작) 기준만 재설정하고 이번 구간은 건너뛴다.
        let energyDelta = sessionEnergyKcal - energyReportedKcal
        if energyDelta < 0 {
            energyReportedKcal = sessionEnergyKcal
        } else if energyDelta >= 0.01 {
            let rounded = (energyDelta * 100).rounded() / 100
            // 심박 항목이 있으면 같은 항목에 얹는다(서버 행 수 불증가) — 없으면 에너지 단독 항목.
            if let idx = pendingSamples.lastIndex(where: { $0["bpm"] is Double }) {
                pendingSamples[idx]["ae"] = rounded
            } else {
                pendingSamples.append(["ts": Date().timeIntervalSince1970, "ae": rounded])
            }
            // 반올림 잔여분을 다음 구간으로 이월한다(= 로 덮으면 잔여가 영영 유실).
            energyReportedKcal += rounded
        }
        // 걸음·오른층 — 위 에너지와 같은 '세션 누적 − 보낸 몫' 계약. 서버 계약이 정수라 내림으로 자르고
        // 소수 잔여는 다음 구간으로 이월한다(보낸 몫만 reported 에 더한다).
        appendCountDelta(session: sessionSteps, reported: &stepsReported, key: "stp")
        appendCountDelta(session: sessionFlights, reported: &flightsReported, key: "flt")
        // 이산 측정(HRV·안정심박·보행심박·호흡수·MET·일광) — 에너지·걸음과 같은 계약으로 심박 항목에
        // 얹는다. 단독 항목으로 보내면 배치 내 ts 중복으로 서버가 조용히 버린다(pendingDiscrete 주석).
        if !pendingDiscrete.isEmpty {
            if let idx = pendingSamples.lastIndex(where: { $0["bpm"] is Double }) {
                for (key, value) in pendingDiscrete { pendingSamples[idx][key] = value }
            } else {
                var item: [String: Any] = ["ts": Date().timeIntervalSince1970]
                for (key, value) in pendingDiscrete { item[key] = value }
                pendingSamples.append(item)
            }
            pendingDiscrete.removeAll()
        }
        // SpO₂ — 같은 병합 계약이되 측정 시각을 `spo2Ts` 로 따로 싣는다(항목 ts 는 심박 측정 시각이라
        // 그대로 쓰면 SpO₂ 나이가 틀어진다). 심박 항목이 없으면 종전대로 단독 항목(ts=측정 시각).
        if let spo2 = pendingSpo2 {
            if let idx = pendingSamples.lastIndex(where: { $0["bpm"] is Double }) {
                pendingSamples[idx]["spo2"] = spo2.pct
                pendingSamples[idx]["spo2Ts"] = spo2.at
            } else {
                pendingSamples.append(["ts": spo2.at, "spo2": spo2.pct])
            }
            pendingSpo2 = nil
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

    /// 정수 계약(걸음·오른층)의 구간 증분을 배치에 싣는다. 누적이 뒤로 가면(세션 재시작) 기준만 재설정한다.
    private func appendCountDelta(session: Double, reported: inout Double, key: String) {
        let delta = session - reported
        if delta < 0 {
            reported = session
            return
        }
        let whole = delta.rounded(.down)
        guard whole >= 1 else { return }
        // 심박 항목이 있으면 같은 항목에 얹는다(서버 행 수 불증가) — 없으면 단독 항목.
        if let idx = pendingSamples.lastIndex(where: { $0["bpm"] is Double }) {
            pendingSamples[idx][key] = Int(whole)
        } else {
            pendingSamples.append(["ts": Date().timeIntervalSince1970, key: Int(whole)])
        }
        reported += whole
    }

    // MARK: - 이산 측정(HRV·안정심박·보행심박·호흡수)

    private func startDiscreteQueries() {
        // 첫 실행 창은 '오늘 0시부터' — SpO₂ 의 '지금부터'와 다르다. 안정심박처럼 하루 1회 기록되는 값은
        // '지금부터'로 잡으면 오늘 이미 쓰인 값을 내일까지 못 쓴다. 하루치라 과거 폭주도 아니고,
        // 앵커가 이후 중복을 막는다.
        let startOfDay = Calendar.current.startOfDay(for: Date())
        for input in discreteInputs {
            let anchor = Self.loadAnchor(input.anchorKey)
            let predicate: NSPredicate? = anchor == nil
                ? HKQuery.predicateForSamples(withStart: startOfDay, end: nil, options: [])
                : nil
            let query = HKAnchoredObjectQuery(
                type: input.type,
                predicate: predicate,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { [weak self] _, samples, _, newAnchor, _ in
                self?.ingestDiscrete(input: input, samples: samples, anchor: newAnchor)
            }
            query.updateHandler = { [weak self] _, samples, _, newAnchor, _ in
                self?.ingestDiscrete(input: input, samples: samples, anchor: newAnchor)
            }
            healthStore.execute(query)
            discreteQueries.append(query)
        }
    }

    private func ingestDiscrete(input: DiscreteInput, samples: [HKSample]?, anchor: HKQueryAnchor?) {
        let quantities = (samples as? [HKQuantitySample]) ?? []
        DispatchQueue.main.async {
            if let anchor { Self.saveAnchor(anchor, forKey: input.anchorKey) }
            for s in quantities {
                let value = s.quantity.doubleValue(for: input.unit)
                // 0·비유한값은 서버 스키마 하한(HRV>0·심박 20↑·호흡 4↑)에서 어차피 걸러진다 — 보내지 않는다.
                guard value.isFinite, value > 0 else { continue }
                // 앵커 재생으로 돌아온 낡은 순간 측정은 버린다(위 maxAge 주석 참조).
                if let maxAge = input.maxAge, Date().timeIntervalSince(s.endDate) > maxAge { continue }
                if input.key == "hrv" { self.latestHrvMs = value }
                // 같은 구간에 같은 종류가 두 번 오면 마지막 값을 쓴다(순간 측정이라 최신이 맞다).
                self.pendingDiscrete[input.key] = (value * 100).rounded() / 100
                self.discreteSent += 1
            }
        }
    }

    // MARK: - SpO₂ (기회 측정 — 새 측정이 기록되는 순간에만 이벤트 수신 · 폴링·복사 전송 없음)

    private func startSpO2Query() {
        // 첫 실행(앵커 없음)은 지금 이후 측정만 — 과거 며칠치가 한꺼번에 배달되는 것을 막는다.
        let predicate: NSPredicate? = spo2Anchor == nil
            ? HKQuery.predicateForSamples(withStart: Date(), end: nil, options: [])
            : nil
        let query = HKAnchoredObjectQuery(
            type: spo2Type,
            predicate: predicate,
            anchor: spo2Anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, _ in
            self?.ingestSpO2(samples: samples, anchor: newAnchor)
        }
        query.updateHandler = { [weak self] _, samples, _, newAnchor, _ in
            self?.ingestSpO2(samples: samples, anchor: newAnchor)
        }
        healthStore.execute(query)
        spo2Query = query
    }

    private func ingestSpO2(samples: [HKSample]?, anchor: HKQueryAnchor?) {
        let quantities = (samples as? [HKQuantitySample]) ?? []
        DispatchQueue.main.async {
            if let anchor { self.spo2Anchor = anchor }
            for s in quantities {
                // HealthKit .percent() 는 0~1 분율 — 서버 계약(50~100)에 맞춰 ×100.
                let pct = (s.quantity.doubleValue(for: .percent()) * 100).rounded()
                self.latestSpO2 = pct
                self.latestSpO2At = s.endDate
                // 측정 시각을 함께 들고 flush 로 넘긴다 — 단독 항목으로 보내면 배치 ts 중복으로
                // 서버가 조용히 버린다(pendingSpo2 주석).
                self.pendingSpo2 = (pct, s.endDate.timeIntervalSince1970)
            }
        }
    }

    private func teardown() {
        flushTimer?.invalidate()
        flushTimer = nil
        if let spo2Query { healthStore.stop(spo2Query) }
        spo2Query = nil
        for query in discreteQueries { healthStore.stop(query) }
        discreteQueries.removeAll()
        pendingSamples.removeAll()
        pendingDiscrete.removeAll()
        pendingSpo2 = nil
        energyReportedKcal = 0
        stepsReported = 0
        flightsReported = 0
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
        if collectedTypes.contains(hrType),
           let stats = workoutBuilder.statistics(for: hrType),
           let quantity = stats.mostRecentQuantity() {
            let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            DispatchQueue.main.async {
                self.latestBPM = bpm
                self.pendingSamples.append(["ts": Date().timeIntervalSince1970, "bpm": bpm])
            }
        }
        // 활동 에너지(온열 ①) — 여기서는 세션 누적치만 갱신한다. 증분 계산·적재는 flush(5초)가 담당.
        if collectedTypes.contains(energyType),
           let sum = workoutBuilder.statistics(for: energyType)?.sumQuantity() {
            let kcal = sum.doubleValue(for: .kilocalorie())
            DispatchQueue.main.async {
                self.sessionEnergyKcal = kcal
            }
        }
        // 걸음·오른층도 누적치만 갱신(증분은 flush) — 에너지와 같은 규칙.
        if collectedTypes.contains(stepsType),
           let sum = workoutBuilder.statistics(for: stepsType)?.sumQuantity() {
            let steps = sum.doubleValue(for: .count())
            DispatchQueue.main.async { self.sessionSteps = steps }
        }
        if collectedTypes.contains(flightsType),
           let sum = workoutBuilder.statistics(for: flightsType)?.sumQuantity() {
            let flights = sum.doubleValue(for: .count())
            DispatchQueue.main.async { self.sessionFlights = flights }
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
        // 폰 PhoneReceiver 의 활성화 로그(paired·watchAppInstalled)와 대칭인 워치 쪽 한 줄.
        // 폰이 watchAppInstalled=false 로 보고하는 장부 불일치가 워치에서도 같은지 확인한다 —
        // 이 값에 걸리는 경로는 flush() 의 transferUserInfo 폴백뿐이다.
        log.notice("WC 활성화 완료 state=\(activationState.rawValue, privacy: .public) companionAppInstalled=\(session.isCompanionAppInstalled, privacy: .public)")
        if let error {
            DispatchQueue.main.async { self.statusText = "WC 활성화 실패: \(error.localizedDescription)" }
        }
    }
}
