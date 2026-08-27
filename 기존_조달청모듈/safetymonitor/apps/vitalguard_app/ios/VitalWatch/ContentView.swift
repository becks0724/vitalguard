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

    /// ⚠ ScrollView 를 벗기지 말 것 — 줄이 하나만 늘어도 아래가 잘려 못 보게 된다.
    private var vitalsPage: some View {
        ScrollView {
            VStack(spacing: 4) {
                header
                HeartRateSparkline(points: streamer.recentBPM)
                    .frame(height: 40)
                stats
                // ⚠ 이산·전달 줄은 각 상세 면으로 옮겼다 — 같은 값을 두 곳에 두면 어느 쪽이
                //   최신인지 읽는 사람이 판단해야 한다. 여기서는 "더 있다" 만 알린다.
                Text("크라운을 내리면 종류별 상세")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 2)
        }
    }

    /// 좌 라벨 · 우 현재값. 값은 오른쪽 끝에 붙여 두 자리·세 자리가 바뀌어도 안 흔들린다.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: "heart.fill")
                .font(.system(size: 12))
                .foregroundStyle(.red)
            VStack(alignment: .leading, spacing: 0) {
                Text("심박")
                    .font(.system(size: 13, weight: .semibold))
                Text(windowLabel)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Text(streamer.latestBPM.map { String(format: "%.0f", $0) } ?? "--")
                .font(.system(size: 26, weight: .bold, design: .rounded))
            Text("bpm")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
    }

    /// 3분할 카드 — 종전에 네 줄을 차지하던 값들을 한 줄로 접었다.
    /// ⚠ 값이 없으면 `--` 를 적고 칸은 남긴다. 칸이 사라지면 "그 측정이 없는 앱" 으로 읽힌다.
    private var stats: some View {
        HStack(spacing: 4) {
            WatchStatCard(
                tint: .cyan,
                label: "SpO₂",
                value: streamer.latestSpO2.map { "\(Int($0))%" } ?? "--",
                note: streamer.latestSpO2At?.formatted(date: .omitted, time: .shortened)
            )
            WatchStatCard(
                tint: .orange,
                label: "활동",
                value: streamer.sessionEnergyKcal > 0
                    ? String(format: "%.1f", streamer.sessionEnergyKcal)
                    : "--",
                note: "kcal"
            )
            // ★ 꺼져 있으면 이 칸이 곧 시작 버튼으로 가는 문이다 — 동작 버튼을 2면으로 옮기면서
            //   "켜는 법을 못 찾는" 자리가 생겼다. 꺼진 것을 눌러 켜는 곳으로 가는 게 자연스럽다.
            if streamer.isRunning {
                WatchStatCard(tint: .green, label: "수집", value: "ON", note: streamer.statusText)
            } else {
                Button { page = .settings } label: {
                    WatchStatCard(tint: .gray, label: "수집", value: "OFF", note: "눌러서 시작")
                }
                .buttonStyle(.plain)
            }
        }
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

/// 3분할 칸 하나. 색은 **종류 구분**이지 판정이 아니다 — 워치는 상태를 말하지 않는다.
private struct WatchStatCard: View {
    let tint: Color
    let label: String
    let value: String
    let note: String?

    var body: some View {
        VStack(spacing: 1) {
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(tint)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            if let note {
                Text(note)
                    .font(.system(size: 8))
                    .foregroundStyle(.secondary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 3)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
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
                    .foregroundStyle(.secondary)
                    .frame(width: geo.size.width, height: geo.size.height)
            } else {
                ZStack {
                    line(in: geo.size).stroke(
                        LinearGradient(
                            colors: [.red.opacity(0.55), .red],
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
            .fill(.red)
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
