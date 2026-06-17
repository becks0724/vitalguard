// 워치 인앱 설정 스토어 — 수신 서버 URL + 작업자 프로필(이름/사원번호) 편집·영속
// cloudflared quick tunnel URL 은 세션마다 바뀌므로, 재설치 대신 워치 설정에서 직접 갱신한다.
// 작업자 식별자(workerId)는 사원번호에서 파생 → 대시보드에서 폰/다른 워치와 자동 분리.
import Foundation
import Combine

final class ConnectionSettings: ObservableObject {
    // 기본값 — 빌드 설정(RECEIVER_URL_DEFAULT) 미주입/무효 시의 최종 폴백.
    private static let fallbackURLString =
        "https://recognized-marble-moscow-assisted.trycloudflare.com/api/mock/vital"
    static let defaultWorkerName = "워치PoC"
    static let defaultEmployeeId = "EMP-9001"

    private static let urlKey = "receiverURL"
    private static let nameKey = "workerName"
    private static let empKey = "employeeId"
    // 마지막으로 적용된 번들 기본 URL 의 스탬프. 새 빌드에서 defaultURLString 이 바뀌면(재설치)
    // 저장된 옛 URL 을 자동으로 새 기본값으로 교체 → 터널 회전 후 재설치 시 인앱 수정 없이 즉시 반영.
    private static let urlStampKey = "receiverURLStamp"

    @Published var urlString: String {
        didSet { UserDefaults.standard.set(urlString, forKey: Self.urlKey) }
    }
    @Published var workerName: String {
        didSet { UserDefaults.standard.set(workerName, forKey: Self.nameKey) }
    }
    @Published var employeeId: String {
        didSet { UserDefaults.standard.set(employeeId, forKey: Self.empKey) }
    }

    init() {
        let d = UserDefaults.standard
        let bundledDefaultURL = Self.bundledDefaultURLString()
        Self.migrateDefaultURLIfNeeded(d, bundledDefaultURL: bundledDefaultURL)
        urlString = d.string(forKey: Self.urlKey) ?? bundledDefaultURL
        workerName = d.string(forKey: Self.nameKey) ?? Self.defaultWorkerName
        employeeId = d.string(forKey: Self.empKey) ?? Self.defaultEmployeeId
    }

    // 번들 기본 URL 이 직전 적용본과 다르면(=새 빌드로 교체됨) 저장 URL 을 새 기본값으로 덮어쓴다.
    // 같은 빌드 내에서의 인앱 수동 편집은 스탬프가 일치하므로 보존된다(빌드당 1회만 갱신).
    private static func migrateDefaultURLIfNeeded(
        _ d: UserDefaults,
        bundledDefaultURL: String
    ) {
        if d.string(forKey: urlStampKey) != bundledDefaultURL {
            d.set(bundledDefaultURL, forKey: urlKey)
            d.set(bundledDefaultURL, forKey: urlStampKey)
        }
    }

    // 빌드 설정(RECEIVER_URL_DEFAULT) → Info.plist 경유 기본 URL. 미주입/빈값/미치환 토큰은 폴백.
    static func bundledDefaultURLString() -> String {
        let raw = Bundle.main.object(forInfoDictionaryKey: "ReceiverURLDefault") as? String
        let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !value.isEmpty,
              !value.hasPrefix("$("),
              URL(string: value) != nil
        else { return fallbackURLString }
        return value
    }

    // 트랜스미터가 매 전송 시 최신값을 읽도록 하는 정적 접근(앱 재시작·세션 무관 즉시 반영).
    static func currentURL() -> URL? {
        let s = UserDefaults.standard.string(forKey: urlKey) ?? bundledDefaultURLString()
        return URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func currentWorkerName() -> String {
        (UserDefaults.standard.string(forKey: nameKey) ?? defaultWorkerName)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func currentEmployeeId() -> String {
        (UserDefaults.standard.string(forKey: empKey) ?? defaultEmployeeId)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // workerId = 사원번호(입력 시) / 미입력 시 기본값. 항상 비어있지 않게 보장(스키마 min 1).
    static func currentWorkerId() -> String {
        let emp = currentEmployeeId()
        return emp.isEmpty ? defaultEmployeeId : emp
    }
}
