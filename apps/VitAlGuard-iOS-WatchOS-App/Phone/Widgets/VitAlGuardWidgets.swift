import ActivityKit
import AppIntents
import SwiftUI
import UIKit
import WidgetKit

struct RefreshDashboardIntent: AppIntent {
    static var title: LocalizedStringResource = "실시간 새로고침"
    static var description = IntentDescription("위젯과 실시간 현황을 새로고침합니다. 관제 저장은 Apple Watch 실측 데이터만 사용합니다.")

    func perform() async throws -> some IntentResult {
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

enum WorkerDashboardAction: String, AppEnum {
    case sos
    case callManager
    case shareLocation

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "근로자 액션")
    static var caseDisplayRepresentations: [WorkerDashboardAction: DisplayRepresentation] = [
        .sos: "SOS",
        .callManager: "관리자 호출",
        .shareLocation: "위치 공유"
    ]

    var reason: String {
        switch self {
        case .sos: return "live_activity_sos"
        case .callManager: return "live_activity_manager_call"
        case .shareLocation: return "live_activity_location_share"
        }
    }
}

struct WorkerDashboardActionIntent: AppIntent {
    static var title: LocalizedStringResource = "작업자 안전 액션"
    static var description = IntentDescription("잠금화면과 Dynamic Island에서 작업자 안전 액션 상태를 갱신합니다.")

    @Parameter(title: "액션")
    var action: WorkerDashboardAction

    init() {
        action = .sos
    }

    init(action: WorkerDashboardAction) {
        self.action = action
    }

    func perform() async throws -> some IntentResult {
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct VitAlGuardSOSQuickIntent: AppIntent {
    static var title: LocalizedStringResource = "VitAlGuard SOS"
    static var description = IntentDescription("VitAlGuard 앱을 열고 SOS 전송을 준비합니다.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        VitAlGuardSharedStorage.saveQuickAction(.sos)
        return .result(dialog: "VitAlGuard SOS를 실행합니다.")
    }
}

struct VitAlGuardManagerCallQuickIntent: AppIntent {
    static var title: LocalizedStringResource = "VitAlGuard 관리자 호출"
    static var description = IntentDescription("VitAlGuard 앱을 열고 관리자 호출을 실행합니다.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        VitAlGuardSharedStorage.saveQuickAction(.callManager)
        return .result(dialog: "관리자 호출을 실행합니다.")
    }
}

struct VitAlGuardLocationShareQuickIntent: AppIntent {
    static var title: LocalizedStringResource = "VitAlGuard 위치 공유"
    static var description = IntentDescription("VitAlGuard 앱을 열고 현재 위치 공유를 실행합니다.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        VitAlGuardSharedStorage.saveQuickAction(.shareLocation)
        return .result(dialog: "위치 공유를 실행합니다.")
    }
}

struct VitAlGuardCameraQuickIntent: AppIntent {
    static var title: LocalizedStringResource = "VitAlGuard 증빙 촬영"
    static var description = IntentDescription("VitAlGuard 앱을 열고 사진 증빙 촬영을 시작합니다.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        VitAlGuardSharedStorage.saveQuickAction(.openCamera)
        return .result(dialog: "증빙 촬영을 실행합니다.")
    }
}

struct VitAlGuardAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: VitAlGuardSOSQuickIntent(),
            phrases: ["\(.applicationName) SOS", "\(.applicationName) 긴급 호출"],
            shortTitle: "SOS",
            systemImageName: "sos"
        )
        AppShortcut(
            intent: VitAlGuardManagerCallQuickIntent(),
            phrases: ["\(.applicationName) 관리자 호출"],
            shortTitle: "관리자 호출",
            systemImageName: "person.wave.2.fill"
        )
        AppShortcut(
            intent: VitAlGuardLocationShareQuickIntent(),
            phrases: ["\(.applicationName) 위치 공유"],
            shortTitle: "위치 공유",
            systemImageName: "location.fill"
        )
        AppShortcut(
            intent: VitAlGuardCameraQuickIntent(),
            phrases: ["\(.applicationName) 증빙 촬영"],
            shortTitle: "증빙 촬영",
            systemImageName: "camera.fill"
        )
    }
}

struct VitAlGuardEntry: TimelineEntry {
    let date: Date
    let mode: AppMode
    let safetyIndex: Int
    let heartRate: String
    let spo2: String
    let steps: String
    let wristTemperature: String
    let status: String
    let walletName: String
    let walletEmployeeId: String
    let walletQRPNGData: Data?
    let walletBarcodePNGData: Data?
}

