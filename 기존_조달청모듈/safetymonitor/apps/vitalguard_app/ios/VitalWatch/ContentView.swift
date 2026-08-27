// 워치 메인 화면 — 1면 생체(심박 추이·요약) · 2면 설정(수집·낙상 테스트·자가검증)
//
// ★ 2026-08-27 재배치. 종전에는 글자 줄을 세로로 쌓았는데, 낙상 기능이 붙으면서 줄이 늘어
//   **[중지]·[ML 자가검증] 버튼이 화면 밖으로 밀려 눌 수 없었다**(사용자 제보).
//   ⚠ 원인은 줄 수만이 아니다 — 바깥이 `VStack` 이라 넘친 만큼이 **잘려서 스크롤도 안 됐다**.
//     그래서 각 면을 `ScrollView` 로 감싼다. 면을 나누는 것만으로는 같은 사고가 재발한다.
// ★ 동작 버튼은 크라운으로 내려가는 2면에 모았다(사용자 결정) — 손목에서 늘 보는 것은
//   생체이고, 수집 시작/중지는 하루에 두어 번 누르는 것이다.
// ⚠ 심박 그래프에 상태색(정상/주의/위험)을 쓰지 않는다 — 워치에는 판정 임계가 없고,
//   여기서 새로 정의하면 근거 문서 없는 의학 판정이 기기마다 갈린다(폰 `vital_range.dart`
//   가 같은 이유로 임계 자체 정의를 금지한다). 판정은 폰·관제웹이 한다.
import Combine
import SwiftUI

struct ContentView: View {
    @StateObject private var streamer = WatchStreamer()
    /// 낙상 ML 자가검증 결과(6줄). nil = 아직 안 돌림.
    @State private var selfCheckResult: String?
    /// [중지] 확인 시트 표시 여부.
    ///
    /// ★ 2026-08-20 — 세션이 "사용자가 끝냈다" 로 표시된 채 끝났는데 **사용자는 누른 적이
    ///   없었다**. `stop()` 의 유일한 호출부가 이 버튼이라 오탭이 유력한 후보다.
    ///   수집 중단은 되돌리기 어려운 동작인데(자동 재개가 안 걸리면 사람이 알아챌 때까지 멎는다)
    ///   지금은 탭 한 번이면 끝난다. **[시작] 에는 확인을 걸지 않는다** — 켜는 쪽은 오탭이어도
    ///   손해가 없고, 급할 때 한 번에 켜지는 편이 낫다.
    @State private var confirmingStop = false
    @State private var page = Page.vitals
    @State private var now = Date()
    private let clockTick = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    /// 크라운을 내리는 순서. 생체 → 종류별 상세 → 마지막이 설정이다.
    /// ⚠ 설정을 맨 끝에 둔다 — 손목에서 늘 보는 것은 생체이고, 동작 버튼은 하루 두어 번이다.
    private enum Page: Hashable {
        case vitals
        case heartRate
        case spo2
        case energy
        case transmit
        case settings
    }

    /// 그래프가 실제로 덮은 시간. "1시간" 이라 적어 두고 3분치를 그리면 화면이 거짓말한다.
    private var windowLabel: String {
        guard let first = streamer.recentBPM.first, let last = streamer.recentBPM.last,
              streamer.recentBPM.count >= 2 else { return "수집 중" }
        let minutes = Int(last.at.timeIntervalSince(first.at) / 60)
        return minutes >= 60 ? "최근 \(minutes / 60)시간" : "최근 \(max(minutes, 1))분"
    }

