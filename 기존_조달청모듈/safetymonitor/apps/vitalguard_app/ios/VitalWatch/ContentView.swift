// 워치 메인 화면 — HR 수집 상태·최신 심박·전송 횟수를 표시하고 세션을 시작/중지한다
import SwiftUI

struct ContentView: View {
    @StateObject private var streamer = WatchStreamer()
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

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "heart.fill")
                    .foregroundStyle(.red)
                Text(streamer.latestBPM.map { String(format: "%.0f", $0) } ?? "--")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                Text("bpm")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            // SpO₂ 는 기회 측정이라 상시 값이 아니다 — 측정된 시각과 함께 마지막 값만 보여준다.
            if let spo2 = streamer.latestSpO2, let at = streamer.latestSpO2At {
                Text("SpO₂ \(Int(spo2))% · \(at.formatted(date: .omitted, time: .shortened))")
                    .font(.footnote)
                    .foregroundStyle(.cyan)
            }

            // 활동 에너지(온열 ①) — 세션 누적 소모. 현장 검증용(폰 로그·DB 도착값과 대조).
            if streamer.isRunning, streamer.sessionEnergyKcal > 0 {
                Text("활동 \(streamer.sessionEnergyKcal, specifier: "%.1f") kcal")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }

            // 이산 측정 현황 — 실기기 게이트의 판정 근거. **종류별로** 보여준다.
            // 총합 하나만 두면 "그 N 건이 무엇인지"를 화면이 답하지 못해 진단이 막힌다(08-14 실측).
            if streamer.isRunning {
                Text(discreteLine)
                    .font(.footnote)
                    .foregroundStyle(streamer.latestHrvMs == nil ? Color.secondary : Color.purple)
            }

            Text(streamer.statusText)
                .font(.footnote)
                .foregroundStyle(streamer.isRunning ? .green : .secondary)

            // 전송 현황 + 전달 채널 계측(08-18 거리 시험 판정 근거) — 줄을 늘리지 않고
            // 기존 "전송 N회" 자리에 얹는다. 워치 화면은 이미 꽉 차 있어 한 줄을 더하면
            // 시작/중지 버튼이 밀린다. 정상일 때는 짧고(`전송405 도달`) 이상일 때만 길어진다.
            Text(transmitLine)
                .font(.footnote)
                .foregroundStyle(streamer.pendingTransfers > 0 ? Color.orange : Color.secondary)

            Button(streamer.isRunning ? "중지" : "시작") {
                if streamer.isRunning { confirmingStop = true } else { streamer.start() }
            }
            .tint(streamer.isRunning ? .red : .green)
        }
        .padding(.horizontal, 4)
        .confirmationDialog("수집을 중지할까요?", isPresented: $confirmingStop) {
            Button("중지", role: .destructive) { streamer.stop() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("중지하면 자동으로 다시 켜지지 않습니다.")
        }
    }
}
