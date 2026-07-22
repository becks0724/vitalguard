import SwiftUI

enum WatchTheme {
    static let bg = Color(red: 0.06, green: 0.07, blue: 0.08)
    static let surface = Color(red: 0.15, green: 0.16, blue: 0.18)
    static let ink = Color(red: 0.10, green: 0.10, blue: 0.12)
    static let brand = Color.white
    static let mutedInk = Color(red: 0.46, green: 0.49, blue: 0.54)

    // 콘텐츠 카드는 표준 Material을 사용해 센서 수치의 대비와 가독성을 유지한다.
    static let contentStroke = Color.white.opacity(0.20)

    // 메트릭 식별용 파스텔 카드 배경.
    static let heartCard = Color(red: 0.84, green: 0.88, blue: 0.58)
    static let spo2Card = Color(red: 0.71, green: 0.70, blue: 0.94)
    static let fallCard = Color(red: 0.96, green: 0.81, blue: 0.62)

    // 아이콘 칩 강조색.
    static let heart = Color(red: 1.0, green: 0.25, blue: 0.33)
    static let spo2 = Color(red: 0.28, green: 0.58, blue: 0.87)
    static let warn = Color(red: 0.94, green: 0.65, blue: 0.08)

    // 액션/상태용.
    static let ok = Color(red: 0.22, green: 0.78, blue: 0.39)
    static let danger = Color(red: 0.69, green: 0.14, blue: 0.12)
    static let manualUpdateSurface = Color(red: 0.25, green: 0.26, blue: 0.29)
    static let manualUpdateText = Color(red: 0.30, green: 0.89, blue: 0.47)
    static let muted = Color.white.opacity(0.72)
}

// 다크 상태 카드 컨테이너. Liquid Glass는 조작 요소에만 적용한다.
struct WatchCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            content
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(WatchTheme.contentStroke, lineWidth: 0.6)
        )
    }
}

// 헤더/액션 전용 라운드 패널
struct WatchPanel<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            content
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(WatchTheme.contentStroke, lineWidth: 0.6)
        )
    }
}

// Glass 버튼/칩 공통 장식.
struct GlassPill: ViewModifier {
    let color: Color
    let size: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(color)
            .background(
                Capsule().fill(.thinMaterial)
            )
            .frame(minWidth: size)
    }
}

extension View {
    func glassButtonStyle(_ color: Color, minWidth: CGFloat = 72) -> some View {
        modifier(GlassPill(color: color, size: minWidth))
    }
}
