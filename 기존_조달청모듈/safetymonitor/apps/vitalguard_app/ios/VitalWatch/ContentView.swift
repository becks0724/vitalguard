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
    /// 낙상 ML 자가검증 결과(6줄). nil = 아직 안 돌림. 시트로 띄운다.
    @State private var selfCheckReport: SelfCheckReport?
    /// [중지] 확인 시트 표시 여부.
    ///
    /// ★ 2026-08-20 — 세션이 "사용자가 끝냈다" 로 표시된 채 끝났는데 **사용자는 누른 적이
    ///   없었다**. `stop()` 의 유일한 호출부가 이 버튼이라 오탭이 유력한 후보다.
    ///   수집 중단은 되돌리기 어려운 동작인데(자동 재개가 안 걸리면 사람이 알아챌 때까지 멎는다)
    ///   지금은 탭 한 번이면 끝난다. **[시작] 에는 확인을 걸지 않는다** — 켜는 쪽은 오탭이어도
    ///   손해가 없고, 급할 때 한 번에 켜지는 편이 낫다.
    @State private var confirmingStop = false
    /// ⚠ `scrollPosition(id:)` 은 **Optional** 을 요구한다 — 스크롤이 어느 면에도 안 걸린
    ///   순간이 있기 때문이다. 그 순간을 `vitals` 로 단정하면 점이 깜빡인다.
    @State private var page: Page? = .vitals
    /// 눌러서 이동할 목표. 한 번 쓰고 곧바로 비운다 — 남겨 두면 스크롤할 때마다 되돌아간다.
    @State private var jumpTarget: Page?
    @State private var now = Date()
    private let clockTick = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    /// 크라운을 내리는 순서. 생체 → 종류별 상세 → 마지막이 설정이다.
    /// ⚠ 설정을 맨 끝에 둔다 — 손목에서 늘 보는 것은 생체이고, 동작 버튼은 하루 두어 번이다.
    private enum Page: Hashable, CaseIterable {
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
        // ★ `TabView(.verticalPage)` 를 쓰지 않는다 — 그 스타일은 세로 페이징 점을 **끌 수가
        //   없다**. `VerticalPageTabViewStyle` 에 `indexDisplayMode` 가 없고(가로
        //   `PageTabViewStyle` 에만 있다 · SDK 실측) 밑줄 API 에도 없다. 덮어 보려 했으나
        //   그 점은 앱 그림 위에 그려져 `.overlay` 로도 안 가려진다(시뮬레이터 실측).
        //   그래서 페이징 `ScrollView` 로 바꿨다 — 크라운 페이징은 그대로고 점이 없다.
        //   점은 아래에서 **내가** 그리므로 1면에서 숨기는 것이 가능해진다(사용자 요청).
        ScrollViewReader { proxy in
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(Page.allCases, id: \.self) { item in
                    self.view(for: item)
                        .containerRelativeFrame(.vertical)
                        .id(item)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollIndicators(.hidden)
        .scrollPosition(id: $page)
        // ⚠ 안전영역 무시는 **컨테이너에** 건다. 면 안쪽에 걸면 컨테이너 높이는 안전영역만큼
        //   작은데 면 내용은 화면 전체를 그려서 한 면 높이가 안 맞고 **다음 면이 아래로 비친다**
        //   (시뮬레이터 실측). `containerRelativeFrame(.vertical)` 이 재는 것이 이 높이다.
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
        // ★ 프로그램 이동은 **`proxy.scrollTo`** 로 한다.
        // ⚠ `page` 바인딩에 목표를 대입하는 방식은 불안정하다 — 스크롤이 애니메이션 도중
        //   지나가는 면을 그 바인딩에 **되써서** 목표가 흔들린다(실측: SpO₂ 를 목표했는데
        //   전달 면에 섰다). 바인딩은 "지금 어느 면인가" 를 읽는 데만 쓴다.
        .onChange(of: jumpTarget) { _, target in
            guard let target else { return }
            withAnimation { proxy.scrollTo(target, anchor: .top) }
            jumpTarget = nil
        }
        }

        // ★ 점은 2면부터만 그린다(사용자 결정) — 1면에서는 오른쪽 베젤 눈금과 겹쳐 둘 다 안 읽혔다.
        // ⚠ 1면에서 "면이 더 있다" 를 알리는 일은 그 화면의 "크라운을 내리면 상세" 글줄이
        //   대신한다. 그 줄을 지우면 1면이 막다른 화면처럼 보인다.
        .overlay(alignment: .trailing) {
            if let page, page != .vitals {
                PageDots(pages: Page.allCases, current: page)
                    .padding(.trailing, 3)
            }
        }
        .sheet(item: $selfCheckReport) { report in
            ScrollView {
                Text(report.text)
                    .font(.system(size: 12, design: .monospaced))
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
            }
        }
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
                        jumpTarget = .settings
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

    static func clock(_ date: Date) -> String {
        date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute())
    }

    @ViewBuilder
    private func view(for item: Page) -> some View {
        switch item {
        case .vitals: vitalsPage
        case .heartRate: heartRatePage
        case .spo2: spo2Page
        case .energy: energyPage
        case .transmit: transmitPage
        case .settings: settingsPage
        }
    }

    // MARK: - 상세 면들

    /// 2면 · 심박 — 애플 건강 앱 심박 화면 배치(사용자 제공 참고 이미지).
    /// 위 = 그래프 판(좌하단 시각 눈금 · 우측 최고/최저) · 아래 = 제목 · 큰 값 + BPM · 부연 한 줄.
    private var heartRatePage: some View {
        let values = streamer.recentBPM.map(\.bpm)
        let zone = streamer.latestBPM.map(WatchVitalZone.heartRate)
        return VStack(alignment: .leading, spacing: 4) {
            HistoryPanel(
                points: streamer.recentBPM,
                tint: zone?.color ?? VitalGuardWatchPalette.inkStrong,
                style: .line
            )
            .frame(height: 108)

            Text("심박")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(VitalGuardWatchPalette.ink)

            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(streamer.latestBPM.map { String(format: "%.0f", $0) } ?? "--")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundStyle(zone?.color ?? VitalGuardWatchPalette.inkStrong)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                VStack(alignment: .leading, spacing: -2) {
                    Text("BPM")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(zone?.color ?? VitalGuardWatchPalette.ink)
                    Image(systemName: "heart.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(zone?.color ?? VitalGuardWatchPalette.ink)
                }
                Spacer(minLength: 0)
            }

            // ⚠ 최저·최고는 **그래프가 덮은 창 안**의 값이지 하루치가 아니다 — 창을 함께 적는다.
            Text(subline(values: values))
                .font(.system(size: 11))
                .foregroundStyle(VitalGuardWatchPalette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        // ⚠ 이 면에는 시계가 없다(시계는 1면만 그린다) — 위 여백은 화면 둥근 모서리를 피할
        //   만큼만 있으면 된다. 남는 자리는 그래프 판에 준다.
        .padding(.top, 12)
    }

    private func subline(values: [Double]) -> String {
        guard let low = values.min(), let high = values.max(), values.count >= 2 else {
            return "심박 수집 중"
        }
        return "최저 \(Int(low)) · 최고 \(Int(high)) · \(windowLabel)"
    }

    /// 3면 · 산소포화도 — 애플 "Oxygen saturation" 카드 배치.
    /// 좌 = 원형 게이지 · 우 = 라벨 · 큰 값 · 부연.
    private var spo2Page: some View {
        let zone = streamer.latestSpO2.map(WatchVitalZone.spo2)
        return HStack(spacing: 10) {
            DialGauge(
                value: streamer.latestSpO2,
                range: 85...100,
                tint: zone?.color ?? VitalGuardWatchPalette.ink,
                symbol: "drop.fill"
            )
            .frame(width: 60, height: 60)

            VStack(alignment: .leading, spacing: 1) {
                Text("산소포화도")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(VitalGuardWatchPalette.ink)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(streamer.latestSpO2.map { "\(Int($0))" } ?? "--")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(zone?.color ?? VitalGuardWatchPalette.inkStrong)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text("%")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(zone?.color ?? VitalGuardWatchPalette.ink)
                }
                // ⚠ 기회 측정이라 "언제 잰 값인가" 가 값만큼 중요하다.
                Text(streamer.latestSpO2At.map { "마지막 측정 \(Self.clock($0))" } ?? "아직 측정 없음")
                    .font(.system(size: 10))
                    .foregroundStyle(VitalGuardWatchPalette.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        // ⚠ 위로 붙이면 아래가 통째로 빈다 — 이 면은 요소가 한 줄뿐이라 **세로 가운데**가 맞다
        //   (사용자 요청). 다른 면들은 그래프 판이 위를 채워서 위 정렬이 맞다.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    /// 4면 · 활동 에너지 — 애플 "Move" 화면 배치(막대 그래프 + 큰 합계).
    ///
    /// ⚠ **목표치 고리와 달성률(174% 같은)은 안 넣는다.** 우리에겐 목표가 없다 — 없는 분모를
    ///   지어내면 "얼마나 찼는가" 자체가 거짓이 된다. 참고 이미지의 고리·`/600 CAL`·`%` 는
    ///   그래서 뺐고, 대신 세션 누적만 크게 둔다.
    private var energyPage: some View {
        VStack(alignment: .leading, spacing: 4) {
            HistoryPanel(
                points: streamer.recentEnergy,
                tint: VitalGuardWatchPalette.inkStrong,
                style: .bars
            )
            .frame(height: 84)

            Text("활동 에너지")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(VitalGuardWatchPalette.ink)

            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(streamer.sessionEnergyKcal > 0
                     ? String(format: "%.1f", streamer.sessionEnergyKcal) : "--")
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .foregroundStyle(VitalGuardWatchPalette.inkStrong)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text("kcal")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(VitalGuardWatchPalette.ink)
                Spacer(minLength: 0)
            }

            Text(streamer.isRunning ? "이번 세션 누적 · 목표 없음" : "수집 정지")
                .font(.system(size: 11))
                .foregroundStyle(VitalGuardWatchPalette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.top, 26)
    }

    /// 5면 · 전달 — 애플 소음 앱의 눈금 다이얼 배치(참고 이미지 레드박스). 색은 이 앱 것을 쓴다.
    ///
    /// ⚠ 다이얼이 차는 축은 **밀린 정도**다(큐 + 잔량). 0 이면 가득 찬 게 아니라 **깨끗한** 것이라
    ///   가운데에 체크를 둔다 — 눈금만 있으면 "0 이라 비었다" 로 읽힌다.
    private var transmitPage: some View {
        let queued = streamer.sentQueued + streamer.immediateFailed + streamer.pendingTransfers
        let healthy = streamer.reachable && queued == 0
        return VStack(spacing: 6) {
            TickDial(
                filled: min(Double(queued) / 20, 1),
                tint: healthy ? VitalGuardWatchPalette.normal : VitalGuardWatchPalette.caution,
                healthy: healthy,
                center: healthy ? "\(streamer.batchesSent)" : "\(queued)"
            )
            .frame(width: 108, height: 108)

            Text(healthy ? "전달 정상 · 전송 \(streamer.batchesSent)배치" : "밀림 \(queued)건")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(healthy ? VitalGuardWatchPalette.ink : VitalGuardWatchPalette.caution)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(streamer.reachable ? "폰에 도달" : "폰과 단절")
                .font(.system(size: 10))
                .foregroundStyle(VitalGuardWatchPalette.ink)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 20)
    }

    // MARK: - 마지막 면 · 설정    // MARK: - 마지막 면 · 설정

    /// 마지막 면 · 설정.
    ///
    /// ⚠ **여기에 `ScrollView` 를 두지 말 것.** 바깥이 세로 페이징 `ScrollView` 라서 세로
    ///   스크롤이 겹치면 **크라운이 안쪽에 먹히고 위 면으로 못 올라간다**(실기기 제보로 확인).
    ///   안쪽은 스크롤할 것이 없어 아무 일도 안 일어나고 바깥으로 넘겨주지도 않는다.
    ///   그래서 이 면은 스크롤 없이 **한 화면에 들어가는 만큼만** 둔다.
    /// ⚠ 자가검증 결과(6줄)는 여기 펼치지 않고 시트로 띄운다 — 펼치면 화면을 넘겨 다시
    ///   스크롤이 필요해지고, 위 함정으로 되돌아간다.
    private var settingsPage: some View {
        VStack(spacing: 8) {
            Spacer(minLength: 0)

            Text("설정")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(VitalGuardWatchPalette.ink)
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
            Button("ML 자가검증") {
                selfCheckReport = SelfCheckReport(text: MLSelfCheck.run())
            }
            .font(.system(size: 12))

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 자가검증 결과를 시트로 띄우기 위한 그릇.
/// ⚠ `sheet(isPresented:)` + 수동 `Binding(get:set:)` 대신 `sheet(item:)` 을 쓴다 —
///   본문에서 손으로 만든 바인딩은 상태가 둘로 갈려 어긋나기 쉽다.
private struct SelfCheckReport: Identifiable {
    let id = UUID()
    let text: String
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

/// 애플 건강 앱의 그래프 판 — 어두운 면 위에 선 또는 막대, 좌하단 시각·우측 최고/최저.
///
/// ⚠ 축 라벨이 없으면 그 폭이 몇 분인지 화면이 답하지 못한다 — 점이 2개 미만이면 판만
///   그리고 사유를 적는다(빈 판에 선을 그으면 없는 사실을 말하게 된다).
private struct HistoryPanel: View {
    enum Style {
        case line
        case bars
    }

    let points: [WatchBPMPoint]
    let tint: Color
    let style: Style

    private var values: [Double] { points.map(\.bpm) }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.07))

            if points.count < 2 {
                Text("수집 중")
                    .font(.system(size: 11))
                    .foregroundStyle(VitalGuardWatchPalette.ink)
            } else {
                GeometryReader { geo in
                    let plot = CGRect(x: 6, y: 6, width: geo.size.width - 34,
                                      height: geo.size.height - 24)
                    Canvas { context, _ in
                        draw(in: context, plot: plot)
                    }
                    axisLabels(in: geo.size, plot: plot)
                }
            }
        }
    }

    private func draw(in context: GraphicsContext, plot: CGRect) {
        let low = values.min() ?? 0
        let high = values.max() ?? 0
        let span = max(high - low, 1)
        func point(_ index: Int) -> CGPoint {
            CGPoint(
                x: plot.minX + plot.width * CGFloat(index) / CGFloat(max(points.count - 1, 1)),
                y: plot.maxY - plot.height * CGFloat((points[index].bpm - low) / span)
            )
        }

        switch style {
        case .line:
            var path = Path()
            for index in points.indices {
                let p = point(index)
                if index == 0 { path.move(to: p) } else { path.addLine(to: p) }
            }
            context.stroke(path, with: .color(tint),
                           style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
        case .bars:
            // 막대는 바닥에서 올라온다 — 값의 크기를 길이로 읽게 한다.
            let width = max(plot.width / CGFloat(max(points.count, 1)) * 0.6, 1)
            for index in points.indices {
                let p = point(index)
                var bar = Path()
                bar.addRect(CGRect(x: p.x - width / 2, y: p.y,
                                   width: width, height: plot.maxY - p.y))
                context.fill(bar, with: .color(tint))
            }
        }
    }

    @ViewBuilder
    private func axisLabels(in size: CGSize, plot: CGRect) -> some View {
        let low = values.min() ?? 0
        let high = values.max() ?? 0
        ZStack(alignment: .topLeading) {
            // 우측 = 최고/최저(애플 배치와 같은 자리).
            VStack(alignment: .trailing) {
                Text(format(high))
                Spacer(minLength: 0)
                Text(format(low))
            }
            .font(.system(size: 9))
            .foregroundStyle(VitalGuardWatchPalette.ink)
            .frame(width: 26, height: plot.height + 12, alignment: .trailing)
            .position(x: size.width - 13, y: (plot.height + 12) / 2 + 2)

            // 좌하단 = 시각.
            HStack {
                Text(points.first.map { ContentView.clock($0.at) } ?? "")
                Spacer(minLength: 0)
                Text(points.last.map { ContentView.clock($0.at) } ?? "")
            }
            .font(.system(size: 9))
            .foregroundStyle(VitalGuardWatchPalette.ink)
            .frame(width: plot.width)
            .position(x: plot.midX, y: size.height - 8)
        }
    }

    private func format(_ value: Double) -> String {
        value < 10 ? String(format: "%.1f", value) : String(format: "%.0f", value)
    }
}

/// 애플 "Oxygen saturation" 카드의 원형 게이지.
private struct DialGauge: View {
    let value: Double?
    let range: ClosedRange<Double>
    let tint: Color
    let symbol: String

    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.14), lineWidth: 5)
            if let value {
                let clamped = min(max(value, range.lowerBound), range.upperBound)
                let ratio = (clamped - range.lowerBound) / (range.upperBound - range.lowerBound)
                Circle()
                    .trim(from: 0, to: ratio)
                    .stroke(tint, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            Image(systemName: symbol)
                .font(.system(size: 18))
                .foregroundStyle(value == nil ? VitalGuardWatchPalette.ink : tint)
        }
        .accessibilityHidden(true)
    }
}

/// 애플 소음 앱의 눈금 다이얼 — 눈금 링 + 가운데 원.
///
/// ⚠ 가운데 체크는 "정상" 이라는 판정이 아니라 **밀린 것이 없다**는 사실 표시다.
private struct TickDial: View {
    let filled: Double
    let tint: Color
    let healthy: Bool
    let center: String

    private static let ticks = 28

    var body: some View {
        ZStack {
            GeometryReader { geo in
                Canvas { context, size in
                    let radius = min(size.width, size.height) / 2 - 5
                    let origin = CGPoint(x: size.width / 2, y: size.height / 2)
                    for index in 0..<Self.ticks {
                        // 위에서 시작해 시계 방향 — 애플 배치와 같다.
                        let angle = Double(index) / Double(Self.ticks) * 2 * .pi - .pi / 2
                        let on = Double(index) / Double(Self.ticks) < max(filled, 1.0 / Double(Self.ticks))
                        let inner = radius - 9
                        var tick = Path()
                        tick.move(to: CGPoint(x: origin.x + cos(angle) * inner,
                                              y: origin.y + sin(angle) * inner))
                        tick.addLine(to: CGPoint(x: origin.x + cos(angle) * radius,
                                                 y: origin.y + sin(angle) * radius))
                        context.stroke(
                            tick,
                            with: .color(on ? tint : Color.white.opacity(0.18)),
                            style: StrokeStyle(lineWidth: 4, lineCap: .round)
                        )
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }

            VStack(spacing: 1) {
                Image(systemName: healthy ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(tint)
                Text(center)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(VitalGuardWatchPalette.inkStrong)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
        }
    }
}

/// 세로 페이징 점 — 시스템 것을 못 끄기에 직접 그린다.
///
/// ⚠ 장식이 아니라 **위치 정보**다. VoiceOver 가 읽도록 라벨을 준다.
private struct PageDots<Item: Hashable>: View {
    let pages: [Item]
    let current: Item

    var body: some View {
        VStack(spacing: 4) {
            ForEach(pages, id: \.self) { item in
                Circle()
                    .fill(item == current ? Color.white : Color.white.opacity(0.32))
                    .frame(width: item == current ? 6 : 4, height: item == current ? 6 : 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("페이지")
        .accessibilityValue("\((pages.firstIndex(of: current) ?? 0) + 1) / \(pages.count)")
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
    /// 눈금을 비울 구간(경로 비율). 세로 페이징 점이 앉는 자리를 내준다.
    ///
    /// ⚠ **점을 끌 수가 없어서 비키는 것이다.** `VerticalPageTabViewStyle` 에는
    ///   `indexDisplayMode` 가 없다(가로 `PageTabViewStyle` 에만 있다 · SDK 실측). 밑줄 API 도
    ///   없다. 그래서 "1면에서만 점 숨기기" 는 TabView 로는 불가능하고, 대신 그 자리를 비운다.
    /// ⚠ 점을 없애는 쪽으로 바꾸지 말 것 — 점은 "면이 더 있다" 를 알리는 **유일한** 단서다.
    var indexGap: ClosedRange<Double>? = nil

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
                    // 점이 앉는 구간은 비운다(위 `indexGap` 주석 참조).
                    if let indexGap, indexGap.contains(t) { continue }
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
