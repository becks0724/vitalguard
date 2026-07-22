// PoC 메인 화면 — 파스텔 카드 섹션 레퍼런스. 생체데이터를 메트릭별 카드로 각각 배치 + 수집/전송 상태 + 설정
import SwiftUI
import WatchKit

struct ContentView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var settings: ConnectionSettings
    @State private var showSosConfirm = false
    @State private var showWatchLogoMenu = false

    var body: some View {
        Group {
            if let prompt = workout.activeFallPrompt {
                FallPromptView(prompt: prompt)
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        header
                        dashboardConnectionCard
                        if settings.canManageDashboard {
                            adminOverview
                        }
                        sensorDashboard
                        statusCard
                        actions
                    }
                    .padding(.horizontal, 3)
                    .padding(.bottom, 10)
                }
            }
        }
        .background(WatchTheme.bg)
    }

// MARK: 헤더 — 브랜드 로고 + 워드마크 + 연결 점 + 설정 진입
    private var header: some View {
        HStack(spacing: 6) {
            Button {
                showWatchLogoMenu = true
            } label: {
                Image("BrandLogo")
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .frame(width: 24, height: 24)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .buttonStyle(.plain)
            .appleGlassIconControl()
            VStack(alignment: .leading, spacing: 0) {
                Text("VitAlGuard-\(L(settings.appMode.title))")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.brand)
                    .lineLimit(1)
                    .minimumScaleFactor(0.62)
                Text(settings.loginId.isEmpty ? L("워치 단독 모드") : settings.loginId)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(WatchTheme.muted)
                    .lineLimit(1)
                Text(L(settings.permissionSummary))
                    .font(.system(size: 7, weight: .semibold))
                    .foregroundStyle(settings.canManageDashboard ? WatchTheme.warn : WatchTheme.ok)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Circle()
                .fill(workout.isRunning ? WatchTheme.ok : WatchTheme.muted)
                .frame(width: 6, height: 6)
            NavigationLink {
                SettingsView()
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(WatchTheme.muted)
            }
            .buttonStyle(.plain)
            .appleGlassIconControl()
        }
        .padding(.horizontal, 4)
        .padding(.top, 2)
        .confirmationDialog(L("VitAlGuard 기능"), isPresented: $showWatchLogoMenu) {
            if ConnectionSettings.nfcFeatureEnabled {
                Button(L("NFC 태그 조회(아이폰에서 확인)")) {
                    settings.requestWatchNFCScan()
                }
            }
            Button(L("취소"), role: .cancel) {}
        }
    }

    private var adminOverview: some View {
        WatchCard {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("관리자 관제"))
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                    Text(L("작업자 38명 · CCTV 8대 · 주의 1"))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(WatchTheme.muted)
                        .lineLimit(2)
                }
                Spacer()
                Text("LIVE")
                    .glassButtonStyle(WatchTheme.ok, minWidth: 40)
            }
            HStack(spacing: 6) {
                AdminMiniMetric(title: L("위험"), value: "1", tint: WatchTheme.danger)
                AdminMiniMetric(title: L("주의"), value: "3", tint: WatchTheme.warn)
                AdminMiniMetric(title: L("정상"), value: "34", tint: WatchTheme.ok)
            }
            Text(L("수동 업데이트로 스마트폰 앱과 웹 대시보드에 워치 생체 데이터를 즉시 동기화합니다."))
                .font(.system(size: 10))
                .foregroundStyle(WatchTheme.muted)
                .lineLimit(3)
                .minimumScaleFactor(0.7)
        }
    }

    private var dashboardConnectionCard: some View {
        WatchCard {
            HStack(spacing: 7) {
                DashboardTrafficLight(activeIndex: settings.dashboardConnectionState.activeIndex)
                VStack(alignment: .leading, spacing: 1) {
                    Text(L(settings.dashboardConnectionState.title))
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                        .foregroundStyle(dashboardConnectionColor)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text(L(settings.dashboardConnectionState.detail))
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(WatchTheme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                }
                Spacer(minLength: 2)
                Button {
                    settings.checkDashboardConnection()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .bold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(WatchTheme.muted)
            }
        }
    }

    private var workerModeLabel: some View {
        Text("VitAlGuard-\(L(settings.appMode.title))")
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(WatchTheme.brand)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
    }

    // MARK: 워치 센서 전체 요약 — 폰 앱/웹 대시보드 전송 필드와 같은 순서
    private var sensorDashboard: some View {
        WatchCard {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(L("워치 실측 센서"))
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text(settings.canManageDashboard ? L("실측 센서만 관리자 앱에 연동") : L("실측 센서만 스마트폰 앱에 연동"))
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(WatchTheme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                    Text("\(L("동기화")) \(L(ConnectionSettings.formattedInterval(settings.syncIntervalSeconds)))")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(WatchTheme.muted)
                        .lineLimit(1)
                }
                Spacer(minLength: 2)
                Text(safetyStateLabel)
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(safetyStateColor)
                    .glassButtonStyle(safetyStateColor, minWidth: 44)
            }

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 6),
                    GridItem(.flexible(), spacing: 6)
                ],
                spacing: 6
            ) {
                SensorTile(
                    icon: "heart.fill",
                    title: "심박",
                    value: workout.latestHeartRate.map { "\(Int($0.rounded()))" } ?? "--",
                    unit: "bpm",
                    tint: WatchTheme.heart
                )
                SensorTile(
                    icon: "lungs.fill",
                    title: "SpO₂",
                    value: workout.latestSpO2.map { "\(Int($0.rounded()))" } ?? "--",
                    unit: "%",
                    tint: WatchTheme.spo2
                )
                SensorTile(
                    icon: "waveform.path.ecg",
                    title: "ECG",
                    value: workout.ecgStatusText,
                    unit: "",
                    tint: WatchTheme.ok
                )
                if workout.latestBloodPressureSystolic != nil, workout.latestBloodPressureDiastolic != nil {
                    SensorTile(
                        icon: "heart.text.square.fill",
                        title: "혈압/고혈압",
                        value: workout.bloodPressureAlertText,
                        unit: "mmHg",
                        tint: WatchTheme.warn
                    )
                }
                SensorTile(
                    icon: "thermometer.medium",
                    title: "손목 온도",
                    value: workout.latestWristTemperatureC.map { String(format: "%.1f", $0) } ?? "--",
                    unit: "℃",
                    tint: WatchTheme.warn
                )
                SensorTile(
                    icon: "figure.walk",
                    title: "걸음 수",
                    value: workout.latestSteps.map { "\($0)" } ?? "--",
                    unit: "보",
                    tint: WatchTheme.ok
                )
                SensorTile(
                    icon: "wind",
                    title: "호흡",
                    value: workout.latestRespiratoryRate.map { String(format: "%.1f", $0) } ?? "--",
                    unit: "/분",
                    tint: WatchTheme.spo2
                )
                SensorTile(
                    icon: "mountain.2.fill",
                    title: "고도",
                    value: workout.latestAltitudeMeters.map { String(format: "%.1f", $0) } ?? "--",
                    unit: "m",
                    tint: WatchTheme.spo2
                )
                SensorTile(
                    icon: "barometer",
                    title: "기압",
                    value: workout.latestBarometricPressureKPa.map { String(format: "%.1f", $0) } ?? "--",
                    unit: "kPa",
                    tint: WatchTheme.spo2
                )
                SensorTile(
                    icon: "waveform.path",
                    title: "가속도",
                    value: workout.latestAccelerationMagnitudeG.map { String(format: "%.2f", $0) } ?? "--",
                    unit: "G",
                    tint: WatchTheme.warn
                )
                SensorTile(
                    icon: "flame.fill",
                    title: "활동량",
                    value: workout.latestActiveEnergyKcal.map { String(format: "%.0f", $0) } ?? "--",
                    unit: "kcal",
                    tint: WatchTheme.warn
                )
                SensorTile(
                    icon: "figure.walk.motion",
                    title: "운동 링",
                    value: workout.latestExerciseTimeMinutes.map { String(format: "%.0f", $0) } ?? "--",
                    unit: "분",
                    tint: WatchTheme.ok
                )
                SensorTile(
                    icon: "flame.circle.fill",
                    title: "움직임 링",
                    value: workout.latestMoveTimeMinutes.map { String(format: "%.0f", $0) } ?? "--",
                    unit: "분",
                    tint: WatchTheme.warn
                )
                SensorTile(
                    icon: "figure.stand",
                    title: "서기 링",
                    value: workout.latestStandTimeMinutes.map { String(format: "%.0f", $0) } ?? "--",
                    unit: "분",
                    tint: WatchTheme.ok
                )
                SensorTile(
                    icon: "waveform.path",
                    title: "HRV",
                    value: workout.latestHRV.map { String(format: "%.0f", $0) } ?? "--",
                    unit: "ms",
                    tint: WatchTheme.ok
                )
                SensorTile(
                    icon: "bed.double.fill",
                    title: "수면 무호흡",
                    value: workout.latestSleepingBreathingDisturbancesStatus,
                    unit: "",
                    tint: workout.latestSleepingBreathingDisturbancesStatus == "높음" ? WatchTheme.danger : WatchTheme.spo2
                )
                SensorTile(
                    icon: "figure.fall",
                    title: "낙상",
                    value: workout.fallCount > 0 ? "\(workout.fallCount)" : "정상",
                    unit: workout.fallCount > 0 ? "건" : "",
                    tint: workout.fallCount > 0 ? WatchTheme.danger : WatchTheme.ok
                )
                SensorTile(
                    icon: "battery.100percent",
                    title: "배터리",
                    value: batteryText,
                    unit: "%",
                    tint: WatchTheme.ok
                )
            }
        }
    }

    // MARK: 수집/전송 상태 (다크 카드)
    private var statusCard: some View {
        WatchCard {
            HStack {
                Text("\(L("전송 건수")) \(workout.sentCount)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer()
                Text("\(L("산업안전")) \(L(safetyStateLabel))")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(safetyStateColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if workout.bufferedCount > 0 {
                    Text("\(L("버퍼")) \(workout.bufferedCount)")
                        .font(.system(size: 11))
                        .foregroundStyle(WatchTheme.warn)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            Text("\(L("폰 앱 · 웹 대시보드")): \(L(workout.lastStatus))")
                .font(.system(size: 11))
                .foregroundStyle(WatchTheme.muted)
                .lineLimit(2)
                .minimumScaleFactor(0.65)
            if ConnectionSettings.nfcFeatureEnabled {
                Text(L("워치 NFC 탭은 아이폰에서 태그 정보를 조회·표시합니다."))
                    .font(.system(size: 10))
                    .foregroundStyle(WatchTheme.muted)
                    .lineLimit(2)
                    .minimumScaleFactor(0.65)
            }
            Text("\(L("걸음")) \(workout.latestSteps.map { "\($0)" } ?? "--") · HRV \(workout.latestHRV.map { String(format: "%.0fms", $0) } ?? "--") · \(L("동기화")) \(L(ConnectionSettings.formattedInterval(settings.syncIntervalSeconds)))")
                .font(.system(size: 10))
                .foregroundStyle(WatchTheme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            if workout.isRunning {
                Text(L("값이 없거나 지원되지 않는 센서는 --로 표시"))
                    .font(.system(size: 10))
                    .foregroundStyle(WatchTheme.muted)
                    .lineLimit(2)
                    .minimumScaleFactor(0.65)
            }
            if let err = workout.lastError {
                Text(L(err))
                    .font(.system(size: 11))
                    .foregroundStyle(WatchTheme.warn)
                    .lineLimit(2)
                    .minimumScaleFactor(0.65)
            }
        }
    }

    private var batteryText: String {
        let level = WKInterfaceDevice.current().batteryLevel
        guard level >= 0 else { return "--" }
        return "\(Int((level * 100).rounded()))"
    }

    // MARK: 액션 버튼
    @ViewBuilder
    private var actions: some View {
        AppleGlassActionGroup {
            if !workout.authorized {
                AppleGlassActionButton(
                    title: L("산업센서 권한 요청"),
                    tint: WatchTheme.brand,
                    foreground: WatchTheme.ink
                ) {
                    Task { await workout.requestAuthorization() }
                }
            } else if workout.isRunning {
                AppleGlassActionButton(
                    title: L("수동 업데이트"),
                    tint: WatchTheme.manualUpdateSurface,
                    foreground: WatchTheme.manualUpdateText
                ) {
                    workout.manualSyncNow()
                }
                AppleGlassActionButton(title: "🆘 \(L("SOS 전송"))", tint: WatchTheme.danger) {
                    showSosConfirm = true
                }
                .confirmationDialog(
                    L("산업 비상 SOS를 전송할까요?"),
                    isPresented: $showSosConfirm,
                    titleVisibility: .visible
                ) {
                    Button(L("SOS 전송"), role: .destructive) { workout.sendSos() }
                    Button(L("취소"), role: .cancel) {}
                }
                AppleGlassActionButton(
                    title: L("수집 정지"),
                    tint: WatchTheme.warn,
                    foreground: WatchTheme.ink
                ) {
                    workout.stop()
                }
                AppleGlassActionButton(
                    title: L("낙상 시연(수동)"),
                    tint: WatchTheme.warn,
                    foreground: WatchTheme.ink
                ) {
                    workout.simulateFall()
                }
            } else {
                AppleGlassActionButton(
                    title: L("산업 모니터링 시작"),
                    tint: WatchTheme.ok,
                    foreground: WatchTheme.ink
                ) {
                    workout.start()
                }
                AppleGlassActionButton(
                    title: L("수동 업데이트"),
                    tint: WatchTheme.manualUpdateSurface,
                    foreground: WatchTheme.manualUpdateText
                ) {
                    workout.manualSyncNow()
                }
            }
        }
    }

    private var safetyStateLabel: String {
        guard let hr = workout.latestHeartRate, let spo2 = workout.latestSpO2 else {
            return "대기"
        }
        if hr > 125 || spo2 < 91 {
            return "위험"
        }
        if hr > 108 || spo2 < 95 {
            return "주의"
        }
        return "정상"
    }

    private var safetyStateColor: Color {
        switch safetyStateLabel {
        case "위험":
            return WatchTheme.danger
        case "주의":
            return WatchTheme.warn
        case "정상":
            return WatchTheme.ok
        default:
            return WatchTheme.muted
        }
    }

    private var dashboardConnectionColor: Color {
        switch settings.dashboardConnectionState {
        case .connected:
            return WatchTheme.ok
        case .delayed:
            return WatchTheme.warn
        case .offline:
            return WatchTheme.danger
        }
    }

    private func L(_ text: String) -> String {
        settings.localized(text)
    }
}

private struct DashboardTrafficLight: View {
    let activeIndex: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(color(for: index).opacity(index == activeIndex ? 1 : 0.24))
                    .frame(width: 7, height: 7)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 5)
        .background(Color.white.opacity(0.08), in: Capsule())
    }

    private func color(for index: Int) -> Color {
        switch index {
        case 0: return WatchTheme.ok
        case 1: return WatchTheme.warn
        default: return WatchTheme.danger
        }
    }
}

private struct FallPromptView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var settings: ConnectionSettings
    let prompt: WorkoutManager.ActiveFallPrompt

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                WatchCard {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("낙상 확인"))
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white)
                            Text(L("응답 없으면 자동 경보"))
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(WatchTheme.warn)
                        }
                        Spacer()
                        Text("\(prompt.remainingSec)")
                            .font(.system(size: 28, weight: .heavy, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        PromptMetricRow(label: L("충격"), value: String(format: "%.1fG", prompt.peakG))
                        PromptMetricRow(label: L("정지"), value: String(format: "%.1fs", prompt.stillSec))
                        PromptMetricRow(label: L("회전"), value: String(format: "%.1f", prompt.peakRotationRadS))
                        PromptMetricRow(
                            label: L("심박"),
                            value: prompt.startedHeartRate.map { "\(Int($0.rounded())) bpm" } ?? "--"
                        )
                    }
                }

                Button(L("괜찮음 · 해제")) {
                    workout.dismissActiveFallPrompt()
                }
                .tint(WatchTheme.ok)

                Button(L("도움 요청 · SOS")) {
                    workout.escalateActiveFallPromptToSos()
                }
                .tint(WatchTheme.danger)
            }
            .padding(.horizontal, 3)
            .padding(.vertical, 10)
        }
        .background(WatchTheme.bg)
    }

    private func L(_ text: String) -> String {
        settings.localized(text)
    }
}

