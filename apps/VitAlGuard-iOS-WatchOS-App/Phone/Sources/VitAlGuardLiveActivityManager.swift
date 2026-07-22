import ActivityKit
import Foundation
import UIKit

@available(iOS 16.2, *)
@MainActor
final class VitAlGuardLiveActivityManager {
    static let shared = VitAlGuardLiveActivityManager()
    private var activity: Activity<VitAlGuardActivityAttributes>?
    private var allowsActivity = true

    private init() {}

    func refresh(loginId: String, mode: AppMode) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        allowsActivity = true
        let state = contentState(loginId: loginId, mode: mode)
        Task {
            guard self.allowsActivity else { return }
            let currentActivity = self.activity ?? Activity<VitAlGuardActivityAttributes>.activities.first
            if self.activity == nil {
                self.activity = currentActivity
            }
            if let currentActivity {
                await currentActivity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(60)))
                return
            }
            guard self.allowsActivity else { return }
            do {
                self.activity = try Activity.request(
                    attributes: VitAlGuardActivityAttributes(userId: loginId.isEmpty ? "vitalguard" : loginId),
                    content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(60)),
                    pushType: nil
                )
            } catch {
                print("VitAlGuard live activity request failed: \(error.localizedDescription)")
            }
        }
    }

    func showFallConfirmation(loginId: String, workerName: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        allowsActivity = true
        let state = VitAlGuardActivityAttributes.ContentState(
            mode: AppMode.worker.rawValue,
            title: "낙상이 감지되었습니다",
            status: "위급한 상황이신가요?",
            detail: "앱 알림에서 예 / 아니오를 선택하세요 · \(workerName.isEmpty ? "Apple Watch" : workerName)",
            safetyIndex: 12,
            updatedAt: Date(),
            interfaceStyle: Self.currentInterfaceStyle()
        )
        Task {
            guard self.allowsActivity else { return }
            let currentActivity = self.activity ?? Activity<VitAlGuardActivityAttributes>.activities.first
            if self.activity == nil {
                self.activity = currentActivity
            }
            if let currentActivity {
                await currentActivity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(120)))
                return
            }
            do {
                self.activity = try Activity.request(
                    attributes: VitAlGuardActivityAttributes(userId: loginId.isEmpty ? "vitalguard-fall" : loginId),
                    content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(120)),
                    pushType: nil
                )
            } catch {
                print("VitAlGuard fall live activity request failed: \(error.localizedDescription)")
            }
        }
    }

    func end() {
        allowsActivity = false
        let rememberedActivity = activity
        let activeActivities = Activity<VitAlGuardActivityAttributes>.activities
        Task {
            if let rememberedActivity {
                await rememberedActivity.end(nil, dismissalPolicy: .immediate)
            }
            for activeActivity in activeActivities where activeActivity.id != rememberedActivity?.id {
                await activeActivity.end(nil, dismissalPolicy: .immediate)
            }
        }
        self.activity = nil
    }

    private func contentState(loginId: String, mode: AppMode) -> VitAlGuardActivityAttributes.ContentState {
        let interfaceStyle = Self.currentInterfaceStyle()
        switch mode {
        case .admin:
            return .init(
                mode: mode.rawValue,
                title: "현장 통합 안전 신호등",
                status: "종합 위험",
                detail: "현장 기상 대기 · 작업자 대기 · 가스 감지 위험 · AED 위험",
                safetyIndex: 68,
                updatedAt: Date(),
                interfaceStyle: interfaceStyle
            )
        case .worker:
            return .init(
                mode: mode.rawValue,
                title: "작업 안전지수",
                status: "86 정상",
                detail: "SOS · 관리자 호출 · 위치 공유",
                safetyIndex: 86,
                updatedAt: Date(),
                interfaceStyle: interfaceStyle
            )
        }
    }

    private static func currentInterfaceStyle() -> String {
        let style = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }?
            .traitCollection.userInterfaceStyle ?? UITraitCollection.current.userInterfaceStyle
        switch style {
        case .dark: return "dark"
        case .light: return "light"
        default: return "system"
        }
    }
}