private func watchValue(_ values: [String: Any], key: String) -> String {
    if let intValue = values[key] as? Int { return "\(intValue)" }
    if let doubleValue = values[key] as? Double { return String(format: "%.0f", doubleValue) }
    if let stringValue = values[key] as? String, !stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, stringValue != "--" {
        return stringValue
    }
    return "--"
}

private func watchTemperatureValue(_ values: [String: Any]) -> String {
    func parseTemperatureString(_ stringValue: String) -> String? {
        let normalized = stringValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: ",", with: ".")
            .replacingOccurrences(of: "℃", with: "")
            .replacingOccurrences(of: "°C", with: "")
            .replacingOccurrences(of: "°", with: "")
            .replacingOccurrences(of: "C", with: "")
            .replacingOccurrences(of: "c", with: "")
            .replacingOccurrences(of: "F", with: "")
            .replacingOccurrences(of: "f", with: "")
            .replacingOccurrences(of: "℃", with: "")
        return Double(normalized).map { String(format: "%.1f", $0) }
    }

    let wristTemperatureKeys = [
        "wristTemperatureC",
        "skinTempC",
        "skin_temp_c",
        "wristTemperature",
        "wristTempC",
        "wristTemp",
        "wrist_temp_c",
        "wrist_temp",
        "skinTemperatureC",
        "skinTemperature",
        "skin_temp",
        "bodyTempC",
        "bodyTemperatureC",
        "bodyTemp",
        "bodyTemperatureCelsius",
        "bodyTemperatureC",
        "body_temp_c",
        "body_temp",
        "bodyTemperature",
        "skinTemp",
        "bodytemperature"
    ]
    var rawValue: Any?
    for key in wristTemperatureKeys {
        if let value = values[key] {
            rawValue = value
            break
        }
    }
    if let doubleValue = rawValue as? Double { return String(format: "%.1f", doubleValue) }
    if let intValue = rawValue as? Int { return "\(intValue)" }
    if let stringValue = rawValue as? String, !stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, stringValue != "--" {
        return parseTemperatureString(stringValue) ?? stringValue.replacingOccurrences(of: "℃", with: "")
    }
    return "--"
}

private func widgetVitalsSnapshot() -> VitAlGuardEntry {
    let shared = VitAlGuardSharedStorage.loadWatchSnapshot()
    let values = shared?.values ?? [:]
    let updated = shared?.receivedAt
    let mode = VitAlGuardSharedStorage.loadAppMode() ?? .worker
    let heartRate = watchValue(values, key: "heartRate")
    let spo2 = watchValue(values, key: "spo2")
    let steps = watchValue(values, key: "steps")
    let wristTemperature = watchTemperatureValue(values)
    let wallet = VitAlGuardSharedStorage.loadWalletIdentity()
    let walletPayload = wallet?.payload ?? [:]
    let safetyIndex = 86
    var status = "대기"
    if heartRate == "--" && spo2 == "--" && steps == "--" {
        status = updated == nil ? "대기" : "연결 대기"
    } else {
        status = "실시간"
    }
    return VitAlGuardEntry(
        date: Date(),
        mode: mode,
        safetyIndex: safetyIndex,
        heartRate: heartRate,
        spo2: spo2,
        steps: steps,
        wristTemperature: wristTemperature,
        status: status,
        walletName: walletPayload["name"]?.isEmpty == false ? walletPayload["name"]! : "VitAlGuard ID",
        walletEmployeeId: walletPayload["employeeId"]?.isEmpty == false ? walletPayload["employeeId"]! : "사원번호 대기",
        walletQRPNGData: wallet?.qrPNGData,
        walletBarcodePNGData: wallet?.barcodePNGData
    )
}

struct VitAlGuardTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> VitAlGuardEntry {
        widgetVitalsSnapshot()
    }

    func getSnapshot(in context: Context, completion: @escaping (VitAlGuardEntry) -> Void) {
        completion(widgetVitalsSnapshot())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<VitAlGuardEntry>) -> Void) {
        let entry = widgetVitalsSnapshot()
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(60))))
    }
}

