// 워치 인앱 설정 — 앱 관리형 연동 URL 표시와 iPhone 릴레이 연결 테스트
import SwiftUI
import Foundation

struct SettingsView: View {
    @EnvironmentObject private var settings: ConnectionSettings
    @EnvironmentObject private var workout: WorkoutManager

    @State private var testResult: WatchRelayConnectionResult?
    @State private var testing = false
    @State private var phoneSyncMessage: String?

    var body: some View {
        List {
            Section(L("앱 정보")) {
                HStack {
                    Text(L("Apple Watch 앱"))
                    Spacer()
                    Text("\(L("버전")) \(appVersion) · \(L("빌드")) \(appBuild)")
                        .foregroundStyle(WatchTheme.muted)
                        .monospacedDigit()
                }
                .font(.caption2.weight(.semibold))

                NavigationLink {
                    WatchDeveloperModeView()
                } label: {
                    HStack {
                        Text(L("개발자 모드"))
                        Spacer()
                        Text(settings.isWatchDeveloperModeEnabled ? L("켜짐") : L("꺼짐"))
                            .foregroundStyle(settings.isWatchDeveloperModeEnabled ? WatchTheme.ok : WatchTheme.muted)
                    }
                    .font(.caption2.weight(.semibold))
                }
            }

            Section(L("iPhone 계정 연동")) {
                HStack {
                    Text(settings.loginId.isEmpty ? L("워치 단독 모드") : settings.loginId)
                    Spacer()
                    Text(L(settings.serverRoleTitle))
                        .foregroundStyle(settings.canManageDashboard ? WatchTheme.warn : WatchTheme.ok)
                }
                .font(.caption2.weight(.semibold))

                Text(L(settings.permissionSummary))
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)

                Button {
                    settings.syncLoginFromPhone()
                    phoneSyncMessage = L("iPhone 로그인 정보를 동기화하는 중입니다.")
                } label: {
                    HStack {
                        Image(systemName: "iphone.and.arrow.forward")
                        Text(L("iPhone 로그인 동기화"))
                    }
                }
                .tint(WatchTheme.brand)

                if let phoneSyncMessage {
                    Text(phoneSyncMessage)
                        .font(.caption2)
                        .foregroundStyle(WatchTheme.muted)
                }
            }

            Section(L("연동 URL")) {
                Text(settings.urlString)
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)
                Text(L("보안을 위해 앱에서 관리되는 HTTPS 주소이며 수정할 수 없습니다."))
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)
            }

            Section(L("GPS 항상 허용")) {
                HStack {
                    Text(L("현재"))
                    Spacer()
                    Text(L(workout.locationPermissionText))
                        .foregroundStyle(workout.locationPermissionText == "항상 허용" ? WatchTheme.ok : WatchTheme.warn)
                }
                .font(.caption2.weight(.semibold))

                Button {
                    workout.requestAlwaysLocationPermission()
                } label: {
                    HStack {
                        Image(systemName: "location.circle")
                        Text(L("항상 허용 요청"))
                    }
                }
                .tint(WatchTheme.brand)

                Text(L("잠금 중 GPS와 생체 데이터 전송을 유지하려면 Watch 설정에서도 위치 권한을 허용해 주세요."))
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)
            }

            Section(L("연결 테스트")) {
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
                        Text(L("연동 확인"))
                        if testing { Spacer(); ProgressView() }
                    }
                }
                .tint(WatchTheme.brand)

                if let testResult {
                    Text(L(testResult.message))
                        .font(.caption2)
                        .foregroundStyle(testResult.isSuccess ? WatchTheme.ok : WatchTheme.danger)
                }
            }

            Section(L("배터리 및 센서")) {
                Picker(L("전력 모드"), selection: $settings.sensorPowerMode) {
                    ForEach(WatchSensorPowerMode.allCases, id: \.self) { mode in
                        Text(L(mode.title)).tag(mode)
                    }
                }

                Text(L(settings.sensorPowerMode.detail))
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)
            }

            Section(L("워치 데이터 연동 주기")) {
                Toggle(L("시간 기반 업데이트"), isOn: $settings.timeBasedUpdatesEnabled)

                Text(L("켜면 아래 주기마다 상태를 배치 전송합니다."))
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)

                NavigationLink {
                    SyncIntervalPickerView(intervalSeconds: $settings.syncIntervalSeconds)
                } label: {
                    HStack {
                        Text(L("현재"))
                        Spacer()
                        Text(L(ConnectionSettings.formattedInterval(settings.syncIntervalSeconds)))
                            .foregroundStyle(WatchTheme.brand)
                    }
                    .font(.caption2.weight(.semibold))
                }

                HStack {
                    Button(L("1분")) { settings.syncIntervalSeconds = 60 }
                    Button(L("2분")) { settings.syncIntervalSeconds = 120 }
                    Button(L("5분")) { settings.syncIntervalSeconds = 300 }
                }
                .font(.caption2)
            }

            Section(L("위치 기반 업데이트")) {
                Toggle(L("기준 위치 이탈 시 업데이트"), isOn: $settings.locationBasedUpdatesEnabled)

                if settings.locationBasedUpdatesEnabled {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(L("이탈 반경"))
                            Spacer()
                            Text("\(Int(settings.locationUpdateRadiusMeters))m")
                                .foregroundStyle(WatchTheme.brand)
                        }
                        Slider(value: $settings.locationUpdateRadiusMeters, in: 100...5_000, step: 100)
                    }
                    .font(.caption2.weight(.semibold))

                    Text(L("연속 GPS 대신 기준 위치 반경을 벗어날 때만 현재 위치와 워치 상태를 갱신합니다."))
                        .font(.caption2)
                        .foregroundStyle(WatchTheme.muted)
                }
            }

            Section(L("언어")) {
                HStack {
                    Text(L("iPhone 앱 설정"))
                    Spacer()
                    Text(settings.languageCode.isEmpty ? L("시스템 설정") : settings.languageCode)
                        .foregroundStyle(WatchTheme.brand)
                }
                .font(.caption2.weight(.semibold))
                Text(L("워치 앱 언어는 iPhone 앱 또는 iPhone 설정 앱의 VitAlGuard 언어 설정을 동기화해 따릅니다."))
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)
            }

            Section(L("작업자 프로필")) {
                TextField(L("작업자명"), text: $settings.workerName)
                    .font(.caption2)
                TextField(L("사원번호"), text: $settings.employeeId)
                    .font(.caption2)
                    .textInputAutocapitalization(.characters)
                Text("\(L("식별자")): \(ConnectionSettings.currentWorkerId())")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(L("VitAlGuard 설정"))
    }

    private func L(_ text: String) -> String {
        settings.localized(text)
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-"
    }

    private var appBuild: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "-"
    }
}

