// 워치 메인 화면 — HR 수집 상태·최신 심박·전송 횟수를 표시하고 세션을 시작/중지한다
import SwiftUI

struct ContentView: View {
    @StateObject private var streamer = WatchStreamer()

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
