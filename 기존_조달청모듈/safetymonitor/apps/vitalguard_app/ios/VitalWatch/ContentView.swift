// 워치 메인 화면 — 심박 추이·생체 요약을 카드로 보여주고 세션을 시작/중지한다
//
// ★ 2026-08-27 재배치. 종전에는 글자 줄을 세로로 쌓았는데, 낙상 기능이 붙으면서 줄이 늘어
//   **[중지]·[ML 자가검증] 버튼이 화면 밖으로 밀려 눌 수 없었다**(사용자 제보).
//   ⚠ 원인은 줄 수만이 아니다 — 바깥이 `VStack` 이라 넘친 만큼이 **잘려서 스크롤도 안 됐다**.
//     그래서 카드로 압축하는 것과 별개로 `ScrollView` 를 씌운다. 압축만 하면 다음에 줄이
//     하나 늘어날 때 같은 사고가 그대로 재발한다.
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

    /// 이산 측정 한 줄 — 도착한 종류만 짧은 한국어 라벨로 적는다(0 건은 생략).
    /// HRV 는 값이 있으면 ms 까지 보여준다(상시 워크아웃 중엔 구조상 안 나오는 것이 정상).
    private var discreteLine: String {
        let labels: [(key: String, name: String)] = [
            ("pe", "강도"), ("dl", "일광"), ("rhr", "안정"), ("whr", "보행"), ("rr", "호흡"),
        ]
        var parts = labels.compactMap { item -> String? in
            guard let n = streamer.discreteCounts[item.key], n > 0 else { return nil }
            return "\(item.name)\(n)"
        }
        if let ms = streamer.latestHrvMs {
            parts.append(String(format: "HRV %.0fms", ms))
        } else if let n = streamer.discreteCounts["hrv"], n > 0 {
            parts.append("HRV\(n)")
        }
        return parts.isEmpty ? "이산 0건" : parts.joined(separator: " ")
    }

    /// 전송·전달 채널 한 줄 — 0 은 생략한다(이산 측정 줄과 같은 규칙).
    ///
    /// `잔량` = 아직 폰에 도달하지 않은 큐. 이것이 실시간으로 늘어나면 전달이 밀리는 중이라는
    /// 뜻이고, 08-18 거리 시험의 판정 근거가 된다. `즉시` 는 `전송 − 큐` 라 따로 적지 않는다.
    private var transmitLine: String {
        var parts = ["전송\(streamer.batchesSent)", streamer.reachable ? "도달" : "단절"]
        let queued = streamer.sentQueued + streamer.immediateFailed
        if queued > 0 { parts.append("큐\(queued)") }
        if streamer.pendingTransfers > 0 { parts.append("잔량\(streamer.pendingTransfers)") }
        return parts.joined(separator: " ")
    }

    /// 그래프가 실제로 덮은 시간. "1시간" 이라 적어 두고 3분치를 그리면 화면이 거짓말한다.
    private var windowLabel: String {
        guard let first = streamer.recentBPM.first, let last = streamer.recentBPM.last,
              streamer.recentBPM.count >= 2 else { return "수집 중" }
        let minutes = Int(last.at.timeIntervalSince(first.at) / 60)
        return minutes >= 60 ? "최근 \(minutes / 60)시간" : "최근 \(max(minutes, 1))분"
    }

    var body: some View {
        // ⚠ ScrollView 를 벗기지 말 것 — 줄이 하나만 늘어도 아래 버튼이 잘려 못 누르게 된다.
        ScrollView {
            VStack(spacing: 4) {
                header
                HeartRateSparkline(points: streamer.recentBPM)
                    .frame(height: 38)
                stats
                primaryButton

                // 상세는 카드 아래로 — 평시엔 안 봐도 되고, 진단할 때만 읽는 줄이다.
                if streamer.isRunning {
                    Text(discreteLine)
                        .font(.system(size: 11))
                        .foregroundStyle(streamer.latestHrvMs == nil ? Color.secondary : Color.purple)
                }
                Text(transmitLine)
                    .font(.system(size: 11))
                    .foregroundStyle(streamer.pendingTransfers > 0 ? Color.orange : Color.secondary)

                // 낙상 ML 자가검증 — 모듈이 정한 탑재 확인 절차(6줄 전부 ✅ 여야 탑재 성공).
                // 표본율이 모자라면 판정이 조용히 안 도는 구조라, 눈으로 확인할 자리가 반드시 필요하다.
                Button("ML 자가검증") { selfCheckResult = MLSelfCheck.run() }
                    .font(.footnote)
                if let selfCheckResult {
                    Text(selfCheckResult)
                        .font(.system(size: 11, design: .monospaced))
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(.horizontal, 2)
        }
        .confirmationDialog("수집을 중지할까요?", isPresented: $confirmingStop) {
            Button("중지", role: .destructive) { streamer.stop() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("중지하면 자동으로 다시 켜지지 않습니다.")
        }
        // 낙상 카운트다운 — 화면을 덮는다. 쓰러진 사람이 목록을 스크롤해 버튼을 찾을 수는 없다.
        .overlay {
            if streamer.fallCountdownActive { FallCountdownOverlay(streamer: streamer) }
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

    /// 3분할 카드 — 참고 디자인의 배치. 종전에 네 줄을 차지하던 값들을 한 줄로 접었다.
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
            WatchStatCard(
                tint: streamer.isRunning ? .green : .gray,
                label: "수집",
                value: streamer.isRunning ? "ON" : "OFF",
                note: streamer.statusText
            )
        }
    }

    /// 참고 디자인의 넓은 알약 버튼. 손목에서 누르는 유일한 상시 동작이라 폭을 다 준다.
    private var primaryButton: some View {
        Button {
            if streamer.isRunning { confirmingStop = true } else { streamer.start() }
        } label: {
            Label(
                streamer.isRunning ? "중지" : "시작",
                systemImage: streamer.isRunning ? "stop.fill" : "play.fill"
            )
            .font(.system(size: 14, weight: .semibold))
            .frame(maxWidth: .infinity)
        }
        .tint(streamer.isRunning ? .red : .green)
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
        VStack(spacing: 10) {
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