private struct SyncIntervalPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var settings: ConnectionSettings
    @Binding var intervalSeconds: Double

    @State private var minutes = 0.0
    @State private var seconds = 10.0
    @FocusState private var focusedUnit: SyncUnit?

    private enum SyncUnit {
        case minutes
        case seconds
    }

    var body: some View {
        ZStack {
            ZStack {
                CrownTickRing()

                VStack(spacing: 0) {
                    Text("00")
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                    Text(settings.localized("연동 주기"))
                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                        .foregroundStyle(WatchTheme.muted)
                        .padding(.top, 16)
                    Spacer()
                    Text("30")
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                }
                .frame(height: 140)

                MinuteMarkerLabels()

                HStack(spacing: 6) {
                    TimeUnitBox(
                        value: Int(minutes),
                        isFocused: focusedUnit == .minutes
                    )
                    .onTapGesture { focusedUnit = .minutes }
                    .focusable(true)
                    .focused($focusedUnit, equals: .minutes)
                    .digitalCrownRotation(
                        $minutes,
                        from: 0,
                        through: 59,
                        by: 1,
                        sensitivity: .medium,
                        isContinuous: false,
                        isHapticFeedbackEnabled: true
                    )

                    Text(":")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    TimeUnitBox(
                        value: Int(seconds),
                        isFocused: focusedUnit == .seconds
                    )
                    .onTapGesture { focusedUnit = .seconds }
                    .focusable(true)
                    .focused($focusedUnit, equals: .seconds)
                    .digitalCrownRotation(
                        $seconds,
                        from: 0,
                        through: 59,
                        by: 1,
                        sensitivity: .medium,
                        isContinuous: false,
                        isHapticFeedbackEnabled: true
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack {
                Spacer()
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 24, weight: .medium))
                            .frame(width: 48, height: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(WatchTheme.surface)

                    Spacer()

                    Button {
                        applyInterval()
                    } label: {
                        Image(systemName: "checkmark")
                            .font(.system(size: 26, weight: .medium))
                            .frame(width: 48, height: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(WatchTheme.surface)
                    .foregroundStyle(WatchTheme.ok)
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 2)
            }
        }
        .background(Color.black)
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            let value = Int(ConnectionSettings.clampedSyncInterval(intervalSeconds))
            minutes = Double(value / 60)
            seconds = Double(value % 60)
            focusedUnit = .seconds
        }
    }

    private var totalSeconds: Double {
        ConnectionSettings.clampedSyncInterval(minutes * 60 + seconds)
    }

    private func applyInterval() {
        intervalSeconds = totalSeconds
        dismiss()
    }
}

private struct TimeUnitBox: View {
    let value: Int
    let isFocused: Bool

    var body: some View {
        Text(String(format: "%02d", value))
            .font(.system(size: 40, weight: .regular, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(.white)
            .minimumScaleFactor(0.7)
            .frame(width: 72, height: 58)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.black.opacity(0.44))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(isFocused ? WatchTheme.ok : Color.white.opacity(0.55), lineWidth: isFocused ? 2.5 : 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct CrownTickRing: View {
    var body: some View {
        ZStack {
            ForEach(0..<60, id: \.self) { tick in
                Rectangle()
                    .fill(tick % 5 == 0 ? Color.white.opacity(0.92) : Color.white.opacity(0.30))
                    .frame(width: tick % 5 == 0 ? 2 : 1, height: tick % 5 == 0 ? 13 : 8)
                    .offset(y: -76)
                    .rotationEffect(.degrees(Double(tick) * 6))
            }
        }
        .frame(width: 170, height: 170)
    }
}

private struct MinuteMarkerLabels: View {
    private let markers: [(String, CGFloat, CGFloat)] = [
        ("55", -36, -62),
        ("05", 36, -62),
        ("50", -72, -26),
        ("10", 72, -26),
        ("45", -80, 18),
        ("15", 80, 18),
        ("40", -58, 58),
        ("20", 58, 58),
        ("35", -30, 80),
        ("25", 30, 80)
    ]

    var body: some View {
        ZStack {
            ForEach(markers, id: \.0) { marker in
                Text(marker.0)
                    .font(.system(size: 18, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .offset(x: marker.1, y: marker.2)
            }
        }
        .frame(width: 170, height: 170)
    }
}


private struct WatchDeveloperModeView: View {
    @EnvironmentObject private var settings: ConnectionSettings
    var body: some View {
        List {
            Section("개발자 모드") {
                Toggle("개발자 모드", isOn: $settings.watchDeveloperModeEnabled)
                    .disabled(!settings.canManageDashboard)
                Text(settings.isWatchDeveloperModeEnabled ? "켜짐 · 이 Apple Watch에서만 적용됨" : "꺼짐")
                    .foregroundStyle(settings.isWatchDeveloperModeEnabled ? WatchTheme.ok : WatchTheme.muted)
                if settings.isWatchDeveloperModeEnabled {
                    Button("개발자 모드 끄기", role: .destructive) {
                        settings.watchDeveloperModeEnabled = false
                    }
                }
                if !settings.canManageDashboard {
                    Text("개발자 모드는 관리자 계정에서만 켤 수 있습니다.")
                        .font(.caption2)
                        .foregroundStyle(WatchTheme.danger)
                }
                Text("보안을 위해 DB 주소, API 키, 로그인 토큰은 워치에서 보거나 입력할 수 없습니다. 서버 및 연동 URL은 인증된 iPhone 관리자 앱에서만 변경됩니다.")
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)
            }
            Section("동기화된 연동 정보") {
                Text(settings.urlString).font(.caption2)
                Text(settings.dashboardURLString).font(.caption2).foregroundStyle(WatchTheme.muted)
            }
        }
        .navigationTitle("개발자 모드")
    }
}
