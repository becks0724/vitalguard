import SwiftUI

/// watchOS 26 Liquid Glass와 이전 watchOS의 Material 폴백을 제공한다.
struct AppleGlassActionGroup<Content: View>: View {
    @ViewBuilder private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        Group {
            if #available(watchOS 26.0, *) {
                GlassEffectContainer(spacing: 12) {
                    VStack(spacing: 8) {
                        content
                    }
                }
            } else {
                VStack(spacing: 8) {
                    content
                }
            }
        }
    }
}

struct AppleGlassActionButton: View {
    let title: String
    let tint: Color
    let foreground: Color
    let action: () -> Void

    init(
        title: String,
        tint: Color,
        foreground: Color = .white,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.tint = tint
        self.foreground = foreground
        self.action = action
    }

    var body: some View {
        Group {
            if #available(watchOS 26.0, *) {
                Button(action: action) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(foreground)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .multilineTextAlignment(.center)
                }
                    .buttonStyle(.glassProminent)
                    .tint(tint)
            } else {
                Button(action: action) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(foreground)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .multilineTextAlignment(.center)
                }
                    .buttonStyle(.borderedProminent)
                    .tint(tint)
            }
        }
        .accessibilityLabel(title)
    }
}

private struct AppleGlassIconControl: ViewModifier {
    func body(content: Content) -> some View {
        Group {
            if #available(watchOS 26.0, *) {
                content
                    .padding(6)
                    .glassEffect(.regular.interactive(), in: .circle)
            } else {
                content
                    .padding(6)
                    .background(.thinMaterial, in: Circle())
            }
        }
    }
}

extension View {
    func appleGlassIconControl() -> some View {
        modifier(AppleGlassIconControl())
    }
}