struct VitAlGuardHomeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: VitAlGuardEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                small
            case .systemMedium:
                medium
            case .systemLarge:
                large
            case .accessoryRectangular:
                accessory
            default:
                medium
            }
        }
        .unredacted()
    }

    private var small: some View {
        WatchVitalsWidgetCard(entry: entry, compact: true)
            .widgetBackground()
    }

    private var medium: some View {
        WatchVitalsWidgetCard(entry: entry, compact: false)
            .widgetBackground()
    }

    private var large: some View {
        WatchVitalsWidgetCard(entry: entry, compact: false, expanded: true)
            .widgetBackground()
    }

    private var accessory: some View {
        HStack {
            BrandLogo(size: 20)
            Text("안전 \(entry.safetyIndex) · HR \(entry.heartRate)")
                .font(.system(size: 13, weight: .black))
        }
    }
}

struct VitAlGuardLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: VitAlGuardActivityAttributes.self) { context in
            LiveActivityLockView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.86))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
                DynamicIsland {
                    DynamicIslandExpandedRegion(.leading) {
                    HStack(alignment: .top) {
                        Spacer(minLength: 8)
                        LiveActivityLogo(size: 58)
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 8)
                    .padding(.top, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HStack {
                        Spacer(minLength: 0)
                        Button(intent: RefreshDashboardIntent()) {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 15, weight: .black))
                                .frame(width: 30, height: 30)
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.circle)
                        .controlSize(.mini)
                        Spacer(minLength: 12)
                    }
                    .padding(.trailing, 10)
                    .padding(.top, 8)
                }
                DynamicIslandExpandedRegion(.center) {
                    LiveActivitySummary(state: context.state)
                        .frame(maxWidth: 430, alignment: .leading)
                        .padding(.horizontal, 12)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.mode == AppMode.admin.rawValue {
                        SafetyLightRows()
                            .frame(maxWidth: 520)
                            .padding(.horizontal, 28)
                    } else {
                        WorkerActionButtons()
                            .padding(.horizontal, 22)
                    }
            }
        } compactLeading: {
                LiveActivityLogo(size: 24)
            } compactTrailing: {
                Button(intent: RefreshDashboardIntent()) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .black))
                }
                .buttonStyle(.plain)
                .controlSize(.mini)
            } minimal: {
                LiveActivityLogo(size: 24)
            }
        }
    }
}

struct LiveActivityHomeCard: View {
    let entry: VitAlGuardEntry
    var compact = false
    var expanded = false

    var body: some View {
        Group {
            if entry.mode == .admin {
                AdminLiveActivityHomeCard(entry: entry, compact: compact, expanded: expanded)
            } else {
                WorkerLiveActivityHomeCard(entry: entry, compact: compact, expanded: expanded)
            }
        }
    }
}

struct WatchVitalsWidgetCard: View {
    let entry: VitAlGuardEntry
    var compact = false
    var expanded = false
    @Environment(\.colorScheme) private var colorScheme

    private var primaryText: Color { colorScheme == .dark ? .white : Color(red: 0.08, green: 0.09, blue: 0.10) }
    private var tileFill: Color { colorScheme == .dark ? .white.opacity(0.08) : .black.opacity(0.06) }