    var body: some View {
        TabView(selection: $page) {
            vitalsPage.tag(Page.vitals)
            heartRatePage.tag(Page.heartRate)
            spo2Page.tag(Page.spo2)
            energyPage.tag(Page.energy)
            transmitPage.tag(Page.transmit)
            settingsPage.tag(Page.settings)
        }
        .tabViewStyle(.verticalPage)
        .confirmationDialog("수집을 중지할까요?", isPresented: $confirmingStop) {
            Button("중지", role: .destructive) { streamer.stop() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("중지하면 자동으로 다시 켜지지 않습니다.")
        }
        // 낙상 카운트다운 — 화면을 덮는다. 쓰러진 사람이 목록을 스크롤해 버튼을 찾을 수는 없다.
        // ⚠ TabView 바깥에 건다 — 어느 면에 있든 덮어야 한다.
        .overlay {
            if streamer.fallCountdownActive { FallCountdownOverlay(streamer: streamer) }
        }
    }

    // MARK: - 1면 · 생체

    /// 1면 — 애플워치 울트라 메인 페이스 배치를 옮긴 것(사용자 제공 참고 화면).
    ///
    /// 좌·우 세로 눈금 = 심박 · HRV · 가운데 큰 값 = 지금 심박(참고 화면의 시계 자리) ·
    /// 그 아래 띠 = 실시간 심박 그래프(참고 화면의 나침반 띠 자리) · 하단 원 3개 = SpO₂·활동·HRV.
    ///
    /// ⚠ **참고 화면의 스트레스·피부온·생리적 부담은 안 넣었다.** 워치는 스트레스 점수도
    ///   PSI 도 계산하지 않고(서버가 한다) 손목 온도는 수집조차 안 한다. 폰→워치 수신 경로도
    ///   없어서 서버 계산값을 가져올 방법이 지금은 없다. 없는 값에 게이지를 씌우면 화면이
    ///   거짓말을 하므로 **워치가 실제로 가진 값**(심박·SpO₂·활동·HRV)으로 채웠다(사용자 결정).
    /// ⚠ 눈금 범위는 **표시용**이지 판정이 아니다 — 색으로 상태를 말하지 않는다(워치엔 임계가 없다).
    private var vitalsPage: some View {
        // ⚠ `ignoresSafeArea` 가 없으면 위아래에 시계용 여백이 그대로 남아 화면의 1/4 을 버린다
        //   (사용자 실측 지적). 눈금 띠가 화면 끝까지 가야 페이스처럼 읽힌다.
        ZStack {
            // 베젤 눈금 — 화면 곡선을 따라 돈다(울트라 페이스의 그 눈금자).
            BezelScale(
                title: "HR",
                value: streamer.latestBPM,
                range: 30...170,
                zone: WatchVitalZone.heartRate,
                side: .leading
            )
            // ⚠ 오른쪽은 HRV 가 아니라 SpO₂ 다 — HRV 에는 근거 있는 임계가 없어 구간을 못 준다.
            //   구간 표시를 요청받은 자리라 **임계가 있는 값**을 놓는다. HRV 는 아래 원에 남는다.
            BezelScale(
                title: "SpO₂",
                value: streamer.latestSpO2,
                range: 85...100,
                zone: WatchVitalZone.spo2,
                side: .trailing
            )

            VStack(spacing: 4) {
                // ⚠ 위쪽 Spacer 를 두지 않는다 — 두면 내용이 세로 가운데로 몰려 상단이 빈다.
                //   시계와 HR 은 한 덩어리로 붙여 화면 맨 위에 올린다(사용자 요청).
                VStack(spacing: 0) {
                    // 시계를 가운데로 — 시스템 시계는 숨기고 직접 그린다.
                    Text(Self.clock(now))
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(VitalGuardWatchPalette.ink)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text("HR")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(VitalGuardWatchPalette.ink)
                        Text(streamer.latestBPM.map { String(format: "%.0f", $0) } ?? "--")
                            .font(.system(size: 40, weight: .bold, design: .rounded))
                            // ★ 큰 값은 지금 구간의 색을 쓴다 — 화면에서 가장 큰 글자가 상태를
                            //   숨기면 안 된다. 값이 없으면 기본 녹색이다.
                            .foregroundStyle(
                                streamer.latestBPM.map { WatchVitalZone.heartRate($0).color }
                                    ?? VitalGuardWatchPalette.inkStrong
                            )
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                        Text("bpm")
                            .font(.system(size: 12))
                            .foregroundStyle(VitalGuardWatchPalette.ink)
                    }
                }
                .padding(.top, 2)

                VStack(spacing: 1) {
                    HeartRateSparkline(points: streamer.recentBPM)
                        .frame(height: 58)
                    // ★ x축 눈금 — 가로가 무엇인지 안 적으면 폭이 몇 분인지 알 수 없다.
                    timeAxis
                }
                .padding(.horizontal, 5)
                .padding(.vertical, 3)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))

                HStack(spacing: 6) {
                    CircleStat(
                        label: "SpO₂",
                        value: streamer.latestSpO2,
                        range: 85...100,
                        unit: "%",
                        digits: 0,
                        tint: streamer.latestSpO2.map { WatchVitalZone.spo2($0).color }
                            ?? VitalGuardWatchPalette.ink
                    )
                    CircleStat(
                        label: "활동",
                        value: streamer.sessionEnergyKcal > 0 ? streamer.sessionEnergyKcal : nil,
                        // ⚠ 세션 누적이라 자연스러운 상한이 없다 — 고리를 채우지 않고 숫자만 적는다.
                        //   없는 상한을 지어내면 "얼마나 찼는가" 가 거짓이 된다.
                        range: nil,
                        unit: "kcal",
                        // ⚠ 활동·HRV 는 근거 있는 임계가 없다 — 상태색을 안 쓰고 기본 녹색이다.
                        //   여기에 색을 주면 없는 판정을 화면이 말하게 된다.
                        digits: 1,
                        tint: VitalGuardWatchPalette.inkStrong
                    )
                    CircleStat(
                        label: "HRV",
                        value: streamer.latestHrvMs,
                        range: 0...150,
                        unit: "ms",
                        digits: 0,
                        tint: VitalGuardWatchPalette.inkStrong
                    )
                }

                if streamer.isRunning {
                    Text("수집 중 · 크라운을 내리면 상세")
                        .font(.system(size: 10))
                        .foregroundStyle(VitalGuardWatchPalette.ink)
                } else {
                    Button {
                        page = .settings
                    } label: {
                        Text("수집 OFF · 눌러서 시작")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.orange)
                    }
                    .buttonStyle(.plain)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 4)
        }
        .ignoresSafeArea()
        // ★ 시스템 시계를 숨기고 위 가운데에 직접 그린다(사용자 결정 · 울트라 페이스 배치).
        //
        // ⚠ **`_statusBarHidden` 은 밑줄로 시작하는 비공식 API 다.** 공개 `statusBarHidden(_:)`
        //   은 `@available(watchOS, unavailable)` 이고, 워치에서 되는 것은 이 밑줄 쪽뿐이다
        //   (WatchOS.sdk SwiftUI.swiftinterface 실측 · watchOS 6.0+). 문서화돼 있지 않으므로
        //   **애플이 언제든 없애거나 동작을 바꿀 수 있다.**
        //
        // ⚠ **고장 증상을 미리 적어 둔다** — 아래 둘 중 하나가 보이면 이 줄부터 의심한다.
        //   ① 시계가 **둘** 보인다 → 모디파이어가 안 먹었다(시스템 시계가 살아났다).
        //   ② 시계가 **하나도** 없다 → 아래 `Text(Self.clock(now))` 이 지워졌다.
        //   되돌리는 법 = 이 줄과 그 `Text` 를 **함께** 지운다. 하나만 지우면 위 두 증상이 된다.
        //   그 짝은 가드가 단언한다(2026-08-27-watch-status-bar-pair.guard.test.ts).
        ._statusBarHidden(true)
        .onReceive(clockTick) { now = $0 }
    }

    /// 그래프 아래 시각 눈금. 점이 모자라면 아무것도 안 적는다 — 축만 있고 값이 없으면
    /// 그 폭이 얼마인지 화면이 답하지 못한다.
    private var timeAxis: some View {
        HStack(spacing: 0) {
            if let first = streamer.recentBPM.first, let last = streamer.recentBPM.last,
               streamer.recentBPM.count >= 2 {
                Text(Self.clock(first.at))
                Spacer(minLength: 0)
                Text(Self.clock(Date(timeIntervalSince1970:
                    (first.at.timeIntervalSince1970 + last.at.timeIntervalSince1970) / 2)))
                Spacer(minLength: 0)
                Text(Self.clock(last.at))
            } else {
                Text(" ")
            }
        }
        .font(.system(size: 9))
        .foregroundStyle(VitalGuardWatchPalette.ink)
    }

    private static func clock(_ date: Date) -> String {
        date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute())
    }

    // MARK: - 상세 면들

    /// 심박 상세 — 참고 디자인의 첫 카드. 큰 값 · 추이 · 최저/최고.
    /// ⚠ 최저·최고는 **그래프가 덮은 창 안**의 값이지 하루치가 아니다. 창을 라벨에 적는다.
    private var heartRatePage: some View {
        let values = streamer.recentBPM.map(\.bpm)
        return VitalDetailPage(
            title: "심박 · \(windowLabel)",
            symbol: "heart.fill",
            tint: .red,
            value: streamer.latestBPM.map { String(format: "%.0f", $0) } ?? "--",
            unit: "bpm",
            left: ("최저", values.min().map { String(format: "%.0f", $0) } ?? "--"),
            right: ("최고", values.max().map { String(format: "%.0f", $0) } ?? "--")
        ) {
            HeartRateSparkline(points: streamer.recentBPM)
                .frame(height: 44)
        }
    }

    /// SpO₂ 상세 — 기회 측정이라 상시 값이 아니다. 언제 잰 것인지가 값만큼 중요하다.
    private var spo2Page: some View {
        VitalDetailPage(
            title: "산소포화도",
            symbol: "drop.fill",
            tint: .cyan,
            value: streamer.latestSpO2.map { "\(Int($0))" } ?? "--",
            unit: "%",
            left: (
                "측정 시각",
                streamer.latestSpO2At?.formatted(date: .omitted, time: .shortened) ?? "--"
            ),
            right: ("수신", "\(streamer.discreteCounts["spo2"] ?? 0)건")
        ) {
            // ⚠ 추이를 안 그린다 — 기회 측정이라 점 사이 간격이 제멋대로고, 선으로 이으면
            //   측정하지 않은 구간을 측정한 것처럼 보이게 한다.
            Text("기회 측정 — 워치가 잴 때만 들어옵니다")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// 활동 에너지 상세 — 세션 누적. 온열 ① 의 현장 검증용 값이다.
    private var energyPage: some View {
        VitalDetailPage(
            title: "활동 에너지",
            symbol: "flame.fill",
            tint: .orange,
            value: streamer.sessionEnergyKcal > 0
                ? String(format: "%.1f", streamer.sessionEnergyKcal)
                : "--",
            unit: "kcal",
            left: ("이번 세션", streamer.isRunning ? "수집 중" : "정지"),
            right: nil
        ) {
            // 이산 측정은 여기 얹는다 — 종류별 건수는 "정말 들어오는가" 의 판정 근거다.
            DiscreteCountsGrid(
                counts: streamer.discreteCounts,
                hrvMs: streamer.latestHrvMs
            )
        }
    }

    /// 전달 상세 — 08-18 거리 시험의 판정 근거. 폰이 멀어지면 여기 숫자가 먼저 움직인다.
    private var transmitPage: some View {
        VitalDetailPage(
            title: "전달",
            symbol: "antenna.radiowaves.left.and.right",
            tint: streamer.reachable ? .green : .orange,
            value: "\(streamer.batchesSent)",
            unit: "배치",
            left: ("연결", streamer.reachable ? "도달" : "단절"),
            right: ("잔량", "\(streamer.pendingTransfers)건")
        ) {
            let queued = streamer.sentQueued + streamer.immediateFailed
            Text(queued > 0 ? "큐 \(queued)건 — 즉시 전달이 밀리는 중" : "즉시 전달 정상")
                .font(.system(size: 10))
                .foregroundStyle(queued > 0 ? .orange : .secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - 마지막 면 · 설정

    private var settingsPage: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text("설정")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    if streamer.isRunning { confirmingStop = true } else { streamer.start() }
                } label: {
                    Label(
                        streamer.isRunning ? "수집 중지" : "수집 시작",
                        systemImage: streamer.isRunning ? "stop.fill" : "play.fill"
                    )
                    .font(.system(size: 14, weight: .semibold))
                    .frame(maxWidth: .infinity)
                }
                .tint(streamer.isRunning ? .red : .green)

                // 낙상 카운트다운 테스트 — **감지(ML)는 안 거치고** 카운트다운 화면·햅틱·취소
                // 경로만 사람이 확인하는 자리다. 감지까지 보려면 아래 [ML 자가검증] 이 그 자리다.
                Button {
                    streamer.startFallCountdownTest()
                } label: {
                    Label("낙상 카운트다운 테스트", systemImage: "figure.fall")
                        .font(.system(size: 12))
                        .frame(maxWidth: .infinity)
                }
                .tint(.orange)
                .disabled(streamer.fallCountdownActive)

                // 낙상 ML 자가검증 — 모듈이 정한 탑재 확인 절차(6줄 전부 ✅ 여야 탑재 성공).
                // 표본율이 모자라면 판정이 조용히 안 도는 구조라, 눈으로 확인할 자리가 반드시 필요하다.
                Button("ML 자가검증") { selfCheckResult = MLSelfCheck.run() }
                    .font(.system(size: 12))

                if let selfCheckResult {
                    Text(selfCheckResult)
                        .font(.system(size: 11, design: .monospaced))
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 2)
        }
    }
}


// MARK: - 생체 상세 면 부품
//
// 참고 디자인(사용자 제공)의 카드 = 라벨 · 큰 값 · 가운데 시각화 · 하단 두 칸.
// ⚠ **가진 값만 페이지로 만든다.** 참고 이미지에는 혈압·호흡수 카드가 있지만 워치는
//   혈압을 아예 못 재고, 호흡은 값이 아니라 **수신 건수**만 있다. 없는 값을 카드로 만들면
//   화면이 거짓말을 한다 — 이 앱이 여러 번 지켜 온 규칙이다.
// ⚠ 참고 디자인의 `Measure` 버튼도 안 넣는다. 우리 앱은 온디맨드 측정을 못 하고, 눌러도
//   아무 일이 없는 버튼은 "고장" 으로 읽힌다.
// ⚠ 별도 파일로 두지 않았다 — 이 프로젝트는 파일을 pbxproj 에 일일이 등록하는 방식이라
//   새 파일은 타깃에 자동으로 안 들어간다(실제로 "cannot find in scope" 로 겪었다).

/// 상세 한 면의 공통 틀. 종류마다 가운데만 다르다.
struct VitalDetailPage<Middle: View>: View {
    let title: String
    let symbol: String
    let tint: Color
    /// 큰 값. 없으면 `--` 를 넣는다(칸을 지우지 않는다).
    let value: String
    let unit: String
    /// 하단 두 칸 — (라벨, 값). nil 이면 그 칸을 안 그린다.
    let left: (label: String, value: String)?
    let right: (label: String, value: String)?
    @ViewBuilder let middle: Middle

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 4) {
                    Image(systemName: symbol)
                        .font(.system(size: 11))
                        .foregroundStyle(tint)
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                }

                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(value)
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(tint)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(unit)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                middle

                if left != nil || right != nil {
                    HStack(spacing: 4) {
                        if let left { VitalSubStat(label: left.label, value: left.value) }
                        if let right { VitalSubStat(label: right.label, value: right.value) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 2)
        }
    }
}

