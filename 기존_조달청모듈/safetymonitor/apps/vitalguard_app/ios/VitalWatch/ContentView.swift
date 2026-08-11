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
