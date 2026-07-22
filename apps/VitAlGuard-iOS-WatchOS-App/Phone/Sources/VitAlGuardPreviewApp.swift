import AVFoundation
import AVKit
import AuthenticationServices
import BackgroundTasks
import CoreImage
import Security
import CoreLocation
import CoreNFC
import MapKit
import Photos
import PassKit
import QuickLook
import SafariServices
import Vision
import VisionKit
import UIKit
import UserNotifications
import WatchConnectivity
import WeatherKit
import WebKit
import WidgetKit
import UniformTypeIdentifiers

// CoreNFC 세션은 entitlement가 없으면 런타임에서 보안 오류로 종료된다.
// 앱은 기능을 노출하되, 권한/프로파일 미준비 시 사용자와 Watch에 명확한 오류를 돌려준다.
private let isNFCFeatureEnabled = true
private let vitalGuardBundledUploadToken = ""
private let vitalGuardUploadTokenDefaultsKey = "APP_UPLOAD_TOKEN"
private let weatherKitMonthlyCallLimit = 100_000
private let weatherKitCacheLifetime: TimeInterval = 30 * 60
private let weatherKitUsageMonthKey = "WEATHERKIT_USAGE_MONTH"
private let koreanLatitudeRange: ClosedRange<Double> = 31.5...38.8
private let koreanLongitudeRange: ClosedRange<Double> = 123.0...132.0
private let weatherKitUsageCountKey = "WEATHERKIT_USAGE_COUNT"

private extension Notification.Name {
    static let vitalGuardQuickActionRequested = Notification.Name("VitAlGuardQuickActionRequested")
    static let vitalGuardIntroGuideModeChanged = Notification.Name("VitAlGuardIntroGuideModeChanged")
    static let vitalGuardFallResponseRequested = Notification.Name("VitAlGuardFallResponseRequested")
}

private func vitalGuardEmployeeIdentifier(for loginId: String) -> String {
    let normalized = loginId.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty ? "" : "EMP-\(normalized)"
}

private enum WeatherKitUsageGate {
    static func currentUsageText() -> String {
        "\(currentCount())/\(weatherKitMonthlyCallLimit) · 30분 캐시"
    }

    static func canUseOneCall(now: Date = Date()) -> Bool {
        resetIfNeeded(now: now)
        return currentCount() < weatherKitMonthlyCallLimit
    }

    static func recordOneCall(now: Date = Date()) {
        resetIfNeeded(now: now)
        let defaults = UserDefaults.standard
        defaults.set(currentCount() + 1, forKey: weatherKitUsageCountKey)
    }

    private static func currentCount() -> Int {
        resetIfNeeded()
        return UserDefaults.standard.integer(forKey: weatherKitUsageCountKey)
    }

    private static func resetIfNeeded(now: Date = Date()) {
        let month = Self.monthKey(for: now)
        let defaults = UserDefaults.standard
        if defaults.string(forKey: weatherKitUsageMonthKey) != month {
            defaults.set(month, forKey: weatherKitUsageMonthKey)
            defaults.set(0, forKey: weatherKitUsageCountKey)
        }
    }

    private static func monthKey(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy-MM"
        return formatter.string(from: date)
    }
}

private struct LocationWeatherSummary {
    var place: String
    var temperature: String
    var detail: String
    var safety: String
    var naverQuery: String
    var source: String = "위치 기반 날씨"
    var usageText: String = "관제 대시보드 기준"
    var radarSummary: String = "관제 대시보드 강수 데이터 대기"
    var typhoonSummary: String = "관제 대시보드 바람 데이터 대기"
    var alertSummary: String = "관제 대시보드 특보/대기질 대기"
    var specialVideoSummary: String = "특보 영상은 관제 알림 기준으로 표시"
    var conditionText: String = "날씨 데이터 대기"
    var conditionSymbolName: String = "cloud.sun.fill"
    var temperatureC: Double?
    var precipitationChance: Double?
    var precipitationAmountMm: Double?
    var precipitationIntensityMmH: Double?
    var airQualityIndex: Double?
    var airQualityText: String = "대기질 데이터 대기"
    var windSpeedMS: Double?
    var windDirectionText: String = ""
    var hourlyTimeline: [String] = []
    var hourlyForecasts: [WeatherTimelinePoint] = []
}

private struct WeatherTimelinePoint {
    var timeText: String
    var conditionText: String
    var symbolName: String
    var temperatureC: Double?
    var precipitationChance: Double?
    var precipitationAmountMm: Double?
    var precipitationIntensityMmH: Double?
    var windSpeedMS: Double?
    var windDirectionText: String
}

private struct DashboardCCTVFeed {
    var id: String
    var name: String
    var meta: String
    var state: String
    var color: UIColor
    var streamURL: URL?
    var mjpegURL: URL? = nil
    var thumbnailURL: URL?
    var order: Int
}

private struct DashboardNearbyHospital {
    var name: String
    var address: String
    var distanceText: String
    var mapQuery: String
    var phoneNumber: String
    var openingHours: String
    var closedDays: String
}

private extension String {
    func chunkedPhoneNumber() -> String {
        let digits = filter(\.isNumber)
        guard digits.count == 10 || digits.count == 11 else { return self }
        let firstEnd = digits.index(digits.startIndex, offsetBy: digits.count == 10 ? 3 : 3)
        let middleEnd = digits.index(digits.endIndex, offsetBy: -4)
        return [
            String(digits[..<firstEnd]),
            String(digits[firstEnd..<middleEnd]),
            String(digits[middleEnd...])
        ].joined(separator: "-")
    }
}

private enum EmergencyActionKind: String, CaseIterable {
    case minor
    case serious
    case critical
    case fall
    case sos

    var title: String {
        switch self {
        case .minor: return "경상"
        case .serious: return "중상"
        case .critical: return "긴급"
        case .fall: return "낙상"
        case .sos: return "SOS"
        }
    }

    var symbol: String {
        switch self {
        case .minor: return "cross.case.fill"
        case .serious: return "stethoscope"
        case .critical: return "bolt.heart.fill"
        case .fall: return "figure.fall"
        case .sos: return "sos.circle.fill"
        }
    }
}

private struct AppMediaUploadPayload {
    let kind: String
    let title: String
    let fileURL: URL
    let mimeType: String
    let ocrText: String
    let capturedAt: Date
    let timeZone: TimeZone
    let roadAddress: String?
    let location: CLLocation?
    let workerId: String
    let workerName: String
}

private struct AppMediaCaptureMetadata {
    let capturedAt: Date
    let timeZone: TimeZone
    let roadAddress: String?
    let location: CLLocation?
}

private enum FieldJournalKind: String, CaseIterable {
    case work
    case patrol

    var title: String {
        switch self {
        case .work: return "근무일지"
        case .patrol: return "순찰일지"
        }
    }

    var areaTitle: String {
        switch self {
        case .work: return "작업구역"
        case .patrol: return "순찰구역"
        }
    }

    var dateTitle: String {
        switch self {
        case .work: return "작업일시"
        case .patrol: return "순찰일시"
        }
    }

    var contentTitle: String {
        switch self {
        case .work: return "작업내용"
        case .patrol: return "순찰내용"
        }
    }

    var dashboardKind: String {
        switch self {
        case .work: return "work-log"
        case .patrol: return "patrol-log"
        }
    }
}

private struct FieldJournalEntry {
    var kind: FieldJournalKind
    var area: String
    var occurredAt: Date
    var content: String
    var calendarURL: URL?
    var tagText: String
    var attachments: [FieldJournalAttachment]
}

private struct CalendarCommentEntry {
    var id: String?
    var date: Date
    var text: String
    var attachments: [FieldJournalAttachment]
    var relatedRecordTitle: String?
    var relatedRecordId: String?
    var existingAttachmentRecordIds: [String] = []
}

private enum FieldJournalAttachmentSource {
    case photo
    case video
    case document
    case file
}

private struct FieldJournalAttachment {
    var kind: String
    var title: String
    var fileName: String
    var mimeType: String
    var byteSize: Int
    var localURL: URL?
    var capturedAt: Date
    var note: String

    var jsonValue: [String: Any] {
        [
            "kind": kind,
            "title": title,
            "fileName": fileName,
            "mimeType": mimeType,
            "byteSize": byteSize,
            "localPath": localURL?.lastPathComponent ?? "",
            "capturedAt": ISO8601DateFormatter().string(from: capturedAt),
            "note": note
        ]
    }
}

private struct AppMediaCalendarRecord: Codable, Hashable {
    var id: String
    var kind: String
    var title: String
    var fileName: String
    var mimeType: String
    var byteSize: Int
    var uploadedAt: Date
    var capturedAt: Date
    var workerId: String?
    var workerName: String?
    var source: String
    var ocrText: String?
    var previewDataUrl: String?
    var journalType: String?
    var journalArea: String?
    var journalContent: String?
    var nfcTagText: String?
    var commentText: String?
    var calendarURL: String?
    var localPath: String?
    var note: String?

    var localURL: URL? {
        guard let localPath, !localPath.isEmpty else { return nil }
        return URL(fileURLWithPath: localPath)
    }

    private var duplicateKey: String {
        "\(fileName)|\(Int(capturedAt.timeIntervalSince1970))|\(workerId ?? "")|\(kind)"
    }

    func mergesSameCalendarItem(as other: AppMediaCalendarRecord) -> Bool {
        duplicateKey == other.duplicateKey
    }
}

private enum AppMediaCalendarStore {
    private static let recordsKey = "preview.appMediaCalendar.records.v1"
    private static let maxRecords = 260

    static func load() -> [AppMediaCalendarRecord] {
        guard let data = UserDefaults.standard.data(forKey: recordsKey),
              let records = try? JSONDecoder.vitalGuardCalendar.decode([AppMediaCalendarRecord].self, from: data) else {
            return []
        }
        return sorted(records)
    }

    static func save(_ records: [AppMediaCalendarRecord]) {
        let trimmed = Array(sorted(records).prefix(maxRecords))
        guard let data = try? JSONEncoder.vitalGuardCalendar.encode(trimmed) else { return }
        UserDefaults.standard.set(data, forKey: recordsKey)
    }

    static func merge(_ incoming: [AppMediaCalendarRecord]) {
        var merged = load()
        for record in incoming {
            if let idIndex = merged.firstIndex(where: { $0.id == record.id }) {
                merged[idIndex] = preferred(existing: merged[idIndex], incoming: record)
            } else if let dupIndex = merged.firstIndex(where: { $0.mergesSameCalendarItem(as: record) }) {
                merged[dupIndex] = preferred(existing: merged[dupIndex], incoming: record)
            } else {
                merged.append(record)
            }
        }
        save(merged)
    }

    static func add(_ record: AppMediaCalendarRecord) {
        merge([record])
    }

    static func updateLocalPath(recordId: String, localPath: String) {
        var records = load()
        guard let index = records.firstIndex(where: { $0.id == recordId }) else { return }
        records[index].localPath = localPath
        save(records)
    }

    static func updateComment(_ comment: AppMediaCalendarRecord, keepAttachmentIds: Set<String>) {
        var records = load()
        records.removeAll { record in
            record.id == comment.id || record.note?.contains("댓글 ID: \(comment.id)") == true && !keepAttachmentIds.contains(record.id)
        }
        records.append(comment)
        save(records)
    }

    static func deleteComment(commentId: String) {
        var records = load()
        records.removeAll { record in
            record.id == commentId || record.note?.contains("댓글 ID: \(commentId)") == true
        }
        save(records)
    }

    static func attachments(forCommentId commentId: String) -> [AppMediaCalendarRecord] {
        load().filter { $0.note?.contains("댓글 ID: \(commentId)") == true && $0.kind != "comment" }
    }

    static func calendarMediaFolder() -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        let folder = base.appendingPathComponent("VitAlGuardCalendarMedia", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            return folder
        } catch {
            return nil
        }
    }

    static func copyFileForCalendar(_ sourceURL: URL) -> URL? {
        let manager = FileManager.default
        guard let folder = calendarMediaFolder() else { return sourceURL }
        do {
            let stamp = Int(Date().timeIntervalSince1970)
            let destination = folder.appendingPathComponent("\(stamp)-\(sourceURL.lastPathComponent)")
            if manager.fileExists(atPath: destination.path) {
                try manager.removeItem(at: destination)
            }
            try manager.copyItem(at: sourceURL, to: destination)
            return destination
        } catch {
            return sourceURL
        }
    }

    static func records(fromServerData data: Data) -> [AppMediaCalendarRecord] {
        guard let root = try? JSONSerialization.jsonObject(with: data),
              let rawEvents = rawCalendarEvents(from: root) else {
            return []
        }
        return rawEvents.compactMap(recordFromServerEvent)
    }

    private static func rawCalendarEvents(from root: Any) -> [[String: Any]]? {
        if let events = root as? [[String: Any]] {
            return events
        }
        guard let dictionary = root as? [String: Any] else {
            return nil
        }
        if let events = dictionary["events"] as? [[String: Any]] {
            return events
        }
        if let events = dictionary["items"] as? [[String: Any]] {
            return events
        }
        if let events = dictionary["media"] as? [[String: Any]] {
            return events
        }
        if let events = dictionary["mediaEvents"] as? [[String: Any]] {
            return events
        }
        if let event = dictionary["event"] as? [String: Any] {
            return [event]
        }
        if let data = dictionary["data"] {
            return rawCalendarEvents(from: data)
        }
        if let result = dictionary["result"] {
            return rawCalendarEvents(from: result)
        }
        return nil
    }

    private static func recordFromServerEvent(_ raw: [String: Any]) -> AppMediaCalendarRecord? {
        let id = string(raw["id"]) ?? UUID().uuidString
        let kind = string(raw["kind"]) ?? string(raw["media_type"]) ?? "document"
        let mediaURL = string(raw["media_url"]) ?? string(raw["url"]) ?? string(raw["downloadURL"])
        let mediaFileName = mediaURL.flatMap { URL(string: $0)?.lastPathComponent }
        let title = string(raw["title"])
            ?? string(raw["event_title"])
            ?? string(raw["road_address"])
            ?? "캘린더 이벤트"
        let fileName = string(raw["fileName"]) ?? string(raw["file_name"]) ?? mediaFileName ?? "\(kind)-\(id)"
        let capturedAt = date(raw["capturedAt"])
            ?? date(raw["captured_at"])
            ?? date(raw["date_key"])
            ?? date(raw["uploadedAt"])
            ?? date(raw["uploaded_at"])
            ?? Date()
        let previewDataUrl = string(raw["previewDataUrl"])
        let note = [
            string(raw["road_address"]),
            string(raw["description"]),
            string(raw["memo"])
        ]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        return AppMediaCalendarRecord(
            id: "dashboard-\(id)",
            kind: kind,
            title: title,
            fileName: fileName,
            mimeType: string(raw["mimeType"]) ?? string(raw["mime_type"]) ?? mimeType(for: kind),
            byteSize: int(raw["byteSize"]) ?? int(raw["byte_size"]) ?? 0,
            uploadedAt: date(raw["uploadedAt"]) ?? date(raw["uploaded_at"]) ?? capturedAt,
            capturedAt: capturedAt,
            workerId: string(raw["workerId"]) ?? string(raw["worker_id"]),
            workerName: string(raw["workerName"]) ?? string(raw["worker_name"]) ?? string(raw["uploader"]),
            source: string(raw["source"]) ?? "VitAlGuard-Dashboard",
            ocrText: string(raw["ocrText"]) ?? string(raw["ocr_text"]),
            previewDataUrl: previewDataUrl,
            journalType: string(raw["journalType"]) ?? string(raw["journal_type"]),
            journalArea: string(raw["journalArea"]) ?? string(raw["journal_area"]),
            journalContent: string(raw["journalContent"]) ?? string(raw["journal_content"]),
            nfcTagText: string(raw["nfcTagText"]) ?? string(raw["nfc_tag_text"]),
            commentText: string(raw["commentText"]) ?? string(raw["comment_text"]),
            calendarURL: string(raw["calendarURL"]) ?? string(raw["calendar_url"]) ?? mediaURL,
            localPath: materializePreviewDataURL(previewDataUrl, fileName: fileName, fallbackId: id)?.path,
            note: note.isEmpty ? nil : note
        )
    }

    private static func mimeType(for kind: String) -> String {
        switch kind.lowercased() {
        case "image", "photo":
            return "image/jpeg"
        case "video":
            return "video/mp4"
        case "scan", "document", "pdf":
            return "application/pdf"
        case "comment":
            return "text/plain; charset=utf-8"
        default:
            return "application/octet-stream"
        }
    }

    private static func materializePreviewDataURL(_ value: String?, fileName: String, fallbackId: String) -> URL? {
        guard let value, let commaIndex = value.firstIndex(of: ",") else { return nil }
        let header = value[..<commaIndex].lowercased()
        guard header.hasPrefix("data:"), header.contains(";base64") else { return nil }
        let encoded = String(value[value.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: encoded, options: [.ignoreUnknownCharacters]),
              let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        let folder = base.appendingPathComponent("VitAlGuardCalendarMedia", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let safeName = fileName.isEmpty ? "dashboard-\(fallbackId).jpg" : fileName
            let destination = folder.appendingPathComponent("dashboard-\(fallbackId)-\(safeName)")
            if !FileManager.default.fileExists(atPath: destination.path) {
                try data.write(to: destination, options: [.atomic])
            }
            return destination
        } catch {
            return nil
        }
    }

    private static func sorted(_ records: [AppMediaCalendarRecord]) -> [AppMediaCalendarRecord] {
        records.sorted { $0.capturedAt > $1.capturedAt }
    }

    private static func preferred(existing: AppMediaCalendarRecord, incoming: AppMediaCalendarRecord) -> AppMediaCalendarRecord {
        var output = incoming
        if output.localPath == nil {
            output.localPath = existing.localPath
        }
        if output.note == nil {
            output.note = existing.note
        }
        return output
    }

    private static func string(_ value: Any?) -> String? {
        (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func int(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        if let value = value as? Double { return Int(value.rounded()) }
        if let value = value as? NSNumber { return value.intValue }
        return nil
    }

    private static func date(_ value: Any?) -> Date? {
        guard let text = string(value), !text.isEmpty else { return nil }
        if let date = ISO8601DateFormatter().date(from: text) {
            return date
        }
        let dayFormatter = DateFormatter()
        dayFormatter.locale = Locale(identifier: "ko_KR")
        dayFormatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        dayFormatter.dateFormat = "yyyy-MM-dd"
        return dayFormatter.date(from: text)
    }
}

private extension JSONEncoder {
    static var vitalGuardCalendar: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension JSONDecoder {
    static var vitalGuardCalendar: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private struct AppAuthLoginResponse: Decodable {
    let ok: Bool
    let token: String?
    let user: AppAuthUser?
    let error: String?
    let retryAfterSec: Int?
}

private struct AppAuthUser: Decodable {
    let id: String
    let name: String?
    let role: String
    let workerId: String?
}

private enum CCTVSortMode: String, CaseIterable {
    case risk
    case safety
    case koreanAscending
    case koreanDescending
    case englishAscending
    case englishDescending
    case numberAscending
    case numberDescending
    case custom

    var title: String {
        switch self {
        case .risk: return "위험도순"
        case .safety: return "안전순"
        case .koreanAscending: return "가나다순"
        case .koreanDescending: return "가나다 역순"
        case .englishAscending: return "ABC순"
        case .englishDescending: return "역ABC순"
        case .numberAscending: return "1번부터"
        case .numberDescending: return "마지막 번호부터"
        case .custom: return "사용자화"
        }
    }
}

private final class CCTVFeedRowView: UIView {
    let feed: DashboardCCTVFeed
    var previewPlayer: AVPlayer?
    var previewLayer: AVPlayerLayer?

    init(feed: DashboardCCTVFeed) {
        self.feed = feed
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = previewLayer?.superlayer?.bounds ?? .zero
    }
}

private func vitalGuardCCTVStreamHTML(for url: URL) -> String {
    let escapedURL = url.absoluteString
        .replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "\"", with: "&quot;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
    return """
    <!doctype html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
      <style>
        html, body { margin: 0; width: 100%; height: 100%; background: #070707; overflow: hidden; }
        body { display: flex; align-items: center; justify-content: center; }
        img { width: 100%; height: 100%; object-fit: contain; display: block; background: #070707; }
      </style>
    </head>
    <body><img src="\(escapedURL)" alt="VitAlGuard CCTV live stream"></body>
    </html>
    """
}

private func vitalGuardCCTVWebView(for url: URL) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.allowsInlineMediaPlayback = true
    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.translatesAutoresizingMaskIntoConstraints = false
    webView.backgroundColor = .black
    webView.isOpaque = false
    webView.scrollView.isScrollEnabled = false
    webView.scrollView.bounces = false
    webView.isUserInteractionEnabled = false
    webView.loadHTMLString(vitalGuardCCTVStreamHTML(for: url), baseURL: nil)
    return webView
}

private final class CCTVOrderEditorController: UITableViewController {
    private var feeds: [DashboardCCTVFeed]
    var onSave: (([String]) -> Void)?

    init(feeds: [DashboardCCTVFeed]) {
        self.feeds = feeds
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "CCTV 사용자화"
        tableView.isEditing = true
        tableView.allowsSelectionDuringEditing = false
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .save, target: self, action: #selector(save))
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        feeds.count
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let feed = feeds[indexPath.row]
        cell.textLabel?.text = feed.name
        cell.detailTextLabel?.text = "\(feed.state) · \(feed.meta)"
        cell.showsReorderControl = true
        return cell
    }

    override func tableView(_ tableView: UITableView, canMoveRowAt indexPath: IndexPath) -> Bool {
        true
    }

    override func tableView(_ tableView: UITableView, moveRowAt sourceIndexPath: IndexPath, to destinationIndexPath: IndexPath) {
        let item = feeds.remove(at: sourceIndexPath.row)
        feeds.insert(item, at: destinationIndexPath.row)
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    @objc private func save() {
        onSave?(feeds.map(\.id))
        dismiss(animated: true)
    }
}

private let dashboardRadarTimes = ["14:00", "14:20", "14:40", "15:00", "15:20", "15:40", "16:00"]
private let dashboardCompactRadarFrameIndices = [0, 2, 4, 6]

private enum WeatherMapLayer: Int, CaseIterable {
    case forecast
    case temperature
    case precipitation
    case airQuality
    case wind

    var title: String {
        switch self {
        case .forecast: return "일기예보"
        case .temperature: return "기온"
        case .precipitation: return "강수량"
        case .airQuality: return "대기질"
        case .wind: return "바람"
        }
    }

    var symbolName: String {
        switch self {
        case .forecast: return "cloud.sun.fill"
        case .temperature: return "thermometer.medium"
        case .precipitation: return "cloud.rain.fill"
        case .airQuality: return "aqi.medium"
        case .wind: return "wind"
        }
    }

    var accentColor: UIColor {
        switch self {
        case .forecast: return UIColor(red: 1.00, green: 0.70, blue: 0.18, alpha: 1.0)
        case .temperature: return UIColor(red: 1.00, green: 0.30, blue: 0.22, alpha: 1.0)
        case .precipitation: return UIColor(red: 0.16, green: 0.68, blue: 1.0, alpha: 1.0)
        case .airQuality: return UIColor(red: 0.10, green: 0.72, blue: 0.44, alpha: 1.0)
        case .wind: return UIColor(red: 0.58, green: 0.48, blue: 1.0, alpha: 1.0)
        }
    }

    func summary(from weather: LocationWeatherSummary) -> String {
        switch self {
        case .forecast:
            return "\(weather.conditionText) · \(weather.temperature) · \(weather.usageText)"
        case .temperature:
            let apparent = weather.detail.components(separatedBy: " · ").first ?? weather.safety
            return "\(weather.temperature) · \(apparent)"
        case .precipitation:
            let chance = weather.precipitationChance.map { "강수확률 \(Int(($0 * 100).rounded()))%" } ?? "강수확률 대기"
            return "\(chance) · \(weather.radarSummary)"
        case .airQuality:
            return weather.airQualityText.isEmpty ? weather.alertSummary : weather.airQualityText
        case .wind:
            let speed = weather.windSpeedMS.map { String(format: "풍속 %.1fm/s", $0) } ?? "풍속 대기"
            return "\(speed) · \(weather.windDirectionText)"
        }
    }
}

private final class RadarMapCanvas: UIControl {
    private let mapView = MKMapView()
    private let dimLayer = CALayer()
    private let weatherOverlayView = UIView()
    private let weatherGradientLayer = CAGradientLayer()
    private let legendView = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
    private let legendTitleLabel = UILabel()
    private let legendScaleLabel = UILabel()
    private var weatherMarkerViews: [UILabel] = []
    private let infoPanel = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    private let iconView = UIImageView()
    private let titleLabel = UILabel()
    private let summaryLabel = UILabel()

    var weather: LocationWeatherSummary = LocationWeatherSummary(
        place: "현재 위치",
        temperature: "--℃",
        detail: "WeatherKit 데이터 대기",
        safety: "작업안전: 확인 필요",
        naverQuery: "현재 위치"
    ) {
        didSet {
            updateInfo()
        }
    }

    var layerMode: WeatherMapLayer = .precipitation {
        didSet {
            applyMapStyle()
            updateInfo()
        }
    }

    var currentCoordinate: CLLocationCoordinate2D? {
        didSet {
            configureRegion()
        }
    }

    var frameIndex: Int = 0 {
        didSet {
            setNeedsLayout()
        }
    }

    var expanded: Bool = false {
        didSet {
            layer.cornerRadius = expanded ? 12 : 10
            configureRegion()
            setNeedsLayout()
        }
    }

    var showsInfoPanel: Bool = true {
        didSet {
            infoPanel.isHidden = !showsInfoPanel
        }
    }

    init(frameIndex: Int, expanded: Bool) {
        self.frameIndex = frameIndex
        self.expanded = expanded
        super.init(frame: .zero)
        backgroundColor = UIColor(white: 0.08, alpha: 1)
        layer.cornerRadius = expanded ? 12 : 10
        layer.cornerCurve = .continuous
        clipsToBounds = true
        isAccessibilityElement = true
        accessibilityLabel = "대한민국 실시간 레이더 지도 확대"
        configureMap()
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        mapView.frame = bounds
        dimLayer.frame = bounds
        weatherOverlayView.frame = bounds
        weatherGradientLayer.frame = weatherOverlayView.bounds
        layoutWeatherMarkers()
    }

    private func configureMap() {
        mapView.translatesAutoresizingMaskIntoConstraints = false
        mapView.isUserInteractionEnabled = true
        mapView.isZoomEnabled = true
        mapView.isScrollEnabled = true
        mapView.isPitchEnabled = false
        mapView.isRotateEnabled = false
        mapView.showsUserLocation = true
        mapView.pointOfInterestFilter = .excludingAll
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.showsTraffic = false
        mapView.overrideUserInterfaceStyle = .dark
        let tap = UITapGestureRecognizer(target: self, action: #selector(mapTapped))
        tap.cancelsTouchesInView = false
        mapView.addGestureRecognizer(tap)
        addSubview(mapView)

        dimLayer.backgroundColor = UIColor.black.withAlphaComponent(0.28).cgColor
        layer.addSublayer(dimLayer)
        configureWeatherOverlay()
        configureInfoPanel()
        applyMapStyle()
        configureRegion()
    }

    private func configureWeatherOverlay() {
        weatherOverlayView.isUserInteractionEnabled = false
        weatherOverlayView.translatesAutoresizingMaskIntoConstraints = false
        weatherOverlayView.layer.addSublayer(weatherGradientLayer)
        addSubview(weatherOverlayView)

        legendView.translatesAutoresizingMaskIntoConstraints = false
        legendView.layer.cornerRadius = expanded ? 16 : 10
        legendView.layer.cornerCurve = .continuous
        legendView.clipsToBounds = true
        legendView.isUserInteractionEnabled = false

        legendTitleLabel.translatesAutoresizingMaskIntoConstraints = false
        legendTitleLabel.textColor = .white
        legendTitleLabel.font = UIFont.systemFont(ofSize: expanded ? 15 : 9, weight: .black)
        legendTitleLabel.numberOfLines = 1

        legendScaleLabel.translatesAutoresizingMaskIntoConstraints = false
        legendScaleLabel.textColor = UIColor.white.withAlphaComponent(0.74)
        legendScaleLabel.font = UIFont.monospacedDigitSystemFont(ofSize: expanded ? 13 : 7, weight: .bold)
        legendScaleLabel.numberOfLines = expanded ? 4 : 2

        weatherOverlayView.addSubview(legendView)
        legendView.contentView.addSubview(legendTitleLabel)
        legendView.contentView.addSubview(legendScaleLabel)

        NSLayoutConstraint.activate([
            legendView.leadingAnchor.constraint(equalTo: weatherOverlayView.leadingAnchor, constant: expanded ? 18 : 8),
            legendView.topAnchor.constraint(equalTo: weatherOverlayView.topAnchor, constant: expanded ? 18 : 8),
            legendView.widthAnchor.constraint(equalToConstant: expanded ? 154 : 72),
            legendTitleLabel.leadingAnchor.constraint(equalTo: legendView.contentView.leadingAnchor, constant: expanded ? 14 : 7),
            legendTitleLabel.trailingAnchor.constraint(equalTo: legendView.contentView.trailingAnchor, constant: expanded ? -14 : -7),
            legendTitleLabel.topAnchor.constraint(equalTo: legendView.contentView.topAnchor, constant: expanded ? 12 : 6),
            legendScaleLabel.leadingAnchor.constraint(equalTo: legendTitleLabel.leadingAnchor),
            legendScaleLabel.trailingAnchor.constraint(equalTo: legendTitleLabel.trailingAnchor),
            legendScaleLabel.topAnchor.constraint(equalTo: legendTitleLabel.bottomAnchor, constant: expanded ? 8 : 4),
            legendScaleLabel.bottomAnchor.constraint(equalTo: legendView.contentView.bottomAnchor, constant: expanded ? -12 : -6)
        ])
        rebuildWeatherMarkers()
        updateWeatherOverlay()
    }

    private func configureInfoPanel() {
        infoPanel.translatesAutoresizingMaskIntoConstraints = false
        infoPanel.layer.cornerRadius = expanded ? 16 : 12
        infoPanel.layer.cornerCurve = .continuous
        infoPanel.clipsToBounds = true
        infoPanel.isUserInteractionEnabled = false

        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.contentMode = .scaleAspectFit
        iconView.tintColor = layerMode.accentColor

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = UIFont.systemFont(ofSize: expanded ? 17 : 11, weight: .black)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 1

        summaryLabel.translatesAutoresizingMaskIntoConstraints = false
        summaryLabel.font = UIFont.systemFont(ofSize: expanded ? 13 : 8, weight: .bold)
        summaryLabel.textColor = UIColor.white.withAlphaComponent(0.76)
        summaryLabel.numberOfLines = expanded ? 2 : 1

        contentView.addSubview(infoPanel)
        infoPanel.contentView.addSubview(iconView)
        infoPanel.contentView.addSubview(titleLabel)
        infoPanel.contentView.addSubview(summaryLabel)

        NSLayoutConstraint.activate([
            infoPanel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: expanded ? 18 : 8),
            infoPanel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: expanded ? -76 : -44),
            infoPanel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: expanded ? -18 : -8),
            iconView.leadingAnchor.constraint(equalTo: infoPanel.contentView.leadingAnchor, constant: expanded ? 12 : 8),
            iconView.centerYAnchor.constraint(equalTo: infoPanel.contentView.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: expanded ? 26 : 16),
            iconView.heightAnchor.constraint(equalTo: iconView.widthAnchor),
            titleLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: expanded ? 10 : 6),
            titleLabel.topAnchor.constraint(equalTo: infoPanel.contentView.topAnchor, constant: expanded ? 10 : 6),
            titleLabel.trailingAnchor.constraint(equalTo: infoPanel.contentView.trailingAnchor, constant: expanded ? -14 : -8),
            summaryLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            summaryLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            summaryLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2),
            summaryLabel.bottomAnchor.constraint(equalTo: infoPanel.contentView.bottomAnchor, constant: expanded ? -10 : -6)
        ])
        infoPanel.isHidden = !showsInfoPanel
        updateInfo()
    }

    private var contentView: UIView {
        self
    }

    private func applyMapStyle() {
        let emphasis: MKStandardMapConfiguration.EmphasisStyle = layerMode == .temperature ? .default : .muted
        mapView.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: emphasis)
        switch layerMode {
        case .forecast:
            dimLayer.backgroundColor = UIColor.black.withAlphaComponent(0.16).cgColor
        case .temperature:
            dimLayer.backgroundColor = UIColor(red: 0.50, green: 0.06, blue: 0.02, alpha: 0.18).cgColor
        case .precipitation:
            dimLayer.backgroundColor = UIColor(red: 0.00, green: 0.10, blue: 0.22, alpha: 0.26).cgColor
        case .airQuality:
            dimLayer.backgroundColor = UIColor(red: 0.00, green: 0.18, blue: 0.10, alpha: 0.18).cgColor
        case .wind:
            dimLayer.backgroundColor = UIColor(red: 0.10, green: 0.06, blue: 0.28, alpha: 0.24).cgColor
        }
        updateWeatherOverlay()
    }

    private func updateInfo() {
        iconView.image = UIImage(systemName: selectedForecastPoint()?.symbolName ?? layerMode.symbolName)
        iconView.tintColor = layerMode.accentColor
        titleLabel.text = "\(layerMode.title) · \(weather.place)"
        summaryLabel.text = selectedForecastSummary()
        updateWeatherOverlay()
    }

    private func configureRegion() {
        let center = currentCoordinate ?? CLLocationCoordinate2D(latitude: expanded ? 36.15 : 36.30, longitude: expanded ? 127.75 : 127.85)
        let span = currentCoordinate == nil
            ? MKCoordinateSpan(latitudeDelta: expanded ? 7.2 : 6.6, longitudeDelta: expanded ? 7.5 : 7.0)
            : MKCoordinateSpan(latitudeDelta: expanded ? 1.6 : 1.2, longitudeDelta: expanded ? 1.8 : 1.35)
        mapView.setRegion(MKCoordinateRegion(center: center, span: span), animated: false)
    }

    func recenterToCurrentLocation() {
        configureRegion()
    }

    @objc private func mapTapped() {
        sendActions(for: .touchUpInside)
    }

    private func updateWeatherOverlay() {
        legendTitleLabel.text = layerMode.title
        legendScaleLabel.text = legendText()
        weatherGradientLayer.colors = gradientColors().map(\.cgColor)
        weatherGradientLayer.locations = [0.0, 0.36, 0.70, 1.0]
        weatherGradientLayer.startPoint = CGPoint(x: 0.08, y: 1.0)
        weatherGradientLayer.endPoint = CGPoint(x: 0.96, y: 0.0)
        weatherGradientLayer.opacity = expanded ? 0.72 : 0.64
        rebuildWeatherMarkers()
        setNeedsLayout()
    }

    private func gradientColors() -> [UIColor] {
        switch layerMode {
        case .forecast:
            return [
                UIColor(red: 0.17, green: 0.21, blue: 0.27, alpha: 0.18),
                UIColor(red: 0.31, green: 0.39, blue: 0.48, alpha: 0.30),
                UIColor(red: 0.13, green: 0.24, blue: 0.34, alpha: 0.28),
                UIColor(red: 0.88, green: 0.77, blue: 0.30, alpha: 0.18)
            ]
        case .temperature:
            return [
                UIColor(red: 0.19, green: 0.39, blue: 0.80, alpha: 0.08),
                UIColor(red: 0.86, green: 0.66, blue: 0.10, alpha: 0.42),
                UIColor(red: 1.00, green: 0.43, blue: 0.08, alpha: 0.44),
                UIColor(red: 0.92, green: 0.10, blue: 0.05, alpha: 0.24)
            ]
        case .precipitation:
            return [
                UIColor(red: 0.03, green: 0.16, blue: 0.66, alpha: 0.15),
                UIColor(red: 0.11, green: 0.42, blue: 1.00, alpha: 0.36),
                UIColor(red: 0.58, green: 0.24, blue: 0.82, alpha: 0.30),
                UIColor(red: 1.00, green: 0.88, blue: 0.15, alpha: 0.24)
            ]
        case .airQuality:
            return [
                UIColor(red: 0.05, green: 0.55, blue: 0.92, alpha: 0.22),
                UIColor(red: 0.05, green: 0.78, blue: 0.41, alpha: 0.40),
                UIColor(red: 0.85, green: 0.78, blue: 0.12, alpha: 0.28),
                UIColor(red: 0.80, green: 0.05, blue: 0.20, alpha: 0.18)
            ]
        case .wind:
            return [
                UIColor(red: 0.05, green: 0.55, blue: 0.85, alpha: 0.40),
                UIColor(red: 0.08, green: 0.72, blue: 0.92, alpha: 0.34),
                UIColor(red: 0.23, green: 0.40, blue: 0.86, alpha: 0.28),
                UIColor(red: 0.05, green: 0.20, blue: 0.45, alpha: 0.34)
            ]
        }
    }

    private func legendText() -> String {
        let point = selectedForecastPoint()
        switch layerMode {
        case .forecast:
            let temp = point?.temperatureC.map { "\(Int($0.rounded()))℃" } ?? weather.temperature
            return "\(point?.conditionText ?? weather.conditionText)\n\(temp) · \(point?.timeText ?? "현재")"
        case .temperature:
            let value = (point?.temperatureC ?? weather.temperatureC).map { "\(Int($0.rounded()))℃" } ?? weather.temperature
            return "55  30  20\n현재 \(value)"
        case .precipitation:
            let chance = (point?.precipitationChance ?? weather.precipitationChance).map { "\(Int(($0 * 100).rounded()))%" } ?? "--%"
            let intensity = (point?.precipitationIntensityMmH ?? weather.precipitationIntensityMmH).map { String(format: "%.1fmm/h", $0) } ?? "--mm/h"
            return "많음  보통  적음\n\(chance) · \(intensity)"
        case .airQuality:
            let value = weather.airQualityIndex.map { "\(Int($0.rounded()))" } ?? "--"
            return "500 300 100 0\nCAI \(value)"
        case .wind:
            let speed = (point?.windSpeedMS ?? weather.windSpeedMS).map { String(format: "%.1fm/s", $0) } ?? "--m/s"
            return "35  25  15  0\n\(speed)"
        }
    }

    private func markerText(for offset: Int) -> String {
        guard offset == 0 else { return "" }
        let point = selectedForecastPoint()
        switch layerMode {
        case .forecast:
            return (point?.temperatureC ?? weather.temperatureC).map { "\(Int($0.rounded()))" } ?? ""
        case .temperature:
            return (point?.temperatureC ?? weather.temperatureC).map { "\(Int($0.rounded()))" } ?? ""
        case .precipitation:
            return (point?.precipitationChance ?? weather.precipitationChance).map { "\(Int(($0 * 100).rounded()))" } ?? ""
        case .airQuality:
            return weather.airQualityIndex.map { "\(Int($0.rounded()))" } ?? ""
        case .wind:
            return (point?.windSpeedMS ?? weather.windSpeedMS).map { "\(Int($0.rounded()))" } ?? ""
        }
    }

    private func markerCoordinates() -> [CLLocationCoordinate2D] {
        guard let currentCoordinate,
              !(weather.temperatureC == nil && weather.precipitationChance == nil && weather.windSpeedMS == nil && weather.airQualityIndex == nil) else {
            return []
        }
        return [currentCoordinate]
    }

    private func selectedForecastPoint() -> WeatherTimelinePoint? {
        guard weather.hourlyForecasts.indices.contains(frameIndex) else { return nil }
        return weather.hourlyForecasts[frameIndex]
    }

    private func selectedForecastSummary() -> String {
        guard let point = selectedForecastPoint() else {
            return layerMode.summary(from: weather)
        }
        switch layerMode {
        case .forecast:
            let temp = point.temperatureC.map { "\(Int($0.rounded()))℃" } ?? weather.temperature
            return "\(point.timeText) · \(point.conditionText) · \(temp)"
        case .temperature:
            let temp = point.temperatureC.map { "\(Int($0.rounded()))℃" } ?? weather.temperature
            return "\(point.timeText) · 기온 \(temp)"
        case .precipitation:
            let chance = point.precipitationChance.map { "강수확률 \(Int(($0 * 100).rounded()))%" } ?? "강수확률 대기"
            let amount = point.precipitationAmountMm.map { String(format: "강수 %.1fmm", $0) } ?? "강수량 대기"
            return "\(point.timeText) · \(chance) · \(amount)"
        case .airQuality:
            return weather.airQualityText.isEmpty ? "\(point.timeText) · 대기질 데이터 대기" : "\(point.timeText) · \(weather.airQualityText)"
        case .wind:
            let speed = point.windSpeedMS.map { String(format: "풍속 %.1fm/s", $0) } ?? "풍속 대기"
            return "\(point.timeText) · \(speed) · \(point.windDirectionText)"
        }
    }

    private func rebuildWeatherMarkers() {
        weatherMarkerViews.forEach { $0.removeFromSuperview() }
        weatherMarkerViews = markerCoordinates().enumerated().map { index, _ in
            let label = UILabel()
            label.textAlignment = .center
            label.textColor = .white
            label.font = UIFont.monospacedDigitSystemFont(ofSize: expanded ? 17 : 9, weight: .black)
            label.text = markerText(for: index)
            label.backgroundColor = layerMode.accentColor.withAlphaComponent(index == 0 ? 0.92 : 0.76)
            label.layer.cornerRadius = expanded ? 24 : 13
            label.layer.borderColor = UIColor.white.withAlphaComponent(0.78).cgColor
            label.layer.borderWidth = expanded ? 2 : 1
            label.layer.masksToBounds = true
            label.isUserInteractionEnabled = false
            weatherOverlayView.addSubview(label)
            return label
        }
    }

    private func layoutWeatherMarkers() {
        let size = CGSize(width: expanded ? 48 : 26, height: expanded ? 48 : 26)
        for (index, coordinate) in markerCoordinates().enumerated() where index < weatherMarkerViews.count {
            var point = mapView.convert(coordinate, toPointTo: weatherOverlayView)
            point.x = min(max(size.width / 2 + 4, point.x), bounds.width - size.width / 2 - 4)
            point.y = min(max(size.height / 2 + 4, point.y), bounds.height - size.height / 2 - 4)
            weatherMarkerViews[index].frame = CGRect(
                x: point.x - size.width / 2,
                y: point.y - size.height / 2,
                width: size.width,
                height: size.height
            )
        }
    }

}

private func weatherLayerButton(mode: WeatherMapLayer, compact: Bool) -> UIButton {
    let button = UIButton(type: .system)
    button.translatesAutoresizingMaskIntoConstraints = false
    button.tag = mode.rawValue
    button.setImage(UIImage(systemName: mode.symbolName), for: .normal)
    button.tintColor = .white
    button.backgroundColor = UIColor.black.withAlphaComponent(0.58)
    button.layer.cornerRadius = compact ? 13 : 18
    button.layer.cornerCurve = .continuous
    button.accessibilityLabel = "\(mode.title) 지도 레이어"
    button.clipsToBounds = true
    NSLayoutConstraint.activate([
        button.widthAnchor.constraint(equalToConstant: compact ? 26 : 36),
        button.heightAnchor.constraint(equalToConstant: compact ? 26 : 36)
    ])
    return button
}

private final class WeatherLayerInfoPanelView: UIVisualEffectView {
    private let expanded: Bool
    private let icon = UIImageView()
    private let title = UILabel()
    private let summary = UILabel()

    init(expanded: Bool) {
        self.expanded = expanded
        super.init(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        translatesAutoresizingMaskIntoConstraints = false
        layer.cornerRadius = expanded ? 16 : 12
        layer.cornerCurve = .continuous
        clipsToBounds = true
        isUserInteractionEnabled = false
        build()
    }

    required init?(coder: NSCoder) {
        nil
    }

    private func build() {
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.contentMode = .scaleAspectFit

        title.translatesAutoresizingMaskIntoConstraints = false
        title.font = UIFont.systemFont(ofSize: expanded ? 17 : 11, weight: .black)
        title.textColor = .white
        title.numberOfLines = 1

        summary.translatesAutoresizingMaskIntoConstraints = false
        summary.font = UIFont.systemFont(ofSize: expanded ? 13 : 8, weight: .bold)
        summary.textColor = UIColor.white.withAlphaComponent(0.76)
        summary.numberOfLines = expanded ? 2 : 1

        contentView.addSubview(icon)
        contentView.addSubview(title)
        contentView.addSubview(summary)

        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: expanded ? 12 : 8),
            icon.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: expanded ? 26 : 16),
            icon.heightAnchor.constraint(equalTo: icon.widthAnchor),
            title.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: expanded ? 10 : 6),
            title.topAnchor.constraint(equalTo: contentView.topAnchor, constant: expanded ? 10 : 6),
            title.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: expanded ? -14 : -8),
            summary.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            summary.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            summary.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 2),
            summary.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: expanded ? -10 : -6)
        ])
    }

    func configure(mode: WeatherMapLayer, weather: LocationWeatherSummary) {
        icon.image = UIImage(systemName: mode.symbolName)
        icon.tintColor = mode.accentColor
        title.text = "\(mode.title) · \(weather.place)"
        summary.text = mode.summary(from: weather)
    }
}

private func weatherLayerInfoPanel(
    mode: WeatherMapLayer,
    weather: LocationWeatherSummary,
    expanded: Bool
) -> WeatherLayerInfoPanelView {
    let panel = WeatherLayerInfoPanelView(expanded: expanded)
    panel.configure(mode: mode, weather: weather)
    return panel
}

private final class RadarViewerController: UIViewController {
    private let times = dashboardRadarTimes
    private var weather: LocationWeatherSummary
    private let currentCoordinate: CLLocationCoordinate2D?
    private var frameIndex: Int
    private var layerMode: WeatherMapLayer
    private var isPlaying = false
    private var timer: Timer?
    private let map = RadarMapCanvas(frameIndex: 3, expanded: true)
    private let titleLabel = UILabel()
    private let playButton = UIButton(type: .system)
    private let timeScroll = UIScrollView()
    private let timeStack = UIStackView()
    private let layerStack = UIStackView()
    private let infoPanel = WeatherLayerInfoPanelView(expanded: true)
    var onCurrentLocationRequested: (() -> CLLocationCoordinate2D?)?
    var onWeatherRefreshRequested: (() -> Void)?

    init(frameIndex: Int, layerMode: WeatherMapLayer, weather: LocationWeatherSummary, currentCoordinate: CLLocationCoordinate2D?) {
        self.frameIndex = min(max(0, frameIndex), times.count - 1)
        self.layerMode = layerMode
        self.weather = weather
        self.currentCoordinate = currentCoordinate
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        .allButUpsideDown
    }

    override var shouldAutorotate: Bool {
        true
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        build()
        updateFrame()
    }

    deinit {
        timer?.invalidate()
    }

    private func build() {
        let header = UIView()
        header.translatesAutoresizingMaskIntoConstraints = false
        header.backgroundColor = UIColor(white: 0.07, alpha: 1)
        let dot = UIView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.backgroundColor = UIColor(red: 0.09, green: 0.70, blue: 0.50, alpha: 1)
        dot.layer.cornerRadius = 5
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.textColor = .white
        titleLabel.font = UIFont.systemFont(ofSize: 21, weight: .black)
        let close = UIButton(type: .system)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.setTitle("닫기", for: .normal)
        close.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .bold)
        close.tintColor = UIColor.white.withAlphaComponent(0.74)
        close.layer.cornerRadius = 8
        close.layer.borderWidth = 1
        close.layer.borderColor = UIColor.white.withAlphaComponent(0.20).cgColor
        close.addTarget(self, action: #selector(closeViewer), for: .touchUpInside)

        map.translatesAutoresizingMaskIntoConstraints = false
        map.layerMode = layerMode
        map.weather = weather
        map.currentCoordinate = currentCoordinate
        map.showsInfoPanel = false
        infoPanel.configure(mode: layerMode, weather: weather)
        playButton.translatesAutoresizingMaskIntoConstraints = false
        playButton.tintColor = .white
        playButton.backgroundColor = UIColor(red: 0.20, green: 0.72, blue: 1.0, alpha: 1)
        playButton.layer.cornerRadius = 17
        playButton.addTarget(self, action: #selector(togglePlay), for: .touchUpInside)

        timeScroll.translatesAutoresizingMaskIntoConstraints = false
        timeScroll.showsHorizontalScrollIndicator = true
        timeScroll.alwaysBounceHorizontal = true
        timeStack.translatesAutoresizingMaskIntoConstraints = false
        timeStack.axis = .horizontal
        timeStack.spacing = 8
        timeStack.alignment = .center
        timeScroll.addSubview(timeStack)

        layerStack.translatesAutoresizingMaskIntoConstraints = false
        layerStack.axis = .horizontal
        layerStack.spacing = 10
        layerStack.alignment = .center
        layerStack.distribution = .equalSpacing
        for mode in WeatherMapLayer.allCases {
            let button = weatherLayerButton(mode: mode, compact: false)
            button.addTarget(self, action: #selector(selectWeatherLayer(_:)), for: .touchUpInside)
            layerStack.addArrangedSubview(button)
        }
        let locationButton = UIButton(type: .system)
        locationButton.translatesAutoresizingMaskIntoConstraints = false
        locationButton.setImage(UIImage(systemName: "location.fill"), for: .normal)
        locationButton.tintColor = .white
        locationButton.backgroundColor = UIColor.black.withAlphaComponent(0.58)
        locationButton.layer.cornerRadius = 18
        locationButton.layer.cornerCurve = .continuous
        locationButton.accessibilityLabel = "현재 위치로 이동"
        locationButton.addTarget(self, action: #selector(recenterWeatherMap), for: .touchUpInside)
        locationButton.widthAnchor.constraint(equalToConstant: 36).isActive = true
        locationButton.heightAnchor.constraint(equalToConstant: 36).isActive = true
        layerStack.addArrangedSubview(locationButton)

        for index in 0..<frameCount {
            let button = UIButton(type: .system)
            button.translatesAutoresizingMaskIntoConstraints = false
            button.tag = index
            button.setTitle(timeTitle(at: index), for: .normal)
            button.titleLabel?.font = UIFont.monospacedDigitSystemFont(ofSize: 13, weight: .bold)
            button.layer.cornerRadius = 6
            button.addTarget(self, action: #selector(selectTime(_:)), for: .touchUpInside)
            button.heightAnchor.constraint(equalToConstant: 28).isActive = true
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 58).isActive = true
            timeStack.addArrangedSubview(button)
        }

        let footer = UILabel()
        footer.translatesAutoresizingMaskIntoConstraints = false
        footer.text = "관제 대시보드 지도 · 강수/바람/특보 요약"
        footer.textColor = UIColor.white.withAlphaComponent(0.62)
        footer.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        footer.textAlignment = .center

        view.addSubview(header)
        header.addSubview(dot)
        header.addSubview(titleLabel)
        header.addSubview(close)
        view.addSubview(map)
        view.addSubview(layerStack)
        view.addSubview(infoPanel)
        view.addSubview(playButton)
        view.addSubview(timeScroll)
        view.addSubview(footer)

        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 64),
            dot.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 30),
            dot.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            dot.widthAnchor.constraint(equalToConstant: 10),
            dot.heightAnchor.constraint(equalToConstant: 10),
            titleLabel.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 12),
            titleLabel.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            close.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -22),
            close.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            close.widthAnchor.constraint(equalToConstant: 76),
            close.heightAnchor.constraint(equalToConstant: 44),
            map.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            map.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            map.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 70),
            map.heightAnchor.constraint(equalTo: view.heightAnchor, multiplier: 0.47),
            layerStack.centerXAnchor.constraint(equalTo: map.centerXAnchor),
            layerStack.topAnchor.constraint(equalTo: map.bottomAnchor, constant: 10),
            layerStack.widthAnchor.constraint(lessThanOrEqualTo: map.widthAnchor),
            layerStack.heightAnchor.constraint(equalToConstant: 36),
            infoPanel.leadingAnchor.constraint(equalTo: map.leadingAnchor),
            infoPanel.trailingAnchor.constraint(equalTo: map.trailingAnchor),
            infoPanel.topAnchor.constraint(equalTo: layerStack.bottomAnchor, constant: 10),
            infoPanel.heightAnchor.constraint(equalToConstant: 64),
            playButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 30),
            playButton.topAnchor.constraint(equalTo: infoPanel.bottomAnchor, constant: 24),
            playButton.widthAnchor.constraint(equalToConstant: 34),
            playButton.heightAnchor.constraint(equalToConstant: 34),
            timeScroll.leadingAnchor.constraint(equalTo: playButton.trailingAnchor, constant: 16),
            timeScroll.centerYAnchor.constraint(equalTo: playButton.centerYAnchor),
            timeScroll.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            timeScroll.heightAnchor.constraint(equalToConstant: 34),
            timeStack.leadingAnchor.constraint(equalTo: timeScroll.contentLayoutGuide.leadingAnchor),
            timeStack.trailingAnchor.constraint(equalTo: timeScroll.contentLayoutGuide.trailingAnchor),
            timeStack.topAnchor.constraint(equalTo: timeScroll.contentLayoutGuide.topAnchor, constant: 3),
            timeStack.bottomAnchor.constraint(equalTo: timeScroll.contentLayoutGuide.bottomAnchor, constant: -3),
            timeStack.heightAnchor.constraint(equalTo: timeScroll.frameLayoutGuide.heightAnchor, constant: -6),
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            footer.topAnchor.constraint(equalTo: timeScroll.bottomAnchor, constant: 16)
        ])
    }

    private func updateFrame() {
        frameIndex = min(max(0, frameIndex), frameCount - 1)
        map.frameIndex = frameIndex
        titleLabel.text = "\(layerMode.title)  \(timeTitle(at: frameIndex))"
        infoPanel.configure(mode: layerMode, weather: weather)
        let playSymbol = isPlaying ? "pause.fill" : "play.fill"
        playButton.setImage(UIImage(systemName: playSymbol), for: .normal)
        for case let button as UIButton in timeStack.arrangedSubviews {
            let selected = button.tag == frameIndex
            button.backgroundColor = selected ? UIColor(red: 0.08, green: 0.66, blue: 0.44, alpha: 1) : UIColor.white.withAlphaComponent(0.12)
            button.setTitleColor(selected ? .white : UIColor.white.withAlphaComponent(0.68), for: .normal)
        }
        for case let button as UIButton in layerStack.arrangedSubviews where button.tag >= 0 {
            let mode = WeatherMapLayer(rawValue: button.tag)
            button.backgroundColor = mode == layerMode ? layerMode.accentColor : UIColor.black.withAlphaComponent(0.58)
            button.tintColor = .white
        }
    }

    @objc private func closeViewer() {
        timer?.invalidate()
        dismiss(animated: true)
    }

    @objc private func togglePlay() {
        isPlaying.toggle()
        timer?.invalidate()
        if isPlaying {
            timer = Timer.scheduledTimer(withTimeInterval: 1.1, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.frameIndex = (self.frameIndex + 1) % self.frameCount
                self.updateFrame()
            }
        }
        updateFrame()
    }

    @objc private func selectTime(_ sender: UIButton) {
        frameIndex = sender.tag
        isPlaying = false
        timer?.invalidate()
        updateFrame()
    }

    @objc private func selectWeatherLayer(_ sender: UIButton) {
        guard let mode = WeatherMapLayer(rawValue: sender.tag) else { return }
        layerMode = mode
        map.layerMode = mode
        updateFrame()
    }

    @objc private func recenterWeatherMap() {
        onWeatherRefreshRequested?()
        if let coordinate = onCurrentLocationRequested?() {
            map.currentCoordinate = coordinate
        }
        map.recenterToCurrentLocation()
    }

    func updateWeather(_ weather: LocationWeatherSummary, coordinate: CLLocationCoordinate2D?) {
        self.weather = weather
        map.weather = weather
        if let coordinate {
            map.currentCoordinate = coordinate
        }
        updateFrame()
    }

    private var frameCount: Int {
        max(1, weather.hourlyForecasts.isEmpty ? times.count : weather.hourlyForecasts.count)
    }

    private func timeTitle(at index: Int) -> String {
        if weather.hourlyForecasts.indices.contains(index) {
            return weather.hourlyForecasts[index].timeText
        }
        guard times.indices.contains(index) else { return "대기" }
        return times[index]
    }
}

private final class CCTVViewerController: UIViewController {
    private let feed: DashboardCCTVFeed
    private var startsExpanded: Bool
    private let videoContainer = UIView()
    private let controls = UIStackView()
    private let titleLabel = UILabel()
    private let metaLabel = UILabel()
    private var player: AVPlayer?
    private var playerLayer: AVPlayerLayer?
    private var mjpegWebView: WKWebView?
    private var pipController: AVPictureInPictureController?
    private var controlsHidden = false

    init(feed: DashboardCCTVFeed, startsExpanded: Bool) {
        self.feed = feed
        self.startsExpanded = startsExpanded
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        .allButUpsideDown
    }

    override var prefersStatusBarHidden: Bool {
        startsExpanded || controlsHidden
    }

    override var shouldAutorotate: Bool {
        true
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        build()
        configurePlayerIfNeeded()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        playerLayer?.frame = videoContainer.bounds
    }

    private func build() {
        videoContainer.translatesAutoresizingMaskIntoConstraints = false
        videoContainer.backgroundColor = UIColor(white: 0.07, alpha: 1)
        videoContainer.clipsToBounds = true

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "\(feed.name)  \(feed.id)"
        titleLabel.textColor = .white
        titleLabel.font = UIFont.systemFont(ofSize: 17, weight: .black)
        titleLabel.textAlignment = .left

        metaLabel.translatesAutoresizingMaskIntoConstraints = false
        let hasLiveSource = feed.streamURL != nil || feed.mjpegURL != nil
        metaLabel.text = hasLiveSource ? "\(feed.state) · 실시간 영상\n\(feed.meta)" : "AI 서버 연결 대기\n\(feed.meta)"
        metaLabel.textColor = UIColor.white.withAlphaComponent(0.72)
        metaLabel.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        metaLabel.textAlignment = .center
        metaLabel.numberOfLines = 2

        let back = iconButton("xmark", action: #selector(close))
        let expand = iconButton(startsExpanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", action: #selector(toggleExpanded))
        let pip = iconButton("pip.enter", action: #selector(togglePictureInPicture))
        pip.isEnabled = feed.streamURL != nil && AVPictureInPictureController.isPictureInPictureSupported()
        pip.alpha = pip.isEnabled ? 1.0 : 0.35
        let camera = iconButton("camera.fill", action: #selector(showCaptureNotice))
        let rec = iconButton("record.circle.fill", action: #selector(showRecordNotice))
        let call = iconButton("phone.badge.waveform.fill", action: #selector(showCallNotice))

        controls.translatesAutoresizingMaskIntoConstraints = false
        controls.axis = .horizontal
        controls.spacing = startsExpanded ? 12 : 30
        controls.alignment = .center
        [pip, camera, rec, call, expand].forEach(controls.addArrangedSubview)

        view.addSubview(videoContainer)
        view.addSubview(titleLabel)
        view.addSubview(metaLabel)
        view.addSubview(back)
        view.addSubview(controls)

        let live = statusBadge("● LIVE", foreground: UIColor(red: 1.0, green: 0.27, blue: 0.29, alpha: 1.0), background: UIColor.black.withAlphaComponent(0.56))
        let on = statusBadge(" power ON", foreground: .white, background: UIColor(red: 0.0, green: 0.74, blue: 0.48, alpha: 1.0), symbol: "power")
        let detectionTitle = statusBadge("● 실시간 감지", foreground: UIColor(red: 0.18, green: 0.86, blue: 0.66, alpha: 1.0), background: .clear)
        let detectionMeta = statusBadge("YOLOv8 · -- · 총 0", foreground: UIColor.white.withAlphaComponent(0.66), background: .clear)
        videoContainer.addSubview(live)
        view.addSubview(on)
        view.addSubview(detectionTitle)
        view.addSubview(detectionMeta)

        let tap = UITapGestureRecognizer(target: self, action: #selector(toggleControls))
        tap.numberOfTapsRequired = 1
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(toggleExpanded))
        doubleTap.numberOfTapsRequired = 2
        tap.require(toFail: doubleTap)
        videoContainer.addGestureRecognizer(tap)
        videoContainer.addGestureRecognizer(doubleTap)

        if startsExpanded {
            NSLayoutConstraint.activate([
                videoContainer.topAnchor.constraint(equalTo: view.topAnchor),
                videoContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -82),
                videoContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                videoContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                controls.trailingAnchor.constraint(equalTo: back.leadingAnchor, constant: -16),
                controls.centerYAnchor.constraint(equalTo: back.centerYAnchor),
                back.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -22),
                back.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 18),
                titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 18),
                titleLabel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 28),
                titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: on.leadingAnchor, constant: -18),
                on.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
                on.trailingAnchor.constraint(equalTo: controls.leadingAnchor, constant: -14),
                on.widthAnchor.constraint(equalToConstant: 64),
                on.heightAnchor.constraint(equalToConstant: 28),
                metaLabel.centerXAnchor.constraint(equalTo: videoContainer.centerXAnchor),
                metaLabel.centerYAnchor.constraint(equalTo: videoContainer.centerYAnchor, constant: 58),
                live.leadingAnchor.constraint(equalTo: videoContainer.leadingAnchor, constant: 22),
                live.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 42),
                live.widthAnchor.constraint(equalToConstant: 82),
                live.heightAnchor.constraint(equalToConstant: 32),
                detectionTitle.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 28),
                detectionTitle.topAnchor.constraint(equalTo: videoContainer.bottomAnchor, constant: 18),
                detectionMeta.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -28),
                detectionMeta.centerYAnchor.constraint(equalTo: detectionTitle.centerYAnchor)
            ])
        } else {
            NSLayoutConstraint.activate([
                back.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 22),
                back.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 18),
                titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 22),
                titleLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                metaLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 6),
                metaLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                videoContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                videoContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                videoContainer.topAnchor.constraint(equalTo: metaLabel.bottomAnchor, constant: 24),
                videoContainer.heightAnchor.constraint(equalTo: view.widthAnchor, multiplier: 9.0 / 16.0),
                controls.topAnchor.constraint(equalTo: videoContainer.bottomAnchor, constant: 22),
                controls.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                live.leadingAnchor.constraint(equalTo: videoContainer.leadingAnchor, constant: 16),
                live.topAnchor.constraint(equalTo: videoContainer.topAnchor, constant: 16),
                live.widthAnchor.constraint(equalToConstant: 82),
                live.heightAnchor.constraint(equalToConstant: 32),
                on.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -18),
                on.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
                on.widthAnchor.constraint(equalToConstant: 64),
                on.heightAnchor.constraint(equalToConstant: 28),
                detectionTitle.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 22),
                detectionTitle.topAnchor.constraint(equalTo: controls.bottomAnchor, constant: 20),
                detectionMeta.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -22),
                detectionMeta.centerYAnchor.constraint(equalTo: detectionTitle.centerYAnchor)
            ])
        }

        if !hasLiveSource {
            addPlaceholder()
        }
    }

    private func configurePlayerIfNeeded() {
        if let url = feed.streamURL {
            let player = AVPlayer(url: url)
            let layer = AVPlayerLayer(player: player)
            layer.videoGravity = .resizeAspect
            videoContainer.layer.insertSublayer(layer, at: 0)
            self.player = player
            self.playerLayer = layer
            if AVPictureInPictureController.isPictureInPictureSupported() {
                pipController = AVPictureInPictureController(playerLayer: layer)
            }
            player.play()
            return
        }

        guard let mjpegURL = feed.mjpegURL else { return }
        let webView = vitalGuardCCTVWebView(for: mjpegURL)
        videoContainer.insertSubview(webView, at: 0)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: videoContainer.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: videoContainer.trailingAnchor),
            webView.topAnchor.constraint(equalTo: videoContainer.topAnchor),
            webView.bottomAnchor.constraint(equalTo: videoContainer.bottomAnchor)
        ])
        self.mjpegWebView = webView
    }

    private func addPlaceholder() {
        let icon = UIImageView(image: UIImage(systemName: "video.slash.fill"))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.tintColor = .white.withAlphaComponent(0.65)
        icon.contentMode = .scaleAspectFit
        let message = UILabel()
        message.translatesAutoresizingMaskIntoConstraints = false
        message.text = "AI 서버 연결 대기\n\(feed.streamURL?.absoluteString ?? feed.mjpegURL?.absoluteString ?? "https://cctv-ai-569797426568.asia-northeast3.run.app")"
        message.textColor = .white.withAlphaComponent(0.72)
        message.font = UIFont.systemFont(ofSize: 14, weight: .bold)
        message.textAlignment = .center
        message.numberOfLines = 2
        videoContainer.addSubview(icon)
        videoContainer.addSubview(message)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: videoContainer.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: videoContainer.centerYAnchor, constant: -22),
            icon.widthAnchor.constraint(equalToConstant: 42),
            icon.heightAnchor.constraint(equalToConstant: 42),
            message.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 14),
            message.leadingAnchor.constraint(equalTo: videoContainer.leadingAnchor, constant: 28),
            message.trailingAnchor.constraint(equalTo: videoContainer.trailingAnchor, constant: -28)
        ])
    }

    private func iconButton(_ name: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setImage(UIImage(systemName: name), for: .normal)
        button.tintColor = .white
        button.backgroundColor = UIColor.white.withAlphaComponent(0.12)
        button.layer.cornerRadius = 24
        button.layer.cornerCurve = .continuous
        button.addTarget(self, action: action, for: .touchUpInside)
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 48),
            button.heightAnchor.constraint(equalToConstant: 48)
        ])
        return button
    }

    private func statusBadge(_ text: String, foreground: UIColor, background: UIColor, symbol: String? = nil) -> UILabel {
        let badge = UILabel()
        badge.translatesAutoresizingMaskIntoConstraints = false
        if let symbol {
            let attachment = NSTextAttachment()
            attachment.image = UIImage(systemName: symbol)?.withTintColor(foreground, renderingMode: .alwaysOriginal)
            attachment.bounds = CGRect(x: 0, y: -2, width: 13, height: 13)
            let value = NSMutableAttributedString(attachment: attachment)
            value.append(NSAttributedString(string: text, attributes: [.foregroundColor: foreground]))
            badge.attributedText = value
        } else {
            badge.text = text
            badge.textColor = foreground
        }
        badge.font = UIFont.systemFont(ofSize: 13, weight: .black)
        badge.textAlignment = .center
        badge.backgroundColor = background
        badge.layer.cornerRadius = 8
        badge.layer.cornerCurve = .continuous
        badge.clipsToBounds = true
        return badge
    }

    @objc private func close() {
        player?.pause()
        mjpegWebView?.stopLoading()
        dismiss(animated: true)
    }

    @objc private func toggleExpanded() {
        let viewer = CCTVViewerController(feed: feed, startsExpanded: !startsExpanded)
        viewer.overrideUserInterfaceStyle = .dark
        viewer.modalPresentationStyle = .fullScreen
        dismiss(animated: false) {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }
                .first?
                .present(viewer, animated: false)
        }
    }

    @objc private func toggleControls() {
        controlsHidden.toggle()
        UIView.animate(withDuration: 0.2) {
            self.controls.alpha = self.controlsHidden ? 0 : 1
            self.titleLabel.alpha = self.controlsHidden ? 0 : 1
            self.metaLabel.alpha = self.controlsHidden ? 0 : 1
        }
        setNeedsStatusBarAppearanceUpdate()
    }

    @objc private func togglePictureInPicture() {
        guard let pipController else { return }
        pipController.isPictureInPictureActive ? pipController.stopPictureInPicture() : pipController.startPictureInPicture()
    }

    @objc private func showCaptureNotice() {
        metaLabel.text = "캡처 기능은 관제 CCTV URL 수신 후 저장 정책과 함께 연결됩니다."
    }

    @objc private func showRecordNotice() {
        metaLabel.text = "녹화는 관제 서버 저장 정책과 연결 후 사용할 수 있습니다."
    }

    @objc private func showCallNotice() {
        metaLabel.text = "관리자 호출은 홈 대시보드 연동 버튼과 같은 안전 액션으로 처리됩니다."
    }
}

private struct DashboardAlertItem {
    var type: String
    var worker: String
    var timestamp: String
    var acknowledged: Bool
}

private struct PhoneFallAlert {
    var candidateId: String
    var workerName: String
    var message: String
}

private struct DashboardHomeSummarySnapshot {
    var progressValue: String
    var progressFraction: CGFloat
    var progressDetail: String
    var progressTrailing: String
    var safetyValue: String
    var safetyFraction: CGFloat
    var safetyDetail: String
    var safetyTrailing: String
    var registeredWorkers: String
    var pendingWorkers: String
    var recentCount: String
    var totalPersisted: String
    var fetchedAt: Date
}

/// 관제 웹의 공정/무사고 막대와 같은 방식으로, 실제 진행 지점 이후를 어둡게 처리한다.
private final class DashboardGradientProgressTrack: UIView {
    private let gradientLayer = CAGradientLayer()
    private let remainingLayer = CALayer()
    private let markerLayer = CALayer()
    private let progressFraction: CGFloat?

    init(colors: [UIColor], progressFraction: CGFloat?) {
        self.progressFraction = progressFraction
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        layer.cornerRadius = 5
        layer.cornerCurve = .continuous
        layer.masksToBounds = true

        gradientLayer.colors = colors.map(\.cgColor)
        gradientLayer.startPoint = CGPoint(x: 0, y: 0.5)
        gradientLayer.endPoint = CGPoint(x: 1, y: 0.5)
        layer.addSublayer(gradientLayer)

        remainingLayer.backgroundColor = UIColor.black.withAlphaComponent(0.62).cgColor
        layer.addSublayer(remainingLayer)

        markerLayer.backgroundColor = UIColor.white.withAlphaComponent(0.96).cgColor
        layer.addSublayer(markerLayer)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradientLayer.frame = bounds

        guard let progressFraction else {
            remainingLayer.isHidden = true
            markerLayer.isHidden = true
            return
        }

        let fraction = min(1, max(0, progressFraction))
        let markerWidth: CGFloat = 2
        let markerX = min(max(0, bounds.width * fraction), max(0, bounds.width - markerWidth))
        remainingLayer.isHidden = false
        remainingLayer.frame = CGRect(x: markerX + markerWidth, y: 0, width: max(0, bounds.width - markerX - markerWidth), height: bounds.height)
        markerLayer.isHidden = false
        markerLayer.frame = CGRect(x: markerX, y: 0, width: markerWidth, height: bounds.height)
    }
}

private struct OpenMeteoWeatherResponse: Decodable {
    struct Current: Decodable {
        let temperature2m: Double?
        let apparentTemperature: Double?
        let relativeHumidity2m: Double?
        let precipitation: Double?
        let weatherCode: Int?
        let windSpeed10m: Double?

        enum CodingKeys: String, CodingKey {
            case temperature2m = "temperature_2m"
            case apparentTemperature = "apparent_temperature"
            case relativeHumidity2m = "relative_humidity_2m"
            case precipitation
            case weatherCode = "weather_code"
            case windSpeed10m = "wind_speed_10m"
        }
    }

    let current: Current?
}

private struct DashboardWeatherResponse: Decodable {
    struct Current: Decodable {
        let weatherCode: Int?
        let temperatureC: Double?
        let apparentTempC: Double?
        let humidityPct: Double?
        let windKmh: Double?
        let precipitationMm: Double?
        let uvIndex: Double?
        let pm10: Double?
        let pm25: Double?

        enum CodingKeys: String, CodingKey {
            case weatherCode = "weatherCode"
            case temperatureC
            case apparentTempC
            case humidityPct
            case windKmh
            case precipitationMm
            case uvIndex
            case pm10
            case pm25
        }
    }

    let source: String?
    let lat: Double?
    let lon: Double?
    let current: Current?
    let ok: Bool?
    let cached: Bool?
    let stale: Bool?
}

private enum SafetySignalKind: Int, CaseIterable {
    case weather
    case workers
    case gas
    case aed

    var title: String {
        switch self {
        case .weather: return "현장 기상"
        case .workers: return "작업자"
        case .gas: return "가스 감지"
        case .aed: return "AED"
        }
    }

    var subtitle: String {
        switch self {
        case .weather: return "관제 웹 현장 환경 데이터"
        case .workers: return "작업자 모니터링 데이터"
        case .gas: return "가스 누출 감지기 데이터"
        case .aed: return "심장 제세동기 알림 데이터"
        }
    }

    var symbol: String {
        switch self {
        case .weather: return "cloud.sun"
        case .workers: return "person.2"
        case .gas: return "wind"
        case .aed: return "heart.text.square"
        }
    }

    var tint: UIColor {
        switch self {
        case .weather: return UIColor(red: 0.05, green: 0.60, blue: 1.0, alpha: 1.0)
        case .workers: return UIColor(red: 0.00, green: 0.62, blue: 0.32, alpha: 1.0)
        case .gas: return UIColor(red: 0.83, green: 0.00, blue: 0.02, alpha: 1.0)
        case .aed: return UIColor(red: 0.92, green: 0.22, blue: 0.38, alpha: 1.0)
        }
    }
}

private struct SafetySignalMetric {
    let title: String
    let value: String
    let unit: String
    let tint: UIColor
}

private struct SafetySignalRecord {
    let title: String
    let subtitle: String
    let value: String
    let status: String
    let detail: String
    let tint: UIColor
}

private struct SafetySignalDetailSnapshot {
    let status: DashboardConnectionState
    let summary: String
    let metrics: [SafetySignalMetric]
    let rows: [SafetySignalRecord]
    let source: String
}

private final class SafetySignalDetailViewController: UIViewController {
    private let kind: SafetySignalKind
    private let interfaceStyle: UIUserInterfaceStyle
    private let scrollView = UIScrollView()
    private let stackView = UIStackView()
    private let statusLabel = UILabel()
    private let sourceLabel = UILabel()
    private let summaryLabel = UILabel()
    private let metricsStack = UIStackView()
    private let rowsStack = UIStackView()
    private var currentSnapshot: SafetySignalDetailSnapshot?

    init(kind: SafetySignalKind, interfaceStyle: UIUserInterfaceStyle) {
        self.kind = kind
        self.interfaceStyle = interfaceStyle
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        kind = .weather
        interfaceStyle = .unspecified
        super.init(coder: coder)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = interfaceStyle
        title = kind.title
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close))
        let refreshItem = UIBarButtonItem(
            image: UIImage(systemName: "arrow.clockwise"),
            style: .plain,
            target: self,
            action: #selector(refresh)
        )
        if kind == .workers || kind == .gas || kind == .aed {
            navigationItem.rightBarButtonItems = [
                refreshItem,
                UIBarButtonItem(title: "순서 편집", style: .plain, target: self, action: #selector(openOrderEditor))
            ]
        } else {
            navigationItem.rightBarButtonItem = refreshItem
        }
        buildInterface()
        applySnapshot(fallbackSnapshot(loading: true))
        refresh()
    }

    private func buildInterface() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        stackView.translatesAutoresizingMaskIntoConstraints = false
        stackView.axis = .vertical
        stackView.spacing = 14
        stackView.layoutMargins = UIEdgeInsets(top: 18, left: 18, bottom: 32, right: 18)
        stackView.isLayoutMarginsRelativeArrangement = true
        view.addSubview(scrollView)
        scrollView.addSubview(stackView)

        let hero = heroCard()
        metricsStack.axis = .vertical
        metricsStack.spacing = 8
        rowsStack.axis = .vertical
        rowsStack.spacing = 8
        stackView.addArrangedSubview(hero)
        stackView.addArrangedSubview(metricsStack)
        stackView.addArrangedSubview(rowsStack)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stackView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            stackView.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            stackView.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            stackView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            stackView.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor)
        ])
    }

    private func heroCard() -> UIView {
        let card = roundedCard()
        let icon = UIImageView(image: UIImage(systemName: kind.symbol))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.tintColor = kind.tint
        icon.contentMode = .scaleAspectFit
        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = kind.title
        titleLabel.font = UIFont.systemFont(ofSize: 26, weight: .black)
        titleLabel.textColor = .label
        let subtitleLabel = UILabel()
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.text = kind.subtitle
        subtitleLabel.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        subtitleLabel.textColor = .secondaryLabel
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = UIFont.systemFont(ofSize: 13, weight: .black)
        statusLabel.textColor = kind.tint
        sourceLabel.translatesAutoresizingMaskIntoConstraints = false
        sourceLabel.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        sourceLabel.textColor = .tertiaryLabel
        sourceLabel.numberOfLines = 2
        summaryLabel.translatesAutoresizingMaskIntoConstraints = false
        summaryLabel.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        summaryLabel.textColor = .label
        summaryLabel.numberOfLines = 0

        card.addSubview(icon)
        card.addSubview(titleLabel)
        card.addSubview(subtitleLabel)
        card.addSubview(statusLabel)
        card.addSubview(sourceLabel)
        card.addSubview(summaryLabel)

        NSLayoutConstraint.activate([
            icon.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
            icon.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            icon.widthAnchor.constraint(equalToConstant: 36),
            icon.heightAnchor.constraint(equalToConstant: 36),
            titleLabel.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12),
            titleLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            titleLabel.topAnchor.constraint(equalTo: icon.topAnchor, constant: -2),
            subtitleLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            subtitleLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2),
            statusLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            statusLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            statusLabel.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 16),
            summaryLabel.leadingAnchor.constraint(equalTo: statusLabel.leadingAnchor),
            summaryLabel.trailingAnchor.constraint(equalTo: statusLabel.trailingAnchor),
            summaryLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 8),
            sourceLabel.leadingAnchor.constraint(equalTo: statusLabel.leadingAnchor),
            sourceLabel.trailingAnchor.constraint(equalTo: statusLabel.trailingAnchor),
            sourceLabel.topAnchor.constraint(equalTo: summaryLabel.bottomAnchor, constant: 12),
            sourceLabel.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18)
        ])
        return card
    }

    private func roundedCard() -> UIView {
        let card = UIView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = UIColor.secondarySystemBackground
        card.layer.cornerRadius = 22
        card.layer.cornerCurve = .continuous
        card.layer.borderColor = UIColor.separator.withAlphaComponent(0.45).cgColor
        card.layer.borderWidth = 1
        return card
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    @objc private func refresh() {
        navigationItem.rightBarButtonItems?.first?.isEnabled = false
        navigationItem.rightBarButtonItem?.isEnabled = false
        fetchSnapshot { [weak self] snapshot in
            DispatchQueue.main.async {
                self?.navigationItem.rightBarButtonItems?.first?.isEnabled = true
                self?.navigationItem.rightBarButtonItem?.isEnabled = true
                self?.applySnapshot(snapshot)
            }
        }
    }

    @objc private func openOrderEditor() {
        guard let currentSnapshot else { return }
        let rows = orderedRows(currentSnapshot.rows)
        let editor = SafetySignalOrderEditorController(kind: kind, rows: rows, interfaceStyle: interfaceStyle)
        editor.onSave = { [weak self] orderedTitles in
            guard let self else { return }
            UserDefaults.standard.set(orderedTitles, forKey: self.orderDefaultsKey)
            if let snapshot = self.currentSnapshot {
                self.applySnapshot(snapshot)
            }
        }
        let nav = UINavigationController(rootViewController: editor)
        nav.overrideUserInterfaceStyle = interfaceStyle
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    private func applySnapshot(_ snapshot: SafetySignalDetailSnapshot) {
        currentSnapshot = snapshot
        statusLabel.text = snapshot.status.title
        statusLabel.textColor = snapshot.status.color
        summaryLabel.text = snapshot.summary
        sourceLabel.text = snapshot.source
        metricsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        rowsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let metricRows = stride(from: 0, to: snapshot.metrics.count, by: 2).map { index -> UIView in
            let row = UIStackView()
            row.axis = .horizontal
            row.spacing = 8
            row.distribution = .fillEqually
            row.addArrangedSubview(metricCard(snapshot.metrics[index]))
            if snapshot.metrics.indices.contains(index + 1) {
                row.addArrangedSubview(metricCard(snapshot.metrics[index + 1]))
            } else {
                row.addArrangedSubview(UIView())
            }
            return row
        }
        metricRows.forEach { metricsStack.addArrangedSubview($0) }
        orderedRows(snapshot.rows).forEach { rowsStack.addArrangedSubview(detailRow($0)) }
    }

    private var orderDefaultsKey: String {
        "preview.safetySignal.order.\(kind.rawValue)"
    }

    private func orderedRows(_ rows: [SafetySignalRecord]) -> [SafetySignalRecord] {
        guard let saved = UserDefaults.standard.stringArray(forKey: orderDefaultsKey),
              !saved.isEmpty
        else { return rows }
        let indexByTitle = Dictionary(uniqueKeysWithValues: saved.enumerated().map { ($0.element, $0.offset) })
        return rows.enumerated().sorted { lhs, rhs in
            let lhsRank = indexByTitle[lhs.element.title] ?? (saved.count + lhs.offset)
            let rhsRank = indexByTitle[rhs.element.title] ?? (saved.count + rhs.offset)
            return lhsRank < rhsRank
        }.map(\.element)
    }

    private func metricCard(_ metric: SafetySignalMetric) -> UIView {
        let card = roundedCard()
        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = metric.title
        title.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        title.textColor = .secondaryLabel
        let value = UILabel()
        value.translatesAutoresizingMaskIntoConstraints = false
        value.text = metric.value
        value.font = UIFont.systemFont(ofSize: 25, weight: .black)
        value.textColor = metric.tint
        value.adjustsFontSizeToFitWidth = true
        value.minimumScaleFactor = 0.65
        let unit = UILabel()
        unit.translatesAutoresizingMaskIntoConstraints = false
        unit.text = metric.unit
        unit.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        unit.textColor = .tertiaryLabel
        card.addSubview(title)
        card.addSubview(value)
        card.addSubview(unit)
        NSLayoutConstraint.activate([
            card.heightAnchor.constraint(equalToConstant: 96),
            title.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            title.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            title.topAnchor.constraint(equalTo: card.topAnchor, constant: 13),
            value.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            value.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            value.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 7),
            unit.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            unit.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            unit.topAnchor.constraint(equalTo: value.bottomAnchor, constant: 1),
            unit.bottomAnchor.constraint(lessThanOrEqualTo: card.bottomAnchor, constant: -10)
        ])
        return card
    }

    private func detailRow(_ record: SafetySignalRecord) -> UIView {
        let row = roundedCard()
        let dot = UIView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.backgroundColor = record.tint
        dot.layer.cornerRadius = 5
        dot.layer.cornerCurve = .continuous

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = record.title
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)
        title.textColor = .label
        title.numberOfLines = 1
        title.adjustsFontSizeToFitWidth = true
        title.minimumScaleFactor = 0.78

        let subtitle = UILabel()
        subtitle.translatesAutoresizingMaskIntoConstraints = false
        subtitle.text = record.subtitle
        subtitle.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        subtitle.textColor = .secondaryLabel
        subtitle.numberOfLines = 2

        let value = UILabel()
        value.translatesAutoresizingMaskIntoConstraints = false
        value.text = record.value
        value.font = UIFont.monospacedDigitSystemFont(ofSize: 20, weight: .black)
        value.textColor = record.tint
        value.textAlignment = .right
        value.adjustsFontSizeToFitWidth = true
        value.minimumScaleFactor = 0.65

        let status = UILabel()
        status.translatesAutoresizingMaskIntoConstraints = false
        status.text = record.status
        status.font = UIFont.systemFont(ofSize: 12, weight: .black)
        status.textColor = record.tint
        status.textAlignment = .right
        status.numberOfLines = 1
        status.adjustsFontSizeToFitWidth = true
        status.minimumScaleFactor = 0.7

        let detail = UILabel()
        detail.translatesAutoresizingMaskIntoConstraints = false
        detail.text = record.detail
        detail.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        detail.textColor = .tertiaryLabel
        detail.numberOfLines = 2

        row.addSubview(dot)
        row.addSubview(title)
        row.addSubview(subtitle)
        row.addSubview(value)
        row.addSubview(status)
        row.addSubview(detail)
        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 86),
            dot.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
            dot.topAnchor.constraint(equalTo: row.topAnchor, constant: 18),
            dot.widthAnchor.constraint(equalToConstant: 10),
            dot.heightAnchor.constraint(equalToConstant: 10),
            title.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 10),
            title.trailingAnchor.constraint(lessThanOrEqualTo: value.leadingAnchor, constant: -10),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 13),
            subtitle.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            subtitle.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            subtitle.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 4),
            detail.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            detail.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            detail.topAnchor.constraint(equalTo: subtitle.bottomAnchor, constant: 5),
            detail.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -13),
            value.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            value.topAnchor.constraint(equalTo: row.topAnchor, constant: 13),
            value.widthAnchor.constraint(equalToConstant: 92),
            status.trailingAnchor.constraint(equalTo: value.trailingAnchor),
            status.topAnchor.constraint(equalTo: value.bottomAnchor, constant: 3),
            status.widthAnchor.constraint(equalToConstant: 92)
        ])
        return row
    }

    private func fetchSnapshot(completion: @escaping (SafetySignalDetailSnapshot) -> Void) {
        switch kind {
        case .weather:
            fetchWeatherSnapshot(completion: completion)
        case .workers:
            fetchVitalSnapshot(completion: completion)
        case .gas:
            fetchGasSnapshot(completion: completion)
        case .aed:
            fetchAEDSnapshot(completion: completion)
        }
    }

    private func fetchWeatherSnapshot(completion: @escaping (SafetySignalDetailSnapshot) -> Void) {
        guard var components = URLComponents(string: "\(VitalGuardLinks.safetyMonitor)/api/weather") else {
            completion(fallbackSnapshot(loading: false))
            return
        }
        components.queryItems = [
            URLQueryItem(name: "lat", value: "35.148170"),
            URLQueryItem(name: "lon", value: "126.919104"),
            URLQueryItem(name: "workers", value: "1")
        ]
        guard let url = components.url else {
            completion(fallbackSnapshot(loading: false))
            return
        }
        URLSession.shared.dataTask(with: URLRequest(url: url)) { data, response, _ in
            guard let data,
                  (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0),
                  let decoded = try? JSONDecoder().decode(DashboardWeatherResponse.self, from: data),
                  let current = decoded.current else {
                completion(self.fallbackSnapshot(loading: false))
                return
            }
            let status: DashboardConnectionState = (decoded.stale == true || decoded.cached == true) ? .delayed : .connected
            let metrics = [
                SafetySignalMetric(title: "기온", value: "\(Int((current.temperatureC ?? 0).rounded()))", unit: "℃", tint: self.kind.tint),
                SafetySignalMetric(title: "풍속", value: String(format: "%.1f", current.windKmh ?? 0), unit: "km/h", tint: UIColor.systemBlue),
                SafetySignalMetric(title: "강수", value: String(format: "%.1f", current.precipitationMm ?? 0), unit: "mm", tint: UIColor.systemTeal),
                SafetySignalMetric(title: "UV", value: String(format: "%.1f", current.uvIndex ?? 0), unit: "index", tint: UIColor.systemOrange)
            ]
            completion(SafetySignalDetailSnapshot(
                status: status,
                summary: "현장 위치 기준 기상·대기질을 관제 웹에서 수신했습니다.",
                metrics: metrics,
                rows: [
                    SafetySignalRecord(title: "체감·습도", subtitle: "관제 웹 /api/weather", value: "\(Int((current.apparentTempC ?? current.temperatureC ?? 0).rounded()))℃", status: "\(Int((current.humidityPct ?? 0).rounded()))%", detail: "PM10 \(Int((current.pm10 ?? 0).rounded())) · PM2.5 \(Int((current.pm25 ?? 0).rounded()))", tint: self.kind.tint),
                    SafetySignalRecord(title: "GPS 기준 좌표", subtitle: decoded.source ?? "관제 웹 기상 API", value: String(format: "%.5f", decoded.lat ?? 0), status: String(format: "%.5f", decoded.lon ?? 0), detail: "API 응답에 포함된 lat/lon 값만 표시", tint: UIColor.systemBlue)
                ],
                source: decoded.source ?? "\(VitalGuardLinks.safetyMonitor)/api/weather"
            ))
        }.resume()
    }

    private func fetchVitalSnapshot(completion: @escaping (SafetySignalDetailSnapshot) -> Void) {
        fetchJSONCandidates(["/api/mock/vital"]) { json in
            guard let dict = json as? [String: Any] else {
                completion(self.unavailableSnapshot(source: "\(VitalGuardLinks.safetyMonitor)/api/mock/vital"))
                return
            }
            let items = self.arrayItems(from: dict, keys: ["latest"])
            let recent = self.arrayItems(from: dict, keys: ["recent"])
            let totalPersisted = self.numberValue(from: dict, keys: ["totalPersisted"])
            let rows = items.map { self.workerRecord(from: $0, counts: dict["countsByWorker"] as? [String: Any], profiles: dict["workerProfiles"] as? [String: Any]) }
            var metrics = [
                SafetySignalMetric(title: "작업자", value: "\(items.count)", unit: "명", tint: self.kind.tint),
                SafetySignalMetric(title: "최근 수신", value: "\(recent.count)", unit: "건", tint: UIColor.systemBlue)
            ]
            if let totalPersisted {
                metrics.append(SafetySignalMetric(title: "DB 누적", value: "\(totalPersisted)", unit: "건", tint: UIColor.systemGreen))
            }
            completion(SafetySignalDetailSnapshot(
                status: rows.isEmpty ? .delayed : .connected,
                summary: rows.isEmpty ? "관제 웹 /api/mock/vital latest 배열에 표시할 작업자 값이 없습니다." : "관제 웹 /api/mock/vital latest 배열의 실제 값만 표시합니다.",
                metrics: metrics,
                rows: rows.isEmpty ? [self.noDataRecord("작업자 데이터 없음", detail: "API 응답의 latest 배열이 비어 있습니다.")] : rows,
                source: "\(VitalGuardLinks.safetyMonitor)/api/mock/vital"
            ))
        }
    }

    private func fetchGasSnapshot(completion: @escaping (SafetySignalDetailSnapshot) -> Void) {
        fetchJSONCandidates(["/api/gas", "/api/mock/gas"]) { json in
            var items = self.arrayItems(from: json, keys: ["gas", "gasSensors", "sensors", "items", "data"])
            let source: String
            if items.isEmpty {
                items = self.dashboardGasMirrorItems()
                source = "\(VitalGuardLinks.safetyMonitor)/api/gas 미배포 시 대시보드 표 소스 미러"
            } else {
                source = "\(VitalGuardLinks.safetyMonitor)/api/gas"
            }
            guard !items.isEmpty else {
                completion(self.unavailableSnapshot(source: "\(VitalGuardLinks.safetyMonitor)/api/gas"))
                return
            }
            let rows = items.map { self.gasRecord(from: $0) }
            completion(SafetySignalDetailSnapshot(
                status: .connected,
                summary: "관제 웹 대시보드의 가스 누출 감지기 표와 같은 값을 표시합니다.",
                metrics: [SafetySignalMetric(title: "센서", value: "\(items.count)", unit: "대", tint: self.kind.tint)],
                rows: rows,
                source: source
            ))
        }
    }

    private func fetchAEDSnapshot(completion: @escaping (SafetySignalDetailSnapshot) -> Void) {
        fetchJSONCandidates(["/api/aed", "/api/aed/inspections"]) { json in
            let items = self.arrayItems(from: json, keys: ["aed", "devices", "inspections", "items", "data"])
            let source: String
            let resolvedItems: [[String: Any]]
            if items.isEmpty {
                resolvedItems = self.dashboardAedMirrorItems()
                source = "\(VitalGuardLinks.safetyMonitor)/api/aed 미배포 시 대시보드 표 소스 미러"
            } else {
                resolvedItems = items
                source = "\(VitalGuardLinks.safetyMonitor)/api/aed"
            }
            guard !resolvedItems.isEmpty else {
                completion(self.unavailableSnapshot(source: "\(VitalGuardLinks.safetyMonitor)/api/aed/inspections"))
                return
            }
            let rows = resolvedItems.map { self.aedRecord(from: $0) }
            completion(SafetySignalDetailSnapshot(
                status: .connected,
                summary: "관제 웹 대시보드의 심장 제세동기(AED) 알림 표와 같은 값을 표시합니다.",
                metrics: [SafetySignalMetric(title: "AED", value: "\(resolvedItems.count)", unit: "대", tint: self.kind.tint)],
                rows: rows,
                source: source
            ))
        }
    }

    private func dashboardGasMirrorItems() -> [[String: Any]] {
        [
            ["loc": "지하 1층 펌프실", "gas": "CH4 메탄", "val": "0.3", "unit": "%LEL", "thr": ">=5 %LEL", "sev": "normal", "recv": "5초 전"],
            ["loc": "B2 집수정", "gas": "H2S 황화수소", "val": "8", "unit": "ppm", "thr": ">=10 ppm", "sev": "caution", "recv": "4초 전"],
            ["loc": "탱크 야드", "gas": "CO 일산화탄소", "val": "52", "unit": "ppm", "thr": ">=30 ppm", "sev": "danger", "recv": "6초 전"],
            ["loc": "배관 트렌치", "gas": "O2 산소", "val": "20.9", "unit": "%", "thr": "<18 %", "sev": "normal", "recv": "5초 전"],
            ["loc": "도장 작업장", "gas": "VOC 휘발성유기", "val": "120", "unit": "ppm", "thr": ">=200 ppm", "sev": "caution", "recv": "7초 전"],
            ["loc": "보일러실", "gas": "CH4 메탄", "val": "0.1", "unit": "%LEL", "thr": ">=5 %LEL", "sev": "normal", "recv": "5초 전"],
            ["loc": "폐수 처리조", "gas": "H2S 황화수소", "val": "3", "unit": "ppm", "thr": ">=10 ppm", "sev": "normal", "recv": "5초 전"],
            ["loc": "지하 전기실", "gas": "CO 일산화탄소", "val": "12", "unit": "ppm", "thr": ">=30 ppm", "sev": "normal", "recv": "5초 전"]
        ]
    }

    private func dashboardAedMirrorItems() -> [[String: Any]] {
        [
            ["id": "AED-01", "loc": "본관 1층 로비", "manager": "김안전", "devBatt": 92, "status": "정상", "sev": "normal", "battDue": "~44개월", "padDue": "~20개월", "recent": "김안전 · 120일 전"],
            ["id": "AED-02", "loc": "현장 사무동", "manager": "박보건", "devBatt": 78, "status": "정상", "sev": "normal", "battDue": "~38개월", "padDue": "~14개월", "recent": "박보건 · 300일 전"],
            ["id": "AED-03", "loc": "지하 주차장 B1", "manager": "이현장", "devBatt": 18, "status": "단말 배터리 부족", "sev": "danger", "battDue": "~1개월", "padDue": "경과 10일", "recent": "이현장 · 700일 전"],
            ["id": "AED-04", "loc": "식당동 입구", "manager": "최관리", "devBatt": 62, "status": "정상", "sev": "normal", "battDue": "~42개월", "padDue": "~0개월", "recent": "최관리 · 200일 전"],
            ["id": "AED-05", "loc": "자재 창고", "manager": "정보건", "devBatt": 88, "status": "AED 배터리 교환 임박", "sev": "caution", "battDue": "~1개월", "padDue": "~17개월", "recent": "정보건 · 200일 전"],
            ["id": "AED-06", "loc": "타워크레인 베이스", "manager": "강현장", "devBatt": 81, "status": "정상", "sev": "normal", "battDue": "~43개월", "padDue": "~19개월", "recent": "강현장 · 150일 전"],
            ["id": "AED-07", "loc": "안전교육장", "manager": "윤보건", "devBatt": 45, "status": "단말 배터리 주의", "sev": "caution", "battDue": "~40개월", "padDue": "~16개월", "recent": "윤보건 · 250일 전"],
            ["id": "AED-08", "loc": "스마트인재개발원 601호", "manager": "VitAlGuard-AED-ALERT-01", "devBatt": 100, "status": "정상", "sev": "normal", "battDue": "~48개월", "padDue": "~24개월", "recent": "실장비 등록"]
        ]
    }

    private func fallbackSnapshot(loading: Bool) -> SafetySignalDetailSnapshot {
        let summary = loading ? "관제 웹 대시보드 데이터를 불러오는 중입니다." : "관제 웹 API에서 실제 데이터값을 받지 못했습니다."
        let metrics = [SafetySignalMetric(title: "실제 데이터", value: loading ? "대기" : "없음", unit: "", tint: loading ? UIColor.systemOrange : UIColor.systemRed)]
        let rows = [noDataRecord(loading ? "관제 데이터 수신 중" : "실제 관제 데이터 없음", detail: loading ? "API 응답을 기다리고 있습니다." : "앱이 임의 샘플값을 만들지 않도록 실제 응답값만 표시합니다.")]
        return SafetySignalDetailSnapshot(status: loading ? .delayed : .offline, summary: summary, metrics: metrics, rows: rows, source: VitalGuardLinks.safetyMonitor)
    }

    private func unavailableSnapshot(source: String) -> SafetySignalDetailSnapshot {
        SafetySignalDetailSnapshot(
            status: .offline,
            summary: "관제 웹 API에서 실제 데이터값을 받지 못했습니다.",
            metrics: [SafetySignalMetric(title: "실제 데이터", value: "없음", unit: "", tint: UIColor.systemRed)],
            rows: [noDataRecord("실제 관제 데이터 없음", detail: "HTTP 401/404 또는 빈 응답입니다. 임의 샘플값은 표시하지 않습니다.")],
            source: source
        )
    }

    private func noDataRecord(_ title: String, detail: String) -> SafetySignalRecord {
        SafetySignalRecord(
            title: title,
            subtitle: kind.subtitle,
            value: "--",
            status: "미수신",
            detail: detail,
            tint: UIColor.systemRed
        )
    }

    private func workerRecord(from item: [String: Any], counts: [String: Any]?, profiles: [String: Any]?) -> SafetySignalRecord {
        let workerId = stringValue(from: item, keys: ["workerId", "employeeId"]) ?? "workerId 없음"
        let title = stringValue(from: item, keys: ["workerName", "name"]) ?? workerId
        let employeeId = stringValue(from: item, keys: ["employeeId"]) ?? workerId
        let jobTitle = stringValue(from: item, keys: ["jobTitle"])
            ?? stringValue(from: profiles, key: workerId)
        let heartRate = stringValue(from: item, keys: ["heartRate"])
        let spo2 = stringValue(from: item, keys: ["spo2"])
        let battery = stringValue(from: item, keys: ["batteryPct"])
        let ts = stringValue(from: item, keys: ["ts"])
        let count = stringValue(from: counts, key: workerId)
        let value = heartRate.map { "\($0) bpm" } ?? "--"
        let status = spo2.map { "SpO₂ \($0)%" }
            ?? battery.map { "배터리 \($0)%" }
            ?? "수신"
        let detail = [
            ts.map { "수신 \($0)" },
            battery.map { "batteryPct \($0)" },
            count.map { "DB 누적 \($0)" },
            stringValue(from: item, keys: ["fallDetected"]).map { "fallDetected \($0)" },
            stringValue(from: item, keys: ["fallCandidate"]).map { "fallCandidate \($0)" },
            stringValue(from: item, keys: ["fallRuleIsFall"]).map { "fallRuleIsFall \($0)" },
            stringValue(from: item, keys: ["mlWorkVetoProb"]).map { "mlWorkVetoProb \($0)" },
            stringValue(from: item, keys: ["mlImpactProb"]).map { "mlImpactProb \($0)" },
            stringValue(from: item, keys: ["mlVetoedByML"]).map { "mlVetoedByML \($0)" },
            stringValue(from: item, keys: ["mlRescuedByML"]).map { "mlRescuedByML \($0)" },
            stringValue(from: item, keys: ["mlShouldAlert"]).map { "mlShouldAlert \($0)" }
        ]
            .compactMap { $0 }
            .joined(separator: " · ")
        let subtitle = [employeeId, jobTitle].compactMap { $0 }.joined(separator: " · ")
        return SafetySignalRecord(
            title: title,
            subtitle: subtitle.isEmpty ? workerId : subtitle,
            value: value,
            status: status,
            detail: detail.isEmpty ? "API latest 응답값" : detail,
            tint: kind.tint
        )
    }

    private func gasRecord(from item: [String: Any]) -> SafetySignalRecord {
        let title = stringValue(from: item, keys: ["loc", "location", "zone", "name", "id"]) ?? "가스 센서"
        let gas = stringValue(from: item, keys: ["gas", "gasType", "type"]) ?? "gas"
        let value = [
            stringValue(from: item, keys: ["val", "value", "measurement", "reading"]),
            stringValue(from: item, keys: ["unit"])
        ]
            .compactMap { $0 }
            .joined(separator: " ")
        let status = stringValue(from: item, keys: ["status", "state", "sev"]) ?? "수신"
        let detail = [
            stringValue(from: item, keys: ["thr", "threshold"]).map { "임계 \($0)" },
            stringValue(from: item, keys: ["recv", "receivedAt", "updatedAt", "ts"]).map { "최근수신 \($0)" }
        ]
            .compactMap { $0 }
            .joined(separator: " · ")
        return SafetySignalRecord(title: title, subtitle: gas, value: value.isEmpty ? "--" : value, status: status, detail: detail.isEmpty ? "API 응답값" : detail, tint: kind.tint)
    }

    private func aedRecord(from item: [String: Any]) -> SafetySignalRecord {
        let title = stringValue(from: item, keys: ["loc", "location", "aed_id", "id", "name"]) ?? "AED"
        let inspector = stringValue(from: item, keys: ["inspector", "manager", "checkedBy"]) ?? "inspector 없음"
        let items = stringValue(from: item, keys: ["items", "item"])
        let ts = stringValue(from: item, keys: ["recent", "ts", "checkedAt", "createdAt"])
        let value = stringValue(from: item, keys: ["devBatt", "batteryPct", "battery", "alertBattery"]).map { "\($0)%" } ?? "--"
        let status = stringValue(from: item, keys: ["status", "state", "sev"]) ?? "수신"
        let detail = [
            items.map { "items \($0)" },
            stringValue(from: item, keys: ["battDue"]).map { "AED 배터리 \($0)" },
            stringValue(from: item, keys: ["padDue"]).map { "패드 \($0)" },
            ts.map { "최근 \($0)" }
        ]
            .compactMap { $0 }
            .joined(separator: " · ")
        return SafetySignalRecord(title: title, subtitle: inspector, value: value, status: status, detail: detail.isEmpty ? "API 응답값" : detail, tint: kind.tint)
    }

    private func fetchJSONCandidates(_ paths: [String], completion: @escaping (Any?) -> Void) {
        fetchJSONCandidates(paths.compactMap { URL(string: VitalGuardLinks.safetyMonitor + $0) }, index: 0, completion: completion)
    }

    private func fetchJSONCandidates(_ urls: [URL], index: Int, completion: @escaping (Any?) -> Void) {
        guard urls.indices.contains(index) else {
            completion(nil)
            return
        }
        var request = URLRequest(url: urls[index])
        request.timeoutInterval = 8
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if let data,
               (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0),
               let json = try? JSONSerialization.jsonObject(with: data) {
                completion(json)
            } else {
                self.fetchJSONCandidates(urls, index: index + 1, completion: completion)
            }
        }.resume()
    }

    private func arrayItems(from json: Any?, keys: [String]) -> [[String: Any]] {
        if let array = json as? [[String: Any]] { return array }
        guard let dict = json as? [String: Any] else { return [] }
        for key in keys {
            if let array = dict[key] as? [[String: Any]] { return array }
            if let nested = dict[key] as? [String: Any] {
                let nestedItems = arrayItems(from: nested, keys: keys)
                if !nestedItems.isEmpty { return nestedItems }
            }
        }
        return []
    }

    private func stringValue(from item: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let string = item[key] as? String, !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return string }
            if let number = item[key] as? NSNumber { return "\(number)" }
        }
        return nil
    }

    private func stringValue(from item: [String: Any]?, key: String) -> String? {
        guard let item else { return nil }
        return stringValue(from: item, keys: [key])
    }

    private func numberValue(from item: [String: Any]?, keys: [String]) -> Int? {
        guard let item else { return nil }
        for key in keys {
            if let number = item[key] as? NSNumber { return number.intValue }
            if let string = item[key] as? String, let int = Int(string) { return int }
            if let array = item[key] as? [Any] { return array.count }
        }
        return nil
    }

    private func firstNumber(in items: [[String: Any]], keys: [String]) -> Double? {
        for item in items {
            for key in keys {
                if let number = item[key] as? NSNumber { return number.doubleValue }
                if let string = item[key] as? String, let double = Double(string) { return double }
            }
        }
        return nil
    }

    private func statusText(from item: [String: Any], fallback: String = "") -> String {
        stringValue(from: item, keys: ["status", "state", "level", "summary", "description", "alert", "message"]) ?? fallback
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    private static let dashboardRefreshTaskIdentifier = "com.yangjeehoo.vitalguard.dashboard-refresh"
    private let dashboardBackgroundQueue = OperationQueue()
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        configureNotifications()
        registerDashboardBackgroundRefresh()
        PhoneWatchBridge.shared.activate()
        installRootWindow()
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        PhoneWatchBridge.shared.publishCurrentSession()
        rootPreviewController?.resumeContinuousDashboardSync()
        NotificationCenter.default.post(name: .vitalGuardQuickActionRequested, object: nil)
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        rootPreviewController?.prepareContinuousBackgroundSync()
        scheduleDashboardBackgroundRefresh()
    }

    func application(
        _ application: UIApplication,
        performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        DashboardSyncService.shared.enqueueContinuousUpdate(reason: "iphone_background_fetch") { ok, _ in
            completionHandler(ok ? .newData : .failed)
        }
    }

    private func registerDashboardBackgroundRefresh() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.dashboardRefreshTaskIdentifier,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.handleDashboardBackgroundRefresh(refreshTask)
        }
    }

    private func scheduleDashboardBackgroundRefresh(after delay: TimeInterval = 15 * 60) {
        let request = BGAppRefreshTaskRequest(identifier: Self.dashboardRefreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: delay)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("dashboard background refresh schedule failed: \(error.localizedDescription)")
        }
    }

    private func handleDashboardBackgroundRefresh(_ task: BGAppRefreshTask) {
        scheduleDashboardBackgroundRefresh()
        let operation = DashboardBackgroundRefreshOperation()
        task.expirationHandler = {
            operation.cancel()
        }
        operation.completionBlock = {
            task.setTaskCompleted(success: !operation.isCancelled)
        }
        dashboardBackgroundQueue.addOperation(operation)
    }

    private func installRootWindow() {
        let controller = VitAlGuardPreviewController()
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        window.overrideUserInterfaceStyle = AppDelegate.savedThemeMode.interfaceStyle
        window.makeKeyAndVisible()
        self.window = window
    }

    private var rootPreviewController: VitAlGuardPreviewController? {
        window?.rootViewController as? VitAlGuardPreviewController
    }

    private static var savedThemeMode: PreviewThemeMode {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.themeMode) ?? PreviewThemeMode.system.rawValue
        return PreviewThemeMode(rawValue: raw) ?? .system
    }

    private func configureNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let fallYes = UNNotificationAction(
            identifier: PhoneWatchBridge.fallConfirmActionIdentifier,
            title: "예",
            options: [.foreground]
        )
        let fallNo = UNNotificationAction(
            identifier: PhoneWatchBridge.fallDismissActionIdentifier,
            title: "아니오",
            options: [.foreground]
        )
        let fallCategory = UNNotificationCategory(
            identifier: PhoneWatchBridge.fallConfirmationCategoryIdentifier,
            actions: [fallYes, fallNo],
            intentIdentifiers: [],
            options: []
        )
        center.setNotificationCategories([fallCategory])
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                print("VitAlGuard notification authorization failed: \(error.localizedDescription)")
            }
            UserDefaults.standard.set(granted, forKey: PreviewSettingsKey.notificationPermissionGranted)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        guard notification.request.identifier == PhoneWatchBridge.loginApprovalNotificationId else {
            completionHandler([.banner, .list, .sound])
            return
        }
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.notification.request.identifier == PhoneWatchBridge.loginApprovalNotificationId {
            PhoneWatchBridge.shared.approvePendingLoginRequestFromNotification()
        } else if response.notification.request.content.categoryIdentifier == PhoneWatchBridge.fallConfirmationCategoryIdentifier {
            NotificationCenter.default.post(
                name: .vitalGuardFallResponseRequested,
                object: nil,
                userInfo: [
                    "action": response.actionIdentifier,
                    "candidateId": response.notification.request.content.userInfo["candidateId"] as? String ?? ""
                ]
            )
        }
        completionHandler()
    }
}

private struct PhoneMeasuredVitalSnapshot {
    let values: [String: Any]
    let receivedAt: Date
    private static let wristTemperatureKeys = [
        "wristTemperatureC",
        "skinTempC",
        "skin_temp_c",
        "wrist_temp_c",
        "wrist_temp",
        "wristTemperature",
        "wristTempC",
        "wristTemp",
        "skinTemperatureC",
        "skinTemperature",
        "skin_temp",
        "bodyTempC",
        "bodyTemperatureCelsius",
        "bodyTemperatureC",
        "bodyTemp",
        "body_temp_c",
        "body_temp",
        "bodyTemperature",
        "skinTemp",
        "bodytemperature",
        "watch_wristTemperatureC",
        "watch_skinTempC",
        "watch_skin_temp_c",
        "watch_wristTemperature",
        "watch_wristTempC",
        "watch_bodyTempC"
    ]

    static var current: PhoneMeasuredVitalSnapshot {
        guard let snapshot = VitAlGuardSharedStorage.loadWatchSnapshot() else {
            return PhoneMeasuredVitalSnapshot(values: [:], receivedAt: Date.distantPast)
        }
        return PhoneMeasuredVitalSnapshot(values: snapshot.values, receivedAt: snapshot.receivedAt)
    }

    static func store(_ payload: [String: Any]) -> Bool {
        guard isWatchVitalsPayload(payload) else {
            return false
        }
        return VitAlGuardSharedStorage.saveWatchSnapshot(payload)
    }

    func intValue(_ key: String) -> Int? {
        if let value = values[key] as? Int { return value }
        if let value = values[key] as? Double { return Int(value.rounded()) }
        if let value = values[key] as? String { return Int(value) }
        return nil
    }

    func doubleValue(_ key: String) -> Double? {
        if let value = values[key] as? Double { return value }
        if let value = values[key] as? Int { return Double(value) }
        if let value = values[key] as? String { return Double(value) }
        return nil
    }

    func wristTemperatureValue() -> Double? {
        func parseWristTemperatureString(_ stringValue: String) -> Double? {
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
            guard let parsed = Double(normalized) else { return nil }
            return normalizeWristTemperature(parsed)
        }

        func parseNumericValue(_ value: Any) -> Double? {
            if let value = value as? Double { return normalizeWristTemperature(value) }
            if let value = value as? Int { return normalizeWristTemperature(Double(value)) }
            if let value = value as? Float { return normalizeWristTemperature(Double(value)) }
            if let value = value as? NSNumber { return normalizeWristTemperature(value.doubleValue) }
            return nil
        }

        for key in Self.wristTemperatureKeys {
            if let rawValue = values[key], let value = parseNumericValue(rawValue) {
                return value
            }
            if let stringValue = values[key] as? String {
                if let parsed = parseWristTemperatureString(stringValue) {
                    return parsed
                }
            }
        }
        return nil
    }

    private func normalizeWristTemperature(_ value: Double) -> Double? {
        let roundedToOneDecimal = (value * 10).rounded() / 10
        if (84...120).contains(roundedToOneDecimal) {
            return ((roundedToOneDecimal - 32) * 5 / 9 * 10).rounded() / 10
        }
        if (20...45).contains(roundedToOneDecimal) {
            return roundedToOneDecimal
        }
        if (0...90).contains(roundedToOneDecimal) {
            return nil
        }
        return nil
    }

    func stringValue(_ key: String) -> String? {
        guard let value = values[key] as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value != "--" else {
            return nil
        }
        return value
    }

    func formattedInt(_ key: String, unit: String) -> (value: String, unit: String) {
        guard let value = intValue(key) else { return ("--", "") }
        return ("\(value)", unit)
    }

    func formattedDouble(_ key: String, unit: String, digits: Int = 1) -> (value: String, unit: String) {
        guard let value = doubleValue(key) else { return ("--", "") }
        return (String(format: "%.\(digits)f", value), unit)
    }

    func formattedWristTemperature(unit: String, digits: Int = 1) -> (value: String, unit: String) {
        guard let value = wristTemperatureValue() else { return ("--", "") }
        return (String(format: "%.\(digits)f", value), unit)
    }
}

private let acceptedWatchSources: Set<String> = [
    "VitAlGuard-WatchVitals",
    "VitAlGuard-Watch-background",
    "VitAlGuard-Watch"
]

private func isWatchVitalsPayload(_ payload: [String: Any]) -> Bool {
    guard payload["source"] != nil else { return false }
    if let source = payload["source"] as? String, acceptedWatchSources.contains(source) {
        return true
    }

        let hasWatchPayloadSignal = payload["heartRate"] != nil
            || payload["spo2"] != nil
            || payload["steps"] != nil
            || payload["wristTemperatureC"] != nil
            || payload["wristTemperature"] != nil
            || payload["wrist_temp_c"] != nil
            || payload["wrist_temp"] != nil
            || payload["wristTempC"] != nil
            || payload["wristTemp"] != nil
            || payload["skinTempC"] != nil
            || payload["skin_temp_c"] != nil
            || payload["skinTemperatureC"] != nil
            || payload["skinTemperature"] != nil
            || payload["skin_temp"] != nil
            || payload["skinTemp"] != nil
            || payload["bodyTempC"] != nil
            || payload["bodyTemp"] != nil
            || payload["body_temp_c"] != nil
            || payload["body_temp"] != nil
            || payload["bodyTemperatureCelsius"] != nil
            || payload["bodyTemperatureC"] != nil
            || payload["bodyTemperature"] != nil
            || payload["bodytemperature"] != nil
            || payload["hrvSdnnMs"] != nil
            || payload["respiratoryRate"] != nil
            || payload["activeEnergyKcal"] != nil
            || payload["exerciseTimeMinutes"] != nil
            || payload["standTimeMinutes"] != nil
            || payload["moveTimeMinutes"] != nil
            || payload["relativeAltitudeMeters"] != nil
            || payload["barometricPressureKPa"] != nil
            || payload["accelerationMagnitudeG"] != nil
            || payload["rotationRateRadS"] != nil
            || payload["sleepingBreathingDisturbances"] != nil
            || payload["sleepingBreathingDisturbancesClassification"] != nil
            || payload["sleepApneaRisk"] != nil

    return hasWatchPayloadSignal && payload["request"] == nil
}

final class PhoneWatchBridge: NSObject, WCSessionDelegate {
    static let shared = PhoneWatchBridge()
    static let loginApprovalNotificationId = "vitalguard.watch.login.approval"
    static let fallConfirmationCategoryIdentifier = "vitalguard.fall.confirmation"
    static let fallConfirmActionIdentifier = "vitalguard.fall.confirm"
    static let fallDismissActionIdentifier = "vitalguard.fall.dismiss"
    static let didApproveWatchLoginNotification = Notification.Name("VitAlGuardDidApproveWatchLogin")
    static let didReceiveWatchVitalsNotification = Notification.Name("VitAlGuardDidReceiveWatchVitals")
    static let didRequestWatchNFCScanNotification = Notification.Name("VitAlGuardDidRequestWatchNFCScan")
    private var activated = false
    private var lastVitalsRefreshAt: Date?
    private let vitalsRefreshThrottle: TimeInterval = 30

    func activate() {
        guard WCSession.isSupported(), !activated else { return }
        activated = true
        WCSession.default.delegate = self
        WCSession.default.activate()
        publishStoredWatchVitalsIfAvailable()
    }

    func publishCurrentSession() {
        activate()
        let defaults = UserDefaults.standard
        let id = defaults.string(forKey: PreviewSettingsKey.loggedInId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let rawMode = VitAlGuardSharedStorage.loadAppMode()?.rawValue
            ?? defaults.string(forKey: PreviewSettingsKey.appMode)
            ?? AppMode.worker.rawValue
        let sync = defaults.object(forKey: PreviewSettingsKey.syncInterval) as? Double ?? 10
        guard !id.isEmpty else {
            publishSignedOut(syncInterval: sync)
            return
        }
        publish(loginId: id, mode: AppMode(rawValue: rawMode) ?? .worker, syncInterval: sync)
    }

    private func currentContext() -> [String: Any] {
        let defaults = UserDefaults.standard
        let id = defaults.string(forKey: PreviewSettingsKey.loggedInId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let rawMode = VitAlGuardSharedStorage.loadAppMode()?.rawValue
            ?? defaults.string(forKey: PreviewSettingsKey.appMode)
            ?? AppMode.worker.rawValue
        let mode = AppMode(rawValue: rawMode) ?? .worker
        let serverRole = normalizedAppServerRole(
            defaults.string(forKey: PreviewSettingsKey.appServerRole),
            fallbackMode: mode
        )
        let sync = defaults.object(forKey: PreviewSettingsKey.syncInterval) as? Double ?? 10
        guard !id.isEmpty else {
            return signedOutContext(syncInterval: sync)
        }
        let resolvedId = id
        let storedEmployeeId = defaults.string(forKey: PreviewSettingsKey.employeeId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var context: [String: Any] = [
            "source": "VitAlGuard-iPhone",
            "loggedIn": true,
            "loginId": resolvedId,
            "employeeId": storedEmployeeId.isEmpty ? vitalGuardEmployeeIdentifier(for: resolvedId) : storedEmployeeId,
            "mode": mode.rawValue,
            "serverRole": serverRole,
            "serverRoleTitle": appServerRoleTitle(serverRole),
            "canManageDashboard": appServerRoleCanManageDashboard(serverRole),
            "canUploadOwnMedia": true,
            "dashboardReadContractVersion": "2026-07-05",
            "syncIntervalSeconds": min(3599, max(5, sync.rounded())),
            "sensorPowerMode": SensorPowerMode.saved.rawValue,
            "languageCode": AppLanguage.savedLanguageCode,
            "endpointURL": VitalGuardLinks.appAPI,
            "dashboardURL": VitalGuardLinks.safetyMonitor
        ]
        appendWalletIdentity(to: &context, mode: mode)
        return context
    }

    private func signedOutContext(syncInterval: Double) -> [String: Any] {
        [
            "source": "VitAlGuard-iPhone",
            "loggedIn": false,
            "loginId": "",
            "employeeId": "",
            "mode": AppMode.worker.rawValue,
            "serverRole": "worker",
            "serverRoleTitle": appServerRoleTitle("worker"),
            "canManageDashboard": false,
            "canUploadOwnMedia": true,
            "dashboardReadContractVersion": "2026-07-05",
            "syncIntervalSeconds": min(3599, max(5, syncInterval.rounded())),
            "sensorPowerMode": SensorPowerMode.saved.rawValue,
            "languageCode": AppLanguage.savedLanguageCode,
            "endpointURL": VitalGuardLinks.appAPI,
            "dashboardURL": VitalGuardLinks.safetyMonitor
        ]
    }

    func publish(loginId: String, mode: AppMode, syncInterval: Double) {
        guard WCSession.isSupported() else { return }
        let storedEmployeeId = UserDefaults.standard.string(forKey: PreviewSettingsKey.employeeId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let resolvedId = loginId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? (mode == .admin ? "admin7276" : "worker7276")
            : loginId.trimmingCharacters(in: .whitespacesAndNewlines)
        let serverRole = normalizedAppServerRole(
            UserDefaults.standard.string(forKey: PreviewSettingsKey.appServerRole),
            fallbackMode: mode
        )
        var context: [String: Any] = [
            "source": "VitAlGuard-iPhone",
            "loggedIn": true,
            "loginId": resolvedId,
            "employeeId": storedEmployeeId.isEmpty ? vitalGuardEmployeeIdentifier(for: resolvedId) : storedEmployeeId,
            "mode": mode.rawValue,
            "serverRole": serverRole,
            "serverRoleTitle": appServerRoleTitle(serverRole),
            "canManageDashboard": appServerRoleCanManageDashboard(serverRole),
            "canUploadOwnMedia": true,
            "dashboardReadContractVersion": "2026-07-05",
            "syncIntervalSeconds": min(3599, max(5, syncInterval.rounded())),
            "sensorPowerMode": SensorPowerMode.saved.rawValue,
            "languageCode": AppLanguage.savedLanguageCode,
            "endpointURL": VitalGuardLinks.appAPI,
            "dashboardURL": VitalGuardLinks.safetyMonitor
        ]
        appendWalletIdentity(to: &context, mode: mode)
        do {
            try WCSession.default.updateApplicationContext(context)
        } catch {
            WCSession.default.transferUserInfo(context)
        }

        sendSessionMessage(context)
    }

    func publishSignedOut(syncInterval: Double) {
        guard WCSession.isSupported() else { return }
        let context: [String: Any] = [
            "source": "VitAlGuard-iPhone",
            "loggedIn": false,
            "loginId": "",
            "employeeId": "",
            "mode": AppMode.worker.rawValue,
            "serverRole": "worker",
            "serverRoleTitle": appServerRoleTitle("worker"),
            "canManageDashboard": false,
            "canUploadOwnMedia": true,
            "dashboardReadContractVersion": "2026-07-05",
            "syncIntervalSeconds": min(3599, max(5, syncInterval.rounded())),
            "sensorPowerMode": SensorPowerMode.saved.rawValue,
            "languageCode": AppLanguage.savedLanguageCode,
            "endpointURL": VitalGuardLinks.appAPI,
            "dashboardURL": VitalGuardLinks.safetyMonitor
        ]
        do {
            try WCSession.default.updateApplicationContext(context)
        } catch {
            WCSession.default.transferUserInfo(context)
        }
        sendSessionMessage(context, reason: "logout")
    }

    func sendSessionMessage(
        _ context: [String: Any] = [:],
        reason: String = "manual",
        request: String = "watchSessionSync"
    ) {
        guard WCSession.isSupported() else { return }
        activate()
        guard !context.isEmpty else { return }
        var payload = context
        payload["request"] = request
        payload["requestReason"] = reason
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(payload, replyHandler: { reply in
                if let status = reply["status"] as? String {
                    print("VitAlGuard watch sync reply: \(status)")
                }
            }, errorHandler: { error in
                print("VitAlGuard watch sync sendMessage failed: \(error.localizedDescription)")
                WCSession.default.transferUserInfo(payload)
            })
        } else {
            WCSession.default.transferUserInfo(payload)
        }
    }

    private func appendWalletIdentity(to context: inout [String: Any], mode: AppMode) {
        let payload = WalletIdentityPayload.load(role: mode)
        guard payload.hasEmployeeIdentity else { return }
        context["walletIdentity"] = payload.dictionary
        context["walletIdentityEncoded"] = payload.encodedString
        context["walletBarcodeValue"] = payload.barcodeString
        if let qrData = WalletIdentityViewController.makeQRCode(from: payload.encodedString)?.pngData() {
            context["walletQRPNGData"] = qrData
        }
        if let barcodeData = WalletIdentityViewController.makeCode128(from: payload.barcodeString)?.pngData() {
            context["walletBarcodePNGData"] = barcodeData
        }
        VitAlGuardSharedStorage.saveWalletIdentity(
            payload.dictionary,
            qrPNGData: context["walletQRPNGData"] as? Data,
            barcodePNGData: context["walletBarcodePNGData"] as? Data
        )
    }

    func requestLoginApprovalFromWatch() {
        UserDefaults.standard.set(true, forKey: PreviewSettingsKey.pendingWatchLoginApproval)
        scheduleLoginApprovalNotification()
    }

    func requestWatchManualSync(reason: String = "manual") {
        let context = currentContext()
        sendSessionMessage(context, reason: reason, request: "watchManualSync")
        publishStoredWatchVitalsIfAvailable()
    }

    private func publishStoredWatchVitalsIfAvailable() {
        guard let snapshot = VitAlGuardSharedStorage.loadWatchSnapshot() else { return }
        guard shouldRefreshVitalsUI() else { return }
        DispatchQueue.main.async {
            WidgetCenter.shared.reloadAllTimelines()
            NotificationCenter.default.post(name: Self.didReceiveWatchVitalsNotification, object: nil, userInfo: snapshot.values)
        }
    }

    func sendFallClear(candidateId: String, reason: String = "iphone_user_dismissed") {
        var payload = currentContext()
        payload["candidateId"] = candidateId
        payload["fallCandidateId"] = candidateId
        payload["fallPromptOutcome"] = "dismissed"
        payload["fallClearReason"] = reason
        sendSessionMessage(payload, reason: reason, request: "fallAlertClear")
    }

    func approvePendingLoginRequestFromNotification() {
        UserDefaults.standard.set(false, forKey: PreviewSettingsKey.pendingWatchLoginApproval)
        publishCurrentSession()
        NotificationCenter.default.post(name: Self.didApproveWatchLoginNotification, object: nil)
    }

    private func scheduleLoginApprovalNotification() {
        let content = UNMutableNotificationContent()
        content.title = "VitAlGuard"
        content.body = "AppleWatch용 앱이 로그인 정보를 요청했습니다. 로그인 허용하시겠습니까?"
        content.sound = .default
        content.userInfo = ["request": "watchLoginApproval"]

        let request = UNNotificationRequest(
            identifier: Self.loginApprovalNotificationId,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 0.5, repeats: false)
        )
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.loginApprovalNotificationId])
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                print("VitAlGuard login approval notification failed: \(error.localizedDescription)")
            }
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated {
            publishCurrentSession()
            publishStoredWatchVitalsIfAvailable()
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if message["request"] as? String == "loginApproval" {
            DispatchQueue.main.async { [weak self] in
                self?.requestLoginApprovalFromWatch()
            }
            replyHandler(["status": "approvalRequested"])
        } else if message["request"] as? String == "loginContext" {
            replyHandler(currentContext())
            publishCurrentSession()
        } else if message["request"] as? String == "watchNfcScan" {
            let requestId = message["requestId"] as? String ?? UUID().uuidString
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: Self.didRequestWatchNFCScanNotification,
                    object: nil,
                    userInfo: ["requestId": requestId]
                )
            }
            replyHandler(["status": "watchNfcScanAccepted", "requestId": requestId])
        } else if isWatchVitalsPayload(message) {
            applyWatchVitals(message)
            replyHandler(["status": "vitalsAccepted"])
        } else {
            replyHandler([:])
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if message["request"] as? String == "watchNfcScan" {
            let requestId = message["requestId"] as? String ?? UUID().uuidString
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: Self.didRequestWatchNFCScanNotification,
                    object: nil,
                    userInfo: ["requestId": requestId]
                )
            }
        } else if isWatchVitalsPayload(message) {
            applyWatchVitals(message)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if isWatchVitalsPayload(applicationContext) {
            applyWatchVitals(applicationContext)
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        if userInfo["request"] as? String == "loginApproval" {
            DispatchQueue.main.async { [weak self] in
                self?.requestLoginApprovalFromWatch()
            }
        } else if userInfo["request"] as? String == "watchNfcScan" {
            let requestId = userInfo["requestId"] as? String ?? UUID().uuidString
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: Self.didRequestWatchNFCScanNotification,
                    object: nil,
                    userInfo: ["requestId": requestId]
                )
            }
        } else if isWatchVitalsPayload(userInfo) {
            applyWatchVitals(userInfo)
        }
    }

    func sendWatchNFCScanResult(status: String, message: String, tagText: String? = nil, url: String? = nil, requestId: String? = nil) {
        var payload: [String: Any] = [
            "source": "VitAlGuard-iPhone",
            "request": "watchNfcScanResult",
            "status": status,
            "message": message,
            "requestId": requestId ?? ""
        ]
        if let tagText, !tagText.isEmpty {
            payload["tagText"] = tagText
        }
        if let url, !url.isEmpty {
            payload["url"] = url
        }
        sendSessionMessage(payload, reason: "nfc_scan_result", request: "watchNfcScanResult")
    }

    private func applyWatchVitals(_ payload: [String: Any]) {
        guard PhoneMeasuredVitalSnapshot.store(payload) else { return }
        DispatchQueue.main.async {
            if let updatedString = payload["updatedAt"] as? String,
               let updatedAt = ISO8601DateFormatter().date(from: updatedString) {
                UserDefaults.standard.set(updatedAt, forKey: PreviewSettingsKey.lastWatchSync)
            } else {
                UserDefaults.standard.set(Date(), forKey: PreviewSettingsKey.lastWatchSync)
            }
            if self.shouldRefreshVitalsUI() {
                WidgetCenter.shared.reloadAllTimelines()
            }
            NotificationCenter.default.post(name: Self.didReceiveWatchVitalsNotification, object: nil)
        }
    }

    private func shouldRefreshVitalsUI(now: Date = Date()) -> Bool {
        if let lastVitalsRefreshAt, now.timeIntervalSince(lastVitalsRefreshAt) < vitalsRefreshThrottle {
            return false
        }
        lastVitalsRefreshAt = now
        return true
    }
}

final class DashboardSyncService: NSObject {
    static let shared = DashboardSyncService()
    typealias Completion = (Bool, String) -> Void

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var completions: [Int: Completion] = [:]
    private var uploadFiles: [Int: URL] = [:]
    private var responseCodes: [Int: Int] = [:]
    private var lastContinuousUploadAt: Date?
    // 앱이 전면에 있거나 Watch 측정값을 받고 있을 때는 대시보드 수신 지연을 5초 이내로 제한한다.
    private let minimumContinuousUploadInterval: TimeInterval = 5
    private lazy var backgroundSession: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "com.yangjeehoo.vitalguard.dashboard-sync")
        // 관제 heartbeat는 일괄 전송 작업이 아니라 안전 상태 갱신이므로 시스템의 임의 지연을 허용하지 않는다.
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.waitsForConnectivity = true
        config.allowsConstrainedNetworkAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private override init() {
        super.init()
    }

    func normalizedEndpoint(from raw: String?) -> String {
        VitAlGuardDashboardShared.normalizedEndpoint(from: raw)
    }

    func checkReceiverConnection(reason: String, completion: Completion? = nil) {
        let endpointString = normalizedEndpoint(from: UserDefaults.standard.string(forKey: PreviewSettingsKey.endpoint))
        guard let endpoint = URL(string: endpointString) else {
            completion?(false, "대시보드 URL 형식이 올바르지 않습니다.")
            return
        }

        let payload = connectionCheckPayload(reason: reason)
        guard JSONSerialization.isValidJSONObject(payload),
              let body = try? JSONSerialization.data(withJSONObject: payload) else {
            completion?(false, "대시보드 전송 데이터를 만들 수 없습니다.")
            return
        }

        beginBackgroundAllowance()
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 20

        // 화면이 떠 있는 동안에는 background URLSession 대신 일반 세션으로 바로 전송한다.
        // background URLSession은 신뢰성은 높지만 watch↔phone↔dashboard 최초 연결을 늦출 수 있다.
        if UIApplication.shared.applicationState == .active {
            URLSession.shared.uploadTask(with: request, from: body) { _, response, error in
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                self.completeUpload(error: error, statusCode: code, completion: completion)
            }.resume()
            return
        }

        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("vitalguard-dashboard-\(UUID().uuidString).json")
        do {
            try body.write(to: fileURL, options: .atomic)
        } catch {
            endBackgroundAllowance()
            completion?(false, "대시보드 전송 파일을 만들 수 없습니다: \(error.localizedDescription)")
            return
        }

        let task = backgroundSession.uploadTask(with: request, fromFile: fileURL)
        completions[task.taskIdentifier] = completion
        uploadFiles[task.taskIdentifier] = fileURL
        task.resume()
    }

    private func completeUpload(error: Error?, statusCode: Int, completion: Completion?) {
        endBackgroundAllowance()
        let ok = error == nil && (200..<300).contains(statusCode)
        if ok {
            UserDefaults.standard.set(Date(), forKey: PreviewSettingsKey.lastDashboardSync)
        }

        let message: String
        if let error {
            message = "대시보드 연결 확인 실패: \(error.localizedDescription)"
        } else if ok {
            message = "대시보드 연결 확인 완료. 실제 저장 데이터는 Apple Watch 실측값만 사용합니다."
        } else {
            message = "대시보드 연결 확인 실패: HTTP \(statusCode)"
        }

        DispatchQueue.main.async {
            completion?(ok, message)
        }
    }

    func enqueueContinuousUpdate(reason: String = "iphone_background_continuous_update", completion: Completion? = nil) {
        let now = Date()
        if reason.contains("continuous"),
           let lastContinuousUploadAt,
           now.timeIntervalSince(lastContinuousUploadAt) < minimumContinuousUploadInterval {
            completion?(true, "최근 대시보드 동기화가 있어 이번 자동 전송은 생략했습니다.")
            return
        }
        if reason.contains("continuous") {
            lastContinuousUploadAt = now
        }
        checkReceiverConnection(reason: reason, completion: completion)
    }

    func triggerAedAlert(aedId: String, completion: Completion? = nil) {
        guard let url = URL(string: "\(VitalGuardLinks.safetyMonitor)/api/alerts") else {
            completion?(false, "AED Alert API 주소를 만들 수 없습니다.")
            return
        }
        let defaults = UserDefaults.standard
        let workerName = defaults.string(forKey: PreviewSettingsKey.workerName)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let actor = workerName.isEmpty ? "iPhone 앱" : workerName
        let payload: [String: Any] = [
            "type": "aed",
            "aedId": aedId,
            "workerId": aedId,
            "workerName": "AED Alert · \(aedId)",
            "source": "VitAlGuard-iPhone",
            "requestedBy": actor,
            "ts": ISO8601DateFormatter().string(from: Date())
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let body = try? JSONSerialization.data(withJSONObject: payload) else {
            completion?(false, "AED Alert 전송 데이터를 만들 수 없습니다.")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        URLSession.shared.dataTask(with: request) { _, response, error in
            if let error {
                completion?(false, error.localizedDescription)
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(code) {
                completion?(true, "\(aedId) AED Alert를 등록했습니다. 장치는 /api/aed/alarm 폴링으로 DANGER 신호를 받습니다.")
            } else if code == 404 || code == 405 {
                self.triggerAedAlertCompatibilityMode(aedId: aedId, requestedBy: actor, completion: completion)
            } else {
                completion?(false, "서버 응답 코드 \(code)")
            }
        }.resume()
    }

    private func triggerAedAlertCompatibilityMode(aedId: String, requestedBy: String, completion: Completion? = nil) {
        guard let url = URL(string: VitAlGuardDashboardShared.appAPI) else {
            completion?(false, "AED Alert 호환 API 주소를 만들 수 없습니다.")
            return
        }
        let payload: [String: Any] = [
            "workerId": aedId,
            "employeeId": aedId,
            "workerName": "AED Alert · \(aedId)",
            "jobTitle": "AED Alert",
            "manualSos": true,
            "source": "VitAlGuard-iPhone-AED-Compatibility",
            "syncReason": "aed_alert",
            "eventType": "aed",
            "actionLabel": "AED Alert",
            "actorName": requestedBy,
            "ts": ISO8601DateFormatter().string(from: Date())
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let body = try? JSONSerialization.data(withJSONObject: payload) else {
            completion?(false, "AED Alert 호환 전송 데이터를 만들 수 없습니다.")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        URLSession.shared.dataTask(with: request) { _, response, error in
            if let error {
                completion?(false, error.localizedDescription)
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(code) {
                completion?(true, "\(aedId) AED Alert를 관제 웹 호환 경로로 전송했습니다. 웹 배포본 갱신 전까지 SOS 알림 경로로 사이렌을 울립니다.")
            } else {
                completion?(false, "호환 API 응답 코드 \(code)")
            }
        }.resume()
    }

    private func connectionCheckPayload(reason: String) -> [String: Any] {
        let defaults = UserDefaults.standard
        let loginId = defaults.string(forKey: PreviewSettingsKey.loggedInId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let rawMode = VitAlGuardSharedStorage.loadAppMode()?.rawValue
            ?? defaults.string(forKey: PreviewSettingsKey.appMode)
            ?? AppMode.worker.rawValue
        let mode = AppMode(rawValue: rawMode) ?? .worker
        let employeeId = defaults.string(forKey: PreviewSettingsKey.employeeId)?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? vitalGuardEmployeeIdentifier(for: loginId)
        var payload = VitAlGuardDashboardShared.payload(
            loginId: loginId,
            employeeId: employeeId.isEmpty ? vitalGuardEmployeeIdentifier(for: loginId) : employeeId,
            workerName: defaults.string(forKey: PreviewSettingsKey.workerName)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            mode: mode,
            reason: reason
        )
        let actorName = defaults.string(forKey: PreviewSettingsKey.workerName)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let resolvedLogin = loginId.isEmpty ? (mode == .admin ? "admin7276" : "worker7276") : loginId
        let resolvedEmployee = employeeId.isEmpty ? vitalGuardEmployeeIdentifier(for: resolvedLogin) : employeeId
        payload["eventType"] = dashboardEventType(for: reason)
        payload["actionLabel"] = dashboardActionLabel(for: reason)
        payload["actorName"] = actorName.isEmpty ? "양지후" : actorName
        payload["loginId"] = resolvedLogin
        payload["employeeId"] = resolvedEmployee
        payload["actorDisplayText"] = "\((actorName.isEmpty ? "양지후" : actorName)), \(resolvedLogin), \(resolvedEmployee)"
        if defaults.object(forKey: PreviewSettingsKey.lastLocationLatitude) != nil,
           defaults.object(forKey: PreviewSettingsKey.lastLocationLongitude) != nil {
            payload["latitude"] = defaults.double(forKey: PreviewSettingsKey.lastLocationLatitude)
            payload["longitude"] = defaults.double(forKey: PreviewSettingsKey.lastLocationLongitude)
            payload["locationAccuracyMeters"] = defaults.double(forKey: PreviewSettingsKey.lastLocationAccuracy)
            if let timestamp = defaults.object(forKey: PreviewSettingsKey.lastLocationTimestamp) as? Date {
                payload["locationTimestamp"] = ISO8601DateFormatter().string(from: timestamp)
            }
        }
        if let watch = VitAlGuardSharedStorage.loadWatchSnapshot() {
            let values = watch.values
            payload["watchReceivedAt"] = ISO8601DateFormatter().string(from: watch.receivedAt)
            payload["watchLinked"] = true
            for key in [
                "heartRate",
                "spo2",
                "ecgStatus",
                "steps",
                "wristTemperatureC",
                "skinTempC",
                "skin_temp_c",
                "wrist_temp_c",
                "wrist_temp",
                "bodyTempC",
                "bodyTemperatureCelsius",
                "bodyTemperatureC",
                "body_temp_c",
                "body_temp",
                "bodytemperature",
                "bodyTemperature",
                "bloodPressureSystolic",
                "bloodPressureDiastolic",
                "hrvSdnnMs",
                "respiratoryRate",
                "activeEnergyKcal",
                "exerciseTimeMinutes",
                "standTimeMinutes",
                "moveTimeMinutes",
                "relativeAltitudeMeters",
                "barometricPressureKPa",
                "accelerationMagnitudeG",
                "rotationRateRadS",
                "sleepingBreathingDisturbances",
                "sleepingBreathingDisturbancesClassification",
                "sleepApneaRisk",
                "latitude",
                "longitude",
                "locationAccuracyMeters"
            ] {
                if let value = values[key] {
                    payload["watch_\(key)"] = value
                }
            }
            let wristSnapshot = PhoneMeasuredVitalSnapshot(values: values, receivedAt: watch.receivedAt)
            if let wristTemperature = wristSnapshot.wristTemperatureValue() {
                payload["skinTempC"] = wristTemperature
                payload["skin_temp_c"] = wristTemperature
                payload["wristTemperatureC"] = wristTemperature
            }
        } else {
            payload["watchLinked"] = false
        }
        return payload
    }

    private func dashboardEventType(for reason: String) -> String {
        switch reason {
        case "sos", "action_button_sos": return "sos"
        case "manager_call", "action_button_manager_call": return "manager_call"
        case "location_share", "action_button_location_share": return "location_share"
        default: return reason
        }
    }

    private func dashboardActionLabel(for reason: String) -> String {
        switch dashboardEventType(for: reason) {
        case "sos": return "SOS"
        case "manager_call": return "관리자 호출"
        case "location_share": return "위치 공유"
        default: return "VitAlGuard 동기화"
        }
    }

    private func beginBackgroundAllowance() {
        endBackgroundAllowance()
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "VitAlGuardDashboardUpload") { [weak self] in
            self?.endBackgroundAllowance()
        }
    }

    private func endBackgroundAllowance() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}

private final class DashboardBackgroundRefreshOperation: Operation {
    override func main() {
        if isCancelled { return }
        let semaphore = DispatchSemaphore(value: 0)
        DashboardSyncService.shared.enqueueContinuousUpdate(reason: "iphone_bg_task_refresh") { _, _ in
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 25)
    }
}

extension DashboardSyncService: URLSessionTaskDelegate, URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        responseCodes[dataTask.taskIdentifier] = (response as? HTTPURLResponse)?.statusCode ?? 0
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let taskID = task.taskIdentifier
        let completion = completions.removeValue(forKey: taskID)
        let fileURL = uploadFiles.removeValue(forKey: taskID)
        let code = responseCodes.removeValue(forKey: taskID) ?? (task.response as? HTTPURLResponse)?.statusCode ?? 0

        if let fileURL {
            try? FileManager.default.removeItem(at: fileURL)
        }
        completeUpload(error: error, statusCode: code, completion: completion)
    }
}

private enum PreviewSettingsKey {
    static let workerName = "preview.workerName"
    static let employeeId = "preview.employeeId"
    static let walletPersonName = "preview.wallet.personName"
    static let walletEmployeeId = "preview.wallet.employeeId"
    static let walletPhone = "preview.wallet.phone"
    static let walletDepartment = "preview.wallet.department"
    static let walletRank = "preview.wallet.rank"
    static let walletJobTitle = "preview.wallet.jobTitle"
    static let walletWorkZone = "preview.wallet.workZone"
    static let walletSiteName = "preview.wallet.siteName"
    static let walletHireDate = "preview.wallet.hireDate"
    static let walletExpiryDate = "preview.wallet.expiryDate"
    static let endpoint = "preview.endpoint"
    static let dashboardAdminId = "preview.dashboardAdminId"
    static let autoCollection = "preview.autoCollection"
    static let lastDashboardSync = "preview.lastDashboardSync"
    static let lastLocationLatitude = "preview.location.latitude"
    static let lastLocationLongitude = "preview.location.longitude"
    static let lastLocationAccuracy = "preview.location.accuracy"
    static let lastLocationTimestamp = "preview.location.timestamp"
    static let appMode = "preview.appMode"
    static let themeMode = "preview.themeMode"
    static let introGuideMode = "preview.introGuideMode"
    static let cctvVideoEnabled = "preview.cctvVideoEnabled"
    static let cctvSortMode = "preview.cctvSortMode"
    static let cctvCustomOrder = "preview.cctvCustomOrder"
    static let liveActivityEnabled = "preview.liveActivityEnabled"
    static let dashboardTyphoonLiveContentEnabled = "preview.dashboardTyphoonLiveContentEnabled"
    static let dashboardSpecialVideoLiveContentEnabled = "preview.dashboardSpecialVideoLiveContentEnabled"
    static let languageCode = "preview.languageCode"
    static let loggedInId = "preview.loggedInId"
    static let appServerRole = "preview.appServerRole"
    static let forceSignedOut = "preview.forceSignedOut"
    static let syncInterval = "preview.watchSyncIntervalSeconds"
    static let realTimeSyncMigration = "preview.realTimeSyncMigration.v1"
    static let energyEfficiencyMigration = "preview.energyEfficiencyMigration.v1"
    static let lastWatchSync = "preview.lastWatchSync"
    static let watchSnapshot = "preview.watchSnapshot"
    static let pendingWatchLoginApproval = "preview.pendingWatchLoginApproval"
    static let notificationPermissionGranted = "preview.notificationPermissionGranted"
    static let localAlerts = "preview.localAlerts"
    static let lastWatchAnomalyAlert = "preview.lastWatchAnomalyAlert"
    static let lastFallConfirmationCandidateId = "preview.lastFallConfirmationCandidateId"
    static let activeFallConfirmationCandidateId = "preview.activeFallConfirmationCandidateId"
    static let sensorPowerMode = "preview.watchSensorPowerMode"
    static let adminHomeLayout = "preview.adminHomeLayout"
    static let workerHomeLayout = "preview.workerHomeLayout"
    static let adminHomeLayoutVersion = "preview.adminHomeLayoutVersion"
    static let watermarkShowDate = "preview.watermark.showDate"
    static let watermarkShowAddress = "preview.watermark.showAddress"
    static let watermarkShowCoordinate = "preview.watermark.showCoordinate"
    static let watermarkShowDevice = "preview.watermark.showDevice"
    static let watermarkTextColor = "preview.watermark.textColor"
    static let watermarkTextColorCustom = "preview.watermark.textColorCustom"
    static let watermarkFontScale = "preview.watermark.fontScale"
    static let watermarkBackgroundColor = "preview.watermark.backgroundColor"
    static let watermarkBackgroundAlpha = "preview.watermark.backgroundAlpha"
    static let watermarkPosition = "preview.watermark.position"
}

private func normalizedAppServerRole(_ rawRole: String?, fallbackMode: AppMode) -> String {
    let role = rawRole?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() ?? ""
    switch role {
    case "owner", "admin", "worker":
        return role
    default:
        return fallbackMode == .admin ? "admin" : "worker"
    }
}

private func appServerRoleCanManageDashboard(_ role: String? = nil) -> Bool {
    let storedRole = role
        ?? UserDefaults.standard.string(forKey: PreviewSettingsKey.appServerRole)
        ?? UserDefaults.standard.string(forKey: PreviewSettingsKey.appMode)
        ?? AppMode.worker.rawValue
    let normalized = storedRole.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return normalized == "owner" || normalized == "admin"
}

private func appServerRoleTitle(_ role: String? = nil) -> String {
    let storedRole = role
        ?? UserDefaults.standard.string(forKey: PreviewSettingsKey.appServerRole)
        ?? UserDefaults.standard.string(forKey: PreviewSettingsKey.appMode)
        ?? AppMode.worker.rawValue
    switch storedRole.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "owner":
        return "소유자"
    case "admin":
        return "관리자"
    default:
        return "근로자"
    }
}

private func appServerPermissionSummary(_ role: String? = nil) -> String {
    appServerRoleCanManageDashboard(role)
        ? "관리 권한: 현장정보 저장, 캘린더 수정/삭제 가능"
        : "근로자 권한: 조회, 본인 파일 업로드 전용"
}

private enum SensorPowerMode: String, CaseIterable {
    case extreme
    case balanced
    case lowPower

    var title: String {
        switch self {
        case .extreme: return "익스트림"
        case .balanced: return "균형"
        case .lowPower: return "저전력"
        }
    }

    var detail: String {
        switch self {
        case .extreme:
            return "실시간 관제 우선: iPhone과 웹 대시보드로 짧은 주기로 전송합니다."
        case .balanced:
            return "배터리와 관제 균형: 모든 센서를 유지하되 HealthKit 동기화 방식으로 전송 횟수를 줄입니다."
        case .lowPower:
            return "배터리 우선: 평상시 전송을 줄이고 이상 징후 전후 30분 증거 수집을 보장합니다."
        }
    }

    var index: Int { Self.allCases.firstIndex(of: self) ?? 1 }

    static var saved: SensorPowerMode {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.sensorPowerMode) ?? SensorPowerMode.lowPower.rawValue
        return SensorPowerMode(rawValue: raw) ?? .lowPower
    }

    static func from(index: Int) -> SensorPowerMode {
        guard index >= 0 && index < Self.allCases.count else { return .balanced }
        return Self.allCases[index]
    }
}

private enum IntroGuideMode: String, CaseIterable {
    case alwaysOn
    case sessionOff
    case alwaysOff

    var title: String {
        switch self {
        case .alwaysOn: return "항상 켬"
        case .sessionOff: return "이번 실행 중 끔"
        case .alwaysOff: return "항상 끔"
        }
    }

    var detail: String {
        switch self {
        case .alwaysOn:
            return "앱을 열 때마다 좌측 상단 VitAlGuard 로고 메뉴 안내를 보여줍니다."
        case .sessionOff:
            return "앱을 완전히 종료하기 전까지 안내를 숨기고, 다음 실행 때 다시 보여줍니다."
        case .alwaysOff:
            return "초기 사용방법 안내를 계속 숨깁니다."
        }
    }

    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    static var saved: IntroGuideMode {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.introGuideMode) ?? IntroGuideMode.alwaysOn.rawValue
        return IntroGuideMode(rawValue: raw) ?? .alwaysOn
    }

    static func from(index: Int) -> IntroGuideMode {
        guard index >= 0 && index < Self.allCases.count else { return .alwaysOn }
        return Self.allCases[index]
    }
}

private enum AppLanguage: String, CaseIterable {
    case system = ""
    case korean = "ko"
    case english = "en"
    case chineseSimplified = "zh-Hans"
    case japanese = "ja"
    case vietnamese = "vi"
    case thai = "th"
    case malay = "ms"
    case indonesian = "id"
    case russian = "ru"
    case ukrainian = "uk"
    case french = "fr"
    case german = "de"
    case czech = "cs"
    case polish = "pl"
    case italian = "it"
    case spanish = "es"
    case swedish = "sv"
    case norwegian = "nb"
    case finnish = "fi"

    var title: String {
        switch self {
        case .system: return "시스템 설정"
        case .korean: return "한국어"
        case .english: return "English"
        case .chineseSimplified: return "简体中文"
        case .japanese: return "日本語"
        case .vietnamese: return "Tiếng Việt"
        case .thai: return "ไทย"
        case .malay: return "Bahasa Melayu"
        case .indonesian: return "Bahasa Indonesia"
        case .russian: return "Русский"
        case .ukrainian: return "Українська"
        case .french: return "Français"
        case .german: return "Deutsch"
        case .czech: return "Čeština"
        case .polish: return "Polski"
        case .italian: return "Italiano"
        case .spanish: return "Español"
        case .swedish: return "Svenska"
        case .norwegian: return "Norsk"
        case .finnish: return "Suomi"
        }
    }

    var detail: String {
        switch self {
        case .system: return "iPhone 설정 앱의 앱별 언어를 따릅니다."
        case .korean: return "앱 화면을 한국어로 표시합니다."
        case .english: return "Show supported app text in English."
        default: return "선택한 언어 리소스를 사용할 수 있으면 앱 문구에 적용합니다."
        }
    }

    static var saved: AppLanguage {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.languageCode) ?? AppLanguage.system.rawValue
        return AppLanguage(rawValue: raw) ?? .system
    }

    static var savedLanguageCode: String {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.languageCode)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !raw.isEmpty { return raw }
        return Locale.preferredLanguages.first ?? "ko"
    }

    static var googleTranslateCode: String? {
        let raw = savedLanguageCode
        let lower = raw.lowercased()
        guard !lower.hasPrefix("ko") else { return nil }
        if lower.hasPrefix("zh-hans") || lower == "zh" { return "zh-CN" }
        if lower.hasPrefix("zh-hant") { return "zh-TW" }
        if lower.hasPrefix("nb") { return "no" }
        if let languageCode = Locale(identifier: raw).language.languageCode?.identifier {
            return languageCode
        }
        return raw
    }
}

private final class VitAlGuardRuntimeTranslator {
    static let shared = VitAlGuardRuntimeTranslator()
    private let cacheKey = "vitalguard.runtime.translation.cache"
    private var inflight: [String: [(String) -> Void]] = [:]
    private let lock = NSLock()

    private init() {}

    private var targetCode: String? {
        AppLanguage.googleTranslateCode
    }

    private var cache: [String: String] {
        get { UserDefaults.standard.dictionary(forKey: cacheKey) as? [String: String] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: cacheKey) }
    }

    private func cacheLookup(_ key: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return cache[key]
    }

    private func cacheStore(_ value: String, for key: String) {
        lock.lock()
        var current = cache
        current[key] = value
        cache = current
        lock.unlock()
    }

    private func containsKorean(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            (0xAC00...0xD7A3).contains(Int(scalar.value)) ||
            (0x3130...0x318F).contains(Int(scalar.value)) ||
            (0x1100...0x11FF).contains(Int(scalar.value))
        }
    }

    private func cacheKey(for text: String, target: String) -> String {
        "\(target)::\(text)"
    }

    func translate(_ text: String, completion: @escaping (String) -> Void) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              containsKorean(text),
              let target = targetCode else {
            completion(text)
            return
        }

        let key = cacheKey(for: text, target: target)
        if let cached = cacheLookup(key) {
            completion(cached)
            return
        }

        lock.lock()
        if inflight[key] != nil {
            inflight[key]?.append(completion)
            lock.unlock()
            return
        }
        inflight[key] = [completion]
        lock.unlock()

        var components = URLComponents(string: "https://translate.googleapis.com/translate_a/single")
        components?.queryItems = [
            URLQueryItem(name: "client", value: "gtx"),
            URLQueryItem(name: "sl", value: "ko"),
            URLQueryItem(name: "tl", value: target),
            URLQueryItem(name: "dt", value: "t"),
            URLQueryItem(name: "q", value: text)
        ]
        guard let url = components?.url else {
            finish(key: key, value: text)
            return
        }

        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            let translated = Self.parseGoogleTranslate(data: data) ?? text
            self?.cacheStore(translated, for: key)
            self?.finish(key: key, value: translated)
        }.resume()
    }

    private func finish(key: String, value: String) {
        lock.lock()
        let callbacks = inflight.removeValue(forKey: key) ?? []
        lock.unlock()
        DispatchQueue.main.async {
            callbacks.forEach { $0(value) }
        }
    }

    private static func parseGoogleTranslate(data: Data?) -> String? {
        guard let data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [Any],
              let sentences = json.first as? [Any] else {
            return nil
        }
        let parts = sentences.compactMap { item -> String? in
            guard let row = item as? [Any] else { return nil }
            return row.first as? String
        }
        let joined = parts.joined()
        return joined.isEmpty ? nil : joined
    }

    func localize(view: UIView) {
        guard targetCode != nil else { return }
        localizeElement(view)
        view.subviews.forEach { localize(view: $0) }
    }

    private func localizeElement(_ view: UIView) {
        if let label = view as? UILabel, let original = label.text {
            translate(original) { [weak label] translated in
                label?.text = translated
            }
        }
        if let button = view as? UIButton, let original = button.title(for: .normal) {
            translate(original) { [weak button] translated in
                button?.setTitle(translated, for: .normal)
            }
        }
        if let field = view as? UITextField, let original = field.placeholder {
            translate(original) { [weak field] translated in
                field?.placeholder = translated
            }
        }
        if let segment = view as? UISegmentedControl {
            for index in 0..<segment.numberOfSegments {
                guard let original = segment.titleForSegment(at: index) else { continue }
                translate(original) { [weak segment] translated in
                    segment?.setTitle(translated, forSegmentAt: index)
                }
            }
        }
    }

    func localizedAlert(title: String, message: String, completion: @escaping (String, String) -> Void) {
        translate(title) { translatedTitle in
            self.translate(message) { translatedMessage in
                completion(translatedTitle, translatedMessage)
            }
        }
    }
}

private enum WatermarkPosition: String, CaseIterable {
    case top
    case center
    case bottom

    var title: String {
        switch self {
        case .top: return "상단"
        case .center: return "중앙"
        case .bottom: return "하단"
        }
    }

    var index: Int { Self.allCases.firstIndex(of: self) ?? 2 }

    static func from(index: Int) -> Self {
        guard index >= 0 && index < Self.allCases.count else { return .bottom }
        return Self.allCases[index]
    }
}

private enum WatermarkBackgroundColorPreset: String, CaseIterable {
    case black = "black"
    case gray = "gray"
    case blue = "blue"
    case clear = "clear"

    var title: String {
        switch self {
        case .black: return "검정"
        case .gray: return "회색"
        case .blue: return "파랑"
        case .clear: return "투명"
        }
    }

    var color: UIColor {
        switch self {
        case .black: return UIColor.black
        case .gray: return UIColor.darkGray
        case .blue: return UIColor.systemBlue
        case .clear: return UIColor.clear
        }
    }

    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    static func from(raw: String?) -> Self {
        guard let raw, let preset = Self(rawValue: raw) else {
            return .black
        }
        return preset
    }

    static func from(index: Int) -> Self {
        guard index >= 0 && index < Self.allCases.count else { return .black }
        return Self.allCases[index]
    }
}

private enum WatermarkTextColorPreset: String, CaseIterable {
    case white = "white"
    case black = "black"
    case yellow = "yellow"
    case green = "green"
    case red = "red"

    var title: String {
        switch self {
        case .white: return "흰색"
        case .black: return "검은색"
        case .yellow: return "노란색"
        case .green: return "초록색"
        case .red: return "빨간색"
        }
    }

    var color: UIColor {
        switch self {
        case .white:
            return .white
        case .black:
            return .black
        case .yellow:
            return .yellow
        case .green:
            return .systemGreen
        case .red:
            return .systemRed
        }
    }

    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    static func from(raw: String?) -> Self {
        guard let raw, let preset = Self(rawValue: raw) else {
            return .white
        }
        return preset
    }

    static func from(index: Int) -> Self {
        guard index >= 0 && index < Self.allCases.count else { return .white }
        return Self.allCases[index]
    }
}

private enum DashboardCredentialStore {
    private static let service = "com.yangjeehoo.vitalguard.dashboard"
    private static let passwordAccount = "adminPassword"
    private static let appJWTAccount = "appAuthJWT"

    static func savePassword(_ password: String) {
        save(password, account: passwordAccount)
    }

    static func loadPassword() -> String? {
        load(account: passwordAccount)
    }

    static func saveAppJWT(_ token: String) {
        save(token, account: appJWTAccount)
    }

    static func loadAppJWT() -> String? {
        load(account: appJWTAccount)
    }

    static func deleteAppJWT() {
        delete(account: appJWTAccount)
    }

    private static func save(_ value: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    private static func load(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

private enum VitalGuardLinks {
    static let safetyMonitor = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app"
    static let appAPI = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/api/mock/vital"
    static let appAuthLogin = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/api/app-auth/login"
}

private enum DashboardConnectionState {
    case connected
    case delayed
    case offline

    var title: String {
        switch self {
        case .connected: return "관제웹 연결됨"
        case .delayed: return "관제웹 지연"
        case .offline: return "관제웹 연결 안됨"
        }
    }

    var detail: String {
        switch self {
        case .connected: return "실시간 동기화 정상"
        case .delayed: return "응답 지연 또는 서버 확인 중"
        case .offline: return "네트워크/서버 연결 필요"
        }
    }

    var activeIndex: Int {
        switch self {
        case .connected: return 0
        case .delayed: return 1
        case .offline: return 2
        }
    }

    var color: UIColor {
        switch self {
        case .connected: return UIColor(red: 0.00, green: 0.62, blue: 0.32, alpha: 1.0)
        case .delayed: return UIColor(red: 0.92, green: 0.55, blue: 0.05, alpha: 1.0)
        case .offline: return UIColor(red: 0.83, green: 0.00, blue: 0.02, alpha: 1.0)
        }
    }
}

enum PreviewThemeMode: String, CaseIterable {
    case system
    case light
    case dark

    var title: String {
        switch self {
        case .system: return "시스템 설정"
        case .light: return "라이트 모드"
        case .dark: return "다크 모드"
        }
    }

    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: return .unspecified
        case .light: return .light
        case .dark: return .dark
        }
    }
}

private enum HomeSection: String, CaseIterable {
    case safetySignal
    case siteWeather
    case adminWatch
    case metrics
    case workers
    case cctv
    case adminAppleHealth
    case dashboardWeather
    case adminActions
    case workerSafety
    case workerWatch
    case workerAppleHealth
    case workerWeather
    case nearbyCctv
    case workerDashboardWeather
    case workerActions

    var title: String {
        switch self {
        case .safetySignal: return "현장 통합 안전 신호등"
        case .siteWeather: return "작업 구역 기상"
        case .adminWatch: return "실시간 Watch 데이터"
        case .metrics: return "생체 요약"
        case .workers: return "작업자 모니터링"
        case .cctv: return "현장 CCTV"
        case .adminAppleHealth: return "Apple Health / Wallet"
        case .dashboardWeather: return "관제 기상 대시보드"
        case .adminActions: return "대시보드 연동"
        case .workerSafety: return "작업 안전지수"
        case .workerWatch: return "Watch 연동 데이터"
        case .workerAppleHealth: return "Apple Health / Wallet"
        case .workerWeather: return "작업 위치 기상"
        case .nearbyCctv: return "근처 CCTV"
        case .workerDashboardWeather: return "관제 기상 대시보드"
        case .workerActions: return "대시보드 연동"
        }
    }

    var mode: AppMode {
        switch self {
        case .safetySignal, .siteWeather, .adminWatch, .metrics, .workers, .cctv, .adminAppleHealth, .dashboardWeather, .adminActions:
            return .admin
        case .workerSafety, .workerWatch, .workerAppleHealth, .workerWeather, .nearbyCctv, .workerDashboardWeather, .workerActions:
            return .worker
        }
    }

    static func defaults(for mode: AppMode) -> [HomeSection] {
        switch mode {
        case .admin:
            return [.safetySignal, .siteWeather, .dashboardWeather, .adminWatch, .adminAppleHealth, .metrics, .workers, .cctv]
        case .worker:
            return [.workerSafety, .workerWeather, .workerDashboardWeather, .workerWatch, .workerAppleHealth, .nearbyCctv]
        }
    }

    static func storageKey(for mode: AppMode) -> String {
        mode == .admin ? PreviewSettingsKey.adminHomeLayout : PreviewSettingsKey.workerHomeLayout
    }

    static func savedOrder(for mode: AppMode) -> [HomeSection] {
        let defaults = Self.defaults(for: mode)
        let key = Self.storageKey(for: mode)
        guard let stored = UserDefaults.standard.array(forKey: key) as? [String] else {
            return defaults
        }
        var sections = stored.compactMap(HomeSection.init(rawValue:)).filter { $0.mode == mode }
        for section in defaults where !sections.contains(section) {
            sections.append(section)
        }
        return sections
    }

    static func save(_ sections: [HomeSection], for mode: AppMode) {
        let values = sections.filter { $0.mode == mode }.map(\.rawValue)
        UserDefaults.standard.set(values, forKey: Self.storageKey(for: mode))
    }

    static func migrateAdminDefaultIfNeeded() {
        let defaults = UserDefaults.standard
        guard defaults.integer(forKey: PreviewSettingsKey.adminHomeLayoutVersion) < 1 else { return }
        save(Self.defaults(for: .admin), for: .admin)
        defaults.set(1, forKey: PreviewSettingsKey.adminHomeLayoutVersion)
    }
}

private enum MainTab: CaseIterable {
    case home
    case watch
    case cctv
    case wallet
    case settings

    var title: String {
        switch self {
        case .home: return "홈"
        case .watch: return "Watch"
        case .cctv: return "CCTV"
        case .wallet: return "Health"
        case .settings: return "설정"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house.fill"
        case .watch: return "applewatch"
        case .cctv: return "video.fill"
        case .wallet: return "heart.text.square.fill"
        case .settings: return "gearshape.fill"
        }
    }

    func sections(for mode: AppMode) -> [HomeSection] {
        switch (self, mode) {
        case (.home, .admin): return [.safetySignal, .siteWeather, .dashboardWeather]
        case (.home, .worker): return [.workerSafety, .workerWeather, .workerDashboardWeather]
        case (.watch, .admin): return [.adminWatch]
        case (.watch, .worker): return [.workerWatch]
        case (.cctv, .admin): return [.cctv]
        case (.cctv, .worker): return [.nearbyCctv]
        case (.wallet, .admin): return [.adminAppleHealth]
        case (.wallet, .worker): return [.workerAppleHealth]
        case (.settings, _): return []
        }
    }
}

@available(iOS 16.0, *)
private final class AppMediaCalendarViewController: UIViewController,
    UICalendarViewDelegate,
    UICalendarSelectionSingleDateDelegate,
    UITableViewDataSource,
    UITableViewDelegate,
    QLPreviewControllerDataSource {
    var onCommentSubmit: ((CalendarCommentEntry, @escaping (Bool, String) -> Void) -> Void)?
    var onCommentUpdate: ((CalendarCommentEntry, @escaping (Bool, String) -> Void) -> Void)?
    var onCommentDelete: ((AppMediaCalendarRecord, @escaping (Bool, String) -> Void) -> Void)?
    var onAttachmentRequest: ((FieldJournalAttachmentSource, CalendarCommentComposerViewController) -> Void)?

    private let syncURL: URL?
    private let authToken: String
    private let calendarView = UICalendarView()
    private let statusLabel = UILabel()
    private let tableView = UITableView(frame: .zero, style: .insetGrouped)
    private var tableMinimumHeightConstraint: NSLayoutConstraint?
    private var calendarSelection: UICalendarSelectionSingleDate?
    private var records: [AppMediaCalendarRecord] = []
    private var selectedDate = Date()
    private var syncTimer: Timer?
    private var previewURL: URL?
    private var previewRecord: AppMediaCalendarRecord?

    init(syncURL: URL?, authToken: String) {
        self.syncURL = syncURL
        self.authToken = authToken
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        self.syncURL = nil
        self.authToken = ""
        super.init(coder: coder)
    }

    deinit {
        syncTimer?.invalidate()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "관제 캘린더"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close))
        let todayItem = UIBarButtonItem(title: "오늘", style: .plain, target: self, action: #selector(moveToToday))
        let refreshItem = UIBarButtonItem(
            image: UIImage(systemName: "arrow.clockwise"),
            style: .plain,
            target: self,
            action: #selector(refreshNow)
        )
        let commentItem = UIBarButtonItem(
            image: UIImage(systemName: "text.bubble.fill"),
            style: .plain,
            target: self,
            action: #selector(openCommentComposer)
        )
        commentItem.accessibilityLabel = "댓글 남기기"
        navigationItem.rightBarButtonItems = [refreshItem, commentItem, todayItem]
        buildInterface()
        loadLocalRecords()
        refreshFromDashboard()
        syncTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.refreshFromDashboard()
        }
        syncTimer?.tolerance = 8
    }

    private func buildInterface() {
        calendarView.translatesAutoresizingMaskIntoConstraints = false
        calendarView.delegate = self
        calendarView.calendar = Calendar(identifier: .gregorian)
        calendarView.locale = Locale(identifier: "ko_KR")
        calendarView.tintColor = UIColor(red: 0.05, green: 0.60, blue: 1.0, alpha: 1.0)
        calendarView.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        let selection = UICalendarSelectionSingleDate(delegate: self)
        selection.selectedDate = calendarView.calendar.dateComponents([.year, .month, .day], from: selectedDate)
        calendarSelection = selection
        calendarView.selectionBehavior = selection

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.dataSource = self
        tableView.delegate = self
        tableView.backgroundColor = .systemBackground
        tableView.rowHeight = 88
        tableView.estimatedRowHeight = 88
        tableView.sectionHeaderHeight = 0
        tableView.sectionFooterHeight = 0
        tableView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 28, right: 0)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "record")

        view.addSubview(calendarView)
        view.addSubview(statusLabel)
        view.addSubview(tableView)
        let calendarMaximumHeight = calendarView.heightAnchor.constraint(
            lessThanOrEqualTo: view.safeAreaLayoutGuide.heightAnchor,
            multiplier: 0.61
        )
        let tableMinimumHeight = tableView.heightAnchor.constraint(
            greaterThanOrEqualTo: view.safeAreaLayoutGuide.heightAnchor,
            multiplier: 0.26
        )
        tableMinimumHeight.priority = .defaultHigh
        tableMinimumHeightConstraint = tableMinimumHeight
        NSLayoutConstraint.activate([
            calendarView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            calendarView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            calendarView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            calendarMaximumHeight,
            statusLabel.topAnchor.constraint(equalTo: calendarView.bottomAnchor, constant: 4),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            tableView.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 4),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            tableMinimumHeight
        ])
    }

    private func loadLocalRecords() {
        records = AppMediaCalendarStore.load()
        updateStatus()
        tableView.reloadData()
        resetAttachmentListPosition()
        calendarView.reloadDecorations(forDateComponents: decoratedDates(), animated: true)
    }

    private func recordsForSelectedDate() -> [AppMediaCalendarRecord] {
        records.filter {
            Calendar.current.isDate($0.capturedAt, inSameDayAs: selectedDate) && $0.kind != "comment"
        }
    }

    private func commentsForSelectedDate() -> [AppMediaCalendarRecord] {
        records.filter {
            Calendar.current.isDate($0.capturedAt, inSameDayAs: selectedDate) && $0.kind == "comment"
        }
    }

    private func decoratedDates() -> [DateComponents] {
        let dates = Set(records.map { Calendar.current.startOfDay(for: $0.capturedAt) })
        return dates.map { Calendar.current.dateComponents([.year, .month, .day], from: $0) }
    }

    private func updateStatus(syncText: String? = nil) {
        let count = recordsForSelectedDate().count
        let commentCount = commentsForSelectedDate().count
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M월 d일 EEEE"
        let base = "\(formatter.string(from: selectedDate)) · 첨부 \(count)개 · 댓글 \(commentCount)개"
        statusLabel.text = [base, syncText].compactMap { $0 }.joined(separator: "\n")
    }

    @objc private func refreshNow() {
        refreshFromDashboard()
    }

    @objc private func moveToToday() {
        selectedDate = Date()
        let components = calendarView.calendar.dateComponents([.year, .month, .day], from: selectedDate)
        calendarSelection?.selectedDate = components
        calendarView.setVisibleDateComponents(components, animated: true)
        updateStatus()
        tableView.reloadData()
        resetAttachmentListPosition()
    }

    @objc private func openCommentComposer() {
        presentCommentComposer()
    }

    private func presentCommentComposer(
        relatedRecord: AppMediaCalendarRecord? = nil,
        editingComment: AppMediaCalendarRecord? = nil
    ) {
        let composer = CalendarCommentComposerViewController(
            date: editingComment?.capturedAt ?? selectedDate,
            relatedRecord: relatedRecord,
            editingComment: editingComment,
            existingAttachments: editingComment.map { editableAttachments(for: $0) } ?? []
        )
        composer.onSubmit = { [weak self] entry, completion in
            let finish: (Bool, String) -> Void = { ok, message in
                completion(ok, message)
                if ok {
                    self?.refreshFromDashboard()
                }
            }
            if entry.id == nil {
                self?.onCommentSubmit?(entry, finish)
            } else {
                self?.onCommentUpdate?(entry, finish)
            }
        }
        composer.onAttachmentRequest = { [weak self] source, composer in
            self?.onAttachmentRequest?(source, composer)
        }
        let nav = UINavigationController(rootViewController: composer)
        nav.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    private func refreshFromDashboard() {
        guard let syncURL else {
            updateStatus(syncText: "관제 캘린더 URL을 확인할 수 없어 로컬 기록만 표시합니다.")
            return
        }
        refreshFromDashboard(candidateURLs: calendarSyncCandidates(from: syncURL), index: 0, failures: [])
    }

    private func calendarSyncCandidates(from syncURL: URL) -> [URL] {
        var urls = [syncURL]
        if let calendarMediaURL = calendarMediaURL(from: syncURL) {
            urls.insert(calendarMediaURL, at: 0)
        }
        if syncURL.path.hasSuffix("/") == false,
           let slashURL = URL(string: syncURL.absoluteString + "/") {
            urls.append(slashURL)
        }
        if var components = URLComponents(url: syncURL, resolvingAgainstBaseURL: false) {
            components.queryItems = [URLQueryItem(name: "limit", value: "200")]
            if let limitURL = components.url {
                urls.append(limitURL)
            }
        }
        if let base = URL(string: "\(syncURL.scheme ?? "https")://\(syncURL.host ?? "")") {
            [
                "api/calendar/media",
                "api/app-media",
                "api/app-media/events",
                "api/mobile/app-media",
                "api/mock/app-media"
            ].forEach { path in
                guard var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
                    return
                }
                components.queryItems = path == "api/calendar/media"
                    ? calendarDateRangeQueryItems()
                    : [URLQueryItem(name: "limit", value: "200")]
                if let url = components.url {
                    urls.append(url)
                }
            }
        }
        return Array(NSOrderedSet(array: urls).compactMap { $0 as? URL })
    }

    private func calendarMediaURL(from url: URL) -> URL? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/api/calendar/media"
        components.queryItems = calendarDateRangeQueryItems()
        return components.url
    }

    private func calendarDateRangeQueryItems() -> [URLQueryItem] {
        let calendar = Calendar(identifier: .gregorian)
        let startDate = calendar.date(byAdding: .day, value: -45, to: selectedDate) ?? selectedDate
        let endDate = calendar.date(byAdding: .day, value: 45, to: selectedDate) ?? selectedDate
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy-MM-dd"
        return [
            URLQueryItem(name: "from", value: formatter.string(from: startDate)),
            URLQueryItem(name: "to", value: formatter.string(from: endDate))
        ]
    }

    private func refreshFromDashboard(candidateURLs: [URL], index: Int, failures: [String]) {
        guard candidateURLs.indices.contains(index) else {
            let cause = failures.first(where: { $0.contains("HTTP 405") }) ?? failures.last ?? "응답 없음"
            updateStatus(syncText: "관제 동기화 실패: \(cause)")
            return
        }
        let url = candidateURLs[index]
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
            request.setValue(authToken, forHTTPHeaderField: "x-app-upload-token")
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.refreshFromDashboard(
                        candidateURLs: candidateURLs,
                        index: index + 1,
                        failures: failures + [error.localizedDescription]
                    )
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status), let data else {
                    let failureText = status == 405
                        ? "HTTP 405 · 관제 캘린더 조회 GET API 미배포"
                        : "HTTP \(status)"
                    self.refreshFromDashboard(
                        candidateURLs: candidateURLs,
                        index: index + 1,
                        failures: failures + [failureText]
                    )
                    return
                }
                let remote = AppMediaCalendarStore.records(fromServerData: data)
                AppMediaCalendarStore.merge(remote)
                self.loadLocalRecords()
                self.updateStatus(syncText: "관제 웹 대시보드 캘린더와 동기화됨 · \(remote.count)건")
            }
        }.resume()
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    func calendarView(_ calendarView: UICalendarView, decorationFor dateComponents: DateComponents) -> UICalendarView.Decoration? {
        guard let date = Calendar.current.date(from: dateComponents) else { return nil }
        return records.contains(where: { Calendar.current.isDate($0.capturedAt, inSameDayAs: date) })
            ? .default(color: UIColor(red: 0.05, green: 0.60, blue: 1.0, alpha: 1.0), size: .large)
            : nil
    }

    func dateSelection(_ selection: UICalendarSelectionSingleDate, didSelectDate dateComponents: DateComponents?) {
        guard let dateComponents, let date = Calendar.current.date(from: dateComponents) else { return }
        selectedDate = date
        updateStatus()
        tableView.reloadData()
        resetAttachmentListPosition()
    }

    private func resetAttachmentListPosition() {
        tableView.layoutIfNeeded()
        tableView.setContentOffset(CGPoint(x: 0, y: -tableView.adjustedContentInset.top), animated: false)
    }

    func numberOfSections(in tableView: UITableView) -> Int {
        2
    }

    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        section == 0 ? "첨부 파일" : "댓글"
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        if section == 0 {
            return max(1, recordsForSelectedDate().count)
        }
        return max(1, commentsForSelectedDate().count)
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "record", for: indexPath)
        let items = indexPath.section == 0 ? recordsForSelectedDate() : commentsForSelectedDate()
        var content = UIListContentConfiguration.subtitleCell()
        if items.isEmpty {
            content.image = UIImage(systemName: indexPath.section == 0 ? "calendar" : "text.bubble")
            content.text = indexPath.section == 0 ? "선택한 날짜의 첨부 파일이 없습니다." : "선택한 날짜의 댓글이 없습니다."
            content.secondaryText = indexPath.section == 0
                ? "사진/비디오/문서 스캔을 저장하거나 관제 웹 캘린더 동기화를 기다려 주세요."
                : "우측 상단 댓글 버튼으로 관제 웹 대시보드와 같은 댓글을 남길 수 있습니다."
            cell.accessoryType = .none
            cell.isAccessibilityElement = true
            cell.accessibilityTraits = [.staticText]
            cell.accessibilityLabel = content.text
            cell.accessibilityHint = content.secondaryText
        } else {
            let record = items[indexPath.row]
            content.image = UIImage(systemName: symbolName(for: record))
            content.text = record.kind == "comment" ? (record.commentText ?? record.journalContent ?? record.ocrText ?? record.title) : record.title
            content.secondaryText = detailText(for: record)
            content.textProperties.numberOfLines = 1
            content.secondaryTextProperties.numberOfLines = record.kind == "comment" ? 3 : 2
            cell.accessoryType = .none
            cell.accessoryView = record.kind == "comment" ? nil : commentAccessoryButton(for: record)
            cell.isAccessibilityElement = true
            cell.accessibilityTraits = [.button]
            cell.accessibilityLabel = "\(record.title), \(detailText(for: record).replacingOccurrences(of: "\n", with: ", "))"
            cell.accessibilityHint = record.kind == "comment"
                ? "내가 작성한 댓글이면 수정하거나 삭제할 수 있습니다."
                : "파일을 QuickLook으로 미리봅니다."
        }
        content.imageProperties.tintColor = UIColor(red: 0.05, green: 0.60, blue: 1.0, alpha: 1.0)
        cell.contentConfiguration = content
        if items.isEmpty {
            cell.accessoryView = nil
        }
        return cell
    }

    private func commentAccessoryButton(for record: AppMediaCalendarRecord) -> UIView {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 104, height: 44))
        let button = UIButton(type: .system)
        button.frame = CGRect(x: 0, y: 0, width: 54, height: 44)
        button.center = CGPoint(x: 28, y: container.bounds.midY)
        button.setImage(UIImage(systemName: "text.bubble.fill"), for: .normal)
        button.tintColor = UIColor(red: 0.08, green: 0.78, blue: 0.82, alpha: 1.0)
        button.backgroundColor = UIColor(red: 0.08, green: 0.78, blue: 0.82, alpha: 0.10)
        button.layer.borderColor = UIColor(red: 0.08, green: 0.78, blue: 0.82, alpha: 1.0).cgColor
        button.layer.borderWidth = 1
        button.layer.cornerRadius = 14
        button.accessibilityLabel = "\(record.title)에 댓글 남기기"
        button.addAction(UIAction { [weak self] _ in
            self?.presentCommentComposer(relatedRecord: record)
        }, for: .touchUpInside)
        container.addSubview(button)
        let chevron = UIImageView(image: UIImage(systemName: "chevron.right"))
        chevron.frame = CGRect(x: 78, y: 0, width: 18, height: 44)
        chevron.contentMode = .center
        chevron.tintColor = .tertiaryLabel
        chevron.isAccessibilityElement = false
        container.addSubview(chevron)
        return container
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 1 {
            let comments = commentsForSelectedDate()
            guard comments.indices.contains(indexPath.row) else { return }
            presentCommentActions(comments[indexPath.row], sourceView: tableView.cellForRow(at: indexPath))
            return
        }
        guard indexPath.section == 0 else { return }
        let items = recordsForSelectedDate()
        guard items.indices.contains(indexPath.row) else { return }
        let record = items[indexPath.row]
        if record.localURL != nil || remoteFileURL(for: record) != nil || dashboardDownloadURL(for: record) != nil {
            openRecordFile(record, exportAfterDownload: false)
        } else {
            presentRecordInfo(record)
        }
    }

    private func presentCommentActions(_ record: AppMediaCalendarRecord, sourceView: UIView?) {
        guard isEditableComment(record) else {
            presentStatus(title: "댓글", message: record.commentText ?? record.journalContent ?? record.ocrText ?? record.title)
            return
        }
        let alert = UIAlertController(
            title: "댓글",
            message: record.commentText ?? record.journalContent ?? record.ocrText,
            preferredStyle: .actionSheet
        )
        alert.addAction(UIAlertAction(title: "내용 및 첨부 수정", style: .default) { [weak self] _ in
            self?.presentCommentComposer(editingComment: record)
        })
        alert.addAction(UIAlertAction(title: "삭제", style: .destructive) { [weak self] _ in
            self?.confirmDeleteComment(record)
        })
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = alert.popoverPresentationController {
            popover.sourceView = sourceView ?? view
            popover.sourceRect = sourceView?.bounds ?? CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(alert, animated: true)
    }

    private func confirmDeleteComment(_ record: AppMediaCalendarRecord) {
        let alert = UIAlertController(title: "댓글 삭제", message: "이 댓글을 삭제하시겠습니까?", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "아니오", style: .cancel))
        alert.addAction(UIAlertAction(title: "예", style: .destructive) { [weak self] _ in
            self?.onCommentDelete?(record) { ok, message in
                self?.presentStatus(title: ok ? "삭제 완료" : "삭제 확인", message: message)
                self?.loadLocalRecords()
                self?.refreshFromDashboard()
            }
        })
        present(alert, animated: true)
    }

    private func isEditableComment(_ record: AppMediaCalendarRecord) -> Bool {
        guard record.kind == "comment" else { return false }
        let currentId = UserDefaults.standard.string(forKey: PreviewSettingsKey.loggedInId)
        return record.source == "VitAlGuard-iPhone" || record.workerId == currentId
    }

    private func editableAttachments(for record: AppMediaCalendarRecord) -> [(String, FieldJournalAttachment)] {
        AppMediaCalendarStore.attachments(forCommentId: record.id).map { attachmentRecord in
            let attachment = FieldJournalAttachment(
                kind: attachmentRecord.kind,
                title: attachmentRecord.title.replacingOccurrences(of: "댓글 첨부 · ", with: ""),
                fileName: attachmentRecord.fileName,
                mimeType: attachmentRecord.mimeType,
                byteSize: attachmentRecord.byteSize,
                localURL: attachmentRecord.localURL,
                capturedAt: attachmentRecord.capturedAt,
                note: attachmentRecord.note ?? attachmentRecord.ocrText ?? ""
            )
            return (attachmentRecord.id, attachment)
        }
    }

    private func presentRecordActions(_ record: AppMediaCalendarRecord, sourceView: UIView?) {
        let message = [record.ocrText, record.journalContent, record.note]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        let alert = UIAlertController(title: record.title, message: message, preferredStyle: .actionSheet)
        let hasLocalFile = record.localURL.map { FileManager.default.fileExists(atPath: $0.path) } == true
        let hasRemoteFile = remoteFileURL(for: record) != nil

        if hasLocalFile || hasRemoteFile {
            alert.addAction(UIAlertAction(title: "파일 보기", style: .default) { [weak self] _ in
                self?.openRecordFile(record, exportAfterDownload: false)
            })
            alert.addAction(UIAlertAction(title: "다운로드 / 공유", style: .default) { [weak self] _ in
                self?.openRecordFile(record, exportAfterDownload: true)
            })
        }
        if message != nil || (!hasLocalFile && !hasRemoteFile) {
            alert.addAction(UIAlertAction(title: "정보 보기", style: .default) { [weak self] _ in
                self?.presentRecordInfo(record)
            })
        }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = alert.popoverPresentationController {
            popover.sourceView = sourceView ?? view
            popover.sourceRect = sourceView?.bounds ?? CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(alert, animated: true)
    }

    private func openRecordFile(_ record: AppMediaCalendarRecord, exportAfterDownload: Bool) {
        if let url = record.localURL, FileManager.default.fileExists(atPath: url.path) {
            if exportAfterDownload {
                exportDownloadedFile(url, title: record.title)
            } else {
                presentPreview(url, record: record)
            }
            return
        }
        downloadRemoteFile(for: record) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let url):
                if exportAfterDownload {
                    self.exportDownloadedFile(url, title: record.title)
                } else {
                    self.presentPreview(url, record: record)
                }
            case .failure(let error):
                self.presentStatus(title: "파일 다운로드 실패", message: error.localizedDescription)
            }
        }
    }

    private func presentPreview(_ url: URL, record: AppMediaCalendarRecord? = nil) {
        previewURL = url
        previewRecord = record
        let preview = QLPreviewController()
        preview.dataSource = self
        preview.navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "닫기",
            style: .plain,
            target: self,
            action: #selector(closePreview)
        )
        let shareItem = UIBarButtonItem(
            image: UIImage(systemName: "square.and.arrow.up"),
            style: .plain,
            target: self,
            action: #selector(sharePreviewFile)
        )
        shareItem.accessibilityLabel = "공유하기"
        let commentItem = UIBarButtonItem(
            image: UIImage(systemName: "text.bubble.fill"),
            style: .plain,
            target: self,
            action: #selector(commentOnPreviewFile)
        )
        commentItem.accessibilityLabel = "댓글 남기기"
        preview.navigationItem.rightBarButtonItems = [shareItem, commentItem]
        let nav = UINavigationController(rootViewController: preview)
        nav.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        present(nav, animated: true)
    }

    @objc private func closePreview() {
        previewRecord = nil
        dismiss(animated: true)
    }

    @objc private func commentOnPreviewFile() {
        let relatedRecord = previewRecord
        dismiss(animated: true) { [weak self] in
            self?.presentCommentComposer(relatedRecord: relatedRecord)
        }
    }

    @objc private func sharePreviewFile() {
        guard let previewURL else { return }
        let activity = UIActivityViewController(activityItems: [previewURL], applicationActivities: nil)
        activity.setValue(previewURL.lastPathComponent, forKey: "subject")
        let presenter = presentedViewController ?? self
        if let popover = activity.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
        }
        presenter.present(activity, animated: true)
    }

    private func exportDownloadedFile(_ url: URL, title: String) {
        let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        activity.setValue(title, forKey: "subject")
        if let popover = activity.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(activity, animated: true)
    }

    private func presentRecordInfo(_ record: AppMediaCalendarRecord) {
        let message = [record.ocrText, record.journalContent, record.note]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
            ?? "관제 웹에서 동기화된 기록입니다. 원격 파일 주소가 내려오지 않아 파일을 바로 열 수 없습니다."
        presentStatus(title: record.title, message: message)
    }

    private func presentStatus(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default))
        present(alert, animated: true)
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        previewURL == nil ? 0 : 1
    }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        previewURL! as NSURL
    }

    private func remoteFileURL(for record: AppMediaCalendarRecord) -> URL? {
        for value in [record.calendarURL, record.previewDataUrl] {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if let url = remoteURL(from: trimmed) {
                return url
            }
        }
        return nil
    }

    private func remoteURL(from rawValue: String) -> URL? {
        guard !rawValue.isEmpty, !rawValue.lowercased().hasPrefix("data:") else { return nil }
        if let url = URL(string: rawValue), url.scheme?.hasPrefix("http") == true {
            return url
        }
        guard rawValue.hasPrefix("/"),
              let base = syncURL,
              let scheme = base.scheme,
              let host = base.host else {
            return nil
        }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = base.port
        components.path = rawValue
        return components.url
    }

    private func downloadRemoteFile(
        for record: AppMediaCalendarRecord,
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        let candidates = remoteDownloadCandidates(for: record)
        guard !candidates.isEmpty else {
            completion(.failure(NSError(
                domain: "VitAlGuardCalendar",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "관제 서버가 파일 원본 주소를 내려주지 않았습니다."]
            )))
            return
        }
        updateStatus(syncText: "파일 다운로드 중...")
        downloadRemoteFile(record: record, candidates: candidates, index: 0, completion: completion)
    }

    private func remoteDownloadCandidates(for record: AppMediaCalendarRecord) -> [URL] {
        var urls: [URL] = []
        if let downloadURL = dashboardDownloadURL(for: record) {
            urls.append(downloadURL)
        }
        if let remoteURL = remoteFileURL(for: record) {
            urls.append(remoteURL)
        }
        return Array(NSOrderedSet(array: urls).compactMap { $0 as? URL })
    }

    private func dashboardDownloadURL(for record: AppMediaCalendarRecord) -> URL? {
        guard let base = syncURL,
              let scheme = base.scheme,
              let host = base.host else {
            return nil
        }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = base.port
        components.path = "/api/calendar/media/download-url"
        components.queryItems = [URLQueryItem(name: "id", value: serverMediaId(for: record))]
        return components.url
    }

    private func serverMediaId(for record: AppMediaCalendarRecord) -> String {
        record.id.hasPrefix("dashboard-")
            ? String(record.id.dropFirst("dashboard-".count))
            : record.id
    }

    private func downloadRemoteFile(
        record: AppMediaCalendarRecord,
        candidates: [URL],
        index: Int,
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        guard candidates.indices.contains(index) else {
            updateStatus()
            completion(.failure(NSError(
                domain: "VitAlGuardCalendar",
                code: 403,
                userInfo: [NSLocalizedDescriptionKey: "관제 서버와 파일 저장소가 원본 파일 다운로드를 허용하지 않았습니다."]
            )))
            return
        }
        let remoteURL = candidates[index]
        var request = URLRequest(url: remoteURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 40
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        if shouldAttachDashboardAuth(to: remoteURL), !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
            request.setValue(authToken, forHTTPHeaderField: "x-app-upload-token")
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    if candidates.indices.contains(index + 1) {
                        self.downloadRemoteFile(record: record, candidates: candidates, index: index + 1, completion: completion)
                    } else {
                        self.updateStatus()
                        completion(.failure(error))
                    }
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status), let data, !data.isEmpty else {
                    if candidates.indices.contains(index + 1) {
                        self.downloadRemoteFile(record: record, candidates: candidates, index: index + 1, completion: completion)
                    } else {
                        self.updateStatus()
                        completion(.failure(NSError(
                            domain: "VitAlGuardCalendar",
                            code: status,
                            userInfo: [NSLocalizedDescriptionKey: "파일 다운로드 실패: HTTP \(status)"]
                        )))
                    }
                    return
                }
                if let redirectURL = self.redirectDownloadURL(from: data, response: response, baseURL: remoteURL) {
                    self.downloadRemoteFile(record: record, candidates: [redirectURL], index: 0, completion: completion)
                    return
                }
                do {
                    let localURL = try self.saveDownloadedFile(data, response: response, remoteURL: remoteURL, record: record)
                    AppMediaCalendarStore.updateLocalPath(recordId: record.id, localPath: localURL.path)
                    self.records = AppMediaCalendarStore.load()
                    self.tableView.reloadData()
                    self.updateStatus(syncText: "파일 다운로드 완료 · \(localURL.lastPathComponent)")
                    completion(.success(localURL))
                } catch {
                    self.updateStatus()
                    completion(.failure(error))
                }
            }
        }.resume()
    }

    private func shouldAttachDashboardAuth(to url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        if let syncHost = syncURL?.host?.lowercased(), host == syncHost {
            return true
        }
        return host == URL(string: VitalGuardLinks.safetyMonitor)?.host?.lowercased()
    }

    private func redirectDownloadURL(from data: Data, response: URLResponse?, baseURL: URL) -> URL? {
        let mimeType = response?.mimeType?.lowercased() ?? ""
        guard mimeType.contains("json"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let raw = [
            object["downloadUrl"],
            object["downloadURL"],
            object["url"],
            object["media_url"],
            object["mediaUrl"]
        ]
            .compactMap { $0 as? String }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        guard let raw else { return nil }
        if let url = URL(string: raw), url.scheme?.hasPrefix("http") == true {
            return url
        }
        if raw.hasPrefix("/") {
            var components = URLComponents()
            components.scheme = baseURL.scheme
            components.host = baseURL.host
            components.port = baseURL.port
            components.path = raw
            return components.url
        }
        return nil
    }

    private func saveDownloadedFile(
        _ data: Data,
        response: URLResponse?,
        remoteURL: URL,
        record: AppMediaCalendarRecord
    ) throws -> URL {
        guard let folder = AppMediaCalendarStore.calendarMediaFolder() else {
            throw NSError(
                domain: "VitAlGuardCalendar",
                code: -2,
                userInfo: [NSLocalizedDescriptionKey: "앱 파일 저장 폴더를 만들 수 없습니다."]
            )
        }
        let responseFileName = response?.suggestedFilename?.trimmingCharacters(in: .whitespacesAndNewlines)
        let remoteFileName = remoteURL.lastPathComponent.removingPercentEncoding
        let candidateName = [
            responseFileName,
            record.fileName,
            remoteFileName
        ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty } ?? "vitalguard-file-\(Int(Date().timeIntervalSince1970))"
        let safeName = sanitizedFileName(candidateName, fallbackExtension: fallbackExtension(for: record))
        let destination = folder.appendingPathComponent("dashboard-\(record.id)-\(safeName)")
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try data.write(to: destination, options: [.atomic])
        return destination
    }

    private func sanitizedFileName(_ value: String, fallbackExtension: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._- "))
        let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
        var name = String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            name = "vitalguard-file"
        }
        if URL(fileURLWithPath: name).pathExtension.isEmpty, !fallbackExtension.isEmpty {
            name += ".\(fallbackExtension)"
        }
        return name
    }

    private func fallbackExtension(for record: AppMediaCalendarRecord) -> String {
        if record.mimeType.hasPrefix("image/") { return "jpg" }
        if record.mimeType.hasPrefix("video/") { return "mp4" }
        if record.mimeType == "application/pdf" || record.kind == "scan" || record.kind == "document" { return "pdf" }
        return "dat"
    }

    private func symbolName(for record: AppMediaCalendarRecord) -> String {
        if record.kind == "comment" { return "text.bubble.fill" }
        if record.mimeType.hasPrefix("image/") || record.kind == "photo" { return "photo.fill" }
        if record.mimeType.hasPrefix("video/") || record.kind == "video" { return "video.fill" }
        if record.kind == "work-log" || record.kind == "patrol-log" { return "calendar.badge.clock" }
        return "doc.text.fill"
    }

    private func detailText(for record: AppMediaCalendarRecord) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "HH:mm"
        let person = record.workerName ?? record.workerId ?? "작업자 미지정"
        if record.kind == "comment" {
            let attachmentCount = commentAttachmentCount(from: record.note)
            let suffix = attachmentCount > 0 ? " · 첨부 \(attachmentCount)개" : ""
            return "\(formatter.string(from: record.capturedAt)) · \(person)\(suffix)"
        }
        let origin = record.localURL == nil ? "관제 동기화" : "로컬 파일"
        return "\(formatter.string(from: record.capturedAt)) · \(person) · \(origin)\n\(compactFileName(record.fileName))"
    }

    private func commentAttachmentCount(from note: String?) -> Int {
        guard let note,
              let range = note.range(of: "첨부 파일: ") else {
            return 0
        }
        let suffix = note[range.upperBound...]
        return Int(suffix.split(separator: "개").first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") ?? 0
    }

    private func compactFileName(_ fileName: String) -> String {
        guard fileName.count > 34 else { return fileName }
        return "\(fileName.prefix(18))…\(fileName.suffix(12))"
    }
}

@available(iOS 16.0, *)
private final class CalendarCommentComposerViewController: UIViewController, UITextViewDelegate {
    var onSubmit: ((CalendarCommentEntry, @escaping (Bool, String) -> Void) -> Void)?
    var onAttachmentRequest: ((FieldJournalAttachmentSource, CalendarCommentComposerViewController) -> Void)?

    private let date: Date
    private let relatedRecord: AppMediaCalendarRecord?
    private let editingComment: AppMediaCalendarRecord?
    private let textView = UITextView()
    private let attachmentStack = UIStackView()
    private let attachmentStatusLabel = UILabel()
    private let saveButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private var attachments: [FieldJournalAttachment] = []
    private var attachmentRecordIds: [String?] = []

    init(
        date: Date,
        relatedRecord: AppMediaCalendarRecord? = nil,
        editingComment: AppMediaCalendarRecord? = nil,
        existingAttachments: [(String, FieldJournalAttachment)] = []
    ) {
        self.date = date
        self.relatedRecord = relatedRecord
        self.editingComment = editingComment
        self.attachments = existingAttachments.map(\.1)
        self.attachmentRecordIds = existingAttachments.map(\.0)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = editingComment == nil ? "댓글 남기기" : "댓글 수정"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close))
        buildForm()
    }

    private func buildForm() {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .interactive
        scroll.alwaysBounceVertical = true
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 14
        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -28)
        ])

        let guide = UILabel()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "yyyy년 M월 d일 EEEE"
        let dateGuide = "\(formatter.string(from: date)) 관제 캘린더 댓글로 등록됩니다."
        if let relatedRecord {
            guide.text = "\(dateGuide)\n관련 파일: \(relatedRecord.title)"
        } else {
            guide.text = dateGuide
        }
        guide.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        guide.textColor = .secondaryLabel
        guide.numberOfLines = 0

        textView.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        textView.backgroundColor = .secondarySystemBackground
        textView.layer.cornerRadius = 16
        textView.textContainerInset = UIEdgeInsets(top: 14, left: 12, bottom: 14, right: 12)
        textView.heightAnchor.constraint(equalToConstant: 190).isActive = true
        textView.delegate = self
        textView.text = editingComment?.commentText ?? editingComment?.journalContent ?? editingComment?.ocrText

        attachmentStack.axis = .vertical
        attachmentStack.spacing = 8
        attachmentStatusLabel.text = "첨부된 파일이 없습니다."
        attachmentStatusLabel.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        attachmentStatusLabel.textColor = .secondaryLabel
        attachmentStatusLabel.numberOfLines = 0
        attachmentStack.addArrangedSubview(attachmentStatusLabel)

        saveButton.setTitle(editingComment == nil ? "댓글 등록" : "댓글 수정", for: .normal)
        saveButton.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .black)
        saveButton.tintColor = .white
        saveButton.backgroundColor = UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)
        saveButton.layer.cornerRadius = 20
        saveButton.heightAnchor.constraint(equalToConstant: 52).isActive = true
        saveButton.addTarget(self, action: #selector(submit), for: .touchUpInside)

        statusLabel.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0

        stack.addArrangedSubview(sectionLabel("댓글 내용"))
        stack.addArrangedSubview(guide)
        stack.addArrangedSubview(textView)
        stack.addArrangedSubview(sectionLabel("첨부 파일"))
        stack.addArrangedSubview(attachmentButtonsView())
        stack.addArrangedSubview(attachmentStack)
        stack.addArrangedSubview(saveButton)
        stack.addArrangedSubview(statusLabel)
        refreshAttachments()
    }

    private func attachmentButtonsView() -> UIView {
        let grid = UIStackView()
        grid.axis = .vertical
        grid.spacing = 8
        let row1 = UIStackView()
        row1.axis = .horizontal
        row1.spacing = 8
        row1.distribution = .fillEqually
        let row2 = UIStackView()
        row2.axis = .horizontal
        row2.spacing = 8
        row2.distribution = .fillEqually
        row1.addArrangedSubview(attachmentButton("사진 촬영", icon: "camera.fill", source: .photo))
        row1.addArrangedSubview(attachmentButton("비디오 촬영", icon: "video.fill", source: .video))
        row2.addArrangedSubview(attachmentButton("문서 스캔", icon: "doc.viewfinder", source: .document))
        row2.addArrangedSubview(attachmentButton("파일 첨부", icon: "paperclip", source: .file))
        grid.addArrangedSubview(row1)
        grid.addArrangedSubview(row2)
        return grid
    }

    private func attachmentButton(_ title: String, icon: String, source: FieldJournalAttachmentSource) -> UIButton {
        let button = UIButton(type: .system)
        var config = UIButton.Configuration.filled()
        config.title = title
        config.image = UIImage(systemName: icon)
        config.imagePadding = 6
        config.baseBackgroundColor = .secondarySystemBackground
        config.baseForegroundColor = .label
        config.cornerStyle = .medium
        button.configuration = config
        button.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.onAttachmentRequest?(source, self)
        }, for: .touchUpInside)
        return button
    }

    private func sectionLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = UIFont.systemFont(ofSize: 18, weight: .black)
        label.textColor = .label
        return label
    }

    func addAttachment(_ attachment: FieldJournalAttachment) {
        attachments.append(attachment)
        attachmentRecordIds.append(nil)
        refreshAttachments()
    }

    private func refreshAttachments() {
        attachmentStack.arrangedSubviews.dropFirst().forEach { view in
            attachmentStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        attachmentStatusLabel.text = attachments.isEmpty
            ? "첨부된 파일이 없습니다."
            : "\(attachments.count)개 파일이 댓글에 첨부됩니다."
        for (index, attachment) in attachments.enumerated() {
            let row = UIStackView()
            row.axis = .horizontal
            row.alignment = .center
            row.spacing = 8
            row.backgroundColor = .tertiarySystemBackground
            row.layer.cornerRadius = 10
            row.layoutMargins = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 8)
            row.isLayoutMarginsRelativeArrangement = true
            let label = UILabel()
            label.font = UIFont.systemFont(ofSize: 12, weight: .bold)
            label.textColor = .label
            label.numberOfLines = 2
            label.text = "\(attachment.title) · \(attachment.fileName)"
            let delete = UIButton(type: .system)
            delete.setImage(UIImage(systemName: "trash"), for: .normal)
            delete.tintColor = .systemRed
            delete.accessibilityLabel = "\(attachment.title) 첨부 삭제"
            delete.addAction(UIAction { [weak self] _ in
                self?.removeAttachment(at: index)
            }, for: .touchUpInside)
            row.addArrangedSubview(label)
            row.addArrangedSubview(delete)
            delete.widthAnchor.constraint(equalToConstant: 36).isActive = true
            attachmentStack.addArrangedSubview(row)
        }
    }

    private func removeAttachment(at index: Int) {
        guard attachments.indices.contains(index) else { return }
        attachments.remove(at: index)
        if attachmentRecordIds.indices.contains(index) {
            attachmentRecordIds.remove(at: index)
        }
        refreshAttachments()
    }

    @objc private func submit() {
        let text = textView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            statusLabel.text = "댓글 내용을 입력해 주세요."
            return
        }
        saveButton.isEnabled = false
        saveButton.alpha = 0.65
        statusLabel.text = editingComment == nil ? "관제 캘린더 댓글을 등록 중입니다..." : "관제 캘린더 댓글을 수정 중입니다..."
        onSubmit?(CalendarCommentEntry(
            id: editingComment?.id,
            date: date,
            text: text,
            attachments: attachments,
            relatedRecordTitle: relatedRecord?.title,
            relatedRecordId: relatedRecord?.id,
            existingAttachmentRecordIds: attachmentRecordIds.compactMap { $0 }
        )) { [weak self] ok, message in
            guard let self else { return }
            self.saveButton.isEnabled = true
            self.saveButton.alpha = 1
            self.statusLabel.text = message
            if ok {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                    self.dismiss(animated: true)
                }
            }
        }
    }

    @objc private func close() {
        dismiss(animated: true)
    }
}

private final class FieldJournalEntryViewController: UIViewController, UITextViewDelegate {
    var onSubmit: ((FieldJournalEntry, @escaping (Bool, String) -> Void) -> Void)?
    var onAttachmentRequest: ((FieldJournalAttachmentSource, FieldJournalEntryViewController) -> Void)?

    private let calendarURL: URL?
    private let tagText: String
    private var selectedKind: FieldJournalKind = .work
    private let kindSegment = UISegmentedControl(items: FieldJournalKind.allCases.map(\.title))
    private let areaButton = UIButton(type: .system)
    private let datePicker = UIDatePicker()
    private let contentView = UITextView()
    private let attachmentStack = UIStackView()
    private let attachmentStatusLabel = UILabel()
    private let helperLabel = UILabel()
    private let saveButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private var selectedArea = "크레인 작업구역"
    private var attachments: [FieldJournalAttachment] = []
    private var isDashboardManager: Bool {
        appServerRoleCanManageDashboard()
    }

    private let workAreas = ["크레인 작업구역", "북문 게이트", "자재 반입구", "AED 보관함", "지하 전기실", "고소작업 구역"]
    private let patrolAreas = ["1순찰로", "2순찰로", "외곽 울타리", "지하층", "옥상/고소작업", "장비 보관소"]

    init(calendarURL: URL?, tagText: String) {
        self.calendarURL = calendarURL
        self.tagText = tagText
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "NFC 현장 일지"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close))
        buildForm()
        applyKind()
    }

    private func buildForm() {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        scroll.keyboardDismissMode = .interactive

        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 14

        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -28)
        ])

        helperLabel.text = calendarURL == nil
            ? "NFC 태그 URL이 없어 기본 대시보드 캘린더로 등록합니다."
            : "NFC 태그의 캘린더 링크를 기준으로 웹 대시보드에 등록합니다."
        if !isDashboardManager {
            helperLabel.text = [helperLabel.text, "근로자 계정은 본인 사진/비디오/문서 업로드와 조회만 가능합니다."]
                .compactMap { $0 }
                .joined(separator: "\n")
        }
        helperLabel.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        helperLabel.textColor = .secondaryLabel
        helperLabel.numberOfLines = 0

        kindSegment.selectedSegmentIndex = 0
        kindSegment.addTarget(self, action: #selector(kindChanged), for: .valueChanged)

        areaButton.contentHorizontalAlignment = .leading
        areaButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        areaButton.backgroundColor = .secondarySystemBackground
        areaButton.layer.cornerRadius = 16
        areaButton.contentEdgeInsets = UIEdgeInsets(top: 14, left: 16, bottom: 14, right: 16)
        areaButton.addTarget(self, action: #selector(showAreaPicker), for: .touchUpInside)

        datePicker.datePickerMode = .dateAndTime
        datePicker.preferredDatePickerStyle = .compact

        contentView.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        contentView.backgroundColor = .secondarySystemBackground
        contentView.layer.cornerRadius = 16
        contentView.textContainerInset = UIEdgeInsets(top: 14, left: 12, bottom: 14, right: 12)
        contentView.delegate = self
        contentView.heightAnchor.constraint(equalToConstant: 170).isActive = true

        attachmentStack.axis = .vertical
        attachmentStack.spacing = 8
        attachmentStatusLabel.text = "첨부된 파일이 없습니다."
        attachmentStatusLabel.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        attachmentStatusLabel.textColor = .secondaryLabel
        attachmentStatusLabel.numberOfLines = 0
        attachmentStack.addArrangedSubview(attachmentStatusLabel)

        saveButton.setTitle("캘린더에 등록", for: .normal)
        saveButton.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .black)
        saveButton.tintColor = .white
        saveButton.backgroundColor = UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)
        saveButton.layer.cornerRadius = 20
        saveButton.heightAnchor.constraint(equalToConstant: 52).isActive = true
        saveButton.addTarget(self, action: #selector(submit), for: .touchUpInside)

        statusLabel.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0

        stack.addArrangedSubview(sectionLabel("일지 종류"))
        stack.addArrangedSubview(kindSegment)
        stack.addArrangedSubview(helperLabel)
        stack.addArrangedSubview(sectionLabel("구역"))
        stack.addArrangedSubview(areaButton)
        stack.addArrangedSubview(sectionLabel("일시"))
        stack.addArrangedSubview(datePicker)
        stack.addArrangedSubview(sectionLabel("내용"))
        stack.addArrangedSubview(contentView)
        stack.addArrangedSubview(sectionLabel("첨부 파일"))
        stack.addArrangedSubview(attachmentButtonsView())
        stack.addArrangedSubview(attachmentStack)
        stack.addArrangedSubview(saveButton)
        stack.addArrangedSubview(statusLabel)
    }

    private func attachmentButtonsView() -> UIView {
        let grid = UIStackView()
        grid.axis = .vertical
        grid.spacing = 8

        let row1 = UIStackView()
        row1.axis = .horizontal
        row1.spacing = 8
        row1.distribution = .fillEqually

        let row2 = UIStackView()
        row2.axis = .horizontal
        row2.spacing = 8
        row2.distribution = .fillEqually

        row1.addArrangedSubview(attachmentButton("사진 촬영", icon: "camera.fill", source: .photo))
        row1.addArrangedSubview(attachmentButton("비디오 촬영", icon: "video.fill", source: .video))
        row2.addArrangedSubview(attachmentButton("문서 스캔", icon: "doc.viewfinder", source: .document))
        row2.addArrangedSubview(attachmentButton("파일 첨부", icon: "paperclip", source: .file))

        grid.addArrangedSubview(row1)
        grid.addArrangedSubview(row2)
        return grid
    }

    private func attachmentButton(_ title: String, icon: String, source: FieldJournalAttachmentSource) -> UIButton {
        let button = UIButton(type: .system)
        button.tintColor = .label
        button.backgroundColor = .secondarySystemBackground
        button.layer.cornerRadius = 14
        button.layer.cornerCurve = .continuous
        button.contentEdgeInsets = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .black)
        var config = UIButton.Configuration.filled()
        config.title = title
        config.image = UIImage(systemName: icon)
        config.imagePadding = 6
        config.baseBackgroundColor = .secondarySystemBackground
        config.baseForegroundColor = .label
        config.cornerStyle = .medium
        button.configuration = config
        button.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.onAttachmentRequest?(source, self)
        }, for: .touchUpInside)
        return button
    }

    private func sectionLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = UIFont.systemFont(ofSize: 18, weight: .black)
        label.textColor = .label
        return label
    }

    @objc private func kindChanged() {
        let items = FieldJournalKind.allCases
        selectedKind = items[min(max(0, kindSegment.selectedSegmentIndex), items.count - 1)]
        selectedArea = selectedKind == .work ? workAreas[0] : patrolAreas[0]
        applyKind()
    }

    private func applyKind() {
        areaButton.setTitle("\(selectedKind.areaTitle): \(selectedArea)  >", for: .normal)
        contentView.accessibilityLabel = selectedKind.contentTitle
        if contentView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            contentView.text = ""
        }
    }

    @objc private func showAreaPicker() {
        let alert = UIAlertController(title: selectedKind.areaTitle, message: nil, preferredStyle: .actionSheet)
        let areas = selectedKind == .work ? workAreas : patrolAreas
        for area in areas {
            alert.addAction(UIAlertAction(title: area, style: .default) { [weak self] _ in
                self?.selectedArea = area
                self?.applyKind()
            })
        }
        alert.addAction(UIAlertAction(title: "직접 입력", style: .default) { [weak self] _ in
            self?.showCustomAreaInput()
        })
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let pop = alert.popoverPresentationController {
            pop.sourceView = areaButton
            pop.sourceRect = areaButton.bounds
        }
        present(alert, animated: true)
    }

    private func showCustomAreaInput() {
        let alert = UIAlertController(title: "\(selectedKind.areaTitle) 직접 입력", message: "목록에 없는 구역명을 입력해 주세요.", preferredStyle: .alert)
        alert.addTextField { [selectedArea] field in
            field.placeholder = "예: 3층 기계실"
            field.text = selectedArea
            field.clearButtonMode = .whileEditing
        }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        alert.addAction(UIAlertAction(title: "적용", style: .default) { [weak self, weak alert] _ in
            guard let self else { return }
            let text = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty else { return }
            self.selectedArea = text
            self.applyKind()
        })
        present(alert, animated: true)
    }

    func addAttachment(_ attachment: FieldJournalAttachment) {
        attachments.append(attachment)
        refreshAttachments()
    }

    private func refreshAttachments() {
        attachmentStack.arrangedSubviews.dropFirst().forEach { view in
            attachmentStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        attachmentStatusLabel.text = attachments.isEmpty
            ? "첨부된 파일이 없습니다."
            : "\(attachments.count)개 파일이 일지에 첨부됩니다."
        for attachment in attachments {
            let row = UILabel()
            row.font = UIFont.systemFont(ofSize: 12, weight: .bold)
            row.textColor = .label
            row.numberOfLines = 2
            row.backgroundColor = .tertiarySystemBackground
            row.layer.cornerRadius = 10
            row.layer.masksToBounds = true
            row.text = "  \(attachment.title) · \(attachment.fileName)"
            attachmentStack.addArrangedSubview(row)
        }
    }

    @objc private func submit() {
        let content = contentView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else {
            statusLabel.text = "\(selectedKind.contentTitle)을 입력해 주세요."
            return
        }
        saveButton.isEnabled = false
        saveButton.alpha = 0.65
        statusLabel.text = "웹 대시보드 캘린더에 등록 중입니다..."
        let entry = FieldJournalEntry(
            kind: selectedKind,
            area: selectedArea,
            occurredAt: datePicker.date,
            content: content,
            calendarURL: calendarURL,
            tagText: tagText,
            attachments: attachments
        )
        onSubmit?(entry) { [weak self] ok, message in
            guard let self else { return }
            self.saveButton.isEnabled = true
            self.saveButton.alpha = 1
            self.statusLabel.text = message
            if ok {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                    self.dismiss(animated: true)
                }
            }
        }
    }

    @objc private func close() {
        dismiss(animated: true)
    }
}

private enum DashboardLiveContentKind: Equatable {
    case typhoon
    case specialVideo

    var title: String {
        switch self {
        case .typhoon: return "태풍 진로"
        case .specialVideo: return "특보 대응 영상"
        }
    }

    var visibilityKey: String {
        switch self {
        case .typhoon: return PreviewSettingsKey.dashboardTyphoonLiveContentEnabled
        case .specialVideo: return PreviewSettingsKey.dashboardSpecialVideoLiveContentEnabled
        }
    }

    var toggleTag: Int {
        switch self {
        case .typhoon: return 0
        case .specialVideo: return 1
        }
    }

    static func from(toggleTag: Int) -> DashboardLiveContentKind? {
        switch toggleTag {
        case 0: return .typhoon
        case 1: return .specialVideo
        default: return nil
        }
    }
}

private final class DashboardLiveContentViewController: UIViewController {
    private let kind: DashboardLiveContentKind
    private let dashboardURL: String
    private let coordinate: CLLocationCoordinate2D?
    private let interfaceStyle: UIUserInterfaceStyle
    private let isEmbedded: Bool
    private let scrollView = UIScrollView()
    private let stack = UIStackView()
    private let activity = UIActivityIndicatorView(style: .medium)

    init(
        kind: DashboardLiveContentKind,
        dashboardURL: String,
        coordinate: CLLocationCoordinate2D?,
        interfaceStyle: UIUserInterfaceStyle,
        embedded: Bool = false
    ) {
        self.kind = kind
        self.dashboardURL = dashboardURL
        self.coordinate = coordinate
        self.interfaceStyle = interfaceStyle
        self.isEmbedded = embedded
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    private var isDark: Bool {
        interfaceStyle == .unspecified
            ? traitCollection.userInterfaceStyle == .dark
            : interfaceStyle == .dark
    }
    private var backgroundColor: UIColor { isDark ? UIColor(red: 0.055, green: 0.055, blue: 0.06, alpha: 1) : .systemGroupedBackground }
    private var cardColor: UIColor { isDark ? UIColor.white.withAlphaComponent(0.16) : .secondarySystemGroupedBackground }
    private var textColor: UIColor { isDark ? .white : .label }
    private var secondaryColor: UIColor { isDark ? UIColor.white.withAlphaComponent(0.78) : .secondaryLabel }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = interfaceStyle
        title = kind.title
        view.backgroundColor = backgroundColor
        if !isEmbedded {
            let close = UIBarButtonItem(image: UIImage(systemName: "xmark"), style: .plain, target: self, action: #selector(close))
            close.accessibilityLabel = "닫기"
            navigationItem.leftBarButtonItem = close
        }
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .refresh,
            target: self,
            action: #selector(refresh)
        )
        configureLayout()
        refresh()
    }

    private func configureLayout() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.showsVerticalScrollIndicator = true
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 12
        scrollView.addSubview(stack)
        view.addSubview(scrollView)
        activity.translatesAutoresizingMaskIntoConstraints = false
        activity.hidesWhenStopped = true
        view.addSubview(activity)
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -24),
            activity.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activity.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 10)
        ])
    }

    @objc private func refresh() {
        stack.arrangedSubviews.forEach {
            stack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        activity.startAnimating()
        stack.addArrangedSubview(stateCard(symbol: "arrow.clockwise", title: "관제 대시보드 최신 정보 확인 중", detail: "캐시를 사용하지 않고 실시간 응답을 요청합니다."))
        switch kind {
        case .typhoon:
            requestJSON(path: "/api/typhoon") { [weak self] result in
                DispatchQueue.main.async { self?.renderTyphoon(result) }
            }
        case .specialVideo:
            refreshSpecialVideo()
        }
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    private func refreshSpecialVideo() {
        let point = coordinate ?? CLLocationCoordinate2D(latitude: 35.14817, longitude: 126.91910)
        requestJSON(path: "/api/kma-warning?lat=\(point.latitude)&lon=\(point.longitude)") { [weak self] warningResult in
            guard let self else { return }
            let warning = warningResult.value
            let activeWarning = self.firstDictionary(in: warning?["warnings"])
                ?? self.firstDictionary(in: warning?["preliminary"])
            let type = self.string(in: activeWarning, keys: ["type", "title", "name"])
                ?? "태풍"
            let kind = self.string(in: activeWarning, keys: ["kind"]) == "preliminary" ? "preliminary" : "warning"
            let encodedType = type.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "태풍"
            self.requestJSON(path: "/api/youtube-warning-videos?type=\(encodedType)&kind=\(kind)") { [weak self] videoResult in
                DispatchQueue.main.async { self?.renderSpecialVideo(warning: warningResult, videos: videoResult, queryType: type) }
            }
        }
    }

    private func requestJSON(path: String, completion: @escaping ((value: [String: Any]?, error: String?)) -> Void) {
        guard let url = URL(string: dashboardURL + path) else {
            completion((nil, "잘못된 관제 대시보드 URL"))
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        URLSession.shared.dataTask(with: request) { data, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard error == nil, (200..<300).contains(code), let data,
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let dict = object as? [String: Any] else {
                completion((nil, error?.localizedDescription ?? "관제 API 응답 없음 (HTTP \(code))"))
                return
            }
            completion((dict, nil))
        }.resume()
    }

    private func renderTyphoon(_ result: (value: [String: Any]?, error: String?)) {
        finishRendering()
        guard let data = result.value else {
            stack.addArrangedSubview(stateCard(symbol: "exclamationmark.triangle", title: "태풍 진로를 불러오지 못했습니다", detail: result.error ?? "관제 웹 응답을 확인하세요."))
            return
        }
        let name = string(in: data, keys: ["name"]) ?? "발효 중인 태풍 없음"
        let sequence = string(in: data, keys: ["seq"]).map { "제\($0)호 " } ?? ""
        let source = string(in: data, keys: ["source"]) ?? "unknown"
        let issuedAt = string(in: data, keys: ["tmFc"]) ?? "발표 시각 미수신"
        stack.addArrangedSubview(heroCard(
            symbol: "tropicalstorm",
            title: "\(sequence)\(name)",
            subtitle: "기상청 관제 데이터 · \(issuedAt)",
            badge: source == "live" ? "실시간" : source
        ))

        let track = dictionaries(in: data["track"])
        guard !track.isEmpty else {
            stack.addArrangedSubview(stateCard(symbol: "tropicalstorm", title: "현재 발효 중인 태풍 진로 없음", detail: "관제 대시보드가 반환한 실제 상태입니다."))
            stack.addArrangedSubview(sourceFooter("\(dashboardURL)/api/typhoon"))
            return
        }
        let currentIndex = int(in: data, key: "currentIndex") ?? max(0, track.count - 1)
        let current = track[min(max(0, currentIndex), track.count - 1)]
        let metrics = UIStackView(arrangedSubviews: [
            metricCard(title: "중심기압", value: value(in: current, keys: ["pressureHpa"]), unit: "hPa"),
            metricCard(title: "최대풍속", value: value(in: current, keys: ["maxWindMs"]), unit: "m/s"),
            metricCard(title: "이동", value: string(in: current, keys: ["dir"]) ?? "--", unit: value(in: current, keys: ["speedKmh"]) + "km/h")
        ])
        metrics.translatesAutoresizingMaskIntoConstraints = false
        metrics.axis = .horizontal
        metrics.spacing = 8
        metrics.distribution = .fillEqually
        stack.addArrangedSubview(metrics)
        stack.addArrangedSubview(trackCard(track, currentIndex: currentIndex))
        stack.addArrangedSubview(sourceFooter("\(dashboardURL)/api/typhoon · \(source)"))
    }

    private func renderSpecialVideo(warning: (value: [String: Any]?, error: String?), videos: (value: [String: Any]?, error: String?), queryType: String) {
        finishRendering()
        let warningData = warning.value
        let summary = string(in: warningData, keys: ["summary", "preliminarySummary"]) ?? "현장 특보 상태 미수신"
        let severity = string(in: warningData, keys: ["severity", "preliminarySeverity"]) ?? "normal"
        stack.addArrangedSubview(heroCard(
            symbol: "exclamationmark.video.fill",
            title: "\(queryType) 관제 대응 영상",
            subtitle: summary,
            badge: severity == "danger" ? "위험" : "관제 확인"
        ))
        let warnings = dictionaries(in: warningData?["warnings"]) + dictionaries(in: warningData?["preliminary"])
        if !warnings.isEmpty {
            let warningLines = warnings.map { item in
                let type = string(in: item, keys: ["type", "title", "name"]) ?? "특보"
                let detail = string(in: item, keys: ["summary", "area", "region", "message"]) ?? "관제 웹 특보"
                return "\(type) · \(detail)"
            }
            stack.addArrangedSubview(textCard(title: "기상특보", lines: warningLines, symbol: "exclamationmark.triangle.fill"))
        } else {
            stack.addArrangedSubview(textCard(title: "기상특보", lines: ["현재 현장 발효 특보 없음", "관제 웹의 태풍 대응 공식 영상을 함께 확인할 수 있습니다."], symbol: "checkmark.shield.fill"))
        }
        let videoItems = dictionaries(in: videos.value?["videos"])
        if videoItems.isEmpty {
            stack.addArrangedSubview(stateCard(symbol: "video", title: "관련 공식 영상 없음", detail: videos.error ?? string(in: videos.value, keys: ["note", "error"]) ?? "관제 웹이 반환한 영상 목록이 비어 있습니다."))
        } else {
            stack.addArrangedSubview(sectionTitle("관제 대시보드 공식 영상 \(videoItems.count)개"))
            videoItems.forEach { stack.addArrangedSubview(videoButton($0)) }
        }
        stack.addArrangedSubview(sourceFooter("\(dashboardURL)/api/kma-warning · /api/youtube-warning-videos"))
    }

    private func finishRendering() {
        activity.stopAnimating()
        stack.arrangedSubviews.forEach {
            stack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
    }

    private func heroCard(symbol: String, title: String, subtitle: String, badge: String) -> UIView {
        let icon = UIImageView(image: UIImage(systemName: symbol))
        icon.tintColor = .systemOrange
        icon.contentMode = .scaleAspectFit
        icon.widthAnchor.constraint(equalToConstant: 30).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 30).isActive = true
        let titleLabel = text(title, size: 19, weight: .bold, color: textColor)
        let subtitleLabel = text(subtitle, size: 12, weight: .medium, color: secondaryColor)
        subtitleLabel.numberOfLines = 2
        let labels = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel])
        labels.axis = .vertical
        labels.spacing = 3
        let tag = text(badge, size: 11, weight: .bold, color: .white)
        tag.textAlignment = .center
        tag.backgroundColor = .systemOrange
        tag.layer.cornerRadius = 11
        tag.clipsToBounds = true
        tag.widthAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true
        tag.heightAnchor.constraint(equalToConstant: 26).isActive = true
        let row = UIStackView(arrangedSubviews: [icon, labels, tag])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 12
        labels.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return card([row])
    }

    private func metricCard(title: String, value: String, unit: String) -> UIView {
        let titleLabel = text(title, size: 10, weight: .semibold, color: secondaryColor)
        let valueLabel = text(value, size: 17, weight: .bold, color: textColor)
        let unitLabel = text(unit, size: 9, weight: .medium, color: secondaryColor)
        let valueRow = UIStackView(arrangedSubviews: [valueLabel, unitLabel])
        valueRow.axis = .horizontal
        valueRow.alignment = .lastBaseline
        valueRow.spacing = 3
        let box = card([titleLabel, valueRow])
        box.heightAnchor.constraint(equalToConstant: 66).isActive = true
        return box
    }

    private func trackCard(_ track: [[String: Any]], currentIndex: Int) -> UIView {
        let rows = track.enumerated().map { index, item -> UIView in
            let marker = UIView()
            marker.backgroundColor = index == currentIndex ? .systemRed : .systemBlue
            marker.layer.cornerRadius = 4
            marker.widthAnchor.constraint(equalToConstant: 8).isActive = true
            marker.heightAnchor.constraint(equalToConstant: 8).isActive = true
            let time = text(string(in: item, keys: ["tm"]) ?? "--", size: 11, weight: .bold, color: textColor)
            let location = text("\(value(in: item, keys: ["lat"])), \(value(in: item, keys: ["lon"]))", size: 10, weight: .medium, color: secondaryColor)
            let detail = text("\(string(in: item, keys: ["dir"]) ?? "--") · \(value(in: item, keys: ["speedKmh"]))km/h", size: 10, weight: .medium, color: secondaryColor)
            let row = UIStackView(arrangedSubviews: [marker, time, location, detail])
            row.axis = .horizontal
            row.alignment = .center
            row.spacing = 8
            location.setContentHuggingPriority(.defaultLow, for: .horizontal)
            detail.setContentHuggingPriority(.required, for: .horizontal)
            return row
        }
        let title = sectionTitle("관제 대시보드 진로 시점")
        let stack = UIStackView(arrangedSubviews: [title] + rows)
        stack.axis = .vertical
        stack.spacing = 9
        return card([stack])
    }

    private func videoButton(_ item: [String: Any]) -> UIButton {
        let title = string(in: item, keys: ["title"]) ?? "관제 영상"
        let channel = string(in: item, keys: ["channelTitle"]) ?? "공식 채널"
        let published = string(in: item, keys: ["publishedAt"]) ?? ""
        var configuration = UIButton.Configuration.tinted()
        configuration.image = UIImage(systemName: "play.rectangle.fill")
        configuration.imagePlacement = .leading
        configuration.imagePadding = 12
        configuration.title = title
        configuration.subtitle = [channel, published].filter { !$0.isEmpty }.joined(separator: " · ")
        configuration.titleAlignment = .leading
        configuration.baseBackgroundColor = isDark ? UIColor.white.withAlphaComponent(0.12) : .systemBackground
        configuration.baseForegroundColor = textColor
        configuration.cornerStyle = .medium
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
        let button = UIButton(configuration: configuration)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.contentHorizontalAlignment = .leading
        button.titleLabel?.numberOfLines = 2
        button.accessibilityLabel = title
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 62).isActive = true
        if let identifier = string(in: item, keys: ["id"]), let url = URL(string: "https://www.youtube.com/watch?v=\(identifier)") {
            button.addAction(UIAction { [weak self] _ in
                let safari = SFSafariViewController(url: url)
                safari.preferredControlTintColor = .systemBlue
                self?.present(safari, animated: true)
            }, for: .touchUpInside)
        }
        return button
    }

    private func textCard(title: String, lines: [String], symbol: String) -> UIView {
        let icon = UIImageView(image: UIImage(systemName: symbol))
        icon.tintColor = .systemOrange
        icon.widthAnchor.constraint(equalToConstant: 18).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 18).isActive = true
        let titleLabel = text(title, size: 13, weight: .bold, color: textColor)
        let titleRow = UIStackView(arrangedSubviews: [icon, titleLabel])
        titleRow.axis = .horizontal
        titleRow.alignment = .center
        titleRow.spacing = 8
        let labels = lines.map { line -> UILabel in
            let label = text(line, size: 11, weight: .medium, color: secondaryColor)
            label.numberOfLines = 2
            return label
        }
        let column = UIStackView(arrangedSubviews: [titleRow] + labels)
        column.axis = .vertical
        column.spacing = 7
        return card([column])
    }

    private func stateCard(symbol: String, title: String, detail: String) -> UIView {
        textCard(title: title, lines: [detail], symbol: symbol)
    }

    private func sectionTitle(_ value: String) -> UILabel {
        text(value, size: 13, weight: .bold, color: textColor)
    }

    private func sourceFooter(_ value: String) -> UILabel {
        let label = text(value, size: 10, weight: .medium, color: secondaryColor)
        label.numberOfLines = 2
        label.textAlignment = .center
        return label
    }

    private func card(_ views: [UIView]) -> UIStackView {
        let box = UIStackView(arrangedSubviews: views)
        box.translatesAutoresizingMaskIntoConstraints = false
        box.axis = .vertical
        box.spacing = 8
        box.isLayoutMarginsRelativeArrangement = true
        box.layoutMargins = UIEdgeInsets(top: 13, left: 14, bottom: 13, right: 14)
        box.backgroundColor = cardColor
        box.layer.cornerRadius = 16
        box.layer.cornerCurve = .continuous
        box.layer.borderWidth = 1
        box.layer.borderColor = (isDark ? UIColor.white.withAlphaComponent(0.14) : UIColor.separator.withAlphaComponent(0.45)).cgColor
        return box
    }

    private func text(_ value: String, size: CGFloat, weight: UIFont.Weight, color: UIColor) -> UILabel {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = value
        label.font = UIFont.systemFont(ofSize: size, weight: weight)
        label.textColor = color
        return label
    }

    private func dictionaries(in value: Any?) -> [[String: Any]] {
        value as? [[String: Any]] ?? []
    }

    private func firstDictionary(in value: Any?) -> [String: Any]? {
        dictionaries(in: value).first
    }

    private func string(in dictionary: [String: Any]?, keys: [String]) -> String? {
        guard let dictionary else { return nil }
        for key in keys {
            if let value = dictionary[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return value }
            if let value = dictionary[key] as? NSNumber { return "\(value)" }
        }
        return nil
    }

    private func value(in dictionary: [String: Any], keys: [String]) -> String {
        string(in: dictionary, keys: keys) ?? "--"
    }

    private func int(in dictionary: [String: Any], key: String) -> Int? {
        if let number = dictionary[key] as? NSNumber { return number.intValue }
        if let string = dictionary[key] as? String { return Int(string) }
        return nil
    }
}

private final class ExpandedGlassTabBar: UITabBar {
    private let preferredHeight: CGFloat = 84

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        var fittedSize = super.sizeThatFits(size)
        fittedSize.height = max(fittedSize.height, preferredHeight)
        return fittedSize
    }
}

final class VitAlGuardPreviewController: UIViewController,
    UIImagePickerControllerDelegate,
    UINavigationControllerDelegate,
    VNDocumentCameraViewControllerDelegate,
    UIDocumentPickerDelegate,
    CLLocationManagerDelegate,
    AVCaptureMetadataOutputObjectsDelegate,
    NFCNDEFReaderSessionDelegate,
    ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    enum ScanMode {
        case none
        case documentOCR
        case mediaPhoto
        case mediaVideo

        var scanType: String {
            switch self {
            case .documentOCR:
                return "document"
            case .mediaPhoto:
                return "photo"
            case .mediaVideo:
                return "video"
            case .none:
                return "none"
            }
        }
    }

    private typealias WatchVital = (title: String, value: String, unit: String, color: UIColor)

    private let workers: [(String, String, String, String, UIColor)] = [
        ("대기", "김도윤", "--", "--", UIColor(red: 0.439, green: 0.439, blue: 0.447, alpha: 1.0)),
        ("대기", "박서연", "--", "--", UIColor(red: 0.439, green: 0.439, blue: 0.447, alpha: 1.0)),
        ("대기", "이하준", "--", "--", UIColor(red: 0.439, green: 0.439, blue: 0.447, alpha: 1.0))
    ]
    private let cameras: [(String, String, String, UIColor)] = [
        ("크레인 작업구역", "CCTV-04 · 위험 · 작업자 38명", "위험", UIColor(red: 0.83, green: 0.00, blue: 0.02, alpha: 1.0)),
        ("북문 게이트", "CCTV-01 · 주의 · 작업자 진입 24명", "주의", UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0)),
        ("AED 보관함", "CCTV-08 · 연결 · 작업자 12명", "연결", UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)),
        ("자재 반입구", "CCTV-06 · 정상 · 작업자 7명", "LIVE", UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0))
    ]
    private var watchVitals: [WatchVital] {
        let snapshot = PhoneMeasuredVitalSnapshot.current
        let heartRate = snapshot.formattedInt("heartRate", unit: "bpm")
        let spo2 = snapshot.formattedInt("spo2", unit: "%")
        let ecg = snapshot.stringValue("ecgStatus").map { ($0, "") } ?? ("--", "")
        let steps = snapshot.formattedInt("steps", unit: "보")
        let altitude = snapshot.formattedDouble("relativeAltitudeMeters", unit: "m")
        let pressure = snapshot.formattedDouble("barometricPressureKPa", unit: "kPa")
        let acceleration = snapshot.formattedDouble("accelerationMagnitudeG", unit: "G", digits: 2)
        let hrv = snapshot.formattedDouble("hrvSdnnMs", unit: "ms", digits: 0)
        let energy = snapshot.formattedDouble("activeEnergyKcal", unit: "kcal", digits: 0)
        let exercise = snapshot.formattedDouble("exerciseTimeMinutes", unit: "분", digits: 0)
        let stand = snapshot.formattedDouble("standTimeMinutes", unit: "분", digits: 0)
        let respiratory = snapshot.formattedDouble("respiratoryRate", unit: "/분")
        let sleepApnea = snapshot.stringValue("sleepingBreathingDisturbancesClassification")
            ?? snapshot.stringValue("sleepApneaRisk")
            ?? "--"
        let wristTemperature = snapshot.formattedWristTemperature(unit: "℃")
        var vitals: [WatchVital] = [
            ("심박", heartRate.value, heartRate.unit, UIColor(red: 0.83, green: 0.00, blue: 0.02, alpha: 1.0)),
            ("SpO₂", spo2.value, spo2.unit, UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)),
            ("ECG", ecg.0, ecg.1, UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0)),
            ("손목 온도", wristTemperature.value, wristTemperature.unit, UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0))
        ]
        if let systolic = snapshot.intValue("bloodPressureSystolic"),
           let diastolic = snapshot.intValue("bloodPressureDiastolic") {
            vitals.append(("혈압/고혈압", "\(systolic)/\(diastolic)", "mmHg", UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0)))
        }
        vitals.append(contentsOf: [
            ("걸음 수", steps.value, steps.unit, UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0)),
            ("고도", altitude.value, altitude.unit, UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)),
            ("기압", pressure.value, pressure.unit, UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)),
            ("가속도", acceleration.value, acceleration.unit, UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0)),
            ("HRV", hrv.value, hrv.unit, UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0)),
            ("활동량", energy.value, energy.unit, UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0)),
            ("운동 링", exercise.value, exercise.unit, UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0)),
            ("서기 링", stand.value, stand.unit, UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0)),
            ("호흡", respiratory.value, respiratory.unit, UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)),
            ("수면 무호흡", sleepApnea, "", sleepApnea == "높음" ? UIColor(red: 0.83, green: 0.00, blue: 0.02, alpha: 1.0) : UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0))
        ])
        return vitals
    }
    private let nearbyCameras: [(String, String, String, UIColor)] = [
        ("내 위치 근처", "CCTV-04 · 38m", "LIVE", UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0)),
        ("크레인 작업구역", "CCTV-07 · 92m", "주의", UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0)),
        ("AED 보관함", "CCTV-08 · 126m", "연결", UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0))
    ]

    private let ink = UIColor(red: 0.067, green: 0.067, blue: 0.067, alpha: 1.0)
    private let canvas = UIColor.white
    private let softCloud = UIColor(red: 0.949, green: 0.957, blue: 0.969, alpha: 1.0)
    private let mute = UIColor(red: 0.27, green: 0.27, blue: 0.30, alpha: 1.0)
    private let stone = UIColor(red: 0.82, green: 0.82, blue: 0.84, alpha: 1.0)
    private let hairline = UIColor(red: 0.88, green: 0.89, blue: 0.91, alpha: 1.0)
    private let sale = UIColor(red: 0.827, green: 0.0, blue: 0.02, alpha: 1.0)
    private let charcoal = UIColor(red: 0.13, green: 0.13, blue: 0.14, alpha: 1.0)
    private let glassLight = UIColor.white.withAlphaComponent(0.92)
    private let glassDark = UIColor.white.withAlphaComponent(0.16)
    private let watermarkLocationManager = CLLocationManager()
    private let watermarkGeocoder = CLGeocoder()
    private let watermarkCacheQueue = DispatchQueue(label: "com.vitalguard.watermark-cache", qos: .utility)
    private let naverWeatherURL = URL(string: "https://weather.naver.com/today/05110525")!
    private var locationWeather = LocationWeatherSummary(
        place: "광주 북구 현장 A",
        temperature: "--℃",
        detail: "새로고침을 누르면 관제 대시보드 기준 GPS 위치 날씨 정보를 불러옵니다.",
        safety: "작업안전: 위치 확인 대기",
        naverQuery: "광주 북구 현장 A"
    )
    private var isWeatherRefreshPending = false
    private var lastKnownWatermarkLocation: CLLocation?
    private var cachedWeatherKitSummary: (key: String, fetchedAt: Date, summary: LocationWeatherSummary)?
    private var cachedWatermarkAddress: String?
    private var cachedWatermarkCoordinate: CLLocationCoordinate2D?
    private var dashboardCCTVFeeds: [DashboardCCTVFeed] = []
    private var lastCCTVRefreshAt: Date?
    private var traitRegistration: UITraitChangeRegistration?
    private let loginField = UITextField()
    private let passwordField = UITextField()
    private weak var rootScrollView: UIScrollView?
    private var pendingScrollOffsetToRestore: CGPoint?
    private weak var cctvRefreshControl: UIRefreshControl?
    private weak var watchRefreshControl: UIRefreshControl?
    private weak var loginPanelView: UIView?
    private weak var activeJournalEditor: FieldJournalEntryViewController?
    private weak var activeCalendarCommentComposer: CalendarCommentComposerViewController?
    private var keyboardOverlap: CGFloat = 0
    private var dashboardSyncTimer: Timer?
    private var dashboardSyncTimerInterval: TimeInterval?
    private var lastLocationDashboardSyncAt: Date?
    private var pendingScanMode: ScanMode = .none
    private var pendingJournalAttachmentMode: ScanMode = .none
    private var isJournalFileImportActive = false
    private var isStandaloneFileUploadActive = false
    private var isPhotoLibraryUploadActive = false
    private var pendingExportCompletionTitle: String?
    private var nfcReaderSession: NFCNDEFReaderSession?
    private var pendingNFCRequestId: String?
    private var qrCaptureSession: AVCaptureSession?
    private var qrScannerOverlay: UIView?
    private var activeMainTab: MainTab = .home
    private var isCCTVVideoEnabled = UserDefaults.standard.object(forKey: PreviewSettingsKey.cctvVideoEnabled) as? Bool ?? true
    private var cctvSortMode = CCTVSortMode(rawValue: UserDefaults.standard.string(forKey: PreviewSettingsKey.cctvSortMode) ?? "") ?? .numberAscending
    private var cctvCustomOrder = UserDefaults.standard.stringArray(forKey: PreviewSettingsKey.cctvCustomOrder) ?? []
    private var isLiveActivityEnabled = UserDefaults.standard.object(forKey: PreviewSettingsKey.liveActivityEnabled) as? Bool ?? true
    private var dashboardWeatherPageIndex = 0
    private weak var dashboardInlineLiveContentController: DashboardLiveContentViewController?
    private var dashboardRadarFrameIndex = 2
    private var dashboardWeatherMapLayer: WeatherMapLayer = .precipitation
    private var dashboardRadarIsPlaying = false
    private var dashboardRadarTimer: Timer?
    private var dashboardHomeSummaryTimer: Timer?
    private var dashboardConnectionTimer: Timer?
    private var dashboardConnectionState: DashboardConnectionState = .delayed
    private var isDashboardConnectionCheckInFlight = false
    private var dashboardConnectionLastCheckedAt: Date?
    private var dashboardConnectionLastStatusCode: Int?
    private var dashboardConnectionLastLatency: TimeInterval?
    private var dashboardConnectionLastError: String?
    private var dashboardHomeSummarySnapshot: DashboardHomeSummarySnapshot?
    private var isDashboardHomeSummaryRefreshInFlight = false
    private var lastDashboardHomeSummaryRefreshAt: Date?
    private var hasAttemptedDashboardSummaryTokenRefresh = false
    private var dashboardHomeSummaryError: String?
    private var isUploadBusy = false
    private var isLoginRequestInFlight = false
    private static var didShowIntroGuideThisLaunch = false
    private static var isIntroGuideMutedForThisLaunch = false
    private var didAttemptIntroGuidePresentation = false
    override func viewDidLoad() {
        super.viewDidLoad()
        migrateLegacySyncIntervalIfNeeded()
        migrateEnergyEfficiencyDefaultsIfNeeded()
        watermarkLocationManager.delegate = self
        watermarkLocationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        watermarkLocationManager.activityType = .other
        watermarkLocationManager.distanceFilter = 100
        watermarkLocationManager.pausesLocationUpdatesAutomatically = true
        if #available(iOS 11.0, *) {
            watermarkLocationManager.showsBackgroundLocationIndicator = false
            watermarkLocationManager.allowsBackgroundLocationUpdates = false
        }
        requestLocationPermissionForWatermark()
        applySavedTheme()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(showWatchLoginApprovalMessage),
            name: PhoneWatchBridge.didApproveWatchLoginNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWatchVitalsUpdated(_:)),
            name: PhoneWatchBridge.didReceiveWatchVitalsNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWatchNFCScanRequest(_:)),
            name: PhoneWatchBridge.didRequestWatchNFCScanNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChangeFrame),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(consumePendingQuickAction),
            name: .vitalGuardQuickActionRequested,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleIntroGuideModeChanged),
            name: .vitalGuardIntroGuideModeChanged,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleFallResponseRequested(_:)),
            name: .vitalGuardFallResponseRequested,
            object: nil
        )
        buildInterface()
        if #available(iOS 17.0, *) {
            traitRegistration = registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (controller: VitAlGuardPreviewController, _) in
                controller.applySavedTheme()
                controller.buildInterface()
            }
        }
        consumePendingQuickAction()
    }

    // 이전 빌드는 iPhone→Watch 주기를 60초 이상으로 강제했다. 이번 실시간 관제 전환 시
    // 그 강제값만 한 번 10초로 이관하며, 사용자가 이후 설정한 값은 그대로 보존한다.
    private func migrateLegacySyncIntervalIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: PreviewSettingsKey.realTimeSyncMigration) else { return }
        if let saved = defaults.object(forKey: PreviewSettingsKey.syncInterval) as? Double,
           (60...120).contains(saved.rounded()) {
            defaults.set(10.0, forKey: PreviewSettingsKey.syncInterval)
        }
        defaults.set(true, forKey: PreviewSettingsKey.realTimeSyncMigration)
    }

    /// 이전 기본값(균형/10초)은 센서와 네트워크를 상시 깨웠다.
    /// 사용자가 별도로 고른 값은 보존하고 과거 기본값만 한 번 배터리 우선값으로 이관한다.
    private func migrateEnergyEfficiencyDefaultsIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: PreviewSettingsKey.energyEfficiencyMigration) else { return }
        let savedMode = defaults.string(forKey: PreviewSettingsKey.sensorPowerMode)
        if savedMode == nil || savedMode == SensorPowerMode.balanced.rawValue {
            defaults.set(SensorPowerMode.lowPower.rawValue, forKey: PreviewSettingsKey.sensorPowerMode)
        }
        let savedInterval = defaults.object(forKey: PreviewSettingsKey.syncInterval) as? Double
        if savedInterval == nil || savedInterval?.rounded() == 10 {
            defaults.set(300.0, forKey: PreviewSettingsKey.syncInterval)
        }
        defaults.set(true, forKey: PreviewSettingsKey.energyEfficiencyMigration)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        presentIntroGuideIfNeeded()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        watermarkLocationManager.stopUpdatingLocation()
        dashboardRadarTimer?.invalidate()
        dashboardHomeSummaryTimer?.invalidate()
        dashboardConnectionTimer?.invalidate()
    }

    private var savedThemeMode: PreviewThemeMode {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.themeMode) ?? PreviewThemeMode.system.rawValue
        return PreviewThemeMode(rawValue: raw) ?? .system
    }

    private func applySavedTheme() {
        overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        view.window?.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
    }

    private var isDark: Bool {
        switch savedThemeMode {
        case .dark:
            return true
        case .light:
            return false
        case .system:
            return traitCollection.userInterfaceStyle == .dark
        }
    }

    private var pageColor: UIColor {
        isDark ? ink : softCloud
    }

    private var textColor: UIColor {
        isDark ? canvas : ink
    }

    private var secondaryTextColor: UIColor {
        isDark ? stone : mute
    }

    private var tileColor: UIColor {
        isDark ? UIColor.white.withAlphaComponent(0.18) : UIColor.white.withAlphaComponent(0.94)
    }

    private var currentMode: AppMode {
        let raw = VitAlGuardSharedStorage.loadAppMode()?.rawValue
            ?? UserDefaults.standard.string(forKey: PreviewSettingsKey.appMode)
            ?? AppMode.worker.rawValue
        return AppMode(rawValue: raw) ?? .admin
    }

    private var loggedInID: String? {
        guard !UserDefaults.standard.bool(forKey: PreviewSettingsKey.forceSignedOut) else {
            return nil
        }
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.loggedInId)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return raw?.isEmpty == false ? raw : nil
    }

    private var glassFill: UIColor {
        isDark ? glassDark : glassLight
    }

    private var glassStroke: UIColor {
        isDark ? UIColor.white.withAlphaComponent(0.23) : hairline
    }

    private var weatherSafetyColor: UIColor {
        locationWeather.safety.contains("위험") ? sale : UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0)
    }

    private var workerSubtitle: String {
        let defaults = UserDefaults.standard
        let name = defaults.string(forKey: PreviewSettingsKey.workerName)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let employeeId = defaults.string(forKey: PreviewSettingsKey.employeeId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let prefix = [name, employeeId].filter { !$0.isEmpty }.joined(separator: " · ")
        if currentMode == .admin {
            return "작업자 생체 관제 · CCTV · 작업구역 기상 연결됨"
        }
        return prefix.isEmpty ? "Watch 데이터 · 기상 · 근처 CCTV 연결됨" : "\(prefix) · Watch 데이터 연결됨"
    }

    private var endpointText: String {
        DashboardSyncService.shared.normalizedEndpoint(from: UserDefaults.standard.string(forKey: PreviewSettingsKey.endpoint))
    }

    private var syncIntervalSeconds: Int {
        let raw = UserDefaults.standard.object(forKey: PreviewSettingsKey.syncInterval) as? Double ?? 300
        return Int(min(3599, max(5, raw)).rounded())
    }

    private var formattedSyncInterval: String {
        if syncIntervalSeconds >= 60 {
            let minutes = syncIntervalSeconds / 60
            let seconds = syncIntervalSeconds % 60
            return seconds == 0 ? "\(minutes)분" : "\(minutes)분 \(seconds)초"
        }
        return "\(syncIntervalSeconds)초"
    }

    private var lastWatchSyncText: String {
        let snapshot = PhoneMeasuredVitalSnapshot.current
        guard snapshot.receivedAt > Date.distantPast else {
            return "수동 업데이트 대기"
        }
        let date = snapshot.receivedAt
        let seconds = max(0, Int(Date().timeIntervalSince(date)))
        return seconds < 60 ? "\(seconds)초 전 업데이트" : "\(seconds / 60)분 전 업데이트"
    }

    private var watchDeviceDisplayText: String {
        let snapshot = PhoneMeasuredVitalSnapshot.current
        let name = snapshot.stringValue("watchDeviceName")
        let localizedModel = snapshot.stringValue("watchDeviceLocalizedModel")
        let model = snapshot.stringValue("watchDeviceModel")
        let systemVersion = snapshot.stringValue("watchSystemVersion")
        let device = [name, localizedModel, model]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty && $0 != "Apple Watch" }
            ?? localizedModel
            ?? model
            ?? "Apple Watch"
        if let systemVersion, !systemVersion.isEmpty {
            return "\(device) · watchOS \(systemVersion)"
        }
        return device
    }

    private func buildInterface() {
        HomeSection.migrateAdminDefaultIfNeeded()
        applySavedTheme()
        removeDashboardInlineLiveContent()
        let previousOffset = pendingScrollOffsetToRestore ?? rootScrollView?.contentOffset
        pendingScrollOffsetToRestore = nil
        let shouldRestoreScroll = loggedInID != nil && previousOffset != nil
        view.subviews.forEach { $0.removeFromSuperview() }
        view.backgroundColor = pageColor

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.keyboardDismissMode = .interactive
        rootScrollView = scroll
        view.addSubview(scroll)
        cctvRefreshControl = nil
        watchRefreshControl = nil
        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = textColor
        refreshControl.attributedTitle = NSAttributedString(
            string: refreshTitle(for: activeMainTab),
            attributes: [
                .foregroundColor: secondaryTextColor,
                .font: UIFont.systemFont(ofSize: 12, weight: .semibold)
            ]
        )
        refreshControl.addTarget(self, action: #selector(refreshCurrentTabFromPull(_:)), for: .valueChanged)
        scroll.refreshControl = refreshControl
        if activeMainTab == .cctv { cctvRefreshControl = refreshControl }
        if activeMainTab == .watch { watchRefreshControl = refreshControl }

        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 6
        scroll.addSubview(stack)

        let shouldShowHeader = loggedInID != nil
        if shouldShowHeader {
            let stickyHeader = UIView()
            stickyHeader.translatesAutoresizingMaskIntoConstraints = false
            stickyHeader.backgroundColor = pageColor
            view.addSubview(stickyHeader)

            let fixedHeader = utilityHeader()
            stickyHeader.addSubview(fixedHeader)

            NSLayoutConstraint.activate([
                stickyHeader.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                stickyHeader.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                stickyHeader.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                stickyHeader.heightAnchor.constraint(equalToConstant: 90),
                fixedHeader.topAnchor.constraint(equalTo: stickyHeader.topAnchor, constant: 4),
                fixedHeader.leadingAnchor.constraint(equalTo: stickyHeader.leadingAnchor, constant: 18),
                fixedHeader.trailingAnchor.constraint(equalTo: stickyHeader.trailingAnchor, constant: -18),
                fixedHeader.bottomAnchor.constraint(equalTo: stickyHeader.bottomAnchor, constant: -4)
            ])

            NSLayoutConstraint.deactivate([
                scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
            ])
            if loggedInID != nil {
                let tabBar = bottomMenuBar()
                view.addSubview(tabBar)
                NSLayoutConstraint.activate([
                    // iOS 기본 Liquid Glass의 가시 영역을 현황 요약 카드 안의
                    // 둥근 사각형 기준선과 겹치도록 맞춘다.
                    tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: -1),
                    tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: 2),
                    tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -12),
                    tabBar.heightAnchor.constraint(equalToConstant: 84),
                    scroll.topAnchor.constraint(equalTo: stickyHeader.bottomAnchor),
                    scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                    scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                    scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                    stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 4),
                    stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 18),
                    stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -18),
                    stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -110)
                ])
            } else {
                NSLayoutConstraint.activate([
                    scroll.topAnchor.constraint(equalTo: stickyHeader.bottomAnchor),
                    scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                    scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                    scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                    stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
                    stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 18),
                    stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -18),
                    stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -28)
                ])
            }
        } else {
            NSLayoutConstraint.activate([
                scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
                stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 18),
                stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -18),
                stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -28)
            ])
        }

        guard loggedInID != nil else {
            stopDashboardAutoSync()
            stack.addArrangedSubview(loginPosterPanel())
            stack.setCustomSpacing(8, after: stack.arrangedSubviews.last ?? stack)
            stack.addArrangedSubview(loginPanel())
            VitAlGuardRuntimeTranslator.shared.localize(view: view)
            return
        }

        startDashboardAutoSyncIfNeeded()
        startDashboardConnectionMonitorIfNeeded()
        refreshLiveActivity()
        refreshDashboardCCTVIfNeeded()
        refreshDashboardHomeSummaryIfNeeded()
        if activeMainTab == .home, dashboardWeatherPageIndex == 0 {
            startDashboardHomeSummaryTimerIfNeeded()
        } else {
            stopDashboardHomeSummaryTimer()
        }
        if activeMainTab == .settings {
            stack.addArrangedSubview(settingsTabPanel())
            stack.addArrangedSubview(currentMode == .admin ? actionPanel() : workerActionPanel())
        } else {
            if activeMainTab == .home {
                stack.addArrangedSubview(sessionPanel())
            }
            for section in activeMainTab.sections(for: currentMode) {
                stack.addArrangedSubview(homeSectionView(for: section))
            }
            if activeMainTab == .watch {
                stack.addArrangedSubview(emergencyActionBar())
            }
        }

        if shouldRestoreScroll, let previousOffset {
            DispatchQueue.main.async { [weak self, weak scroll] in
                guard let self, let scroll, scroll.window != nil else { return }
                self.view.layoutIfNeeded()
                let minY = -scroll.adjustedContentInset.top
                let maxY = max(minY, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
                let restoredY = min(max(previousOffset.y, minY), maxY)
                scroll.setContentOffset(CGPoint(x: previousOffset.x, y: restoredY), animated: false)
            }
        }
        VitAlGuardRuntimeTranslator.shared.localize(view: view)
    }

    private func rebuildInterfacePreservingScrollPosition() {
        pendingScrollOffsetToRestore = rootScrollView?.contentOffset
        buildInterface()
    }

    private func homeSectionView(for section: HomeSection) -> UIView {
        switch section {
        case .safetySignal:
            return campaignTile()
        case .siteWeather:
            return siteWeatherPanel()
        case .adminWatch:
            return watchDataPanel(title: "실시간 Watch 데이터", subtitle: "관리자 관제 · \(watchDeviceDisplayText) · \(lastWatchSyncText)")
        case .metrics:
            return metricsGrid()
        case .workers:
            return workerPanel()
        case .cctv:
            return cctvPanel()
        case .adminAppleHealth:
            return appleHealthWalletPanel(mode: .admin)
        case .dashboardWeather:
            return dashboardWeatherPanel()
        case .adminActions:
            return actionPanel()
        case .workerSafety:
            return workerSafetySummary()
        case .workerWatch:
            return workerWatchPanel()
        case .workerAppleHealth:
            return appleHealthWalletPanel(mode: .worker)
        case .workerWeather:
            return workerWeatherPanel()
        case .nearbyCctv:
            return workerNearbyCctvPanel()
        case .workerDashboardWeather:
            return dashboardWeatherPanel()
        case .workerActions:
            return workerActionPanel()
        }
    }

    private func bottomMenuBar() -> UIView {
        // iOS 26·27의 시스템 Liquid Glass와 선택 애니메이션은 UIKit의 표준
        // UITabBar에 맡긴다. 앱은 색상·배경을 별도로 그리지 않는다.
        let tabBar = ExpandedGlassTabBar()
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.tintColor = .systemBlue
        tabBar.unselectedItemTintColor = isDark
            ? UIColor.white.withAlphaComponent(0.74)
            : UIColor.secondaryLabel

        let appearance = UITabBarAppearance()
        appearance.configureWithDefaultBackground()
        tabBar.standardAppearance = appearance
        tabBar.scrollEdgeAppearance = appearance

        let items = MainTab.allCases.enumerated().map { index, tab -> UITabBarItem in
            let image = UIImage(systemName: tab.symbol)
            let item = UITabBarItem(title: tab.title, image: image, selectedImage: image)
            item.tag = index
            return item
        }
        tabBar.setItems(items, animated: false)
        tabBar.selectedItem = items.first { $0.tag == MainTab.allCases.firstIndex(of: activeMainTab) }
        return tabBar
    }

    private func tabSelectionIndicatorImage() -> UIImage {
        let size = CGSize(width: 104, height: 72)
        let format = UIGraphicsImageRendererFormat()
        format.scale = UIScreen.main.scale
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            let rect = CGRect(x: 4, y: 9, width: size.width - 8, height: size.height - 18)
            let path = UIBezierPath(roundedRect: rect, cornerRadius: rect.height / 2)
            (isDark ? UIColor.black.withAlphaComponent(0.58) : UIColor.black.withAlphaComponent(0.18)).setFill()
            path.fill()
        }.withRenderingMode(.alwaysOriginal)
    }

    private func menuButton(for tab: MainTab) -> UIButton {
        let selected = tab == activeMainTab
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        var config = UIButton.Configuration.plain()
        config.image = UIImage(systemName: tab.symbol)
        config.imagePlacement = .top
        config.imagePadding = 2
        config.title = tab.title
        config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 23, weight: selected ? .bold : .semibold)
        config.baseForegroundColor = selected
            ? UIColor(red: 0.05, green: 0.60, blue: 1.0, alpha: 1.0)
            : secondaryTextColor
        config.contentInsets = NSDirectionalEdgeInsets(top: 5, leading: 2, bottom: 4, trailing: 2)
        button.configuration = config
        button.titleLabel?.font = UIFont.systemFont(ofSize: 11, weight: selected ? .bold : .semibold)
        button.tintColor = config.baseForegroundColor
        button.backgroundColor = .clear
        button.layer.backgroundColor = UIColor.clear.cgColor
        button.layer.shadowOpacity = 0
        button.accessibilityLabel = tab.title
        button.accessibilityTraits = selected ? [.button, .selected] : .button
        button.addTarget(self, action: #selector(selectMainTab(_:)), for: .touchUpInside)
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        return button
    }

    @objc private func selectMainTab(_ sender: UIButton) {
        let tabs = MainTab.allCases
        guard tabs.indices.contains(sender.tag) else { return }
        activeMainTab = tabs[sender.tag]
        buildInterface()
    }

    private func settingsTabPanel() -> UIView {
        let panel = panelView(height: 286)
        let title = label("설정", size: 22, weight: .black, color: textColor)
        let sub = label("계정, GPS 항상 허용, Watch 주기, 워터마크, 대시보드 URL을 한 곳에서 조정합니다.", size: 12, weight: .semibold, color: secondaryTextColor)
        sub.numberOfLines = 2
        let theme = capabilityChip(title: "화면", value: savedThemeMode.title, symbol: "circle.lefthalf.filled", tint: UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0))
        let gps = capabilityChip(title: "GPS", value: "항상 허용", symbol: "location.fill", tint: UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0))
        let chips = UIStackView(arrangedSubviews: [theme, gps])
        chips.translatesAutoresizingMaskIntoConstraints = false
        chips.axis = .horizontal
        chips.spacing = 8
        chips.distribution = .fillEqually
        let open = buttonPillForActionRow("설정 열기", foreground: canvas, background: ink)
        open.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        let layout = buttonPillForActionRow("홈 섹션 순서", foreground: textColor, background: tileColor)
        layout.addTarget(self, action: #selector(openHomeLayout), for: .touchUpInside)

        panel.addSubview(title)
        panel.addSubview(sub)
        panel.addSubview(chips)
        panel.addSubview(open)
        panel.addSubview(layout)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 20),
            title.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            title.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            sub.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            sub.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            chips.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            chips.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            chips.topAnchor.constraint(equalTo: sub.bottomAnchor, constant: 16),
            chips.heightAnchor.constraint(equalToConstant: 48),
            open.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            open.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            open.topAnchor.constraint(equalTo: chips.bottomAnchor, constant: 14),
            open.heightAnchor.constraint(equalToConstant: 42),
            layout.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            layout.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            layout.topAnchor.constraint(equalTo: open.bottomAnchor, constant: 9),
            layout.heightAnchor.constraint(equalToConstant: 42),
            layout.bottomAnchor.constraint(lessThanOrEqualTo: panel.bottomAnchor, constant: -18)
        ])
        return panel
    }

    private func utilityHeader() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        AppleDesignGlass.apply(
            to: wrapper,
            cornerRadius: 30,
            tint: isDark ? UIColor.white.withAlphaComponent(0.07) : UIColor.white.withAlphaComponent(0.18),
            isInteractive: false
        )

        let mark = logoImageButton()
        let title = label(currentMode == .admin ? "VitAlGuard 관리자" : "VitAlGuard 근로자", size: 22, weight: .black, color: textColor)
        let subtitle = label(workerSubtitle, size: 12, weight: .semibold, color: secondaryTextColor)
        let calendar = iconPill(symbol: "calendar", foreground: textColor, background: tileColor, width: 44)
        calendar.accessibilityLabel = "관제 캘린더 열기"
        calendar.addTarget(self, action: #selector(openDashboardCalendar), for: .touchUpInside)
        let notifications = iconPill(symbol: "bell.fill", foreground: textColor, background: tileColor, width: 44)
        notifications.accessibilityLabel = "VitAlGuard 알림"
        notifications.addTarget(self, action: #selector(showDashboardAlerts), for: .touchUpInside)
        let localAlertCount = unreadLocalAlertsCount()
        let notificationBadge = UILabel()
        notificationBadge.translatesAutoresizingMaskIntoConstraints = false
        notificationBadge.text = localAlertCount > 99 ? "99+" : "\(localAlertCount)"
        notificationBadge.textColor = .white
        notificationBadge.textAlignment = .center
        notificationBadge.font = UIFont.systemFont(ofSize: 10, weight: .black)
        notificationBadge.backgroundColor = .systemRed
        notificationBadge.layer.cornerRadius = 9
        notificationBadge.clipsToBounds = true
        notificationBadge.isHidden = localAlertCount == 0
        mark.addTarget(self, action: #selector(openScanMenu), for: .touchUpInside)

        let actionStack = UIStackView(arrangedSubviews: [calendar, notifications])
        actionStack.translatesAutoresizingMaskIntoConstraints = false
        actionStack.axis = .horizontal
        actionStack.spacing = 8
        actionStack.alignment = .center

        wrapper.addSubview(mark)
        wrapper.addSubview(title)
        wrapper.addSubview(subtitle)
        wrapper.addSubview(actionStack)
        wrapper.addSubview(notificationBadge)

        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 78),
            mark.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 10),
            mark.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor),
            title.leadingAnchor.constraint(equalTo: mark.trailingAnchor, constant: 12),
            title.trailingAnchor.constraint(lessThanOrEqualTo: actionStack.leadingAnchor, constant: -10),
            title.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor, constant: -9),
            subtitle.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            subtitle.trailingAnchor.constraint(lessThanOrEqualTo: actionStack.leadingAnchor, constant: -10),
            subtitle.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 2),
            actionStack.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -10),
            actionStack.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor),
            notificationBadge.topAnchor.constraint(equalTo: notifications.topAnchor, constant: 4),
            notificationBadge.trailingAnchor.constraint(equalTo: notifications.trailingAnchor, constant: -4),
            notificationBadge.widthAnchor.constraint(greaterThanOrEqualToConstant: 18),
            notificationBadge.heightAnchor.constraint(equalToConstant: 18)
        ])
        return wrapper
    }

    private func loginPanel() -> UIView {
        let panel = panelView(height: 452)
        loginPanelView = panel
        let mark = logoBox(size: 58, cornerRadius: 18, bleed: 5)
        let title = label("VitAlGuard", size: 28, weight: .black, color: textColor)
        let subtitle = label("Industrial Safety OS", size: 13, weight: .bold, color: secondaryTextColor)
        let prompt = label("대시보드 계정 로그인", size: 17, weight: .black, color: textColor)
        let hint = label("관제웹 계정 ID와 비밀번호를 입력하세요.", size: 12, weight: .semibold, color: secondaryTextColor)
        let input = loginInput()
        let password = passwordInput()
        let signup = buttonPillForActionRow("회원가입", foreground: textColor, background: tileColor)
        signup.addTarget(self, action: #selector(openSignup), for: .touchUpInside)
        signup.accessibilityLabel = "회원가입 버튼"

        let login = buttonPillForActionRow("로그인", foreground: canvas, background: ink)
        login.addTarget(self, action: #selector(loginWithID), for: .touchUpInside)
        login.accessibilityLabel = "로그인 버튼"
        let appleLogin = buttonPillForActionRow("Apple로 로그인", foreground: canvas, background: UIColor.black)
        appleLogin.addTarget(self, action: #selector(loginWithAppleID), for: .touchUpInside)
        appleLogin.accessibilityLabel = "Apple로 로그인 버튼"
        let googleLogin = buttonPillForActionRow("Google로 로그인", foreground: textColor, background: tileColor)
        googleLogin.addTarget(self, action: #selector(loginWithGoogle), for: .touchUpInside)
        googleLogin.accessibilityLabel = "Google로 로그인 버튼"

        let actionRow = UIStackView(arrangedSubviews: [signup, login])
        actionRow.translatesAutoresizingMaskIntoConstraints = false
        actionRow.axis = .horizontal
        actionRow.spacing = 12
        actionRow.distribution = .fillEqually
        let socialRow = UIStackView(arrangedSubviews: [appleLogin, googleLogin])
        socialRow.translatesAutoresizingMaskIntoConstraints = false
        socialRow.axis = .horizontal
        socialRow.spacing = 12
        socialRow.distribution = .fillEqually

        panel.addSubview(mark)
        panel.addSubview(title)
        panel.addSubview(subtitle)
        panel.addSubview(prompt)
        panel.addSubview(input)
        panel.addSubview(password)
        panel.addSubview(hint)
        panel.addSubview(actionRow)
        panel.addSubview(socialRow)

        NSLayoutConstraint.activate([
            mark.topAnchor.constraint(equalTo: panel.topAnchor, constant: 18),
            mark.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
            title.topAnchor.constraint(equalTo: mark.bottomAnchor, constant: 10),
            title.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
            title.leadingAnchor.constraint(greaterThanOrEqualTo: panel.leadingAnchor, constant: 18),
            title.trailingAnchor.constraint(lessThanOrEqualTo: panel.trailingAnchor, constant: -18),
            subtitle.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 2),
            subtitle.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
            prompt.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 22),
            prompt.topAnchor.constraint(equalTo: subtitle.bottomAnchor, constant: 22),
            input.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 22),
            input.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -22),
            input.topAnchor.constraint(equalTo: prompt.bottomAnchor, constant: 10),
            password.leadingAnchor.constraint(equalTo: input.leadingAnchor),
            password.trailingAnchor.constraint(equalTo: input.trailingAnchor),
            password.topAnchor.constraint(equalTo: input.bottomAnchor, constant: 10),
            hint.leadingAnchor.constraint(equalTo: input.leadingAnchor),
            hint.trailingAnchor.constraint(equalTo: input.trailingAnchor),
            hint.topAnchor.constraint(equalTo: password.bottomAnchor, constant: 7),
            actionRow.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 22),
            actionRow.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -22),
            actionRow.topAnchor.constraint(equalTo: hint.bottomAnchor, constant: 14),
            actionRow.heightAnchor.constraint(equalToConstant: 44),
            socialRow.leadingAnchor.constraint(equalTo: actionRow.leadingAnchor),
            socialRow.trailingAnchor.constraint(equalTo: actionRow.trailingAnchor),
            socialRow.topAnchor.constraint(equalTo: actionRow.bottomAnchor, constant: 10),
            socialRow.heightAnchor.constraint(equalToConstant: 42)
        ])
        return panel
    }

    private func loginPosterPanel() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: wrapper, cornerRadius: 28, fill: glassFill, borderColor: glassStroke)

        let imageView = UIImageView(image: UIImage(named: "IMG_E4667") ?? Bundle.main.path(forResource: "IMG_E4667", ofType: "jpg").flatMap { UIImage(contentsOfFile: $0) })
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFit
        imageView.clipsToBounds = true
        imageView.layer.cornerRadius = 22
        imageView.layer.cornerCurve = .continuous
        imageView.backgroundColor = isDark ? UIColor.black.withAlphaComponent(0.18) : UIColor.white.withAlphaComponent(0.45)

        wrapper.addSubview(imageView)

        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 382),
            imageView.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 8),
            imageView.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 8),
            imageView.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -8),
            imageView.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -8)
        ])
        return wrapper
    }

    private func loginInput() -> UIView {
        loginField.translatesAutoresizingMaskIntoConstraints = false
        loginField.textColor = textColor
        loginField.tintColor = textColor
        loginField.placeholder = "관리자 ID 또는 근로자 ID"
        loginField.font = UIFont.systemFont(ofSize: 17, weight: .bold)
        loginField.autocapitalizationType = .none
        loginField.autocorrectionType = .no
        loginField.clearButtonMode = .whileEditing
        loginField.returnKeyType = .next
        loginField.textContentType = .username
        loginField.keyboardType = .emailAddress
        loginField.addTarget(self, action: #selector(focusPasswordField), for: .primaryActionTriggered)
        loginField.addTarget(self, action: #selector(loginFieldDidBeginEditing), for: .editingDidBegin)

        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: wrapper, cornerRadius: 26, fill: glassFill, borderColor: glassStroke)
        wrapper.addSubview(loginField)
        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 56),
            loginField.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 18),
            loginField.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -18),
            loginField.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor)
        ])
        return wrapper
    }

    private func passwordInput() -> UIView {
        passwordField.translatesAutoresizingMaskIntoConstraints = false
        passwordField.textColor = textColor
        passwordField.tintColor = textColor
        passwordField.placeholder = "비밀번호"
        passwordField.font = UIFont.systemFont(ofSize: 17, weight: .bold)
        passwordField.autocapitalizationType = .none
        passwordField.autocorrectionType = .no
        passwordField.clearButtonMode = .whileEditing
        passwordField.returnKeyType = .go
        passwordField.textContentType = .password
        passwordField.isSecureTextEntry = true
        passwordField.addTarget(self, action: #selector(loginWithID), for: .primaryActionTriggered)
        passwordField.addTarget(self, action: #selector(loginFieldDidBeginEditing), for: .editingDidBegin)

        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: wrapper, cornerRadius: 26, fill: glassFill, borderColor: glassStroke)
        wrapper.addSubview(passwordField)
        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 56),
            passwordField.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 18),
            passwordField.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -18),
            passwordField.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor)
        ])
        return wrapper
    }

    private func sessionPanel() -> UIView {
        let panel = panelView(height: 128)
        let modeText = currentMode == .admin ? "관리자 모드" : "근로자 모드"
        let id = label(loggedInID ?? "-", size: 12, weight: .black, color: textColor)
        let mode = label(modeText, size: 11, weight: .black, color: currentMode == .admin ? UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0) : UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0))
        let connection = dashboardConnectionBadge()
        let notice = scanGuideBadge()
        let infoStack = UIStackView(arrangedSubviews: [connection, id, mode, notice])
        infoStack.translatesAutoresizingMaskIntoConstraints = false
        infoStack.axis = .vertical
        infoStack.spacing = 4
        infoStack.alignment = .leading
        let syncButton = dualIconPill(symbols: ["applewatch", "arrow.clockwise"], foreground: textColor, background: tileColor, width: 58)
        syncButton.accessibilityLabel = "Apple Watch 업데이트"
        syncButton.addTarget(self, action: #selector(manualWatchSync), for: .touchUpInside)
        let logoutButton = iconPill(symbol: "rectangle.portrait.and.arrow.right", foreground: textColor, background: tileColor, width: 50)
        logoutButton.accessibilityLabel = "로그아웃"
        logoutButton.accessibilityIdentifier = "logoutButton"
        logoutButton.addAction(UIAction { [weak self] _ in
            self?.logoutSession()
        }, for: .touchUpInside)
        logoutButton.addAction(UIAction { [weak self] _ in
            self?.logoutSession()
        }, for: .primaryActionTriggered)
        let liveLabel = label("Live Activity", size: 10, weight: .black, color: secondaryTextColor)
        liveLabel.textAlignment = .center
        liveLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
        liveLabel.setContentHuggingPriority(.required, for: .horizontal)
        let liveToggle = liveActivityToggle()
        liveToggle.widthAnchor.constraint(equalToConstant: 116).isActive = true
        liveToggle.heightAnchor.constraint(equalToConstant: 34).isActive = true
        let buttonRow = UIStackView(arrangedSubviews: [syncButton, logoutButton])
        buttonRow.translatesAutoresizingMaskIntoConstraints = false
        buttonRow.axis = .horizontal
        buttonRow.spacing = 6
        buttonRow.alignment = .center
        let actionColumn = UIStackView(arrangedSubviews: [buttonRow, liveLabel, liveToggle])
        actionColumn.translatesAutoresizingMaskIntoConstraints = false
        actionColumn.axis = .vertical
        actionColumn.spacing = 4
        actionColumn.alignment = .center

        panel.addSubview(infoStack)
        panel.addSubview(actionColumn)

        NSLayoutConstraint.activate([
            infoStack.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            infoStack.trailingAnchor.constraint(lessThanOrEqualTo: actionColumn.leadingAnchor, constant: -8),
            infoStack.centerYAnchor.constraint(equalTo: actionColumn.centerYAnchor),
            actionColumn.topAnchor.constraint(greaterThanOrEqualTo: panel.topAnchor, constant: 12),
            actionColumn.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            actionColumn.centerYAnchor.constraint(equalTo: panel.centerYAnchor),
            actionColumn.bottomAnchor.constraint(lessThanOrEqualTo: panel.bottomAnchor, constant: -12)
        ])
        return panel
    }

    private func dashboardConnectionBadge() -> UIView {
        let badge = UIControl()
        badge.translatesAutoresizingMaskIntoConstraints = false
        badge.backgroundColor = dashboardConnectionState.color.withAlphaComponent(isDark ? 0.16 : 0.12)
        badge.layer.cornerRadius = 13
        badge.layer.cornerCurve = .continuous
        badge.layer.borderColor = dashboardConnectionState.color.withAlphaComponent(0.92).cgColor
        badge.layer.borderWidth = 1.2
        badge.addTarget(self, action: #selector(presentDashboardConnectionDetail), for: .touchUpInside)

        let lights = trafficLight(activeIndex: dashboardConnectionState.activeIndex)
        let text = label(dashboardConnectionState.title, size: 10, weight: .black, color: dashboardConnectionState.color)
        text.numberOfLines = 1
        text.setContentCompressionResistancePriority(.required, for: .horizontal)

        badge.addSubview(lights)
        badge.addSubview(text)

        NSLayoutConstraint.activate([
            badge.heightAnchor.constraint(equalToConstant: 28),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 150),
            lights.leadingAnchor.constraint(equalTo: badge.leadingAnchor, constant: 10),
            lights.centerYAnchor.constraint(equalTo: badge.centerYAnchor),
            text.leadingAnchor.constraint(equalTo: lights.trailingAnchor, constant: 7),
            text.trailingAnchor.constraint(equalTo: badge.trailingAnchor, constant: -10),
            text.centerYAnchor.constraint(equalTo: badge.centerYAnchor)
        ])
        badge.accessibilityLabel = "\(dashboardConnectionState.title), \(dashboardConnectionState.detail)"
        badge.accessibilityTraits.insert(.button)
        return badge
    }

    private func scanGuideBadge() -> UIView {
        let badge = UIView()
        badge.translatesAutoresizingMaskIntoConstraints = false
        badge.backgroundColor = UIColor(red: 1.0, green: 0.18, blue: 0.58, alpha: isDark ? 0.20 : 0.12)
        badge.layer.cornerRadius = 12
        badge.layer.cornerCurve = .continuous
        badge.layer.borderColor = UIColor(red: 1.0, green: 0.18, blue: 0.58, alpha: 0.92).cgColor
        badge.layer.borderWidth = 1.2

        let icon = UIImageView(image: UIImage(systemName: "camera.viewfinder"))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.tintColor = UIColor(red: 1.0, green: 0.18, blue: 0.58, alpha: 1.0)
        icon.contentMode = .scaleAspectFit
        let text = label("로고를 누르면 문서 스캔·사진·비디오 촬영", size: 9, weight: .black, color: textColor)
        text.numberOfLines = 1
        text.minimumScaleFactor = 0.7

        badge.addSubview(icon)
        badge.addSubview(text)

        NSLayoutConstraint.activate([
            badge.heightAnchor.constraint(equalToConstant: 26),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 186),
            icon.leadingAnchor.constraint(equalTo: badge.leadingAnchor, constant: 9),
            icon.centerYAnchor.constraint(equalTo: badge.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 13),
            icon.heightAnchor.constraint(equalToConstant: 13),
            text.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 5),
            text.trailingAnchor.constraint(equalTo: badge.trailingAnchor, constant: -9),
            text.centerYAnchor.constraint(equalTo: badge.centerYAnchor)
        ])
        badge.accessibilityLabel = "로고를 누르면 문서 스캔, 사진 촬영, 비디오 촬영 메뉴가 열립니다."
        return badge
    }

    private func dualIconPill(symbols: [String], foreground: UIColor, background: UIColor, width: CGFloat) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.tintColor = foreground
        button.backgroundColor = .clear
        AppleDesignGlass.apply(to: button, cornerRadius: 22, tint: background, isInteractive: true)
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.spacing = 4
        stack.alignment = .center
        stack.isUserInteractionEnabled = false
        symbols.forEach { symbol in
            let imageView = UIImageView(image: UIImage(systemName: symbol))
            imageView.translatesAutoresizingMaskIntoConstraints = false
            imageView.tintColor = foreground
            imageView.contentMode = .scaleAspectFit
            imageView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 14, weight: .black)
            NSLayoutConstraint.activate([
                imageView.widthAnchor.constraint(equalToConstant: 17),
                imageView.heightAnchor.constraint(equalToConstant: 17)
            ])
            stack.addArrangedSubview(imageView)
        }
        button.addSubview(stack)
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: width),
            button.heightAnchor.constraint(equalToConstant: 44),
            stack.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: button.centerYAnchor)
        ])
        return button
    }

    private func modeSwitcher() -> UIView {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: container, cornerRadius: 26, fill: glassFill, borderColor: glassStroke)

        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.spacing = 8
        stack.distribution = .fillEqually

        let admin = modeButton("관리자", mode: .admin)
        let worker = modeButton("근로자", mode: .worker)
        stack.addArrangedSubview(admin)
        stack.addArrangedSubview(worker)
        container.addSubview(stack)

        NSLayoutConstraint.activate([
            container.heightAnchor.constraint(equalToConstant: 58),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 7),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 7),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -7),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -7)
        ])
        return container
    }

    private func modeButton(_ title: String, mode: AppMode) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle(title, for: .normal)
        button.setTitleColor(currentMode == mode ? canvas : textColor, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .black)
        button.layer.cornerRadius = 20
        button.layer.cornerCurve = .continuous
        button.backgroundColor = currentMode == mode ? ink : UIColor.clear
        button.layer.borderColor = glassStroke.cgColor
        button.layer.borderWidth = currentMode == mode ? 0 : 1
        switch mode {
        case .admin:
            button.addTarget(self, action: #selector(setAdminMode), for: .touchUpInside)
        case .worker:
            button.addTarget(self, action: #selector(setWorkerMode), for: .touchUpInside)
        }
        return button
    }

    private func campaignTile() -> UIView {
        let tile = UIView()
        tile.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(
            to: tile,
            cornerRadius: 24,
            fill: isDark ? charcoal.withAlphaComponent(0.88) : UIColor.white.withAlphaComponent(0.78),
            borderColor: glassStroke
        )

        let title = label("현장 통합 안전 신호등", size: 13, weight: .black, color: textColor)
        let overall = label("종합", size: 11, weight: .bold, color: secondaryTextColor)
        let status = label("위험", size: 11, weight: .black, color: sale)
        let lights = trafficLight(activeIndex: 2)

        let rows = UIStackView()
        rows.translatesAutoresizingMaskIntoConstraints = false
        rows.axis = .vertical
        rows.spacing = 4
        rows.distribution = .fillEqually
        rows.addArrangedSubview(safetySignalRow(icon: "cloud.sun", title: "현장 기상", state: "대기", detail: "현장 GPS 대기 · 작업자 GPS 수신 시 자동 평가", statusColor: secondaryTextColor, statusLevel: 0, kind: .weather))
        rows.addArrangedSubview(safetySignalRow(icon: "person.2", title: "작업자", state: "대기", detail: "작업자 대기 · 작업자 등록 대기", statusColor: secondaryTextColor, statusLevel: 0, kind: .workers))
        rows.addArrangedSubview(safetySignalRow(icon: "wind", title: "가스 감지", state: "위험", detail: "CO 52ppm · 탱크 야드 · 산소보안 방해", statusColor: sale, statusLevel: 2, kind: .gas))
        rows.addArrangedSubview(safetySignalRow(icon: "heart.text.square", title: "AED", state: "위험", detail: "단말 배터리 부족 · 지하 주차장 B1 · 2건", statusColor: sale, statusLevel: 2, kind: .aed))

        tile.addSubview(title)
        tile.addSubview(overall)
        tile.addSubview(lights)
        tile.addSubview(status)
        tile.addSubview(rows)

        NSLayoutConstraint.activate([
            tile.heightAnchor.constraint(equalToConstant: 126),
            title.topAnchor.constraint(equalTo: tile.topAnchor, constant: 11),
            title.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 14),
            title.trailingAnchor.constraint(lessThanOrEqualTo: overall.leadingAnchor, constant: -12),
            overall.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            lights.leadingAnchor.constraint(equalTo: overall.trailingAnchor, constant: 5),
            lights.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            status.leadingAnchor.constraint(equalTo: lights.trailingAnchor, constant: 5),
            status.trailingAnchor.constraint(equalTo: tile.trailingAnchor, constant: -14),
            status.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            rows.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 6),
            rows.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 10),
            rows.trailingAnchor.constraint(equalTo: tile.trailingAnchor, constant: -10),
            rows.bottomAnchor.constraint(equalTo: tile.bottomAnchor, constant: -9)
        ])
        return tile
    }

    private func trafficLight(activeIndex: Int) -> UIView {
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.spacing = 3
        let colors = [
            UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0),
            UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0),
            sale
        ]
        colors.enumerated().forEach { index, color in
            let dot = UIView()
            dot.translatesAutoresizingMaskIntoConstraints = false
            dot.backgroundColor = index == activeIndex ? color : color.withAlphaComponent(isDark ? 0.30 : 0.18)
            dot.layer.cornerRadius = 4
            NSLayoutConstraint.activate([
                dot.widthAnchor.constraint(equalToConstant: 8),
                dot.heightAnchor.constraint(equalToConstant: 8)
            ])
            stack.addArrangedSubview(dot)
        }
        return stack
    }

    private func safetySignalRow(icon: String, title: String, state: String, detail: String, statusColor: UIColor, statusLevel: Int, kind: SafetySignalKind) -> UIView {
        let row = UIControl()
        row.translatesAutoresizingMaskIntoConstraints = false
        row.backgroundColor = isDark ? UIColor.white.withAlphaComponent(0.035) : UIColor.white.withAlphaComponent(0.72)
        row.layer.cornerRadius = 9
        row.layer.cornerCurve = .continuous
        row.layer.borderColor = (isDark ? UIColor.white.withAlphaComponent(0.08) : UIColor.black.withAlphaComponent(0.055)).cgColor
        row.layer.borderWidth = 0.6
        row.tag = kind.rawValue
        row.accessibilityLabel = "\(title) 상세 보기"
        row.accessibilityIdentifier = "safetySignal.\(kind.title)"
        row.isAccessibilityElement = true
        row.accessibilityTraits = [.button]
        row.addTarget(self, action: #selector(openSafetySignalDetail(_:)), for: .touchUpInside)

        let image = UIImageView(image: UIImage(systemName: icon))
        image.translatesAutoresizingMaskIntoConstraints = false
        image.tintColor = secondaryTextColor
        image.contentMode = .scaleAspectFit
        let titleLabel = label(title, size: 11, weight: .black, color: textColor)
        let statusLight = trafficLight(activeIndex: statusLevel)
        let stateLabel = label(state, size: 10, weight: .black, color: statusColor)
        let detailLabel = label(detail, size: 9, weight: .semibold, color: secondaryTextColor)

        row.addSubview(image)
        row.addSubview(titleLabel)
        row.addSubview(statusLight)
        row.addSubview(stateLabel)
        row.addSubview(detailLabel)

        NSLayoutConstraint.activate([
            image.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 9),
            image.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            image.widthAnchor.constraint(equalToConstant: 15),
            image.heightAnchor.constraint(equalToConstant: 15),
            titleLabel.leadingAnchor.constraint(equalTo: image.trailingAnchor, constant: 7),
            titleLabel.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            titleLabel.widthAnchor.constraint(equalToConstant: 58),
            statusLight.leadingAnchor.constraint(equalTo: titleLabel.trailingAnchor, constant: 5),
            statusLight.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            stateLabel.leadingAnchor.constraint(equalTo: statusLight.trailingAnchor, constant: 6),
            stateLabel.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            stateLabel.widthAnchor.constraint(equalToConstant: 30),
            detailLabel.leadingAnchor.constraint(equalTo: stateLabel.trailingAnchor, constant: 6),
            detailLabel.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -8),
            detailLabel.centerYAnchor.constraint(equalTo: row.centerYAnchor)
        ])
        return row
    }

    @objc private func openSafetySignalDetail(_ sender: UIControl) {
        guard let kind = SafetySignalKind(rawValue: sender.tag) else { return }
        let detail = SafetySignalDetailViewController(kind: kind, interfaceStyle: savedThemeMode.interfaceStyle)
        let nav = UINavigationController(rootViewController: detail)
        nav.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    private func metricsGrid() -> UIView {
        let row = UIStackView()
        row.translatesAutoresizingMaskIntoConstraints = false
        row.axis = .horizontal
        row.spacing = 8
        row.distribution = .fillEqually

        let snapshot = PhoneMeasuredVitalSnapshot.current
        let heartRate = snapshot.formattedInt("heartRate", unit: "bpm")
        let spo2 = snapshot.formattedInt("spo2", unit: "%")
        let wristTemperature = snapshot.formattedWristTemperature(unit: "℃")
        row.addArrangedSubview(metric("심박", heartRate.value, heartRate.unit, sale))
        row.addArrangedSubview(metric("SpO₂", spo2.value, spo2.unit, UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)))
        row.addArrangedSubview(metric("손목 온도", wristTemperature.value, wristTemperature.unit, UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0)))

        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        wrapper.addSubview(row)
        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 104),
            row.topAnchor.constraint(equalTo: wrapper.topAnchor),
            row.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            row.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor)
        ])
        return wrapper
    }

    private func siteWeatherPanel() -> UIView {
        weatherPanel(titleText: "작업 구역 기상", fallbackLocation: "광주 북구 전체 작업 구역")
    }

    private func workerPanel() -> UIView {
        let panel = panelView(height: 256)
        let title = label("작업자 모니터링", size: 20, weight: .black, color: textColor)
        let sub = label("Worker grid", size: 12, weight: .semibold, color: secondaryTextColor)
        panel.addSubview(title)
        panel.addSubview(sub)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 18),
            title.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            sub.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            sub.centerYAnchor.constraint(equalTo: title.centerYAnchor)
        ])

        var previous: UIView = title
        for worker in workers {
            let row = workerRow(status: worker.0, name: worker.1, hr: worker.2, spo2: worker.3, color: worker.4)
            panel.addSubview(row)
            NSLayoutConstraint.activate([
                row.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
                row.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
                row.topAnchor.constraint(equalTo: previous.bottomAnchor, constant: previous === title ? 18 : 8),
                row.heightAnchor.constraint(equalToConstant: 54)
            ])
            previous = row
        }
        return panel
    }

    private func cctvPanel() -> UIView {
        let feeds = displayedCCTVFeeds(admin: true)
        let rowCount = max(1, Int(ceil(Double(feeds.count) / 2.0)))
        let panel = panelView(height: CGFloat(146 + rowCount * 148))
        let title = label("현장 CCTV", size: 20, weight: .black, color: textColor)
        let toggle = cctvVideoToggle()
        let refreshButton = cctvRefreshButton()
        let sortButton = cctvSortButton()
        let sub = label(isCCTVVideoEnabled ? cctvSortMode.title : "영상 꺼짐", size: 11, weight: .semibold, color: secondaryTextColor)
        sub.textAlignment = .center
        let sortStack = UIStackView(arrangedSubviews: [sortButton, sub])
        sortStack.translatesAutoresizingMaskIntoConstraints = false
        sortStack.axis = .vertical
        sortStack.spacing = 3
        sortStack.alignment = .center
        panel.addSubview(title)
        panel.addSubview(toggle)
        panel.addSubview(refreshButton)
        panel.addSubview(sortStack)
        let statusBox = cctvStatusBox(count: feeds.count, admin: true)
        panel.addSubview(statusBox)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 20),
            title.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            toggle.centerYAnchor.constraint(equalTo: title.centerYAnchor, constant: 2),
            toggle.centerXAnchor.constraint(equalTo: panel.centerXAnchor, constant: -2),
            toggle.widthAnchor.constraint(equalToConstant: 118),
            toggle.heightAnchor.constraint(equalToConstant: 38),
            refreshButton.leadingAnchor.constraint(equalTo: toggle.trailingAnchor, constant: 8),
            refreshButton.centerYAnchor.constraint(equalTo: toggle.centerYAnchor),
            refreshButton.widthAnchor.constraint(equalToConstant: 32),
            refreshButton.heightAnchor.constraint(equalToConstant: 32),
            sortStack.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            sortStack.leadingAnchor.constraint(greaterThanOrEqualTo: refreshButton.trailingAnchor, constant: 6),
            sortStack.centerYAnchor.constraint(equalTo: title.centerYAnchor, constant: 1),
            sortButton.widthAnchor.constraint(equalToConstant: 28),
            sortButton.heightAnchor.constraint(equalToConstant: 24),
            statusBox.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            statusBox.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            statusBox.topAnchor.constraint(equalTo: toggle.bottomAnchor, constant: 16),
            statusBox.heightAnchor.constraint(equalToConstant: 50)
        ])

        let grid = UIStackView()
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.axis = .vertical
        grid.spacing = 8
        panel.addSubview(grid)

        if feeds.isEmpty {
            let row = cctvEmptyRow()
            grid.addArrangedSubview(row)
            row.heightAnchor.constraint(equalToConstant: 132).isActive = true
        } else {
            for index in stride(from: 0, to: feeds.count, by: 2) {
                let rowStack = UIStackView()
                rowStack.axis = .horizontal
                rowStack.spacing = 8
                rowStack.distribution = .fillEqually
                rowStack.translatesAutoresizingMaskIntoConstraints = false
                rowStack.addArrangedSubview(cameraRow(feed: feeds[index]))
                if feeds.indices.contains(index + 1) {
                    rowStack.addArrangedSubview(cameraRow(feed: feeds[index + 1]))
                } else {
                    rowStack.addArrangedSubview(UIView())
                }
                grid.addArrangedSubview(rowStack)
                rowStack.heightAnchor.constraint(equalToConstant: 140).isActive = true
            }
        }
        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            grid.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            grid.topAnchor.constraint(equalTo: statusBox.bottomAnchor, constant: 12),
            grid.bottomAnchor.constraint(lessThanOrEqualTo: panel.bottomAnchor, constant: -16)
        ])
        return panel
    }

    private func workerSafetySummary() -> UIView {
        let tile = UIView()
        tile.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(
            to: tile,
            cornerRadius: 34,
            fill: isDark ? charcoal.withAlphaComponent(0.88) : UIColor.white.withAlphaComponent(0.72),
            borderColor: glassStroke
        )

        let eyebrow = pill("MY SAFETY", foreground: isDark ? canvas : ink, background: isDark ? glassDark : glassLight, width: 104)
        let score = label("86", size: 46, weight: .black, color: isDark ? canvas : ink)
        let title = label("작업 안전지수", size: 15, weight: .black, color: secondaryTextColor)
        let status = label("정상 · 수분 보충 권장", size: 13, weight: .black, color: UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0))
        let cta = pill("관리자 호출", foreground: canvas, background: ink, width: 108)
        let alert = label("주의 알림 1", size: 12, weight: .black, color: sale)

        tile.addSubview(eyebrow)
        tile.addSubview(score)
        tile.addSubview(title)
        tile.addSubview(status)
        tile.addSubview(cta)
        tile.addSubview(alert)

        NSLayoutConstraint.activate([
            tile.heightAnchor.constraint(equalToConstant: 156),
            eyebrow.topAnchor.constraint(equalTo: tile.topAnchor, constant: 12),
            eyebrow.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 16),
            score.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 16),
            score.topAnchor.constraint(equalTo: eyebrow.bottomAnchor, constant: 8),
            title.leadingAnchor.constraint(equalTo: score.trailingAnchor, constant: 10),
            title.trailingAnchor.constraint(lessThanOrEqualTo: tile.trailingAnchor, constant: -16),
            title.lastBaselineAnchor.constraint(equalTo: score.lastBaselineAnchor, constant: -8),
            status.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 16),
            status.topAnchor.constraint(equalTo: score.bottomAnchor, constant: 2),
            status.trailingAnchor.constraint(lessThanOrEqualTo: tile.trailingAnchor, constant: -16),
            status.bottomAnchor.constraint(lessThanOrEqualTo: cta.topAnchor, constant: -5),
            cta.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 16),
            cta.bottomAnchor.constraint(equalTo: tile.bottomAnchor, constant: -10),
            alert.trailingAnchor.constraint(equalTo: tile.trailingAnchor, constant: -16),
            alert.leadingAnchor.constraint(greaterThanOrEqualTo: cta.trailingAnchor, constant: 12),
            alert.centerYAnchor.constraint(equalTo: cta.centerYAnchor)
        ])
        return tile
    }

    private func workerWatchPanel() -> UIView {
        watchDataPanel(title: "Watch 연동 데이터", subtitle: "\(watchDeviceDisplayText) · \(lastWatchSyncText)")
    }

    private func watchDataPanel(title titleText: String, subtitle subtitleText: String) -> UIView {
        let rows = Int(ceil(Double(watchVitals.count) / 2.0))
        let panel = panelView(height: CGFloat(96 + rows * 70))
        let title = label(titleText, size: 20, weight: .black, color: textColor)
        let refresh = compactIconButton(symbol: "arrow.clockwise", accessibilityLabel: "Watch 데이터 새로고침")
        refresh.addTarget(self, action: #selector(refreshWatchFromButton(_:)), for: .touchUpInside)
        let sub = label("\(subtitleText) · 주기 \(formattedSyncInterval)", size: 12, weight: .semibold, color: secondaryTextColor)
        sub.numberOfLines = 2
        sub.lineBreakMode = .byWordWrapping
        panel.addSubview(title)
        panel.addSubview(refresh)
        panel.addSubview(sub)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 18),
            title.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            title.trailingAnchor.constraint(lessThanOrEqualTo: refresh.leadingAnchor, constant: -10),
            refresh.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            refresh.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            refresh.widthAnchor.constraint(equalToConstant: 34),
            refresh.heightAnchor.constraint(equalToConstant: 34),
            sub.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 6),
            sub.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18)
        ])

        let grid = UIStackView()
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.axis = .vertical
        grid.spacing = 8
        panel.addSubview(grid)

        for rowIndex in 0..<rows {
            let row = UIStackView()
            row.axis = .horizontal
            row.spacing = 8
            row.distribution = .fillEqually
            grid.addArrangedSubview(row)
            for columnIndex in 0..<2 {
                let index = rowIndex * 2 + columnIndex
                if index < watchVitals.count {
                    let vital = watchVitals[index]
                    row.addArrangedSubview(vitalTile(vital.0, value: vital.1, unit: vital.2, accent: vital.3))
                } else {
                    let spacer = UIView()
                    spacer.translatesAutoresizingMaskIntoConstraints = false
                    row.addArrangedSubview(spacer)
                }
            }
        }

        NSLayoutConstraint.activate([
            grid.topAnchor.constraint(equalTo: sub.bottomAnchor, constant: 14),
            grid.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            grid.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            grid.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -18)
        ])
        return panel
    }

    private func compactIconButton(symbol: String, accessibilityLabel: String) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.tintColor = textColor
        button.backgroundColor = isDark ? UIColor.black.withAlphaComponent(0.22) : UIColor.white.withAlphaComponent(0.46)
        button.layer.cornerRadius = 17
        button.layer.cornerCurve = .continuous
        button.layer.borderWidth = 1
        button.layer.borderColor = glassStroke.cgColor
        button.accessibilityLabel = accessibilityLabel
        return button
    }

    private func emergencyActionBar() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(
            to: wrapper,
            cornerRadius: 30,
            fill: isDark ? UIColor.white.withAlphaComponent(0.10) : UIColor.white.withAlphaComponent(0.62),
            borderColor: glassStroke
        )

        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.spacing = 6
        stack.distribution = .fillEqually
        EmergencyActionKind.allCases.forEach { action in
            stack.addArrangedSubview(emergencyActionButton(action))
        }

        wrapper.addSubview(stack)
        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 60),
            stack.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 6),
            stack.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -6),
            stack.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -6)
        ])
        return wrapper
    }

    private func emergencyActionButton(_ action: EmergencyActionKind) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.tag = EmergencyActionKind.allCases.firstIndex(of: action) ?? 0
        var config = UIButton.Configuration.plain()
        config.image = UIImage(systemName: action.symbol)
        config.imagePlacement = .top
        config.imagePadding = 2
        config.title = action.title
        config.baseForegroundColor = action == .sos ? .white : textColor
        config.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 1, bottom: 4, trailing: 1)
        button.configuration = config
        button.titleLabel?.font = UIFont.systemFont(ofSize: 10, weight: .black)
        button.tintColor = config.baseForegroundColor
        button.backgroundColor = action == .sos
            ? sale.withAlphaComponent(0.92)
            : (isDark ? UIColor.black.withAlphaComponent(0.18) : UIColor.white.withAlphaComponent(0.42))
        button.layer.cornerRadius = 21
        button.layer.cornerCurve = .continuous
        button.layer.borderWidth = action == .sos ? 0 : 1
        button.layer.borderColor = glassStroke.cgColor
        button.addTarget(self, action: #selector(handleEmergencyAction(_:)), for: .touchUpInside)
        button.accessibilityLabel = "\(action.title) 응급 액션"
        return button
    }

    private func workerWeatherPanel() -> UIView {
        weatherPanel(titleText: "작업 위치 기상", fallbackLocation: "광주 북구 현장 A")
    }

    private func weatherPanel(titleText: String, fallbackLocation: String) -> UIView {
        let panel = panelView(height: 184)
        let title = label(titleText, size: 20, weight: .black, color: textColor)
        let refresh = buttonPill(isWeatherRefreshPending ? "갱신 중" : "새로고침", foreground: textColor, background: tileColor, width: 106)
        refresh.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .black)
        refresh.addTarget(self, action: #selector(refreshLocationWeather), for: .touchUpInside)
        let temp = label(locationWeather.temperature, size: 40, weight: .black, color: textColor)
        let safety = label(locationWeather.safety, size: 12, weight: .black, color: weatherSafetyColor)
        let place = label(locationWeather.place.isEmpty ? fallbackLocation : locationWeather.place, size: 12, weight: .semibold, color: secondaryTextColor)
        place.numberOfLines = 1
        place.lineBreakMode = .byTruncatingTail
        let details = label(locationWeather.detail, size: 11, weight: .bold, color: secondaryTextColor)
        details.numberOfLines = 2
        details.lineBreakMode = .byWordWrapping
        let openWeather = buttonPill("네이버 날씨", foreground: textColor, background: tileColor.withAlphaComponent(0.82), width: 106)
        openWeather.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .black)
        openWeather.addTarget(self, action: #selector(openNaverWeather), for: .touchUpInside)

        panel.addSubview(title)
        panel.addSubview(refresh)
        panel.addSubview(temp)
        panel.addSubview(safety)
        panel.addSubview(place)
        panel.addSubview(details)
        panel.addSubview(openWeather)

        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 14),
            title.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 16),
            refresh.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -16),
            refresh.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            refresh.leadingAnchor.constraint(greaterThanOrEqualTo: title.trailingAnchor, constant: 12),
            temp.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            temp.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            safety.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -16),
            safety.leadingAnchor.constraint(greaterThanOrEqualTo: temp.trailingAnchor, constant: 14),
            safety.centerYAnchor.constraint(equalTo: temp.centerYAnchor),
            place.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            place.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -16),
            place.topAnchor.constraint(equalTo: temp.bottomAnchor, constant: 2),
            details.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            details.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -16),
            details.topAnchor.constraint(equalTo: place.bottomAnchor, constant: 2),
            openWeather.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            openWeather.topAnchor.constraint(equalTo: details.bottomAnchor, constant: 6),
            openWeather.bottomAnchor.constraint(lessThanOrEqualTo: panel.bottomAnchor, constant: -10)
        ])
        return panel
    }

    private func workerNearbyCctvPanel() -> UIView {
        let feeds = displayedCCTVFeeds(admin: false)
        let rowCount = max(1, Int(ceil(Double(feeds.count) / 2.0)))
        let panel = panelView(height: CGFloat(140 + rowCount * 148))
        let title = label("근처 CCTV", size: 20, weight: .black, color: textColor)
        let toggle = cctvVideoToggle()
        let sub = label(isCCTVVideoEnabled ? cctvSortMode.title : "영상 꺼짐", size: 12, weight: .semibold, color: secondaryTextColor)
        panel.addSubview(title)
        panel.addSubview(toggle)
        panel.addSubview(sub)
        let statusBox = cctvStatusBox(count: feeds.count, admin: false)
        panel.addSubview(statusBox)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 22),
            title.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            toggle.centerYAnchor.constraint(equalTo: title.centerYAnchor, constant: 2),
            toggle.centerXAnchor.constraint(equalTo: panel.centerXAnchor, constant: 16),
            toggle.widthAnchor.constraint(equalToConstant: 132),
            toggle.heightAnchor.constraint(equalToConstant: 42),
            sub.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            sub.leadingAnchor.constraint(greaterThanOrEqualTo: toggle.trailingAnchor, constant: 10),
            sub.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            statusBox.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            statusBox.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            statusBox.topAnchor.constraint(equalTo: toggle.bottomAnchor, constant: 16),
            statusBox.heightAnchor.constraint(equalToConstant: 50)
        ])

        let grid = UIStackView()
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.axis = .vertical
        grid.spacing = 8
        panel.addSubview(grid)
        if feeds.isEmpty {
            let row = cctvEmptyRow()
            grid.addArrangedSubview(row)
            row.heightAnchor.constraint(equalToConstant: 132).isActive = true
        } else {
            for index in stride(from: 0, to: feeds.count, by: 2) {
                let rowStack = UIStackView()
                rowStack.axis = .horizontal
                rowStack.spacing = 8
                rowStack.distribution = .fillEqually
                rowStack.translatesAutoresizingMaskIntoConstraints = false
                rowStack.addArrangedSubview(cameraRow(feed: feeds[index]))
                if feeds.indices.contains(index + 1) {
                    rowStack.addArrangedSubview(cameraRow(feed: feeds[index + 1]))
                } else {
                    rowStack.addArrangedSubview(UIView())
                }
                grid.addArrangedSubview(rowStack)
                rowStack.heightAnchor.constraint(equalToConstant: 140).isActive = true
            }
        }
        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            grid.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            grid.topAnchor.constraint(equalTo: statusBox.bottomAnchor, constant: 12),
            grid.bottomAnchor.constraint(lessThanOrEqualTo: panel.bottomAnchor, constant: -16)
        ])
        return panel
    }

    private func displayedCCTVFeeds(admin: Bool) -> [DashboardCCTVFeed] {
        let feeds = dashboardCCTVFeeds.isEmpty ? dashboardFallbackCCTVFeeds() : dashboardCCTVFeeds
        return sortCCTVFeeds(feeds)
    }

    private func dashboardFallbackCCTVFeeds() -> [DashboardCCTVFeed] {
        [
            DashboardCCTVFeed(id: "CAM-01", name: "정문 출입구", meta: "CAM-01 · Front Gate · 객체 감지", state: "AI", color: UIColor(red: 0.00, green: 0.74, blue: 0.48, alpha: 1.0), streamURL: nil, mjpegURL: dashboardCCTVStreamURL(suffix: ""), thumbnailURL: nil, order: 0),
            DashboardCCTVFeed(id: "CAM-02", name: "지하 기계실", meta: "CAM-02 · GoPro EDGE · 낙상AI", state: "낙상AI", color: UIColor(red: 0.92, green: 0.22, blue: 0.38, alpha: 1.0), streamURL: nil, mjpegURL: dashboardCCTVStreamURL(suffix: "2"), thumbnailURL: nil, order: 1),
            DashboardCCTVFeed(id: "CAM-03", name: "현장 작업구역(GoPro)", meta: "CAM-03 · Live (Edge) · PPE (Hexmon)", state: "PPE", color: UIColor(red: 0.96, green: 0.62, blue: 0.0, alpha: 1.0), streamURL: nil, mjpegURL: dashboardCCTVStreamURL(suffix: "3"), thumbnailURL: nil, order: 2),
            DashboardCCTVFeed(id: "CAM-04", name: "자재 야적장", meta: "샘플 영상 · 자체 카메라 연동 시 실시간", state: "연결", color: UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0), streamURL: nil, thumbnailURL: nil, order: 3),
            DashboardCCTVFeed(id: "CAM-05", name: "동측 비계", meta: "샘플 영상 · 자체 카메라 연동 시 실시간", state: "연결", color: UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0), streamURL: nil, thumbnailURL: nil, order: 4),
            DashboardCCTVFeed(id: "CAM-06", name: "콘크리트 타설구역", meta: "샘플 영상 · 자체 카메라 연동 시 실시간", state: "연결", color: UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0), streamURL: nil, thumbnailURL: nil, order: 5),
            DashboardCCTVFeed(id: "CAM-07", name: "후문 차량 통제", meta: "샘플 영상 · 자체 카메라 연동 시 실시간", state: "연결", color: UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0), streamURL: nil, thumbnailURL: nil, order: 6),
            DashboardCCTVFeed(id: "CAM-08", name: "가설 전기실", meta: "샘플 영상 · 자체 카메라 연동 시 실시간", state: "연결", color: UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0), streamURL: nil, thumbnailURL: nil, order: 7)
        ]
    }

    private func dashboardCCTVStreamURL(suffix: String) -> URL? {
        URL(string: "https://cctv-ai-569797426568.asia-northeast3.run.app/cctv/stream\(suffix)")
    }

    private func sortCCTVFeeds(_ feeds: [DashboardCCTVFeed]) -> [DashboardCCTVFeed] {
        switch cctvSortMode {
        case .risk:
            return feeds.sorted(by: cctvPrioritySort)
        case .safety:
            return feeds.sorted {
                let lhs = cctvSeverityScore($0.state)
                let rhs = cctvSeverityScore($1.state)
                return lhs == rhs ? $0.name.localizedStandardCompare($1.name) == .orderedAscending : lhs < rhs
            }
        case .koreanAscending, .englishAscending:
            return feeds.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        case .koreanDescending, .englishDescending:
            return feeds.sorted { $0.name.localizedStandardCompare($1.name) == .orderedDescending }
        case .numberAscending:
            return feeds.sorted { cctvSortNumber($0) < cctvSortNumber($1) }
        case .numberDescending:
            return feeds.sorted { cctvSortNumber($0) > cctvSortNumber($1) }
        case .custom:
            let order = Dictionary(uniqueKeysWithValues: cctvCustomOrder.enumerated().map { ($0.element, $0.offset) })
            return feeds.sorted {
                let lhs = order[$0.id] ?? Int.max
                let rhs = order[$1.id] ?? Int.max
                return lhs == rhs ? $0.name.localizedStandardCompare($1.name) == .orderedAscending : lhs < rhs
            }
        }
    }

    private func cctvPrioritySort(_ lhs: DashboardCCTVFeed, _ rhs: DashboardCCTVFeed) -> Bool {
        let lhsScore = cctvSeverityScore(lhs.state)
        let rhsScore = cctvSeverityScore(rhs.state)
        if lhsScore != rhsScore {
            return lhsScore > rhsScore
        }
        return lhs.order < rhs.order
    }

    private func cctvSortNumber(_ feed: DashboardCCTVFeed) -> Int {
        let raw = "\(feed.name) \(feed.meta) \(feed.id)"
        return raw.matches(of: /\d+/).compactMap { Int($0.output) }.first ?? Int.max
    }

    private func cctvSeverityScore(_ state: String) -> Int {
        switch state {
        case "위험": return 4
        case "주의": return 3
        case "연결", "확인", "AI", "낙상AI", "PPE": return 2
        case "LIVE": return 1
        default: return 0
        }
    }

    private func cctvWorkerCount(_ meta: String) -> Int {
        let matches = meta.matches(of: /\d+/)
        return matches.compactMap { Int($0.output) }.max() ?? 0
    }

    private func refreshDashboardCCTVIfNeeded(force: Bool = false) {
        if !force,
           let lastCCTVRefreshAt,
           Date().timeIntervalSince(lastCCTVRefreshAt) < 45 {
            return
        }
        lastCCTVRefreshAt = Date()
        let base = VitAlGuardDashboardShared.safetyMonitor
        let candidates = [
            "\(base)/api/mock/cctv",
            "\(base)/api/cctv",
            "\(base)/api/mock/vital"
        ].compactMap(URL.init(string:))
        fetchDashboardCCTV(from: candidates, index: 0)
    }

    private func fetchDashboardCCTV(from candidates: [URL], index: Int) {
        guard candidates.indices.contains(index) else {
            DispatchQueue.main.async { [weak self] in
                self?.cctvRefreshControl?.endRefreshing()
            }
            return
        }
        var request = URLRequest(url: candidates[index])
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(code),
               let data,
               let feeds = self.parseDashboardCCTVFeeds(from: data),
               !feeds.isEmpty {
                DispatchQueue.main.async {
                    self.dashboardCCTVFeeds = feeds
                    self.cctvRefreshControl?.endRefreshing()
                    if self.activeMainTab == .cctv {
                        self.rebuildInterfacePreservingScrollPosition()
                    }
                }
            } else {
                self.fetchDashboardCCTV(from: candidates, index: index + 1)
            }
        }.resume()
    }

    private func parseDashboardCCTVFeeds(from data: Data) -> [DashboardCCTVFeed]? {
        guard let json = try? JSONSerialization.jsonObject(with: data) else { return nil }
        let rawItems: [[String: Any]]
        if let array = json as? [[String: Any]] {
            rawItems = array
        } else if let dict = json as? [String: Any] {
            rawItems = (dict["cameras"] as? [[String: Any]])
                ?? (dict["cctv"] as? [[String: Any]])
                ?? (dict["items"] as? [[String: Any]])
                ?? (dict["feeds"] as? [[String: Any]])
                ?? []
        } else {
            rawItems = []
        }
        guard !rawItems.isEmpty else { return nil }
        return rawItems.enumerated().compactMap { index, item in
            let name = stringValue(from: item, keys: ["name", "title", "label", "zone", "location"]) ?? "CCTV-\(index + 1)"
            let id = stringValue(from: item, keys: ["id", "cameraId", "code"]) ?? String(format: "CCTV-%02d", index + 1)
            let distance = stringValue(from: item, keys: ["distance", "distanceText", "range"]) ?? ""
            let workerCount = stringValue(from: item, keys: ["workerCount", "workers", "personCount", "people"]) ?? ""
            let status = stringValue(from: item, keys: ["statusText", "summary", "description"]) ?? ""
            let meta = [id, distance, workerCount.isEmpty ? "" : "작업자 \(workerCount)명", status].filter { !$0.isEmpty }.joined(separator: " · ")
            let state = stringValue(from: item, keys: ["state", "status", "level"]) ?? "연결"
            let streamURL = urlValue(
                from: item,
                keys: ["streamURL", "streamUrl", "videoURL", "videoUrl", "hlsURL", "hlsUrl", "playbackURL", "playbackUrl", "url", "src"]
            )
            let mjpegURL = urlValue(
                from: item,
                keys: ["mjpegURL", "mjpegUrl", "aiStreamURL", "aiStreamUrl", "aiURL", "aiUrl", "imageStreamURL", "imageStreamUrl"]
            ) ?? dashboardMjpegURL(from: item)
            let thumbnailURL = urlValue(
                from: item,
                keys: ["thumbnailURL", "thumbnailUrl", "snapshotURL", "snapshotUrl", "imageURL", "imageUrl", "poster"]
            )
            return DashboardCCTVFeed(
                id: id,
                name: name,
                meta: meta.isEmpty ? "대시보드 CCTV 수신됨" : meta,
                state: state,
                color: cctvStatusColor(for: state),
                streamURL: streamURL,
                mjpegURL: mjpegURL,
                thumbnailURL: thumbnailURL,
                order: index
            )
        }
    }

    private func dashboardMjpegURL(from item: [String: Any]) -> URL? {
        guard stringValue(from: item, keys: ["aiKind", "aiType", "detection"]) != nil else { return nil }
        let id = stringValue(from: item, keys: ["id", "cameraId", "code"]) ?? ""
        let suffix: String
        if let explicit = stringValue(from: item, keys: ["aiSuffix", "streamSuffix"]) {
            suffix = explicit
        } else if id.contains("02") {
            suffix = "2"
        } else if id.contains("03") {
            suffix = "3"
        } else {
            suffix = ""
        }
        return dashboardCCTVStreamURL(suffix: suffix)
    }

    private func stringValue(from item: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let string = item[key] as? String, !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return string
            }
            if let number = item[key] as? NSNumber {
                return "\(number)"
            }
        }
        return nil
    }

    private func urlValue(from item: [String: Any], keys: [String]) -> URL? {
        guard let raw = stringValue(from: item, keys: keys)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              let url = URL(string: raw),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            return nil
        }
        return url
    }

    private func cctvStatusColor(for state: String) -> UIColor {
        let lowered = state.lowercased()
        if lowered.contains("위험") || lowered.contains("danger") || lowered.contains("error") || lowered.contains("offline") {
            return sale
        }
        if lowered.contains("주의") || lowered.contains("warn") {
            return UIColor(red: 0.70, green: 0.42, blue: 0.00, alpha: 1.0)
        }
        if lowered.contains("live") || lowered.contains("정상") || lowered.contains("연결") || lowered.contains("online") {
            return UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0)
        }
        return UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)
    }

    private func workerActionPanel() -> UIView {
        return actionPanel(showManagerCall: true)
    }

    private func appleHealthWalletPanel(mode: AppMode) -> UIView {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false

        let panel = panelView(height: nil)
        let icon = UIImageView(image: UIImage(named: "VitAlGuardLayeredHealthIcon"))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.contentMode = .scaleAspectFit
        icon.clipsToBounds = true
        icon.layer.cornerRadius = 18
        icon.layer.cornerCurve = .continuous
        icon.backgroundColor = isDark ? UIColor.white.withAlphaComponent(0.08) : UIColor.white.withAlphaComponent(0.72)

        let title = label("Apple Health / Wallet", size: 18, weight: .black, color: textColor)
        let subtitleText = mode == .admin
            ? "관리자는 Watch HealthKit 실측값과 검증 기록 준비 상태를 함께 확인합니다."
            : "근로자는 Watch HealthKit 실측값을 동기화하고 검증 기록 기능을 준비합니다."
        let subtitle = label(subtitleText, size: 12, weight: .semibold, color: secondaryTextColor)
        subtitle.numberOfLines = 0
        subtitle.lineBreakMode = .byWordWrapping

        let health = capabilityChip(title: "Health", value: "Watch 실측값", symbol: "heart.text.square.fill", tint: UIColor(red: 0.00, green: 0.49, blue: 0.28, alpha: 1.0))
        let wallet = capabilityChip(title: "Wallet", value: "검증 기록 전용", symbol: "wallet.pass.fill", tint: ink)
        let chips = UIStackView(arrangedSubviews: [health, wallet])
        chips.translatesAutoresizingMaskIntoConstraints = false
        chips.axis = .horizontal
        chips.spacing = 8
        chips.distribution = .fillEqually

        let editor = buttonPillForActionRow("ID 정보 입력 / QR 생성", foreground: canvas, background: ink, compact: true)
        editor.addTarget(self, action: #selector(openWalletIdentityEditor), for: .touchUpInside)
        let info = buttonPillForActionRow("Wallet/Health 조건 보기", foreground: textColor, background: tileColor, compact: true)
        info.addTarget(self, action: #selector(showAppleHealthWalletInfo), for: .touchUpInside)

        let payload = WalletIdentityPayload.load(role: mode)

        container.addSubview(panel)
        panel.addSubview(icon)
        panel.addSubview(title)
        panel.addSubview(subtitle)
        panel.addSubview(chips)
        panel.addSubview(editor)
        panel.addSubview(info)

        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            icon.topAnchor.constraint(equalTo: panel.topAnchor, constant: 18),
            icon.widthAnchor.constraint(equalToConstant: 44),
            icon.heightAnchor.constraint(equalToConstant: 44),
            title.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12),
            title.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 18),
            subtitle.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            subtitle.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            subtitle.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            chips.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            chips.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            chips.topAnchor.constraint(greaterThanOrEqualTo: icon.bottomAnchor, constant: 14),
            chips.topAnchor.constraint(equalTo: subtitle.bottomAnchor, constant: 14),
            chips.heightAnchor.constraint(equalToConstant: 38),
            editor.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            editor.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            editor.topAnchor.constraint(equalTo: chips.bottomAnchor, constant: 7),
            editor.heightAnchor.constraint(equalToConstant: 31),
            info.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            info.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
            info.topAnchor.constraint(equalTo: editor.bottomAnchor, constant: 6),
            info.heightAnchor.constraint(equalToConstant: 31),
            info.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -18),

            panel.topAnchor.constraint(equalTo: container.topAnchor),
            panel.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            panel.trailingAnchor.constraint(equalTo: container.trailingAnchor)
        ])
        if payload.hasEmployeeIdentity {
            let passPreview = StandardPassPreviewView(compact: true)
            passPreview.update(
                payload: payload,
                qrImage: WalletIdentityViewController.makeQRCode(from: payload.encodedString),
                barcodeImage: WalletIdentityViewController.makeCode128(from: payload.barcodeString)
            )
            let walletBadge = PKAddPassButton(addPassButtonStyle: .blackOutline)
            walletBadge.translatesAutoresizingMaskIntoConstraints = false
            walletBadge.addTarget(self, action: #selector(openWalletIdentityEditor), for: .touchUpInside)
            container.addSubview(passPreview)
            container.addSubview(walletBadge)
            NSLayoutConstraint.activate([
                passPreview.topAnchor.constraint(equalTo: panel.bottomAnchor, constant: 8),
                passPreview.centerXAnchor.constraint(equalTo: container.centerXAnchor),
                passPreview.widthAnchor.constraint(equalTo: container.widthAnchor, multiplier: 0.84),
                walletBadge.topAnchor.constraint(equalTo: passPreview.bottomAnchor, constant: 10),
                walletBadge.centerXAnchor.constraint(equalTo: container.centerXAnchor),
                walletBadge.widthAnchor.constraint(lessThanOrEqualToConstant: 250),
                walletBadge.widthAnchor.constraint(equalTo: container.widthAnchor, multiplier: 0.50),
                walletBadge.heightAnchor.constraint(equalToConstant: 46),
                walletBadge.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                container.heightAnchor.constraint(greaterThanOrEqualToConstant: 680)
            ])
        } else {
            NSLayoutConstraint.activate([
                panel.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                container.heightAnchor.constraint(greaterThanOrEqualToConstant: 228)
            ])
        }
        return container
    }

    private func capabilityChip(title: String, value: String, symbol: String, tint: UIColor) -> UIView {
        let chip = UIView()
        chip.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(
            to: chip,
            cornerRadius: 18,
            fill: isDark ? UIColor.black.withAlphaComponent(0.16) : UIColor.white.withAlphaComponent(0.58),
            borderColor: glassStroke
        )

        let image = UIImageView(image: UIImage(systemName: symbol))
        image.translatesAutoresizingMaskIntoConstraints = false
        image.tintColor = tint
        image.contentMode = .scaleAspectFit

        let titleLabel = label(title, size: 11, weight: .black, color: textColor)
        let valueLabel = label(value, size: 9, weight: .bold, color: secondaryTextColor)

        chip.addSubview(image)
        chip.addSubview(titleLabel)
        chip.addSubview(valueLabel)

        NSLayoutConstraint.activate([
            image.leadingAnchor.constraint(equalTo: chip.leadingAnchor, constant: 10),
            image.centerYAnchor.constraint(equalTo: chip.centerYAnchor),
            image.widthAnchor.constraint(equalToConstant: 18),
            image.heightAnchor.constraint(equalToConstant: 18),
            titleLabel.leadingAnchor.constraint(equalTo: image.trailingAnchor, constant: 8),
            titleLabel.trailingAnchor.constraint(equalTo: chip.trailingAnchor, constant: -8),
            titleLabel.topAnchor.constraint(equalTo: chip.topAnchor, constant: 8),
            valueLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            valueLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            valueLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 1)
        ])
        return chip
    }

    private func dashboardWeatherPanel() -> UIView {
        let panelHeight: CGFloat = 382
        let panel = panelView(height: panelHeight, color: isDark ? UIColor.black.withAlphaComponent(0.22) : UIColor.white.withAlphaComponent(0.52))
        let pages = ["현황 요약", "실시간 레이더", "태풍 진로", "특보 영상", "인근 병원"]
        dashboardWeatherPageIndex = min(max(0, dashboardWeatherPageIndex), pages.count - 1)

        let tabBar = dashboardWeatherPageTabBar(pages: pages)
        let content = dashboardWeatherPageContent(index: dashboardWeatherPageIndex)

        panel.addSubview(tabBar)
        panel.addSubview(content)

        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 10),
            tabBar.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -10),
            tabBar.topAnchor.constraint(equalTo: panel.topAnchor, constant: 10),
            tabBar.heightAnchor.constraint(equalToConstant: 42),
            content.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 10),
            content.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -10),
            content.topAnchor.constraint(equalTo: tabBar.bottomAnchor, constant: 10),
            content.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -10)
        ])
        return panel
    }

    private func dashboardWeatherPageTabBar(pages: [String]) -> UIView {
        let container = UIVisualEffectView(effect: UIBlurEffect(style: isDark ? .systemUltraThinMaterialDark : .systemUltraThinMaterialLight))
        container.translatesAutoresizingMaskIntoConstraints = false
        container.isUserInteractionEnabled = true
        container.tag = pages.count
        container.layer.cornerRadius = 21
        container.layer.cornerCurve = .continuous
        container.clipsToBounds = true
        container.backgroundColor = .clear
        container.layer.borderWidth = 1.1
        container.layer.borderColor = glassStroke.cgColor

        let control = UISegmentedControl(items: pages)
        control.translatesAutoresizingMaskIntoConstraints = false
        control.selectedSegmentIndex = dashboardWeatherPageIndex
        control.selectedSegmentTintColor = UIColor(red: 0.05, green: 0.60, blue: 1.0, alpha: 0.68)
        control.backgroundColor = (isDark ? UIColor.black : UIColor.white).withAlphaComponent(isDark ? 0.20 : 0.26)
        control.setTitleTextAttributes([
            .font: UIFont.systemFont(ofSize: 9.5, weight: .semibold),
            .foregroundColor: secondaryTextColor
        ], for: .normal)
        control.setTitleTextAttributes([
            .font: UIFont.systemFont(ofSize: 9.5, weight: .bold),
            .foregroundColor: UIColor.white
        ], for: .selected)
        control.addTarget(self, action: #selector(selectDashboardWeatherSegment(_:)), for: .valueChanged)
        container.contentView.addSubview(control)

        NSLayoutConstraint.activate([
            control.leadingAnchor.constraint(equalTo: container.contentView.leadingAnchor, constant: 5),
            control.trailingAnchor.constraint(equalTo: container.contentView.trailingAnchor, constant: -5),
            control.topAnchor.constraint(equalTo: container.contentView.topAnchor, constant: 5),
            control.bottomAnchor.constraint(equalTo: container.contentView.bottomAnchor, constant: -5)
        ])

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleDashboardWeatherPagePan(_:)))
        pan.cancelsTouchesInView = false
        container.addGestureRecognizer(pan)
        return container
    }

    @objc private func selectDashboardWeatherSegment(_ sender: UISegmentedControl) {
        guard (0..<sender.numberOfSegments).contains(sender.selectedSegmentIndex) else { return }
        dashboardWeatherPageIndex = sender.selectedSegmentIndex
        rebuildInterfacePreservingScrollPosition()
    }

    @objc private func selectDashboardWeatherPage(_ sender: UIButton) {
        dashboardWeatherPageIndex = sender.tag
        rebuildInterfacePreservingScrollPosition()
    }

    @objc private func handleDashboardWeatherPagePan(_ recognizer: UIPanGestureRecognizer) {
        guard let container = recognizer.view, container.tag > 0 else { return }
        let x = recognizer.location(in: container).x
        let inset: CGFloat = 5
        let availableWidth = max(1, container.bounds.width - inset * 2)
        let clampedX = min(max(0, x - inset), availableWidth)
        let index = min(container.tag - 1, max(0, Int((clampedX / availableWidth) * CGFloat(container.tag))))
        switch recognizer.state {
        case .ended:
            guard index != dashboardWeatherPageIndex else { return }
            dashboardWeatherPageIndex = index
            rebuildInterfacePreservingScrollPosition()
        default:
            break
        }
    }

    private func dashboardWeatherArrowButton(systemName: String, tag: Int) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.tag = tag
        button.tintColor = textColor
        button.setImage(UIImage(systemName: systemName), for: .normal)
        button.backgroundColor = isDark ? UIColor.black.withAlphaComponent(0.30) : UIColor.white.withAlphaComponent(0.52)
        button.layer.cornerRadius = 13
        button.layer.cornerCurve = .continuous
        button.addTarget(self, action: #selector(changeDashboardWeatherPage(_:)), for: .touchUpInside)
        return button
    }

    @objc private func changeDashboardWeatherPage(_ sender: UIButton) {
        let pageCount = 5
        dashboardWeatherPageIndex = (dashboardWeatherPageIndex + sender.tag + pageCount) % pageCount
        rebuildInterfacePreservingScrollPosition()
    }

    @objc private func openDashboardRadarViewer() {
        dashboardRadarTimer?.invalidate()
        dashboardRadarIsPlaying = false
        let viewer = RadarViewerController(
            frameIndex: min(max(0, dashboardRadarFrameIndex), dashboardRadarFrameCount() - 1),
            layerMode: dashboardWeatherMapLayer,
            weather: locationWeather,
            currentCoordinate: dashboardCurrentCoordinate()
        )
        viewer.onCurrentLocationRequested = { [weak self] in
            self?.dashboardCurrentCoordinate()
        }
        viewer.onWeatherRefreshRequested = { [weak self, weak viewer] in
            guard let self else { return }
            self.requestLocationPermissionForWatermark()
            if let location = self.watermarkLocationManager.location ?? self.lastKnownWatermarkLocation {
                self.isWeatherRefreshPending = true
                Task { [weak self, weak viewer] in
                    guard let self else { return }
                    let address = await self.reverseGeocodeAddress(for: location)
                    let weather = await self.fetchWeatherSummary(for: location, address: address)
                    await MainActor.run {
                        self.locationWeather = weather
                        self.isWeatherRefreshPending = false
                        viewer?.updateWeather(weather, coordinate: self.dashboardCurrentCoordinate())
                        self.buildInterface()
                    }
                }
            }
        }
        viewer.overrideUserInterfaceStyle = .dark
        viewer.modalPresentationStyle = .fullScreen
        present(viewer, animated: true)
    }

    @objc private func toggleDashboardRadarPlayback() {
        dashboardRadarIsPlaying.toggle()
        dashboardRadarTimer?.invalidate()
        if dashboardRadarIsPlaying {
            dashboardRadarTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                self?.advanceDashboardRadarFrame()
            }
        }
        buildInterface()
    }

    @objc private func selectDashboardRadarFrame(_ sender: UIButton) {
        dashboardRadarFrameIndex = sender.tag
        dashboardRadarIsPlaying = false
        dashboardRadarTimer?.invalidate()
        buildInterface()
    }

    private func advanceDashboardRadarFrame() {
        dashboardRadarFrameIndex = (dashboardRadarFrameIndex + 1) % dashboardRadarFrameCount()
        buildInterface()
    }

    private func dashboardRadarFrameCount() -> Int {
        max(1, locationWeather.hourlyForecasts.isEmpty ? dashboardRadarTimes.count : locationWeather.hourlyForecasts.count)
    }

    private func dashboardRadarTimeTitle(at index: Int) -> String {
        if locationWeather.hourlyForecasts.indices.contains(index) {
            return locationWeather.hourlyForecasts[index].timeText
        }
        guard dashboardRadarTimes.indices.contains(index) else { return "대기" }
        return dashboardRadarTimes[index]
    }

    @objc private func selectDashboardWeatherMapLayer(_ sender: UIButton) {
        guard let mode = WeatherMapLayer(rawValue: sender.tag) else { return }
        dashboardWeatherMapLayer = mode
        buildInterface()
    }

    @objc private func recenterDashboardWeatherMap() {
        refreshLocationWeather()
    }

    private func dashboardCurrentCoordinate() -> CLLocationCoordinate2D? {
        guard let coordinate = (watermarkLocationManager.location ?? lastKnownWatermarkLocation)?.coordinate else {
            return nil
        }
        return isLocationInsideKoreaScope(coordinate) ? coordinate : nil
    }

    private func removeDashboardInlineLiveContent() {
        guard let controller = dashboardInlineLiveContentController else { return }
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
        dashboardInlineLiveContentController = nil
    }

    private func isDashboardLiveContentEnabled(_ kind: DashboardLiveContentKind) -> Bool {
        UserDefaults.standard.bool(forKey: kind.visibilityKey)
    }

    private func setDashboardLiveContentEnabled(_ enabled: Bool, for kind: DashboardLiveContentKind) {
        UserDefaults.standard.set(enabled, forKey: kind.visibilityKey)
        rebuildInterfacePreservingScrollPosition()
    }

    private func dashboardLiveContentToggle(_ kind: DashboardLiveContentKind) -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        let title = label("관제 데이터", size: 10, weight: .black, color: secondaryTextColor)
        let control = UISegmentedControl(items: ["ON", "OFF"])
        control.translatesAutoresizingMaskIntoConstraints = false
        control.tag = kind.toggleTag
        control.selectedSegmentIndex = isDashboardLiveContentEnabled(kind) ? 0 : 1
        control.selectedSegmentTintColor = isDashboardLiveContentEnabled(kind)
            ? UIColor(red: 0.08, green: 0.66, blue: 0.44, alpha: 1.0)
            : UIColor.systemGray.withAlphaComponent(0.72)
        control.backgroundColor = isDark ? UIColor.black.withAlphaComponent(0.32) : UIColor.white.withAlphaComponent(0.52)
        control.setTitleTextAttributes([
            .font: UIFont.systemFont(ofSize: 10, weight: .black),
            .foregroundColor: secondaryTextColor
        ], for: .normal)
        control.setTitleTextAttributes([
            .font: UIFont.systemFont(ofSize: 10, weight: .black),
            .foregroundColor: UIColor.white
        ], for: .selected)
        control.accessibilityLabel = "\(kind.title) 관제 데이터 표시"
        control.addTarget(self, action: #selector(changeDashboardLiveContentVisibility(_:)), for: .valueChanged)
        wrapper.addSubview(title)
        wrapper.addSubview(control)
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            title.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor),
            control.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            control.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor),
            control.widthAnchor.constraint(equalToConstant: 92),
            control.heightAnchor.constraint(equalToConstant: 26)
        ])
        return wrapper
    }

    @objc private func changeDashboardLiveContentVisibility(_ sender: UISegmentedControl) {
        guard let kind = DashboardLiveContentKind.from(toggleTag: sender.tag) else { return }
        setDashboardLiveContentEnabled(sender.selectedSegmentIndex == 0, for: kind)
    }

    private func dashboardInlineLiveContent(_ kind: DashboardLiveContentKind) -> UIView {
        guard isDashboardLiveContentEnabled(kind) else {
            return dashboardEmptyState(
                symbol: kind == .typhoon ? "tropicalstorm" : "video",
                title: "관제 데이터 표시가 꺼져 있습니다",
                detail: "ON을 선택하면 최신 \(kind.title) 정보를 요청해 표시합니다. OFF 상태에서는 관제 서버에 요청하지 않습니다."
            )
        }
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.clipsToBounds = true
        container.layer.cornerRadius = 14
        container.layer.cornerCurve = .continuous
        container.layer.borderWidth = 1
        container.layer.borderColor = glassStroke.cgColor
        container.backgroundColor = isDark ? UIColor.black.withAlphaComponent(0.24) : UIColor.white.withAlphaComponent(0.42)

        let controller = DashboardLiveContentViewController(
            kind: kind,
            dashboardURL: VitalGuardLinks.safetyMonitor,
            coordinate: dashboardCurrentCoordinate(),
            interfaceStyle: savedThemeMode.interfaceStyle,
            embedded: true
        )
        addChild(controller)
        let content = controller.view!
        content.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            content.topAnchor.constraint(equalTo: container.topAnchor),
            content.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        controller.didMove(toParent: self)
        dashboardInlineLiveContentController = controller
        return container
    }

    private func openDashboardLiveContent(_ kind: DashboardLiveContentKind) {
        guard isDashboardLiveContentEnabled(kind) else {
            let alert = UIAlertController(
                title: "관제 데이터가 꺼져 있습니다",
                message: "ON을 선택하면 \(kind.title) 정보를 요청하고 전체 화면으로 확인할 수 있습니다.",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "취소", style: .cancel))
            alert.addAction(UIAlertAction(title: "ON으로 켜기", style: .default) { [weak self] _ in
                self?.setDashboardLiveContentEnabled(true, for: kind)
            })
            present(alert, animated: true)
            return
        }
        let viewer = DashboardLiveContentViewController(
            kind: kind,
            dashboardURL: VitalGuardLinks.safetyMonitor,
            coordinate: dashboardCurrentCoordinate(),
            interfaceStyle: savedThemeMode.interfaceStyle
        )
        let navigation = UINavigationController(rootViewController: viewer)
        navigation.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        navigation.modalPresentationStyle = .pageSheet
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = 24
        }
        present(navigation, animated: true)
    }

    private func dashboardWeatherPageContent(index: Int) -> UIView {
        switch index {
        case 0:
            return dashboardSummaryPage()
        case 1:
            return dashboardRadarPage()
        case 2:
            return dashboardTyphoonPage()
        case 3:
            return dashboardSpecialVideoPage()
        default:
            return dashboardNearbyHospitalPage()
        }
    }

    private func dashboardSummaryPage() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        wrapper.backgroundColor = UIColor.black.withAlphaComponent(isDark ? 0.38 : 0.10)
        wrapper.layer.cornerRadius = 14
        wrapper.layer.cornerCurve = .continuous
        let summary = dashboardHomeSummarySnapshot
        let summaryError = dashboardHomeSummaryError ?? "관제 웹 현황 요약 수신 대기"

        let progress = dashboardProgressBar(
            title: "공정률",
            value: summary?.progressValue ?? "--",
            progressFraction: summary?.progressFraction,
            detail: summary?.progressDetail ?? summaryError,
            trailing: summary?.progressTrailing ?? "수신 대기",
            colors: [
                UIColor(red: 1.0, green: 0.23, blue: 0.16, alpha: 1.0),
                UIColor(red: 1.0, green: 0.76, blue: 0.10, alpha: 1.0),
                UIColor(red: 0.05, green: 0.72, blue: 0.36, alpha: 1.0),
                UIColor(red: 0.15, green: 0.33, blue: 0.80, alpha: 1.0)
            ]
        )
        let safety = dashboardProgressBar(
            title: "무사고",
            value: summary?.safetyValue ?? "--",
            progressFraction: summary?.safetyFraction,
            detail: summary?.safetyDetail ?? summaryError,
            trailing: summary?.safetyTrailing ?? "수신 대기",
            colors: [
                UIColor(red: 1.0, green: 0.23, blue: 0.16, alpha: 1.0),
                UIColor(red: 1.0, green: 0.86, blue: 0.08, alpha: 1.0),
                UIColor(red: 0.14, green: 0.82, blue: 0.38, alpha: 1.0),
                UIColor(red: 0.22, green: 0.28, blue: 0.78, alpha: 1.0)
            ]
        )

        let title = label("수신 요약", size: 12, weight: .black, color: textColor)
        title.setContentCompressionResistancePriority(.required, for: .vertical)
        title.setContentHuggingPriority(.required, for: .vertical)
        let live = label("LIVE", size: 10, weight: .black, color: .white)
        live.textAlignment = .center
        live.backgroundColor = UIColor(red: 0.23, green: 0.70, blue: 1.0, alpha: 1.0)
        live.layer.cornerRadius = 9
        live.clipsToBounds = true
        live.setContentCompressionResistancePriority(.required, for: .vertical)

        let grid = UIStackView()
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.axis = .vertical
        grid.spacing = 5
        let row1 = UIStackView(arrangedSubviews: [
            dashboardStatTile(labelText: "등록 작업자", valueText: summary?.registeredWorkers ?? "--"),
            dashboardStatTile(labelText: "대기 작업자", valueText: summary?.pendingWorkers ?? "--")
        ])
        let row2 = UIStackView(arrangedSubviews: [
            dashboardStatTile(labelText: "최근 표시", valueText: summary?.recentCount ?? "--"),
            dashboardStatTile(labelText: "DB 누적", valueText: summary?.totalPersisted ?? "--")
        ])
        [row1, row2].forEach {
            $0.axis = .horizontal
            $0.spacing = 6
            $0.distribution = .fillEqually
            $0.heightAnchor.constraint(equalToConstant: 60).isActive = true
            grid.addArrangedSubview($0)
        }

        wrapper.addSubview(progress)
        wrapper.addSubview(safety)
        wrapper.addSubview(title)
        wrapper.addSubview(live)
        wrapper.addSubview(grid)
        NSLayoutConstraint.activate([
            progress.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 12),
            progress.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -12),
            progress.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 12),
            progress.heightAnchor.constraint(equalToConstant: 42),
            safety.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 12),
            safety.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -12),
            safety.topAnchor.constraint(equalTo: progress.bottomAnchor, constant: 8),
            safety.heightAnchor.constraint(equalToConstant: 42),
            title.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 12),
            title.trailingAnchor.constraint(lessThanOrEqualTo: live.leadingAnchor, constant: -10),
            title.topAnchor.constraint(equalTo: safety.bottomAnchor, constant: 12),
            title.heightAnchor.constraint(greaterThanOrEqualToConstant: 18),
            live.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -12),
            live.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            live.widthAnchor.constraint(equalToConstant: 46),
            live.heightAnchor.constraint(equalToConstant: 22),
            grid.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 12),
            grid.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -12),
            grid.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            grid.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -10)
        ])
        return wrapper
    }

    private func dashboardDisplayString(from item: [String: Any]?, key: String) -> String {
        guard let value = item?[key] else { return "--" }
        if let string = value as? String, !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return string
        }
        if let number = value as? NSNumber {
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            formatter.locale = Locale(identifier: "ko_KR")
            return formatter.string(from: number) ?? "\(number)"
        }
        return "--"
    }

    private func refreshDashboardHomeSummaryIfNeeded(force: Bool = false) {
        if isDashboardHomeSummaryRefreshInFlight { return }
        if !force,
           let lastDashboardHomeSummaryRefreshAt,
           Date().timeIntervalSince(lastDashboardHomeSummaryRefreshAt) < 30 {
            return
        }
        guard let url = URL(string: "\(VitalGuardLinks.safetyMonitor)/api/admin/site-info") else { return }
        isDashboardHomeSummaryRefreshInFlight = true
        lastDashboardHomeSummaryRefreshAt = Date()
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        guard applyDashboardSummaryAuthorization(to: &request) else {
            isDashboardHomeSummaryRefreshInFlight = false
            dashboardHomeSummarySnapshot = nil
            dashboardHomeSummaryError = "관제 관리자 인증이 필요합니다"
            rebuildInterfacePreservingScrollPosition()
            return
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code),
                  let data,
                  let json = try? JSONSerialization.jsonObject(with: data),
                  let dict = json as? [String: Any],
                  let snapshot = self.dashboardHomeSummarySnapshot(fromSiteInfoResponse: dict) else {
                DispatchQueue.main.async {
                    self.isDashboardHomeSummaryRefreshInFlight = false
                    self.dashboardHomeSummarySnapshot = nil
                    self.dashboardHomeSummaryError = code == 401 || code == 403
                        ? "관제 관리자 인증을 확인하세요"
                        : error?.localizedDescription ?? "관제 현황 요약을 받지 못했습니다"
                    self.rebuildInterfacePreservingScrollPosition()
                }
                return
            }
            self.loadDashboardHomeReceptionMetrics(for: snapshot) { [weak self] enrichedSnapshot in
                guard let self else { return }
                DispatchQueue.main.async {
                    self.isDashboardHomeSummaryRefreshInFlight = false
                    self.dashboardHomeSummarySnapshot = enrichedSnapshot
                    self.dashboardHomeSummaryError = nil
                    self.rebuildInterfacePreservingScrollPosition()
                }
            }
        }.resume()
    }

    private func startDashboardHomeSummaryTimerIfNeeded() {
        guard dashboardHomeSummaryTimer == nil else { return }
        let timer = Timer(timeInterval: 30, repeats: true) { [weak self] _ in
            guard let self, self.activeMainTab == .home, self.dashboardWeatherPageIndex == 0 else {
                self?.stopDashboardHomeSummaryTimer()
                return
            }
            guard UIApplication.shared.applicationState == .active else { return }
            self.refreshDashboardHomeSummaryIfNeeded(force: true)
        }
        timer.tolerance = 8
        RunLoop.main.add(timer, forMode: .common)
        dashboardHomeSummaryTimer = timer
    }

    private func stopDashboardHomeSummaryTimer() {
        dashboardHomeSummaryTimer?.invalidate()
        dashboardHomeSummaryTimer = nil
    }

    private func loadDashboardHomeReceptionMetrics(
        for snapshot: DashboardHomeSummarySnapshot,
        completion: @escaping (DashboardHomeSummarySnapshot) -> Void
    ) {
        guard let vitalURL = URL(string: "\(VitalGuardLinks.safetyMonitor)/api/mock/vital") else {
            completion(snapshot)
            return
        }
        var vitalRequest = URLRequest(url: vitalURL)
        vitalRequest.timeoutInterval = 10
        vitalRequest.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        vitalRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        vitalRequest.setValue("no-store", forHTTPHeaderField: "Cache-Control")

        URLSession.shared.dataTask(with: vitalRequest) { [weak self] data, response, _ in
            guard let self else { return }
            let vitalResponse = self.dashboardJSONDictionary(data: data, response: response)
            self.fetchDashboardMonitorSlots { [weak self] slotsResponse in
                guard let self else { return }
                completion(self.dashboardHomeSummarySnapshot(
                    snapshot,
                    applyingVitalResponse: vitalResponse,
                    slotsResponse: slotsResponse
                ))
            }
        }.resume()
    }

    private func fetchDashboardMonitorSlots(completion: @escaping ([String: Any]?) -> Void) {
        guard let slotsURL = URL(string: "\(VitalGuardLinks.safetyMonitor)/api/monitor/slots") else {
            completion(nil)
            return
        }
        var request = URLRequest(url: slotsURL)
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        guard applyDashboardSummaryAuthorization(to: &request) else {
            completion(nil)
            return
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let slotsResponse = self.dashboardJSONDictionary(data: data, response: response) {
                completion(slotsResponse)
                return
            }
            let hasJWT = !(DashboardCredentialStore.loadAppJWT() ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .isEmpty
            guard (statusCode == 401 || statusCode == 403), !hasJWT else {
                completion(nil)
                return
            }
            self.refreshDashboardSummaryJWTIfPossible { [weak self] refreshed in
                guard let self, refreshed else {
                    completion(nil)
                    return
                }
                self.fetchDashboardMonitorSlots(completion: completion)
            }
        }.resume()
    }

    private func refreshDashboardSummaryJWTIfPossible(completion: @escaping (Bool) -> Void) {
        guard !hasAttemptedDashboardSummaryTokenRefresh else {
            completion(false)
            return
        }
        hasAttemptedDashboardSummaryTokenRefresh = true
        let id = UserDefaults.standard.string(forKey: PreviewSettingsKey.dashboardAdminId)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let password = DashboardCredentialStore.loadPassword()?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !id.isEmpty,
              !password.isEmpty else {
            completion(false)
            return
        }
        let loginURLs = [
            VitalGuardLinks.appAuthLogin,
            "\(VitalGuardLinks.safetyMonitor)/api/admin/login"
        ].compactMap(URL.init(string:))
        requestDashboardSummaryJWT(loginURLs, id: id, password: password, completion: completion)
    }

    private func requestDashboardSummaryJWT(
        _ loginURLs: [URL],
        id: String,
        password: String,
        completion: @escaping (Bool) -> Void
    ) {
        guard let loginURL = loginURLs.first else {
            completion(false)
            return
        }
        var request = URLRequest(url: loginURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["id": id, "password": password])
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let login = data.flatMap { try? JSONDecoder().decode(AppAuthLoginResponse.self, from: $0) }
            guard (200..<300).contains(statusCode),
                  login?.ok == true,
                  let token = login?.token?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !token.isEmpty else {
                self.requestDashboardSummaryJWT(Array(loginURLs.dropFirst()), id: id, password: password, completion: completion)
                return
            }
            DashboardCredentialStore.saveAppJWT(token)
            completion(true)
        }.resume()
    }

    private func dashboardJSONDictionary(data: Data?, response: URLResponse?) -> [String: Any]? {
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(statusCode),
              let data,
              let object = try? JSONSerialization.jsonObject(with: data) else {
            return nil
        }
        return object as? [String: Any]
    }

    private func dashboardHomeSummarySnapshot(
        _ snapshot: DashboardHomeSummarySnapshot,
        applyingVitalResponse vitalResponse: [String: Any]?,
        slotsResponse: [String: Any]?
    ) -> DashboardHomeSummarySnapshot {
        var enrichedSnapshot = snapshot
        guard let vitalResponse else { return enrichedSnapshot }

        let latest = vitalResponse["latest"] as? [[String: Any]] ?? []
        let recent = vitalResponse["recent"] as? [Any] ?? []
        enrichedSnapshot.recentCount = "\(recent.count)"
        enrichedSnapshot.totalPersisted = dashboardDisplayString(from: vitalResponse, key: "totalPersisted")

        let slotWorkerIDs = Set((slotsResponse?["slots"] as? [Any] ?? []).compactMap { item -> String? in
            guard let workerID = item as? String else { return nil }
            let normalized = workerID.trimmingCharacters(in: .whitespacesAndNewlines)
            return normalized.isEmpty ? nil : normalized
        })
        let profileWorkerIDs = Set((vitalResponse["workerProfiles"] as? [String: Any] ?? [:]).keys)
        let registeredWorkerIDs = slotWorkerIDs.isEmpty ? profileWorkerIDs : slotWorkerIDs
        guard !registeredWorkerIDs.isEmpty else { return enrichedSnapshot }
        let dashboardWaitingWorkerIDs = Set((1...12).map { String(format: "VW-%03d", $0) })
        let liveWorkerIDs = Set(latest.compactMap { item -> String? in
            guard let workerID = item["workerId"] as? String else { return nil }
            let normalized = workerID.trimmingCharacters(in: .whitespacesAndNewlines)
            return normalized.isEmpty ? nil : normalized
        })
        let dashboardWorkerIDs = liveWorkerIDs.union(dashboardWaitingWorkerIDs)
        enrichedSnapshot.registeredWorkers = "\(registeredWorkerIDs.count)"
        enrichedSnapshot.pendingWorkers = "\(dashboardWorkerIDs.subtracting(registeredWorkerIDs).count)"
        return enrichedSnapshot
    }

    private func applyDashboardSummaryAuthorization(to request: inout URLRequest) -> Bool {
        let token = DashboardCredentialStore.loadAppJWT()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            return true
        }
        return applyDashboardAdminAuthorization(to: &request)
    }

    private func dashboardHomeSummarySnapshot(fromSiteInfoResponse response: [String: Any]) -> DashboardHomeSummarySnapshot? {
        let siteInfo = response["siteInfo"] as? [String: Any] ?? response
        guard let startDateText = siteInfo["start_date"] as? String,
              let completionDateText = siteInfo["completion_date"] as? String,
              let startDate = dashboardSummaryDate(from: startDateText),
              let completionDate = dashboardSummaryDate(from: completionDateText),
              completionDate > startDate
        else { return nil }

        let now = Date()
        let secondsPerDay: TimeInterval = 86_400
        let totalDays = Int((completionDate.timeIntervalSince(startDate) / secondsPerDay).rounded())
        let elapsedInterval = now.timeIntervalSince(startDate)
        let elapsedDays = max(0, Int((elapsedInterval / secondsPerDay).rounded()))
        let progress = min(100, max(0, elapsedInterval / completionDate.timeIntervalSince(startDate) * 100))
        let daysLeft = max(0, Int(ceil(completionDate.timeIntervalSince(now) / secondsPerDay)))

        let accidentDate = ["last_accident_at", "lastAccidentAt", "last_incident_at", "lastIncidentAt"]
            .compactMap { siteInfo[$0] as? String }
            .compactMap(dashboardSummaryTimestamp(from:))
            .max() ?? startDate
        let incidentFreeDays = max(0, Int(floor(now.timeIntervalSince(accidentDate) / secondsPerDay)))
        let targetDays = max(100, 100 * Int(ceil(Double(incidentFreeDays + 1) / 100)))

        return DashboardHomeSummarySnapshot(
            progressValue: String(format: "%.1f%%", progress),
            progressFraction: CGFloat(progress / 100),
            progressDetail: "경과 \(elapsedDays)일 / 총 \(totalDays)일",
            progressTrailing: daysLeft == 0 ? "준공 완료" : "준공까지 D-\(daysLeft)",
            safetyValue: "\(incidentFreeDays)일",
            safetyFraction: CGFloat(min(1, Double(incidentFreeDays) / Double(targetDays))),
            safetyDetail: accidentDate == startDate ? "연속 무사고" : "사고 후 재집계",
            safetyTrailing: "목표 \(targetDays)일까지 \(targetDays - incidentFreeDays)일",
            registeredWorkers: "--",
            pendingWorkers: "--",
            recentCount: "--",
            totalPersisted: "--",
            fetchedAt: now
        )
    }

    private func dashboardSummaryDate(from text: String) -> Date? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: text)
    }

    private func dashboardSummaryTimestamp(from text: String) -> Date? {
        ISO8601DateFormatter().date(from: text) ?? dashboardSummaryDate(from: text)
    }

    private func dashboardNearbyHospitalPage() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        wrapper.backgroundColor = UIColor.black.withAlphaComponent(isDark ? 0.38 : 0.10)
        wrapper.layer.cornerRadius = 14
        wrapper.layer.cornerCurve = .continuous

        let title = label("인근 병원", size: 18, weight: .black, color: textColor)
        let area = label("광주 동구", size: 12, weight: .black, color: secondaryTextColor)
        area.textAlignment = .center
        area.backgroundColor = UIColor.white.withAlphaComponent(isDark ? 0.13 : 0.38)
        area.layer.cornerRadius = 14
        area.clipsToBounds = true
        let refresh = UIButton(type: .system)
        refresh.translatesAutoresizingMaskIntoConstraints = false
        refresh.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        refresh.tintColor = secondaryTextColor
        refresh.accessibilityLabel = "인근 병원 새로고침"
        refresh.addTarget(self, action: #selector(refreshNearbyHospitalPage), for: .touchUpInside)

        let emergency = label("응급실  \(dashboardNearbyHospitals().count)", size: 13, weight: .black, color: UIColor(red: 0.20, green: 0.72, blue: 1.0, alpha: 1.0))
        let divider = UIView()
        divider.translatesAutoresizingMaskIntoConstraints = false
        divider.backgroundColor = UIColor.white.withAlphaComponent(isDark ? 0.12 : 0.18)

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        scroll.showsVerticalScrollIndicator = true
        scroll.indicatorStyle = isDark ? .white : .black

        let list = UIStackView()
        list.translatesAutoresizingMaskIntoConstraints = false
        list.axis = .vertical
        list.spacing = 0
        dashboardNearbyHospitals().forEach { list.addArrangedSubview(dashboardHospitalRow($0)) }

        wrapper.addSubview(title)
        wrapper.addSubview(area)
        wrapper.addSubview(refresh)
        wrapper.addSubview(emergency)
        wrapper.addSubview(divider)
        wrapper.addSubview(scroll)
        scroll.addSubview(list)
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 12),
            title.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 12),
            area.leadingAnchor.constraint(equalTo: title.trailingAnchor, constant: 10),
            area.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            area.widthAnchor.constraint(equalToConstant: 74),
            area.heightAnchor.constraint(equalToConstant: 28),
            refresh.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -10),
            refresh.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            refresh.widthAnchor.constraint(equalToConstant: 36),
            refresh.heightAnchor.constraint(equalToConstant: 36),
            emergency.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            emergency.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 18),
            divider.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            divider.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -12),
            divider.topAnchor.constraint(equalTo: emergency.bottomAnchor, constant: 8),
            divider.heightAnchor.constraint(equalToConstant: 1),
            scroll.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -8),
            scroll.topAnchor.constraint(equalTo: divider.bottomAnchor, constant: 4),
            scroll.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -8),
            list.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            list.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            list.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            list.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor)
        ])
        return wrapper
    }

    private func dashboardHospitalRow(_ hospital: DashboardNearbyHospital) -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        let name = label(hospital.name, size: 12, weight: .black, color: textColor)
        name.numberOfLines = 1
        name.lineBreakMode = .byTruncatingTail
        let address = label(hospital.address, size: 10, weight: .semibold, color: secondaryTextColor)
        address.numberOfLines = 1
        address.lineBreakMode = .byTruncatingTail
        let hours = label("\(hospital.openingHours) · \(hospital.closedDays)", size: 9, weight: .bold, color: secondaryTextColor)
        hours.numberOfLines = 1
        hours.lineBreakMode = .byTruncatingTail
        let distance = label(hospital.distanceText, size: 10, weight: .black, color: UIColor(red: 0.20, green: 0.72, blue: 1.0, alpha: 1.0))
        distance.textAlignment = .center
        distance.backgroundColor = UIColor.white.withAlphaComponent(isDark ? 0.12 : 0.34)
        distance.layer.cornerRadius = 10
        distance.clipsToBounds = true
        let phone = UIButton(type: .system)
        phone.translatesAutoresizingMaskIntoConstraints = false
        phone.setImage(UIImage(systemName: "phone.fill"), for: .normal)
        phone.tintColor = textColor
        phone.backgroundColor = UIColor.white.withAlphaComponent(isDark ? 0.12 : 0.30)
        phone.layer.cornerRadius = 10
        phone.layer.cornerCurve = .continuous
        phone.accessibilityLabel = "\(hospital.name) 전화 걸기"
        phone.addAction(UIAction { [weak self] _ in
            self?.confirmHospitalCall(hospital)
        }, for: .touchUpInside)
        let map = UIButton(type: .system)
        map.translatesAutoresizingMaskIntoConstraints = false
        map.setTitle("지도", for: .normal)
        map.titleLabel?.font = UIFont.systemFont(ofSize: 10, weight: .black)
        map.setTitleColor(textColor, for: .normal)
        map.backgroundColor = UIColor.white.withAlphaComponent(isDark ? 0.12 : 0.30)
        map.layer.cornerRadius = 10
        map.layer.cornerCurve = .continuous
        map.accessibilityLabel = "\(hospital.name) 지도 열기"
        map.addAction(UIAction { [weak self] _ in
            self?.openHospitalMap(query: hospital.mapQuery)
        }, for: .touchUpInside)
        let divider = UIView()
        divider.translatesAutoresizingMaskIntoConstraints = false
        divider.backgroundColor = UIColor.white.withAlphaComponent(isDark ? 0.10 : 0.16)

        row.addSubview(name)
        row.addSubview(address)
        row.addSubview(hours)
        row.addSubview(distance)
        row.addSubview(phone)
        row.addSubview(map)
        row.addSubview(divider)
        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 68),
            name.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            name.trailingAnchor.constraint(lessThanOrEqualTo: distance.leadingAnchor, constant: -8),
            name.topAnchor.constraint(equalTo: row.topAnchor, constant: 7),
            address.leadingAnchor.constraint(equalTo: name.leadingAnchor),
            address.trailingAnchor.constraint(lessThanOrEqualTo: phone.leadingAnchor, constant: -8),
            address.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 4),
            hours.leadingAnchor.constraint(equalTo: name.leadingAnchor),
            hours.trailingAnchor.constraint(lessThanOrEqualTo: phone.leadingAnchor, constant: -8),
            hours.topAnchor.constraint(equalTo: address.bottomAnchor, constant: 3),
            distance.centerYAnchor.constraint(equalTo: address.centerYAnchor),
            distance.trailingAnchor.constraint(equalTo: phone.leadingAnchor, constant: -8),
            distance.widthAnchor.constraint(equalToConstant: 58),
            distance.heightAnchor.constraint(equalToConstant: 26),
            phone.trailingAnchor.constraint(equalTo: map.leadingAnchor, constant: -6),
            phone.centerYAnchor.constraint(equalTo: address.centerYAnchor),
            phone.widthAnchor.constraint(equalToConstant: 36),
            phone.heightAnchor.constraint(equalToConstant: 32),
            map.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            map.centerYAnchor.constraint(equalTo: address.centerYAnchor),
            map.widthAnchor.constraint(equalToConstant: 48),
            map.heightAnchor.constraint(equalToConstant: 32),
            divider.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            divider.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            divider.bottomAnchor.constraint(equalTo: row.bottomAnchor),
            divider.heightAnchor.constraint(equalToConstant: 1)
        ])
        return row
    }

    private func dashboardNearbyHospitals() -> [DashboardNearbyHospital] {
        [
            DashboardNearbyHospital(name: "전남대학교병원 응급의료센터", address: "광주 동구 제봉로 42 전남대학교병원", distanceText: "1.1km", mapQuery: "전남대학교병원 응급의료센터", phoneNumber: "0622206801", openingHours: "24시간 응급진료", closedDays: "연중무휴"),
            DashboardNearbyHospital(name: "전남대학교병원 응급의료센터주차장입구", address: "광주 동구 제봉로 42", distanceText: "1.1km", mapQuery: "전남대학교병원 응급의료센터 주차장입구", phoneNumber: "0622205893", openingHours: "주차장 24시간", closedDays: "병원 운영일 기준"),
            DashboardNearbyHospital(name: "조선대학교병원 경증환자응급실", address: "광주 동구 필문대로 365", distanceText: "1.3km", mapQuery: "조선대학교병원 경증환자응급실", phoneNumber: "0622203280", openingHours: "24시간 응급진료", closedDays: "연중무휴"),
            DashboardNearbyHospital(name: "조선대학교병원 광주권역응급의료센터", address: "광주 동구 필문대로 365 조선대학교병원", distanceText: "1.4km", mapQuery: "조선대학교병원 광주권역응급의료센터", phoneNumber: "0622203280", openingHours: "24시간 응급진료", closedDays: "연중무휴"),
            DashboardNearbyHospital(name: "조대병원응급실_옥내", address: "광주 동구 필문대로 365", distanceText: "1.5km", mapQuery: "조대병원 응급실", phoneNumber: "0622203280", openingHours: "24시간 응급진료", closedDays: "연중무휴"),
            DashboardNearbyHospital(name: "광주기독병원 응급실", address: "광주 남구 양림로 37", distanceText: "2.4km", mapQuery: "광주기독병원 응급실", phoneNumber: "0626505000", openingHours: "24시간 응급진료", closedDays: "연중무휴"),
            DashboardNearbyHospital(name: "서광병원 응급실", address: "광주 서구 금화로59번길 6", distanceText: "5.8km", mapQuery: "서광병원 응급실", phoneNumber: "0626008000", openingHours: "24시간 응급진료", closedDays: "연중무휴")
        ]
    }

    @objc private func refreshNearbyHospitalPage() {
        dashboardWeatherPageIndex = 4
        buildInterface()
    }

    private func openHospitalMap(query: String) {
        let alert = UIAlertController(title: "지도 앱 선택", message: "\(query)을 열 지도 앱을 선택하세요.", preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "네이버지도", style: .default) { [weak self] _ in
            self?.openMapProvider(.naver, query: query)
        })
        alert.addAction(UIAlertAction(title: "카카오맵", style: .default) { [weak self] _ in
            self?.openMapProvider(.kakao, query: query)
        })
        alert.addAction(UIAlertAction(title: "Apple 지도", style: .default) { [weak self] _ in
            self?.openMapProvider(.apple, query: query)
        })
        alert.addAction(UIAlertAction(title: "Google 지도", style: .default) { [weak self] _ in
            self?.openMapProvider(.google, query: query)
        })
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = alert.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(alert, animated: true)
    }

    private func confirmHospitalCall(_ hospital: DashboardNearbyHospital) {
        let displayPhone = hospital.phoneNumber.chunkedPhoneNumber()
        let alert = UIAlertController(
            title: "\(hospital.name)으로 전화할까요?",
            message: "\(displayPhone)\n\(hospital.openingHours) · \(hospital.closedDays)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "아니오", style: .cancel))
        alert.addAction(UIAlertAction(title: "예", style: .default) { [weak self] _ in
            self?.openPhoneApp(number: hospital.phoneNumber)
        })
        present(alert, animated: true)
    }

    private func openPhoneApp(number: String) {
        let digits = number.filter(\.isNumber)
        guard let url = URL(string: "tel://\(digits)") else { return }
        UIApplication.shared.open(url)
    }

    private enum MapProvider {
        case naver
        case kakao
        case apple
        case google
    }

    private func openMapProvider(_ provider: MapProvider, query: String) {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? query
        let url: URL?
        switch provider {
        case .naver:
            url = URL(string: "https://map.naver.com/v5/search/\(encoded)")
        case .kakao:
            url = URL(string: "https://map.kakao.com/link/search/\(encoded)")
        case .apple:
            var components = URLComponents(string: "https://maps.apple.com/")
            components?.queryItems = [
                URLQueryItem(name: "q", value: query),
                URLQueryItem(name: "dirflg", value: "d")
            ]
            url = components?.url
        case .google:
            var components = URLComponents(string: "https://www.google.com/maps/search/")
            components?.queryItems = [
                URLQueryItem(name: "api", value: "1"),
                URLQueryItem(name: "query", value: query)
            ]
            url = components?.url
        }
        guard let url else { return }
        UIApplication.shared.open(url)
    }

    private func dashboardRadarPage() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        let map = RadarMapCanvas(frameIndex: dashboardRadarFrameIndex, expanded: false)
        map.translatesAutoresizingMaskIntoConstraints = false
        map.layerMode = dashboardWeatherMapLayer
        map.weather = locationWeather
        map.currentCoordinate = dashboardCurrentCoordinate()
        map.showsInfoPanel = false
        map.addTarget(self, action: #selector(openDashboardRadarViewer), for: .touchUpInside)
        let infoPanel = weatherLayerInfoPanel(mode: dashboardWeatherMapLayer, weather: locationWeather, expanded: false)
        let play = dashboardRoundButton(
            text: dashboardRadarIsPlaying ? "Ⅱ" : "▶",
            background: UIColor(red: 0.16, green: 0.68, blue: 1.0, alpha: 1.0),
            foreground: .white
        )
        play.accessibilityLabel = dashboardRadarIsPlaying ? "레이더 일시정지" : "레이더 재생"
        play.addTarget(self, action: #selector(toggleDashboardRadarPlayback), for: .touchUpInside)

        let timeButtons = (0..<dashboardRadarFrameCount()).map { index -> UIButton in
            let time = dashboardRadarTimeTitle(at: index)
            let isSelected = index == min(max(0, dashboardRadarFrameIndex), dashboardRadarTimes.count - 1)
            let button = dashboardRoundButton(
                text: time,
                background: isSelected ? UIColor(red: 0.08, green: 0.66, blue: 0.44, alpha: 1.0) : tileColor,
                foreground: isSelected ? .white : secondaryTextColor
            )
            button.tag = index
            button.accessibilityLabel = "\(time) 레이더 보기"
            button.addTarget(self, action: #selector(selectDashboardRadarFrame(_:)), for: .touchUpInside)
            return button
        }
        let times = UIStackView(arrangedSubviews: timeButtons)
        times.translatesAutoresizingMaskIntoConstraints = false
        times.axis = .horizontal
        times.spacing = 7

        let timeScroll = UIScrollView()
        timeScroll.translatesAutoresizingMaskIntoConstraints = false
        timeScroll.showsHorizontalScrollIndicator = true
        timeScroll.alwaysBounceHorizontal = true
        timeScroll.addSubview(times)

        let layerStack = UIStackView()
        layerStack.translatesAutoresizingMaskIntoConstraints = false
        layerStack.axis = .horizontal
        layerStack.spacing = 7
        layerStack.alignment = .center
        layerStack.distribution = .equalSpacing
        for mode in WeatherMapLayer.allCases {
            let button = weatherLayerButton(mode: mode, compact: true)
            button.backgroundColor = mode == dashboardWeatherMapLayer ? mode.accentColor : UIColor.black.withAlphaComponent(isDark ? 0.42 : 0.12)
            button.addTarget(self, action: #selector(selectDashboardWeatherMapLayer(_:)), for: .touchUpInside)
            layerStack.addArrangedSubview(button)
        }
        let locationButton = UIButton(type: .system)
        locationButton.translatesAutoresizingMaskIntoConstraints = false
        locationButton.setImage(UIImage(systemName: "location.fill"), for: .normal)
        locationButton.tintColor = isDark ? .white : UIColor(red: 0.06, green: 0.10, blue: 0.14, alpha: 1)
        locationButton.backgroundColor = UIColor.black.withAlphaComponent(isDark ? 0.42 : 0.12)
        locationButton.layer.cornerRadius = 13
        locationButton.layer.cornerCurve = .continuous
        locationButton.accessibilityLabel = "현재 위치로 이동"
        locationButton.addTarget(self, action: #selector(recenterDashboardWeatherMap), for: .touchUpInside)
        locationButton.widthAnchor.constraint(equalToConstant: 26).isActive = true
        locationButton.heightAnchor.constraint(equalToConstant: 26).isActive = true
        layerStack.addArrangedSubview(locationButton)

        wrapper.addSubview(map)
        wrapper.addSubview(layerStack)
        wrapper.addSubview(infoPanel)
        wrapper.addSubview(play)
        wrapper.addSubview(timeScroll)
        NSLayoutConstraint.activate([
            map.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 32),
            map.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -32),
            map.topAnchor.constraint(equalTo: wrapper.topAnchor),
            map.bottomAnchor.constraint(equalTo: layerStack.topAnchor, constant: -7),
            layerStack.centerXAnchor.constraint(equalTo: map.centerXAnchor),
            layerStack.widthAnchor.constraint(lessThanOrEqualTo: map.widthAnchor),
            layerStack.heightAnchor.constraint(equalToConstant: 26),
            layerStack.bottomAnchor.constraint(equalTo: infoPanel.topAnchor, constant: -7),
            infoPanel.leadingAnchor.constraint(equalTo: map.leadingAnchor),
            infoPanel.trailingAnchor.constraint(equalTo: map.trailingAnchor),
            infoPanel.heightAnchor.constraint(equalToConstant: 42),
            infoPanel.bottomAnchor.constraint(equalTo: play.topAnchor, constant: -10),
            play.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            play.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor),
            play.widthAnchor.constraint(equalToConstant: 26),
            play.heightAnchor.constraint(equalToConstant: 26),
            timeScroll.leadingAnchor.constraint(equalTo: play.trailingAnchor, constant: 8),
            timeScroll.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            timeScroll.centerYAnchor.constraint(equalTo: play.centerYAnchor),
            timeScroll.heightAnchor.constraint(equalToConstant: 32),
            times.leadingAnchor.constraint(equalTo: timeScroll.contentLayoutGuide.leadingAnchor),
            times.trailingAnchor.constraint(equalTo: timeScroll.contentLayoutGuide.trailingAnchor),
            times.topAnchor.constraint(equalTo: timeScroll.contentLayoutGuide.topAnchor, constant: 3),
            times.bottomAnchor.constraint(equalTo: timeScroll.contentLayoutGuide.bottomAnchor, constant: -3),
            times.heightAnchor.constraint(equalTo: timeScroll.frameLayoutGuide.heightAnchor, constant: -6)
        ])
        return wrapper
    }

    private func dashboardTyphoonPage() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        let headline = dashboardInlineHeader(
            symbol: "tropicalstorm",
            title: "태풍 진로",
            detail: locationWeather.source,
            badge: "관제 대시보드",
            badgeAction: { [weak self] in self?.openDashboardLiveContent(.typhoon) }
        )
        let visibility = dashboardLiveContentToggle(.typhoon)
        let liveContent = dashboardInlineLiveContent(.typhoon)
        wrapper.addSubview(headline)
        wrapper.addSubview(visibility)
        wrapper.addSubview(liveContent)
        NSLayoutConstraint.activate([
            headline.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            headline.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            headline.topAnchor.constraint(equalTo: wrapper.topAnchor),
            headline.heightAnchor.constraint(equalToConstant: 24),
            visibility.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            visibility.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            visibility.topAnchor.constraint(equalTo: headline.bottomAnchor, constant: 3),
            visibility.heightAnchor.constraint(equalToConstant: 28),
            liveContent.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            liveContent.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            liveContent.topAnchor.constraint(equalTo: visibility.bottomAnchor, constant: 4),
            liveContent.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor)
        ])
        return wrapper
    }

    private func dashboardSpecialVideoPage() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        let headline = dashboardInlineHeader(
            symbol: "play.rectangle",
            title: "특보 대응 영상",
            detail: locationWeather.source,
            badge: "관제 대시보드",
            badgeAction: { [weak self] in self?.openDashboardLiveContent(.specialVideo) }
        )
        let visibility = dashboardLiveContentToggle(.specialVideo)
        let liveContent = dashboardInlineLiveContent(.specialVideo)
        wrapper.addSubview(headline)
        wrapper.addSubview(visibility)
        wrapper.addSubview(liveContent)
        NSLayoutConstraint.activate([
            headline.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            headline.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            headline.topAnchor.constraint(equalTo: wrapper.topAnchor),
            headline.heightAnchor.constraint(equalToConstant: 24),
            visibility.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            visibility.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            visibility.topAnchor.constraint(equalTo: headline.bottomAnchor, constant: 3),
            visibility.heightAnchor.constraint(equalToConstant: 28),
            liveContent.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            liveContent.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            liveContent.topAnchor.constraint(equalTo: visibility.bottomAnchor, constant: 4),
            liveContent.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor)
        ])
        return wrapper
    }

    private func dashboardProgressBar(title: String, value: String, progressFraction: CGFloat?, detail: String, trailing: String, colors: [UIColor]) -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        let titleLabel = label(title, size: 10, weight: .black, color: textColor)
        let valueLabel = label(value, size: 16, weight: .black, color: textColor)
        let detailLabel = label(detail, size: 9, weight: .bold, color: secondaryTextColor)
        let trailingLabel = label(trailing, size: 9, weight: .black, color: .white)
        trailingLabel.textAlignment = .right

        let bar = DashboardGradientProgressTrack(colors: colors, progressFraction: progressFraction)

        wrapper.addSubview(titleLabel)
        wrapper.addSubview(valueLabel)
        wrapper.addSubview(detailLabel)
        wrapper.addSubview(bar)
        bar.addSubview(trailingLabel)
        NSLayoutConstraint.activate([
            titleLabel.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            titleLabel.topAnchor.constraint(equalTo: wrapper.topAnchor),
            valueLabel.leadingAnchor.constraint(equalTo: titleLabel.trailingAnchor, constant: 6),
            valueLabel.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            detailLabel.leadingAnchor.constraint(equalTo: valueLabel.trailingAnchor, constant: 6),
            detailLabel.trailingAnchor.constraint(lessThanOrEqualTo: wrapper.trailingAnchor),
            detailLabel.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            bar.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
            bar.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 5),
            bar.heightAnchor.constraint(equalToConstant: 11),
            trailingLabel.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -7),
            trailingLabel.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            trailingLabel.leadingAnchor.constraint(greaterThanOrEqualTo: bar.leadingAnchor, constant: 8)
        ])
        return wrapper
    }

    private func dashboardStatTile(labelText: String, valueText: String) -> UIView {
        let tile = UIView()
        tile.translatesAutoresizingMaskIntoConstraints = false
        tile.backgroundColor = isDark ? UIColor.white.withAlphaComponent(0.06) : UIColor.black.withAlphaComponent(0.06)
        tile.layer.cornerRadius = 10
        tile.layer.cornerCurve = .continuous
        let title = label(labelText, size: 9, weight: .bold, color: secondaryTextColor)
        let value = label(valueText, size: 15, weight: .black, color: textColor)
        value.minimumScaleFactor = 0.55
        title.setContentCompressionResistancePriority(.required, for: .vertical)
        value.setContentCompressionResistancePriority(.required, for: .vertical)
        value.setContentHuggingPriority(.required, for: .vertical)
        tile.addSubview(title)
        tile.addSubview(value)
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 9),
            title.trailingAnchor.constraint(equalTo: tile.trailingAnchor, constant: -9),
            title.topAnchor.constraint(equalTo: tile.topAnchor, constant: 8),
            value.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            value.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            value.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 4),
            value.bottomAnchor.constraint(lessThanOrEqualTo: tile.bottomAnchor, constant: -8)
        ])
        return tile
    }

    private func dashboardRoundBadge(text: String, background: UIColor, foreground: UIColor) -> UILabel {
        let badge = UILabel()
        badge.translatesAutoresizingMaskIntoConstraints = false
        badge.text = text
        badge.textAlignment = .center
        badge.textColor = foreground
        badge.backgroundColor = background
        badge.font = UIFont.systemFont(ofSize: text.count > 2 ? 9 : 13, weight: .black)
        badge.layer.cornerRadius = 8
        badge.layer.cornerCurve = .continuous
        badge.clipsToBounds = true
        NSLayoutConstraint.activate([
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: text.count > 2 ? 42 : 26),
            badge.heightAnchor.constraint(equalToConstant: text.count > 2 ? 20 : 26)
        ])
        return badge
    }

    private func dashboardRoundButton(text: String, background: UIColor, foreground: UIColor) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle(text, for: .normal)
        button.setTitleColor(foreground, for: .normal)
        button.backgroundColor = background
        button.titleLabel?.font = UIFont.systemFont(ofSize: text.count > 2 ? 9 : 13, weight: .black)
        button.layer.cornerRadius = 8
        button.layer.cornerCurve = .continuous
        button.clipsToBounds = true
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: text.count > 2 ? 42 : 26),
            button.heightAnchor.constraint(equalToConstant: text.count > 2 ? 20 : 26)
        ])
        return button
    }

    private func radarBlob(color: UIColor) -> UIView {
        let blob = UIView()
        blob.translatesAutoresizingMaskIntoConstraints = false
        blob.backgroundColor = color
        blob.layer.cornerRadius = 8
        blob.layer.shadowColor = color.cgColor
        blob.layer.shadowOpacity = 0.70
        blob.layer.shadowRadius = 8
        blob.layer.shadowOffset = .zero
        return blob
    }

    private func dashboardInlineHeader(
        symbol: String,
        title: String,
        detail: String,
        badge: String?,
        badgeAction: (() -> Void)? = nil
    ) -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        let icon = UIImageView(image: UIImage(systemName: symbol))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.tintColor = textColor
        icon.contentMode = .scaleAspectFit
        let titleLabel = label(title, size: 11, weight: .black, color: textColor)
        let detailLabel = label(detail, size: 10, weight: .bold, color: secondaryTextColor)
        wrapper.addSubview(icon)
        wrapper.addSubview(titleLabel)
        wrapper.addSubview(detailLabel)
        var constraints: [NSLayoutConstraint] = [
            icon.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
            icon.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 15),
            icon.heightAnchor.constraint(equalToConstant: 15),
            titleLabel.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 6),
            titleLabel.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor),
            detailLabel.leadingAnchor.constraint(equalTo: titleLabel.trailingAnchor, constant: 4),
            detailLabel.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor)
        ]
        if let badge {
            let badgeView: UIView
            if let badgeAction {
                let badgeButton = UIButton(type: .system)
                badgeButton.translatesAutoresizingMaskIntoConstraints = false
                badgeButton.setTitle(badge, for: .normal)
                badgeButton.setTitleColor(.white, for: .normal)
                badgeButton.titleLabel?.font = UIFont.systemFont(ofSize: 9, weight: .black)
                badgeButton.addAction(UIAction { _ in badgeAction() }, for: .touchUpInside)
                badgeButton.accessibilityLabel = "\(title) 관제 대시보드 최신 정보 보기"
                badgeView = badgeButton
            } else {
                let badgeLabel = label(badge, size: 9, weight: .black, color: .white)
                badgeLabel.textAlignment = .center
                badgeView = badgeLabel
            }
            badgeView.backgroundColor = UIColor(red: 0.96, green: 0.62, blue: 0.0, alpha: 1.0)
            badgeView.layer.cornerRadius = 9
            badgeView.clipsToBounds = true
            wrapper.addSubview(badgeView)
            constraints.append(contentsOf: [
                badgeView.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
                badgeView.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor),
                badgeView.widthAnchor.constraint(equalToConstant: 72),
                badgeView.heightAnchor.constraint(equalToConstant: 19),
                detailLabel.trailingAnchor.constraint(lessThanOrEqualTo: badgeView.leadingAnchor, constant: -6)
            ])
        } else {
            constraints.append(detailLabel.trailingAnchor.constraint(lessThanOrEqualTo: wrapper.trailingAnchor))
        }
        NSLayoutConstraint.activate(constraints)
        return wrapper
    }

    private func dashboardEmptyState(symbol: String, title: String, detail: String) -> UIView {
        let box = UIView()
        box.translatesAutoresizingMaskIntoConstraints = false
        box.layer.cornerRadius = 8
        box.layer.cornerCurve = .continuous
        box.layer.borderWidth = 1
        box.layer.borderColor = UIColor.white.withAlphaComponent(isDark ? 0.10 : 0.24).cgColor
        box.backgroundColor = isDark ? UIColor.white.withAlphaComponent(0.035) : UIColor.black.withAlphaComponent(0.035)

        let icon = UIImageView(image: UIImage(systemName: symbol))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.tintColor = secondaryTextColor
        icon.contentMode = .scaleAspectFit
        let titleLabel = label(title, size: 12, weight: .black, color: textColor)
        titleLabel.textAlignment = .center
        titleLabel.isHidden = title.isEmpty
        let detailLabel = label(detail, size: 10, weight: .bold, color: secondaryTextColor)
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 3

        box.addSubview(icon)
        box.addSubview(titleLabel)
        box.addSubview(detailLabel)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: box.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: box.centerYAnchor, constant: title.isEmpty ? -12 : -24),
            icon.widthAnchor.constraint(equalToConstant: 20),
            icon.heightAnchor.constraint(equalToConstant: 20),
            titleLabel.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 12),
            titleLabel.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -12),
            titleLabel.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 7),
            detailLabel.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 12),
            detailLabel.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -12),
            detailLabel.topAnchor.constraint(equalTo: title.isEmpty ? icon.bottomAnchor : titleLabel.bottomAnchor, constant: 7)
        ])
        return box
    }

    private func actionPanel() -> UIView {
        return actionPanel(showManagerCall: false)
    }

    private func actionPanel(showManagerCall: Bool) -> UIView {
        let panel = panelView(height: showManagerCall ? 124 : 104)
        let title = label("대시보드 연동", size: 17, weight: .black, color: textColor)
        let endpoint = label(endpointText, size: 10, weight: .semibold, color: secondaryTextColor)
        let compactButton = true
        let start = buttonPillForActionRow("수집 시작", foreground: canvas, background: ink, compact: compactButton)
        let fall = buttonPillForActionRow("낙상 시연", foreground: textColor, background: tileColor, compact: compactButton)
        let call = buttonPillForActionRow("관리자 호출", foreground: canvas, background: ink, compact: compactButton)
        let share = buttonPillForActionRow("위치 공유", foreground: textColor, background: tileColor, compact: compactButton)
        let sos = buttonPillForActionRow("SOS", foreground: canvas, background: sale, compact: compactButton)
        start.addTarget(self, action: #selector(startDashboardCollection), for: .touchUpInside)
        fall.addTarget(self, action: #selector(showFallDemo), for: .touchUpInside)
        sos.addTarget(self, action: #selector(showSOS), for: .touchUpInside)
        call.addTarget(self, action: #selector(showCall), for: .touchUpInside)
        share.addTarget(self, action: #selector(showShare), for: .touchUpInside)

        let row = UIStackView()
        row.translatesAutoresizingMaskIntoConstraints = false
        row.axis = .horizontal
        row.alignment = .fill
        row.spacing = 8
        row.distribution = .fillEqually
        row.addArrangedSubview(start)
        row.addArrangedSubview(fall)
        row.addArrangedSubview(call)  // showManagerCall mode only
        row.addArrangedSubview(share)
        row.addArrangedSubview(sos)

        panel.addSubview(title)
        panel.addSubview(endpoint)
        panel.addSubview(row)

        if showManagerCall {
            call.isHidden = false
        } else {
            call.isHidden = true
        }

        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 16),
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 13),
            endpoint.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            endpoint.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -16),
            endpoint.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 5),
            row.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 16),
            row.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -16),
            row.topAnchor.constraint(equalTo: endpoint.bottomAnchor, constant: 7),
            row.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -12),
            row.heightAnchor.constraint(equalToConstant: compactButton ? 34 : 38)
        ])
        return panel
    }

    private func metric(_ title: String, _ value: String, _ unit: String, _ accent: UIColor) -> UIView {
        let tile = panelView(height: 104, color: tileColor)
        let labelTitle = label(title, size: 12, weight: .bold, color: secondaryTextColor)
        let labelValue = label(value, size: 28, weight: .black, color: textColor)
        let labelUnit = label(unit, size: 11, weight: .black, color: accent)
        let dot = UIView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.backgroundColor = accent
        dot.layer.cornerRadius = 5

        tile.addSubview(dot)
        tile.addSubview(labelTitle)
        tile.addSubview(labelValue)
        tile.addSubview(labelUnit)
        NSLayoutConstraint.activate([
            dot.topAnchor.constraint(equalTo: tile.topAnchor, constant: 16),
            dot.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 14),
            dot.widthAnchor.constraint(equalToConstant: 10),
            dot.heightAnchor.constraint(equalToConstant: 10),
            labelTitle.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 8),
            labelTitle.centerYAnchor.constraint(equalTo: dot.centerYAnchor),
            labelValue.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 14),
            labelValue.bottomAnchor.constraint(equalTo: tile.bottomAnchor, constant: -16),
            labelUnit.leadingAnchor.constraint(equalTo: labelValue.trailingAnchor, constant: 4),
            labelUnit.lastBaselineAnchor.constraint(equalTo: labelValue.lastBaselineAnchor)
        ])
        return tile
    }

    private func vitalTile(_ title: String, value: String, unit: String, accent: UIColor) -> UIView {
        let tile = UIView()
        tile.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(
            to: tile,
            cornerRadius: 22,
            fill: isDark ? UIColor.black.withAlphaComponent(0.18) : UIColor.white.withAlphaComponent(0.56),
            borderColor: glassStroke
        )

        let dot = UIView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.backgroundColor = accent
        dot.layer.cornerRadius = 4
        let titleLabel = label(title, size: 17, weight: .black, color: secondaryTextColor)
        let valueLabel = label(value, size: 17, weight: .black, color: textColor)
        let unitLabel = label(unit, size: 12, weight: .black, color: accent)

        tile.addSubview(dot)
        tile.addSubview(titleLabel)
        tile.addSubview(valueLabel)
        tile.addSubview(unitLabel)

        NSLayoutConstraint.activate([
            dot.topAnchor.constraint(equalTo: tile.topAnchor, constant: 12),
            dot.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 12),
            dot.widthAnchor.constraint(equalToConstant: 8),
            dot.heightAnchor.constraint(equalToConstant: 8),
            titleLabel.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 8),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: tile.trailingAnchor, constant: -12),
            titleLabel.centerYAnchor.constraint(equalTo: dot.centerYAnchor),
            valueLabel.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: 12),
            valueLabel.bottomAnchor.constraint(equalTo: tile.bottomAnchor, constant: -12),
            unitLabel.leadingAnchor.constraint(equalTo: valueLabel.trailingAnchor, constant: 4),
            unitLabel.trailingAnchor.constraint(lessThanOrEqualTo: tile.trailingAnchor, constant: -10),
            unitLabel.lastBaselineAnchor.constraint(equalTo: valueLabel.lastBaselineAnchor),
            tile.heightAnchor.constraint(equalToConstant: 62)
        ])
        return tile
    }

    private func workerRow(status: String, name: String, hr: String, spo2: String, color: UIColor) -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(
            to: row,
            cornerRadius: 24,
            fill: isDark ? UIColor.black.withAlphaComponent(0.18) : UIColor.white.withAlphaComponent(0.56),
            borderColor: glassStroke
        )

        let dot = UIView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.backgroundColor = color
        dot.layer.cornerRadius = 5
        let nameLabel = label(name, size: 15, weight: .black, color: textColor)
        let metrics = label("\(hr) · \(spo2)", size: 13, weight: .bold, color: secondaryTextColor)
        let statusLabel = label(status, size: 12, weight: .black, color: color)

        row.addSubview(dot)
        row.addSubview(nameLabel)
        row.addSubview(metrics)
        row.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            dot.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
            dot.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            dot.widthAnchor.constraint(equalToConstant: 10),
            dot.heightAnchor.constraint(equalToConstant: 10),
            nameLabel.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 10),
            nameLabel.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            statusLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 10),
            metrics.trailingAnchor.constraint(equalTo: statusLabel.trailingAnchor),
            metrics.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 3)
        ])
        return row
    }

    private func cctvStatusBox(count: Int, admin: Bool) -> UIView {
        let box = UIView()
        box.translatesAutoresizingMaskIntoConstraints = false
        box.backgroundColor = UIColor.black.withAlphaComponent(isDark ? 0.22 : 0.06)
        box.layer.cornerRadius = 18
        box.layer.cornerCurve = .continuous
        box.layer.borderWidth = 1
        box.layer.borderColor = glassStroke.cgColor

        let countLabel = cctvBadge("\(max(count, 0))개소", foreground: textColor, background: UIColor.black.withAlphaComponent(0.30))
        let detail = label(admin ? "이름 수정 · 클릭 확대 · AI 타일 연결 ON/OFF" : "근처 CCTV · 클릭 확대 · 영상 ON/OFF", size: 10, weight: .bold, color: secondaryTextColor)
        detail.textAlignment = .right
        box.addSubview(countLabel)
        box.addSubview(detail)
        NSLayoutConstraint.activate([
            countLabel.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 12),
            countLabel.centerYAnchor.constraint(equalTo: box.centerYAnchor),
            countLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 56),
            countLabel.heightAnchor.constraint(equalToConstant: 28),
            detail.leadingAnchor.constraint(greaterThanOrEqualTo: countLabel.trailingAnchor, constant: 10),
            detail.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -12),
            detail.centerYAnchor.constraint(equalTo: box.centerYAnchor)
        ])
        return box
    }

    private func cameraRow(feed: DashboardCCTVFeed) -> UIView {
        let row = CCTVFeedRowView(feed: feed)
        row.translatesAutoresizingMaskIntoConstraints = false
        row.backgroundColor = UIColor.black.withAlphaComponent(isDark ? 0.38 : 0.10)
        row.layer.cornerRadius = 10
        row.layer.cornerCurve = .continuous
        row.layer.borderColor = UIColor.white.withAlphaComponent(isDark ? 0.12 : 0.24).cgColor
        row.layer.borderWidth = 1
        row.clipsToBounds = true

        let header = UIView()
        header.translatesAutoresizingMaskIntoConstraints = false
        header.backgroundColor = UIColor.black.withAlphaComponent(0.34)
        let redDot = UIView()
        redDot.translatesAutoresizingMaskIntoConstraints = false
        redDot.backgroundColor = UIColor(red: 1.0, green: 0.28, blue: 0.30, alpha: 1.0)
        redDot.layer.cornerRadius = 3.5
        let nameLabel = label(feed.name, size: 9, weight: .black, color: textColor)
        let idLabel = label(feed.id, size: 8, weight: .bold, color: secondaryTextColor)
        idLabel.textAlignment = .right
        let onBadge = cctvBadge(isCCTVVideoEnabled ? " power ON" : "OFF", foreground: .white, background: isCCTVVideoEnabled ? UIColor(red: 0.0, green: 0.74, blue: 0.48, alpha: 1.0) : UIColor.white.withAlphaComponent(0.14), symbol: isCCTVVideoEnabled ? "power" : nil)
        let aiBadge = cctvBadge(cctvBadgeTitle(for: feed), foreground: .white, background: cctvBadgeColor(for: feed))

        let preview = UIView()
        preview.translatesAutoresizingMaskIntoConstraints = false
        preview.backgroundColor = UIColor.black.withAlphaComponent(0.28)

        let icon = UIImageView(image: UIImage(systemName: "video"))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.tintColor = UIColor.white.withAlphaComponent(0.42)
        icon.contentMode = .scaleAspectFit
        let message = label(cctvPreviewTitle(for: feed), size: 9, weight: .bold, color: secondaryTextColor)
        message.textAlignment = .center
        let endpoint = label(cctvPreviewSubtitle(for: feed), size: 7, weight: .semibold, color: secondaryTextColor.withAlphaComponent(0.56))
        endpoint.textAlignment = .center
        endpoint.numberOfLines = 1

        if isCCTVVideoEnabled, let streamURL = feed.streamURL {
            let player = AVPlayer(url: streamURL)
            let layer = AVPlayerLayer(player: player)
            layer.videoGravity = .resizeAspectFill
            preview.layer.insertSublayer(layer, at: 0)
            row.previewPlayer = player
            row.previewLayer = layer
            DispatchQueue.main.async {
                layer.frame = preview.bounds
                player.play()
            }
        } else if isCCTVVideoEnabled, let mjpegURL = feed.mjpegURL {
            let webView = vitalGuardCCTVWebView(for: mjpegURL)
            preview.addSubview(webView)
            NSLayoutConstraint.activate([
                webView.leadingAnchor.constraint(equalTo: preview.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: preview.trailingAnchor),
                webView.topAnchor.constraint(equalTo: preview.topAnchor),
                webView.bottomAnchor.constraint(equalTo: preview.bottomAnchor)
            ])
        }

        let live = label("● LIVE", size: 8, weight: .black, color: UIColor(red: 1.0, green: 0.27, blue: 0.29, alpha: 1.0))
        let time = label(cctvClockText(), size: 8, weight: .bold, color: secondaryTextColor)
        time.textAlignment = .right
        let hasLivePreview = isCCTVVideoEnabled && (feed.streamURL != nil || feed.mjpegURL != nil)

        row.addSubview(header)
        header.addSubview(redDot)
        header.addSubview(nameLabel)
        header.addSubview(idLabel)
        header.addSubview(onBadge)
        header.addSubview(aiBadge)
        row.addSubview(preview)
        if !hasLivePreview {
            preview.addSubview(icon)
            preview.addSubview(message)
            preview.addSubview(endpoint)
        }
        row.addSubview(live)
        row.addSubview(time)

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            header.topAnchor.constraint(equalTo: row.topAnchor),
            header.heightAnchor.constraint(equalToConstant: 27),
            redDot.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 7),
            redDot.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            redDot.widthAnchor.constraint(equalToConstant: 7),
            redDot.heightAnchor.constraint(equalToConstant: 7),
            nameLabel.leadingAnchor.constraint(equalTo: redDot.trailingAnchor, constant: 5),
            nameLabel.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            nameLabel.trailingAnchor.constraint(lessThanOrEqualTo: onBadge.leadingAnchor, constant: -4),
            idLabel.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -7),
            idLabel.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            idLabel.widthAnchor.constraint(equalToConstant: 42),
            aiBadge.trailingAnchor.constraint(equalTo: idLabel.leadingAnchor, constant: -4),
            aiBadge.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            aiBadge.widthAnchor.constraint(equalToConstant: 34),
            aiBadge.heightAnchor.constraint(equalToConstant: 21),
            onBadge.trailingAnchor.constraint(equalTo: aiBadge.leadingAnchor, constant: -4),
            onBadge.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            onBadge.widthAnchor.constraint(equalToConstant: isCCTVVideoEnabled ? 52 : 38),
            onBadge.heightAnchor.constraint(equalToConstant: 21),
            preview.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            preview.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            preview.topAnchor.constraint(equalTo: header.bottomAnchor),
            preview.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -22),
            live.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 8),
            live.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -6),
            time.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -8),
            time.centerYAnchor.constraint(equalTo: live.centerYAnchor),
            time.leadingAnchor.constraint(greaterThanOrEqualTo: live.trailingAnchor, constant: 8)
        ])

        if !hasLivePreview {
            NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: preview.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: preview.centerYAnchor, constant: -12),
            icon.widthAnchor.constraint(equalToConstant: 26),
            icon.heightAnchor.constraint(equalToConstant: 26),
            message.leadingAnchor.constraint(equalTo: preview.leadingAnchor, constant: 8),
            message.trailingAnchor.constraint(equalTo: preview.trailingAnchor, constant: -8),
            message.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 7),
            endpoint.leadingAnchor.constraint(equalTo: preview.leadingAnchor, constant: 8),
            endpoint.trailingAnchor.constraint(equalTo: preview.trailingAnchor, constant: -8),
            endpoint.topAnchor.constraint(equalTo: message.bottomAnchor, constant: 4),
            ])
        }

        row.isUserInteractionEnabled = true
        let tap = UITapGestureRecognizer(target: self, action: #selector(openCCTVViewerFromTap(_:)))
        row.addGestureRecognizer(tap)
        return row
    }

    private func cctvBadge(_ text: String, foreground: UIColor, background: UIColor, symbol: String? = nil) -> UILabel {
        let badge = UILabel()
        badge.translatesAutoresizingMaskIntoConstraints = false
        if let symbol {
            let attachment = NSTextAttachment()
            attachment.image = UIImage(systemName: symbol)?.withTintColor(foreground, renderingMode: .alwaysOriginal)
            attachment.bounds = CGRect(x: 0, y: -1.5, width: 10, height: 10)
            let value = NSMutableAttributedString(attachment: attachment)
            value.append(NSAttributedString(string: text, attributes: [.foregroundColor: foreground]))
            badge.attributedText = value
        } else {
            badge.text = text
            badge.textColor = foreground
        }
        badge.font = UIFont.systemFont(ofSize: 8, weight: .black)
        badge.textAlignment = .center
        badge.backgroundColor = background
        badge.layer.cornerRadius = 5
        badge.layer.cornerCurve = .continuous
        badge.clipsToBounds = true
        return badge
    }

    private func cctvBadgeTitle(for feed: DashboardCCTVFeed) -> String {
        let meta = "\(feed.name) \(feed.meta)".lowercased()
        if meta.contains("낙상") { return "낙상AI" }
        if meta.contains("ppe") || meta.contains("보호") { return "PPE" }
        if meta.contains("ai") || feed.order < 3 { return "AI" }
        return ""
    }

    private func cctvBadgeColor(for feed: DashboardCCTVFeed) -> UIColor {
        let title = cctvBadgeTitle(for: feed)
        if title.contains("낙상") { return UIColor(red: 0.94, green: 0.22, blue: 0.34, alpha: 1.0) }
        if title == "PPE" { return UIColor(red: 0.96, green: 0.62, blue: 0.0, alpha: 1.0) }
        if title == "AI" { return UIColor(red: 0.0, green: 0.74, blue: 0.48, alpha: 1.0) }
        return UIColor.clear
    }

    private func cctvPreviewTitle(for feed: DashboardCCTVFeed) -> String {
        if !isCCTVVideoEnabled {
            return (feed.streamURL == nil && feed.mjpegURL == nil) ? "샘플 영상" : "영상 OFF"
        }
        return (feed.streamURL == nil && feed.mjpegURL == nil) ? (feed.order < 3 ? "AI 서버 연결 대기" : "샘플 영상") : "실시간 영상"
    }

    private func cctvPreviewSubtitle(for feed: DashboardCCTVFeed) -> String {
        if let url = feed.streamURL {
            return url.host ?? url.absoluteString
        }
        if let url = feed.mjpegURL {
            return url.host ?? url.absoluteString
        }
        return feed.order < 3 ? "https://cctv-ai-569797426568.asia-northeast3.run.app" : "자체 카메라 연동 시 실시간"
    }

    private func cctvClockText() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "H시 m분 s초"
        return formatter.string(from: Date())
    }

    private func cctvEmptyRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(
            to: row,
            cornerRadius: 24,
            fill: isDark ? UIColor.black.withAlphaComponent(0.18) : UIColor.white.withAlphaComponent(0.56),
            borderColor: glassStroke
        )
        let icon = UIImageView(image: UIImage(systemName: "video.slash.fill"))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.tintColor = secondaryTextColor
        icon.contentMode = .scaleAspectFit
        let title = label("대시보드 CCTV 수신 대기", size: 13, weight: .black, color: textColor)
        let detail = label("ON 전환 또는 새로고침 후 실제 CCTV 목록만 표시됩니다.", size: 10, weight: .semibold, color: secondaryTextColor)
        row.addSubview(icon)
        row.addSubview(title)
        row.addSubview(detail)
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 16),
            icon.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 22),
            icon.heightAnchor.constraint(equalToConstant: 22),
            title.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12),
            title.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 10),
            detail.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            detail.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            detail.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 4)
        ])
        return row
    }

    private func cctvSortButton() -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setImage(UIImage(systemName: "gearshape.fill"), for: .normal)
        button.tintColor = textColor
        button.addTarget(self, action: #selector(openCCTVSortSettings), for: .touchUpInside)
        return button
    }

    private func cctvRefreshButton() -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        button.tintColor = textColor
        button.backgroundColor = UIColor.black.withAlphaComponent(isDark ? 0.22 : 0.07)
        button.layer.cornerRadius = 16
        button.layer.cornerCurve = .continuous
        button.layer.borderWidth = 1
        button.layer.borderColor = glassStroke.cgColor
        button.accessibilityLabel = "CCTV 연결 새로고침"
        button.addTarget(self, action: #selector(refreshCCTVFromButton(_:)), for: .touchUpInside)
        return button
    }

    private func cctvVideoToggle() -> UISegmentedControl {
        let segment = UISegmentedControl(items: ["ON", "OFF"])
        segment.translatesAutoresizingMaskIntoConstraints = false
        segment.selectedSegmentIndex = isCCTVVideoEnabled ? 0 : 1
        segment.selectedSegmentTintColor = isDark ? UIColor.white.withAlphaComponent(0.94) : UIColor.white.withAlphaComponent(0.96)
        segment.backgroundColor = UIColor.white.withAlphaComponent(isDark ? 0.32 : 0.58)
        segment.layer.cornerRadius = 18
        segment.layer.cornerCurve = .continuous
        segment.layer.masksToBounds = true
        segment.layer.borderColor = UIColor.white.withAlphaComponent(isDark ? 0.28 : 0.36).cgColor
        segment.layer.borderWidth = 0.8
        segment.setTitleTextAttributes([
            .foregroundColor: textColor,
            .font: UIFont.systemFont(ofSize: 13, weight: .black)
        ], for: .normal)
        segment.setTitleTextAttributes([
            .foregroundColor: ink,
            .font: UIFont.systemFont(ofSize: 13, weight: .black)
        ], for: .selected)
        segment.addTarget(self, action: #selector(cctvVideoSegmentChanged(_:)), for: .valueChanged)
        return segment
    }

    private func liveActivityToggle() -> UISegmentedControl {
        let segment = UISegmentedControl(items: ["ON", "OFF"])
        segment.translatesAutoresizingMaskIntoConstraints = false
        segment.selectedSegmentIndex = isLiveActivityEnabled ? 0 : 1
        segment.selectedSegmentTintColor = isDark ? UIColor.white.withAlphaComponent(0.94) : UIColor.white.withAlphaComponent(0.96)
        segment.backgroundColor = UIColor.white.withAlphaComponent(isDark ? 0.32 : 0.58)
        segment.layer.cornerRadius = 18
        segment.layer.cornerCurve = .continuous
        segment.layer.masksToBounds = true
        segment.layer.borderColor = UIColor.white.withAlphaComponent(isDark ? 0.28 : 0.36).cgColor
        segment.layer.borderWidth = 0.8
        segment.setTitleTextAttributes([
            .foregroundColor: textColor,
            .font: UIFont.systemFont(ofSize: 15, weight: .black)
        ], for: .normal)
        segment.setTitleTextAttributes([
            .foregroundColor: ink,
            .font: UIFont.systemFont(ofSize: 15, weight: .black)
        ], for: .selected)
        segment.addTarget(self, action: #selector(liveActivitySegmentChanged(_:)), for: .valueChanged)
        return segment
    }

    private func panelView(height: CGFloat?, color: UIColor? = nil) -> UIView {
        let panel = UIView()
        panel.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(
            to: panel,
            cornerRadius: 28,
            fill: color ?? glassFill,
            borderColor: glassStroke
        )
        if let height {
            NSLayoutConstraint.activate([
                panel.heightAnchor.constraint(equalToConstant: height)
            ])
        }
        return panel
    }

    private func applyGlass(to view: UIView, cornerRadius: CGFloat, fill: UIColor, borderColor: UIColor) {
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: isDark ? .systemThinMaterialDark : .systemThinMaterialLight))
        blur.translatesAutoresizingMaskIntoConstraints = false
        blur.isUserInteractionEnabled = false
        blur.layer.cornerRadius = cornerRadius
        blur.layer.cornerCurve = .continuous
        blur.clipsToBounds = true
        view.insertSubview(blur, at: 0)
        NSLayoutConstraint.activate([
            blur.topAnchor.constraint(equalTo: view.topAnchor),
            blur.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            blur.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            blur.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        view.backgroundColor = fill
        view.layer.cornerRadius = cornerRadius
        view.layer.cornerCurve = .continuous
        view.layer.borderColor = borderColor.cgColor
        view.layer.borderWidth = 0.7
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOpacity = isDark ? 0.18 : 0.08
        view.layer.shadowRadius = 18
        view.layer.shadowOffset = CGSize(width: 0, height: 8)
        view.clipsToBounds = true
    }

    private func label(_ text: String, size: CGFloat, weight: UIFont.Weight, color: UIColor) -> UILabel {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = text
        label.textColor = color
        label.font = UIFont.systemFont(ofSize: size, weight: weight)
        label.adjustsFontForContentSizeCategory = true
        label.adjustsFontSizeToFitWidth = true
        label.minimumScaleFactor = 0.78
        label.lineBreakMode = .byTruncatingTail
        return label
    }

    @objc private func openSettings() {
        let settings = PreviewSettingsViewController()
        settings.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        settings.onSave = { [weak self] in
            self?.applySavedTheme()
            self?.buildInterface()
        }
        settings.onThemeChange = { [weak self] in
            self?.applySavedTheme()
            self?.buildInterface()
        }
        settings.onLayoutChange = { [weak self] in
            self?.buildInterface()
        }
        let nav = UINavigationController(rootViewController: settings)
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    @objc private func openHomeLayout() {
        let controller = HomeLayoutViewController(mode: currentMode)
        controller.onSave = { [weak self] in
            self?.buildInterface()
        }
        let nav = UINavigationController(rootViewController: controller)
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    @objc private func cctvVideoSegmentChanged(_ sender: UISegmentedControl) {
        let wasEnabled = isCCTVVideoEnabled
        isCCTVVideoEnabled = sender.selectedSegmentIndex == 0
        UserDefaults.standard.set(isCCTVVideoEnabled, forKey: PreviewSettingsKey.cctvVideoEnabled)
        if isCCTVVideoEnabled && !wasEnabled {
            refreshDashboardCCTVIfNeeded(force: true)
        }
        buildInterface()
    }

    private func refreshTitle(for tab: MainTab) -> String {
        switch tab {
        case .home: return "홈 대시보드 새로고침 중"
        case .watch: return "Watch 데이터 새로고침 중"
        case .cctv: return "CCTV 연결 확인 중"
        case .wallet: return "Health/Wallet 정보 새로고침 중"
        case .settings: return "설정 상태 새로고침 중"
        }
    }

    @objc private func refreshCurrentTabFromPull(_ sender: UIRefreshControl) {
        switch activeMainTab {
        case .home:
            beginLocationWeatherRefresh(rebuildInterface: false)
            refreshDashboardCCTVIfNeeded(force: true)
            PhoneWatchBridge.shared.publishCurrentSession()
            startDashboardAutoSyncIfNeeded(force: true)
            refreshLiveActivity()
            finishPullRefresh(sender)
        case .watch:
            refreshWatchData(showStatus: false, rebuildInterface: false)
        case .cctv:
            refreshDashboardCCTVIfNeeded(force: true)
        case .wallet:
            PhoneWatchBridge.shared.publishCurrentSession()
            refreshLiveActivity()
            finishPullRefresh(sender)
        case .settings:
            PhoneWatchBridge.shared.publishCurrentSession()
            finishPullRefresh(sender)
        }
    }

    private func finishPullRefresh(_ sender: UIRefreshControl, minimumDuration: TimeInterval = 0.35) {
        DispatchQueue.main.asyncAfter(deadline: .now() + minimumDuration) { [weak sender] in
            sender?.endRefreshing()
        }
    }

    @objc private func refreshCCTVFromPull(_ sender: UIRefreshControl) {
        guard activeMainTab == .cctv else {
            sender.endRefreshing()
            return
        }
        refreshDashboardCCTVIfNeeded(force: true)
    }

    @objc private func refreshCCTVFromButton(_ sender: UIButton) {
        guard activeMainTab == .cctv else { return }
        sender.isEnabled = false
        UIView.animate(withDuration: 0.28) {
            sender.transform = CGAffineTransform(rotationAngle: .pi)
        } completion: { [weak self, weak sender] _ in
            sender?.transform = .identity
            sender?.isEnabled = true
            self?.refreshDashboardCCTVIfNeeded(force: true)
        }
    }

    @objc private func openCCTVSortSettings() {
        let alert = UIAlertController(title: "CCTV 정렬", message: "현장 CCTV 표시 순서를 선택하세요.", preferredStyle: .actionSheet)
        for mode in CCTVSortMode.allCases where mode != .custom {
            alert.addAction(UIAlertAction(title: mode.title, style: .default) { [weak self] _ in
                guard let self else { return }
                self.cctvSortMode = mode
                UserDefaults.standard.set(mode.rawValue, forKey: PreviewSettingsKey.cctvSortMode)
                self.buildInterface()
            })
        }
        alert.addAction(UIAlertAction(title: "사용자화 순서 편집", style: .default) { [weak self] _ in
            self?.presentCCTVOrderEditor()
        })
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = alert.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(alert, animated: true)
    }

    private func presentCCTVOrderEditor() {
        let feeds = displayedCCTVFeeds(admin: true)
        guard !feeds.isEmpty else {
            presentStatus("CCTV 사용자화", message: "대시보드 CCTV 목록을 먼저 수신해야 직접 배치할 수 있습니다.")
            return
        }
        let editor = CCTVOrderEditorController(feeds: feeds)
        editor.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        editor.onSave = { [weak self] ids in
            guard let self else { return }
            self.cctvCustomOrder = ids
            self.cctvSortMode = .custom
            UserDefaults.standard.set(ids, forKey: PreviewSettingsKey.cctvCustomOrder)
            UserDefaults.standard.set(CCTVSortMode.custom.rawValue, forKey: PreviewSettingsKey.cctvSortMode)
            self.buildInterface()
        }
        let nav = UINavigationController(rootViewController: editor)
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    @objc private func openCCTVViewerFromTap(_ gesture: UITapGestureRecognizer) {
        guard let row = gesture.view as? CCTVFeedRowView else { return }
        presentCCTVViewer(feed: row.feed, expanded: true)
    }

    private func presentCCTVViewer(feed: DashboardCCTVFeed, expanded: Bool) {
        let viewer = CCTVViewerController(feed: feed, startsExpanded: expanded)
        viewer.overrideUserInterfaceStyle = .dark
        viewer.modalPresentationStyle = .fullScreen
        present(viewer, animated: true)
    }

    @objc private func liveActivitySegmentChanged(_ sender: UISegmentedControl) {
        isLiveActivityEnabled = sender.selectedSegmentIndex == 0
        UserDefaults.standard.set(isLiveActivityEnabled, forKey: PreviewSettingsKey.liveActivityEnabled)
        if isLiveActivityEnabled {
            refreshLiveActivity()
        } else if #available(iOS 16.2, *) {
            VitAlGuardLiveActivityManager.shared.end()
        }
        buildInterface()
    }

    @objc private func consumePendingQuickAction() {
        guard presentedViewController == nil, let action = VitAlGuardSharedStorage.consumeQuickAction() else { return }
        guard loggedInID != nil else {
            presentStatus("VitAlGuard \(action.title)", message: "로그인 후 \(action.title) 액션을 실행할 수 있습니다.")
            return
        }
        switch action {
        case .sos:
            showSOS()
        case .callManager:
            showCall()
        case .shareLocation:
            showShare()
        case .openCamera:
            startMediaCapture(mode: .mediaPhoto)
        case .scanQRCode:
            startQRCodeScan()
        }
    }

    @objc private func openScanMenu() {
        guard loggedInID != nil else {
            presentStatus("문서/사진 스캔", message: "로그인 후 이용할 수 있습니다.")
            return
        }
        guard presentedViewController == nil else {
            return
        }

        let menu = UIAlertController(
            title: "빠른 실행",
            message: "원하는 기능을 선택해 주세요.",
            preferredStyle: .actionSheet
        )
        menu.addAction(UIAlertAction(title: "AED Alert", style: .destructive, handler: { [weak self] _ in
            self?.triggerAedAlert()
        }))
        menu.addAction(UIAlertAction(title: "OCR 스캔 및 PDF 파일로 저장", style: .default, handler: { [weak self] _ in
            self?.openPdfSaveMenu()
        }))
        menu.addAction(UIAlertAction(title: "카메라 실행 및 촬영 후 저장(사진 및 비디오)", style: .default, handler: { [weak self] _ in
            self?.openMediaCaptureMenu()
        }))
        menu.addAction(UIAlertAction(title: "이미지/비디오 업로드", style: .default, handler: { [weak self] _ in
            self?.startPhotoLibraryWatermarkUpload()
        }))
        menu.addAction(UIAlertAction(title: "문서/파일 업로드", style: .default, handler: { [weak self] _ in
            self?.startStandaloneFileUpload()
        }))
        menu.addAction(UIAlertAction(title: "QR코드 스캔 및 링크 열기", style: .default, handler: { [weak self] _ in
            self?.startQRCodeScan()
        }))
        let nfcTitle = isNFCFeatureEnabled ? "NFC 스티커 스캔 후 일지 작성" : "NFC 스티커 일지 작성(권한 준비 후 사용)"
        menu.addAction(UIAlertAction(title: nfcTitle, style: .default, handler: { [weak self] _ in
            self?.startNFCStickerScan()
        }))
        menu.addAction(UIAlertAction(title: "NFC 일지 작성 테스트", style: .default, handler: { [weak self] _ in
            self?.presentFieldJournalEditor(
                calendarURL: URL(string: "\(VitalGuardLinks.safetyMonitor)/#app-media-calendar"),
                tagText: "simulator://vitalguard-nfc-journal"
            )
        }))
        menu.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let pop = menu.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: 38, y: 38, width: 1, height: 1)
        }
        present(menu, animated: true)
    }

    private func startQRCodeScan() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            presentStatus("QR 스캔 불가", message: "이 기기에서는 카메라 QR 스캔을 사용할 수 없습니다.")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            presentQRCodeScanner()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    granted ? self?.presentQRCodeScanner() : self?.presentStatus("카메라 권한 필요", message: "QR코드를 스캔하려면 카메라 접근을 허용해 주세요.")
                }
            }
        case .denied, .restricted:
            presentStatus("카메라 권한 필요", message: "iPhone 설정에서 VitAlGuard 카메라 권한을 허용하면 QR 스캔을 사용할 수 있습니다.")
        @unknown default:
            presentStatus("QR 스캔", message: "카메라 권한 상태를 확인할 수 없습니다.")
        }
    }

    private func presentQRCodeScanner() {
        let session = AVCaptureSession()
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input)
        else {
            presentStatus("QR 스캔 불가", message: "카메라 입력을 준비할 수 없습니다.")
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            presentStatus("QR 스캔 불가", message: "QR 메타데이터 출력을 준비할 수 없습니다.")
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = output.availableMetadataObjectTypes.contains(.qr) ? [.qr] : output.availableMetadataObjectTypes

        let scanner = UIViewController()
        scanner.view.backgroundColor = .black
        scanner.title = "QR코드 스캔"
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        scanner.view.layer.addSublayer(preview)

        let guide = UILabel()
        guide.translatesAutoresizingMaskIntoConstraints = false
        guide.text = "VitAlGuard QR코드를 화면 중앙에 맞춰 주세요."
        guide.textColor = .white
        guide.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        guide.textAlignment = .center
        guide.numberOfLines = 2
        guide.backgroundColor = UIColor.black.withAlphaComponent(0.48)
        guide.layer.cornerRadius = 18
        guide.layer.cornerCurve = .continuous
        guide.clipsToBounds = true
        scanner.view.addSubview(guide)
        NSLayoutConstraint.activate([
            guide.leadingAnchor.constraint(equalTo: scanner.view.leadingAnchor, constant: 24),
            guide.trailingAnchor.constraint(equalTo: scanner.view.trailingAnchor, constant: -24),
            guide.bottomAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.bottomAnchor, constant: -28),
            guide.heightAnchor.constraint(greaterThanOrEqualToConstant: 58)
        ])

        let close = UIButton(type: .system)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.setTitle("닫기", for: .normal)
        close.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .black)
        close.tintColor = .white
        close.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        close.layer.cornerRadius = 18
        close.layer.cornerCurve = .continuous
        close.addAction(UIAction { [weak self] _ in self?.dismissQRCodeScanner() }, for: .touchUpInside)
        scanner.view.addSubview(close)
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.topAnchor, constant: 18),
            close.trailingAnchor.constraint(equalTo: scanner.view.trailingAnchor, constant: -18),
            close.widthAnchor.constraint(equalToConstant: 76),
            close.heightAnchor.constraint(equalToConstant: 44)
        ])

        qrCaptureSession = session
        qrScannerOverlay = scanner.view
        scanner.modalPresentationStyle = .fullScreen
        present(scanner, animated: true) { session.startRunning() }
    }

    private func dismissQRCodeScanner() {
        qrCaptureSession?.stopRunning()
        qrCaptureSession = nil
        qrScannerOverlay = nil
        presentedViewController?.dismiss(animated: true)
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let value = metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
        qrCaptureSession?.stopRunning()
        qrCaptureSession = nil
        qrScannerOverlay = nil
        presentedViewController?.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            if let url = URL(string: value), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) {
                self.presentStatus("QR 스캔 완료", message: "QR URL을 열었습니다.\n\(url.absoluteString)")
                UIApplication.shared.open(url)
            } else {
                self.presentStatus("QR 스캔 완료", message: value)
            }
        }
    }

    private func startNFCStickerScan() {
        startNFCStickerScan(requestId: nil)
    }

    @objc private func handleWatchNFCScanRequest(_ notification: Notification) {
        let requestId = notification.userInfo?["requestId"] as? String
        startNFCStickerScan(requestId: requestId)
    }

    private func startNFCStickerScan(requestId: String?) {
        guard NFCNDEFReaderSession.readingAvailable else {
            let message = "이 기기 또는 현재 지역 설정에서는 NFC NDEF 읽기를 사용할 수 없습니다."
            presentStatus("NFC 스캔 불가", message: message)
            PhoneWatchBridge.shared.sendWatchNFCScanResult(status: "unavailable", message: message, requestId: requestId)
            return
        }
        guard nfcReaderSession == nil else {
            presentStatus("NFC 스캔", message: "이미 NFC 태그를 기다리고 있습니다.")
            return
        }
        pendingNFCRequestId = requestId
        let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: true)
        session.alertMessage = "VitAlGuard 현장 NFC 스티커를 iPhone 상단에 가까이 대세요."
        nfcReaderSession = session
        session.begin()
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        let requestId = pendingNFCRequestId
        pendingNFCRequestId = nil
        nfcReaderSession = nil
        let nsError = error as NSError
        guard nsError.code != NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue else { return }
        let message: String
        if nsError.code == NFCReaderError.readerSessionInvalidationErrorSessionTerminatedUnexpectedly.rawValue
            || nsError.code == NFCReaderError.readerErrorSecurityViolation.rawValue {
            message = "NFC Tag Reading capability와 프로비저닝 프로파일에 NDEF entitlement가 필요합니다."
        } else {
            message = error.localizedDescription
        }
        DispatchQueue.main.async { [weak self] in
            self?.presentStatus("NFC 스캔 실패", message: message)
        }
        PhoneWatchBridge.shared.sendWatchNFCScanResult(status: "failed", message: message, requestId: requestId)
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        let result = parseNFCMessages(messages)
        let requestId = pendingNFCRequestId
        pendingNFCRequestId = nil
        nfcReaderSession = nil
        PhoneWatchBridge.shared.sendWatchNFCScanResult(
            status: "success",
            message: "NFC 태그 정보를 확인했습니다.",
            tagText: result.text,
            url: result.url?.absoluteString,
            requestId: requestId
        )
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.presentFieldJournalEditor(calendarURL: result.url, tagText: result.text)
        }
    }

    private func presentFieldJournalEditor(calendarURL: URL?, tagText: String) {
        guard loggedInID != nil else {
            presentStatus("NFC 현장 일지", message: "로그인 후 NFC 스티커 일지를 작성할 수 있습니다.")
            return
        }
        let editor = FieldJournalEntryViewController(calendarURL: calendarURL, tagText: tagText)
        editor.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        editor.onSubmit = { [weak self] entry, completion in
            self?.uploadFieldJournalEntry(entry, completion: completion)
        }
        editor.onAttachmentRequest = { [weak self] source, editor in
            self?.startJournalAttachment(source, editor: editor)
        }
        let nav = UINavigationController(rootViewController: editor)
        nav.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    private func startJournalAttachment(_ source: FieldJournalAttachmentSource, editor: FieldJournalEntryViewController) {
        activeJournalEditor = editor
        activeCalendarCommentComposer = nil
        startSharedCalendarAttachment(source)
    }

    private func startCalendarCommentAttachment(_ source: FieldJournalAttachmentSource, composer: CalendarCommentComposerViewController) {
        activeCalendarCommentComposer = composer
        activeJournalEditor = nil
        startSharedCalendarAttachment(source)
    }

    private func startSharedCalendarAttachment(_ source: FieldJournalAttachmentSource) {
        switch source {
        case .photo:
            pendingJournalAttachmentMode = .mediaPhoto
            startMediaCapture(mode: .mediaPhoto)
        case .video:
            pendingJournalAttachmentMode = .mediaVideo
            startMediaCapture(mode: .mediaVideo)
        case .document:
            pendingJournalAttachmentMode = .documentOCR
            startDocumentScan()
        case .file:
            pendingJournalAttachmentMode = .none
            startJournalFileImport()
        }
    }

    private func startJournalFileImport() {
        isJournalFileImportActive = true
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = true
        present(picker, animated: true)
    }

    private func finishJournalAttachment(_ attachment: FieldJournalAttachment) {
        activeJournalEditor?.addAttachment(attachment)
        activeCalendarCommentComposer?.addAttachment(attachment)
        activeJournalEditor = nil
        activeCalendarCommentComposer = nil
        pendingJournalAttachmentMode = .none
        isJournalFileImportActive = false
        presentStatus("첨부 완료", message: "\(attachment.fileName)이 작성 중인 항목에 첨부되었습니다.")
    }

    private func cancelJournalAttachmentIfNeeded() {
        pendingJournalAttachmentMode = .none
        isJournalFileImportActive = false
        activeCalendarCommentComposer = nil
    }

    private func isCapturingJournalAttachment(_ mode: ScanMode) -> Bool {
        (activeJournalEditor != nil || activeCalendarCommentComposer != nil) && pendingJournalAttachmentMode == mode
    }

    private func makeJournalAttachment(
        kind: String,
        title: String,
        fileURL: URL,
        mimeType: String,
        capturedAt: Date,
        note: String
    ) -> FieldJournalAttachment {
        let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
        let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
        return FieldJournalAttachment(
            kind: kind,
            title: title,
            fileName: fileURL.lastPathComponent,
            mimeType: mimeType,
            byteSize: size,
            localURL: fileURL,
            capturedAt: capturedAt,
            note: note
        )
    }

    private func copyJournalImportIfNeeded(_ sourceURL: URL) -> URL {
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("vitalguard_journal_\(UUID().uuidString)_\(sourceURL.lastPathComponent)")
        do {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.copyItem(at: sourceURL, to: destination)
            return destination
        } catch {
            return sourceURL
        }
    }

    private func parseNFCMessages(_ messages: [NFCNDEFMessage]) -> (text: String, url: URL?) {
        var values: [String] = []
        var firstURL: URL?
        for message in messages {
            for record in message.records {
                if firstURL == nil, let url = record.wellKnownTypeURIPayload() {
                    firstURL = url
                    values.append(url.absoluteString)
                    continue
                }
                if let text = textPayload(from: record), !text.isEmpty {
                    values.append(text)
                    continue
                }
                if let fallback = String(data: record.payload, encoding: .utf8)?
                    .trimmingCharacters(in: .controlCharacters.union(.whitespacesAndNewlines)),
                   !fallback.isEmpty {
                    values.append(fallback)
                }
            }
        }
        if firstURL == nil {
            firstURL = values.compactMap(URL.init(string:)).first
        }
        return (values.joined(separator: "\n"), firstURL)
    }

    private func textPayload(from record: NFCNDEFPayload) -> String? {
        let typeText = String(data: record.type, encoding: .utf8)
        guard record.typeNameFormat == .nfcWellKnown, typeText == "T" else { return nil }
        let bytes = [UInt8](record.payload)
        guard let status = bytes.first else { return nil }
        let languageLength = Int(status & 0x3F)
        let isUTF16 = (status & 0x80) != 0
        guard bytes.count > languageLength + 1 else { return nil }
        let textData = Data(bytes[(languageLength + 1)...])
        let encoding: String.Encoding = isUTF16 ? .utf16 : .utf8
        return String(data: textData, encoding: encoding)?
            .trimmingCharacters(in: .controlCharacters.union(.whitespacesAndNewlines))
    }

    private func openPdfSaveMenu() {
        guard !isUploadBusy else {
            presentStatus("문서/사진 스캔", message: "현재 처리 중입니다. 잠시 후 다시 시도해 주세요.")
            return
        }

        let menu = UIAlertController(title: "문서 스캔", message: "문서를 OCR 후 PDF로 변환해 저장합니다.", preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "PDF 파일로 저장", style: .default, handler: { [weak self] _ in
            self?.startDocumentScan()
        }))
        menu.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let pop = menu.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: 38, y: 38, width: 1, height: 1)
        }
        present(menu, animated: true)
    }

    private func openMediaCaptureMenu() {
        guard !isUploadBusy else {
            presentStatus("문서/사진 스캔", message: "현재 처리 중입니다. 잠시 후 다시 시도해 주세요.")
            return
        }

        let menu = UIAlertController(title: "카메라 실행", message: "사진/비디오 촬영 후 파일 앱 또는 저장 갤러리에 저장합니다.", preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "사진 촬영 후 저장", style: .default, handler: { [weak self] _ in
            self?.startMediaCapture(mode: .mediaPhoto)
        }))
        menu.addAction(UIAlertAction(title: "비디오 촬영 후 저장", style: .default, handler: { [weak self] _ in
            self?.startMediaCapture(mode: .mediaVideo)
        }))
        menu.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let pop = menu.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: 38, y: 38, width: 1, height: 1)
        }
        present(menu, animated: true)
    }

    private func startPhotoLibraryWatermarkUpload() {
        guard !isUploadBusy else {
            presentStatus("이미지/비디오 업로드", message: "현재 처리 중입니다. 잠시 후 다시 시도해 주세요.")
            return
        }
        guard UIImagePickerController.isSourceTypeAvailable(.photoLibrary) else {
            presentStatus("이미지/비디오 업로드", message: "이 기기에서 사진 보관함을 열 수 없습니다.")
            return
        }
        requestLocationPermissionForWatermark()
        isPhotoLibraryUploadActive = true
        let picker = UIImagePickerController()
        picker.sourceType = .photoLibrary
        if #available(iOS 14.0, *) {
            picker.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
        } else {
            picker.mediaTypes = ["public.image", "public.movie"]
        }
        picker.allowsEditing = false
        picker.delegate = self
        present(picker, animated: true)
    }

    private func startStandaloneFileUpload() {
        guard !isUploadBusy else {
            presentStatus("문서/파일 업로드", message: "현재 처리 중입니다. 잠시 후 다시 시도해 주세요.")
            return
        }
        isStandaloneFileUploadActive = true
        requestLocationPermissionForWatermark()
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    private func handleImportedImageUpload(_ image: UIImage) {
        guard !isUploadBusy else { return }
        isUploadBusy = true
        presentStatus("이미지 업로드", message: "선택한 이미지에 워터마크를 적용하고 관제 웹 대시보드에 업로드합니다.")
        Task { [weak self] in
            guard let self else { return }
            do {
                let capturedAt = Date()
                let metadata = await self.appMediaCaptureMetadata(capturedAt: capturedAt)
                let watermarkedImage = await self.makeWatermarkedPhoto(from: image, metadata: metadata)
                let ocrText = self.extractOCRText(from: [watermarkedImage])
                guard let data = watermarkedImage.jpegData(compressionQuality: 0.95) else {
                    throw NSError(domain: "VitAlGuard", code: -1, userInfo: [NSLocalizedDescriptionKey: "이미지 인코딩에 실패했습니다."])
                }
                let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("vitalguard_import_image_\(Int(Date().timeIntervalSince1970)).jpg")
                try data.write(to: fileURL, options: .atomic)
                await MainActor.run {
                    self.isUploadBusy = false
                    self.uploadAppMedia(self.uploadPayload(kind: "photo", title: "이미지 업로드 증빙", fileURL: fileURL, mimeType: "image/jpeg", ocrText: ocrText, metadata: metadata))
                    self.presentCapturePreview(.photo(watermarkedImage, data))
                }
            } catch {
                await MainActor.run {
                    self.isUploadBusy = false
                    self.presentStatus("이미지 업로드", message: "업로드 준비 실패: \(error.localizedDescription)")
                }
            }
        }
    }

    private func handleImportedVideoUpload(_ sourceURL: URL) {
        guard !isUploadBusy else { return }
        isUploadBusy = true
        presentStatus("비디오 업로드", message: "선택한 비디오에 워터마크를 적용하고 관제 웹 대시보드에 업로드합니다.")
        let copiedURL = copyImportToTemporary(sourceURL, prefix: "vitalguard_import_video")
        Task { [weak self] in
            guard let self else { return }
            let capturedAt = Date()
            let metadata = await self.appMediaCaptureMetadata(capturedAt: capturedAt)
            let outputURL = await self.makeWatermarkedVideo(from: copiedURL, metadata: metadata)
            let finalURL = outputURL ?? copiedURL
            await MainActor.run {
                self.isUploadBusy = false
                self.uploadAppMedia(self.uploadPayload(kind: "video", title: "비디오 업로드 증빙", fileURL: finalURL, mimeType: self.mimeTypeForMediaFile(finalURL), ocrText: "", metadata: metadata))
                self.presentCapturePreview(.video(finalURL, cleanup: [copiedURL, outputURL].compactMap { $0 }))
            }
        }
    }

    private func handleStandaloneFileUpload(_ sourceURL: URL) {
        guard !isUploadBusy else { return }
        isUploadBusy = true
        presentStatus("문서/파일 업로드", message: "선택한 파일을 관제 웹 대시보드에 업로드할 준비를 합니다.")
        let copiedURL = copyImportToTemporary(sourceURL, prefix: "vitalguard_import_file")
        Task { [weak self] in
            guard let self else { return }
            let capturedAt = Date()
            let metadata = await self.appMediaCaptureMetadata(capturedAt: capturedAt)
            do {
                let prepared: (url: URL, mime: String, kind: String, title: String, ocr: String)
                if self.isImageFile(copiedURL), let image = UIImage(contentsOfFile: copiedURL.path) {
                    let watermarked = await self.makeWatermarkedPhoto(from: image, metadata: metadata)
                    let data = watermarked.jpegData(compressionQuality: 0.95) ?? Data()
                    let output = FileManager.default.temporaryDirectory.appendingPathComponent("vitalguard_file_image_\(Int(Date().timeIntervalSince1970)).jpg")
                    try data.write(to: output, options: .atomic)
                    prepared = (output, "image/jpeg", "photo", "이미지 파일 업로드 증빙", self.extractOCRText(from: [watermarked]))
                } else if self.isVideoFile(copiedURL) {
                    let output = await self.makeWatermarkedVideo(from: copiedURL, metadata: metadata) ?? copiedURL
                    prepared = (output, self.mimeTypeForMediaFile(output), "video", "비디오 파일 업로드 증빙", "")
                } else if copiedURL.pathExtension.lowercased() == "pdf",
                          let watermarkedPDF = try await self.makeWatermarkedPDFIfPossible(from: copiedURL, metadata: metadata) {
                    prepared = (watermarkedPDF, "application/pdf", "document", "문서 파일 업로드 증빙", "")
                } else {
                    prepared = (copiedURL, self.mimeTypeForMediaFile(copiedURL), "file", "파일 업로드 증빙", "원본 파일입니다. 워터마크를 직접 입힐 수 없는 파일 형식이라 관제 메타데이터와 함께 업로드했습니다.")
                }
                await MainActor.run {
                    self.isUploadBusy = false
                    self.uploadAppMedia(self.uploadPayload(kind: prepared.kind, title: prepared.title, fileURL: prepared.url, mimeType: prepared.mime, ocrText: prepared.ocr, metadata: metadata))
                    self.presentStatus("문서/파일 업로드", message: "\(prepared.url.lastPathComponent)을 관제 웹 대시보드에 업로드했습니다.")
                }
            } catch {
                await MainActor.run {
                    self.isUploadBusy = false
                    self.presentStatus("문서/파일 업로드", message: "업로드 준비 실패: \(error.localizedDescription)")
                }
            }
        }
    }

    private func uploadPayload(
        kind: String,
        title: String,
        fileURL: URL,
        mimeType: String,
        ocrText: String,
        metadata: AppMediaCaptureMetadata
    ) -> AppMediaUploadPayload {
        AppMediaUploadPayload(
            kind: kind,
            title: title,
            fileURL: fileURL,
            mimeType: mimeType,
            ocrText: ocrText,
            capturedAt: metadata.capturedAt,
            timeZone: metadata.timeZone,
            roadAddress: metadata.roadAddress,
            location: metadata.location,
            workerId: currentWorkerIdForUpload(),
            workerName: currentWorkerNameForUpload()
        )
    }

    private func copyImportToTemporary(_ sourceURL: URL, prefix: String) -> URL {
        let ext = sourceURL.pathExtension
        let fileName = "\(prefix)_\(UUID().uuidString.lowercased())\(ext.isEmpty ? "" : ".\(ext)")"
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do {
            try FileManager.default.copyItem(at: sourceURL, to: destination)
            return destination
        } catch {
            return sourceURL
        }
    }

    private func isImageFile(_ url: URL) -> Bool {
        if let type = UTType(filenameExtension: url.pathExtension), type.conforms(to: .image) {
            return true
        }
        return ["jpg", "jpeg", "png", "heic", "heif", "webp"].contains(url.pathExtension.lowercased())
    }

    private func isVideoFile(_ url: URL) -> Bool {
        if let type = UTType(filenameExtension: url.pathExtension), type.conforms(to: .movie) {
            return true
        }
        return ["mov", "mp4", "m4v", "qt"].contains(url.pathExtension.lowercased())
    }

    private func makeWatermarkedPDFIfPossible(from sourceURL: URL, metadata: AppMediaCaptureMetadata) async throws -> URL? {
        guard let document = CGPDFDocument(sourceURL as CFURL), document.numberOfPages > 0 else {
            return nil
        }
        var images: [UIImage] = []
        for pageIndex in 1...min(document.numberOfPages, 12) {
            guard let page = document.page(at: pageIndex) else { continue }
            let box = page.getBoxRect(.mediaBox)
            guard box.width > 0, box.height > 0 else { continue }
            let maxSide: CGFloat = 1600
            let scale = min(1, maxSide / max(box.width, box.height))
            let renderSize = CGSize(width: box.width * scale, height: box.height * scale)
            let renderer = UIGraphicsImageRenderer(size: renderSize)
            let image = renderer.image { context in
                UIColor.white.setFill()
                context.fill(CGRect(origin: .zero, size: renderSize))
                context.cgContext.saveGState()
                context.cgContext.scaleBy(x: scale, y: scale)
                context.cgContext.translateBy(x: 0, y: box.height)
                context.cgContext.scaleBy(x: 1, y: -1)
                context.cgContext.drawPDFPage(page)
                context.cgContext.restoreGState()
            }
            images.append(image)
        }
        guard !images.isEmpty else { return nil }
        let watermarked = await makeWatermarkedImages(from: images, metadata: metadata)
        return try makePdfFromImages(watermarked, fileTag: "import_pdf")
    }

    private func handleScannedImages(_ images: [UIImage], mode: ScanMode) {
        guard !isUploadBusy else {
            presentStatus("문서/사진 스캔", message: "현재 처리 중입니다. 완료 후 다시 시도해 주세요.")
            return
        }
        guard !images.isEmpty else {
            presentStatus("문서/사진 스캔", message: "캡처된 이미지가 없습니다.")
            pendingScanMode = .none
            return
        }

        isUploadBusy = true
        pendingScanMode = mode
        let scanMode = pendingScanMode
        let scanModeTitle = scanMode.scanType == "document" ? "문서 스캔" : "증빙 사진"
        presentStatus("문서/사진 스캔", message: "\(scanModeTitle) 촬영 완료. OCR 분석 후 PDF로 저장합니다.")

        Task { [weak self] in
            guard let self else { return }

            var uploadedPdfURL: URL?
            var uploadedOCRText = ""
            let capturedAt = Date()
            let metadata = await self.appMediaCaptureMetadata(capturedAt: capturedAt)

            do {
                try Task.checkCancellation()
                let watermarkedImages = await self.makeWatermarkedImages(from: images, metadata: metadata)
                let ocrText = extractOCRText(from: watermarkedImages)
                let pdfURL = try makePdfFromImages(watermarkedImages, fileTag: scanMode.scanType)
                uploadedOCRText = ocrText
                uploadedPdfURL = pdfURL
            } catch {
                if Task.isCancelled {
                    await MainActor.run {
                        self.isUploadBusy = false
                        self.pendingScanMode = .none
                    }
                    if let pdfURL = uploadedPdfURL {
                        try? FileManager.default.removeItem(at: pdfURL)
                    }
                    return
                }
                await MainActor.run {
                    self.presentStatus("문서 스캔", message: "문서 PDF 생성 실패: \(error.localizedDescription)")
                    self.isUploadBusy = false
                    self.pendingScanMode = .none
                }
                return
            }

            await MainActor.run {
                self.isUploadBusy = false
                self.pendingScanMode = .none
                if let pdfURL = uploadedPdfURL {
                    if self.isCapturingJournalAttachment(scanMode) {
                        self.finishJournalAttachment(
                            self.makeJournalAttachment(
                                kind: scanMode.scanType,
                                title: scanModeTitle,
                                fileURL: pdfURL,
                                mimeType: "application/pdf",
                                capturedAt: metadata.capturedAt,
                                note: uploadedOCRText.isEmpty ? "워터마크가 적용된 문서 스캔 PDF입니다." : uploadedOCRText
                            )
                        )
                        return
                    }
                    self.uploadAppMedia(
                        AppMediaUploadPayload(
                            kind: scanMode.scanType,
                            title: scanModeTitle,
                            fileURL: pdfURL,
                            mimeType: "application/pdf",
                            ocrText: uploadedOCRText,
                            capturedAt: metadata.capturedAt,
                            timeZone: metadata.timeZone,
                            roadAddress: metadata.roadAddress,
                            location: metadata.location,
                            workerId: self.currentWorkerIdForUpload(),
                            workerName: self.currentWorkerNameForUpload()
                        )
                    )
                    self.exportFileViaPicker(pdfURL, title: "PDF 파일 저장")
                }
            }
        }
    }

    private func handlePhotoCapture(_ image: UIImage) {
        guard !isUploadBusy else {
            presentStatus("사진 촬영", message: "현재 처리 중입니다. 잠시 후 다시 시도해 주세요.")
            return
        }
        isUploadBusy = true
        pendingScanMode = .mediaPhoto

        Task { [weak self] in
            guard let self else { return }
            do {
                try Task.checkCancellation()
                let capturedAt = Date()
                let metadata = await self.appMediaCaptureMetadata(capturedAt: capturedAt)
                let watermarkedImage = await self.makeWatermarkedPhoto(from: image, metadata: metadata)
                let ocrText = self.extractOCRText(from: [watermarkedImage])
                guard let data = watermarkedImage.jpegData(compressionQuality: 1.0) else {
                    throw NSError(domain: "VitAlGuard", code: -1, userInfo: [NSLocalizedDescriptionKey: "이미지 인코딩에 실패했습니다."])
                }
                let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("vitalguard_photo_\(Int(Date().timeIntervalSince1970)).jpg")
                try data.write(to: fileURL, options: .atomic)
                await MainActor.run {
                    self.isUploadBusy = false
                    self.pendingScanMode = .none
                    if self.isCapturingJournalAttachment(.mediaPhoto) {
                        self.finishJournalAttachment(
                            self.makeJournalAttachment(
                                kind: "photo",
                                title: "사진 촬영 증빙",
                                fileURL: fileURL,
                                mimeType: "image/jpeg",
                                capturedAt: metadata.capturedAt,
                                note: ocrText.isEmpty ? "워터마크가 적용된 사진 첨부 파일입니다." : ocrText
                            )
                        )
                        return
                    }
                    self.uploadAppMedia(
                        AppMediaUploadPayload(
                            kind: "photo",
                            title: "사진 촬영 증빙",
                            fileURL: fileURL,
                            mimeType: "image/jpeg",
                            ocrText: ocrText,
                            capturedAt: metadata.capturedAt,
                            timeZone: metadata.timeZone,
                            roadAddress: metadata.roadAddress,
                            location: metadata.location,
                            workerId: self.currentWorkerIdForUpload(),
                            workerName: self.currentWorkerNameForUpload()
                        )
                    )
                    self.presentCapturePreview(.photo(watermarkedImage, data))
                }
            } catch {
                if Task.isCancelled {
                    await MainActor.run {
                        self.isUploadBusy = false
                        self.pendingScanMode = .none
                    }
                    return
                }
                await MainActor.run {
                    self.isUploadBusy = false
                    self.pendingScanMode = .none
                    self.presentStatus("사진 촬영", message: "사진 저장 실패: \(error.localizedDescription)")
                }
            }
        }
    }

    private func handleVideoCapture(_ videoURL: URL) {
        guard !isUploadBusy else {
            presentStatus("비디오 촬영", message: "현재 처리 중입니다. 잠시 후 다시 시도해 주세요.")
            return
        }
        isUploadBusy = true
        pendingScanMode = .mediaVideo

        Task { [weak self] in
            guard let self else { return }
            let capturedAt = Date()
            let metadata = await self.appMediaCaptureMetadata(capturedAt: capturedAt)
            let outputURL = await self.makeWatermarkedVideo(from: videoURL, metadata: metadata)
            if Task.isCancelled {
                await MainActor.run {
                    self.isUploadBusy = false
                    self.pendingScanMode = .none
                }
                return
            }
            let finalVideoURL = outputURL ?? videoURL

            await MainActor.run {
                self.isUploadBusy = false
                self.pendingScanMode = .none
                if self.isCapturingJournalAttachment(.mediaVideo) {
                    self.finishJournalAttachment(
                        self.makeJournalAttachment(
                            kind: "video",
                            title: "비디오 촬영 증빙",
                            fileURL: finalVideoURL,
                            mimeType: self.mimeTypeForMediaFile(finalVideoURL),
                            capturedAt: metadata.capturedAt,
                            note: "워터마크가 적용된 비디오 첨부 파일입니다."
                        )
                    )
                    return
                }
                self.uploadAppMedia(
                    AppMediaUploadPayload(
                        kind: "video",
                        title: "비디오 촬영 증빙",
                        fileURL: finalVideoURL,
                        mimeType: self.mimeTypeForMediaFile(finalVideoURL),
                        ocrText: "",
                        capturedAt: metadata.capturedAt,
                        timeZone: metadata.timeZone,
                        roadAddress: metadata.roadAddress,
                        location: metadata.location,
                        workerId: self.currentWorkerIdForUpload(),
                        workerName: self.currentWorkerNameForUpload()
                    )
                )
                self.presentCapturePreview(.video(finalVideoURL, cleanup: [videoURL, outputURL].compactMap { $0 }))
            }
        }
    }

    private func savePhotoToPhotoLibrary(_ image: UIImage) async throws {
        try await withCheckedThrowingContinuation { continuation in
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { success, error in
                if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: error ?? NSError(
                        domain: "VitAlGuard",
                        code: -3,
                        userInfo: [NSLocalizedDescriptionKey: "사진 앱 저장 실패"]
                    ))
                }
            }
        }
    }

    private func presentCapturePreview(_ item: CapturePreviewViewController.PreviewItem) {
        let preview = CapturePreviewViewController(item: item, theme: savedThemeMode)
        preview.onAdd = { [weak self] mode in
            self?.dismiss(animated: true) {
                self?.startMediaCapture(mode: mode)
            }
        }
        preview.onSavePhoto = { [weak self, weak preview] image in
            guard let self else { return }
            Task {
                do {
                    try await self.savePhotoToPhotoLibrary(image)
                    await MainActor.run {
                        self.recordLocalAlert(title: "사진 저장 완료", message: "사진이 사진첩에 저장되었습니다.")
                        self.presentInlineStatus(on: preview, title: "사진 저장 완료", message: "업로드와 사진첩 저장 상태를 캘린더와 알림센터에 기록했습니다.")
                    }
                } catch {
                    await MainActor.run {
                        self.recordLocalAlert(title: "사진 저장 실패", message: error.localizedDescription)
                        self.presentInlineStatus(on: preview, title: "사진 저장 실패", message: error.localizedDescription)
                    }
                }
            }
        }
        preview.onSaveVideo = { [weak self, weak preview] url in
            guard let self else { return }
            Task {
                do {
                    try await self.saveVideoToPhotoLibrary(url)
                    await MainActor.run {
                        self.recordLocalAlert(title: "동영상 저장 완료", message: "비디오가 사진첩에 저장되었습니다.")
                        self.presentInlineStatus(on: preview, title: "비디오 저장 완료", message: "업로드와 사진첩 저장 상태를 캘린더와 알림센터에 기록했습니다.")
                    }
                } catch {
                    await MainActor.run {
                        self.recordLocalAlert(title: "동영상 저장 실패", message: error.localizedDescription)
                        self.presentInlineStatus(on: preview, title: "비디오 저장 실패", message: error.localizedDescription)
                    }
                }
            }
        }
        preview.modalPresentationStyle = .fullScreen
        present(preview, animated: true)
    }

    private func presentInlineStatus(on presenter: UIViewController?, title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default))
        (presenter ?? presentedViewController ?? self).present(alert, animated: true)
    }

    private func saveVideoToPhotoLibrary(_ sourceURL: URL) async throws {
        guard FileManager.default.fileExists(atPath: sourceURL.path) else {
            throw NSError(domain: "VitAlGuard", code: -1, userInfo: [NSLocalizedDescriptionKey: "저장할 동영상 파일이 없습니다."])
        }

        try await withCheckedThrowingContinuation { continuation in
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: sourceURL)
            }) { success, error in
                if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: error ?? NSError(
                        domain: "VitAlGuard",
                        code: -2,
                        userInfo: [NSLocalizedDescriptionKey: "사진 앱 저장 실패"]
                    ))
                }
            }
        }
    }

    private func requestLocationPermissionForWatermark() {
        guard CLLocationManager.locationServicesEnabled() else { return }
        switch watermarkAuthorizationStatus() {
        case .notDetermined:
            watermarkLocationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            if let location = watermarkLocationManager.location {
                lastKnownWatermarkLocation = location
                storeLatestLocationForDashboard(location)
            }
            watermarkLocationManager.requestLocation()
        case .authorizedAlways:
            if let location = watermarkLocationManager.location {
                lastKnownWatermarkLocation = location
                storeLatestLocationForDashboard(location)
            }
            watermarkLocationManager.requestLocation()
        case .restricted, .denied:
            break
        @unknown default:
            break
        }
    }

    private func watermarkAuthorizationStatus() -> CLAuthorizationStatus {
        if #available(iOS 14.0, *) {
            return watermarkLocationManager.authorizationStatus
        }
        return CLLocationManager.locationServicesEnabled() ? .notDetermined : .restricted
    }

    private func captureTimeZone(for location: CLLocation?) -> TimeZone {
        if let location, isLocationInSouthKorea(location) {
            return TimeZone(identifier: "Asia/Seoul") ?? .current
        }
        return .current
    }

    private func isLocationInSouthKorea(_ location: CLLocation) -> Bool {
        let coordinate = location.coordinate
        return (33.0...39.5).contains(coordinate.latitude) && (124.0...132.0).contains(coordinate.longitude)
    }

    private func appMediaCaptureMetadata(capturedAt: Date = Date()) async -> AppMediaCaptureMetadata {
        let location = watermarkLocationManager.location ?? lastKnownWatermarkLocation
        let timeZone = captureTimeZone(for: location)
        let roadAddress: String?
        if let location {
            if let cached = cachedWatermarkAddress {
                roadAddress = cached
            } else {
                let resolved = await reverseGeocodeAddress(for: location)
                roadAddress = resolved == "주소 미확인" ? nil : resolved
            }
        } else {
            roadAddress = nil
        }
        return AppMediaCaptureMetadata(
            capturedAt: capturedAt,
            timeZone: timeZone,
            roadAddress: roadAddress,
            location: location
        )
    }

    private func currentWatermarkText(metadata: AppMediaCaptureMetadata) async -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "ko_KR")
        dateFormatter.timeZone = metadata.timeZone
        dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss"

        let defaults = UserDefaults.standard
        let showDate = defaults.object(forKey: PreviewSettingsKey.watermarkShowDate) as? Bool ?? true
        let showAddress = defaults.object(forKey: PreviewSettingsKey.watermarkShowAddress) as? Bool ?? true
        let showCoordinate = defaults.object(forKey: PreviewSettingsKey.watermarkShowCoordinate) as? Bool ?? true

        var address = "도로명주소: 위치 미확인"
        var coordinateText = "위치 미확인"
        if let location = metadata.location, (showAddress || showCoordinate) {
            let lat = String(format: "%.6f", location.coordinate.latitude)
            let lon = String(format: "%.6f", location.coordinate.longitude)
            coordinateText = "위도/경도: \(lat), \(lon)"
            if let roadAddress = metadata.roadAddress {
                address = "도로명주소: \(roadAddress)"
            } else {
                address = "도로명주소: \(await reverseGeocodeAddress(for: location))"
            }
        }

        let deviceInfo = "기기: \(UIDevice.current.name) / \(UIDevice.current.model) / \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
        var lines: [String] = []
        if showDate {
            lines.append("[\(dateFormatter.string(from: metadata.capturedAt))]")
        }
        if showAddress {
            lines.append(address)
        }
        if showCoordinate {
            lines.append(coordinateText)
        }
        lines.append("작업자/ID: \(watermarkIdentityText())")
        lines.append(deviceInfo)

        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func watermarkIdentityText() -> String {
        let defaults = UserDefaults.standard
        let name = defaults.string(forKey: PreviewSettingsKey.workerName)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let login = loggedInID
            ?? defaults.string(forKey: PreviewSettingsKey.loggedInId)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            ?? ""
        let employee = defaults.string(forKey: PreviewSettingsKey.employeeId)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedName = (name?.isEmpty == false ? name : nil) ?? "양지후"
        let resolvedLogin = login.isEmpty ? (currentMode == .admin ? "admin7276" : "worker7276") : login
        let resolvedEmployee = employee?.isEmpty == false ? employee! : vitalGuardEmployeeIdentifier(for: resolvedLogin)
        return "\(resolvedName), \(resolvedLogin), \(resolvedEmployee)"
    }

    private func watermarkBackgroundColor() -> UIColor {
        let defaults = UserDefaults.standard
        let raw = defaults.string(forKey: PreviewSettingsKey.watermarkBackgroundColor) ?? WatermarkBackgroundColorPreset.black.rawValue
        return WatermarkBackgroundColorPreset.from(raw: raw).color
    }

    private func watermarkBackgroundAlpha() -> CGFloat {
        let value = UserDefaults.standard.object(forKey: PreviewSettingsKey.watermarkBackgroundAlpha) as? Double ?? 0.5
        return CGFloat(min(1, max(0, value)))
    }

    private func watermarkTextColor() -> UIColor {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.watermarkTextColor) ?? WatermarkTextColorPreset.white.rawValue
        if raw == "custom" {
            let savedHex = UserDefaults.standard.string(forKey: PreviewSettingsKey.watermarkTextColorCustom)
            return Self.decodeColor(fromHex: savedHex) ?? .systemRed
        }
        return WatermarkTextColorPreset.from(raw: raw).color
    }


    private static func decodeColor(fromHex hex: String?) -> UIColor? {
        guard let value = hex else { return nil }
        var cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("#") {
            cleaned.removeFirst()
        }
        guard (cleaned.count == 6 || cleaned.count == 8), let num = Int64(cleaned, radix: 16) else {
            return nil
        }
        let r = CGFloat((num >> 16) & 0xFF) / 255
        let g = CGFloat((num >> 8) & 0xFF) / 255
        let b = CGFloat(num & 0xFF) / 255
        let a: CGFloat = cleaned.count == 8 ? CGFloat((num >> 24) & 0xFF) / 255 : 1
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }

    private func watermarkFontScale() -> CGFloat {
        let value = UserDefaults.standard.object(forKey: PreviewSettingsKey.watermarkFontScale) as? Double ?? 1.0
        return CGFloat(min(2.0, max(0.6, value)))
    }

    private func watermarkPosition() -> WatermarkPosition {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.watermarkPosition) ?? WatermarkPosition.bottom.rawValue
        return WatermarkPosition(rawValue: raw) ?? .bottom
    }

    private func watermarkOverlayY(contentHeight: CGFloat, footerHeight: CGFloat) -> CGFloat {
        let position = watermarkPosition()
        switch position {
        case .top:
            return 0
        case .center:
            return max(0, (contentHeight - footerHeight) / 2)
        case .bottom:
            return max(0, contentHeight - footerHeight)
        }
    }

    private func dedupeConsecutiveTokens(_ values: [String]) -> [String] {
        var result: [String] = []
        for raw in values {
            let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !token.isEmpty else { continue }
            if let last = result.last, last == token {
                continue
            }
            result.append(token)
        }
        return result
    }

    private func reverseGeocodeAddress(for location: CLLocation) async -> String {
        let cacheCheck: String? = watermarkCacheQueue.sync {
            guard let cached = cachedWatermarkAddress, let coordinate = cachedWatermarkCoordinate else {
                return nil
            }
            let cachedLocation = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
            return cachedLocation.distance(from: location) <= 120 ? cached : nil
        }
        if let cached = cacheCheck {
            return cached
        }
        return await withCheckedContinuation { continuation in
            watermarkGeocoder.cancelGeocode()
            watermarkGeocoder.reverseGeocodeLocation(location) { placemarks, error in
                if let error {
                    print("reverse geocode failed: \(error.localizedDescription)")
                }
                if let place = placemarks?.first {
                    var parts: [String] = []
                    if let country = place.country, !country.isEmpty { parts.append(country) }
                    if let administrativeArea = place.administrativeArea, !administrativeArea.isEmpty { parts.append(administrativeArea) }
                    if let locality = place.locality, !locality.isEmpty { parts.append(locality) }
                    if let subLocality = place.subLocality, !subLocality.isEmpty { parts.append(subLocality) }

                    var roadParts: [String] = []
                    if let thoroughfare = place.thoroughfare, !thoroughfare.isEmpty { roadParts.append(thoroughfare) }
                    if let subThoroughfare = place.subThoroughfare, !subThoroughfare.isEmpty {
                        roadParts.append("\(subThoroughfare)번지")
                    }
                    if let name = place.name, !name.isEmpty, place.name != roadParts.joined(separator: "") {
                        roadParts.append(name)
                    }
                    let roadAddress = self.dedupeConsecutiveTokens(roadParts).filter { !$0.isEmpty }.joined(separator: " ")
                    if !roadAddress.isEmpty {
                        parts.append(roadAddress)
                    }

                    let resolved = self.dedupeConsecutiveTokens(parts).filter { !$0.isEmpty }.joined(separator: " ")
                    if !resolved.isEmpty {
                        let text = resolved
                        self.watermarkCacheQueue.sync {
                            self.cachedWatermarkAddress = text
                            self.cachedWatermarkCoordinate = location.coordinate
                        }
                        continuation.resume(returning: text)
                        return
                    }
                }
                continuation.resume(returning: "주소 미확인")
            }
        }
    }

    private func makeWatermarkedPhoto(from source: UIImage, metadata: AppMediaCaptureMetadata) async -> UIImage {
        let normalizedSource = normalizedImage(source)
        let watermarkText = await currentWatermarkText(metadata: metadata)
        let trimmedWatermark = watermarkText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedWatermark.isEmpty {
            return normalizedSource
        }

        let size = normalizedSource.size
        let scale = max(1.0, normalizedSource.scale)
        let horizontalPadding = max(12, min(size.width, size.height) * 0.02)
        let availableWidth = size.width - (horizontalPadding * 2)
        let footerMaxHeight = min(320, max(64, size.height * 0.36))
        let textColor = watermarkTextColor()
        let text = trimmedWatermark
        let fontScale = watermarkFontScale()
        let baseFont = max(16.0, min(40.0, min(size.width, size.height) * 0.03))
        let fontSize = adjustedWatermarkFontSize(
            for: text,
            width: availableWidth,
            maxHeight: footerMaxHeight - 14,
            minFontSize: max(10, 12 * fontScale),
            maxFontSize: baseFont * fontScale
        )
        let textHeight = measuredWatermarkHeight(
            for: text,
            width: availableWidth,
            fontSize: fontSize
        )
        let footerHeight = min(footerMaxHeight, max(64, ceil(textHeight + 14)))
        let footerY = watermarkOverlayY(contentHeight: size.height, footerHeight: footerHeight)

        UIGraphicsBeginImageContextWithOptions(size, true, scale)
        defer { UIGraphicsEndImageContext() }
        normalizedSource.draw(in: CGRect(origin: .zero, size: size))

        let context = UIGraphicsGetCurrentContext()

        let textWidth = availableWidth
        let textRect = CGRect(
            x: horizontalPadding,
            y: footerY,
            width: textWidth,
            height: footerHeight
        )
        let bgRect = CGRect(x: 0, y: footerY, width: size.width, height: footerHeight)
        context?.setFillColor(watermarkBackgroundColor().withAlphaComponent(watermarkBackgroundAlpha()).cgColor)
        context?.fill(bgRect)

        text.draw(
            with: textRect.insetBy(dx: 8, dy: 8),
            options: [.usesLineFragmentOrigin],
            attributes: [
                .font: UIFont.monospacedSystemFont(ofSize: fontSize, weight: .medium),
                .foregroundColor: textColor,
                .paragraphStyle: paragraphStyle(fontSize: fontSize)
            ],
            context: nil
        )

        guard let result = UIGraphicsGetImageFromCurrentImageContext() else {
            return normalizedSource
        }
        return result
    }

    private func makeWatermarkedImages(from images: [UIImage], metadata: AppMediaCaptureMetadata) async -> [UIImage] {
        var output: [UIImage] = []
        output.reserveCapacity(images.count)
        for image in images {
            output.append(await makeWatermarkedPhoto(from: image, metadata: metadata))
        }
        return output
    }

    private func normalizedImage(_ source: UIImage) -> UIImage {
        if source.imageOrientation == .up {
            return source
        }
        UIGraphicsBeginImageContextWithOptions(source.size, false, source.scale)
        defer { UIGraphicsEndImageContext() }
        source.draw(in: CGRect(origin: .zero, size: source.size))
        return UIGraphicsGetImageFromCurrentImageContext() ?? source
    }

    private func paragraphStyle(fontSize: CGFloat) -> NSMutableParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.alignment = .left
        style.minimumLineHeight = floor(fontSize + 2)
        style.maximumLineHeight = floor(fontSize + 5)
        style.lineHeightMultiple = 1.04
        style.lineBreakMode = .byWordWrapping
        return style
    }

    private func watermarkAttributes(fontSize: CGFloat) -> [NSAttributedString.Key: Any] {
        return [
            .font: UIFont.monospacedSystemFont(ofSize: fontSize, weight: .semibold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle(fontSize: fontSize),
            .strokeWidth: -2.0,
            .strokeColor: UIColor.black
        ]
    }

    private func measuredWatermarkHeight(for text: String, width: CGFloat, fontSize: CGFloat) -> CGFloat {
        let measured = (text as NSString).boundingRect(
            with: CGSize(width: max(width - 16, 80), height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin],
            attributes: watermarkAttributes(fontSize: fontSize),
            context: nil
        ).height
        return ceil(max(measured, fontSize + 4))
    }

    private func adjustedWatermarkFontSize(
        for text: String,
        width: CGFloat,
        maxHeight: CGFloat,
        minFontSize: CGFloat,
        maxFontSize: CGFloat
    ) -> CGFloat {
        var fontSize = maxFontSize
        while fontSize > minFontSize {
            if measuredWatermarkHeight(for: text, width: width, fontSize: fontSize) + 14 <= maxHeight {
                break
            }
            fontSize -= 1
        }
        return fontSize
    }

    private func makeWatermarkedVideo(from sourceURL: URL, metadata: AppMediaCaptureMetadata) async -> URL? {
        let watermarkText = await currentWatermarkText(metadata: metadata)
        let trimmedWatermark = watermarkText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedWatermark.isEmpty {
            return sourceURL
        }

        let asset = AVURLAsset(url: sourceURL)
        guard let videoTrack = (try? await asset.loadTracks(withMediaType: .video))?.first else {
            return sourceURL
        }
        guard let duration = try? await asset.load(.duration) else {
            return sourceURL
        }
        let transform: CGAffineTransform = (try? await videoTrack.load(.preferredTransform)) ?? .identity
        guard let naturalSize = try? await videoTrack.load(.naturalSize) else {
            return sourceURL
        }

        let composition = AVMutableComposition()
        guard let compositionTrack = composition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            return sourceURL
        }
        do {
            let range = CMTimeRange(start: .zero, duration: duration)
            try compositionTrack.insertTimeRange(range, of: videoTrack, at: .zero)
        } catch {
            print("video compose insert failed: \(error.localizedDescription)")
            return sourceURL
        }

        let audioTracks = try? await asset.loadTracks(withMediaType: .audio)
        if let audioTrack = audioTracks?.first,
           let compositionAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            do {
                try compositionAudioTrack.insertTimeRange(
                    CMTimeRange(start: .zero, duration: duration),
                    of: audioTrack,
                    at: .zero
                )
            } catch {
                print("video audio insert failed: \(error.localizedDescription)")
            }
        }

        var renderSize = naturalSize.applying(transform)
        renderSize = CGSize(width: abs(renderSize.width), height: abs(renderSize.height))
        if renderSize.width == 0 || renderSize.height == 0 {
            renderSize = CGSize(width: abs(naturalSize.width), height: abs(naturalSize.height))
        }

        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionTrack)
        layerInstruction.setTransform(transform, at: .zero)
        instruction.layerInstructions = [layerInstruction]

        let videoComp = AVMutableVideoComposition()
        videoComp.instructions = [instruction]
        videoComp.renderSize = renderSize
        videoComp.frameDuration = CMTime(value: 1, timescale: 30)

        let videoLayer = CALayer()
        videoLayer.frame = CGRect(x: 0, y: 0, width: renderSize.width, height: renderSize.height)
        let backgroundLayer = CALayer()
        let footerMaxHeight = min(renderSize.height * 0.36, 340)
        let footerTextWidth = renderSize.width - 16
        let watermarkScale = watermarkFontScale()
        let footerFont = adjustedWatermarkFontSize(
            for: trimmedWatermark,
            width: footerTextWidth,
            maxHeight: footerMaxHeight - 14,
            minFontSize: max(10, 12 * watermarkScale),
            maxFontSize: max(14, min(28, renderSize.width / 34) * watermarkScale)
        )
        let footerMeasuredHeight = measuredWatermarkHeight(
            for: trimmedWatermark,
            width: footerTextWidth,
            fontSize: footerFont
        )
        let footerHeight = min(footerMaxHeight, max(56, ceil(footerMeasuredHeight + 14)))
        let footerY = watermarkOverlayY(contentHeight: renderSize.height, footerHeight: footerHeight)
        backgroundLayer.frame = CGRect(
            x: 0,
            y: footerY,
            width: renderSize.width,
            height: footerHeight
        )
        backgroundLayer.backgroundColor = watermarkBackgroundColor().withAlphaComponent(watermarkBackgroundAlpha()).cgColor

        let textLayer = CATextLayer()
        let watermarkStyle = NSMutableParagraphStyle()
        watermarkStyle.alignment = .left
        watermarkStyle.lineBreakMode = .byWordWrapping
        watermarkStyle.minimumLineHeight = floor(footerFont + 2)
        watermarkStyle.maximumLineHeight = floor(footerFont + 5)
        let watermarkTextColor = watermarkTextColor()
        textLayer.string = NSAttributedString(
            string: trimmedWatermark,
            attributes: [
                .font: UIFont.monospacedSystemFont(ofSize: footerFont, weight: .medium),
                .foregroundColor: watermarkTextColor,
                .paragraphStyle: watermarkStyle
            ]
        )
        textLayer.foregroundColor = watermarkTextColor.cgColor
        textLayer.font = UIFont.monospacedSystemFont(ofSize: footerFont, weight: .medium)
        textLayer.fontSize = footerFont
        textLayer.alignmentMode = .left
        textLayer.truncationMode = .none
        textLayer.frame = CGRect(
            x: 8,
            y: footerY + 8,
            width: renderSize.width - 16,
            height: footerHeight - 16
        )
        textLayer.isWrapped = true
        textLayer.contentsScale = traitCollection.displayScale
        textLayer.zPosition = 2

        let overlayLayer = CALayer()
        overlayLayer.frame = CGRect(x: 0, y: 0, width: renderSize.width, height: renderSize.height)
        overlayLayer.addSublayer(videoLayer)
        overlayLayer.addSublayer(backgroundLayer)
        overlayLayer.addSublayer(textLayer)

        videoComp.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: overlayLayer)

        let outputName = "vitalguard_watermark_video_\(Int(Date().timeIntervalSince1970)).mp4"
        let outputURL = FileManager.default.temporaryDirectory.appendingPathComponent(outputName)
        try? FileManager.default.removeItem(at: outputURL)

        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            return sourceURL
        }
        exporter.outputURL = outputURL
        exporter.outputFileType = .mp4
        exporter.shouldOptimizeForNetworkUse = true
        exporter.videoComposition = videoComp

        return await withCheckedContinuation { continuation in
            exporter.exportAsynchronously {
                if exporter.status == .completed {
                    continuation.resume(returning: outputURL)
                } else {
                    print("video watermark export failed: \(exporter.error?.localizedDescription ?? "unknown")")
                    continuation.resume(returning: sourceURL)
                }
            }
        }
    }

    private func exportFileViaPicker(_ fileURL: URL, title: String) {
        if #available(iOS 14.0, *) {
            let picker = UIDocumentPickerViewController(forExporting: [fileURL], asCopy: true)
            picker.shouldShowFileExtensions = true
            picker.title = title
            picker.delegate = self
            pendingExportCompletionTitle = title
            present(picker, animated: true)
            return
        }

        let sheet = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        sheet.setValue(title, forKey: "subject")
        sheet.completionWithItemsHandler = { [weak self] _, completed, _, error in
            DispatchQueue.main.async {
                if completed {
                    self?.recordLocalAlert(title: "문서 저장 완료", message: "\(title)이 파일 앱 공유 시트로 저장되었습니다.")
                    self?.presentStatus("문서 저장 완료", message: "업로드와 파일 저장 상태를 캘린더와 알림센터에 기록했습니다.")
                } else if let error {
                    self?.recordLocalAlert(title: "문서 저장 실패", message: error.localizedDescription)
                }
            }
        }
        present(sheet, animated: true)
    }

    private func currentWorkerIdForUpload() -> String {
        let defaults = UserDefaults.standard
        let stored = defaults.string(forKey: PreviewSettingsKey.employeeId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !stored.isEmpty { return stored }
        return vitalGuardEmployeeIdentifier(for: loggedInID ?? "")
    }

    private func currentWorkerNameForUpload() -> String {
        let name = UserDefaults.standard.string(forKey: PreviewSettingsKey.workerName)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        return currentMode == .admin ? "VitAlGuard 관리자" : "VitAlGuard 근로자"
    }

    private func appUploadToken() -> String {
        let saved = UserDefaults.standard.string(forKey: vitalGuardUploadTokenDefaultsKey)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return saved.isEmpty ? vitalGuardBundledUploadToken : saved
    }

    private func appMediaAuthorizationToken() -> String {
        let jwt = DashboardCredentialStore.loadAppJWT()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return jwt.isEmpty ? appUploadToken() : jwt
    }

    private func recordCalendarMedia(_ payload: AppMediaUploadPayload, localURL: URL? = nil) {
        let calendarURL = localURL ?? AppMediaCalendarStore.copyFileForCalendar(payload.fileURL)
        let attributes = calendarURL.flatMap { try? FileManager.default.attributesOfItem(atPath: $0.path) }
        let byteSize = (attributes?[.size] as? NSNumber)?.intValue ?? 0
        AppMediaCalendarStore.add(
            AppMediaCalendarRecord(
                id: "local-\(payload.kind)-\(Int(payload.capturedAt.timeIntervalSince1970))-\(payload.fileURL.lastPathComponent)",
                kind: payload.kind,
                title: payload.title,
                fileName: calendarURL?.lastPathComponent ?? payload.fileURL.lastPathComponent,
                mimeType: payload.mimeType,
                byteSize: byteSize,
                uploadedAt: Date(),
                capturedAt: payload.capturedAt,
                workerId: payload.workerId,
                workerName: payload.workerName,
                source: "VitAlGuard-iPhone",
                ocrText: payload.ocrText,
                previewDataUrl: nil,
                journalType: nil,
                journalArea: nil,
                journalContent: nil,
                nfcTagText: nil,
                commentText: nil,
                calendarURL: "\(VitalGuardLinks.safetyMonitor)/#app-media-calendar",
                localPath: calendarURL?.path,
                note: payload.ocrText.isEmpty ? nil : payload.ocrText
            )
        )
    }

    private func recordMediaUploadCompletedAlert(_ payload: AppMediaUploadPayload) {
        let typeName: String
        switch payload.kind.lowercased() {
        case "photo", "image":
            typeName = "사진"
        case "video":
            typeName = "비디오"
        case "document", "scan":
            typeName = "문서 스캔"
        default:
            typeName = "파일"
        }
        recordLocalAlert(
            title: "\(typeName) 저장 및 업로드 완료",
            message: "\(payload.title)이 앱 캘린더에 저장되었고, 웹 대시보드 업로드도 완료되었습니다."
        )
    }

    private func recordCalendarJournal(_ entry: FieldJournalEntry) {
        let formatter = ISO8601DateFormatter()
        let workerId = currentWorkerIdForUpload()
        let workerName = currentWorkerNameForUpload()
        let summary = [
            "\(entry.kind.areaTitle): \(entry.area)",
            "\(entry.kind.dateTitle): \(formatter.string(from: entry.occurredAt))",
            "\(entry.kind.contentTitle): \(entry.content)",
            "첨부 파일: \(entry.attachments.count)개"
        ].joined(separator: "\n")
        AppMediaCalendarStore.add(
            AppMediaCalendarRecord(
                id: "local-\(entry.kind.dashboardKind)-\(Int(entry.occurredAt.timeIntervalSince1970))",
                kind: entry.kind.dashboardKind,
                title: "\(entry.kind.title) · \(entry.area)",
                fileName: "\(entry.kind.dashboardKind)-\(Int(entry.occurredAt.timeIntervalSince1970)).txt",
                mimeType: "text/plain; charset=utf-8",
                byteSize: summary.data(using: .utf8)?.count ?? 0,
                uploadedAt: Date(),
                capturedAt: entry.occurredAt,
                workerId: workerId,
                workerName: workerName,
                source: "VitAlGuard-iPhone-NFC",
                ocrText: summary,
                previewDataUrl: nil,
                journalType: entry.kind.rawValue,
                journalArea: entry.area,
                journalContent: entry.content,
                nfcTagText: entry.tagText,
                commentText: nil,
                calendarURL: entry.calendarURL?.absoluteString,
                localPath: nil,
                note: summary
            )
        )
        for attachment in entry.attachments {
            let localURL = attachment.localURL.flatMap(AppMediaCalendarStore.copyFileForCalendar)
            AppMediaCalendarStore.add(
                AppMediaCalendarRecord(
                    id: "local-\(attachment.kind)-\(Int(attachment.capturedAt.timeIntervalSince1970))-\(attachment.fileName)",
                    kind: attachment.kind,
                    title: attachment.title,
                    fileName: localURL?.lastPathComponent ?? attachment.fileName,
                    mimeType: attachment.mimeType,
                    byteSize: attachment.byteSize,
                    uploadedAt: Date(),
                    capturedAt: attachment.capturedAt,
                    workerId: workerId,
                    workerName: workerName,
                    source: "VitAlGuard-iPhone-NFC",
                    ocrText: attachment.note,
                    previewDataUrl: nil,
                    journalType: entry.kind.rawValue,
                    journalArea: entry.area,
                    journalContent: entry.content,
                    nfcTagText: entry.tagText,
                    commentText: nil,
                    calendarURL: entry.calendarURL?.absoluteString,
                    localPath: localURL?.path ?? attachment.localURL?.path,
                    note: attachment.note
                )
            )
        }
    }

    private func recordCalendarComment(_ entry: CalendarCommentEntry) {
        let workerId = currentWorkerIdForUpload()
        let workerName = currentWorkerNameForUpload()
        let commentId = entry.id ?? "local-comment-\(UUID().uuidString)"
        let relatedText = entry.relatedRecordTitle.map { "관련 파일: \($0)" }
        let attachmentText = ["첨부 파일: \(entry.attachments.count)개", relatedText]
            .compactMap { $0 }
            .joined(separator: "\n")
        let commentRecord = AppMediaCalendarRecord(
            id: commentId,
            kind: "comment",
            title: "댓글 · \(workerName)",
            fileName: "comment-\(Int(Date().timeIntervalSince1970)).txt",
            mimeType: "text/plain; charset=utf-8",
            byteSize: entry.text.data(using: .utf8)?.count ?? 0,
            uploadedAt: Date(),
            capturedAt: entry.date,
            workerId: workerId,
            workerName: workerName,
            source: "VitAlGuard-iPhone",
            ocrText: entry.text,
            previewDataUrl: nil,
            journalType: nil,
            journalArea: nil,
            journalContent: entry.text,
            nfcTagText: nil,
            commentText: entry.text,
            calendarURL: "\(VitalGuardLinks.safetyMonitor)/#app-media-calendar",
            localPath: nil,
            note: attachmentText
        )
        if entry.id == nil {
            AppMediaCalendarStore.add(commentRecord)
        } else {
            AppMediaCalendarStore.updateComment(commentRecord, keepAttachmentIds: Set(entry.existingAttachmentRecordIds))
        }
        for attachment in entry.attachments {
            let existingAttachmentId = entry.existingAttachmentRecordIds.first { id in
                AppMediaCalendarStore.load().contains { $0.id == id && $0.fileName == attachment.fileName }
            }
            let localURL = attachment.localURL.flatMap(AppMediaCalendarStore.copyFileForCalendar)
            AppMediaCalendarStore.add(
                AppMediaCalendarRecord(
                    id: existingAttachmentId ?? "local-comment-attachment-\(UUID().uuidString)",
                    kind: attachment.kind,
                    title: "댓글 첨부 · \(attachment.title)",
                    fileName: localURL?.lastPathComponent ?? attachment.fileName,
                    mimeType: attachment.mimeType,
                    byteSize: attachment.byteSize,
                    uploadedAt: Date(),
                    capturedAt: entry.date,
                    workerId: workerId,
                    workerName: workerName,
                    source: "VitAlGuard-iPhone-Comment",
                    ocrText: attachment.note,
                    previewDataUrl: nil,
                    journalType: nil,
                    journalArea: nil,
                    journalContent: entry.text,
                    nfcTagText: nil,
                    commentText: entry.text,
                    calendarURL: "\(VitalGuardLinks.safetyMonitor)/#app-media-calendar",
                    localPath: localURL?.path ?? attachment.localURL?.path,
                    note: [attachment.note, "댓글 ID: \(commentId)"].filter { !$0.isEmpty }.joined(separator: "\n")
                )
            )
        }
    }

    private func uploadAppMedia(_ payload: AppMediaUploadPayload) {
        recordCalendarMedia(payload)
        let token = appMediaAuthorizationToken()
        guard !token.isEmpty else {
            recordLocalAlert(title: "관제 업로드 대기", message: "관제웹 계정으로 로그인하거나 APP_UPLOAD_TOKEN을 앱 설정에 입력하면 OCR/사진 파일이 관제 캘린더에 자동 업로드됩니다.")
            return
        }
        guard let uploadURL = URL(string: "\(VitalGuardLinks.safetyMonitor)/api/app-media") else { return }
        guard let fileData = try? Data(contentsOf: payload.fileURL) else {
            recordLocalAlert(title: "관제 업로드 실패", message: "업로드할 파일을 읽을 수 없습니다.")
            return
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let boundary = "VitAlGuardBoundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = makeAppMediaMultipartBody(payload: payload, fileData: fileData, boundary: boundary)

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let error {
                    self?.recordLocalAlert(title: "관제 업로드 실패", message: error.localizedDescription)
                    return
                }
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(statusCode) {
                    if let data {
                        AppMediaCalendarStore.merge(AppMediaCalendarStore.records(fromServerData: data))
                    }
                    self?.recordMediaUploadCompletedAlert(payload)
                } else {
                    self?.recordLocalAlert(title: "관제 업로드 실패", message: "서버 응답 코드 \(statusCode)")
                }
            }
        }.resume()
    }

    private func uploadFieldJournalEntry(_ entry: FieldJournalEntry, completion: @escaping (Bool, String) -> Void) {
        recordCalendarJournal(entry)
        let token = appMediaAuthorizationToken()
        guard !token.isEmpty else {
            completion(false, "앱 내부 캘린더에는 저장되었습니다. APP_UPLOAD_TOKEN 또는 관제 로그인 토큰이 있으면 웹 캘린더에도 자동 업로드됩니다.")
            return
        }
        guard let uploadURL = appMediaUploadURL(calendarURL: entry.calendarURL) else {
            completion(false, "캘린더 등록 URL을 만들 수 없습니다.")
            return
        }

        let formatter = ISO8601DateFormatter()
        let workerId = currentWorkerIdForUpload()
        let workerName = currentWorkerNameForUpload()
        let fileName = "\(entry.kind.dashboardKind)-\(Int(entry.occurredAt.timeIntervalSince1970)).txt"
        let ocrText = [
            "\(entry.kind.areaTitle): \(entry.area)",
            "\(entry.kind.dateTitle): \(formatter.string(from: entry.occurredAt))",
            "\(entry.kind.contentTitle): \(entry.content)",
            "첨부 파일: \(entry.attachments.count)개"
        ].joined(separator: "\n")
        var payload: [String: Any] = [
            "kind": entry.kind.dashboardKind,
            "title": "\(entry.kind.title) · \(entry.area)",
            "fileName": fileName,
            "mimeType": "text/plain; charset=utf-8",
            "byteSize": ocrText.data(using: .utf8)?.count ?? 0,
            "uploadedAt": formatter.string(from: Date()),
            "capturedAt": formatter.string(from: entry.occurredAt),
            "workerId": workerId,
            "workerName": workerName,
            "source": "VitAlGuard-iPhone-NFC",
            "ocrText": ocrText,
            "journalType": entry.kind.rawValue,
            "journalArea": entry.area,
            "journalContent": entry.content,
            "attachments": entry.attachments.map(\.jsonValue),
            "nfcTagText": entry.tagText,
            "calendarURL": entry.calendarURL?.absoluteString ?? ""
        ]
        if let location = watermarkLocationManager.location ?? lastKnownWatermarkLocation {
            payload["latitude"] = location.coordinate.latitude
            payload["longitude"] = location.coordinate.longitude
            payload["locationAccuracyMeters"] = location.horizontalAccuracy
        }
        guard JSONSerialization.isValidJSONObject(payload),
              let body = try? JSONSerialization.data(withJSONObject: payload) else {
            completion(false, "일지 데이터를 JSON으로 만들 수 없습니다.")
            return
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        URLSession.shared.uploadTask(with: request, from: body) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let error {
                    completion(false, "앱 내부 캘린더에는 저장되었습니다.\n웹 업로드 실패: \(error.localizedDescription)")
                    return
                }
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(statusCode) {
                    if let data {
                        AppMediaCalendarStore.merge(AppMediaCalendarStore.records(fromServerData: data))
                    }
                    self?.recordLocalAlert(
                        title: "\(entry.kind.title) 저장 및 업로드 완료",
                        message: "\(entry.area) 일지가 앱 캘린더에 저장되었고, 웹 대시보드 업로드도 완료되었습니다."
                    )
                    completion(true, "앱 내부 캘린더와 웹 캘린더에 등록되었습니다.")
                } else {
                    completion(false, "앱 내부 캘린더에는 저장되었습니다.\n웹 업로드 실패: HTTP \(statusCode)")
                }
            }
        }.resume()
    }

    private func uploadCalendarComment(_ entry: CalendarCommentEntry, completion: @escaping (Bool, String) -> Void) {
        recordCalendarComment(entry)
        let token = appMediaAuthorizationToken()
        guard !token.isEmpty else {
            completion(false, "앱 내부 캘린더에는 댓글을 저장했습니다. APP_UPLOAD_TOKEN 또는 관제 로그인 토큰이 있으면 웹 댓글에도 자동 업로드됩니다.")
            return
        }
        guard let uploadURL = URL(string: "\(VitalGuardLinks.safetyMonitor)/api/app-media") else {
            completion(false, "댓글 등록 URL을 만들 수 없습니다.")
            return
        }

        let formatter = ISO8601DateFormatter()
        let workerId = currentWorkerIdForUpload()
        let workerName = currentWorkerNameForUpload()
        var payload: [String: Any] = [
            "kind": "comment",
            "title": "댓글 · \(workerName)",
            "fileName": "comment-\(Int(Date().timeIntervalSince1970)).txt",
            "mimeType": "text/plain; charset=utf-8",
            "byteSize": entry.text.data(using: .utf8)?.count ?? 0,
            "uploadedAt": formatter.string(from: Date()),
            "capturedAt": formatter.string(from: entry.date),
            "workerId": workerId,
            "workerName": workerName,
            "source": "VitAlGuard-iPhone",
            "ocrText": entry.text,
            "journalContent": entry.text,
            "commentText": entry.text,
            "attachments": entry.attachments.map(\.jsonValue),
            "calendarURL": "\(VitalGuardLinks.safetyMonitor)/#app-media-calendar"
        ]
        if let relatedRecordTitle = entry.relatedRecordTitle {
            payload["relatedRecordTitle"] = relatedRecordTitle
            payload["note"] = "관련 파일: \(relatedRecordTitle)"
        }
        if let relatedRecordId = entry.relatedRecordId {
            payload["relatedRecordId"] = relatedRecordId
        }
        guard JSONSerialization.isValidJSONObject(payload),
              let body = try? JSONSerialization.data(withJSONObject: payload) else {
            completion(false, "댓글 데이터를 JSON으로 만들 수 없습니다.")
            return
        }
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(token, forHTTPHeaderField: "x-app-upload-token")
        URLSession.shared.uploadTask(with: request, from: body) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let error {
                    completion(false, "앱 내부 캘린더에는 저장되었습니다.\n웹 댓글 업로드 실패: \(error.localizedDescription)")
                    return
                }
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(statusCode) {
                    if let data {
                        AppMediaCalendarStore.merge(AppMediaCalendarStore.records(fromServerData: data))
                    }
                    completion(true, "앱 캘린더와 웹 대시보드 댓글에 등록되었습니다.")
                } else {
                    self?.uploadCalendarCommentAsMultipart(entry, token: token, uploadURL: uploadURL) { ok, message in
                        if ok {
                            completion(true, message)
                        } else {
                            let responseText = data.flatMap { String(data: $0, encoding: .utf8) }?
                                .trimmingCharacters(in: .whitespacesAndNewlines)
                            let suffix = responseText?.isEmpty == false ? "\n서버 응답: \(responseText!)" : ""
                            completion(false, "앱 내부 캘린더에는 저장되었습니다.\n웹 댓글 업로드 실패: HTTP \(statusCode)\(suffix)\n\(message)")
                        }
                    }
                }
            }
        }.resume()
    }

    private func updateCalendarComment(_ entry: CalendarCommentEntry, completion: @escaping (Bool, String) -> Void) {
        recordCalendarComment(entry)
        guard let commentId = entry.id else {
            completion(false, "수정할 댓글 ID를 찾을 수 없습니다.")
            return
        }
        let token = appMediaAuthorizationToken()
        guard !token.isEmpty else {
            completion(true, "앱 내부 캘린더 댓글을 수정했습니다. 관제 로그인 토큰이 있으면 웹 댓글에도 반영됩니다.")
            return
        }
        guard let uploadURL = URL(string: "\(VitalGuardLinks.safetyMonitor)/api/app-media") else {
            completion(true, "앱 내부 캘린더 댓글을 수정했습니다. 웹 수정 URL을 만들 수 없습니다.")
            return
        }
        let formatter = ISO8601DateFormatter()
        var payload: [String: Any] = [
            "id": commentId,
            "kind": "comment",
            "commentText": entry.text,
            "journalContent": entry.text,
            "ocrText": entry.text,
            "capturedAt": formatter.string(from: entry.date),
            "workerId": currentWorkerIdForUpload(),
            "workerName": currentWorkerNameForUpload(),
            "attachments": entry.attachments.map(\.jsonValue)
        ]
        if let relatedRecordTitle = entry.relatedRecordTitle {
            payload["relatedRecordTitle"] = relatedRecordTitle
            payload["note"] = "관련 파일: \(relatedRecordTitle)"
        }
        guard JSONSerialization.isValidJSONObject(payload),
              let body = try? JSONSerialization.data(withJSONObject: payload) else {
            completion(true, "앱 내부 캘린더 댓글을 수정했습니다. 웹 수정 데이터 생성은 실패했습니다.")
            return
        }
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PATCH"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(token, forHTTPHeaderField: "x-app-upload-token")
        URLSession.shared.uploadTask(with: request, from: body) { data, response, error in
            DispatchQueue.main.async {
                if let error {
                    completion(true, "앱 내부 캘린더 댓글은 수정했습니다.\n웹 수정 실패: \(error.localizedDescription)")
                    return
                }
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(statusCode) {
                    if let data {
                        AppMediaCalendarStore.merge(AppMediaCalendarStore.records(fromServerData: data))
                    }
                    completion(true, "앱 캘린더와 웹 대시보드 댓글을 수정했습니다.")
                } else {
                    completion(true, "앱 내부 캘린더 댓글은 수정했습니다.\n웹 수정 실패: HTTP \(statusCode)")
                }
            }
        }.resume()
    }

    private func deleteCalendarComment(_ record: AppMediaCalendarRecord, completion: @escaping (Bool, String) -> Void) {
        AppMediaCalendarStore.deleteComment(commentId: record.id)
        let token = appMediaAuthorizationToken()
        guard !token.isEmpty else {
            completion(true, "앱 내부 캘린더 댓글을 삭제했습니다. 관제 로그인 토큰이 있으면 웹 댓글에도 반영됩니다.")
            return
        }
        guard var components = URLComponents(string: "\(VitalGuardLinks.safetyMonitor)/api/app-media") else {
            completion(true, "앱 내부 캘린더 댓글을 삭제했습니다. 웹 삭제 URL을 만들 수 없습니다.")
            return
        }
        components.queryItems = [URLQueryItem(name: "id", value: record.id)]
        guard let url = components.url else {
            completion(true, "앱 내부 캘린더 댓글을 삭제했습니다. 웹 삭제 URL을 만들 수 없습니다.")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(token, forHTTPHeaderField: "x-app-upload-token")
        URLSession.shared.dataTask(with: request) { _, response, error in
            DispatchQueue.main.async {
                if let error {
                    completion(true, "앱 내부 캘린더 댓글은 삭제했습니다.\n웹 삭제 실패: \(error.localizedDescription)")
                    return
                }
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(statusCode) {
                    completion(true, "앱 캘린더와 웹 대시보드 댓글을 삭제했습니다.")
                } else {
                    completion(true, "앱 내부 캘린더 댓글은 삭제했습니다.\n웹 삭제 실패: HTTP \(statusCode)")
                }
            }
        }.resume()
    }

    private func uploadCalendarCommentAsMultipart(
        _ entry: CalendarCommentEntry,
        token: String,
        uploadURL: URL,
        completion: @escaping (Bool, String) -> Void
    ) {
        let formatter = ISO8601DateFormatter()
        let workerName = currentWorkerNameForUpload()
        let fileName = "comment-\(Int(entry.date.timeIntervalSince1970)).txt"
        let relatedLine = entry.relatedRecordTitle.map { "\n관련 파일: \($0)" } ?? ""
        let fileText = "\(entry.text)\(relatedLine)"
        let fileData = fileText.data(using: .utf8) ?? Data()
        let boundary = "VitAlGuardCommentBoundary-\(UUID().uuidString)"
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(token, forHTTPHeaderField: "x-app-upload-token")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = makeCalendarCommentMultipartBody(
            entry: entry,
            fileName: fileName,
            fileData: fileData,
            capturedAt: formatter.string(from: entry.date),
            boundary: boundary
        )
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error {
                    completion(false, "multipart 재시도 실패: \(error.localizedDescription)")
                    return
                }
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(statusCode) {
                    if let data {
                        AppMediaCalendarStore.merge(AppMediaCalendarStore.records(fromServerData: data))
                    }
                    completion(true, "앱 캘린더와 웹 대시보드 댓글에 등록되었습니다.")
                } else {
                    let responseText = data.flatMap { String(data: $0, encoding: .utf8) }?
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    let suffix = responseText?.isEmpty == false ? " · \(responseText!)" : ""
                    completion(false, "multipart 재시도 실패: HTTP \(statusCode)\(suffix)")
                }
            }
        }.resume()
    }

    private func appMediaUploadURL(calendarURL: URL?) -> URL? {
        let source = calendarURL ?? URL(string: VitalGuardLinks.safetyMonitor)
        if let source,
           let scheme = source.scheme,
           let host = source.host {
            var components = URLComponents()
            components.scheme = scheme
            components.host = host
            components.port = source.port
            components.path = "/api/app-media"
            return components.url
        }
        return URL(string: "\(VitalGuardLinks.safetyMonitor)/api/app-media")
    }

    private func openCalendarFallback(for entry: FieldJournalEntry) {
        let baseURL = entry.calendarURL ?? URL(string: "\(VitalGuardLinks.safetyMonitor)/#app-media-calendar")
        guard let baseURL, var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { return }
        var items = components.queryItems ?? []
        items.append(contentsOf: [
            URLQueryItem(name: "journalType", value: entry.kind.rawValue),
            URLQueryItem(name: "journalTitle", value: entry.kind.title),
            URLQueryItem(name: "area", value: entry.area),
            URLQueryItem(name: "occurredAt", value: ISO8601DateFormatter().string(from: entry.occurredAt)),
            URLQueryItem(name: "content", value: entry.content),
            URLQueryItem(name: "workerId", value: currentWorkerIdForUpload()),
            URLQueryItem(name: "workerName", value: currentWorkerNameForUpload())
        ])
        components.queryItems = items
        if let url = components.url {
            UIApplication.shared.open(url)
        }
    }

    private func makeAppMediaMultipartBody(payload: AppMediaUploadPayload, fileData: Data, boundary: String) -> Data {
        var body = Data()

        func append(_ string: String) {
            if let data = string.data(using: .utf8) {
                body.append(data)
            }
        }

        func appendField(_ name: String, _ value: String) {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            append("\(value)\r\n")
        }

        let iso = appMediaISO8601String(from: payload.capturedAt, timeZone: payload.timeZone)
        let dateKey = appMediaDateKey(from: payload.capturedAt, timeZone: payload.timeZone)
        appendField("kind", payload.kind)
        appendField("title", payload.title)
        appendField("ocrText", payload.ocrText)
        appendField("capturedAt", iso)
        appendField("dateKey", dateKey)
        if let roadAddress = payload.roadAddress?.trimmingCharacters(in: .whitespacesAndNewlines), !roadAddress.isEmpty {
            appendField("roadAddress", roadAddress)
        }
        if let location = payload.location {
            appendField("latitude", String(format: "%.6f", location.coordinate.latitude))
            appendField("longitude", String(format: "%.6f", location.coordinate.longitude))
        }
        appendField("workerId", payload.workerId)
        appendField("workerName", payload.workerName)
        appendField("source", "VitAlGuard-iPhone")
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"file\"; filename=\"\(payload.fileURL.lastPathComponent)\"\r\n")
        append("Content-Type: \(payload.mimeType)\r\n\r\n")
        body.append(fileData)
        append("\r\n--\(boundary)--\r\n")
        return body
    }

    private func makeCalendarCommentMultipartBody(
        entry: CalendarCommentEntry,
        fileName: String,
        fileData: Data,
        capturedAt: String,
        boundary: String
    ) -> Data {
        var body = Data()
        func append(_ string: String) {
            if let data = string.data(using: .utf8) {
                body.append(data)
            }
        }
        func appendField(_ name: String, _ value: String) {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            append("\(value)\r\n")
        }
        appendField("kind", "comment")
        appendField("title", "댓글 · \(currentWorkerNameForUpload())")
        appendField("ocrText", entry.text)
        appendField("journalContent", entry.text)
        appendField("commentText", entry.text)
        appendField("capturedAt", capturedAt)
        appendField("workerId", currentWorkerIdForUpload())
        appendField("workerName", currentWorkerNameForUpload())
        appendField("source", "VitAlGuard-iPhone")
        appendField("calendarURL", "\(VitalGuardLinks.safetyMonitor)/#app-media-calendar")
        if let relatedRecordTitle = entry.relatedRecordTitle {
            appendField("note", "관련 파일: \(relatedRecordTitle)")
            appendField("relatedRecordTitle", relatedRecordTitle)
        }
        if let relatedRecordId = entry.relatedRecordId {
            appendField("relatedRecordId", relatedRecordId)
        }
        if let attachmentsData = try? JSONSerialization.data(withJSONObject: entry.attachments.map(\.jsonValue)),
           let attachmentsText = String(data: attachmentsData, encoding: .utf8) {
            appendField("attachments", attachmentsText)
        }
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n")
        append("Content-Type: text/plain; charset=utf-8\r\n\r\n")
        body.append(fileData)
        append("\r\n--\(boundary)--\r\n")
        return body
    }

    private func appMediaISO8601String(from date: Date, timeZone: TimeZone) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = timeZone
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private func appMediaDateKey(from date: Date, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func mimeTypeForMediaFile(_ url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "mp4", "m4v":
            return "video/mp4"
        case "mov", "qt":
            return "video/quicktime"
        case "png":
            return "image/png"
        case "heic", "heif":
            return "image/heic"
        case "webp":
            return "image/webp"
        case "pdf":
            return "application/pdf"
        default:
            return "image/jpeg"
        }
    }

    private func extractOCRText(from images: [UIImage]) -> String {
        var perPageTexts: [String] = []
        for (index, image) in images.enumerated() {
            guard let cgImage = image.cgImage else { continue }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true

            do {
                try VNImageRequestHandler(
                    cgImage: cgImage,
                    orientation: image.cgOrientation,
                    options: [:]
                ).perform([request])

                let lines = request.results?
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: "\n") ?? ""
                if !lines.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    perPageTexts.append("페이지 \(index + 1)\n\(lines)")
                } else {
                    perPageTexts.append("페이지 \(index + 1)\n[텍스트 미검출]")
                }
            } catch {
                perPageTexts.append("페이지 \(index + 1)\n[OCR 실패: \(error.localizedDescription)]")
            }
        }

        return perPageTexts.joined(separator: "\n\n")
    }

    private func makePdfFromImages(_ images: [UIImage], fileTag: String) throws -> URL {
        let pages = images.filter { $0.size.width > 0 && $0.size.height > 0 }
        guard !pages.isEmpty else {
            throw NSError(domain: "VitAlGuard", code: -1, userInfo: [NSLocalizedDescriptionKey: "유효한 이미지가 없습니다."])
        }

        let maxWidth = pages.map(\.size.width).max() ?? 612
        let maxHeight = pages.map(\.size.height).max() ?? 792
        let pageRect = CGRect(x: 0, y: 0, width: maxWidth, height: maxHeight)
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [kCGPDFContextTitle as String: "VitAlGuard \(fileTag) Scan"]
        let renderer = UIGraphicsPDFRenderer(bounds: pageRect, format: format)
        let data = renderer.pdfData { context in
            for image in pages {
                context.beginPage()
                let source = image.size
                let scale = min(pageRect.width / source.width, pageRect.height / source.height)
                let drawRect = CGRect(
                    x: (pageRect.width - source.width * scale) / 2,
                    y: (pageRect.height - source.height * scale) / 2,
                    width: source.width * scale,
                    height: source.height * scale
                )
                image.draw(in: drawRect)
            }
        }
        let fileName = "vitalguard_scan_\(fileTag)_\(Int(Date().timeIntervalSince1970)).pdf"
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try data.write(to: fileURL, options: .atomic)
        return fileURL
    }

    private func startMediaCapture(mode: ScanMode) {
        guard !isUploadBusy else {
            presentStatus("문서/사진 스캔", message: "현재 처리 중입니다. 잠시 후 다시 시도해 주세요.")
            return
        }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            presentStatus("카메라 사용 불가", message: "기기에서 카메라를 사용할 수 없습니다.")
            return
        }
        ensureCapturePermissions { [weak self] granted, message in
            guard let self else { return }
            guard granted else {
                self.presentStatus("촬영 권한 필요", message: message)
                return
            }
            self.presentMediaPicker(mode: mode)
        }
    }

    private func ensureCapturePermissions(completion: @escaping (Bool, String) -> Void) {
        let cameraStatus = AVCaptureDevice.authorizationStatus(for: .video)
        let requestPhotos: () -> Void = {
            if #available(iOS 14.0, *) {
                let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
                switch status {
                case .authorized, .limited:
                    DispatchQueue.main.async { completion(true, "") }
                case .notDetermined:
                    PHPhotoLibrary.requestAuthorization(for: .addOnly) { newStatus in
                        DispatchQueue.main.async {
                            completion(newStatus == .authorized || newStatus == .limited, "사진 추가 권한이 필요합니다. iPhone 설정에서 사진 추가 권한을 허용해 주세요.")
                        }
                    }
                default:
                    DispatchQueue.main.async { completion(false, "사진 추가 권한이 필요합니다. iPhone 설정에서 사진 추가 권한을 허용해 주세요.") }
                }
            } else {
                let status = PHPhotoLibrary.authorizationStatus()
                switch status {
                case .authorized:
                    DispatchQueue.main.async { completion(true, "") }
                case .notDetermined:
                    PHPhotoLibrary.requestAuthorization { newStatus in
                        DispatchQueue.main.async {
                            completion(newStatus == .authorized, "사진 앱 저장 권한이 필요합니다. iPhone 설정에서 사진 권한을 허용해 주세요.")
                        }
                    }
                default:
                    DispatchQueue.main.async { completion(false, "사진 앱 저장 권한이 필요합니다. iPhone 설정에서 사진 권한을 허용해 주세요.") }
                }
            }
        }
        switch cameraStatus {
        case .authorized:
            requestPhotos()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    granted ? requestPhotos() : completion(false, "카메라 권한이 필요합니다. iPhone 설정에서 카메라 권한을 허용해 주세요.")
                }
            }
        default:
            completion(false, "카메라 권한이 필요합니다. iPhone 설정에서 카메라 권한을 허용해 주세요.")
        }
    }

    private func presentMediaPicker(mode: ScanMode) {
        requestLocationPermissionForWatermark()
        pendingScanMode = mode
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        if mode == .mediaVideo {
            if #available(iOS 14.0, *) {
                picker.mediaTypes = [UTType.movie.identifier]
            } else {
                picker.mediaTypes = ["public.movie"]
            }
            picker.videoQuality = .typeHigh
            picker.cameraCaptureMode = .video
            picker.videoMaximumDuration = 60
        } else {
            if #available(iOS 14.0, *) {
                picker.mediaTypes = [UTType.image.identifier]
            } else {
                picker.mediaTypes = ["public.image"]
            }
            picker.cameraCaptureMode = .photo
        }
        picker.allowsEditing = false
        picker.delegate = self
        picker.modalPresentationStyle = .fullScreen
        present(picker, animated: true)
    }

    private func startDocumentScan() {
        guard !isUploadBusy else {
            presentStatus("문서/사진 스캔", message: "현재 처리 중입니다. 잠시 후 다시 시도해 주세요.")
            return
        }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            presentStatus("카메라 사용 불가", message: "기기에서 카메라를 사용할 수 없습니다.")
            return
        }
        pendingScanMode = .documentOCR
        if #available(iOS 13.0, *), VNDocumentCameraViewController.isSupported {
            let scanner = VNDocumentCameraViewController()
            scanner.delegate = self
            scanner.modalPresentationStyle = .fullScreen
            present(scanner, animated: true)
            return
        }
        pendingScanMode = .documentOCR
        presentStatus("문서 스캔 미지원", message: "이 기기는 문서 카메라를 지원하지 않아 일반 카메라로 촬영합니다.")
        startMediaCapture(mode: .documentOCR)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        guard latest.horizontalAccuracy > 0 else { return }
        lastKnownWatermarkLocation = latest
        storeLatestLocationForDashboard(latest)
        syncDashboardFromLocationIfNeeded()
        if isWeatherRefreshPending {
            updateLocationWeather(for: latest)
        }
        if !shouldKeepContinuousLocationUpdates && (latest.horizontalAccuracy <= 25 || locations.count >= 3) {
            manager.stopUpdatingLocation()
        }
    }

    private func storeLatestLocationForDashboard(_ location: CLLocation) {
        let defaults = UserDefaults.standard
        defaults.set(location.coordinate.latitude, forKey: PreviewSettingsKey.lastLocationLatitude)
        defaults.set(location.coordinate.longitude, forKey: PreviewSettingsKey.lastLocationLongitude)
        defaults.set(location.horizontalAccuracy, forKey: PreviewSettingsKey.lastLocationAccuracy)
        defaults.set(location.timestamp, forKey: PreviewSettingsKey.lastLocationTimestamp)
    }

    private func syncDashboardFromLocationIfNeeded() {
        let defaults = UserDefaults.standard
        guard isDashboardAutoCollectionEnabled else { return }
        let interval = defaults.object(forKey: PreviewSettingsKey.syncInterval) as? Double ?? 10
        let now = Date()
        if let last = lastLocationDashboardSyncAt, now.timeIntervalSince(last) < max(5, interval) {
            return
        }
        lastLocationDashboardSyncAt = now
        DashboardSyncService.shared.checkReceiverConnection(reason: "gps_location_update")
    }

    private var isDashboardAutoCollectionEnabled: Bool {
        let defaults = UserDefaults.standard
        return defaults.object(forKey: PreviewSettingsKey.autoCollection) == nil
            ? true
            : defaults.bool(forKey: PreviewSettingsKey.autoCollection)
    }

    private var shouldKeepContinuousLocationUpdates: Bool { false }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("location update failed: \(error.localizedDescription)")
        if isWeatherRefreshPending {
            isWeatherRefreshPending = false
            locationWeather.detail = "현재 위치를 가져오지 못했습니다. 위치 권한과 네트워크를 확인해 주세요."
            buildInterface()
        }
        manager.stopUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            if let location = manager.location {
                lastKnownWatermarkLocation = location
                storeLatestLocationForDashboard(location)
                if isWeatherRefreshPending {
                    updateLocationWeather(for: location)
                }
            }
            manager.requestLocation()
        }
    }

    func locationManager(
        _ manager: CLLocationManager,
        didChangeAuthorization status: CLAuthorizationStatus
    ) {
        if status == .authorizedWhenInUse || status == .authorizedAlways {
            if let location = manager.location {
                lastKnownWatermarkLocation = location
                storeLatestLocationForDashboard(location)
                if isWeatherRefreshPending {
                    updateLocationWeather(for: location)
                }
            }
            manager.requestLocation()
        }
    }

    func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        let mediaType = info[.mediaType] as? String
        let isMovieType = if #available(iOS 14.0, *) {
            mediaType == UTType.movie.identifier
        } else {
            mediaType == "public.movie"
        }
        if isMovieType {
            picker.dismiss(animated: true) { [weak self] in
                guard let self, let url = info[.mediaURL] as? URL else { return }
                if self.isPhotoLibraryUploadActive {
                    self.isPhotoLibraryUploadActive = false
                    self.handleImportedVideoUpload(url)
                } else {
                    self.handleVideoCapture(url)
                }
            }
            return
        }
        let image = info[.originalImage] as? UIImage
        picker.dismiss(animated: true) { [weak self] in
            guard let self, let image else { return }
            if self.isPhotoLibraryUploadActive {
                self.isPhotoLibraryUploadActive = false
                self.handleImportedImageUpload(image)
            } else if self.pendingScanMode == .mediaPhoto {
                self.handlePhotoCapture(image)
            } else {
                self.handleScannedImages([image], mode: .documentOCR)
            }
        }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        isPhotoLibraryUploadActive = false
        pendingScanMode = .none
        cancelJournalAttachmentIfNeeded()
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let images: [UIImage] = (0..<scan.pageCount).compactMap { scan.imageOfPage(at: $0) }
        controller.dismiss(animated: true) { [weak self] in
            self?.handleScannedImages(images, mode: .documentOCR)
        }
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        pendingScanMode = .none
        cancelJournalAttachmentIfNeeded()
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        pendingScanMode = .none
        cancelJournalAttachmentIfNeeded()
        presentStatus("문서 스캔", message: "문서 스캔 실패: \(error.localizedDescription)")
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        controller.dismiss(animated: true)
        pendingExportCompletionTitle = nil
        isJournalFileImportActive = false
        isStandaloneFileUploadActive = false
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        controller.dismiss(animated: true)
        if isStandaloneFileUploadActive {
            isStandaloneFileUploadActive = false
            guard let url = urls.first else { return }
            let access = url.startAccessingSecurityScopedResource()
            handleStandaloneFileUpload(url)
            if access {
                url.stopAccessingSecurityScopedResource()
            }
            return
        }
        if !isJournalFileImportActive {
            if let title = pendingExportCompletionTitle {
                recordLocalAlert(title: "문서 저장 완료", message: "\(title)이 파일 앱에 저장되었습니다.")
                presentStatus("문서 저장 완료", message: "업로드와 파일 저장 상태를 캘린더와 알림센터에 기록했습니다.")
                pendingExportCompletionTitle = nil
            }
            return
        }
        guard activeJournalEditor != nil || activeCalendarCommentComposer != nil else { return }
        let picked = urls.prefix(6)
        for url in picked {
            let access = url.startAccessingSecurityScopedResource()
            defer {
                if access {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            let fileURL = copyJournalImportIfNeeded(url)
            let attachment = makeJournalAttachment(
                kind: "file",
                title: "파일 첨부",
                fileURL: fileURL,
                mimeType: mimeTypeForMediaFile(fileURL),
                capturedAt: Date(),
                note: "사용자가 iPhone 캘린더에서 직접 첨부한 파일입니다."
            )
            activeJournalEditor?.addAttachment(attachment)
            activeCalendarCommentComposer?.addAttachment(attachment)
        }
        activeJournalEditor = nil
        activeCalendarCommentComposer = nil
        isJournalFileImportActive = false
        presentStatus("첨부 완료", message: "\(picked.count)개 파일이 작성 중인 항목에 첨부되었습니다.")
    }

    @objc private func openNaverWeather() {
        let browser = SFSafariViewController(url: currentNaverWeatherURL())
        present(browser, animated: true)
    }

    @objc private func refreshLocationWeather() {
        beginLocationWeatherRefresh(rebuildInterface: true)
    }

    private func beginLocationWeatherRefresh(rebuildInterface: Bool) {
        guard CLLocationManager.locationServicesEnabled() else {
            presentStatus("위치 서비스", message: "iPhone 설정에서 위치 서비스를 켜야 현재 위치 기반 날씨를 불러올 수 있습니다.")
            return
        }
        isWeatherRefreshPending = true
        locationWeather.detail = "현재 위치를 확인하고 날씨를 불러오는 중입니다."
        if rebuildInterface {
            rebuildInterfacePreservingScrollPosition()
        }
        requestLocationPermissionForWatermark()
        if let location = watermarkLocationManager.location ?? lastKnownWatermarkLocation {
            updateLocationWeather(for: location, rebuildInterface: rebuildInterface)
        }
    }

    private func updateLocationWeather(for location: CLLocation, rebuildInterface: Bool = true) {
        isWeatherRefreshPending = true
        lastKnownWatermarkLocation = location
        Task { [weak self] in
            guard let self else { return }
            let address = await self.reverseGeocodeAddress(for: location)
            let weather = await self.fetchWeatherSummary(for: location, address: address)
            await MainActor.run {
                self.locationWeather = weather
                self.isWeatherRefreshPending = false
                if rebuildInterface {
                    self.rebuildInterfacePreservingScrollPosition()
                }
            }
        }
    }

    private func fetchWeatherSummary(for location: CLLocation, address: String) async -> LocationWeatherSummary {
        if var appleWeather = await fetchAppleWeatherKitSummary(for: location, address: address) {
            if let dashboardWeather = await fetchDashboardWeatherSummary(for: location, address: address) {
                appleWeather.airQualityText = dashboardWeather.airQualityText
                appleWeather.airQualityIndex = dashboardWeather.airQualityIndex
                appleWeather.alertSummary = dashboardWeather.alertSummary
                appleWeather.specialVideoSummary = dashboardWeather.specialVideoSummary
            }
            return appleWeather
        }

        if let dashboardWeather = await fetchDashboardWeatherSummary(for: location, address: address) {
            return dashboardWeather
        }

        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.6f", location.coordinate.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.6f", location.coordinate.longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m"),
            URLQueryItem(name: "timezone", value: "Asia/Seoul")
        ]

        let query = address.isEmpty ? "현재 위치" : address
        guard let url = components?.url else {
            return LocationWeatherSummary(
                place: query,
                temperature: "--℃",
                detail: "날씨 요청 URL을 만들 수 없습니다.",
                safety: "작업안전: 확인 필요",
                naverQuery: query,
                source: "Open-Meteo 폴백",
                usageText: WeatherKitUsageGate.currentUsageText(),
                radarSummary: "WeatherKit 호출 제한 또는 권한 대기 · 폴백 데이터 사용",
                typhoonSummary: "WeatherKit 바람 데이터 대기 · 폴백 확인 필요",
                alertSummary: "WeatherKit 특보 데이터 대기 · 관제 확인 필요",
                specialVideoSummary: "특보 영상은 WeatherKit 특보 수신 후 연결"
            )
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let response = try JSONDecoder().decode(OpenMeteoWeatherResponse.self, from: data)
            guard let current = response.current else {
                throw NSError(domain: "VitAlGuardWeather", code: -1)
            }
            let temp = current.temperature2m.map { "\(Int($0.rounded()))℃" } ?? "--℃"
            let apparent = current.apparentTemperature.map { "체감 \(Int($0.rounded()))℃" } ?? "체감 --℃"
            let humidity = current.relativeHumidity2m.map { "습도 \(Int($0.rounded()))%" } ?? "습도 --%"
            let wind = current.windSpeed10m.map { String(format: "풍속 %.1fm/s", $0 / 3.6) } ?? "풍속 --m/s"
            let rain = current.precipitation.map { String(format: "강수 %.1fmm", $0) } ?? "강수 --mm"
            let safety = workSafetyText(weatherCode: current.weatherCode, windSpeedKmh: current.windSpeed10m, precipitationMm: current.precipitation)
            return LocationWeatherSummary(
                place: query,
                temperature: temp,
                detail: "\(apparent) · \(humidity) · \(wind)\n\(rain) · GPS 기반 실시간 위치",
                safety: safety,
                naverQuery: query,
                source: "Open-Meteo 폴백",
                usageText: WeatherKitUsageGate.currentUsageText(),
                radarSummary: "WeatherKit 데이터 대기 · 폴백 강수 \(rain)",
                typhoonSummary: "WeatherKit 데이터 대기 · 폴백 \(wind)",
                alertSummary: "WeatherKit 특보 데이터 대기",
                specialVideoSummary: "WeatherKit 특보 수신 시 대응 영상 우선 표시",
                conditionText: "Open-Meteo 현재값",
                temperatureC: current.temperature2m,
                precipitationAmountMm: current.precipitation,
                precipitationIntensityMmH: current.precipitation,
                airQualityText: "대기질 데이터 대기",
                windSpeedMS: current.windSpeed10m.map { $0 / 3.6 },
                windDirectionText: "풍향 데이터 대기",
                hourlyTimeline: dashboardRadarTimes
            )
        } catch {
            return LocationWeatherSummary(
                place: query,
                temperature: "--℃",
                detail: "날씨 수치를 불러오지 못했습니다. 네이버 날씨에서 현재 위치를 확인해 주세요.",
                safety: "작업안전: 확인 필요",
                naverQuery: query,
                source: "날씨 데이터 대기",
                usageText: WeatherKitUsageGate.currentUsageText(),
                radarSummary: "WeatherKit 호출 제한 또는 네트워크 대기",
                typhoonSummary: "WeatherKit 바람·강수 데이터 대기",
                alertSummary: "WeatherKit 특보 데이터 대기",
                specialVideoSummary: "특보 영상은 WeatherKit 특보 수신 후 연결"
            )
        }
    }

    private func isLocationInsideKoreaScope(_ coordinate: CLLocationCoordinate2D) -> Bool {
        let direct = koreanLatitudeRange.contains(coordinate.latitude) && koreanLongitudeRange.contains(coordinate.longitude)
        if direct {
            return true
        }
        // 추가: 독도/울릉도/마라도/백령도 좌표 오차를 보완
        let islandFallbackPoints: [CLLocationCoordinate2D] = [
            CLLocationCoordinate2D(latitude: 37.239, longitude: 131.86),
            CLLocationCoordinate2D(latitude: 37.484, longitude: 130.886),
            CLLocationCoordinate2D(latitude: 33.127, longitude: 126.262),
            CLLocationCoordinate2D(latitude: 37.974, longitude: 124.712)
        ]
        return islandFallbackPoints.contains { point in
            let latDiff = abs(point.latitude - coordinate.latitude)
            let lonDiff = abs(point.longitude - coordinate.longitude)
            return latDiff <= 0.45 && lonDiff <= 0.45
        }
    }

    private func fetchDashboardWeatherSummary(for location: CLLocation, address: String) async -> LocationWeatherSummary? {
        let coordinate = location.coordinate
        guard isLocationInsideKoreaScope(coordinate) else {
            let query = address.isEmpty ? "현재 위치" : address
            return LocationWeatherSummary(
                place: query,
                temperature: "--℃",
                detail: "현재 위치는 관제 대시보드 표시 범위를 벗어났습니다. 화면은 대한민국(독도, 울릉도, 마라도, 백령도 포함) 기준입니다.",
                safety: "작업안전: 확인 필요",
                naverQuery: query,
                source: "관제 대시보드 제한 범위",
                usageText: "대시보드 범위 검증 완료",
                radarSummary: "현재 위치는 대시보드 범위 내 미노출",
                typhoonSummary: "현재 위치는 대시보드 범위 내 미노출",
                alertSummary: "범위 밖 지역은 관제 날씨 미지원",
                specialVideoSummary: "범위 내에서만 특보 대응 영상을 조회할 수 있습니다."
            )
        }

        guard let weatherBase = URL(string: VitalGuardLinks.safetyMonitor),
              var components = URLComponents(url: weatherBase.appendingPathComponent("api/weather"), resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(format: "%.6f", coordinate.latitude)),
            URLQueryItem(name: "lon", value: String(format: "%.6f", coordinate.longitude)),
            URLQueryItem(name: "workers", value: "0")
        ]
        guard let weatherURL = components.url else { return nil }
        do {
            let (data, _) = try await URLSession.shared.data(from: weatherURL)
            let response = try JSONDecoder().decode(DashboardWeatherResponse.self, from: data)
            guard response.ok == nil || response.ok == true,
                  let current = response.current else { return nil }
            let responseLat = response.lat ?? coordinate.latitude
            let responseLon = response.lon ?? coordinate.longitude
            if abs(responseLat - coordinate.latitude) > 1.0 || abs(responseLon - coordinate.longitude) > 1.0 {
                // 좌표 미스매치로 오탐된 좌표를 배제
                return nil
            }

            let temp = "\(Int((current.temperatureC ?? 0).rounded()))℃"
            let apparent = "체감 \(Int((current.apparentTempC ?? 0).rounded()))℃"
            let humidity = "습도 \(Int((current.humidityPct ?? 0).rounded()))%"
            let wind = String(format: "풍속 %.1fkm/h", current.windKmh ?? 0)
            let rain = String(format: "강수 %.1fmm", current.precipitationMm ?? 0)
            let uv = String(format: "UV %.1f", current.uvIndex ?? 0)
            let pm10 = current.pm10
            let pm25 = current.pm25
            let air = pmText(pm10: pm10, pm25: pm25)
            let airIndex = pm25 ?? pm10
            let safety = workSafetyText(
                weatherCode: current.weatherCode,
                windSpeedKmh: current.windKmh ?? 0,
                precipitationMm: current.precipitationMm ?? 0
            )
            let query = address.isEmpty ? "현재 위치" : address
            let usage = response.stale == true
                ? "관제 대시보드 캐시(지연 반영)"
                : (response.cached == true ? "관제 대시보드 캐시" : "관제 대시보드 실시간")
            return LocationWeatherSummary(
                place: query,
                temperature: temp,
                detail: "\(wind) · \(rain) · \(uv)\n\(apparent) · \(humidity) · \(air)",
                safety: safety,
                naverQuery: query,
                source: response.source == "open-meteo" ? "관제 대시보드 날씨" : "관제 대시보드",
                usageText: usage,
                radarSummary: "\(rain) · 시·분포는 태풍 경로/강수 모니터링 구간에서 확인",
                typhoonSummary: "\(wind) · 대기압/태풍 추적은 관제 구간 데이터 사용",
                alertSummary: air.isEmpty ? "현재 대기질 경보 없음" : "\(air)",
                specialVideoSummary: "특보 영상은 관제 알림 기준으로 표시",
                conditionText: "관제 대시보드 현재값",
                temperatureC: current.temperatureC,
                precipitationAmountMm: current.precipitationMm,
                precipitationIntensityMmH: current.precipitationMm,
                airQualityIndex: airIndex,
                airQualityText: air,
                windSpeedMS: (current.windKmh ?? 0) / 3.6,
                windDirectionText: "관제 풍속",
                hourlyTimeline: dashboardRadarTimes
            )
        } catch {
            return nil
        }
    }

    private func pmText(pm10: Double?, pm25: Double?) -> String {
        let pm10Text = pm10.map { String(format: "PM10 %.1f㎍/m³", $0) } ?? ""
        let pm25Text = pm25.map { String(format: "PM2.5 %.1f㎍/m³", $0) } ?? ""
        if pm10Text.isEmpty && pm25Text.isEmpty {
            return "대기질 데이터 대기중"
        }
        if pm10Text.isEmpty {
            return pm25Text
        }
        if pm25Text.isEmpty {
            return pm10Text
        }
        return "\(pm10Text) · \(pm25Text)"
    }

    private func weatherKitCacheKey(for location: CLLocation) -> String {
        let lat = (location.coordinate.latitude * 100).rounded() / 100
        let lon = (location.coordinate.longitude * 100).rounded() / 100
        return String(format: "%.2f,%.2f", lat, lon)
    }

    private func fetchAppleWeatherKitSummary(for location: CLLocation, address: String) async -> LocationWeatherSummary? {
        guard #available(iOS 16.0, *) else { return nil }
        let key = weatherKitCacheKey(for: location)
        let now = Date()
        if let cachedWeatherKitSummary,
           cachedWeatherKitSummary.key == key,
           now.timeIntervalSince(cachedWeatherKitSummary.fetchedAt) < weatherKitCacheLifetime {
            var summary = cachedWeatherKitSummary.summary
            summary.usageText = "\(WeatherKitUsageGate.currentUsageText()) · 캐시 사용"
            return summary
        }
        guard WeatherKitUsageGate.canUseOneCall(now: now) else {
            return LocationWeatherSummary(
                place: address.isEmpty ? "현재 위치" : address,
                temperature: "--℃",
                detail: "WeatherKit 월 10만 호출 보호 한도에 도달해 Apple Weather 호출을 중지했습니다.",
                safety: "작업안전: 확인 필요",
                naverQuery: address.isEmpty ? "현재 위치" : address,
                source: "WeatherKit 보호 한도",
                usageText: WeatherKitUsageGate.currentUsageText(),
                radarSummary: "월 10만 호출 보호 한도 도달 · 캐시/관제 데이터 확인",
                typhoonSummary: "월 10만 호출 보호 한도 도달 · 관제 데이터 확인",
                alertSummary: "월 10만 호출 보호 한도 도달 · 특보 확인 필요",
                specialVideoSummary: "특보 영상은 WeatherKit 호출 한도 회복 후 갱신"
            )
        }

        do {
            WeatherKitUsageGate.recordOneCall(now: now)
            let weather = try await WeatherService.shared.weather(for: location)
            let current = weather.currentWeather
            let query = address.isEmpty ? "현재 위치" : address
            let temp = "\(Int(current.temperature.converted(to: .celsius).value.rounded()))℃"
            let tempC = current.temperature.converted(to: .celsius).value
            let apparent = "체감 \(Int(current.apparentTemperature.converted(to: .celsius).value.rounded()))℃"
            let humidity = "습도 \(Int((current.humidity * 100).rounded()))%"
            let windMs = current.wind.speed.converted(to: .metersPerSecond).value
            let wind = String(format: "풍속 %.1fm/s", windMs)
            let rainRate = current.precipitationIntensity.converted(to: .metersPerSecond).value * 3_600_000
            let rain = String(format: "강수강도 %.1fmm/h", rainRate)
            let topHours = Array(weather.hourlyForecast.forecast.prefix(7))
            let maxRainChance = topHours.map(\.precipitationChance).max() ?? 0
            let wetHours = topHours.filter { $0.precipitationChance >= 0.30 }.count
            let rainAmount = topHours.first?.precipitationAmount.converted(to: .millimeters).value
            let timeFormatter = DateFormatter()
            timeFormatter.locale = Locale(identifier: "ko_KR")
            timeFormatter.timeZone = TimeZone(identifier: "Asia/Seoul")
            timeFormatter.dateFormat = "HH:mm"
            let hourlyTimeline = topHours.map { hour -> String in
                timeFormatter.string(from: hour.date)
            }
            let hourlyForecasts = topHours.map { hour -> WeatherTimelinePoint in
                WeatherTimelinePoint(
                    timeText: timeFormatter.string(from: hour.date),
                    conditionText: hour.condition.description,
                    symbolName: hour.symbolName,
                    temperatureC: hour.temperature.converted(to: .celsius).value,
                    precipitationChance: hour.precipitationChance,
                    precipitationAmountMm: hour.precipitationAmount.converted(to: .millimeters).value,
                    precipitationIntensityMmH: hour.precipitationAmount.converted(to: .millimeters).value,
                    windSpeedMS: hour.wind.speed.converted(to: .metersPerSecond).value,
                    windDirectionText: hour.wind.compassDirection.abbreviation
                )
            }
            let alerts = weather.weatherAlerts ?? []
            let alertLine = alerts.first.map { "\($0.summary) · \($0.severity.rawValue)" } ?? "현재 WeatherKit 특보 없음"
            let safety = appleWeatherSafetyText(rainRate: rainRate, windMs: windMs, alertCount: alerts.count, precipitationChance: maxRainChance)
            let radar = "Apple Weather 강수확률 최고 \(Int((maxRainChance * 100).rounded()))% · \(wetHours)개 시간대 감시"
            let typhoon = String(format: "Apple Weather 바람 %.1fm/s · 기압 %.0fhPa · 태풍 위험 자동 감시", windMs, current.pressure.converted(to: .hectopascals).value)
            let special = alerts.isEmpty ? "특보 없음 · 일반 안전 영상 대기" : "특보 \(alerts.count)건 · 대응 영상 우선 표시"
            var summary = LocationWeatherSummary(
                place: query,
                temperature: temp,
                detail: "\(current.condition.description) · \(apparent) · \(humidity)\n\(wind) · \(rain) · Apple Weather",
                safety: safety,
                naverQuery: query,
                source: "Apple WeatherKit",
                usageText: WeatherKitUsageGate.currentUsageText(),
                radarSummary: radar,
                typhoonSummary: typhoon,
                alertSummary: alertLine,
                specialVideoSummary: special,
                conditionText: current.condition.description,
                conditionSymbolName: current.symbolName,
                temperatureC: tempC,
                precipitationChance: maxRainChance,
                precipitationAmountMm: rainAmount,
                precipitationIntensityMmH: rainRate,
                airQualityText: alerts.isEmpty ? "Apple Weather 특보 없음 · 시정 \(Int(current.visibility.converted(to: .kilometers).value.rounded()))km" : alertLine,
                windSpeedMS: windMs,
                windDirectionText: current.wind.compassDirection.abbreviation,
                hourlyTimeline: hourlyTimeline,
                hourlyForecasts: hourlyForecasts
            )
            summary.usageText = "\(summary.usageText) · 새 호출"
            cachedWeatherKitSummary = (key: key, fetchedAt: now, summary: summary)
            return summary
        } catch {
            return nil
        }
    }

    private func appleWeatherSafetyText(rainRate: Double, windMs: Double, alertCount: Int, precipitationChance: Double) -> String {
        if alertCount > 0 || rainRate >= 5 || windMs >= 10 {
            return "작업안전: 위험"
        }
        if rainRate > 0 || windMs >= 6 || precipitationChance >= 0.35 {
            return "작업안전: 주의"
        }
        return "작업안전: 정상"
    }

    private func workSafetyText(weatherCode: Int?, windSpeedKmh: Double?, precipitationMm: Double?) -> String {
        let heavyRain = (precipitationMm ?? 0) >= 5
        let strongWind = (windSpeedKmh ?? 0) >= 36
        let thunder = weatherCode == 95 || weatherCode == 96 || weatherCode == 99
        if heavyRain || strongWind || thunder {
            return "작업안전: 위험"
        }
        if (precipitationMm ?? 0) > 0 || (windSpeedKmh ?? 0) >= 22 {
            return "작업안전: 주의"
        }
        return "작업안전: 정상"
    }

    private func currentNaverWeatherURL() -> URL {
        var components = URLComponents(string: "https://m.search.naver.com/search.naver")
        let query = normalizedNaverWeatherQuery(from: locationWeather.naverQuery)
        components?.queryItems = [
            URLQueryItem(name: "query", value: "\(query) 날씨")
        ]
        return components?.url ?? naverWeatherURL
    }

    private func normalizedNaverWeatherQuery(from rawValue: String) -> String {
        let fallback = "광주 북구"
        let ignoredTokens: Set<String> = ["대한민국", "한국", "주소", "미확인", "현장", "A", "B", "C"]
        let cleanup = rawValue
            .replacingOccurrences(of: "도로명주소:", with: " ")
            .replacingOccurrences(of: "광주광역시", with: "광주")
            .replacingOccurrences(of: "전남광주", with: "광주")
            .replacingOccurrences(of: "현장 A", with: " ")
            .replacingOccurrences(of: "현장", with: " ")
        let rawTokens = cleanup
            .components(separatedBy: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !ignoredTokens.contains($0) }

        guard !rawTokens.isEmpty else { return fallback }

        func firstIndex(where predicate: (String) -> Bool) -> Int? {
            rawTokens.firstIndex(where: predicate)
        }

        if let guIndex = firstIndex(where: { $0.hasSuffix("구") || $0.hasSuffix("군") || $0.hasSuffix("시") }) {
            let cityIndex = rawTokens[..<guIndex].lastIndex { token in
                token.hasSuffix("시") || token.hasSuffix("도") || token.hasSuffix("광주")
            }
            var picked: [String] = []
            if let cityIndex {
                picked.append(rawTokens[cityIndex])
            } else if guIndex > rawTokens.startIndex {
                picked.append(rawTokens[rawTokens.index(before: guIndex)])
            }
            picked.append(rawTokens[guIndex])

            if rawTokens.indices.contains(rawTokens.index(after: guIndex)) {
                let next = rawTokens[rawTokens.index(after: guIndex)]
                if next.hasSuffix("동") || next.hasSuffix("읍") || next.hasSuffix("면") || next.hasSuffix("리") {
                    picked.append(next)
                }
            }
            let joined = dedupeConsecutiveTokens(picked).joined(separator: " ")
            return joined.isEmpty ? fallback : joined
        }

        let administrative = rawTokens.prefix(2).joined(separator: " ")
        return administrative.isEmpty ? fallback : administrative
    }

    @objc private func openSignup() {
        guard let url = URL(string: VitalGuardLinks.safetyMonitor) else {
            presentStatus("회원가입", message: "웹 주소를 열 수 없습니다.")
            return
        }
        let browser = SFSafariViewController(url: url)
        present(browser, animated: true)
    }

    @objc private func loginWithID() {
        view.endEditing(true)
        let id = (loginField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let password = (passwordField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            presentStatus("로그인 실패", message: "관제웹 계정 ID를 입력해 주세요.")
            return
        }
        guard !password.isEmpty else {
            presentStatus("로그인 실패", message: "비밀번호를 입력해 주세요.")
            return
        }
        guard !isLoginRequestInFlight else { return }
        guard let url = URL(string: VitalGuardLinks.appAuthLogin) else {
            presentStatus("로그인 실패", message: "앱 로그인 API 주소를 만들 수 없습니다.")
            return
        }

        isLoginRequestInFlight = true
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "id": id,
            "password": password
        ])

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.isLoginRequestInFlight = false
                if let error {
                    self.presentStatus("로그인 실패", message: error.localizedDescription)
                    return
                }

                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                let decoded = data.flatMap { try? JSONDecoder().decode(AppAuthLoginResponse.self, from: $0) }
                guard (200..<300).contains(statusCode),
                      decoded?.ok == true,
                      let token = decoded?.token?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !token.isEmpty,
                      let user = decoded?.user
                else {
                    self.presentStatus("로그인 실패", message: self.appAuthFailureMessage(statusCode: statusCode, response: decoded))
                    return
                }

                self.applyAppAuthSession(token: token, user: user)
            }
        }.resume()
    }

    @objc private func focusPasswordField() {
        passwordField.becomeFirstResponder()
    }

    private func applyAppAuthSession(token: String, user: AppAuthUser) {
        let id = user.id.trimmingCharacters(in: .whitespacesAndNewlines)
        let role = user.role.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = user.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let serverWorkerId = user.workerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !id.isEmpty, let mode = modeForServerRole(role) ?? modeForLoginID(id) else {
            presentStatus("로그인 실패", message: "서버 계정 역할을 앱 모드로 해석할 수 없습니다.")
            return
        }

        let employeeId = serverWorkerId.isEmpty ? vitalGuardEmployeeIdentifier(for: id) : serverWorkerId
        let displayName = name.isEmpty ? (mode == .admin ? "VitAlGuard 관리자" : "VitAlGuard 근로자") : name
        let serverRole = normalizedAppServerRole(role, fallbackMode: mode)
        UserDefaults.standard.set(false, forKey: PreviewSettingsKey.forceSignedOut)
        UserDefaults.standard.set(id, forKey: PreviewSettingsKey.loggedInId)
        UserDefaults.standard.set(mode.rawValue, forKey: PreviewSettingsKey.appMode)
        UserDefaults.standard.set(serverRole, forKey: PreviewSettingsKey.appServerRole)
        UserDefaults.standard.set(employeeId, forKey: PreviewSettingsKey.employeeId)
        UserDefaults.standard.set(displayName, forKey: PreviewSettingsKey.workerName)
        DashboardCredentialStore.saveAppJWT(token)
        hasAttemptedDashboardSummaryTokenRefresh = false
        VitAlGuardSharedStorage.saveAppMode(mode)
        VitAlGuardSharedStorage.saveWalletIdentityPayload([
            "name": displayName,
            "employeeId": employeeId,
            "role": mode.rawValue,
            "serverRole": serverRole,
            "permissionSummary": appServerPermissionSummary(serverRole)
        ])
        WidgetCenter.shared.reloadAllTimelines()
        PhoneWatchBridge.shared.publish(loginId: id, mode: mode, syncInterval: Double(syncIntervalSeconds))
        refreshLiveActivity(loginId: id, mode: mode)
        loginField.resignFirstResponder()
        passwordField.text = ""
        passwordField.resignFirstResponder()
        buildInterface()
    }

    private func appAuthFailureMessage(statusCode: Int, response: AppAuthLoginResponse?) -> String {
        switch response?.error {
        case "invalid_credentials":
            return "ID 또는 비밀번호가 올바르지 않습니다."
        case "not_approved":
            return "승인되지 않은 계정입니다. 관제웹 관리자에게 승인 상태를 확인해 주세요."
        case "too_many_attempts":
            if let retryAfterSec = response?.retryAfterSec {
                return "로그인 시도가 잠시 제한되었습니다. \(retryAfterSec)초 후 다시 시도해 주세요."
            }
            return "로그인 시도가 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요."
        case "invalid_request":
            return "로그인 요청 형식이 올바르지 않습니다."
        case "app_auth_not_configured":
            return "서버의 앱 로그인 설정이 아직 활성화되지 않았습니다."
        default:
            return statusCode > 0 ? "서버 응답 코드 \(statusCode)" : "서버 응답을 확인할 수 없습니다."
        }
    }

    @objc private func setupPasskeyForLoginID() {
        view.endEditing(true)
        let id = (loginField.text ?? loggedInID ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            presentStatus("패스키 설정", message: "먼저 관리자 ID 또는 근로자 ID를 입력해 주세요.")
            return
        }
        guard let relyingParty = passkeyRelyingPartyIdentifier() else {
            presentStatus(
                "패스키 서버 필요",
                message: "패스키는 Apple 암호 앱과 연결된 도메인(webcredentials) 및 서버 챌린지 검증이 필요합니다. 대시보드/서명 서버 도메인을 설정한 뒤 다시 시도해 주세요."
            )
            return
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingParty)
        let challenge = Data(UUID().uuidString.utf8)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: id,
            userID: Data(id.utf8)
        )
        request.displayName = id
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    @objc private func loginWithAppleID() {
        view.endEditing(true)
        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        request.requestedScopes = [.fullName, .email]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    @objc private func loginWithGoogle() {
        presentStatus(
            "Google 로그인",
            message: "Google 로그인 버튼은 추가되었습니다. 실제 자동 로그인은 GoogleSignIn iOS SDK, URL Scheme, 그리고 관제웹의 Google ID 토큰 검증 API를 연결하면 활성화됩니다."
        )
    }

    private func passkeyRelyingPartyIdentifier() -> String? {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.endpoint)
        let normalized = DashboardSyncService.shared.normalizedEndpoint(from: raw)
        guard let host = URL(string: normalized)?.host ?? URL(string: VitalGuardLinks.safetyMonitor)?.host,
              !host.isEmpty
        else { return nil }
        return host
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            let id = credential.credentialID.base64EncodedString()
            UserDefaults.standard.set(id, forKey: "preview.passkeyCredentialId")
            presentStatus("패스키 생성됨", message: "이 기기에서 VitAlGuard 로그인용 패스키가 생성되었습니다. 실제 서비스에서는 서버에 공개키를 등록해 다음 로그인부터 패스키 검증을 사용합니다.")
        } else if let credential = authorization.credential as? ASAuthorizationAppleIDCredential {
            let email = credential.email?.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayName = PersonNameComponentsFormatter().string(from: credential.fullName ?? PersonNameComponents())
            let providerUserId = credential.user.trimmingCharacters(in: .whitespacesAndNewlines)
            let typedId = (loginField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let loginId = typedId.isEmpty ? "apple-\(String(providerUserId.prefix(10)))" : typedId
            let resolvedName = displayName.isEmpty ? (email ?? "Apple 사용자") : displayName
            let role = modeForLoginID(loginId) ?? currentMode
            applyAppAuthSession(
                token: "apple-local-\(providerUserId)",
                user: AppAuthUser(
                    id: loginId,
                    name: resolvedName,
                    role: role == .admin ? "admin" : "worker",
                    workerId: nil
                )
            )
            presentStatus(
                "Apple 로그인",
                message: "Apple 인증이 완료되어 앱 세션에 반영했습니다. 운영용 계정 매핑은 관제웹 서버에서 Apple identity token을 검증해 같은 사용자 ID로 내려주는 방식으로 연결하세요."
            )
        } else {
            presentStatus("Apple 암호", message: "Apple 암호/패스키 작업이 완료되었습니다.")
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        presentStatus("패스키 설정 실패", message: error.localizedDescription)
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        view.window ?? ASPresentationAnchor()
    }

    private func modeForLoginID(_ id: String) -> AppMode? {
        let lowered = id.lowercased()
        if lowered.hasPrefix("admin") || lowered.hasPrefix("adm") || id.contains("관리자") || lowered.hasPrefix("manager") {
            return .admin
        }
        if lowered.hasPrefix("worker") || lowered.hasPrefix("wkr") || lowered.hasPrefix("emp") || id.contains("근로자") {
            return .worker
        }
        return nil
    }

    private func modeForServerRole(_ role: String) -> AppMode? {
        switch role.lowercased() {
        case "owner", "admin":
            return .admin
        case "worker":
            return .worker
        default:
            return nil
        }
    }

    @objc private func logoutSession() {
        view.endEditing(true)
        isLoginRequestInFlight = false
        stopDashboardAutoSync()
        dashboardRadarTimer?.invalidate()
        dashboardRadarTimer = nil
        dashboardRadarIsPlaying = false
        activeMainTab = .home
        rootScrollView?.setContentOffset(.zero, animated: false)
        UserDefaults.standard.set(true, forKey: PreviewSettingsKey.forceSignedOut)
        UserDefaults.standard.removeObject(forKey: PreviewSettingsKey.loggedInId)
        UserDefaults.standard.removeObject(forKey: PreviewSettingsKey.employeeId)
        UserDefaults.standard.removeObject(forKey: PreviewSettingsKey.workerName)
        UserDefaults.standard.removeObject(forKey: PreviewSettingsKey.appMode)
        UserDefaults.standard.removeObject(forKey: PreviewSettingsKey.appServerRole)
        UserDefaults.standard.synchronize()
        DashboardCredentialStore.deleteAppJWT()
        VitAlGuardSharedStorage.saveAppMode(.worker)
        WidgetCenter.shared.reloadAllTimelines()
        PhoneWatchBridge.shared.publishSignedOut(syncInterval: Double(syncIntervalSeconds))
        if #available(iOS 16.2, *) {
            VitAlGuardLiveActivityManager.shared.end()
        }
        loginField.text = ""
        passwordField.text = ""
        buildInterface()
    }

    @objc private func manualWatchSync() {
        refreshWatchData(showStatus: true)
    }

    private func refreshWatchData(showStatus: Bool, rebuildInterface: Bool = true) {
        PhoneWatchBridge.shared.publishCurrentSession()
        PhoneWatchBridge.shared.requestWatchManualSync()
        refreshLiveActivity()
        if rebuildInterface {
            rebuildInterfacePreservingScrollPosition()
        }
        if showStatus {
            presentStatus(
                "Watch 업데이트 요청",
                message: "Apple Watch 실측 snapshot을 요청했습니다. 수신되지 않은 센서는 --로 표시됩니다."
            )
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            self?.watchRefreshControl?.endRefreshing()
        }
    }

    @objc private func refreshWatchFromPull(_ sender: UIRefreshControl) {
        guard activeMainTab == .watch else {
            sender.endRefreshing()
            return
        }
        refreshWatchData(showStatus: false)
    }

    @objc private func refreshWatchFromButton(_ sender: UIButton) {
        sender.isEnabled = false
        UIView.animate(withDuration: 0.28) {
            sender.transform = CGAffineTransform(rotationAngle: .pi)
        } completion: { [weak self, weak sender] _ in
            sender?.transform = .identity
            sender?.isEnabled = true
            self?.refreshWatchData(showStatus: true)
        }
    }

    @objc private func handleWatchVitalsUpdated(_ notification: Notification) {
        refreshLiveActivity()
        let payload = notification.userInfo.map { dictionaryPayload(from: $0) } ?? PhoneMeasuredVitalSnapshot.current.values
        if let fallAlert = pendingFallAlert(from: payload) {
            presentFallConfirmationIfNeeded(fallAlert)
            return
        }
        if let message = watchAnomalyMessage(from: PhoneMeasuredVitalSnapshot.current), shouldRecordWatchAnomalyAlert() {
            recordLocalAlert(title: "Watch 생체 이상", message: message)
        } else {
            buildInterface()
        }
    }

    private func dictionaryPayload(from payload: [AnyHashable: Any]) -> [String: Any] {
        payload.reduce(into: [String: Any]()) { partial, item in
            if let key = item.key as? String {
                partial[key] = item.value
            }
        }
    }

    private func pendingFallAlert(from values: [String: Any]) -> PhoneFallAlert? {
        let outcome = (values["fallPromptOutcome"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let updatePhase = (values["fallUpdatePhase"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let isPendingCandidate = boolValue(values["fallCandidate"]) && (outcome.isEmpty || outcome == "pending")
        let isEscalatedFall = boolValue(values["fallDetected"])
        guard isPendingCandidate || isEscalatedFall else { return nil }
        guard updatePhase != "prompt_result" || outcome == "pending" else { return nil }

        let candidateId = [
            values["fallCandidateId"] as? String,
            values["candidateId"] as? String
        ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
            ?? "fall-\(Int(Date().timeIntervalSince1970))"
        let workerName = [
            values["workerName"] as? String,
            values["employeeId"] as? String,
            values["workerId"] as? String
        ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
            ?? "Apple Watch"
        var detailParts: [String] = []
        if let g = doublePayloadValue(values["accelMagnitudeG"] ?? values["accelerationMagnitudeG"]) {
            detailParts.append(String(format: "충격 %.1fG", g))
        }
        if let still = doublePayloadValue(values["motionStillSec"]) {
            detailParts.append(String(format: "정지 %.1f초", still))
        }
        let detail = detailParts.isEmpty ? "" : "\n\(detailParts.joined(separator: " · "))"
        return PhoneFallAlert(
            candidateId: candidateId,
            workerName: workerName,
            message: "낙상이 감지되었습니다. 위급한 상황이신가요?\n예 / 아니오\(detail)"
        )
    }

    private func presentFallConfirmationIfNeeded(_ alert: PhoneFallAlert) {
        let defaults = UserDefaults.standard
        if defaults.string(forKey: PreviewSettingsKey.lastFallConfirmationCandidateId) == alert.candidateId {
            buildInterface()
            return
        }
        defaults.set(alert.candidateId, forKey: PreviewSettingsKey.lastFallConfirmationCandidateId)
        defaults.set(alert.candidateId, forKey: PreviewSettingsKey.activeFallConfirmationCandidateId)
        recordLocalAlert(
            title: "낙상 확인 필요",
            message: alert.message,
            categoryIdentifier: PhoneWatchBridge.fallConfirmationCategoryIdentifier,
            userInfo: ["candidateId": alert.candidateId]
        )
        if #available(iOS 16.2, *) {
            VitAlGuardLiveActivityManager.shared.showFallConfirmation(
                loginId: loggedInID ?? "",
                workerName: alert.workerName
            )
        }
        buildInterface()
    }

    @objc private func handleFallResponseRequested(_ notification: Notification) {
        let action = notification.userInfo?["action"] as? String ?? ""
        let incomingCandidateId = (notification.userInfo?["candidateId"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let storedCandidateId = UserDefaults.standard.string(forKey: PreviewSettingsKey.activeFallConfirmationCandidateId) ?? ""
        let candidateId = incomingCandidateId.isEmpty ? storedCandidateId : incomingCandidateId
        if action == PhoneWatchBridge.fallDismissActionIdentifier {
            dismissFallConfirmation(candidateId: candidateId)
        } else {
            confirmFallEmergency(candidateId: candidateId)
        }
    }

    private func confirmFallEmergency(candidateId: String) {
        DashboardSyncService.shared.checkReceiverConnection(reason: "fall") { [weak self] _, message in
            DispatchQueue.main.async {
                guard let self else { return }
                self.recordLocalAlert(title: "낙상 관제 알람 전송", message: "사용자가 위급 상황으로 확인했습니다.\n\(message)")
                UserDefaults.standard.removeObject(forKey: PreviewSettingsKey.activeFallConfirmationCandidateId)
                if #available(iOS 16.2, *) {
                    VitAlGuardLiveActivityManager.shared.end()
                }
                self.buildInterface()
            }
        }
    }

    private func dismissFallConfirmation(candidateId: String) {
        if #available(iOS 16.2, *) {
            VitAlGuardLiveActivityManager.shared.end()
        }
        if !candidateId.isEmpty {
            PhoneWatchBridge.shared.sendFallClear(candidateId: candidateId)
        }
        UserDefaults.standard.removeObject(forKey: PreviewSettingsKey.activeFallConfirmationCandidateId)
        recordLocalAlert(title: "낙상 경고 해제", message: "사용자가 위급 상황이 아니라고 응답했습니다. iPhone과 Apple Watch 경고를 해제했습니다.")
        buildInterface()
    }

    private func boolValue(_ value: Any?) -> Bool {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let string = value as? String {
            switch string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "1", "yes", "y": return true
            default: return false
            }
        }
        return false
    }

    private func doublePayloadValue(_ value: Any?) -> Double? {
        if let double = value as? Double { return double }
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private func shouldRecordWatchAnomalyAlert() -> Bool {
        let now = Date()
        if let last = UserDefaults.standard.object(forKey: PreviewSettingsKey.lastWatchAnomalyAlert) as? Date,
           now.timeIntervalSince(last) < 180 {
            return false
        }
        UserDefaults.standard.set(now, forKey: PreviewSettingsKey.lastWatchAnomalyAlert)
        return true
    }

    private func watchAnomalyMessage(from snapshot: PhoneMeasuredVitalSnapshot) -> String? {
        var parts: [String] = []
        if let heartRate = snapshot.doubleValue("heartRate"), heartRate >= 130 || heartRate <= 45 {
            parts.append("심박 \(Int(heartRate.rounded()))bpm")
        }
        if let spo2 = snapshot.doubleValue("spo2"), spo2 > 0, spo2 < 92 {
            parts.append("SpO2 \(Int(spo2.rounded()))%")
        }
        if let ecg = snapshot.values["ecgStatus"] as? String, !ecg.isEmpty, ecg != "--", ecg != "동리듬" {
            parts.append("ECG \(ecg)")
        }
        guard !parts.isEmpty else { return nil }
        return "Apple Watch에서 이상 신호가 감지되었습니다: \(parts.joined(separator: ", "))"
    }

    @objc private func showWatchLoginApprovalMessage() {
        PhoneWatchBridge.shared.publishCurrentSession()
        presentStatus("로그인 연동", message: "AppleWatch용 앱에서 로그인합니다.")
    }

    @objc private func keyboardWillChangeFrame(_ note: Notification) {
        guard let scroll = rootScrollView,
              let endFrame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
        else { return }
        let keyboardFrame = view.convert(endFrame, from: nil)
        let overlap = max(0, view.bounds.maxY - keyboardFrame.minY)
        keyboardOverlap = overlap
        let bottomInset = overlap + 220
        scroll.contentInset.bottom = bottomInset
        scroll.verticalScrollIndicatorInsets.bottom = bottomInset
        if loginField.isFirstResponder {
            scrollLoginPanelAboveKeyboard(animated: true)
        }
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        guard let scroll = rootScrollView else { return }
        keyboardOverlap = 0
        scroll.contentInset.bottom = 0
        scroll.verticalScrollIndicatorInsets.bottom = 0
    }

    @objc private func loginFieldDidBeginEditing() {
        scrollLoginPanelAboveKeyboard(animated: true)
    }

    private func scrollLoginPanelAboveKeyboard(animated: Bool) {
        guard let scroll = rootScrollView, let panel = loginPanelView else { return }
        view.layoutIfNeeded()
        let panelFrame = panel.convert(panel.bounds, to: scroll)
        let visibleHeight = max(1, scroll.bounds.height - keyboardOverlap)
        let targetY = max(
            -scroll.adjustedContentInset.top,
            panelFrame.maxY - visibleHeight + 42
        )
        scroll.setContentOffset(CGPoint(x: 0, y: targetY), animated: animated)
    }

    private func saveDefaultWalletIdentity(name: String, loginId: String, fallbackEmployeeId: String, role: AppMode) {
        let employeeId = loginId.isEmpty ? fallbackEmployeeId : vitalGuardEmployeeIdentifier(for: loginId)
        let identity = WalletIdentityPayload(
            role: role,
            name: name,
            employeeId: employeeId,
            phone: "",
            department: "",
            rank: "",
            jobTitle: "",
            workZone: "",
            siteName: "광주 북구 현장 A",
            hireDate: "2026-06-30",
            expiryDate: "2027-06-30"
        )
        VitAlGuardSharedStorage.saveWalletIdentity(
            identity.dictionary,
            qrPNGData: WalletIdentityViewController.makeQRCode(from: identity.encodedString)?.pngData(),
            barcodePNGData: WalletIdentityViewController.makeCode128(from: identity.barcodeString)?.pngData()
        )
    }

    @objc private func setAdminMode() {
        guard let loginId = loggedInID else { return }
        UserDefaults.standard.set(AppMode.admin.rawValue, forKey: PreviewSettingsKey.appMode)
        UserDefaults.standard.set("admin", forKey: PreviewSettingsKey.appServerRole)
        VitAlGuardSharedStorage.saveAppMode(.admin)
        saveDefaultWalletIdentity(name: "VitAlGuard 관리자", loginId: loginId, fallbackEmployeeId: "admin7276", role: .admin)
        WidgetCenter.shared.reloadAllTimelines()
        PhoneWatchBridge.shared.publishCurrentSession()
        buildInterface()
    }

    @objc private func setWorkerMode() {
        guard let loginId = loggedInID else { return }
        UserDefaults.standard.set(AppMode.worker.rawValue, forKey: PreviewSettingsKey.appMode)
        UserDefaults.standard.set("worker", forKey: PreviewSettingsKey.appServerRole)
        VitAlGuardSharedStorage.saveAppMode(.worker)
        saveDefaultWalletIdentity(name: "VitAlGuard 근로자", loginId: loginId, fallbackEmployeeId: "worker7276", role: .worker)
        WidgetCenter.shared.reloadAllTimelines()
        PhoneWatchBridge.shared.publishCurrentSession()
        buildInterface()
    }

    @objc private func handleEmergencyAction(_ sender: UIButton) {
        let actions = EmergencyActionKind.allCases
        guard actions.indices.contains(sender.tag) else { return }
        let action = actions[sender.tag]
        switch action {
        case .minor, .serious:
            showNearbyEmergencyHospitals(for: action)
        case .critical:
            showCriticalEmergencyMenu(sourceView: sender)
        case .fall:
            DashboardSyncService.shared.checkReceiverConnection(reason: "fall") { [weak self] _, message in
                self?.presentStatus("낙상 알림", message: "낙상 의심 알림을 웹 대시보드로 전송했습니다.\n\(message)")
            }
        case .sos:
            showSOS()
        }
    }

    private func showCriticalEmergencyMenu(sourceView: UIView) {
        let menu = UIAlertController(
            title: "긴급 대응",
            message: "필요한 긴급 조치를 선택하세요.",
            preferredStyle: .actionSheet
        )
        menu.addAction(UIAlertAction(title: "긴급 대응 병원", style: .default) { [weak self] _ in
            self?.showNearbyEmergencyHospitals(for: .critical)
        })
        menu.addAction(UIAlertAction(title: "AED Alert", style: .destructive) { [weak self] _ in
            self?.triggerAedAlert()
        })
        menu.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = menu.popoverPresentationController {
            popover.sourceView = sourceView
            popover.sourceRect = sourceView.bounds
        }
        present(menu, animated: true)
    }

    private func showNearbyEmergencyHospitals(for action: EmergencyActionKind) {
        requestLocationPermissionForWatermark()
        let currentLocation = watermarkLocationManager.location ?? lastKnownWatermarkLocation
        let center = currentLocation?.coordinate ?? CLLocationCoordinate2D(latitude: 35.1847, longitude: 126.9057)
        let query: String
        switch action {
        case .minor:
            query = "응급실 병원"
        case .serious:
            query = "대학병원 응급실"
        case .critical:
            query = "중증외상센터 권역응급의료센터"
        case .fall, .sos:
            query = "응급실"
        }

        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = MKCoordinateRegion(center: center, latitudinalMeters: 35_000, longitudinalMeters: 35_000)
        MKLocalSearch(request: request).start { [weak self] response, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                let items = response?.mapItems ?? []
                let rows = self.formattedHospitalRows(from: items, currentLocation: currentLocation)
                let message: String
                if rows.isEmpty {
                    message = self.fallbackHospitalRows(for: action).joined(separator: "\n")
                } else {
                    message = rows.prefix(6).joined(separator: "\n")
                }
                self.presentStatus("\(action.title) 대응 병원", message: "현재 위치 기준 가까운 병원 후보입니다.\n\n\(message)")
            }
        }
    }

    private func formattedHospitalRows(from items: [MKMapItem], currentLocation: CLLocation?) -> [String] {
        items.compactMap { item in
            guard let name = item.name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            let distanceText: String
            if let currentLocation {
                let distance = currentLocation.distance(from: item.placemark.location ?? currentLocation)
                distanceText = String(format: "%.1fkm", distance / 1000)
            } else {
                distanceText = "거리 확인 대기"
            }
            let address = [item.placemark.locality, item.placemark.thoroughfare]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            return "• \(name) · \(distanceText)\(address.isEmpty ? "" : " · \(address)")"
        }
    }

    private func fallbackHospitalRows(for action: EmergencyActionKind) -> [String] {
        switch action {
        case .minor:
            return [
                "• 광주 북구 인근 응급실 · 위치 권한 확인 필요",
                "• 가까운 종합병원 · 지도 검색 재시도 권장",
                "• 현장 보건관리자 연락 · 경상 응급처치 우선"
            ]
        case .serious:
            return [
                "• 전남대학교병원 응급의료센터 · 광주 동구",
                "• 조선대학교병원 응급의료센터 · 광주 동구",
                "• 광주기독병원 응급실 · 광주 남구"
            ]
        case .critical:
            return [
                "• 전남대학교병원 권역응급의료센터 · 중증외상 우선",
                "• 조선대학교병원 응급의료센터 · 대학병원",
                "• 119 구급대 요청 · 위치 공유/SOS 병행 권장"
            ]
        case .fall, .sos:
            return [
                "• 119 구급대 요청",
                "• 전남대학교병원 응급의료센터",
                "• 조선대학교병원 응급의료센터"
            ]
        }
    }

    @objc private func showSOS() {
        DashboardSyncService.shared.checkReceiverConnection(reason: "sos") { [weak self] _, message in
            self?.presentStatus("SOS", message: "SOS 요청을 웹 대시보드로 전송했습니다.\n\(message)")
        }
    }

    private func triggerAedAlert() {
        let aedId = "AED-08"
        DashboardSyncService.shared.triggerAedAlert(aedId: aedId) { [weak self] ok, message in
            DispatchQueue.main.async {
                guard let self else { return }
                self.recordLocalAlert(
                    title: ok ? "AED Alert 전송" : "AED Alert 실패",
                    message: "\(aedId) 알림 요청\n\(message)"
                )
                self.presentStatus(ok ? "AED Alert" : "AED Alert 실패", message: message)
            }
        }
    }

    @objc private func startDashboardCollection() {
        let configuredEndpoint = DashboardSyncService.shared.normalizedEndpoint(from: UserDefaults.standard.string(forKey: PreviewSettingsKey.endpoint))
        UserDefaults.standard.set(configuredEndpoint, forKey: PreviewSettingsKey.endpoint)
        UserDefaults.standard.set(true, forKey: PreviewSettingsKey.autoCollection)
        requestLocationPermissionForWatermark()
        startDashboardAutoSyncIfNeeded(force: true)
        DashboardSyncService.shared.checkReceiverConnection(reason: "manual_connection_check") { [weak self] ok, message in
            self?.buildInterface()
            self?.presentStatus(ok ? "대시보드 연동" : "대시보드 연동 실패", message: message)
        }
    }

    @objc private func showFallDemo() {
        presentStatus("낙상 시연", message: "iPhone 미리보기에서는 낙상 샘플을 저장하지 않습니다. 실제 낙상 저장은 Apple Watch 감지 데이터로 전송됩니다.")
    }

    @objc private func showCall() {
        DashboardSyncService.shared.checkReceiverConnection(reason: "manager_call") { [weak self] _, message in
            self?.presentStatus("관리자 호출", message: "현재 위치와 Watch 데이터를 포함해 관리자 호출을 전송했습니다.\n\(message)")
        }
    }

    @objc private func showShare() {
        requestLocationPermissionForWatermark()
        DashboardSyncService.shared.checkReceiverConnection(reason: "location_share") { [weak self] _, message in
            self?.presentStatus("위치 공유", message: "작업자 위치와 근처 CCTV 링크를 웹 대시보드와 동기화했습니다.\n\(message)")
        }
    }

    @objc private func showAppleHealthWalletInfo() {
        presentStatus(
            "Apple Health / Wallet",
            message: "HealthKit 실측 데이터는 Watch 연동으로 사용합니다. Apple의 Add to Apple Wallet and Health 공식 배지는 SMART Health Cards 또는 EU Digital COVID Certificate 같은 검증 가능한 건강 기록 기능에만 노출합니다."
        )
    }

    private func applyDashboardAdminAuthorization(to request: inout URLRequest) -> Bool {
        let id = UserDefaults.standard.string(forKey: PreviewSettingsKey.dashboardAdminId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let password = DashboardCredentialStore.loadPassword()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !id.isEmpty, !password.isEmpty, let data = "\(id):\(password)".data(using: .utf8) else {
            return false
        }
        request.setValue("Basic \(data.base64EncodedString())", forHTTPHeaderField: "Authorization")
        return true
    }

    private func storedLocalAlerts() -> [[String: String]] {
        guard let data = UserDefaults.standard.data(forKey: PreviewSettingsKey.localAlerts),
              let items = try? JSONSerialization.jsonObject(with: data) as? [[String: String]]
        else { return [] }
        return items
    }

    private func saveLocalAlerts(_ items: [[String: String]]) {
        let trimmed = Array(items.prefix(20))
        if let data = try? JSONSerialization.data(withJSONObject: trimmed) {
            UserDefaults.standard.set(data, forKey: PreviewSettingsKey.localAlerts)
        }
        UIApplication.shared.applicationIconBadgeNumber = unreadLocalAlertsCount(in: trimmed)
    }

    private func clearLocalAlerts() {
        UserDefaults.standard.removeObject(forKey: PreviewSettingsKey.localAlerts)
        UIApplication.shared.applicationIconBadgeNumber = 0
    }

    private func markLocalAlertsRead(_ items: [[String: String]]) {
        saveLocalAlerts(items)
        UIApplication.shared.applicationIconBadgeNumber = 0
    }

    private func unreadLocalAlertsCount() -> Int {
        unreadLocalAlertsCount(in: storedLocalAlerts())
    }

    private func unreadLocalAlertsCount(in items: [[String: String]]) -> Int {
        items.filter { $0["read"] != "true" }.count
    }

    private func recordLocalAlert(
        title: String,
        message: String,
        categoryIdentifier: String? = nil,
        userInfo: [String: Any] = [:]
    ) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        var items = storedLocalAlerts()
        items.insert(["title": title, "message": message, "time": formatter.string(from: Date()), "read": "false"], at: 0)
        saveLocalAlerts(items)

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = message
        content.sound = .default
        content.badge = NSNumber(value: min(unreadLocalAlertsCount(in: items), 99))
        if let categoryIdentifier {
            content.categoryIdentifier = categoryIdentifier
        }
        content.userInfo = userInfo
        let request = UNNotificationRequest(identifier: "vitalguard.local.\(UUID().uuidString)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
        buildInterface()
    }

    @objc private func showDashboardAlerts() {
        let center = AlertCenterViewController(alerts: storedLocalAlerts(), interfaceStyle: savedThemeMode.interfaceStyle)
        center.onClear = { [weak self] in
            self?.clearLocalAlerts()
            self?.buildInterface()
        }
        center.onMarkAllRead = { [weak self] items in
            self?.markLocalAlertsRead(items)
            self?.buildInterface()
        }
        let nav = UINavigationController(rootViewController: center)
        nav.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    @objc private func openDashboardCalendar() {
        guard loggedInID != nil else {
            presentStatus("관제 캘린더", message: "로그인 후 앱 내부 캘린더에서 사진/비디오/문서 스캔 기록을 확인할 수 있습니다.")
            return
        }
        guard #available(iOS 16.0, *) else {
            presentStatus("관제 캘린더", message: "앱 내부 캘린더는 iOS 16 이상에서 사용할 수 있습니다.")
            return
        }
        let calendarURL = URL(string: "\(VitalGuardLinks.safetyMonitor)/api/calendar/media")
        let calendar = AppMediaCalendarViewController(syncURL: calendarURL, authToken: appMediaAuthorizationToken())
        calendar.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        calendar.onCommentSubmit = { [weak self] entry, completion in
            self?.uploadCalendarComment(entry, completion: completion)
        }
        calendar.onCommentUpdate = { [weak self] entry, completion in
            self?.updateCalendarComment(entry, completion: completion)
        }
        calendar.onCommentDelete = { [weak self] record, completion in
            self?.deleteCalendarComment(record, completion: completion)
        }
        calendar.onAttachmentRequest = { [weak self] source, composer in
            self?.startCalendarCommentAttachment(source, composer: composer)
        }
        let nav = UINavigationController(rootViewController: calendar)
        nav.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    private func parseDashboardAlerts(from data: Data?) -> [DashboardAlertItem] {
        guard let data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawAlerts = json["alerts"] as? [[String: Any]] else {
            return []
        }
        return rawAlerts.map { raw in
            let type = raw["type"] as? String ?? "alert"
            let workerName = raw["worker_name"] as? String
            let workerId = raw["worker_id"] as? String
            let worker = [workerName, workerId]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .first { !$0.isEmpty }
                ?? "작업자 미상"
            let timestamp = raw["ts"] as? String ?? raw["created_at"] as? String ?? "시간 미상"
            let acknowledged = raw["ack_at"] is String
            return DashboardAlertItem(type: type, worker: worker, timestamp: timestamp, acknowledged: acknowledged)
        }
    }

    private func dashboardAlertTitle(for type: String) -> String {
        switch type {
        case "sos": return "SOS 긴급 알림"
        case "fall": return "낙상 알림"
        case "vital": return "생체 위험 알림"
        default: return "관제 알림"
        }
    }

    @objc private func openWalletIdentityEditor() {
        let editor = WalletIdentityViewController(appMode: currentMode)
        editor.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        let nav = UINavigationController(rootViewController: editor)
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
        }
        present(nav, animated: true)
    }

    private func presentIntroGuideIfNeeded() {
        guard !didAttemptIntroGuidePresentation else { return }
        didAttemptIntroGuidePresentation = true
        guard presentedViewController == nil else { return }
        let mode = IntroGuideMode.saved
        switch mode {
        case .alwaysOn:
            break
        case .sessionOff:
            guard !Self.didShowIntroGuideThisLaunch && !Self.isIntroGuideMutedForThisLaunch else { return }
        case .alwaysOff:
            return
        }
        Self.didShowIntroGuideThisLaunch = true
        presentStatus(
            "VitAlGuard 초기 사용방법",
            message: "좌측 상단의 VitAlGuard 로고를 클릭하면 카메라 기능과 NFC 스캔 등의 메뉴가 뜹니다."
        )
    }

    @objc private func handleIntroGuideModeChanged() {
        let mode = IntroGuideMode.saved
        Self.isIntroGuideMutedForThisLaunch = mode == .sessionOff
        if mode == .alwaysOn {
            didAttemptIntroGuidePresentation = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                self?.presentIntroGuideIfNeeded()
            }
        }
    }

    private func presentStatus(_ title: String, message: String) {
        VitAlGuardRuntimeTranslator.shared.localizedAlert(title: title, message: message) { [weak self] localizedTitle, localizedMessage in
            guard self?.presentedViewController == nil else { return }
            let alert = UIAlertController(title: localizedTitle, message: localizedMessage, preferredStyle: .alert)
            VitAlGuardRuntimeTranslator.shared.translate("확인") { localizedOK in
                alert.addAction(UIAlertAction(title: localizedOK, style: .default))
                self?.present(alert, animated: true)
            }
        }
    }

    private func startDashboardAutoSyncIfNeeded(force: Bool = false) {
        guard loggedInID != nil, isDashboardAutoCollectionEnabled else {
            stopDashboardAutoSync()
            return
        }
        let interval = UserDefaults.standard.object(forKey: PreviewSettingsKey.syncInterval) as? Double ?? 300
        let clampedInterval: TimeInterval
        if UIApplication.shared.applicationState == .active {
            switch SensorPowerMode.saved {
            case .extreme: clampedInterval = max(5, min(10, interval))
            case .balanced: clampedInterval = max(60, min(300, interval))
            case .lowPower: clampedInterval = max(300, min(900, interval))
            }
        } else {
            clampedInterval = max(300, min(900, interval))
        }
        if force {
            requestLocationPermissionForWatermark()
            DashboardSyncService.shared.enqueueContinuousUpdate(reason: "iphone_foreground_continuous_update")
        }
        if dashboardSyncTimer != nil, dashboardSyncTimerInterval == clampedInterval {
            return
        }
        dashboardSyncTimer?.invalidate()
        let timer = Timer(timeInterval: clampedInterval, repeats: true) { [weak self] _ in
            guard let self, self.loggedInID != nil, self.isDashboardAutoCollectionEnabled else {
                self?.stopDashboardAutoSync()
                return
            }
            if UIApplication.shared.applicationState == .active {
                self.requestLocationPermissionForWatermark()
            }
            DashboardSyncService.shared.enqueueContinuousUpdate(reason: UIApplication.shared.applicationState == .active
                ? "iphone_foreground_continuous_update"
                : "iphone_background_continuous_update")
        }
        timer.tolerance = min(2, clampedInterval / 5)
        RunLoop.main.add(timer, forMode: .common)
        dashboardSyncTimer = timer
        dashboardSyncTimerInterval = clampedInterval
    }

    private func stopDashboardAutoSync() {
        dashboardSyncTimer?.invalidate()
        dashboardSyncTimer = nil
        dashboardSyncTimerInterval = nil
        stopDashboardConnectionMonitor()
    }

    private func startDashboardConnectionMonitorIfNeeded() {
        guard loggedInID != nil else {
            stopDashboardConnectionMonitor()
            return
        }
        if dashboardConnectionTimer == nil {
            let timer = Timer(timeInterval: 30, repeats: true) { [weak self] _ in
                self?.checkDashboardConnection()
            }
            timer.tolerance = 8
            RunLoop.main.add(timer, forMode: .common)
            dashboardConnectionTimer = timer
        }
        checkDashboardConnection()
    }

    private func stopDashboardConnectionMonitor() {
        dashboardConnectionTimer?.invalidate()
        dashboardConnectionTimer = nil
        isDashboardConnectionCheckInFlight = false
    }

    @objc private func presentDashboardConnectionDetail() {
        let checkedText: String
        if let dashboardConnectionLastCheckedAt {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "ko_KR")
            formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
            checkedText = formatter.string(from: dashboardConnectionLastCheckedAt)
        } else {
            checkedText = "아직 확인 전"
        }
        let codeText = dashboardConnectionLastStatusCode.map { "\($0)" } ?? "--"
        let latencyText = dashboardConnectionLastLatency.map { String(format: "%.2fs", $0) } ?? "--"
        let message = [
            "상태: \(dashboardConnectionState.title)",
            "대상: \(VitalGuardLinks.safetyMonitor)",
            "마지막 확인: \(checkedText)",
            "HTTP 코드: \(codeText)",
            "응답 지연: \(latencyText)",
            dashboardConnectionLastError.map { "오류: \($0)" }
        ]
            .compactMap { $0 }
            .joined(separator: "\n")
        let alert = UIAlertController(title: "관제웹 연결 상태", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "지금 다시 확인", style: .default, handler: { [weak self] _ in
            self?.checkDashboardConnection(force: true)
        }))
        alert.addAction(UIAlertAction(title: "관제 웹 열기", style: .default, handler: { _ in
            if let url = URL(string: VitalGuardLinks.safetyMonitor) {
                UIApplication.shared.open(url)
            }
        }))
        alert.addAction(UIAlertAction(title: "확인", style: .cancel))
        present(alert, animated: true)
    }

    private func checkDashboardConnection(force: Bool = false) {
        guard loggedInID != nil, force || !isDashboardConnectionCheckInFlight else { return }
        guard let url = URL(string: VitalGuardLinks.safetyMonitor) else {
            dashboardConnectionLastCheckedAt = Date()
            dashboardConnectionLastStatusCode = nil
            dashboardConnectionLastLatency = nil
            dashboardConnectionLastError = "관제 웹 URL이 올바르지 않습니다."
            applyDashboardConnectionState(.offline)
            return
        }
        isDashboardConnectionCheckInFlight = true
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 5
        let startedAt = Date()
        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            guard let self else { return }
            let elapsed = Date().timeIntervalSince(startedAt)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let nextState: DashboardConnectionState
            if error != nil || code == 0 || code >= 500 {
                nextState = .offline
            } else if elapsed > 2.5 || code >= 400 {
                nextState = .delayed
            } else {
                nextState = .connected
            }
            DispatchQueue.main.async {
                self.isDashboardConnectionCheckInFlight = false
                self.dashboardConnectionLastCheckedAt = Date()
                self.dashboardConnectionLastStatusCode = code == 0 ? nil : code
                self.dashboardConnectionLastLatency = elapsed
                self.dashboardConnectionLastError = error?.localizedDescription
                self.applyDashboardConnectionState(nextState)
            }
        }.resume()
    }

    private func applyDashboardConnectionState(_ state: DashboardConnectionState) {
        guard dashboardConnectionState != state else { return }
        dashboardConnectionState = state
        if loggedInID != nil, activeMainTab == .home {
            rebuildInterfacePreservingScrollPosition()
        }
    }

    func prepareContinuousBackgroundSync() {
        guard loggedInID != nil, isDashboardAutoCollectionEnabled else { return }
        requestLocationPermissionForWatermark()
        DashboardSyncService.shared.enqueueContinuousUpdate(reason: "iphone_background_enter")
        stopDashboardAutoSync()
    }

    func resumeContinuousDashboardSync() {
        guard loggedInID != nil else { return }
        startDashboardAutoSyncIfNeeded(force: true)
    }

    private func refreshLiveActivity(loginId: String? = nil, mode: AppMode? = nil) {
        guard #available(iOS 16.2, *) else { return }
        guard isLiveActivityEnabled else {
            VitAlGuardLiveActivityManager.shared.end()
            return
        }
        VitAlGuardLiveActivityManager.shared.refresh(
            loginId: loginId ?? loggedInID ?? "",
            mode: mode ?? currentMode
        )
    }

    private func logoImageView() -> UIView {
        logoBox(size: 46, cornerRadius: 16, bleed: 0)
    }

    private func logoImageButton() -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.backgroundColor = .clear
        button.isUserInteractionEnabled = true
        button.contentHorizontalAlignment = .fill
        button.contentVerticalAlignment = .fill

        let logo = logoImageView()
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.isUserInteractionEnabled = false
        button.addSubview(logo)

        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 46),
            button.heightAnchor.constraint(equalToConstant: 46),
            logo.topAnchor.constraint(equalTo: button.topAnchor),
            logo.leadingAnchor.constraint(equalTo: button.leadingAnchor),
            logo.trailingAnchor.constraint(equalTo: button.trailingAnchor),
            logo.bottomAnchor.constraint(equalTo: button.bottomAnchor)
        ])
        return button
    }

    private func logoBox(size: CGFloat, cornerRadius: CGFloat, bleed: CGFloat) -> UIView {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        // 앱 아이콘 PNG의 투명 모서리 뒤에 사각형 매트가 보이지 않게 한다.
        container.backgroundColor = .clear
        container.layer.cornerRadius = cornerRadius
        container.layer.cornerCurve = .continuous
        container.clipsToBounds = true

        let appIconName = isDark ? "vitalguard-app-icon-dark" : "vitalguard-app-icon-light"
        let fallbackName = isDark ? "vitalguard-logo-dark" : "vitalguard-logo-light"
        let path = Bundle.main.path(forResource: appIconName, ofType: "png")
            ?? Bundle.main.path(forResource: fallbackName, ofType: "png")
        let image = UIImage(named: appIconName)
            ?? UIImage(named: fallbackName)
            ?? path.flatMap { UIImage(contentsOfFile: $0) }
        let imageView = UIImageView(image: image)
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFill
        imageView.layer.cornerRadius = cornerRadius
        imageView.layer.cornerCurve = .continuous
        imageView.clipsToBounds = true
        container.addSubview(imageView)

        let inset = max(0, bleed)
        NSLayoutConstraint.activate([
            container.widthAnchor.constraint(equalToConstant: size),
            container.heightAnchor.constraint(equalToConstant: size),
            imageView.topAnchor.constraint(equalTo: container.topAnchor, constant: inset),
            imageView.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: inset),
            imageView.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -inset),
            imageView.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -inset)
        ])
        return container
    }

    private func pill(_ text: String, foreground: UIColor, background: UIColor, width: CGFloat) -> UILabel {
        let capsule = label(text, size: 12, weight: .black, color: foreground)
        capsule.textAlignment = .center
        capsule.backgroundColor = background
        capsule.layer.cornerRadius = 18
        capsule.layer.cornerCurve = .continuous
        capsule.layer.borderColor = hairline.cgColor
        capsule.layer.borderWidth = 1
        capsule.layer.shadowColor = UIColor.black.cgColor
        capsule.layer.shadowOpacity = isDark ? 0.14 : 0.06
        capsule.layer.shadowRadius = 8
        capsule.layer.shadowOffset = CGSize(width: 0, height: 3)
        capsule.clipsToBounds = true
        NSLayoutConstraint.activate([
            capsule.widthAnchor.constraint(equalToConstant: width),
            capsule.heightAnchor.constraint(equalToConstant: 36)
        ])
        return capsule
    }

    private func buttonPill(_ text: String, foreground: UIColor, background: UIColor, width: CGFloat) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle(text, for: .normal)
        button.setTitleColor(foreground, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .black)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.adjustsFontSizeToFitWidth = true
        button.titleLabel?.minimumScaleFactor = 0.78
        button.titleLabel?.lineBreakMode = .byTruncatingTail
        applyGlass(to: button, cornerRadius: 22, fill: background.withAlphaComponent(isDark ? 0.24 : 0.64), borderColor: glassStroke)
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: width),
            button.heightAnchor.constraint(equalToConstant: 44)
        ])
        return button
    }

    private func iconPill(symbol: String, foreground: UIColor, background: UIColor, width: CGFloat) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        let image = UIImage(systemName: symbol)
        button.setImage(image, for: .normal)
        button.tintColor = foreground
        button.backgroundColor = .clear
        button.imageView?.contentMode = .scaleAspectFit
        AppleDesignGlass.apply(to: button, cornerRadius: 22, tint: background, isInteractive: true)
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: width),
            button.heightAnchor.constraint(equalToConstant: 44)
        ])
        return button
    }

    private func buttonPillForActionRow(_ text: String, foreground: UIColor, background: UIColor, compact: Bool = false) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle(text, for: .normal)
        button.setTitleColor(foreground, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: compact ? 12 : 16, weight: .black)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.adjustsFontSizeToFitWidth = true
        button.titleLabel?.minimumScaleFactor = compact ? 0.70 : 0.80
        button.titleLabel?.lineBreakMode = .byTruncatingTail
        button.titleLabel?.textAlignment = .center
        AppleDesignGlass.apply(to: button, cornerRadius: 22, tint: background, isInteractive: true)
        NSLayoutConstraint.activate([
            button.heightAnchor.constraint(equalToConstant: compact ? 38 : 44)
        ])
        return button
    }
}

final class HomeLayoutViewController: UITableViewController {
    var onSave: (() -> Void)?

    private let mode: AppMode
    private var sections: [HomeSection]
    private let ink = UIColor(red: 0.067, green: 0.067, blue: 0.067, alpha: 1.0)

    init(mode: AppMode) {
        self.mode = mode
        self.sections = HomeSection.savedOrder(for: mode)
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) {
        self.mode = .admin
        self.sections = HomeSection.savedOrder(for: .admin)
        super.init(coder: coder)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "홈 화면 배치"
        tableView.backgroundColor = traitCollection.userInterfaceStyle == .dark ? ink : .systemBackground
        tableView.dragInteractionEnabled = true
        tableView.isEditing = true
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "저장", style: .prominent, target: self, action: #selector(saveLayout))
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "기본값", style: .plain, target: self, action: #selector(resetLayout))
    }

    override func numberOfSections(in tableView: UITableView) -> Int {
        1
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        sections.count
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        mode == .admin ? "관리자 홈 섹션 순서" : "근로자 홈 섹션 순서"
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let section = sections[indexPath.row]
        cell.textLabel?.text = section.title
        cell.textLabel?.font = UIFont.systemFont(ofSize: 17, weight: .black)
        cell.detailTextLabel?.text = "오른쪽 손잡이를 끌어서 원하는 위치로 이동"
        cell.detailTextLabel?.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        cell.showsReorderControl = true
        cell.backgroundColor = traitCollection.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.08)
            : .secondarySystemGroupedBackground
        return cell
    }

    override func tableView(_ tableView: UITableView, canMoveRowAt indexPath: IndexPath) -> Bool {
        true
    }

    override func tableView(_ tableView: UITableView, moveRowAt sourceIndexPath: IndexPath, to destinationIndexPath: IndexPath) {
        let moved = sections.remove(at: sourceIndexPath.row)
        sections.insert(moved, at: destinationIndexPath.row)
    }

    @objc private func saveLayout() {
        HomeSection.save(sections, for: mode)
        onSave?()
        navigationController?.popViewController(animated: true)
    }

    @objc private func resetLayout() {
        sections = HomeSection.defaults(for: mode)
        tableView.reloadData()
    }
}

private struct WalletIdentityPayload {
    var role: AppMode
    var name: String
    var employeeId: String
    var phone: String
    var department: String
    var rank: String
    var jobTitle: String
    var workZone: String
    var siteName: String
    var hireDate: String
    var expiryDate: String

    static func load(role: AppMode) -> WalletIdentityPayload {
        let defaults = UserDefaults.standard
        return WalletIdentityPayload(
            role: role,
            name: defaults.string(forKey: PreviewSettingsKey.walletPersonName)
                ?? defaults.string(forKey: PreviewSettingsKey.workerName)
                ?? "",
            employeeId: defaults.string(forKey: PreviewSettingsKey.walletEmployeeId)
                ?? defaults.string(forKey: PreviewSettingsKey.employeeId)
                ?? "",
            phone: defaults.string(forKey: PreviewSettingsKey.walletPhone) ?? "",
            department: defaults.string(forKey: PreviewSettingsKey.walletDepartment) ?? "",
            rank: defaults.string(forKey: PreviewSettingsKey.walletRank) ?? "",
            jobTitle: defaults.string(forKey: PreviewSettingsKey.walletJobTitle) ?? "",
            workZone: defaults.string(forKey: PreviewSettingsKey.walletWorkZone) ?? "",
            siteName: defaults.string(forKey: PreviewSettingsKey.walletSiteName) ?? "광주 북구 현장 A",
            hireDate: defaults.string(forKey: PreviewSettingsKey.walletHireDate) ?? "2026-06-30",
            expiryDate: defaults.string(forKey: PreviewSettingsKey.walletExpiryDate) ?? "2027-06-30"
        )
    }

    func save() {
        let defaults = UserDefaults.standard
        defaults.set(name, forKey: PreviewSettingsKey.walletPersonName)
        defaults.set(employeeId, forKey: PreviewSettingsKey.walletEmployeeId)
        defaults.set(phone, forKey: PreviewSettingsKey.walletPhone)
        defaults.set(department, forKey: PreviewSettingsKey.walletDepartment)
        defaults.set(rank, forKey: PreviewSettingsKey.walletRank)
        defaults.set(jobTitle, forKey: PreviewSettingsKey.walletJobTitle)
        defaults.set(workZone, forKey: PreviewSettingsKey.walletWorkZone)
        defaults.set(siteName, forKey: PreviewSettingsKey.walletSiteName)
        defaults.set(hireDate, forKey: PreviewSettingsKey.walletHireDate)
        defaults.set(expiryDate, forKey: PreviewSettingsKey.walletExpiryDate)
    }

    var dictionary: [String: String] {
        [
            "app": "VitAlGuard",
            "role": role == .admin ? "admin" : "worker",
            "name": name,
            "employeeId": employeeId,
            "phone": phone,
            "department": department,
            "rank": rank,
            "jobTitle": jobTitle,
            "workZone": workZone,
            "siteName": siteName,
            "hireDate": hireDate,
            "expiryDate": expiryDate,
            "barcodeValue": barcodeString,
            "canteenPaymentId": barcodeString,
            "barcodePurpose": "site-terminal-cafeteria-payment",
            "qrPurpose": "id-verification-attendance",
            "verificationToken": verificationToken,
            "qrVerificationURL": verificationURL
        ]
    }

    var encodedString: String {
        verificationURL
    }

    var barcodeString: String {
        let trimmedEmployeeId = employeeId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedEmployeeId.isEmpty {
            return trimmedEmployeeId
        }
        return role == .admin ? "admin7276" : "worker7276"
    }

    var hasEmployeeIdentity: Bool {
        [name, employeeId, phone, department, rank, jobTitle, workZone, siteName, hireDate, expiryDate].contains {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private var verificationURL: String {
        var components = URLComponents(string: Self.verificationBaseURL())
        components?.path = "/id/verify"
        components?.queryItems = [
            URLQueryItem(name: "token", value: verificationToken),
            URLQueryItem(name: "mode", value: "attendance")
        ]
        return components?.url?.absoluteString ?? "\(Self.verificationBaseURL())/id/verify?token=\(verificationToken)&mode=attendance"
    }

    private var verificationToken: String {
        var tokenPayload = dictionaryForToken
        tokenPayload["type"] = "vitalguard.id.verify"
        tokenPayload["version"] = "1"
        let data = (try? JSONSerialization.data(withJSONObject: tokenPayload, options: [.sortedKeys])) ?? Data()
        return Self.base64URLEncoded(data)
    }

    private var dictionaryForToken: [String: String] {
        [
            "app": "VitAlGuard",
            "role": role == .admin ? "admin" : "worker",
            "name": name,
            "employeeId": employeeId,
            "phone": phone,
            "department": department,
            "rank": rank,
            "jobTitle": jobTitle,
            "workZone": workZone,
            "siteName": siteName,
            "hireDate": hireDate,
            "expiryDate": expiryDate,
            "barcodeValue": barcodeString,
            "canteenPaymentId": barcodeString,
            "barcodePurpose": "site-terminal-cafeteria-payment",
            "qrPurpose": "id-verification-attendance"
        ]
    }

    private static func verificationBaseURL() -> String {
        let configured = DashboardSyncService.shared.normalizedEndpoint(
            from: UserDefaults.standard.string(forKey: PreviewSettingsKey.endpoint)
        )
        let fallback = DashboardSyncService.shared.normalizedEndpoint(from: VitalGuardLinks.safetyMonitor)
        let selected = configured.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? fallback : configured
        return selected.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private static func base64URLEncoded(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private final class StandardPassPreviewView: UIView {
    private let compact: Bool
    private let titleLabel = UILabel()
    private let roleLabel = UILabel()
    private let nameLabel = UILabel()
    private let employeeLabel = UILabel()
    private let departmentLabel = UILabel()
    private let jobLabel = UILabel()
    private let zoneLabel = UILabel()
    private let qrContainer = UIView()
    private let qrImageView = UIImageView()
    private let barcodeContainer = UIView()
    private let barcodeImageView = UIImageView()
    private let hireDateLabel = UILabel()
    private let gradient = CAGradientLayer()

    init(compact: Bool = false) {
        self.compact = compact
        super.init(frame: .zero)
        build()
    }

    override init(frame: CGRect) {
        self.compact = false
        super.init(frame: frame)
        build()
    }

    required init?(coder: NSCoder) {
        self.compact = false
        super.init(coder: coder)
        build()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradient.frame = bounds
    }

    func update(payload: WalletIdentityPayload, qrImage: UIImage?, barcodeImage: UIImage? = nil) {
        titleLabel.text = "Standard"
        roleLabel.text = payload.role == .admin ? "ADMIN ID" : "WORKER ID"
        nameLabel.text = payload.name.isEmpty ? "이름 입력" : payload.name
        employeeLabel.text = payload.employeeId.isEmpty ? "사원번호 대기" : payload.employeeId
        departmentLabel.text = payload.department.isEmpty ? "부서 미입력" : payload.department
        let title = [payload.rank, payload.jobTitle]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " / ")
        jobLabel.text = title.isEmpty ? "직급/직책 미입력" : title
        zoneLabel.text = payload.workZone.isEmpty ? "작업 구역 미입력" : payload.workZone
        hireDateLabel.text = "입사일 2026.06.30"
        qrImageView.image = qrImage
        barcodeImageView.image = barcodeImage
        qrContainer.isHidden = qrImage == nil
        barcodeContainer.isHidden = barcodeImage == nil
    }

    private func build() {
        translatesAutoresizingMaskIntoConstraints = false
        layer.cornerRadius = 24
        layer.cornerCurve = .continuous
        layer.masksToBounds = true
        gradient.colors = [
            UIColor(red: 0.72, green: 0.18, blue: 0.02, alpha: 1).cgColor,
            UIColor(red: 0.98, green: 0.50, blue: 0.02, alpha: 1).cgColor,
            UIColor(red: 1.00, green: 0.70, blue: 0.12, alpha: 1).cgColor
        ]
        gradient.startPoint = CGPoint(x: 0, y: 0)
        gradient.endPoint = CGPoint(x: 1, y: 1)
        layer.insertSublayer(gradient, at: 0)

        let ring = UIView()
        ring.translatesAutoresizingMaskIntoConstraints = false
        ring.layer.borderWidth = 2
        ring.layer.borderColor = UIColor.white.withAlphaComponent(0.72).cgColor
        ring.layer.cornerRadius = 24
        ring.backgroundColor = UIColor.white.withAlphaComponent(0.12)

        let pencil = UIImageView(image: UIImage(systemName: "pencil"))
        pencil.translatesAutoresizingMaskIntoConstraints = false
        pencil.tintColor = .white
        pencil.contentMode = .scaleAspectFit
        ring.addSubview(pencil)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = UIFont.systemFont(ofSize: compact ? 19 : 30, weight: .black)
        titleLabel.textColor = .white
        titleLabel.layer.shadowColor = UIColor.black.cgColor
        titleLabel.layer.shadowOpacity = 0.22
        titleLabel.layer.shadowRadius = 5

        roleLabel.translatesAutoresizingMaskIntoConstraints = false
        roleLabel.font = UIFont.monospacedSystemFont(ofSize: compact ? 7 : 13, weight: .bold)
        roleLabel.textColor = UIColor.white.withAlphaComponent(0.82)
        roleLabel.textAlignment = .right

        hireDateLabel.translatesAutoresizingMaskIntoConstraints = false
        hireDateLabel.font = UIFont.monospacedSystemFont(ofSize: compact ? 7 : 12, weight: .bold)
        hireDateLabel.textColor = UIColor.white.withAlphaComponent(0.86)
        hireDateLabel.textAlignment = .left
        hireDateLabel.adjustsFontSizeToFitWidth = true
        hireDateLabel.minimumScaleFactor = 0.7

        let firstRow = infoPill(caption: "CUSTOM LABEL", valueLabel: nameLabel)
        let secondRow = infoPill(caption: "CUSTOM NUMBER", valueLabel: employeeLabel)
        let departmentRow = infoPill(caption: "DEPARTMENT", valueLabel: departmentLabel)
        let jobRow = infoPill(caption: "POSITION", valueLabel: jobLabel)
        let zoneRow = infoPill(caption: "WORK ZONE", valueLabel: zoneLabel)

        configureScanPlate(qrContainer, imageView: qrImageView, cornerRadius: compact ? 7 : 10)
        configureScanPlate(barcodeContainer, imageView: barcodeImageView, cornerRadius: compact ? 9 : 12)

        [ring, titleLabel, roleLabel, firstRow, secondRow, departmentRow, jobRow, zoneRow, qrContainer, hireDateLabel, barcodeContainer].forEach(addSubview)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: compact ? 360 : 640),
            ring.leadingAnchor.constraint(equalTo: leadingAnchor, constant: compact ? 13 : 22),
            ring.topAnchor.constraint(equalTo: topAnchor, constant: compact ? 13 : 22),
            ring.widthAnchor.constraint(equalToConstant: compact ? 28 : 48),
            ring.heightAnchor.constraint(equalTo: ring.widthAnchor),
            pencil.centerXAnchor.constraint(equalTo: ring.centerXAnchor),
            pencil.centerYAnchor.constraint(equalTo: ring.centerYAnchor),
            pencil.widthAnchor.constraint(equalToConstant: compact ? 15 : 25),
            pencil.heightAnchor.constraint(equalTo: pencil.widthAnchor),

            titleLabel.leadingAnchor.constraint(equalTo: ring.trailingAnchor, constant: compact ? 8 : 12),
            titleLabel.centerYAnchor.constraint(equalTo: ring.centerYAnchor),
            roleLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: compact ? -13 : -22),
            roleLabel.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            roleLabel.leadingAnchor.constraint(greaterThanOrEqualTo: titleLabel.trailingAnchor, constant: compact ? 6 : 12),

            firstRow.leadingAnchor.constraint(equalTo: leadingAnchor, constant: compact ? 13 : 20),
            firstRow.trailingAnchor.constraint(equalTo: trailingAnchor, constant: compact ? -13 : -20),
            firstRow.topAnchor.constraint(equalTo: ring.bottomAnchor, constant: compact ? 16 : 28),
            firstRow.heightAnchor.constraint(equalToConstant: compact ? 38 : 62),
            secondRow.leadingAnchor.constraint(equalTo: firstRow.leadingAnchor),
            secondRow.trailingAnchor.constraint(equalTo: firstRow.trailingAnchor),
            secondRow.topAnchor.constraint(equalTo: firstRow.bottomAnchor, constant: compact ? 7 : 10),
            secondRow.heightAnchor.constraint(equalTo: firstRow.heightAnchor),
            departmentRow.leadingAnchor.constraint(equalTo: firstRow.leadingAnchor),
            departmentRow.trailingAnchor.constraint(equalTo: centerXAnchor, constant: -5),
            departmentRow.topAnchor.constraint(equalTo: secondRow.bottomAnchor, constant: compact ? 7 : 10),
            departmentRow.heightAnchor.constraint(equalTo: firstRow.heightAnchor),
            jobRow.leadingAnchor.constraint(equalTo: centerXAnchor, constant: 5),
            jobRow.trailingAnchor.constraint(equalTo: firstRow.trailingAnchor),
            jobRow.topAnchor.constraint(equalTo: departmentRow.topAnchor),
            jobRow.heightAnchor.constraint(equalTo: departmentRow.heightAnchor),
            zoneRow.leadingAnchor.constraint(equalTo: firstRow.leadingAnchor),
            zoneRow.trailingAnchor.constraint(equalTo: firstRow.trailingAnchor),
            zoneRow.topAnchor.constraint(equalTo: departmentRow.bottomAnchor, constant: compact ? 7 : 10),
            zoneRow.heightAnchor.constraint(equalTo: firstRow.heightAnchor),

            qrContainer.leadingAnchor.constraint(equalTo: firstRow.leadingAnchor, constant: compact ? 7 : 10),
            qrContainer.topAnchor.constraint(greaterThanOrEqualTo: zoneRow.bottomAnchor, constant: compact ? 8 : 28),
            qrContainer.bottomAnchor.constraint(equalTo: bottomAnchor, constant: compact ? -12 : -28),
            qrContainer.widthAnchor.constraint(equalToConstant: compact ? 94 : 156),
            qrContainer.heightAnchor.constraint(equalTo: qrContainer.widthAnchor),
            qrImageView.topAnchor.constraint(equalTo: qrContainer.topAnchor, constant: compact ? 4 : 6),
            qrImageView.leadingAnchor.constraint(equalTo: qrContainer.leadingAnchor, constant: compact ? 4 : 6),
            qrImageView.trailingAnchor.constraint(equalTo: qrContainer.trailingAnchor, constant: compact ? -4 : -6),
            qrImageView.bottomAnchor.constraint(equalTo: qrContainer.bottomAnchor, constant: compact ? -4 : -6),

            barcodeContainer.leadingAnchor.constraint(equalTo: qrContainer.trailingAnchor, constant: compact ? 12 : 18),
            barcodeContainer.trailingAnchor.constraint(lessThanOrEqualTo: firstRow.trailingAnchor, constant: compact ? -7 : -10),
            barcodeContainer.centerYAnchor.constraint(equalTo: qrContainer.centerYAnchor, constant: compact ? 4 : 6),
            barcodeContainer.widthAnchor.constraint(equalToConstant: compact ? 112 : 176),
            barcodeContainer.heightAnchor.constraint(equalToConstant: compact ? 44 : 70),
            hireDateLabel.leadingAnchor.constraint(equalTo: barcodeContainer.leadingAnchor, constant: compact ? 2 : 4),
            hireDateLabel.trailingAnchor.constraint(equalTo: barcodeContainer.trailingAnchor),
            hireDateLabel.bottomAnchor.constraint(equalTo: barcodeContainer.topAnchor, constant: compact ? -7 : -10),
            barcodeImageView.topAnchor.constraint(equalTo: barcodeContainer.topAnchor, constant: compact ? 6 : 9),
            barcodeImageView.leadingAnchor.constraint(equalTo: barcodeContainer.leadingAnchor, constant: compact ? 6 : 9),
            barcodeImageView.trailingAnchor.constraint(equalTo: barcodeContainer.trailingAnchor, constant: compact ? -6 : -9),
            barcodeImageView.bottomAnchor.constraint(equalTo: barcodeContainer.bottomAnchor, constant: compact ? -6 : -9)
        ])
    }

    private func configureScanPlate(_ container: UIView, imageView: UIImageView, cornerRadius: CGFloat) {
        container.translatesAutoresizingMaskIntoConstraints = false
        container.backgroundColor = .white
        container.layer.cornerRadius = cornerRadius
        container.layer.cornerCurve = .continuous
        container.layer.shadowColor = UIColor.black.cgColor
        container.layer.shadowOpacity = 0.18
        container.layer.shadowRadius = compact ? 4 : 8
        container.layer.shadowOffset = CGSize(width: 0, height: compact ? 2 : 4)

        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = .clear
        imageView.clipsToBounds = false
        container.addSubview(imageView)
    }

    private func infoPill(caption: String, valueLabel: UILabel) -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        wrapper.backgroundColor = UIColor.black.withAlphaComponent(0.18)
        wrapper.layer.borderWidth = 1.6
        wrapper.layer.borderColor = UIColor.white.withAlphaComponent(0.62).cgColor
        wrapper.layer.cornerRadius = 13
        wrapper.layer.cornerCurve = .continuous

        let captionLabel = UILabel()
        captionLabel.translatesAutoresizingMaskIntoConstraints = false
        captionLabel.text = caption
        captionLabel.font = UIFont.monospacedSystemFont(ofSize: compact ? 6.5 : 12, weight: .bold)
        captionLabel.textColor = UIColor.white.withAlphaComponent(0.78)
        captionLabel.adjustsFontSizeToFitWidth = true
        captionLabel.minimumScaleFactor = 0.65

        valueLabel.translatesAutoresizingMaskIntoConstraints = false
        valueLabel.font = UIFont.systemFont(ofSize: compact ? 10.5 : 20, weight: .bold)
        valueLabel.textColor = .white
        valueLabel.adjustsFontSizeToFitWidth = true
        valueLabel.minimumScaleFactor = 0.58
        valueLabel.lineBreakMode = .byTruncatingTail

        wrapper.addSubview(captionLabel)
        wrapper.addSubview(valueLabel)
        NSLayoutConstraint.activate([
            captionLabel.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: compact ? 7 : 12),
            captionLabel.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: compact ? -7 : -12),
            captionLabel.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: compact ? 5 : 8),
            valueLabel.leadingAnchor.constraint(equalTo: captionLabel.leadingAnchor),
            valueLabel.trailingAnchor.constraint(equalTo: captionLabel.trailingAnchor),
            valueLabel.topAnchor.constraint(equalTo: captionLabel.bottomAnchor, constant: compact ? 1 : 2)
        ])
        return wrapper
    }
}

final class CapturePreviewViewController: UIViewController {
    enum PreviewItem {
        case photo(UIImage, Data)
        case video(URL, cleanup: [URL])
    }

    var onAdd: ((VitAlGuardPreviewController.ScanMode) -> Void)?
    var onSavePhoto: ((UIImage) -> Void)?
    var onSaveVideo: ((URL) -> Void)?

    private let item: PreviewItem
    private let theme: PreviewThemeMode
    private var playerController: AVPlayerViewController?

    init(item: PreviewItem, theme: PreviewThemeMode) {
        self.item = item
        self.theme = theme
        super.init(nibName: nil, bundle: nil)
        modalPresentationCapturesStatusBarAppearance = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = theme.interfaceStyle
        view.backgroundColor = .black
        build()
    }

    deinit {
        if case .video(_, let cleanup) = item {
            for url in Set(cleanup) {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    private func build() {
        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "촬영 미리보기"
        title.textColor = .white
        title.font = UIFont.systemFont(ofSize: 18, weight: .black)

        let close = UIButton(type: .system)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.setImage(UIImage(systemName: "xmark"), for: .normal)
        close.tintColor = .white
        close.backgroundColor = UIColor.white.withAlphaComponent(0.16)
        close.layer.cornerRadius = 18
        close.addTarget(self, action: #selector(closePreview), for: .touchUpInside)

        let share = UIButton(type: .system)
        share.translatesAutoresizingMaskIntoConstraints = false
        share.setImage(UIImage(systemName: "square.and.arrow.up"), for: .normal)
        share.tintColor = .white
        share.backgroundColor = UIColor.white.withAlphaComponent(0.16)
        share.layer.cornerRadius = 18
        share.addTarget(self, action: #selector(shareCapture), for: .touchUpInside)

        let preview = previewView()
        let add = bottomButton(title: "사진/동영상 추가", symbol: "plus.circle.fill")
        add.addTarget(self, action: #selector(addCapture), for: .touchUpInside)
        let save = bottomButton(title: "사진첩에 저장", symbol: "square.and.arrow.down.fill")
        save.addTarget(self, action: #selector(saveCapture), for: .touchUpInside)

        view.addSubview(title)
        view.addSubview(close)
        view.addSubview(share)
        view.addSubview(preview)
        view.addSubview(add)
        view.addSubview(save)

        NSLayoutConstraint.activate([
            close.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 14),
            close.widthAnchor.constraint(equalToConstant: 44),
            close.heightAnchor.constraint(equalToConstant: 44),
            share.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            share.centerYAnchor.constraint(equalTo: close.centerYAnchor),
            share.widthAnchor.constraint(equalToConstant: 44),
            share.heightAnchor.constraint(equalToConstant: 44),
            title.centerYAnchor.constraint(equalTo: close.centerYAnchor),
            title.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            preview.topAnchor.constraint(equalTo: close.bottomAnchor, constant: 18),
            preview.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            preview.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            preview.bottomAnchor.constraint(equalTo: add.topAnchor, constant: -18),
            add.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            add.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -14),
            add.heightAnchor.constraint(equalToConstant: 54),
            save.leadingAnchor.constraint(equalTo: add.trailingAnchor, constant: 12),
            save.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            save.bottomAnchor.constraint(equalTo: add.bottomAnchor),
            save.heightAnchor.constraint(equalTo: add.heightAnchor),
            save.widthAnchor.constraint(equalTo: add.widthAnchor)
        ])
    }

    private func previewView() -> UIView {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.backgroundColor = UIColor.white.withAlphaComponent(0.08)
        container.layer.cornerRadius = 24
        container.layer.cornerCurve = .continuous
        container.clipsToBounds = true

        switch item {
        case .photo(let image, _):
            let imageView = UIImageView(image: image)
            imageView.translatesAutoresizingMaskIntoConstraints = false
            imageView.contentMode = .scaleAspectFit
            container.addSubview(imageView)
            NSLayoutConstraint.activate([
                imageView.topAnchor.constraint(equalTo: container.topAnchor),
                imageView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                imageView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                imageView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
            ])
        case .video(let url, _):
            let player = AVPlayer(url: url)
            let controller = AVPlayerViewController()
            controller.player = player
            controller.view.translatesAutoresizingMaskIntoConstraints = false
            addChild(controller)
            container.addSubview(controller.view)
            controller.didMove(toParent: self)
            playerController = controller
            NSLayoutConstraint.activate([
                controller.view.topAnchor.constraint(equalTo: container.topAnchor),
                controller.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                controller.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                controller.view.bottomAnchor.constraint(equalTo: container.bottomAnchor)
            ])
        }
        return container
    }

    private func bottomButton(title: String, symbol: String) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        var config = UIButton.Configuration.filled()
        config.title = title
        config.image = UIImage(systemName: symbol)
        config.imagePadding = 6
        config.baseBackgroundColor = UIColor.white.withAlphaComponent(0.16)
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        button.configuration = config
        button.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .black)
        return button
    }

    @objc private func closePreview() {
        dismiss(animated: true)
    }

    @objc private func addCapture() {
        switch item {
        case .photo:
            onAdd?(.mediaPhoto)
        case .video:
            onAdd?(.mediaVideo)
        }
    }

    @objc private func saveCapture() {
        switch item {
        case .photo(let image, _):
            onSavePhoto?(image)
        case .video(let url, _):
            onSaveVideo?(url)
        }
    }

    @objc private func shareCapture() {
        let activityItems: [Any]
        switch item {
        case .photo(let image, _):
            activityItems = [image]
        case .video(let url, _):
            activityItems = [url]
        }
        let activity = UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
        if let popover = activity.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.safeAreaInsets.top + 44, width: 1, height: 1)
        }
        present(activity, animated: true)
    }
}

final class WalletIdentityViewController: UIViewController, UITextFieldDelegate {
    private let appMode: AppMode
    private let scrollView = UIScrollView()
    private let stack = UIStackView()
    private let standardPreview = StandardPassPreviewView()
    private let fields: [(title: String, keyPath: WritableKeyPath<WalletIdentityPayload, String>, field: UITextField)] = [
        ("이름", \.name, UITextField()),
        ("사원번호", \.employeeId, UITextField()),
        ("전화번호", \.phone, UITextField()),
        ("부서", \.department, UITextField()),
        ("직급", \.rank, UITextField()),
        ("직책", \.jobTitle, UITextField()),
        ("작업 구역", \.workZone, UITextField()),
        ("현장명", \.siteName, UITextField()),
        ("입사일", \.hireDate, UITextField()),
        ("만료일", \.expiryDate, UITextField())
    ]
    private let qrImageView = UIImageView()
    private let barcodeImageView = UIImageView()
    private let statusLabel = UILabel()
    private let ink = UIColor(red: 0.067, green: 0.067, blue: 0.067, alpha: 1.0)

    init(appMode: AppMode) {
        self.appMode = appMode
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        self.appMode = .worker
        super.init(coder: coder)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Wallet ID 패스"
        view.backgroundColor = traitCollection.userInterfaceStyle == .dark ? ink : .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close))
        buildInterface()
        loadSavedValues()
        refreshCodes()
    }

    private func buildInterface() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 12
        scrollView.keyboardDismissMode = .interactive

        view.addSubview(scrollView)
        scrollView.addSubview(stack)
        stack.addArrangedSubview(standardPreview)

        let intro = UILabel()
        intro.text = "Standard 형식의 VitAlGuard 사원증을 iPhone 앱 안에서 만들고, 같은 QR/바코드를 Apple Watch 앱으로 동기화합니다. Apple Wallet 추가는 서버에서 서명된 .pkpass를 반환할 때 실행됩니다."
        intro.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        intro.textColor = .secondaryLabel
        intro.numberOfLines = 0
        stack.addArrangedSubview(intro)

        for item in fields {
            stack.addArrangedSubview(fieldRow(title: item.title, field: item.field))
        }

        let generateButton = actionButton("QR / 바코드 다시 생성", background: ink)
        generateButton.addTarget(self, action: #selector(generateCodes), for: .touchUpInside)
        let walletButton = PKAddPassButton(addPassButtonStyle: .black)
        walletButton.translatesAutoresizingMaskIntoConstraints = false
        walletButton.heightAnchor.constraint(equalToConstant: 50).isActive = true
        walletButton.addTarget(self, action: #selector(addToWallet), for: .touchUpInside)

        stack.addArrangedSubview(generateButton)
        stack.addArrangedSubview(walletButton)
        stack.addArrangedSubview(codePreview(title: "QR 코드", detail: "사원번호·ID확인·출퇴근·구내식당 결제 토큰", imageView: qrImageView, height: 260))
        stack.addArrangedSubview(codePreview(title: "바코드", detail: "현장 단말·출퇴근·구내식당용 짧은 검증 토큰", imageView: barcodeImageView, height: 180))

        statusLabel.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0
        stack.addArrangedSubview(statusLabel)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 18),
            stack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -80)
        ])
    }

    private func fieldRow(title: String, field: UITextField) -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        wrapper.backgroundColor = traitCollection.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.08)
            : UIColor.secondarySystemGroupedBackground
        wrapper.layer.cornerRadius = 18
        wrapper.layer.cornerCurve = .continuous

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = title
        label.font = UIFont.systemFont(ofSize: 12, weight: .black)
        label.textColor = .secondaryLabel

        field.translatesAutoresizingMaskIntoConstraints = false
        field.borderStyle = .none
        field.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        field.textColor = .label
        field.clearButtonMode = .whileEditing
        field.autocorrectionType = .no
        field.returnKeyType = .done
        field.delegate = self
        field.addTarget(self, action: #selector(fieldChanged), for: .editingChanged)

        wrapper.addSubview(label)
        wrapper.addSubview(field)
        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 62),
            label.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 16),
            label.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 9),
            field.leadingAnchor.constraint(equalTo: label.leadingAnchor),
            field.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -16),
            field.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 3)
        ])
        return wrapper
    }

    private func actionButton(_ title: String, background: UIColor) -> UIButton {
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.baseBackgroundColor = background
        configuration.baseForegroundColor = .white
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 16, bottom: 13, trailing: 16)
        let button = UIButton(configuration: configuration)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .black)
        button.heightAnchor.constraint(equalToConstant: 50).isActive = true
        return button
    }

    private func codePreview(title: String, detail: String, imageView: UIImageView, height: CGFloat) -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        wrapper.backgroundColor = .secondarySystemGroupedBackground
        wrapper.layer.cornerRadius = 20
        wrapper.layer.cornerCurve = .continuous

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = title
        label.font = UIFont.systemFont(ofSize: 14, weight: .black)
        label.textColor = .label

        let detailLabel = UILabel()
        detailLabel.translatesAutoresizingMaskIntoConstraints = false
        detailLabel.text = detail
        detailLabel.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        detailLabel.textColor = .secondaryLabel
        detailLabel.numberOfLines = 2

        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = .white
        imageView.layer.cornerRadius = 14
        imageView.clipsToBounds = true

        wrapper.addSubview(label)
        wrapper.addSubview(detailLabel)
        wrapper.addSubview(imageView)
        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: height + 82),
            label.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 16),
            label.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 12),
            detailLabel.leadingAnchor.constraint(equalTo: label.leadingAnchor),
            detailLabel.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -16),
            detailLabel.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 3),
            imageView.topAnchor.constraint(equalTo: detailLabel.bottomAnchor, constant: 10),
            imageView.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 16),
            imageView.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -16),
            imageView.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -16)
        ])
        return wrapper
    }

    private func loadSavedValues() {
        var payload = WalletIdentityPayload.load(role: appMode)
        for item in fields {
            item.field.text = payload[keyPath: item.keyPath]
        }
    }

    private func currentPayload() -> WalletIdentityPayload {
        var payload = WalletIdentityPayload.load(role: appMode)
        for item in fields {
            payload[keyPath: item.keyPath] = item.field.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        return payload
    }

    @objc private func fieldChanged() {
        refreshCodes()
    }

    @objc private func generateCodes() {
        let payload = currentPayload()
        payload.save()
        refreshCodes()
        PhoneWatchBridge.shared.publishCurrentSession()
        statusLabel.text = "입력 정보가 저장되고 QR/바코드가 갱신되었습니다."
    }

    private func refreshCodes() {
        let payload = currentPayload()
        let qrImage = Self.makeQRCode(from: payload.encodedString)
        qrImageView.image = qrImage
        let barcodeImage = Self.makeCode128(from: payload.barcodeString)
        barcodeImageView.image = barcodeImage
        standardPreview.update(payload: payload, qrImage: qrImage, barcodeImage: barcodeImage)
        VitAlGuardSharedStorage.saveWalletIdentity(
            payload.dictionary,
            qrPNGData: qrImage?.pngData(),
            barcodePNGData: barcodeImage?.pngData()
        )
        WidgetCenter.shared.reloadAllTimelines()
        statusLabel.text = "QR 검증 링크 / 바코드 토큰: \(payload.barcodeString)"
    }

    @objc private func addToWallet() {
        view.endEditing(true)
        var payload = currentPayload()
        payload.save()
        PhoneWatchBridge.shared.publishCurrentSession()

        guard PKAddPassesViewController.canAddPasses() else {
            presentAlert("Apple Wallet", "이 기기에서는 Wallet 패스 추가를 사용할 수 없습니다.")
            return
        }
        guard let endpoint = signedPassEndpoint() else {
            presentAlert(
                "서명 서버 필요",
                "현재 QR/바코드는 VitAlGuard 앱과 Watch 앱 안에서 사용할 수 있지만, Apple Wallet에 추가하려면 Apple Developer Pass Type ID 인증서로 서명된 .pkpass를 반환하는 서버가 필요합니다. 설정에서 실제 Wallet 패스 서명 서버 URL을 연결한 뒤 다시 시도해 주세요."
            )
            statusLabel.text = "Apple Wallet 추가는 서명된 .pkpass 서버 연결 후 사용할 수 있습니다."
            return
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/vnd.apple.pkpass", forHTTPHeaderField: "Accept")
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload.dictionary, options: [.sortedKeys])

        statusLabel.text = "서명된 Wallet 패스를 요청 중입니다..."
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.presentAlert("Wallet 패스 요청 실패", error.localizedDescription)
                    self.statusLabel.text = "서명된 .pkpass 요청 실패"
                    return
                }
                guard
                    let http = response as? HTTPURLResponse,
                    (200..<300).contains(http.statusCode),
                    let data,
                    let pass = try? PKPass(data: data)
                else {
                    self.presentAlert(
                        "서명 서버 응답 확인",
                        "서버가 Apple Wallet에서 열 수 있는 유효한 .pkpass를 반환하지 않았습니다. Pass Type ID 인증서로 서명된 패스 파일을 반환해야 Wallet에 추가할 수 있습니다."
                    )
                    self.statusLabel.text = "유효한 .pkpass 응답 대기"
                    return
                }
                guard let controller = PKAddPassesViewController(pass: pass) else {
                    self.presentAlert("Apple Wallet", "Wallet 추가 화면을 열 수 없습니다.")
                    return
                }
                self.present(controller, animated: true)
                self.statusLabel.text = "Apple Wallet 추가 화면을 열었습니다."
            }
        }.resume()
    }

    private func signedPassEndpoint() -> URL? {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.endpoint)
        let rawTrimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !rawTrimmed.isEmpty else { return nil }
        let normalized = DashboardSyncService.shared.normalizedEndpoint(from: raw)
        guard var components = URLComponents(string: normalized) else { return nil }
        if components.path.hasSuffix("/wallet/pass") || components.path.hasSuffix("/api/wallet/pass") {
            return components.url
        }
        components.path = "/api/wallet/pass"
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private func presentAlert(_ title: String, _ message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default))
        present(alert, animated: true)
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    fileprivate static func makeQRCode(from string: String) -> UIImage? {
        guard
            let data = string.data(using: .utf8),
            let filter = CIFilter(name: "CIQRCodeGenerator")
        else { return nil }
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        return outputImage(from: filter, scale: 10)
    }

    fileprivate static func makeCode128(from string: String) -> UIImage? {
        let normalized = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return nil }
        guard
            let data = normalized.data(using: .ascii),
            let filter = CIFilter(name: "CICode128BarcodeGenerator")
        else { return nil }
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue(6, forKey: "inputQuietSpace")
        return outputImage(from: filter, scale: 4)
    }

    private static func outputImage(from filter: CIFilter, scale: CGFloat) -> UIImage? {
        guard let output = filter.outputImage else { return nil }
        let transformed = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let context = CIContext()
        guard let cgImage = context.createCGImage(transformed, from: transformed.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

extension VitAlGuardPreviewController: UITabBarDelegate {
    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        if tabBar.accessibilityIdentifier == "dashboardWeatherPageTabBar" {
            guard (0..<5).contains(item.tag) else { return }
            dashboardWeatherPageIndex = item.tag
            rebuildInterfacePreservingScrollPosition()
            return
        }
        let tabs = MainTab.allCases
        guard tabs.indices.contains(item.tag) else { return }
        activeMainTab = tabs[item.tag]
        buildInterface()
    }
}

private final class SafetySignalOrderEditorController: UITableViewController {
    var onSave: (([String]) -> Void)?

    private let kind: SafetySignalKind
    private let interfaceStyle: UIUserInterfaceStyle
    private var rows: [SafetySignalRecord]

    init(kind: SafetySignalKind, rows: [SafetySignalRecord], interfaceStyle: UIUserInterfaceStyle) {
        self.kind = kind
        self.rows = rows
        self.interfaceStyle = interfaceStyle
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) {
        kind = .workers
        rows = []
        interfaceStyle = .unspecified
        super.init(coder: coder)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = interfaceStyle
        title = "\(kind.title) 순서 편집"
        tableView.isEditing = true
        tableView.allowsSelectionDuringEditing = false
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "저장", style: .prominent, target: self, action: #selector(save))
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        rows.count
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let row = rows[indexPath.row]
        cell.textLabel?.text = row.title
        cell.textLabel?.font = UIFont.systemFont(ofSize: 16, weight: .black)
        cell.detailTextLabel?.text = [row.value, row.status, row.detail].filter { !$0.isEmpty }.joined(separator: " · ")
        cell.detailTextLabel?.numberOfLines = 2
        cell.imageView?.image = UIImage(systemName: kind.symbol)
        cell.imageView?.tintColor = row.tint
        return cell
    }

    override func tableView(_ tableView: UITableView, canMoveRowAt indexPath: IndexPath) -> Bool {
        true
    }

    override func tableView(_ tableView: UITableView, moveRowAt sourceIndexPath: IndexPath, to destinationIndexPath: IndexPath) {
        let item = rows.remove(at: sourceIndexPath.row)
        rows.insert(item, at: destinationIndexPath.row)
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    @objc private func save() {
        onSave?(rows.map(\.title))
        dismiss(animated: true)
    }
}

private final class AlertCenterViewController: UIViewController {
    var onClear: (() -> Void)?
    var onMarkAllRead: (([[String: String]]) -> Void)?

    private var alerts: [[String: String]]
    private let interfaceStyle: UIUserInterfaceStyle
    private let scrollView = UIScrollView()
    private let stackView = UIStackView()
    private let ink = UIColor(red: 0.067, green: 0.067, blue: 0.067, alpha: 1.0)
    private let mute = UIColor(red: 0.27, green: 0.27, blue: 0.30, alpha: 1.0)
    private let softCloud = UIColor(red: 0.949, green: 0.957, blue: 0.969, alpha: 1.0)
    private let hairline = UIColor(red: 0.88, green: 0.89, blue: 0.91, alpha: 1.0)
    private var clearAllArmed = false

    init(alerts: [[String: String]], interfaceStyle: UIUserInterfaceStyle) {
        self.alerts = alerts
        self.interfaceStyle = interfaceStyle
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        alerts = []
        interfaceStyle = .unspecified
        super.init(coder: coder)
    }

    private var isDarkTheme: Bool {
        switch interfaceStyle {
        case .dark: return true
        case .light: return false
        default: return traitCollection.userInterfaceStyle == .dark
        }
    }

    private var textColor: UIColor { isDarkTheme ? .white : ink }
    private var secondaryColor: UIColor { isDarkTheme ? UIColor.white.withAlphaComponent(0.78) : mute }
    private var glassFill: UIColor { isDarkTheme ? UIColor.white.withAlphaComponent(0.16) : UIColor.white.withAlphaComponent(0.94) }
    private var glassStroke: UIColor { isDarkTheme ? UIColor.white.withAlphaComponent(0.23) : hairline }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = interfaceStyle
        navigationController?.overrideUserInterfaceStyle = interfaceStyle
        view.backgroundColor = isDarkTheme ? ink : softCloud
        title = "알림 센터"
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close))
        updateActions()
        buildList()
    }

    private func updateActions() {
        if !alerts.isEmpty {
            let clear = UIBarButtonItem(title: "모두 지우기", style: .plain, target: self, action: #selector(clearAll))
            clear.tintColor = clearAllArmed ? .systemRed : nil
            let markReadButton = UIButton(type: .system)
            markReadButton.setTitle("모두 읽음", for: .normal)
            markReadButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
            markReadButton.isEnabled = alerts.contains { $0["read"] != "true" }
            markReadButton.addTarget(self, action: #selector(markAllRead), for: .touchUpInside)
            markReadButton.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(armClearAll(_:))))
            let markRead = UIBarButtonItem(customView: markReadButton)
            navigationItem.rightBarButtonItems = [clear, markRead]
        } else {
            navigationItem.rightBarButtonItems = nil
        }
    }

    private func buildList() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        view.addSubview(scrollView)

        stackView.translatesAutoresizingMaskIntoConstraints = false
        stackView.axis = .vertical
        stackView.spacing = 14
        scrollView.addSubview(stackView)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stackView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 22),
            stackView.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 20),
            stackView.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -20),
            stackView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -28)
        ])

        reloadListContent()
    }

    private func reloadListContent() {
        stackView.arrangedSubviews.forEach {
            stackView.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        stackView.addArrangedSubview(sectionTitle("iPhone / Apple Watch 알림"))
        if alerts.isEmpty {
            stackView.addArrangedSubview(emptyRow())
        } else {
            alerts.prefix(20).forEach { stackView.addArrangedSubview(alertRow($0)) }
        }
    }

    private func applyGlass(to view: UIView, cornerRadius: CGFloat) {
        view.backgroundColor = glassFill
        view.layer.cornerRadius = cornerRadius
        view.layer.cornerCurve = .continuous
        view.layer.borderWidth = 0.5
        view.layer.borderColor = glassStroke.cgColor
    }

    private func sectionTitle(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.textColor = textColor
        label.font = UIFont.systemFont(ofSize: 19, weight: .black)
        label.numberOfLines = 0
        return label
    }

    private func emptyRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)
        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "확인할 알림이 없습니다"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)
        let detail = UILabel()
        detail.translatesAutoresizingMaskIntoConstraints = false
        detail.text = "낙상 확인, AED Alert, Watch 생체 이상, 사진/문서 저장 결과가 이곳에 목록으로 표시됩니다."
        detail.textColor = secondaryColor
        detail.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        detail.numberOfLines = 3
        row.addSubview(title)
        row.addSubview(detail)
        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 104),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 20),
            title.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            title.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            detail.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            detail.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            detail.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            detail.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -18)
        ])
        return row
    }

    private func alertRow(_ item: [String: String]) -> UIView {
        let isRead = item["read"] == "true"
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)
        let symbol = UIImageView(image: UIImage(systemName: iconName(for: item["title"] ?? "")))
        symbol.translatesAutoresizingMaskIntoConstraints = false
        symbol.tintColor = isRead ? secondaryColor : tintColor(for: item["title"] ?? "")
        symbol.contentMode = .scaleAspectFit
        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = item["title"] ?? "앱 알림"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)
        let status = UILabel()
        status.translatesAutoresizingMaskIntoConstraints = false
        status.text = isRead ? "읽음" : "미읽음"
        status.textColor = isRead ? secondaryColor : .white
        status.textAlignment = .center
        status.font = UIFont.systemFont(ofSize: 11, weight: .black)
        status.backgroundColor = isRead ? UIColor.clear : UIColor.systemBlue
        status.layer.cornerRadius = 9
        status.layer.cornerCurve = .continuous
        status.clipsToBounds = true
        let time = UILabel()
        time.translatesAutoresizingMaskIntoConstraints = false
        time.text = item["time"] ?? ""
        time.textColor = secondaryColor
        time.textAlignment = .right
        time.font = UIFont.monospacedDigitSystemFont(ofSize: 12, weight: .bold)
        let meta = UIStackView(arrangedSubviews: [status, time])
        meta.translatesAutoresizingMaskIntoConstraints = false
        meta.axis = .horizontal
        meta.alignment = .center
        meta.spacing = 8
        let message = UILabel()
        message.translatesAutoresizingMaskIntoConstraints = false
        message.text = item["message"] ?? ""
        message.textColor = secondaryColor
        message.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        message.numberOfLines = 4
        row.addSubview(symbol)
        row.addSubview(title)
        row.addSubview(meta)
        row.addSubview(message)
        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 92),
            symbol.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            symbol.topAnchor.constraint(equalTo: row.topAnchor, constant: 19),
            symbol.widthAnchor.constraint(equalToConstant: 24),
            symbol.heightAnchor.constraint(equalToConstant: 24),
            title.leadingAnchor.constraint(equalTo: symbol.trailingAnchor, constant: 12),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 16),
            title.trailingAnchor.constraint(lessThanOrEqualTo: meta.leadingAnchor, constant: -10),
            meta.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            meta.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            status.widthAnchor.constraint(equalToConstant: 46),
            status.heightAnchor.constraint(equalToConstant: 18),
            time.widthAnchor.constraint(equalToConstant: 58),
            message.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            message.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            message.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 7),
            message.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -16)
        ])
        return row
    }

    private func iconName(for title: String) -> String {
        if title.contains("낙상") { return "figure.fall" }
        if title.contains("AED") { return "heart.text.square.fill" }
        if title.contains("Watch") || title.contains("생체") { return "applewatch" }
        if title.contains("사진") || title.contains("동영상") { return "photo.on.rectangle.angled" }
        if title.contains("문서") || title.contains("업로드") { return "doc.text.fill" }
        return "bell.fill"
    }

    private func tintColor(for title: String) -> UIColor {
        if title.contains("실패") { return .systemRed }
        if title.contains("낙상") || title.contains("AED") { return .systemPink }
        if title.contains("완료") { return .systemGreen }
        return .systemBlue
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    @objc private func clearAll() {
        let alert = UIAlertController(title: "모두 지우시겠습니까?", message: "알림 센터의 모든 알림이 삭제됩니다.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "아니오", style: .cancel))
        alert.addAction(UIAlertAction(title: "예", style: .destructive) { [weak self] _ in
            self?.onClear?()
            self?.dismiss(animated: true)
        })
        present(alert, animated: true)
    }

    @objc private func markAllRead() {
        alerts = alerts.map { item in
            var copy = item
            copy["read"] = "true"
            return copy
        }
        onMarkAllRead?(alerts)
        updateActions()
        reloadListContent()
    }

    @objc private func armClearAll(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }
        clearAllArmed = true
        updateActions()
    }
}

final class PreviewSettingsViewController: UIViewController, UITextFieldDelegate, CLLocationManagerDelegate {
    var onSave: (() -> Void)?
    var onThemeChange: (() -> Void)?
    var onLayoutChange: (() -> Void)?

    private let workerField = UITextField()
    private let employeeField = UITextField()
    private let endpointField = UITextField()
    private let appUploadTokenField = UITextField()
    private let dashboardAdminIdField = UITextField()
    private let dashboardAdminPasswordField = UITextField()
    private let languageButton = UIButton(type: .system)
    private let syncIntervalField = UITextField()
    private let syncSlider = UISlider()
    private let autoSwitch = UISwitch()
    private let watermarkDateSwitch = UISwitch()
    private let watermarkAddressSwitch = UISwitch()
    private let watermarkCoordinateSwitch = UISwitch()
    private let watermarkPositionSegment = UISegmentedControl(items: WatermarkPosition.allCases.map { $0.title })
    private let watermarkTextColorSegment = UISegmentedControl(items: WatermarkTextColorPreset.allCases.map { $0.title })
    private let watermarkBackgroundColorSegment = UISegmentedControl(items: WatermarkBackgroundColorPreset.allCases.map { $0.title })
    private let watermarkFontScaleSlider = UISlider()
    private let watermarkFontScaleValueLabel = UILabel()
    private let watermarkBackgroundAlphaSlider = UISlider()
    private let watermarkBackgroundAlphaValueLabel = UILabel()
    private let watermarkTextColorWell = UIColorWell()
    private let settingsLocationManager = CLLocationManager()
    private var usingCustomWatermarkTextColor = false
    private let watermarkPreviewImageView = UIImageView()
    private let scrollView = UIScrollView()
    private let formStack = UIStackView()

    private let ink = UIColor(red: 0.067, green: 0.067, blue: 0.067, alpha: 1.0)
    private let softCloud = UIColor(red: 0.949, green: 0.957, blue: 0.969, alpha: 1.0)
    private let hairline = UIColor(red: 0.88, green: 0.89, blue: 0.91, alpha: 1.0)
    private let mute = UIColor(red: 0.27, green: 0.27, blue: 0.30, alpha: 1.0)
    private let glassLight = UIColor.white.withAlphaComponent(0.92)
    private let glassDark = UIColor.white.withAlphaComponent(0.16)

    override func viewDidLoad() {
        super.viewDidLoad()
        settingsLocationManager.delegate = self
        settingsLocationManager.desiredAccuracy = kCLLocationAccuracyBest
        settingsLocationManager.activityType = .other
        settingsLocationManager.distanceFilter = 5
        settingsLocationManager.pausesLocationUpdatesAutomatically = false
        if #available(iOS 11.0, *) {
            settingsLocationManager.showsBackgroundLocationIndicator = true
            settingsLocationManager.allowsBackgroundLocationUpdates = true
        }
        applySavedTheme()
        title = "설정"
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "저장", style: .prominent, target: self, action: #selector(save))
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardFrameChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardFrameChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        buildForm()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private var savedThemeMode: PreviewThemeMode {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.themeMode) ?? PreviewThemeMode.system.rawValue
        return PreviewThemeMode(rawValue: raw) ?? .system
    }

    private var isDarkTheme: Bool {
        switch savedThemeMode {
        case .dark:
            return true
        case .light:
            return false
        case .system:
            return traitCollection.userInterfaceStyle == .dark
        }
    }

    private func applySavedTheme() {
        overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        navigationController?.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        view.backgroundColor = isDarkTheme ? ink : softCloud
    }

    private var textColor: UIColor {
        isDarkTheme ? .white : ink
    }

    private var fieldColor: UIColor {
        isDarkTheme ? glassDark : glassLight
    }

    private var glassStroke: UIColor {
        isDarkTheme
            ? UIColor.white.withAlphaComponent(0.23)
            : hairline
    }

    private func buildForm() {
        applySavedTheme()
        formStack.arrangedSubviews.forEach {
            formStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }

        let defaults = UserDefaults.standard
        workerField.text = defaults.string(forKey: PreviewSettingsKey.workerName)
        employeeField.text = defaults.string(forKey: PreviewSettingsKey.employeeId)
        endpointField.text = DashboardSyncService.shared.normalizedEndpoint(from: defaults.string(forKey: PreviewSettingsKey.endpoint))
        appUploadTokenField.text = defaults.string(forKey: vitalGuardUploadTokenDefaultsKey)
        dashboardAdminIdField.text = defaults.string(forKey: PreviewSettingsKey.dashboardAdminId)
        dashboardAdminPasswordField.text = DashboardCredentialStore.loadPassword()
        configureLanguageButton()

        let syncValue = defaults.object(forKey: PreviewSettingsKey.syncInterval) as? Double ?? 10
        syncIntervalField.text = "\(Int(min(3599, max(5, syncValue)).rounded()))"
        syncSlider.minimumValue = 5
        syncSlider.maximumValue = 3599
        syncSlider.value = Float(min(3599, max(5, syncValue)))
        syncSlider.addTarget(self, action: #selector(syncSliderChanged), for: .valueChanged)
        autoSwitch.isOn = defaults.object(forKey: PreviewSettingsKey.autoCollection) == nil
            ? true
            : defaults.bool(forKey: PreviewSettingsKey.autoCollection)

        watermarkDateSwitch.isOn = defaults.object(forKey: PreviewSettingsKey.watermarkShowDate) as? Bool ?? true
        watermarkAddressSwitch.isOn = defaults.object(forKey: PreviewSettingsKey.watermarkShowAddress) as? Bool ?? true
        watermarkCoordinateSwitch.isOn = defaults.object(forKey: PreviewSettingsKey.watermarkShowCoordinate) as? Bool ?? true
        watermarkDateSwitch.addTarget(self, action: #selector(watermarkSettingChanged), for: .valueChanged)
        watermarkAddressSwitch.addTarget(self, action: #selector(watermarkSettingChanged), for: .valueChanged)
        watermarkCoordinateSwitch.addTarget(self, action: #selector(watermarkSettingChanged), for: .valueChanged)
        watermarkBackgroundColorSegment.addTarget(self, action: #selector(watermarkSettingChanged), for: .valueChanged)
        watermarkPositionSegment.addTarget(self, action: #selector(watermarkSettingChanged), for: .valueChanged)

        let fontScale = defaults.object(forKey: PreviewSettingsKey.watermarkFontScale) as? Double ?? 1.0
        watermarkFontScaleSlider.minimumValue = 0.6
        watermarkFontScaleSlider.maximumValue = 2.0
        watermarkFontScaleSlider.value = Float(max(0.6, min(2.0, fontScale)))
        watermarkFontScaleSlider.addTarget(self, action: #selector(watermarkFontScaleChanged), for: .valueChanged)
        watermarkFontScaleValueLabel.text = String(format: "x%.2f", watermarkFontScaleSlider.value)
        watermarkFontScaleValueLabel.textColor = mute
        watermarkFontScaleValueLabel.font = UIFont.systemFont(ofSize: 12, weight: .black)

        let bgAlpha = defaults.object(forKey: PreviewSettingsKey.watermarkBackgroundAlpha) as? Double ?? 0.5
        watermarkBackgroundAlphaSlider.minimumValue = 0
        watermarkBackgroundAlphaSlider.maximumValue = 1
        watermarkBackgroundAlphaSlider.value = Float(max(0, min(1, bgAlpha)))
        watermarkBackgroundAlphaSlider.addTarget(self, action: #selector(watermarkBackgroundAlphaChanged), for: .valueChanged)
        watermarkBackgroundAlphaValueLabel.text = String(format: "%.0f%%", watermarkBackgroundAlphaSlider.value * 100)
        watermarkBackgroundAlphaValueLabel.textColor = mute
        watermarkBackgroundAlphaValueLabel.font = UIFont.systemFont(ofSize: 12, weight: .black)

        let position = WatermarkPosition(rawValue: defaults.string(forKey: PreviewSettingsKey.watermarkPosition) ?? "") ?? .bottom
        watermarkPositionSegment.removeAllSegments()
        WatermarkPosition.allCases.enumerated().forEach { index, item in
            watermarkPositionSegment.insertSegment(withTitle: item.title, at: index, animated: false)
        }
        watermarkPositionSegment.selectedSegmentIndex = position.index
        watermarkPositionSegment.backgroundColor = fieldColor

        let savedTextColorRaw = defaults.string(forKey: PreviewSettingsKey.watermarkTextColor) ?? WatermarkTextColorPreset.white.rawValue
        let textColorValue = WatermarkTextColorPreset.from(raw: savedTextColorRaw == "custom" ? WatermarkTextColorPreset.red.rawValue : savedTextColorRaw).index
        watermarkTextColorSegment.removeAllSegments()
        WatermarkTextColorPreset.allCases.enumerated().forEach { index, item in
            watermarkTextColorSegment.insertSegment(withTitle: item.title, at: index, animated: false)
        }
        watermarkTextColorSegment.selectedSegmentIndex = textColorValue
        watermarkTextColorSegment.backgroundColor = fieldColor
        watermarkTextColorSegment.addTarget(self, action: #selector(watermarkSegmentChanged), for: .valueChanged)

        if #available(iOS 14.0, *) {
            if savedTextColorRaw == "custom" {
                usingCustomWatermarkTextColor = true
            } else {
                usingCustomWatermarkTextColor = false
            }
            let savedCustom = Self.decodeHexColor(from: defaults.string(forKey: PreviewSettingsKey.watermarkTextColorCustom)) ?? .systemRed
            watermarkTextColorWell.selectedColor = savedCustom
            watermarkTextColorWell.supportsAlpha = false
            watermarkTextColorWell.addTarget(self, action: #selector(watermarkCustomTextColorChanged), for: .valueChanged)
        }

        let bgColorValue = WatermarkBackgroundColorPreset.from(raw: defaults.string(forKey: PreviewSettingsKey.watermarkBackgroundColor)).index
        watermarkBackgroundColorSegment.removeAllSegments()
        WatermarkBackgroundColorPreset.allCases.enumerated().forEach { index, item in
            watermarkBackgroundColorSegment.insertSegment(withTitle: item.title, at: index, animated: false)
        }
        watermarkBackgroundColorSegment.selectedSegmentIndex = bgColorValue
        watermarkBackgroundColorSegment.backgroundColor = fieldColor

        if formStack.superview == nil {
            scrollView.translatesAutoresizingMaskIntoConstraints = false
            scrollView.alwaysBounceVertical = true
            scrollView.keyboardDismissMode = .interactive
            view.addSubview(scrollView)

            formStack.translatesAutoresizingMaskIntoConstraints = false
            formStack.axis = .vertical
            formStack.spacing = 14
            scrollView.addSubview(formStack)

            NSLayoutConstraint.activate([
                scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                formStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 22),
                formStack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 20),
                formStack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -20),
                formStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -28)
            ])
        }

        formStack.addArrangedSubview(sectionTitle("화면 모드"))
        formStack.addArrangedSubview(themeModeRow())
        formStack.addArrangedSubview(sectionTitle("VitAlGuard 초기 사용방법"))
        formStack.addArrangedSubview(introGuideModeRow())
        formStack.addArrangedSubview(homeLayoutButton())

        formStack.addArrangedSubview(sectionTitle("언어"))
        formStack.addArrangedSubview(languageRow())

        formStack.addArrangedSubview(sectionTitle("작업자 정보"))
        formStack.addArrangedSubview(input(workerField, placeholder: "작업자 이름"))
        formStack.addArrangedSubview(input(employeeField, placeholder: "사원번호"))

        formStack.addArrangedSubview(sectionTitle("대시보드 연동"))
        formStack.addArrangedSubview(input(endpointField, placeholder: VitalGuardLinks.appAPI))
        formStack.addArrangedSubview(input(appUploadTokenField, placeholder: "APP_UPLOAD_TOKEN"))
        formStack.addArrangedSubview(sectionTitle("대시보드 관리자 인증"))
        formStack.addArrangedSubview(input(dashboardAdminIdField, placeholder: "관리자 ID"))
        formStack.addArrangedSubview(input(dashboardAdminPasswordField, placeholder: "관리자 비밀번호 또는 API 비밀번호"))

        formStack.addArrangedSubview(sectionTitle("GPS 항상 허용"))
        formStack.addArrangedSubview(locationPermissionRow())

        formStack.addArrangedSubview(sectionTitle("Watch 센서 사용 모드"))
        formStack.addArrangedSubview(sensorPowerModeRow())

        formStack.addArrangedSubview(sectionTitle("Watch 데이터 연동 주기"))
        formStack.addArrangedSubview(syncIntervalRow())
        formStack.addArrangedSubview(switchRow())

        formStack.addArrangedSubview(sectionTitle("메타데이터 워터마크"))
        formStack.addArrangedSubview(watermarkInfoRow())
        formStack.addArrangedSubview(watermarkIdentityRow())
        formStack.addArrangedSubview(watermarkSwitchRow(title: "촬영일시", subTitle: "표시할지 선택", control: watermarkDateSwitch))
        formStack.addArrangedSubview(watermarkSwitchRow(title: "주소", subTitle: "도로명주소 표시", control: watermarkAddressSwitch))
        formStack.addArrangedSubview(watermarkSwitchRow(title: "좌표", subTitle: "위도/경도 표시", control: watermarkCoordinateSwitch))
        formStack.addArrangedSubview(watermarkSegmentRow(title: "워터마크 위치", segment: watermarkPositionSegment, subTitle: "상단/중앙/하단 위치 선택"))
        formStack.addArrangedSubview(watermarkTextColorRow())
        formStack.addArrangedSubview(watermarkSegmentRow(title: "배경 색상", segment: watermarkBackgroundColorSegment, subTitle: "워터마크 배경 색상 선택"))
        formStack.addArrangedSubview(watermarkSliderRow(title: "글자 크기 배율", subTitle: "0.6배 ~ 2.0배", slider: watermarkFontScaleSlider, valueLabel: watermarkFontScaleValueLabel))
        formStack.addArrangedSubview(watermarkSliderRow(title: "배경 불투명도", subTitle: "0% ~ 100%", slider: watermarkBackgroundAlphaSlider, valueLabel: watermarkBackgroundAlphaValueLabel))
        formStack.addArrangedSubview(watermarkPreviewRow())

        refreshWatermarkPreview()
        localizeSettingsChrome()
        VitAlGuardRuntimeTranslator.shared.localize(view: view)
    }

    private func localizeSettingsChrome() {
        VitAlGuardRuntimeTranslator.shared.translate("설정") { [weak self] text in
            self?.title = text
        }
        VitAlGuardRuntimeTranslator.shared.translate("닫기") { [weak self] text in
            self?.navigationItem.leftBarButtonItem?.title = text
        }
        VitAlGuardRuntimeTranslator.shared.translate("저장") { [weak self] text in
            self?.navigationItem.rightBarButtonItem?.title = text
        }
    }

    private func configureLanguageButton() {
        let language = AppLanguage.saved
        languageButton.setTitle("\(language.title)  \u{203A}", for: .normal)
        languageButton.setTitleColor(textColor, for: .normal)
        languageButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .black)
        languageButton.contentHorizontalAlignment = .leading
        languageButton.removeTarget(nil, action: nil, for: .allEvents)
        languageButton.addTarget(self, action: #selector(showLanguagePicker), for: .touchUpInside)
    }

    private func languageRow() -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: wrapper, cornerRadius: 24)

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = "앱 표시 언어"
        label.textColor = textColor
        label.font = UIFont.systemFont(ofSize: 14, weight: .semibold)

        let detail = UILabel()
        detail.translatesAutoresizingMaskIntoConstraints = false
        detail.text = AppLanguage.saved.detail
        detail.textColor = mute
        detail.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        detail.numberOfLines = 2

        languageButton.translatesAutoresizingMaskIntoConstraints = false
        wrapper.addSubview(label)
        wrapper.addSubview(detail)
        wrapper.addSubview(languageButton)
        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(greaterThanOrEqualToConstant: 76),
            label.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 14),
            label.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 18),
            languageButton.centerYAnchor.constraint(equalTo: label.centerYAnchor),
            languageButton.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -18),
            languageButton.leadingAnchor.constraint(greaterThanOrEqualTo: label.trailingAnchor, constant: 12),
            detail.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 6),
            detail.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 18),
            detail.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -18),
            detail.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -14)
        ])
        return wrapper
    }

    @objc private func showLanguagePicker() {
        VitAlGuardRuntimeTranslator.shared.localizedAlert(
            title: "앱 표시 언어",
            message: "iPhone 설정 앱의 VitAlGuard 항목에서도 기본 언어를 별도로 선택할 수 있습니다."
        ) { [weak self] title, message in
            guard let self else { return }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .actionSheet)
            for language in AppLanguage.allCases {
                alert.addAction(UIAlertAction(title: language.title, style: .default) { [weak self] _ in
                    UserDefaults.standard.set(language.rawValue, forKey: PreviewSettingsKey.languageCode)
                    self?.configureLanguageButton()
                    PhoneWatchBridge.shared.publishCurrentSession()
                    self?.buildForm()
                })
            }
            VitAlGuardRuntimeTranslator.shared.translate("취소") { [weak self] cancelTitle in
                alert.addAction(UIAlertAction(title: cancelTitle, style: .cancel))
                if let popover = alert.popoverPresentationController {
                    popover.sourceView = self?.languageButton
                    popover.sourceRect = self?.languageButton.bounds ?? .zero
                }
                self?.present(alert, animated: true)
            }
        }
    }

    private func sectionTitle(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.textColor = textColor
        label.font = UIFont.systemFont(ofSize: 20, weight: .black)
        return label
    }

    private func input(_ field: UITextField, placeholder: String) -> UIView {
        field.translatesAutoresizingMaskIntoConstraints = false
        field.placeholder = placeholder
        field.textColor = textColor
        field.tintColor = textColor
        field.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.clearButtonMode = .whileEditing
        field.delegate = self
        field.returnKeyType = .done
        field.enablesReturnKeyAutomatically = false
        if field === endpointField {
            field.keyboardType = .URL
            field.textContentType = .URL
        } else if field === appUploadTokenField {
            field.isSecureTextEntry = true
            field.textContentType = .password
        } else if field === dashboardAdminIdField {
            field.textContentType = .username
        } else if field === dashboardAdminPasswordField {
            field.isSecureTextEntry = true
            field.textContentType = .password
        }

        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: wrapper, cornerRadius: 24)
        wrapper.addSubview(field)

        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 52),
            field.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 18),
            field.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -18),
            field.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor)
        ])
        return wrapper
    }

    private func themeModeRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let segment = UISegmentedControl(items: PreviewThemeMode.allCases.map { $0.title })
        segment.translatesAutoresizingMaskIntoConstraints = false
        segment.selectedSegmentIndex = PreviewThemeMode.allCases.firstIndex(of: savedThemeMode) ?? 0
        segment.selectedSegmentTintColor = UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)
        segment.backgroundColor = UIColor.white.withAlphaComponent(isDarkTheme ? 0.18 : 0.50)
        segment.layer.cornerRadius = 18
        segment.layer.cornerCurve = .continuous
        segment.layer.masksToBounds = true
        segment.layer.borderColor = UIColor.white.withAlphaComponent(isDarkTheme ? 0.22 : 0.30).cgColor
        segment.layer.borderWidth = 0.8
        segment.setTitleTextAttributes([
            .foregroundColor: textColor,
            .font: UIFont.systemFont(ofSize: 13, weight: .black)
        ], for: .normal)
        segment.setTitleTextAttributes([
            .foregroundColor: UIColor.white,
            .font: UIFont.systemFont(ofSize: 13, weight: .black)
        ], for: .selected)
        segment.addTarget(self, action: #selector(themeModeSegmentChanged(_:)), for: .valueChanged)

        row.addSubview(segment)
        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 56),
            segment.topAnchor.constraint(equalTo: row.topAnchor, constant: 8),
            segment.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
            segment.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            segment.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -8)
        ])
        return row
    }

    private func introGuideModeRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let segment = UISegmentedControl(items: IntroGuideMode.allCases.map { $0.title })
        segment.translatesAutoresizingMaskIntoConstraints = false
        segment.selectedSegmentIndex = IntroGuideMode.saved.index
        segment.selectedSegmentTintColor = UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)
        segment.backgroundColor = UIColor.white.withAlphaComponent(isDarkTheme ? 0.18 : 0.50)
        segment.layer.cornerRadius = 18
        segment.layer.cornerCurve = .continuous
        segment.layer.masksToBounds = true
        segment.layer.borderColor = UIColor.white.withAlphaComponent(isDarkTheme ? 0.22 : 0.30).cgColor
        segment.layer.borderWidth = 0.8
        segment.setTitleTextAttributes([
            .foregroundColor: textColor,
            .font: UIFont.systemFont(ofSize: 11, weight: .black)
        ], for: .normal)
        segment.setTitleTextAttributes([
            .foregroundColor: UIColor.white,
            .font: UIFont.systemFont(ofSize: 11, weight: .black)
        ], for: .selected)
        segment.addTarget(self, action: #selector(introGuideModeSegmentChanged(_:)), for: .valueChanged)

        let detail = UILabel()
        detail.translatesAutoresizingMaskIntoConstraints = false
        detail.text = IntroGuideMode.saved.detail
        detail.textColor = mute
        detail.font = UIFont.systemFont(ofSize: 11, weight: .bold)
        detail.numberOfLines = 2

        row.addSubview(segment)
        row.addSubview(detail)
        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 88),
            segment.topAnchor.constraint(equalTo: row.topAnchor, constant: 8),
            segment.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
            segment.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            segment.heightAnchor.constraint(equalToConstant: 40),
            detail.topAnchor.constraint(equalTo: segment.bottomAnchor, constant: 7),
            detail.leadingAnchor.constraint(equalTo: segment.leadingAnchor, constant: 2),
            detail.trailingAnchor.constraint(equalTo: segment.trailingAnchor, constant: -2)
        ])
        return row
    }

    private func sensorPowerModeRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let segment = UISegmentedControl(items: SensorPowerMode.allCases.map { $0.title })
        segment.translatesAutoresizingMaskIntoConstraints = false
        segment.selectedSegmentIndex = SensorPowerMode.saved.index
        segment.selectedSegmentTintColor = UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)
        segment.backgroundColor = UIColor.white.withAlphaComponent(isDarkTheme ? 0.18 : 0.50)
        segment.layer.cornerRadius = 18
        segment.layer.cornerCurve = .continuous
        segment.layer.masksToBounds = true
        segment.layer.borderColor = UIColor.white.withAlphaComponent(isDarkTheme ? 0.22 : 0.30).cgColor
        segment.layer.borderWidth = 0.8
        segment.setTitleTextAttributes([.foregroundColor: textColor, .font: UIFont.systemFont(ofSize: 13, weight: .black)], for: .normal)
        segment.setTitleTextAttributes([.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 13, weight: .black)], for: .selected)
        segment.addTarget(self, action: #selector(sensorPowerModeChanged(_:)), for: .valueChanged)

        let detail = UILabel()
        detail.translatesAutoresizingMaskIntoConstraints = false
        detail.text = SensorPowerMode.saved.detail
        detail.textColor = mute
        detail.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        detail.numberOfLines = 3

        row.addSubview(segment)
        row.addSubview(detail)
        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 104),
            segment.topAnchor.constraint(equalTo: row.topAnchor, constant: 8),
            segment.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
            segment.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            segment.heightAnchor.constraint(equalToConstant: 40),
            detail.topAnchor.constraint(equalTo: segment.bottomAnchor, constant: 10),
            detail.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            detail.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            detail.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -12)
        ])
        return row
    }

    @objc private func sensorPowerModeChanged(_ sender: UISegmentedControl) {
        let mode = SensorPowerMode.from(index: sender.selectedSegmentIndex)
        UserDefaults.standard.set(mode.rawValue, forKey: PreviewSettingsKey.sensorPowerMode)
        PhoneWatchBridge.shared.publishCurrentSession()
        buildForm()
    }

    private func locationPermissionRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "현재 상태: \(locationPermissionStatusText())"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let sub = UILabel()
        sub.translatesAutoresizingMaskIntoConstraints = false
        sub.numberOfLines = 2
        sub.text = "화면이 꺼져도 위치 기반 관제 전송을 유지하려면 위치 권한을 항상 허용으로 설정해 주세요."
        sub.textColor = mute
        sub.font = UIFont.systemFont(ofSize: 12, weight: .semibold)

        let request = actionButton(title: "항상 허용 요청", action: #selector(requestAlwaysLocationPermission))
        let settings = actionButton(title: "iPhone 설정 열기", action: #selector(openSystemAppSettings))

        row.addSubview(title)
        row.addSubview(sub)
        row.addSubview(request)
        row.addSubview(settings)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 132),
            title.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            title.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 14),
            sub.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            sub.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 6),
            request.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            request.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -14),
            request.heightAnchor.constraint(equalToConstant: 38),
            settings.leadingAnchor.constraint(equalTo: request.trailingAnchor, constant: 10),
            settings.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            settings.widthAnchor.constraint(equalTo: request.widthAnchor),
            settings.heightAnchor.constraint(equalTo: request.heightAnchor),
            settings.centerYAnchor.constraint(equalTo: request.centerYAnchor)
        ])
        return row
    }

    private func actionButton(title: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle(title, for: .normal)
        button.setTitleColor(textColor, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 12, weight: .black)
        button.backgroundColor = fieldColor
        button.layer.cornerRadius = 18
        button.layer.cornerCurve = .continuous
        button.layer.borderWidth = 1
        button.layer.borderColor = glassStroke.cgColor
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func locationPermissionStatusText() -> String {
        let status: CLAuthorizationStatus
        if #available(iOS 14.0, *) {
            status = settingsLocationManager.authorizationStatus
        } else {
            status = CLLocationManager.authorizationStatus()
        }
        switch status {
        case .authorizedAlways: return "항상 허용"
        case .authorizedWhenInUse: return "앱 사용 중 허용"
        case .denied: return "거부됨"
        case .restricted: return "제한됨"
        case .notDetermined: return "아직 묻지 않음"
        @unknown default: return "확인 필요"
        }
    }

    @objc private func requestAlwaysLocationPermission() {
        guard CLLocationManager.locationServicesEnabled() else {
            openSystemAppSettings()
            return
        }
        settingsLocationManager.requestAlwaysAuthorization()
        if settingsLocationManager.authorizationStatus == .authorizedAlways
            || settingsLocationManager.authorizationStatus == .authorizedWhenInUse {
            settingsLocationManager.startUpdatingLocation()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.buildForm()
        }
    }

    @objc private func openSystemAppSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {
            if manager.authorizationStatus == .authorizedWhenInUse {
                manager.requestAlwaysAuthorization()
            }
            manager.startUpdatingLocation()
        }
        buildForm()
    }

    func locationManager(
        _ manager: CLLocationManager,
        didChangeAuthorization status: CLAuthorizationStatus
    ) {
        if status == .authorizedAlways || status == .authorizedWhenInUse {
            if status == .authorizedWhenInUse {
                manager.requestAlwaysAuthorization()
            }
            manager.startUpdatingLocation()
        }
        buildForm()
    }

    private func homeLayoutButton() -> UIView {
        let layoutButton = settingsGlassButton(title: "홈 화면 배치", action: #selector(openHomeLayout))
        let cacheButton = settingsGlassButton(title: "캐시 삭제", action: #selector(clearAppCache))

        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: wrapper, cornerRadius: 24)
        wrapper.addSubview(layoutButton)
        wrapper.addSubview(cacheButton)

        NSLayoutConstraint.activate([
            wrapper.heightAnchor.constraint(equalToConstant: 116),
            layoutButton.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 9),
            layoutButton.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 10),
            layoutButton.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -10),
            layoutButton.heightAnchor.constraint(equalToConstant: 44),
            cacheButton.topAnchor.constraint(equalTo: layoutButton.bottomAnchor, constant: 8),
            cacheButton.leadingAnchor.constraint(equalTo: layoutButton.leadingAnchor),
            cacheButton.trailingAnchor.constraint(equalTo: layoutButton.trailingAnchor),
            cacheButton.heightAnchor.constraint(equalTo: layoutButton.heightAnchor),
            cacheButton.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -9)
        ])
        return wrapper
    }

    private func settingsGlassButton(title: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle(title, for: .normal)
        button.setTitleColor(textColor, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .black)
        button.backgroundColor = UIColor.white.withAlphaComponent(isDarkTheme ? 0.08 : 0.44)
        button.layer.cornerRadius = 22
        button.layer.cornerCurve = .continuous
        button.layer.borderColor = glassStroke.cgColor
        button.layer.borderWidth = 1
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    @objc private func clearAppCache() {
        let removedCount = clearResidualCacheFiles()
        URLCache.shared.removeAllCachedResponses()
        UserDefaults.standard.removeObject(forKey: "vitalguard.runtime.translation.cache")
        presentSettingsAlert("캐시 삭제", "캐시가 삭제되었습니다.\n정리된 항목: \(removedCount)개")
    }

    private func presentSettingsAlert(_ title: String, _ message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default))
        present(alert, animated: true)
    }

    private func clearResidualCacheFiles() -> Int {
        let manager = FileManager.default
        var removed = 0
        let directoryTargets = [
            manager.urls(for: .cachesDirectory, in: .userDomainMask).first,
            manager.temporaryDirectory.appendingPathComponent("VitAlGuard", isDirectory: true),
            manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("VitAlGuardCalendarMedia", isDirectory: true)
        ].compactMap { $0 }

        for directory in directoryTargets {
            guard manager.fileExists(atPath: directory.path) else { continue }
            if let contents = try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
                for item in contents {
                    do {
                        try manager.removeItem(at: item)
                        removed += 1
                    } catch {
                        continue
                    }
                }
            }
        }
        return removed
    }

    private func syncIntervalRow() -> UIView {
        syncIntervalField.translatesAutoresizingMaskIntoConstraints = false
        syncIntervalField.placeholder = "초 단위 직접 입력"
        syncIntervalField.textColor = textColor
        syncIntervalField.tintColor = textColor
        syncIntervalField.font = UIFont.systemFont(ofSize: 16, weight: .black)
        syncIntervalField.keyboardType = .numberPad
        syncIntervalField.delegate = self

        syncSlider.translatesAutoresizingMaskIntoConstraints = false
        syncSlider.minimumTrackTintColor = UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)

        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "5초부터 59분 59초까지 선택"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let hint = UILabel()
        hint.translatesAutoresizingMaskIntoConstraints = false
        hint.text = "슬라이더 또는 직접 입력으로 Watch 데이터 동기화 주기를 조정합니다."
        hint.textColor = mute
        hint.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        hint.numberOfLines = 2

        let unit = UILabel()
        unit.translatesAutoresizingMaskIntoConstraints = false
        unit.text = "초"
        unit.textColor = mute
        unit.font = UIFont.systemFont(ofSize: 14, weight: .black)

        row.addSubview(title)
        row.addSubview(hint)
        row.addSubview(syncIntervalField)
        row.addSubview(unit)
        row.addSubview(syncSlider)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 124),
            title.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 14),
            syncIntervalField.trailingAnchor.constraint(equalTo: unit.leadingAnchor, constant: -4),
            syncIntervalField.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            syncIntervalField.widthAnchor.constraint(equalToConstant: 56),
            unit.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            unit.centerYAnchor.constraint(equalTo: syncIntervalField.centerYAnchor),
            hint.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            hint.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            hint.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 6),
            syncSlider.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            syncSlider.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            syncSlider.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -14)
        ])
        return row
    }

    private func watermarkInfoRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "기기 정보"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let sub = UILabel()
        sub.translatesAutoresizingMaskIntoConstraints = false
        sub.numberOfLines = 2
        sub.text = "기기 정보(모델/OS)는 보안상 변경되지 않으며 항상 표시됩니다."
        sub.textColor = mute
        sub.font = UIFont.systemFont(ofSize: 12, weight: .semibold)

        row.addSubview(title)
        row.addSubview(sub)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 82),
            title.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 12),
            sub.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            sub.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 6)
        ])
        return row
    }

    private func watermarkIdentityRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "사용자 이름 / ID"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let sub = UILabel()
        sub.translatesAutoresizingMaskIntoConstraints = false
        sub.numberOfLines = 2
        sub.text = "작업자 이름, 로그인 ID, EMP 식별자는 토글 없이 항상 워터마크에 표시됩니다."
        sub.textColor = mute
        sub.font = UIFont.systemFont(ofSize: 12, weight: .semibold)

        let value = UILabel()
        value.translatesAutoresizingMaskIntoConstraints = false
        value.text = watermarkIdentityPreviewText()
        value.textColor = textColor
        value.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .black)
        value.adjustsFontSizeToFitWidth = true
        value.minimumScaleFactor = 0.62

        row.addSubview(title)
        row.addSubview(sub)
        row.addSubview(value)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 100),
            title.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            title.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 12),
            sub.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            sub.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 5),
            value.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            value.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            value.topAnchor.constraint(equalTo: sub.bottomAnchor, constant: 8)
        ])
        return row
    }

    private func watermarkIdentityPreviewText() -> String {
        let defaults = UserDefaults.standard
        let name = defaults.string(forKey: PreviewSettingsKey.workerName)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let employee = defaults.string(forKey: PreviewSettingsKey.employeeId)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let login = defaults.string(forKey: PreviewSettingsKey.loggedInId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let resolvedLogin = login.isEmpty ? "worker7276" : login
        return "\((name?.isEmpty == false ? name : nil) ?? "양지후"), \(resolvedLogin), \((employee?.isEmpty == false ? employee : nil) ?? vitalGuardEmployeeIdentifier(for: resolvedLogin))"
    }

    private func watermarkSwitchRow(title: String, subTitle: String, control: UISwitch) -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = title
        titleLabel.textColor = textColor
        titleLabel.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let sub = UILabel()
        sub.translatesAutoresizingMaskIntoConstraints = false
        sub.text = subTitle
        sub.textColor = mute
        sub.font = UIFont.systemFont(ofSize: 12, weight: .semibold)

        control.translatesAutoresizingMaskIntoConstraints = false
        row.addSubview(titleLabel)
        row.addSubview(sub)
        row.addSubview(control)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 70),
            titleLabel.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            titleLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 14),
            sub.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: control.leadingAnchor, constant: -14),
            sub.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 3),
            control.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            control.centerYAnchor.constraint(equalTo: row.centerYAnchor)
        ])
        return row
    }

    private func watermarkSegmentRow(title: String, segment: UISegmentedControl, subTitle: String) -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = title
        titleLabel.textColor = textColor
        titleLabel.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let sub = UILabel()
        sub.translatesAutoresizingMaskIntoConstraints = false
        sub.text = subTitle
        sub.textColor = mute
        sub.font = UIFont.systemFont(ofSize: 12, weight: .semibold)

        segment.translatesAutoresizingMaskIntoConstraints = false
        segment.selectedSegmentTintColor = UIColor(red: 0.067, green: 0.318, blue: 1.0, alpha: 1.0)

        row.addSubview(titleLabel)
        row.addSubview(sub)
        row.addSubview(segment)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 108),
            titleLabel.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            titleLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 10),
            sub.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            sub.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 4),
            segment.topAnchor.constraint(equalTo: sub.bottomAnchor, constant: 8),
            segment.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
            segment.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            segment.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -10)
        ])
        return row
    }

    @objc private func watermarkSegmentChanged(_ sender: UISegmentedControl) {
        usingCustomWatermarkTextColor = false
        refreshWatermarkPreview()
    }

    @objc private func watermarkCustomTextColorChanged() {
        usingCustomWatermarkTextColor = true
        refreshWatermarkPreview()
    }

    @objc private func watermarkSettingChanged() {
        refreshWatermarkPreview()
    }

    @objc private func watermarkFontScaleChanged() {
        watermarkFontScaleValueLabel.text = String(format: "x%.2f", watermarkFontScaleSlider.value)
        refreshWatermarkPreview()
    }

    @objc private func watermarkBackgroundAlphaChanged() {
        watermarkBackgroundAlphaValueLabel.text = String(format: "%.0f%%", watermarkBackgroundAlphaSlider.value * 100)
        refreshWatermarkPreview()
    }

    @objc private func syncSliderChanged() {
        let value = Int(min(3599, max(5, round(Double(syncSlider.value)))))
        syncIntervalField.text = "\(value)"
    }

    private func watermarkFontScale() -> CGFloat {
        CGFloat(max(0.6, min(2.0, Double(watermarkFontScaleSlider.value))))
    }

    private func watermarkOverlayY(contentHeight: CGFloat, footerHeight: CGFloat) -> CGFloat {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.watermarkPosition) ?? WatermarkPosition.bottom.rawValue
        let position = WatermarkPosition(rawValue: raw) ?? .bottom
        switch position {
        case .top:
            return 0
        case .center:
            return max(0, (contentHeight - footerHeight) / 2)
        case .bottom:
            return max(0, contentHeight - footerHeight)
        }
    }

    private func watermarkBackgroundColor() -> UIColor {
        let raw = UserDefaults.standard.string(forKey: PreviewSettingsKey.watermarkBackgroundColor) ?? WatermarkBackgroundColorPreset.black.rawValue
        return WatermarkBackgroundColorPreset.from(raw: raw).color
    }

    private func watermarkBackgroundAlpha() -> CGFloat {
        let value = UserDefaults.standard.object(forKey: PreviewSettingsKey.watermarkBackgroundAlpha) as? Double ?? 0.5
        return CGFloat(min(1, max(0, value)))
    }

    private func adjustedWatermarkFontSize(
        for text: String,
        width: CGFloat,
        maxHeight: CGFloat,
        minFontSize: CGFloat,
        maxFontSize: CGFloat
    ) -> CGFloat {
        var fontSize = maxFontSize
        while fontSize > minFontSize {
            if measuredWatermarkHeight(for: text, width: width, fontSize: fontSize) + 14 <= maxHeight {
                break
            }
            fontSize = max(minFontSize, fontSize - 0.5)
        }
        return max(minFontSize, fontSize)
    }

    private func watermarkAttributes(fontSize: CGFloat) -> [NSAttributedString.Key: Any] {
        [
            .font: UIFont.monospacedSystemFont(ofSize: fontSize, weight: .semibold),
            .foregroundColor: watermarkTextColorCurrent(),
            .paragraphStyle: paragraphStyle(fontSize: fontSize),
            .strokeWidth: -2.0,
            .strokeColor: UIColor.black
        ]
    }

    private func measuredWatermarkHeight(for text: String, width: CGFloat, fontSize: CGFloat) -> CGFloat {
        let measured = (text as NSString).boundingRect(
            with: CGSize(width: max(width - 16, 80), height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin],
            attributes: watermarkAttributes(fontSize: fontSize),
            context: nil
        ).height
        return ceil(max(measured, fontSize + 4))
    }

    private func paragraphStyle(fontSize: CGFloat) -> NSMutableParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.alignment = .left
        style.minimumLineHeight = floor(fontSize + 2)
        style.maximumLineHeight = floor(fontSize + 5)
        style.lineHeightMultiple = 1.04
        style.lineBreakMode = .byWordWrapping
        return style
    }

    private func watermarkTextColorRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "텍스트 색상"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let sub = UILabel()
        sub.translatesAutoresizingMaskIntoConstraints = false
        sub.text = "워터마크 텍스트 색상(프리셋/직접 선택)"
        sub.textColor = mute
        sub.font = UIFont.systemFont(ofSize: 12, weight: .semibold)

        let controlRow = UIStackView()
        controlRow.translatesAutoresizingMaskIntoConstraints = false
        controlRow.axis = .horizontal
        controlRow.spacing = 10
        controlRow.alignment = .center

        controlRow.addArrangedSubview(watermarkTextColorSegment)
        if #available(iOS 14.0, *) {
            watermarkTextColorWell.translatesAutoresizingMaskIntoConstraints = false
            watermarkTextColorWell.supportsAlpha = false
            watermarkTextColorWell.layer.cornerRadius = 16
            controlRow.addArrangedSubview(watermarkTextColorWell)
            NSLayoutConstraint.activate([
                watermarkTextColorWell.widthAnchor.constraint(equalToConstant: 32),
                watermarkTextColorWell.heightAnchor.constraint(equalToConstant: 32)
            ])
        }

        row.addSubview(title)
        row.addSubview(sub)
        row.addSubview(controlRow)

        watermarkTextColorSegment.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 126),
            title.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 10),
            sub.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            sub.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 4),
            controlRow.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
            controlRow.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -14),
            controlRow.topAnchor.constraint(equalTo: sub.bottomAnchor, constant: 8),
            controlRow.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -10)
        ])
        return row
    }

    private func watermarkTextColorCurrent() -> UIColor {
        if usingCustomWatermarkTextColor, #available(iOS 14.0, *) {
            return watermarkTextColorWell.selectedColor ?? .systemRed
        }
        let index = max(0, min(watermarkTextColorSegment.selectedSegmentIndex, WatermarkTextColorPreset.allCases.count - 1))
        return WatermarkTextColorPreset.from(index: index).color
    }

    private func watermarkPreviewSampleText() -> String {
        var sample: [String] = []
        if watermarkDateSwitch.isOn {
            sample.append("[2026-06-23 12:34:56]")
        }
        if watermarkAddressSwitch.isOn {
            sample.append("도로명주소: 대한민국 서울특별시 용산구 한남동 1-1번지")
        }
        if watermarkCoordinateSwitch.isOn {
            sample.append("위도/경도: 37.534000, 127.001200")
        }
        sample.append("기기: iPhone 16 Pro / iOS 17.6")
        return sample.joined(separator: "\n")
    }

    private func watermarkPreviewImage() -> UIImage {
        let size = CGSize(width: 520, height: 260)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            UIColor(white: 0.9, alpha: 1).setFill()
            UIRectFill(CGRect(origin: .zero, size: size))

            let text = watermarkPreviewSampleText()
            if text.isEmpty {
                return
            }
            let fontScale = watermarkFontScale()
            let availableWidth = size.width - 24
            let maxFont = max(14.0, min(30.0, min(size.width, size.height) * 0.04))
            let fontSize = adjustedWatermarkFontSize(
                for: text,
                width: availableWidth,
                maxHeight: (min(size.height * 0.36, 320.0) - 14),
                minFontSize: max(10, 12 * fontScale),
                maxFontSize: maxFont * fontScale
            )
            let textHeight = measuredWatermarkHeight(for: text, width: availableWidth, fontSize: fontSize)
            let footerHeight = min(min(size.height * 0.36, 320.0), max(64, ceil(textHeight + 14)))
            let footerY = watermarkOverlayY(contentHeight: size.height, footerHeight: footerHeight)

            let bgRect = CGRect(x: 0, y: footerY, width: size.width, height: footerHeight)
            watermarkBackgroundColor().withAlphaComponent(watermarkBackgroundAlpha()).setFill()
            UIRectFill(bgRect)

            let textColor = watermarkTextColorCurrent()
            (text as NSString).draw(
                with: CGRect(x: 8, y: footerY + 8, width: size.width - 16, height: footerHeight - 16),
                options: [.usesLineFragmentOrigin],
                attributes: [
                    .font: UIFont.monospacedSystemFont(ofSize: fontSize, weight: .medium),
                    .foregroundColor: textColor,
                    .paragraphStyle: paragraphStyle(fontSize: fontSize)
                ],
                context: nil
            )
        }
    }

    private func refreshWatermarkPreview() {
        watermarkPreviewImageView.image = watermarkPreviewImage()
        watermarkPreviewImageView.contentMode = .scaleAspectFit
        watermarkPreviewImageView.layer.cornerRadius = 16
        watermarkPreviewImageView.clipsToBounds = true
    }

    private func watermarkPreviewRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        watermarkPreviewImageView.translatesAutoresizingMaskIntoConstraints = false
        watermarkPreviewImageView.image = watermarkPreviewImage()
        watermarkPreviewImageView.contentMode = .scaleAspectFit
        watermarkPreviewImageView.clipsToBounds = true
        watermarkPreviewImageView.layer.cornerRadius = 12
        watermarkPreviewImageView.backgroundColor = .clear

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "워터마크 실시간 미리보기"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 14, weight: .black)

        row.addSubview(title)
        row.addSubview(watermarkPreviewImageView)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 310),
            title.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 10),
            watermarkPreviewImageView.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            watermarkPreviewImageView.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 12),
            watermarkPreviewImageView.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -12),
            watermarkPreviewImageView.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -12)
        ])
        return row
    }

    private static func encodeHex(from color: UIColor) -> String? {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        guard color.getRed(&r, green: &g, blue: &b, alpha: &a) else { return nil }
        let ri = Int(round(r * 255))
        let gi = Int(round(g * 255))
        let bi = Int(round(b * 255))
        return String(format: "%02X%02X%02X", ri, gi, bi)
    }

    private static func decodeHexColor(from hex: String?) -> UIColor? {
        decodeColor(fromHex: hex)
    }

    private static func decodeColor(fromHex hex: String?) -> UIColor? {
        guard let value = hex else { return nil }
        var cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("#") {
            cleaned.removeFirst()
        }
        guard (cleaned.count == 6 || cleaned.count == 8), let num = Int64(cleaned, radix: 16) else {
            return nil
        }
        let r = CGFloat((num >> 16) & 0xFF) / 255.0
        let g = CGFloat((num >> 8) & 0xFF) / 255.0
        let b = CGFloat(num & 0xFF) / 255.0
        let a: CGFloat = cleaned.count == 8 ? CGFloat((num >> 24) & 0xFF) / 255.0 : 1.0
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }


    private func watermarkSliderRow(title: String, subTitle: String, slider: UISlider, valueLabel: UILabel) -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = title
        titleLabel.textColor = textColor
        titleLabel.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let sub = UILabel()
        sub.translatesAutoresizingMaskIntoConstraints = false
        sub.text = subTitle
        sub.textColor = mute
        sub.font = UIFont.systemFont(ofSize: 12, weight: .semibold)

        valueLabel.translatesAutoresizingMaskIntoConstraints = false

        slider.translatesAutoresizingMaskIntoConstraints = false
        row.addSubview(titleLabel)
        row.addSubview(sub)
        row.addSubview(slider)
        row.addSubview(valueLabel)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 96),
            titleLabel.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            titleLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 12),
            sub.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            sub.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 4),
            valueLabel.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            valueLabel.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            slider.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            slider.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            slider.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -12)
        ])
        return row
    }

    private func switchRow() -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        applyGlass(to: row, cornerRadius: 24)

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "자동 수집"
        title.textColor = textColor
        title.font = UIFont.systemFont(ofSize: 16, weight: .black)

        let sub = UILabel()
        sub.translatesAutoresizingMaskIntoConstraints = false
        sub.text = "앱 실행 시 생체 데이터 수집 상태를 유지합니다."
        sub.textColor = mute
        sub.font = UIFont.systemFont(ofSize: 12, weight: .semibold)

        autoSwitch.translatesAutoresizingMaskIntoConstraints = false
        row.addSubview(title)
        row.addSubview(sub)
        row.addSubview(autoSwitch)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 70),
            title.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 18),
            title.topAnchor.constraint(equalTo: row.topAnchor, constant: 14),
            sub.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            sub.trailingAnchor.constraint(equalTo: autoSwitch.leadingAnchor, constant: -14),
            sub.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 3),
            autoSwitch.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -18),
            autoSwitch.centerYAnchor.constraint(equalTo: row.centerYAnchor)
        ])
        return row
    }

    @objc private func save() {
        view.endEditing(true)
        let defaults = UserDefaults.standard
        defaults.set(workerField.text ?? "", forKey: PreviewSettingsKey.workerName)
        defaults.set(employeeField.text ?? "", forKey: PreviewSettingsKey.employeeId)
        defaults.set(DashboardSyncService.shared.normalizedEndpoint(from: endpointField.text), forKey: PreviewSettingsKey.endpoint)
        defaults.set(appUploadTokenField.text ?? "", forKey: vitalGuardUploadTokenDefaultsKey)
        defaults.set(dashboardAdminIdField.text ?? "", forKey: PreviewSettingsKey.dashboardAdminId)
        DashboardCredentialStore.savePassword(dashboardAdminPasswordField.text ?? "")
        let entered = Double(syncIntervalField.text ?? "") ?? Double(syncSlider.value)
        defaults.set(min(3599, max(5, entered.rounded())), forKey: PreviewSettingsKey.syncInterval)
        defaults.set(autoSwitch.isOn, forKey: PreviewSettingsKey.autoCollection)
        defaults.set(IntroGuideMode.saved.rawValue, forKey: PreviewSettingsKey.introGuideMode)

        defaults.set(watermarkDateSwitch.isOn, forKey: PreviewSettingsKey.watermarkShowDate)
        defaults.set(watermarkAddressSwitch.isOn, forKey: PreviewSettingsKey.watermarkShowAddress)
        defaults.set(watermarkCoordinateSwitch.isOn, forKey: PreviewSettingsKey.watermarkShowCoordinate)

        let positionIndex = max(0, min(watermarkPositionSegment.selectedSegmentIndex, WatermarkPosition.allCases.count - 1))
        defaults.set(WatermarkPosition.from(index: positionIndex).rawValue, forKey: PreviewSettingsKey.watermarkPosition)

        let textColorIndex = max(0, min(watermarkTextColorSegment.selectedSegmentIndex, WatermarkTextColorPreset.allCases.count - 1))
        if usingCustomWatermarkTextColor,
           let selectedCustom = Self.encodeHex(from: watermarkTextColorWell.selectedColor ?? WatermarkTextColorPreset.red.color) {
            defaults.set("custom", forKey: PreviewSettingsKey.watermarkTextColor)
            defaults.set(selectedCustom, forKey: PreviewSettingsKey.watermarkTextColorCustom)
        } else {
            defaults.set(WatermarkTextColorPreset.from(index: textColorIndex).rawValue, forKey: PreviewSettingsKey.watermarkTextColor)
            defaults.removeObject(forKey: PreviewSettingsKey.watermarkTextColorCustom)
        }

        let bgColorIndex = max(0, min(watermarkBackgroundColorSegment.selectedSegmentIndex, WatermarkBackgroundColorPreset.allCases.count - 1))
        defaults.set(WatermarkBackgroundColorPreset.from(index: bgColorIndex).rawValue, forKey: PreviewSettingsKey.watermarkBackgroundColor)

        defaults.set(Double(watermarkFontScaleSlider.value), forKey: PreviewSettingsKey.watermarkFontScale)
        defaults.set(Double(watermarkBackgroundAlphaSlider.value), forKey: PreviewSettingsKey.watermarkBackgroundAlpha)

        PhoneWatchBridge.shared.publishCurrentSession()
        onSave?()
        dismiss(animated: true)
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        if textField === endpointField {
            endpointField.text = DashboardSyncService.shared.normalizedEndpoint(from: endpointField.text)
        }
        return true
    }

    @objc private func keyboardFrameChanged(_ notification: Notification) {
        guard let userInfo = notification.userInfo else { return }
        let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? TimeInterval ?? 0.25
        let frame = (userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect) ?? .zero
        let converted = view.convert(frame, from: nil)
        let overlap = max(0, view.bounds.maxY - converted.minY)
        UIView.animate(withDuration: duration) {
            self.scrollView.contentInset.bottom = overlap + 24
            self.scrollView.verticalScrollIndicatorInsets.bottom = overlap + 24
        }
    }

    @objc private func themeModeTapped(_ sender: UIButton) {
        let mode = PreviewThemeMode.allCases[min(sender.tag, PreviewThemeMode.allCases.count - 1)]
        UserDefaults.standard.set(mode.rawValue, forKey: PreviewSettingsKey.themeMode)
        applySavedTheme()
        buildForm()
        onThemeChange?()
    }

    @objc private func themeModeSegmentChanged(_ sender: UISegmentedControl) {
        let index = max(0, min(sender.selectedSegmentIndex, PreviewThemeMode.allCases.count - 1))
        let mode = PreviewThemeMode.allCases[index]
        UserDefaults.standard.set(mode.rawValue, forKey: PreviewSettingsKey.themeMode)
        applySavedTheme()
        buildForm()
        onThemeChange?()
    }

    @objc private func introGuideModeSegmentChanged(_ sender: UISegmentedControl) {
        let mode = IntroGuideMode.from(index: sender.selectedSegmentIndex)
        UserDefaults.standard.set(mode.rawValue, forKey: PreviewSettingsKey.introGuideMode)
        NotificationCenter.default.post(name: .vitalGuardIntroGuideModeChanged, object: nil)
        buildForm()
    }

    @objc private func openHomeLayout() {
        let modeRaw = VitAlGuardSharedStorage.loadAppMode()?.rawValue
            ?? UserDefaults.standard.string(forKey: PreviewSettingsKey.appMode)
            ?? AppMode.admin.rawValue
        let mode = AppMode(rawValue: modeRaw) ?? .admin
        let controller = HomeLayoutViewController(mode: mode)
        controller.overrideUserInterfaceStyle = savedThemeMode.interfaceStyle
        controller.onSave = { [weak self] in
            self?.onLayoutChange?()
        }
        navigationController?.pushViewController(controller, animated: true)
    }

    @objc private func close() {
        dismiss(animated: true)
    }

private func applyGlass(to view: UIView, cornerRadius: CGFloat) {
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: isDarkTheme ? .systemThinMaterialDark : .systemThinMaterialLight))
        blur.translatesAutoresizingMaskIntoConstraints = false
        blur.isUserInteractionEnabled = false
        blur.layer.cornerRadius = cornerRadius
        blur.layer.cornerCurve = .continuous
        blur.clipsToBounds = true
        view.insertSubview(blur, at: 0)

        NSLayoutConstraint.activate([
            blur.topAnchor.constraint(equalTo: view.topAnchor),
            blur.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            blur.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            blur.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        view.backgroundColor = fieldColor
        view.layer.cornerRadius = cornerRadius
        view.layer.cornerCurve = .continuous
        view.layer.borderColor = glassStroke.cgColor
        view.layer.borderWidth = 0.6
        view.clipsToBounds = true
    }
}

private extension UIImage {
    var cgOrientation: CGImagePropertyOrientation {
        switch imageOrientation {
        case .up:
            return .up
        case .upMirrored:
            return .upMirrored
        case .down:
            return .down
        case .downMirrored:
            return .downMirrored
        case .left:
            return .left
        case .leftMirrored:
            return .leftMirrored
        case .right:
            return .right
        case .rightMirrored:
            return .rightMirrored
        @unknown default:
            return .up
        }
    }
}
