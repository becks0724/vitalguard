// 워치 PoC 디자인 토큰 — 파스텔 카드 섹션 레퍼런스 기반(메트릭별 카드 + 다크 잉크 텍스트)
import SwiftUI

enum WatchTheme {
    static let bg = Color.black
    static let card = Color(white: 0.10)            // 다크 상태 카드
    static let ink = Color(white: 0.08)             // 파스텔 카드 위 텍스트
    static let brand = Color(red: 1.0, green: 0.32, blue: 0.18)

    // 메트릭 식별용 파스텔 카드 배경(위험 판정색 아님 — 본 분석은 서버).
    static let heartCard = Color(red: 0.85, green: 0.88, blue: 0.56)   // 올리브/라임
    static let spo2Card = Color(red: 0.73, green: 0.70, blue: 0.93)    // 라벤더
    static let fallCard = Color(red: 0.96, green: 0.81, blue: 0.62)    // 피치

    // 아이콘 칩 강조색.
    static let heart = Color(red: 1.0, green: 0.27, blue: 0.30)
    static let spo2 = Color(red: 0.30, green: 0.62, blue: 0.86)
    static let warn = Color(red: 0.95, green: 0.55, blue: 0.10)

    // 액션/상태용.
    static let ok = Color(red: 0.31, green: 0.82, blue: 0.40)
    static let danger = Color(red: 1.0, green: 0.30, blue: 0.27)
    static let muted = Color.white.opacity(0.55)
}

// 다크 상태 카드 컨테이너.
struct WatchCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) { content }
            .padding(11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WatchTheme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