    var body: some View {
        let isMedium = !compact && !expanded
        VStack(alignment: .leading, spacing: compact ? 7 : (isMedium ? 4 : 10)) {
            HStack(spacing: isMedium ? 6 : 8) {
                BrandLogo(size: compact ? 26 : (isMedium ? 20 : 32))
                VStack(alignment: .leading, spacing: 1) {
                    Text("VitAlGuard Watch")
                        .font(.system(size: compact ? 13 : (isMedium ? 13 : 16), weight: .black))
                        .foregroundStyle(primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                    if !compact && !isMedium {
                        Text(entry.status == "실시간" ? "연결된 Apple Watch 데이터" : "Apple Watch 연결 대기")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Button(intent: RefreshDashboardIntent()) {
                    Image(systemName: entry.status == "실시간" ? "applewatch.radiowaves.left.and.right" : "applewatch")
                        .font(.system(size: compact ? 14 : (isMedium ? 15 : 18), weight: .black))
                        .foregroundStyle(entry.status == "실시간" ? .green : .secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Apple Watch 실시간 정보 새로고침")
            }

            if compact {
                VStack(alignment: .leading, spacing: 5) {
                    MetricLine(title: "심박", value: "\(entry.heartRate) bpm", color: .red)
                    MetricLine(title: "SpO₂", value: "\(entry.spo2)%", color: .blue)
                    MetricLine(title: "걸음", value: entry.steps, color: .green)
                    MetricLine(title: "손목 온도", value: "\(entry.wristTemperature)℃", color: .orange)
                }
            } else {
                VStack(spacing: isMedium ? 4 : 8) {
                    if expanded {
                        HStack(spacing: 8) {
                            MetricCard(title: "심박", value: entry.heartRate, unit: "bpm", color: .red)
                            MetricCard(title: "SpO₂", value: entry.spo2, unit: "%", color: .blue)
                            MetricCard(title: "걸음", value: entry.steps, unit: "보", color: .green)
                        }
                    } else {
                        MediumVitalsGrid(entry: entry)
                    }
                    if expanded {
                        HStack(spacing: 8) {
                            MetricChip(title: "안전지수", value: "\(entry.safetyIndex) 정상", color: .green)
                            MetricChip(title: "손목 온도", value: "\(entry.wristTemperature)℃", color: .orange)
                        }
                    }
                }
                if expanded {
                    HStack(spacing: 8) {
                        MetricChip(title: entry.mode == .admin ? "관리 모드" : "근로자 모드", value: entry.walletEmployeeId, color: .orange)
                    }
                    WalletCodeStrip(entry: entry)
                        .padding(.top, 2)
                }
            }

            if isMedium {
                Text(entry.status == "실시간" ? "최근 동기화: 1분 이내" : "iPhone 앱 또는 Watch 앱을 열어 동기화하세요")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.62)
            } else {
                Spacer(minLength: 0)
                Text(entry.status == "실시간" ? "최근 동기화: 1분 이내" : "iPhone 앱 또는 Watch 앱을 열어 동기화하세요")
                    .font(.system(size: compact ? 9 : 11, weight: .bold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .environment(\.vitalGuardWidgetTileFill, tileFill)
        .environment(\.vitalGuardWidgetPrimaryText, primaryText)
    }
}

struct WorkerLiveActivityHomeCard: View {
    let entry: VitAlGuardEntry
    var compact = false
    var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 7 : 10) {
            HStack(spacing: 8) {
                BrandLogo(size: compact ? 26 : 32)
                Text("VitAlGuard")
                    .font(.system(size: compact ? 15 : 18, weight: .black))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: compact ? 13 : 16, weight: .black))
                    .foregroundStyle(.white)
                    .opacity(0.92)
            }

            Spacer(minLength: compact ? 2 : 4)

            Text("작업 안전지수")
                .font(.system(size: compact ? 15 : 20, weight: .black))
                .foregroundStyle(.white)
                .lineLimit(1)

            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text("\(entry.safetyIndex)")
                    .font(.system(size: compact ? 24 : 30, weight: .black))
                    .foregroundStyle(.green)
                Text("정상")
                    .font(.system(size: compact ? 14 : 18, weight: .black))
                    .foregroundStyle(.green)
            }

            Text("SOS · 관리자 호출 · 위치 공유")
                .font(.system(size: compact ? 11 : 14, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)

            if !compact {
                HStack(spacing: 8) {
                    ActionPill(title: "SOS")
                    ActionPill(title: "관리자 호출")
                    ActionPill(title: "위치 공유")
                }
                .padding(.top, 3)
            }

            if expanded {
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    MetricChip(title: "심박", value: entry.heartRate, color: .red)
                    MetricChip(title: "SpO₂", value: entry.spo2, color: .blue)
                    MetricChip(title: "걸음", value: entry.steps, color: .green)
                }
            }
        }
    }
}

struct AdminLiveActivityHomeCard: View {
    let entry: VitAlGuardEntry
    var compact = false
    var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 7 : 10) {
            HStack(spacing: 8) {
                BrandLogo(size: compact ? 26 : 32)
                Text("VitAlGuard")
                    .font(.system(size: compact ? 15 : 18, weight: .black))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: compact ? 13 : 16, weight: .black))
                    .foregroundStyle(.white)
                    .opacity(0.92)
            }

            Spacer(minLength: compact ? 2 : 4)

            HStack(alignment: .center, spacing: 8) {
                Text("현장 통합 안전 신호등")
                    .font(.system(size: compact ? 14 : 20, weight: .black))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                Spacer(minLength: 8)
                OverallRiskBadge(label: "종합 위험", activeIndex: 2, compact: compact)
            }

            Text("현장 기상 대기 · 작업자 대기 · 가스 감지 위험 · AED 위험")
                .font(.system(size: compact ? 10 : 13, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(compact ? 2 : 1)
                .minimumScaleFactor(0.75)

            if !compact {
                SafetyLightRows()
                    .padding(.top, 5)
            }

            if expanded {
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    MetricChip(title: "심박", value: entry.heartRate, color: .red)
                    MetricChip(title: "SpO₂", value: entry.spo2, color: .blue)
                    MetricChip(title: "걸음", value: entry.steps, color: .green)
                }
            }
        }
    }
}

