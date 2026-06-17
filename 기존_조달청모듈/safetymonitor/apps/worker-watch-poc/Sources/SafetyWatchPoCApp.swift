// watchOS PoC 앱 진입점 — WorkoutManager + ConnectionSettings 를 환경 객체로 주입, 설정 네비게이션
import SwiftUI

@main
struct SafetyWatchPoCApp: App {
    @StateObject private var workout = WorkoutManager()
    @StateObject private var settings = ConnectionSettings()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ContentView()
            }
            .environmentObject(workout)
            .environmentObject(settings)
        }
    }
}
