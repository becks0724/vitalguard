// 워치 HR 수집기 — HKWorkoutSession 으로 백그라운드 수집을 유지하고 5초 배치로 WCSession 송신한다
import CoreMotion
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
    /// 이산 측정 전송 건수 — **종류별**로 센다.
    ///
    /// 총합 하나만 보여주던 종전 표기(`HRV 대기 · 23건`)는 라벨이 HRV 인데 실제로는 6종 합계라
    /// "HRV 가 23건 대기 중"으로 읽혔다. 2026-08-14 유실 진단에서 그 23건이 무엇인지 알 수 없어
    /// 실제로 시간을 잃었다 — 화면이 답할 수 있어야 할 질문이었다.
    @Published var discreteCounts: [String: Int] = [:]
    @Published var batchesSent = 0
    @Published var statusText = "대기"

    // MARK: - 전달 채널 계측 (2026-08-14 연결끊김 진단 · 08-18 거리 시험용)
    //
    // 왜 워치 화면인가 — 시험은 "폰을 두고 워치만 들고 멀어진다" 라서, 그 순간 볼 수 있는 화면이
    // 손목뿐이다. 폰 로그(PhoneReceiver.swift:41)에 같은 정보가 있지만 읽으려면 `log collect`
    // (root 필요)를 거쳐야 하고, 그건 시험이 끝난 뒤의 일이다.
    //
    // 무엇을 보는가 — `잔량`(outstandingUserInfoTransfers)이 결정적이다. 큐가 실시간으로 쌓이는
    // 것이 눈에 보이면 "전달이 밀린다"가 추론이 아니라 관측이 된다.

    /// 폰에 즉시 도달 가능한 상태인가(`WCSession.isReachable`). 시험 B 의 독립 변인 그 자체다.
    @Published var reachable = false
    /// 처음부터 큐 채널(`transferUserInfo`)로 보낸 배치 수.
    @Published var sentQueued = 0
    /// 즉시 채널(`sendMessage`)이 실패해 큐로 다시 보낸 배치 수.
    @Published var immediateFailed = 0
    /// 아직 폰에 도달하지 않은 큐 잔량. 멀어지면 늘고 돌아오면 0 으로 떨어진다.
    @Published var pendingTransfers = 0

    private let log = Logger(subsystem: "com.vitalguard.vitalguardApp.watchkitapp", category: "WatchStreamer")

    // MARK: - 무동작 지속(motionStillSec) — 2026-08-15 신설
    //
    // 왜 필요한가 — 이 앱에는 **연속적이면서 활동 축이 맞는 신호가 하나도 없었다**(실측).
    //   활동에너지  촘촘하지만 상시 워크아웃 때문에 바닥이 분당 4.8kcal 로 고정 → 활동량을 못 말한다
    //   걸음·MET    축은 맞지만 희소(4.3%·1.2%)하고, 앉아서 하는 작업을 아예 못 잡는다
    // 이 값 하나가 두 트랙의 공통 최소 1보다 —
    //   ① 온열 활동 축 : 앉아서 작업 vs 정말 쉬는 중 (걸음이 못 가르는 것)
    //   ② 생체 미수신 판별 : 벗어둔 것인가 쓰러진 것인가 (심박 없음만으로는 같다)
    // 서버는 이미 받을 준비가 돼 있다 — 스키마 `motionStillSec` · DB 컬럼 · insert 매핑(db.ts:907)
    // 이 전부 존재하고 **워치 전송만 없었다**(08-13 이후 27,831행 중 0건).
    private let motion = CMMotionManager()
    /// 마지막으로 '움직임' 을 관측한 시각. 무동작 지속 = now − 이 값.
    private var lastMovementAt: Date?
    /// 움직임 판정 임계(g, 중력 제거된 userAcceleration 크기).
    ///
    /// ⚠ **이 프로젝트에서 우리가 정한 몇 안 되는 숫자다 — 잠정값으로 다룬다.**
    /// 다른 임계(KOSHA 작업–휴식·PSI 6/7.5·체감온도 31/33/35)는 전부 법령·문헌에서 왔는데
    /// 여기에는 근거로 삼을 표준이 없다. 0.03g 는 "정지한 기기의 센서 잡음(≈0.01g)보다는 크고,
    /// 착용자의 미세 움직임보다는 작게" 라는 성질로 고른 시작값이다.
    /// **보정 방법** = 아래 stillDebug 로그의 관측 분포를 하루치 모아 다시 고른다.
    /// 임계가 너무 낮으면 무동작이 영영 안 쌓이고, 너무 높으면 앉아서 일해도 무동작으로 잡힌다.
    private let motionMoveThresholdG = 0.03
    /// 관측용 — 콜백이 실제로 도는지, 크기 분포가 어떤지. "값이 안 온다" 를 임계 탓으로
    /// 오귀속하지 않으려면 콜백 수와 최대 크기를 따로 봐야 한다(L-67).
    private var motionUpdates = 0
    private var motionMaxG = 0.0

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
    /// 마지막 **실측** 심박을 받은 시각 — 하트비트(최신값 복사 전송)의 유효기간 판정 기준.
    ///
    /// `latestBPM` 만으로는 값이 언제 것인지 알 수 없다. 그 값은 한 번 채워지면 비지 않으므로
    /// 시각을 따로 들고 있어야 "지금도 유효한 값인가"를 물을 수 있다.
    private var latestBPMAt: Date?
    /// 하트비트 유효기간(초). 마지막 실측이 이보다 오래되면 복사 전송을 멈춘다.
    ///
    /// ★ 30초인 이유는 실측이다(2026-08-15 · 최근 7일 프로덕션 8만여 건).
    /// 정상 착용 중 실측 간격은 중앙 5초·p95 10초·**p99 24.6초**라 30초면 99% 이상을 덮어
    /// 착용 중에는 하트비트가 사실상 끊기지 않는다. 반대로 벗으면 30초 뒤 전송이 멈추고,
    /// 관제 신선도 게이트(60초 · DemoDashboard STALE_MS)와 합쳐 **90초 뒤 연결끊김**이 뜬다.
    /// 후보 15~60초를 같은 데이터로 재보니 오탐 횟수가 24건 vs 17건으로 거의 갈리지 않았고
    /// 값은 p99 를 덮는지로만 정하면 됐다. flush 주기 5초의 배수라 타이머 경계에도 안 걸린다.
    ///
    /// ⚠ 근거 수치는 **잠정**이다. 그 p99 는 "지연 0.5초 이상 = 실측" 이라는 판별기로 고른
    /// 표본에서 나왔는데, 실제 지연 분포가 0.4~4초 연속이라 복사분이 섞였을 수 있다(과대추정
    /// 방향). 깨끗한 표본은 "이 코드 설치 이후 + 확실히 착용 중" 구간뿐이라 08-18 시험에서
    /// 착용 구간을 더 확보한 뒤 확정한다. 그때까지 30초를 유지한다.
    ///
    /// ⚠⚠ 이 장치가 막는 것은 "미착용" 이 아니라 **"측정이 멈춘 뒤의 값 복사"** 다.
    /// 2026-08-15 20:00 실측 — 워치를 벗은 채 70분간 심박 68~78 이 **계속 실측으로 생성**됐다
    /// (고유값 11개·변동). 상시 워크아웃 세션이 손목 감지를 우회하므로 벗어도 측정이 이어질 수
    /// 있고, 그때는 pendingSamples 가 비지 않아 이 분기 자체가 발동하지 않는다.
    private let heartbeatMaxAge: TimeInterval = 30
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

    // 오른층 앵커 영속 — 이미 합산한 표본을 재실행 때 다시 더하지 않는다.
    private static let flightsAnchorKey = "flt.anchor"
    private var flightsAnchor: HKQueryAnchor? {
        get { Self.loadAnchor(Self.flightsAnchorKey) }
        set { if let newValue { Self.saveAnchor(newValue, forKey: Self.flightsAnchorKey) } }
    }
    private var flightsQuery: HKAnchoredObjectQuery?

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
            // ⚠ 오른층은 여기서 켜지 않는다 — 2026-08-18 부터 앵커 쿼리(startFlightsQuery)가 소스다.
            // 둘 다 켜면 같은 계단이 두 번 세어진다. 이유는 startFlightsQuery 주석 참조.
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
                    // 오른층 — 워크아웃 빌더가 .indoor 에서 안 주므로 저장소를 직접 읽는다(2026-08-18).
                    self.startFlightsQuery()
                    self.startMotionUpdates()
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
        //
        // ★★ 단 마지막 실측이 heartbeatMaxAge 를 넘으면 멈춘다. 이 조건이 없으면 워치를 벗은 뒤에도
        // 같은 값이 영원히 흐른다 — 2026-08-15 프로덕션 실측에서 **12시간 34분·8,531건이 전부
        // 102bpm** 이었다(19:06:10 의 마지막 실측 101 다음부터). 관제웹에는 그것이 실측과 구분되지
        // 않아 차트·평균·심부체온 추정·PSI 가 전부 오염됐고, 5초마다 ts 가 갱신되니 신선도 게이트도
        // 통과해 **미착용 12시간 내내 "연결됨·정상"** 으로 보였다(미수신을 정상으로 세는 것보다 나쁘다).
        //
        // 값이 오래된 것은 유실이 아니라 **측정이 없었다는 사실** 이므로, 채우지 않고 비우는 것이 맞다.
        if pendingSamples.isEmpty, let bpm = latestBPM, let at = latestBPMAt,
           Date().timeIntervalSince(at) <= heartbeatMaxAge {
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
        // 무동작 지속 — 다른 항목이 있으면 얹고(서버 행 수 불증가), 없으면 단독으로 싣는다.
        //
        // ★ 단독 전송이 이 값의 핵심 용도다. 워치를 벗어 두면 심박도 이산 측정도 안 오는데,
        //   그때 "얼마나 오래 안 움직였나" 가 바로 **벗어둔 것인지 쓰러진 것인지**를 가르는 재료다.
        //   다른 항목이 있을 때만 얹으면 정작 필요한 구간에 값이 없다.
        // ⚠ 행 수는 늘지 않는다 — 그 구간은 활동에너지가 이미 5초마다 항목을 만들고 있다.
        if let still = motionStillSec {
            if let idx = pendingSamples.indices.last {
                pendingSamples[idx]["still"] = still
            } else {
                pendingSamples.append(["ts": Date().timeIntervalSince1970, "still": still])
            }
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
                DispatchQueue.main.async { self?.noteFallback() }
            }
            noteSent(queued: false)
        } else {
            wc.transferUserInfo(payload)
            noteSent(queued: true)
        }
    }

    private func noteSent(queued: Bool) {
        batchesSent += 1
        if queued { sentQueued += 1 }
        refreshLinkState()
    }

    /// 즉시 채널이 실패해 큐로 다시 보낸 건. `batchesSent` 는 여기서 올리지 않는다 —
    /// flush 1회 = 전송 1회이고, 종전에는 실패 경로에서 한 번 더 올려 **실패한 flush 만 2회로**
    /// 세어졌다(진단 계기가 스스로 틀린 수를 보이던 자리).
    private func noteFallback() {
        immediateFailed += 1
        refreshLinkState()
    }

    /// 링크 상태 갱신 — 전송 시점(5초)에만 읽는다. 별도 타이머를 두지 않는다.
    private func refreshLinkState() {
        let wc = WCSession.default
        reachable = wc.isReachable
        pendingTransfers = wc.outstandingUserInfoTransfers.count
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

    // MARK: - 무동작 지속

    /// `CMMotionManager` 의 deviceMotion 을 1Hz 로 받아 '마지막 움직임 시각' 만 갱신한다.
    ///
    /// **왜 deviceMotion 인가** — `userAcceleration` 은 중력이 제거된 값이라 기기 자세와 무관하다.
    /// 원시 가속도를 쓰면 손목 각도만 바꿔도 1g 가 축 사이를 옮겨 다녀 움직임처럼 보인다.
    ///
    /// **왜 `CMMotionActivityManager`(Apple 의 stationary 분류)가 아닌가** — 그쪽이 "우리가 정한
    /// 숫자 0개" 라는 이 레포의 규율에는 더 맞지만 ⓐ `NSMotionUsageDescription` 권한 시트가 새로
    /// 뜨고 **미허용 시 값이 조용히 사라진다**(온열 ① 실증 함정) ⓑ 전이 기반이라 초 단위 지속을
    /// 못 준다. 지속 시간이 이 값의 존재 이유라 deviceMotion 을 택했다.
    /// 임계 보정이 실패하면 그때 재검토한다.
    ///
    /// **배터리** — 1Hz 는 워크아웃이 이미 돌리는 센서에 얹히는 수준이나 **실측 전에는 모른다.**
    /// 현행 6.46%/h 대비 악화가 있는지 설치 후 1시간 관찰이 필요하다(SETUP.md 배터리 절).
    private func startMotionUpdates() {
        guard motion.isDeviceMotionAvailable else {
            log.warning("deviceMotion 미지원 — 무동작 지속 수집 없음")
            return
        }
        motionUpdates = 0
        motionMaxG = 0
        lastMovementAt = Date()
        motion.deviceMotionUpdateInterval = 1.0
        motion.startDeviceMotionUpdates(to: .main) { [weak self] dm, _ in
            guard let self, let dm else { return }
            let a = dm.userAcceleration
            let mag = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            self.motionUpdates += 1
            if mag > self.motionMaxG { self.motionMaxG = mag }
            if mag >= self.motionMoveThresholdG { self.lastMovementAt = Date() }
        }
    }

    /// 무동작 지속(초). 콜백이 한 번도 안 돌았으면 **0 이 아니라 nil** 이다 —
    /// "안 움직였다" 와 "못 쟀다" 를 같은 값으로 보내면 판정이 오염된다(온열 ② 가 겪은 그 함정).
    private var motionStillSec: Double? {
        guard motionUpdates > 0, let at = lastMovementAt else { return nil }
        return (Date().timeIntervalSince(at) * 10).rounded() / 10
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
                self.discreteCounts[input.key, default: 0] += 1
            }
        }
    }

    // MARK: - 오른층(계단) — 워크아웃 빌더가 아니라 HealthKit 저장소를 직접 읽는다

    /// 왜 빌더가 아닌가 (2026-08-18 실측).
    ///
    /// 신규 앱은 오른층을 `HKLiveWorkoutBuilder.statistics(for:)` 로 읽었는데 **DB 도착이 0건**이었다
    /// (구 앱 시절엔 왔다 · 마지막 08-01). 같은 구간 걸음은 1,132건 정상이고 두 경로는 코드가 완전
    /// 대칭인데 결과만 갈렸다. 유력한 원인은 워크아웃 구성이 `locationType = .indoor` 라 HealthKit 이
    /// **고도 기반 지표를 수집 대상에서 빼는 것**이다(걸음은 실내에서도 수집되므로 온다).
    ///
    /// ⚠ `locationType` 을 바꾸는 쪽은 택하지 않았다 — 워크아웃 구성 위에 폰 강제종료·잠금 생존이
    /// 얹혀 있어 건드리면 그 축이 흔들린다. **읽는 경로만 바꾸면 부작용이 없다.**
    ///
    /// 왜 구 앱 코드를 그대로 안 가져왔나 — 구 앱은 `sum(window: 86400)`, 즉 **하루 누계**를 보냈다.
    /// 이 앱의 계약은 **5초 구간 증분**이고(`appendCountDelta`), 하루 누계를 실으면 서버 상한(500)에서
    /// 스트립된다. 서버 스키마의 `NON_SAFETY_STRIPPABLE_KEYS` 주석이 그 사고를 기록해 두고 있다
    /// ("수집 창 정의 불일치(하루 누적 vs 60초 합)"). 그래서 **앵커 쿼리로 새 표본만 합산**한다 —
    /// 앵커가 "이미 본 것"을 기억하므로 창 중복 없이 증분이 된다.
    ///
    /// ★ 워치 표본만 더한다 — 워치 HealthKit 에는 **아이폰이 기록한 계단도 동기화**된다. 아이폰도
    /// 기압계가 있어 같은 계단을 따로 세므로, 거르지 않으면 이중 계상되거나 폰만 들고 이동한 것이
    /// 워치 활동으로 잡힌다. 이 필터는 구 앱 `StressInputsReader.isAppleWatchSample` 에서 가져왔다.
    private func startFlightsQuery() {
        // 첫 실행(앵커 없음)은 지금 이후 표본만 — 과거 며칠치가 한꺼번에 합산되는 것을 막는다(SpO₂와 같은 가드).
        let predicate: NSPredicate? = flightsAnchor == nil
            ? HKQuery.predicateForSamples(withStart: Date(), end: nil, options: [])
            : nil
        let query = HKAnchoredObjectQuery(
            type: flightsType,
            predicate: predicate,
            anchor: flightsAnchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, _ in
            self?.ingestFlights(samples: samples, anchor: newAnchor)
        }
        query.updateHandler = { [weak self] _, samples, _, newAnchor, _ in
            self?.ingestFlights(samples: samples, anchor: newAnchor)
        }
        healthStore.execute(query)
        flightsQuery = query
    }

    private func ingestFlights(samples: [HKSample]?, anchor: HKQueryAnchor?) {
        let quantities = (samples as? [HKQuantitySample]) ?? []
        DispatchQueue.main.async {
            if let anchor { self.flightsAnchor = anchor }
            for s in quantities {
                guard Self.isAppleWatchSample(s) else { continue }
                let v = s.quantity.doubleValue(for: .count())
                guard v.isFinite, v > 0 else { continue }
                // 누적만 갱신한다 — 증분은 flush 의 appendCountDelta 가 뽑는다(걸음·에너지와 같은 계약).
                self.sessionFlights += v
            }
        }
    }

    /// 이 표본을 애플워치가 기록했는가. 구 앱 `StressInputsReader.isAppleWatchSample` 이식.
    private static func isAppleWatchSample(_ sample: HKSample) -> Bool {
        if sample.device?.name?.localizedCaseInsensitiveContains("Apple Watch") == true { return true }
        if sample.device?.manufacturer?.localizedCaseInsensitiveContains("Apple") == true,
           sample.device?.model?.localizedCaseInsensitiveContains("Watch") == true { return true }
        if sample.device?.model?.localizedCaseInsensitiveContains("Watch") == true { return true }
        // device 가 비어 있는 표본도 있다 — 그때는 출처 이름으로 가른다.
        let name = sample.sourceRevision.source.name.lowercased()
        return name.contains("watch")
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
        // 무동작 지속 — 센서를 끄고 기준점도 버린다. 남겨 두면 재시작 직후 세션 밖의 정지 시간이
        // 이어져 찍힌다(하트비트 기준점을 버리는 것과 같은 이유).
        if motion.isDeviceMotionActive { motion.stopDeviceMotionUpdates() }
        log.notice("무동작 수집 종료 — 콜백 \(self.motionUpdates, privacy: .public)회 · 최대 \(String(format: "%.3f", self.motionMaxG), privacy: .public)g (임계 \(String(format: "%.2f", self.motionMoveThresholdG), privacy: .public)g · 임계 보정 근거)")
        lastMovementAt = nil
        motionUpdates = 0
        motionMaxG = 0
        if let spo2Query { healthStore.stop(spo2Query) }
        spo2Query = nil
        if let flightsQuery { healthStore.stop(flightsQuery) }
        flightsQuery = nil
        for query in discreteQueries { healthStore.stop(query) }
        discreteQueries.removeAll()
        pendingSamples.removeAll()
        pendingDiscrete.removeAll()
        pendingSpo2 = nil
        // 세션이 끝나면 하트비트 기준점도 버린다 — 남겨 두면 재시작 직후 실측이 오기도 전에
        // 옛 값이 다시 흐른다(`latestBPM` 은 화면 표시용이라 그대로 둔다).
        latestBPMAt = nil
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
                // 실측이 들어온 시각 — 하트비트 유효기간의 기준점(여기서만 갱신된다).
                self.latestBPMAt = Date()
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
        // ⚠ 오른층은 여기서 읽지 않는다 — startFlightsQuery 가 sessionFlights 를 채운다(2026-08-18).
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
        DispatchQueue.main.async { self.refreshLinkState() }
        if let error {
            DispatchQueue.main.async { self.statusText = "WC 활성화 실패: \(error.localizedDescription)" }
        }
    }

    /// 도달 가능 여부가 바뀌는 순간 — 5초 flush 를 기다리지 않고 화면에 즉시 반영한다.
    /// 08-18 거리 시험에서 "몇 걸음에서 끊기는가"를 손목으로 보기 위한 것이다.
    func sessionReachabilityDidChange(_ session: WCSession) {
        log.notice("WC 도달 변화 reachable=\(session.isReachable, privacy: .public)")
        DispatchQueue.main.async { self.refreshLinkState() }
    }
}