/// 하단 보조 칸. 참고 디자인의 두 칸을 옮긴 것이다.
struct VitalSubStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 1) {
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 3)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// 이산 측정 종류별 건수 — 값이 아니라 **건수**다. 라벨에 그렇게 적는다.
///
/// ⚠ 0 건인 종류는 칸을 안 만든다. 이 앱의 기존 규칙이고, "0 건" 을 늘어놓으면 진짜로
///   안 들어오는 종류가 묻힌다(2026-08-14 유실 진단에서 실제로 시간을 잃었다).
struct DiscreteCountsGrid: View {
    let counts: [String: Int]
    let hrvMs: Double?

    private static let labels: [(key: String, name: String)] = [
        ("pe", "강도"), ("dl", "일광"), ("rhr", "안정"), ("whr", "보행"), ("rr", "호흡"),
    ]

    private var rows: [(String, String)] {
        var out = Self.labels.compactMap { item -> (String, String)? in
            guard let n = counts[item.key], n > 0 else { return nil }
            return (item.name, "\(n)건")
        }
        if let hrvMs {
            out.append(("HRV", String(format: "%.0fms", hrvMs)))
        } else if let n = counts["hrv"], n > 0 {
            out.append(("HRV", "\(n)건"))
        }
        return out
    }

    var body: some View {
        if rows.isEmpty {
            Text("아직 도착한 이산 측정이 없습니다")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        } else {
            VStack(spacing: 3) {
                ForEach(Array(stride(from: 0, to: rows.count, by: 2)), id: \.self) { index in
                    HStack(spacing: 4) {
                        VitalSubStat(label: rows[index].0, value: rows[index].1)
                        if index + 1 < rows.count {
                            VitalSubStat(label: rows[index + 1].0, value: rows[index + 1].1)
                        } else {
                            Color.clear.frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        }
    }
}

/// 워치 표시용 구간 판정.
///
/// ⚠ **임계를 여기서 새로 만들지 않는다.** 값은 관제웹 `apps/dashboard-web/lib/severity.ts`
///   (= 폰 `lib/vital_range.dart`)와 같은 출처다. 두 곳이 갈리면 손목과 관제가 다른 말을 하고,
///   오경보의 책임 소재가 사라진다.
/// ⚠ **근거 있는 임계는 심박·SpO₂ 뿐이다.** HRV·활동 에너지에는 문헌 임계가 없어 구간을
///   주지 않는다 — 없는 판정을 색으로 지어내지 않는다.
/// ⚠ 활동 게이트가 없어 **안정 기준**이다 — 작업 중 상승이 주의로 뜰 수 있다(폰과 같은 한계).
enum WatchVitalZone {
    case normal
    case caution
    case danger

    /// severity.ts `heartRateStatus`(활동 미지정) · 위험 ≥130·≤40 · 주의 ≥110·≤50 · 정상 51–109
    static func heartRate(_ bpm: Double) -> WatchVitalZone {
        if bpm >= 130 || bpm <= 40 { return .danger }
        if bpm >= 110 || bpm <= 50 { return .caution }
        return .normal
    }

    /// severity.ts `spo2Status` · 위험 <88 · 주의 88–91 · 정상 ≥92
    static func spo2(_ pct: Double) -> WatchVitalZone {
        if pct < 88 { return .danger }
        if pct < 92 { return .caution }
        return .normal
    }

    var color: Color {
        switch self {
        case .normal: VitalGuardWatchPalette.normal
        case .caution: VitalGuardWatchPalette.caution
        case .danger: VitalGuardWatchPalette.danger
        }
    }
}

/// 손목 화면 색. 기본 글자는 녹색 계열이고(사용자 결정) 상태색은 **판정에만** 쓴다.
/// ⚠ 정상 구간 색과 기본 글자 색을 같은 값으로 두지 않는다 — 같으면 "정상이라 초록" 인지
///   "그냥 글자라 초록" 인지 구별이 안 된다. 기본은 낮은 채도, 정상은 선명한 초록이다.
enum VitalGuardWatchPalette {
    /// 기본 글자 — 라벨·단위·안내.
    static let ink = Color(red: 0.44, green: 0.86, blue: 0.62)
    /// 큰 값처럼 눈이 먼저 가는 자리.
    static let inkStrong = Color(red: 0.30, green: 0.95, blue: 0.58)
    static let normal = Color(red: 0.06, green: 0.85, blue: 0.44)
    static let caution = Color(red: 0.98, green: 0.70, blue: 0.10)
    static let danger = Color(red: 0.98, green: 0.28, blue: 0.24)
}

/// 울트라 페이스의 베젤 눈금 — **화면의 둥근 모서리까지 따라 도는** 눈금자.
///
/// 곧은 세로줄이 아니라 실제 페이스처럼 모서리 곡선을 타고 내려간다. 눈금 위치는 직접 만든
/// 경로를 `trimmedPath` 로 잘라 그 지점을 얻고, 눈금 방향은 화면 중심을 향하는 법선이다.
/// ⚠ 눈금 범위는 **표시용**이다 — 워치엔 판정 임계가 없으므로 색이 상태를 뜻하지 않는다.
///   색은 종류 구분(심박 빨강 · HRV 보라)일 뿐이다.
/// ⚠ 그림 자체는 VoiceOver 가 읽을 수 없다 — 값을 접근성 라벨로 따로 준다.
private struct BezelScale: View {
    let title: String
    let value: Double?
    let range: ClosedRange<Double>
    /// 그 위치의 값이 어느 구간인가. nil 이면 구간을 안 칠한다(근거 있는 임계가 없는 값).
    let zone: ((Double) -> WatchVitalZone)?
    let side: HorizontalEdge

    /// 눈금 개수. 촘촘할수록 페이스에 가깝지만, 잔눈금이 굵으면 띠가 뭉개진다 —
    /// 개수를 늘리는 만큼 잔눈금은 짧고 가늘게 한다(아래 length·lineWidth).
    private static let tickCount = 48

    private var ratio: Double? {
        guard let value else { return nil }
        let clamped = min(max(value, range.lowerBound), range.upperBound)
        return (clamped - range.lowerBound) / (range.upperBound - range.lowerBound)
    }

    var body: some View {
        GeometryReader { geo in
            // ⚠ 오른쪽은 세로 페이징 점이 그려지는 자리라 한 겹 더 들인다 — 안 들이면 겹쳐서
            //   눈금도 점도 안 읽힌다. 점은 "면이 더 있다" 는 유일한 단서라 숨기지 않는다.
            let inset: CGFloat = side == .trailing ? 13 : 3
            // ⚠ `CGRect.inset(by:)` 는 UIKit 의 `UIEdgeInsets` 를 요구한다 — UIKit 을 끌어들이지
            //   않으려고 좌·우를 따로 계산한다.
            let leading: CGFloat = side == .leading ? 3 : inset
            let trailing: CGFloat = side == .trailing ? inset : 3
            // ⚠ **시스템 시계는 앱이 옮기지도 숨기지도 못한다**(워치페이스만 가능하고 서드파티는
            //   워치페이스를 못 만든다). 그래서 피하지 않고 **아래로 지나가게** 둔다 — 눈금은
            //   화면 맨 끝의 가는 선이고 시계 글자는 안쪽이라 서로 안 가린다.
            //   이렇게 해야 네 모서리가 다 살아난다(안전 영역만큼 비우면 위가 잘린다).
            let rect = CGRect(
                x: leading,
                y: 3,
                width: max(geo.size.width - leading - trailing, 1),
                height: max(geo.size.height - 6, 1)
            )
            Canvas { context, _ in
                let path = Self.edgePath(in: rect, side: side)
                let center = CGPoint(x: rect.midX, y: rect.midY)
                for index in 0...Self.tickCount {
                    let t = Double(index) / Double(Self.tickCount)
                    guard let point = Self.point(on: path, at: t) else { continue }
                    let normal = Self.inwardNormal(from: point, toward: center)
                    let isMajor = index % 6 == 0
                    let length: CGFloat = isMajor ? 12 : 6
                    // ★ 눈금 하나하나가 **그 위치의 값**이 어느 구간인지 말한다 — 띠 전체가
                    //   신호등이 되어, 지금 값이 어디쯤인지 뿐 아니라 어디부터 위험인지도 보인다.
                    let tickValue = range.lowerBound
                        + (range.upperBound - range.lowerBound) * (1 - t)
                    let color = zone.map { $0(tickValue).color.opacity(0.85) }
                        ?? Color.white.opacity(0.30)
                    var tick = Path()
                    tick.move(to: point)
                    tick.addLine(to: CGPoint(x: point.x + normal.dx * length,
                                             y: point.y + normal.dy * length))
                    context.stroke(tick, with: .color(color), lineWidth: isMajor ? 1.4 : 1)
                }
                // 값 표식 — 위가 큰 값이다(참고 화면과 같은 방향).
                if let ratio, let value, let point = Self.point(on: path, at: 1 - ratio) {
                    let normal = Self.inwardNormal(from: point, toward: center)
                    var marker = Path()
                    marker.move(to: point)
                    marker.addLine(to: CGPoint(x: point.x + normal.dx * 17,
                                               y: point.y + normal.dy * 17))
                    // 검은 테두리를 먼저 깔아 눈금 위에서도 표식이 묻히지 않게 한다.
                    let markerColor = zone.map { $0(value).color } ?? VitalGuardWatchPalette.ink
                    context.stroke(marker, with: .color(.black), lineWidth: 5)
                    context.stroke(marker, with: .color(markerColor), lineWidth: 3)
                }
            }
            .overlay(alignment: side == .leading ? .topLeading : .topTrailing) {
                Text(title)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(VitalGuardWatchPalette.ink)
                    // ⚠ 칸이 좁아 그냥 두면 `HRV` 가 `HR/V` 로 접힌다.
                    .fixedSize()
                    // ⚠ 실기기는 화면 모서리가 둥글어 구석에 둔 글자가 잘린다(시뮬레이터 실측).
                    //   눈금이 시작되는 높이보다 위, 그리고 가장자리에서 충분히 안쪽에 둔다.
                    // 시계 밴드 아래로 내린다 — 위에 두면 시계와 같은 줄에 놓인다.
                    .padding(.top, 34)
                    .padding(side == .leading ? .leading : .trailing,
                             side == .leading ? 6 : 14)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(title)
        .accessibilityValue(value.map { String(format: "%.0f", $0) } ?? "측정 없음")
    }

    /// 한쪽 가장자리 경로 — 위에서 아래로 내려와 모서리를 돌아 나간다.
    /// 직접 만들어야 `trimmedPath` 의 0~1 이 어느 방향인지 확정된다.
    private static func edgePath(in rect: CGRect, side: HorizontalEdge) -> Path {
        // 위·아래 모서리를 **둘 다** 돈다 — 아래만 돌면 반쪽이라 페이스처럼 안 읽힌다.
        let corner = min(rect.width, rect.height) * 0.30
        var path = Path()
        if side == .leading {
            path.move(to: CGPoint(x: rect.minX + corner, y: rect.minY))
            path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.minY + corner),
                              control: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - corner))
            path.addQuadCurve(to: CGPoint(x: rect.minX + corner, y: rect.maxY),
                              control: CGPoint(x: rect.minX, y: rect.maxY))
        } else {
            path.move(to: CGPoint(x: rect.maxX - corner, y: rect.minY))
            path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + corner),
                              control: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - corner))
            path.addQuadCurve(to: CGPoint(x: rect.maxX - corner, y: rect.maxY),
                              control: CGPoint(x: rect.maxX, y: rect.maxY))
        }
        return path
    }

