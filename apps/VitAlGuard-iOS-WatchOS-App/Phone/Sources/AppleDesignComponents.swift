import UIKit

/// iOS 26 Liquid Glass를 탐색과 조작 요소에만 일관되게 적용한다.
enum AppleDesignGlass {
    private static let effectViewTag = 264_640

    static func apply(
        to view: UIView,
        cornerRadius: CGFloat,
        tint: UIColor? = nil,
        isInteractive: Bool
    ) {
        view.subviews
            .filter { $0.tag == effectViewTag }
            .forEach { $0.removeFromSuperview() }

        let effectView: UIVisualEffectView
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect(style: .regular)
            effect.tintColor = tint
            effect.isInteractive = isInteractive
            effectView = UIVisualEffectView(effect: effect)
        } else {
            effectView = UIVisualEffectView(
                effect: UIBlurEffect(style: .systemThinMaterial)
            )
        }

        effectView.tag = effectViewTag
        effectView.translatesAutoresizingMaskIntoConstraints = false
        effectView.isUserInteractionEnabled = false
        effectView.layer.cornerRadius = cornerRadius
        effectView.layer.cornerCurve = .continuous
        effectView.clipsToBounds = true

        view.insertSubview(effectView, at: 0)
        NSLayoutConstraint.activate([
            effectView.topAnchor.constraint(equalTo: view.topAnchor),
            effectView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            effectView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            effectView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        view.backgroundColor = .clear
        view.layer.cornerRadius = cornerRadius
        view.layer.cornerCurve = .continuous
        view.layer.borderWidth = 0
        view.clipsToBounds = true
    }
}