struct ActionPill: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 13, weight: .black))
            .foregroundStyle(.blue)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Color.blue.opacity(0.28), in: Capsule())
    }
}

struct MetricChip: View {
    let title: String
    let value: String
    let color: Color
    @Environment(\.vitalGuardWidgetTileFill) private var tileFill
    @Environment(\.vitalGuardWidgetPrimaryText) private var primaryText

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 6, height: 6)
                Text(title)
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.secondary)
            }
            Text(value)
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(primaryText)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(tileFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct VitAlGuardWalletWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: VitAlGuardEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                small
            case .systemMedium:
                medium
            default:
                medium
            }
        }
        .unredacted()
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            BrandRow(compact: true)
            Text(entry.walletEmployeeId)
                .font(.system(size: 14, weight: .black))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
            if let qr = CodeImage(data: entry.walletQRPNGData) {
                qr
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: 78)
                    .padding(6)
                    .background(.white, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            } else {
                EmptyCodePlaceholder(title: "QR 대기")
                    .frame(maxWidth: .infinity, maxHeight: 88)
            }
        }
        .widgetBackground()
    }

    private var medium: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .center, spacing: 6) {
                    BrandLogo(size: 18)
                    Text("VitAlGuard")
                        .font(.system(size: 15, weight: .black))
                        .lineLimit(1)
                        .minimumScaleFactor(0.58)
                        .layoutPriority(2)
                }

                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(entry.walletName)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.68)
                    Text(entry.walletEmployeeId)
                        .font(.system(size: 12, weight: .black))
                        .lineLimit(1)
                        .minimumScaleFactor(0.62)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if let barcode = CodeImage(data: entry.walletBarcodePNGData) {
                    barcode
                        .resizable()
                        .interpolation(.none)
                        .scaledToFit()
                        .frame(maxWidth: .infinity, minHeight: 25, maxHeight: 28)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                } else {
                    EmptyCodePlaceholder(title: "바코드")
                        .frame(maxWidth: .infinity, maxHeight: 38)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(3)

            if let qr = CodeImage(data: entry.walletQRPNGData) {
                qr
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .frame(width: 68, height: 68)
                    .padding(5)
                    .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                EmptyCodePlaceholder(title: "QR")
                    .frame(width: 78, height: 78)
            }
        }
        .widgetBackground()
    }
}

func CodeImage(data: Data?) -> Image? {
    guard let data, let image = UIImage(data: data) else { return nil }
    return Image(uiImage: image)
}

struct EmptyCodePlaceholder: View {
    let title: String

    var body: some View {
        VStack(spacing: 7) {
            Image(systemName: "qrcode")
                .font(.system(size: 26, weight: .black))
            Text(title)
                .font(.system(size: 11, weight: .black))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(10)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct LiveActivityLockView: View {
    let state: VitAlGuardActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                BrandRow(compact: true)
                Spacer()
                Button(intent: RefreshDashboardIntent()) {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain)
                .controlSize(.small)
                .imageScale(.small)
            }
            LiveActivitySummary(state: state)
            if state.mode == AppMode.admin.rawValue {
                SafetyLightRows()
            } else {
                WorkerActionButtons()
            }
        }
        .padding()
    }
}

struct LiveActivitySummary: View {
    let state: VitAlGuardActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(state.title)
                .font(.system(size: 14, weight: .black))
                .lineLimit(1)
                .minimumScaleFactor(0.58)
                .layoutPriority(2)

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if state.mode == AppMode.admin.rawValue {
                    OverallRiskBadge(
                        label: state.status,
                        activeIndex: dashboardSignalIndex(status: state.status, safetyIndex: state.safetyIndex),
                        compact: true
                    )
                } else {
                    Text(state.status)
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(.green)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            Text(state.detail)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
    }
}