    /// 경로 위 비율 `t` 의 좌표. 아주 짧게 잘라 그 조각의 중심을 쓴다.
    private static func point(on path: Path, at t: Double) -> CGPoint? {
        let clamped = min(max(t, 0), 1)
        let span = 0.002
        let from = min(clamped, 1 - span)
        let box = path.trimmedPath(from: from, to: from + span).boundingRect
        guard box.width.isFinite, box.height.isFinite else { return nil }
        return CGPoint(x: box.midX, y: box.midY)
    }

    /// 화면 안쪽을 향하는 단위 법선. 눈금이 늘 중심 쪽으로 뻗는다.
    private static func inwardNormal(from point: CGPoint, toward center: CGPoint) -> CGVector {
        let dx = center.x - point.x
        let dy = center.y - point.y
        let length = max((dx * dx + dy * dy).squareRoot(), 0.001)
        return CGVector(dx: dx / length, dy: dy / length)
    }
}

/// 하단 원형 지표. `range` 가 있으면 고리를 채우고, 없으면 **테두리만** 그리고 숫자만 적는다.
///
/// ⚠ 상한이 없는 값(세션 누적 kcal)에 고리를 씌우지 않는다 — 상한을 지어내면 "얼마나 찼는가"
///   자체가 거짓이 된다. 이 앱이 없는 값을 안 그리는 규칙과 같은 줄기다.
private struct CircleStat: View {
    let label: String
    let value: Double?
    let range: ClosedRange<Double>?
    let unit: String
    let digits: Int
    let tint: Color