private struct PromptMetricRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(WatchTheme.muted)
            Spacer()
            Text(value)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
    }
}

private struct SensorTile: View {
    @EnvironmentObject private var settings: ConnectionSettings
    let icon: String
    let title: String
    let value: String
    let unit: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(tint)
                Text(settings.localized(title))
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(WatchTheme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: value.count > 5 ? 12 : 16, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if !unit.isEmpty {
                    Text(settings.localized(unit))
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(tint)
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(WatchTheme.contentStroke, lineWidth: 0.6)
        )
    }
}

private struct AdminMiniMetric: View {
    @EnvironmentObject private var settings: ConnectionSettings
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(settings.localized(title))
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(WatchTheme.muted)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 17, weight: .heavy, design: .rounded))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(WatchTheme.contentStroke, lineWidth: 0.6)
        )
    }
}

// 파스텔 카드 섹션 — 아이콘 칩 + 제목 + 큰 값 + 보조 라벨. 위험 판정색 없음(raw 표시).
private struct MetricCard: View {
    @EnvironmentObject private var settings: ConnectionSettings
    let bg: Color
    let icon: String
    let iconTint: Color
    let title: String
    let subtitle: String
    let value: String
    var unit: String = ""
    var footnote: String? = nil

    var body: some View {
        WatchPanel {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    ZStack {
                        Circle().fill(bg.opacity(0.9)).frame(width: 30, height: 30)
                        Image(systemName: icon)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(iconTint)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Text(settings.localized(title))
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(WatchTheme.ink.opacity(0.95))
                        Text(settings.localized(subtitle))
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(WatchTheme.ink.opacity(0.58))
                    }
                    Spacer()
                }
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(value)
                        .font(.system(size: 30, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(WatchTheme.ink)
                    if !unit.isEmpty {
                        Text(settings.localized(unit))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(WatchTheme.ink.opacity(0.6))
                    }
                    Spacer()
                }
                if let footnote {
                    Text(settings.localized(footnote))
                        .font(.system(size: 10))
                        .foregroundStyle(WatchTheme.ink.opacity(0.6))
                }
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity)
    }
}