struct OverallRiskBadge: View {
    let label: String
    let activeIndex: Int
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 5 : 7) {
            DashboardTrafficLight(activeIndex: activeIndex, dotSize: compact ? 6 : 8)
            Text(label)
                .font(.system(size: compact ? 12 : 15, weight: .black))
                .foregroundStyle(dashboardSignalColor(index: activeIndex))
                .lineLimit(1)
        }
        .padding(.horizontal, compact ? 0 : 6)
        .accessibilityLabel("\(label), 신호등 \(activeIndex + 1)단계")
    }
}

private func dashboardSignalIndex(status: String, safetyIndex: Int) -> Int {
    if status.contains("위험") { return 2 }
    if status.contains("주의") { return 1 }
    if status.contains("정상") { return 0 }
    if safetyIndex >= 80 { return 0 }
    if safetyIndex >= 60 { return 1 }
    return 2
}

private func dashboardSignalColor(index: Int) -> Color {
    switch index {
    case 0: return .green
    case 1: return .orange
    default: return .red
    }
}

struct DashboardTrafficLight: View {
    let activeIndex: Int
    var dotSize: CGFloat = 7

    var body: some View {
        HStack(spacing: dotSize * 0.7) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(color(for: index).opacity(index == activeIndex ? 1 : 0.38))
                    .frame(width: dotSize, height: dotSize)
            }
        }
    }

    private func color(for index: Int) -> Color {
        switch index {
        case 0: return .green
        case 1: return .orange
        default: return .red
        }
    }
}

struct SafetyLightRows: View {
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                SafetyLightRow(title: "현장 기상", state: "대기", color: .gray, compact: true)
                SafetyLightRow(title: "작업자", state: "대기", color: .gray, compact: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 6) {
                SafetyLightRow(title: "가스 감지", state: "위험", color: .red, compact: true)
                SafetyLightRow(title: "AED", state: "위험", color: .red, compact: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }
}

struct WorkerActionButtons: View {
    var body: some View {
        HStack(spacing: 8) {
            Button(intent: WorkerDashboardActionIntent(action: .sos)) { Text("SOS") }
            Button(intent: WorkerDashboardActionIntent(action: .callManager)) { Text("관리자 호출") }
            Button(intent: WorkerDashboardActionIntent(action: .shareLocation)) { Text("위치 공유") }
        }
        .buttonStyle(.bordered)
        .font(.system(size: 12, weight: .black))
    }
}

struct SafetyLightRow: View {
    let title: String
    let state: String
    let color: Color
    var compact = false

    var body: some View {
        HStack(spacing: 5) {
            Text(title)
                .font(.system(size: compact ? 10 : 11, weight: .black))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, alignment: .leading)
            Circle().fill(color).frame(width: 7, height: 7)
            Text(state)
                .font(.system(size: compact ? 10 : 11, weight: .black))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}

struct ResolvedBrandLogo: View {
    let size: CGFloat
    let strokeOpacity: Double
    var forcedLogoAssetName: String? = nil
    @Environment(\.colorScheme) private var colorScheme

    private var logoAssetName: String {
        forcedLogoAssetName ?? (colorScheme == .dark ? "2026-06-28-liveactivity-visible-dark" : "2026-06-28-liveactivity-visible-light")
    }

    private var resolvedImage: UIImage? {
        UIImage(named: logoAssetName, in: Bundle.main, compatibleWith: nil)
            ?? UIImage(named: logoAssetName)
            ?? Bundle.main.path(forResource: logoAssetName, ofType: "png").flatMap { UIImage(contentsOfFile: $0) }
    }

    var body: some View {
        ZStack {
            if let resolvedImage {
                Image(uiImage: resolvedImage)
                    .renderingMode(.original)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .padding(size * 0.02)
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: max(6, size * 0.22), style: .continuous)
                        .fill(colorScheme == .dark ? Color.black : Color.white)
                    Image(systemName: "waveform.path.ecg.rectangle.fill")
                        .font(.system(size: size * 0.48, weight: .black))
                        .foregroundStyle(Color(red: 0.10, green: 0.58, blue: 1.0))
                    Text("V")
                        .font(.system(size: size * 0.28, weight: .black))
                        .foregroundStyle(colorScheme == .dark ? .white : .black)
                        .offset(y: size * 0.20)
                }
                .padding(size * 0.06)
            }
        }
        .frame(width: size, height: size)
        .background(Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: max(6, size * 0.22), style: .continuous))
        .unredacted()
        .accessibilityLabel("VitAlGuard 로고")
    }
}