    private var text: String {
        guard let value else { return "--" }
        return String(format: "%.\(digits)f", value)
    }

    var body: some View {
        VStack(spacing: 1) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.16), lineWidth: 3)
                if let range, let value {
                    let clamped = min(max(value, range.lowerBound), range.upperBound)
                    let ratio = (clamped - range.lowerBound) / (range.upperBound - range.lowerBound)
                    Circle()
                        .trim(from: 0, to: ratio)
                        .stroke(tint, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                Text(text)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(value == nil ? VitalGuardWatchPalette.ink : tint)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .padding(.horizontal, 3)
            }
            .frame(width: 50, height: 50)
            Text("\(label) \(unit)")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(VitalGuardWatchPalette.ink)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
        }
    }
}

/// 심박 추이 한 줄. 점이 2개 미만이면 선 대신 사유를 적는다 — 빈 판에 평평한 선을 그으면
/// "안정적" 이라는 없는 사실을 말하게 된다(폰 카드와 같은 규칙).
private struct HeartRateSparkline: View {
    let points: [WatchBPMPoint]

    var body: some View {
        GeometryReader { geo in
            if points.count < 2 {
                Text("심박 수집 중")
                    .font(.system(size: 11))
                    .foregroundStyle(VitalGuardWatchPalette.ink)
                    .frame(width: geo.size.width, height: geo.size.height)
            } else {
                ZStack {
                    line(in: geo.size).stroke(
                        LinearGradient(
                            colors: [
                                VitalGuardWatchPalette.ink.opacity(0.5),
                                VitalGuardWatchPalette.inkStrong,
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
                    )
                    marker(in: geo.size)
                }
            }
        }
    }

    /// 세로 눈금은 실측 최소~최대에 맞춘다. 고정 범위로 그리면 값 폭이 좁을 때 선이 평평해져
    /// 변화가 안 보이고, 넓을 때는 판 밖으로 나간다.
    private func bounds() -> (low: Double, high: Double) {
        let values = points.map(\.bpm)
        let low = values.min() ?? 0
        let high = values.max() ?? 0
        // 값이 거의 일정하면 0으로 나누게 된다 — 최소 폭을 준다.
        return high - low < 4 ? (low - 2, low + 2) : (low, high)
    }

    private func position(_ index: Int, in size: CGSize) -> CGPoint {
        let (low, high) = bounds()
        let x = points.count == 1
            ? size.width
            : size.width * CGFloat(index) / CGFloat(points.count - 1)
        let y = size.height * (1 - CGFloat((points[index].bpm - low) / (high - low)))
        return CGPoint(x: x, y: y)
    }

    private func line(in size: CGSize) -> Path {
        var path = Path()
        for index in points.indices {
            let point = position(index, in: size)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }

    /// 끝점 표식 — 지금 값이 선의 어디인지 손목에서 한눈에 잡히게 한다.
    private func marker(in size: CGSize) -> some View {
        let last = position(points.count - 1, in: size)
        return Circle()
            .fill(VitalGuardWatchPalette.inkStrong)
            .frame(width: 5, height: 5)
            .position(x: min(last.x, size.width - 3), y: last.y)
    }
}

/// 낙상 확정 전 30초 확인 창. 취소 경로는 셋이다 — 이 버튼 · 지속 움직임(모듈 자동) · 무반응(확정).
private struct FallCountdownOverlay: View {
    @ObservedObject var streamer: WatchStreamer

    var body: some View {
        VStack(spacing: 8) {
            // ★ 테스트로 띄운 것이면 화면이 먼저 그렇게 말한다 — 옆 사람이 보고 진짜로 착각하거나,
            //   본인이 진짜인 줄 알고 놀라는 일이 없게 한다.
            if streamer.fallCountdownIsTest {
                Text("테스트")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.orange)
            }
            Text("낙상 감지")
                .font(.headline)
                .foregroundStyle(.red)
            Text("괜찮으시면 눌러 주세요")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("낙상 아님") { streamer.cancelFallCountdown() }
                .tint(.green)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black.opacity(0.92))
    }
}
