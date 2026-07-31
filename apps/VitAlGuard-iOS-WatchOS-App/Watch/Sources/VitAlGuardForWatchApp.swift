// watchOS PoC 앱 진입점 — WorkoutManager + ConnectionSettings 를 환경 객체로 주입, 설정 네비게이션
import AppIntents
import SwiftUI
import Security

@MainActor
final class VitAlGuardWatchAppDelegate: NSObject, WKApplicationDelegate {
    let workout = WorkoutManager()

    func handleActiveWorkoutRecovery() {
        workout.recoverActiveWorkoutSession()
    }
}

@main
struct VitAlGuardForWatchApp: App {
    @WKApplicationDelegateAdaptor private var appDelegate: VitAlGuardWatchAppDelegate
    @StateObject private var settings = ConnectionSettings()
    init() {
        removeLegacyWatchAppLockArtifacts()
    }

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ContentView()
            }
            .environmentObject(appDelegate.workout)
            .environmentObject(settings)
        }
    }
}

private func removeLegacyWatchAppLockArtifacts() {
    let service = "com.yangjeehoo.vitalguard.watch.app-lock.v84"
    let account = "pin-verifier"
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account
    ]
    SecItemDelete(query as CFDictionary)
}