struct BrandLogo: View {
    let size: CGFloat
    var body: some View { ResolvedBrandLogo(size: size, strokeOpacity: 0) }
}

struct LiveActivityLogo: View {
    let size: CGFloat
    var body: some View {
        ResolvedBrandLogo(
            size: size,
            strokeOpacity: 0
        )
    }
}

struct WalletCodeStrip: View {
    let entry: VitAlGuardEntry

    var body: some View {
        HStack(spacing: 8) {
            if let qr = CodeImage(data: entry.walletQRPNGData) {
                qr
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .frame(width: 74, height: 74)
                    .padding(7)
                    .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
                EmptyCodePlaceholder(title: "QR 대기")
                    .frame(width: 88, height: 88)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(entry.mode == .admin ? "관리자 출입 코드" : "근로자 출입 코드")
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let barcode = CodeImage(data: entry.walletBarcodePNGData) {
                    barcode
                        .resizable()
                        .interpolation(.none)
                        .scaledToFit()
                        .frame(maxWidth: .infinity, minHeight: 32, maxHeight: 36)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                } else {
                    EmptyCodePlaceholder(title: "바코드 대기")
                        .frame(maxWidth: .infinity, minHeight: 44, maxHeight: 48)
                }
                Text(entry.walletEmployeeId)
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }
}

struct MediumVitalsGrid: View {
    let entry: VitAlGuardEntry

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 5) {
                MiniMetricCard(title: "심박", value: entry.heartRate, unit: "bpm", color: .red)
                MiniMetricCard(title: "SpO₂", value: entry.spo2, unit: "%", color: .blue)
                MiniMetricCard(title: "걸음", value: entry.steps, unit: "보", color: .green)
            }
            HStack(spacing: 5) {
                MiniMetricCard(title: "안전지수", value: "\(entry.safetyIndex) 정상", unit: "", color: .green)
                MiniMetricCard(title: "손목 온도", value: entry.wristTemperature, unit: "℃", color: .orange)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

struct MiniMetricCard: View {
    let title: String
    let value: String
    let unit: String
    let color: Color
    @Environment(\.vitalGuardWidgetTileFill) private var tileFill
    @Environment(\.vitalGuardWidgetPrimaryText) private var primaryText

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 5, height: 5)
                Text(title)
                    .font(.system(size: 9, weight: .black))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.62)
                Text(unit)
                    .font(.system(size: 8, weight: .black))
                    .foregroundStyle(color)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(tileFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct BrandRow: View {
    let compact: Bool

    var body: some View {
        HStack(spacing: 7) {
            BrandLogo(size: compact ? 22 : 28)
            Text("VitAlGuard")
                .font(.system(size: compact ? 13 : 16, weight: .black))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
    }
}

struct MetricLine: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(title).font(.system(size: 12, weight: .black))
            Spacer()
            Text(value).font(.system(size: 13, weight: .black))
        }
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    let unit: String
    let color: Color
    @Environment(\.vitalGuardWidgetTileFill) private var tileFill

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(title).font(.system(size: 12, weight: .black))
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.system(size: 22, weight: .black))
                Text(unit).font(.system(size: 11, weight: .black)).foregroundStyle(color)
            }
        }
        .padding(10)
        .background(tileFill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

extension View {
    func widgetBackground() -> some View {
        modifier(VitAlGuardWidgetBackground())
    }
}

private struct VitAlGuardWidgetBackground: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.widgetFamily) private var widgetFamily

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, widgetFamily == .systemMedium ? 10 : 12)
            .padding(.vertical, widgetFamily == .systemMedium ? 8 : 10)
            .containerBackground(for: .widget) {
                if colorScheme == .dark {
                    LinearGradient(
                        colors: [Color.black, Color(red: 0.13, green: 0.13, blue: 0.14)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                } else {
                    LinearGradient(
                        colors: [Color.white, Color(red: 0.94, green: 0.93, blue: 0.89)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
            }
            .foregroundStyle(colorScheme == .dark ? Color.white : Color(red: 0.08, green: 0.09, blue: 0.10))
    }
}

private struct VitAlGuardWidgetTileFillKey: EnvironmentKey {
    static let defaultValue: Color = .white.opacity(0.08)
}

private struct VitAlGuardWidgetPrimaryTextKey: EnvironmentKey {
    static let defaultValue: Color = .white
}

private extension EnvironmentValues {
    var vitalGuardWidgetTileFill: Color {
        get { self[VitAlGuardWidgetTileFillKey.self] }
        set { self[VitAlGuardWidgetTileFillKey.self] = newValue }
    }

    var vitalGuardWidgetPrimaryText: Color {
        get { self[VitAlGuardWidgetPrimaryTextKey.self] }
        set { self[VitAlGuardWidgetPrimaryTextKey.self] = newValue }
    }
}

struct VitAlGuardHomeWidget: Widget {
    let kind = "VitAlGuardHomeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: VitAlGuardTimelineProvider()) { entry in
            VitAlGuardHomeWidgetView(entry: entry)
        }
        .configurationDisplayName("VitAlGuard Watch 데이터")
        .description("연결된 Apple Watch 생체 데이터를 홈 화면에서 실시간으로 확인합니다.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}

struct VitAlGuardWalletWidget: Widget {
    let kind = "VitAlGuardWalletWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: VitAlGuardTimelineProvider()) { entry in
            VitAlGuardWalletWidgetView(entry: entry)
        }
        .configurationDisplayName("VitAlGuard ID / QR")
        .description("관리자 또는 근로자 ID, QR코드, 바코드를 홈 화면에서 확인합니다.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct VitAlGuardQRCodeOnlyWidgetView: View {
    let entry: VitAlGuardEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            BrandRow(compact: true)
            Spacer(minLength: 0)
            if let qr = CodeImage(data: entry.walletQRPNGData) {
                qr
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: 96)
                    .padding(8)
                    .background(.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                EmptyCodePlaceholder(title: "QR 대기")
                    .frame(maxWidth: .infinity, maxHeight: 106)
            }
            Text(entry.walletEmployeeId)
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .widgetBackground()
        .unredacted()
    }
}

struct VitAlGuardQRCodeOnlyWidget: Widget {
    let kind = "VitAlGuardQRCodeOnlyWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: VitAlGuardTimelineProvider()) { entry in
            VitAlGuardQRCodeOnlyWidgetView(entry: entry)
        }
        .configurationDisplayName("VitAlGuard QR")
        .description("QR코드만 1x1 위젯으로 빠르게 확인합니다.")
        .supportedFamilies([.systemSmall])
    }
}

@available(iOS 18.0, *)
struct VitAlGuardSOSControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "VitAlGuardSOSControl") {
            ControlWidgetButton(action: VitAlGuardSOSQuickIntent()) {
                Label("SOS", systemImage: "sos")
            }
        }
        .displayName("VitAlGuard SOS")
        .description("긴급 SOS를 실행합니다.")
    }
}

