// 워치 메인 화면 — HR 수집 상태·최신 심박·전송 횟수를 표시하고 세션을 시작/중지한다
import SwiftUI

struct ContentView: View {
    @StateObject private var streamer = WatchStreamer()

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

            Text(streamer.statusText)
                .font(.footnote)
                .foregroundStyle(streamer.isRunning ? .green : .secondary)

            Text("전송 \(streamer.batchesSent)회")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Button(streamer.isRunning ? "중지" : "시작") {
                streamer.isRunning ? streamer.stop() : streamer.start()
            }
            .tint(streamer.isRunning ? .red : .green)
        }
        .padding(.horizontal, 4)
    }
}
