// 워치 인앱 설정 — 수신 서버 URL 편집 + 연결 테스트(재빌드·재설치 없이 터널 URL 교체)
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: ConnectionSettings
    @EnvironmentObject private var workout: WorkoutManager

    @State private var testResult: String?
    @State private var testing = false

    var body: some View {
        List {
            Section("수신 서버 URL") {
                TextField("https://….trycloudflare.com/api/mock/vital", text: $settings.urlString)
                    .font(.caption2)
                    .textInputAutocapitalization(.never)
                Button("기본값으로 되돌리기") {
                    settings.urlString = ConnectionSettings.bundledDefaultURLString()
                    testResult = nil
                }
                .font(.caption2)
                .tint(WatchTheme.muted)
            }

            Section("연결 테스트") {
                Button {
                    testing = true
                    testResult = nil
                    Task {
                        let result = await workout.testConnection()
                        testResult = result
                        testing = false
                    }
                } label: {
                    HStack {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                        Text("수신 확인")
                        if testing { Spacer(); ProgressView() }
                    }
                }
                .tint(WatchTheme.brand)

                if let testResult {
                    Text(testResult)
                        .font(.caption2)
                        .foregroundStyle(testResult.hasPrefix("연결 OK") ? WatchTheme.ok : WatchTheme.danger)
                }
            }

            Section("작업자") {
                TextField("이름", text: $settings.workerName)
                    .font(.caption2)
                TextField("사원번호", text: $settings.employeeId)
                    .font(.caption2)
                    .textInputAutocapitalization(.characters)
                Text("식별자: \(ConnectionSettings.currentWorkerId())")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("설정")
    }
}