@available(iOS 18.0, *)
struct VitAlGuardManagerCallControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "VitAlGuardManagerCallControl") {
            ControlWidgetButton(action: VitAlGuardManagerCallQuickIntent()) {
                Label("관리자 호출", systemImage: "person.wave.2.fill")
            }
        }
        .displayName("VitAlGuard 관리자 호출")
        .description("관리자 호출 액션을 실행합니다.")
    }
}

@available(iOS 18.0, *)
struct VitAlGuardLocationShareControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "VitAlGuardLocationShareControl") {
            ControlWidgetButton(action: VitAlGuardLocationShareQuickIntent()) {
                Label("위치 공유", systemImage: "location.fill")
            }
        }
        .displayName("VitAlGuard 위치 공유")
        .description("현재 위치 공유 액션을 실행합니다.")
    }
}

@available(iOS 18.0, *)
struct VitAlGuardCameraControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "VitAlGuardCameraControl") {
            ControlWidgetButton(action: VitAlGuardCameraQuickIntent()) {
                Label("증빙 촬영", systemImage: "camera.fill")
            }
        }
        .displayName("VitAlGuard 증빙 촬영")
        .description("사진 증빙 촬영을 시작합니다.")
    }
}

@main
struct VitAlGuardWidgetBundle: WidgetBundle {
    var body: some Widget {
        VitAlGuardHomeWidget()
        VitAlGuardWalletWidget()
        VitAlGuardQRCodeOnlyWidget()
        VitAlGuardLiveActivityWidget()
        if #available(iOS 18.0, *) {
            VitAlGuardSOSControl()
            VitAlGuardManagerCallControl()
            VitAlGuardLocationShareControl()
            VitAlGuardCameraControl()
        }
    }
}
