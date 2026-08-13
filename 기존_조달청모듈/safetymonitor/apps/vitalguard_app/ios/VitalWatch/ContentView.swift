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

            // 스트레스 입력 — HRV 는 표본 빈도 자체가 미지수라(작업 중 시간당 0~수 건 예상)
            // 이 줄이 실기기 게이트의 판정 근거다. 0 건이면 수집 자체가 성립하지 않는다는 뜻.
            if streamer.isRunning {
                Text(streamer.latestHrvMs.map { String(format: "HRV %.0fms · %d건", $0, streamer.discreteSent) }
                    ?? "HRV 대기 · \(streamer.discreteSent)건")
                    .font(.footnote)
                    .foregroundStyle(streamer.latestHrvMs == nil ? Color.secondary : Color.purple)
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
