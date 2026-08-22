// iOS 위치 수집부 — 현장 경계 감시(region monitoring) + 근무 중 저전력 추적. 좌표는 생체 샘플에 실려 나간다.
//
// 왜 이 구조인가(2026-08-16 실측 · docs/gps-phone-collection/context-notes.md).
//  ① 신규 앱에는 위치 코드가 한 줄도 없었다 — DB 기준 08-01 이후 GPS 0건이고, 그래서 관제
//     지도·구획 이탈·동선이 통째로 무동작이었다. 서버 스키마·DB 컬럼·판정은 전부 살아 있으므로
//     여기서 **생산자만 복구**한다.
//  ② 경계 감시가 핵심이다 — 앱이 GPS 를 계속 돌리는 것이 아니라 **OS 가 원을 감시하다 벗어날 때만
//     앱을 깨운다.** iOS 에서 지오펜스를 하는 가장 싼 방법이고, watchOS 에는 이 수단이 아예 없다
//     (구 앱 WorkoutManager 주석: "watchOS는 지역 이탈 콜백을 제공하지 않으므로 거리 필터를 쓴다").
//     폰으로 모으기로 한 이유의 절반이 이것이다.
//
// ★ 정확도 등급을 올리지 않는다. `kCLLocationAccuracyBest`/`BestForNavigation` 은 GNSS 상시 구동이라
//   배터리 축이 통째로 달라진다. 100m 구획 판정에 그 정밀도가 필요하지 않다.
//   가드(2026-08-16-phone-location-low-power.guard.test.ts)가 승격을 막는다.
import CoreLocation
import Foundation
import os

final class LocationProvider: NSObject {
    static let shared = LocationProvider()

    private let log = Logger(subsystem: "com.vitalguard.vitalguardApp", category: "Location")

    // MARK: - 정책 상수

    /// 관제구역 반경 상한(m). ⚠ 관제웹 `lib/site-radius.ts` 의 `SITE_RADIUS_MAX_M` 과 **같은 값이어야** 한다.
    /// 구 앱은 단말 500m · 관제 100m 로 5배 어긋나 있어서, 100m 원을 벗어나도 500m 를 안 넘으면
    /// 좌표가 안 올라와 이탈이 잡히지 않았다. 두 숫자를 가드가 묶어 고정한다.
    static let siteRadiusMaxM: CLLocationDistance = 100
    /// 관제구역 반경 하한(m). 이보다 좁으면 coarse 측위(±100m 등급) 오차가 반경을 넘어
    /// 가만히 있어도 들락날락하는 이탈 오탐이 된다.
    static let siteRadiusMinM: CLLocationDistance = 50

    /// 좌표 신선도 상한(초). 이보다 묵은 fix 는 **아예 싣지 않는다**.
    ///
    /// ★ 이것이 없으면 마지막 좌표가 모든 샘플에 영원히 찍힌다 — 작업자가 두 시간 전에 떠난 자리에
    ///   계속 서 있는 것으로 보인다. 워치 하트비트가 12시간 34분 동안 102bpm 을 복사한 것과 **같은
    ///   형태**이고 `heartbeatMaxAge` 와 같은 처방이다. 구 앱 폰도 300초를 썼다
    ///   (VitAlGuardPreviewApp.swift:3917) — 단 사고 이벤트엔 예외를 뒀고 그 경로로 7.7시간 된
    ///   좌표가 실제로 올라왔다. 이 앱에는 사고 스냅샷 경로가 없으므로 **예외 없이** 적용한다.
    private static let maxFixAgeSec: TimeInterval = 300

    /// 정지 중 좌표 유지 — fix 가 이만큼 묵으면 **직접 한 건 요청한다**(초).
    ///
    /// ★ 왜 필요한가(2026-08-20 프로덕션 실측 · docs/gps-phone-collection/checklist.md).
    ///   `distanceFilter` 100m 라 정지 상태에서는 새 fix 가 오지 않고, 그 상태로 300초가 지나면
    ///   `currentFix()` 가 nil 이 된다 ⟹ **앉아 있으면 좌표가 5분마다 끊긴다.**
    ///   14시간 5,586건 중 좌표가 실린 행은 1,407건(25.1%)뿐이었고, 좌표가 1개뿐인(=정지) 구간
    ///   길이가 `300·305·295·305·290·305·296·293초` 로 상한에 정확히 붙었다.
    ///   설계는 의도대로 동작한 것이지만 그 결과가 관제 지도를 하루의 3/4 동안 비웠다.
    ///
    /// ⚠ `maxFixAgeSec` 을 늘려서 풀지 않는다 — 그러면 두 시간 전에 떠난 자리에 서 있는 것으로
    ///   보인다(위 주석의 하트비트 사고와 같은 형태). **묵기 전에 새것을 받아오는** 쪽으로 푼다.
    ///   그래서 이 값은 반드시 `maxFixAgeSec` 보다 작아야 하고, 가드가 그 관계를 고정한다.
    private static let fixRefreshAfterSec: TimeInterval = 240

    /// 갱신 요청 사이 최소 간격(초). 실내처럼 요청이 계속 실패하는 곳에서 생체가 올 때마다
    /// (=5초마다) GPS 를 때리지 않게 막는다. 실패해도 이 간격만큼은 쉰다.
    private static let fixRefreshMinGapSec: TimeInterval = 60

    /// 갱신 요청 타임아웃(초). 촬영 경로와 같은 값 — 같은 `OneShotLocator` 를 쓴다.
    private static let fixRefreshTimeoutSec: TimeInterval = 12

    /// 생체가 이만큼 끊기면 추적을 멈춘다(초). 워치는 분당 12건을 보내므로 120초면 넉넉하다.
    ///
    /// ★ "근무 중"의 정의다. 이 앱에도 관제웹에도 근무 시간(work hours) 개념이 없어서(grep 0건)
    ///   새로 만들면 현장마다 다른 값이 된다. 대신 앱이 이미 아는 신호를 쓴다 —
    ///   **워치 생체가 들어오는 동안이 근무 중**이다. 워치를 벗으면 추적도 멈춘다.
    ///   ⚠ 한계: 워치를 차고 퇴근하면 그 구간도 추적된다. 근무 시간대 개념이 생기면 좁힌다.
    private static let vitalIdleStopSec: TimeInterval = 120

    private static let regionId = "com.vitalguard.site-boundary"
    private static let anchorLatKey = "vg.site.anchorLat"
    private static let anchorLonKey = "vg.site.anchorLon"
    private static let anchorDayKey = "vg.site.anchorDay"

    // MARK: - 상태

    private let manager = CLLocationManager()
    /// 델리게이트(메인)와 업로드 파이프라인(직렬 큐)이 함께 읽으므로 잠근다.
    private let lock = NSLock()
    private var latestFix: CLLocation?
    private var lastVitalAt: Date?
    private var tracking = false
    /// 마지막으로 정지 중 갱신을 **요청한** 시각(성공 여부와 무관). 요청 폭주를 막는 기준.
    private var lastFixRefreshAt: Date?

    private lazy var isoMs: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private override init() { super.init() }

    // MARK: - 기동

    func start() {
        DispatchQueue.main.async {
            self.manager.delegate = self
            // 저전력 3종 — 구 앱 폰 설정을 그대로 계승한다(VitAlGuardPreviewApp.swift:7072~7075).
            self.manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            self.manager.distanceFilter = Self.siteRadiusMaxM
            self.manager.pausesLocationUpdatesAutomatically = true
            // 근무 중 배경 추적이라 파란 알약을 띄우지 않는다(작업 방해).
            self.manager.showsBackgroundLocationIndicator = false
            self.requestAuthorizationIfNeeded()
        }
    }

    /// 워치 생체가 도착할 때마다 호출된다 — "근무 중"의 유일한 판정 입력.
    func noteVitalsActive() {
        lock.lock()
        lastVitalAt = Date()
        let needStart = !tracking
        // 정지 중 갱신은 추적이 이미 돌고 있어도 필요하다 — `distanceFilter` 가 새 fix 를 막는 것이지
        // 추적이 꺼진 것이 아니다. 그래서 `needStart` 와 **독립으로** 판단한다.
        let needRefresh = shouldRefreshFixLocked()
        lock.unlock()
        if needStart { DispatchQueue.main.async { self.startTracking() } }
        if needRefresh { DispatchQueue.main.async { self.refreshFixWhileStationary() } }
    }

    /// 업로드 페이로드에 실을 좌표. **신선한 fix 가 없으면 nil** — 묵은 값을 채우지 않는다.
    func currentFix() -> [String: Any]? {
        lock.lock()
        let fix = latestFix
        lock.unlock()
        guard let fix else { return nil }
        guard Date().timeIntervalSince(fix.timestamp) <= Self.maxFixAgeSec else { return nil }
        return payload(from: fix)
    }

    /// 촬영 각인용 **일회성** 좌표. 추적 상태와 무관하게 지금 한 건을 받아온다.
    ///
    /// ★ 왜 `currentFix()` 로 안 되는가 — 두 상수가 정지 상태에서 새 fix 를 원천 차단한다.
    ///   `distanceFilter` 100m (실측 fix 간 124·147·105·100m) 라 책상에 둔 폰은 갱신이 없고,
    ///   `maxFixAgeSec` 300초가 지나면 `currentFix()` 가 nil 을 돌려준다(실측 295·295·210초).
    ///   ⟹ 사진에 좌표를 찍으려면 **그 순간 요청**하는 길밖에 없다(2026-08-19 실측·옆 세션 교차확인).
    ///
    /// ⚠ `didExitRegion` 의 `if !running { requestLocation() }` 를 복사하지 말 것 —
    ///   그 가드는 추적 중이면 요청을 건너뛴다. 촬영은 근무 중에도 눌리므로 조건 없이 요청한다.
    ///
    /// ⚠ 추적용 `manager` 를 쓰지 않는다. 정확도·거리필터가 달라 근무 중 추적 설정이 흔들리고,
    ///   `didUpdateLocations` 의 유휴 판정(`stopTracking`)이 촬영 때문에 오발동한다.
    ///
    /// 최근 fix 가 [freshEnoughSec] 이내면 GPS 를 돌리지 않고 그것을 쓴다(배터리·지연 절약).
    ///
    /// ⚠ 기본값 60초·8초로 시작했다가 **실내·지하에서 좌표가 통째로 비었다**(2026-08-19 실측 —
    ///   지하주차장 18:40·실내 18:41 두 장 모두 각인이 `위치 미확보`, 같은 날 실외 17:16·23:38 은 성공).
    ///   창을 300초로 넓힌 이유는 [cachedFix] 주석 참조. 오래된 좌표를 쓰면 **각인이 나이를 밝힌다**.
    func requestFreshFix(
        freshEnoughSec: TimeInterval = 300,
        timeout: TimeInterval = 12,
        completion: @escaping ([String: Any]?) -> Void
    ) {
        // `oneShot` 접근을 전부 메인으로 모은다 — CLLocationManager 는 런루프가 있는 스레드에서 다룬다.
        DispatchQueue.main.async {
            if let cached = self.cachedFix(within: freshEnoughSec) {
                completion(self.payload(from: cached))
                return
            }
            self.oneShot.request(timeout: timeout) { [weak self] loc in
                guard let self else { completion(nil); return }
                guard let loc else {
                    // 실내·지하에서는 새 fix 가 아예 안 온다. 여기서 포기하면 각인이 빈다 —
                    // 마지막으로 알던 좌표를 같은 신선도 기준으로 한 번 더 본다.
                    completion(self.cachedFix(within: freshEnoughSec).map { self.payload(from: $0) })
                    return
                }
                // 받은 fix 는 추적 경로와 같은 품질 기준을 통과할 때만 캐시에 반영한다.
                if loc.horizontalAccuracy > 0, loc.horizontalAccuracy <= Self.siteRadiusMaxM {
                    self.lock.lock()
                    self.latestFix = loc
                    self.lock.unlock()
                }
                // ★ 새로 받았다고 그냥 쓰지 않는다 — 이 경로에만 품질 판단이 없어서
                //   2026-08-20 에 336m 짜리가 149m 짜리를 밀어냈다. 갖고 있는 것과 **재서 고른다**.
                // ⚠ 거르지 않는다. 나쁘면 나쁜 대로 각인하고 ±로 밝힌다 —
                //   여기서 nil 을 내면 2026-08-19 의 "위치 미확보" 로 되돌아간다.
                let now = Date()
                let best = [loc, self.cachedFix(within: freshEnoughSec)]
                    .compactMap { $0 }
                    .min { Self.effectiveRadiusM($0, at: now) < Self.effectiveRadiusM($1, at: now) }
                completion(self.payload(from: best ?? loc))
            }
        }
    }

    /// [maxAgeSec] 이내의 마지막 좌표. 추적이 채운 `latestFix` 와 **iOS 가 앱과 무관하게 들고 있는
    /// 마지막 좌표**(`CLLocationManager.location`) 중 더 최근 것을 고른다.
    ///
    /// ★ 후자가 실내 대책의 핵심이다 — 건물에 들어서기 직전의 실외 fix 가 시스템에 남아 있어,
    ///   지하에서 새 요청이 실패해도 "그 건물" 은 가리킬 수 있다. 우리 `latestFix` 는 추적이 꺼져
    ///   있으면 아예 비어 있으므로 그것만으로는 못 채운다.
    /// ⚠ 메인 스레드에서만 부른다(`oneShot` 을 만진다).
    private func cachedFix(within maxAgeSec: TimeInterval) -> CLLocation? {
        lock.lock()
        let mine = latestFix
        lock.unlock()
        let now = Date()
        return [mine, oneShot.lastKnown]
            .compactMap { $0 }
            .filter { now.timeIntervalSince($0.timestamp) <= maxAgeSec }
            .min { Self.effectiveRadiusM($0, at: now) < Self.effectiveRadiusM($1, at: now) }
    }

    /// 이 좌표를 **지금** 쓸 때의 불확실성(m) = 측정 정확도 + 그동안 걸어갔을 수 있는 거리.
    ///
    /// ★ 왜 "가장 최근" 도 "가장 정확" 도 아닌가 — 둘 다 실측으로 반증됐다.
    ///   · 최근 우선(종전) → 2026-08-20 18:33, 게이트 미통과 신규가 10m 짜리를 이겨
    ///     각인이 실제에서 336m 어긋났다(그때 폰은 149m 짜리를 들고 있었다).
    ///   · 정확도만 우선 → 2026-08-22 10:17, 그 규칙이면 **5분 전 17.9m** 짜리를 골랐을 텐데
    ///     그것은 촬영 지점에서 95m 떨어져 있었다. 같은 순간의 44.1m 짜리가 6m 였다.
    ///   ⟹ 오래된 좌표는 그 사이 이동한 만큼 더 틀린다. 두 축을 한 자로 합쳐야 한다.
    ///
    /// 보행 1.4m/s 는 상한이다 — 뛰거나 차를 타면 더 틀리지만, 그 경우 GPS 도 갱신되므로
    /// 오래된 fix 가 후보로 남지 않는다. 추측을 키우지 않는 쪽으로 고른다.
    private static let walkSpeedMps: Double = 1.4

    static func effectiveRadiusM(_ fix: CLLocation, at now: Date) -> Double {
        // 음수 정확도 = iOS 가 "모른다" 고 말하는 것이다. 값으로 쓰지 않고 최하위로 민다.
        guard fix.horizontalAccuracy > 0 else { return .greatestFiniteMagnitude }
        let age = max(0, now.timeIntervalSince(fix.timestamp))
        return fix.horizontalAccuracy + age * walkSpeedMps
    }

    private lazy var oneShot = OneShotLocator()

    /// 업로드·각인이 함께 쓰는 좌표 표기. `currentFix()` 와 같은 형식이어야 두 경로가 안 갈린다.
    private func payload(from fix: CLLocation) -> [String: Any] {
        [
            "latitude": (fix.coordinate.latitude * 1_000_000).rounded() / 1_000_000,
            "longitude": (fix.coordinate.longitude * 1_000_000).rounded() / 1_000_000,
            "locationAccuracyMeters": (fix.horizontalAccuracy * 10).rounded() / 10,
            "locationTimestamp": isoMs.string(from: fix.timestamp),
        ]
    }

    /// 설정 화면 진단용 — 권한 등급과 마지막으로 아는 좌표(나이 포함).
    ///
    /// ★ `currentFix()` 와 다르다 — 저것은 300초를 넘으면 nil 을 준다(오래된 좌표를 실어
    ///   보내지 않으려는 규칙). 진단 화면은 **오래됐다는 사실 자체가 정보**라 나이와 함께 그대로 준다.
    func diagnostics() -> [String: Any] {
        let auth: String
        switch manager.authorizationStatus {
        case .notDetermined: auth = "미결정"
        case .restricted: auth = "제한됨"
        case .denied: auth = "거부됨"
        case .authorizedWhenInUse: auth = "앱 사용 중 허용"
        case .authorizedAlways: auth = "항상 허용"
        @unknown default: auth = "알 수 없음"
        }
        var out: [String: Any] = ["locationAuth": auth, "tracking": tracking]
        lock.lock()
        let fix = latestFix
        lock.unlock()
        if let fix {
            out["fixLat"] = (fix.coordinate.latitude * 1_000_000).rounded() / 1_000_000
            out["fixLon"] = (fix.coordinate.longitude * 1_000_000).rounded() / 1_000_000
            out["fixAccM"] = (fix.horizontalAccuracy * 10).rounded() / 10
            out["fixAgeSec"] = Int(Date().timeIntervalSince(fix.timestamp))
        }
        return out
    }

    // MARK: - 내부

    private func requestAuthorizationIfNeeded() {
        switch manager.authorizationStatus {
        case .notDetermined:
            // 경계 감시는 '항상 허용'이라야 배경에서 콜백이 온다. iOS 가 우선 사용 중 허용을 묻고
            // 이후 항상 허용으로 승격을 제안한다.
            manager.requestAlwaysAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            applyAuthorizedState()
        default:
            log.notice("위치 권한 거부·제한 — 좌표 수집 없음(생체 수집은 계속)")
        }
    }

    private func applyAuthorizedState() {
        if manager.authorizationStatus == .authorizedAlways { startBoundaryMonitoring() }
        lock.lock()
        let active = isVitalActiveLocked()
        lock.unlock()
        if active { startTracking() }
    }

    /// 호출자가 lock 을 쥔 상태에서만 부른다.
    private func isVitalActiveLocked() -> Bool {
        guard let at = lastVitalAt else { return false }
        return Date().timeIntervalSince(at) <= Self.vitalIdleStopSec
    }

    /// 정지 중 갱신을 지금 걸어야 하는가. 호출자가 lock 을 쥔 상태에서만 부른다.
    ///
    /// fix 가 아예 없을 때도 true 다 — 추적이 아직 첫 fix 를 못 준 상태(실내 기동 등)가 그렇고,
    /// 그때야말로 직접 요청이 필요하다.
    private func shouldRefreshFixLocked() -> Bool {
        let now = Date()
        if let at = lastFixRefreshAt, now.timeIntervalSince(at) < Self.fixRefreshMinGapSec {
            return false
        }
        guard let fix = latestFix else { return true }
        return now.timeIntervalSince(fix.timestamp) >= Self.fixRefreshAfterSec
    }

    private func startTracking() {
        guard manager.authorizationStatus == .authorizedAlways
            || manager.authorizationStatus == .authorizedWhenInUse else { return }
        lock.lock()
        if tracking { lock.unlock(); return }
        tracking = true
        lock.unlock()
        // ⚠ 이 플래그는 Info.plist 의 UIBackgroundModes 에 `location` 이 있어야 한다 — 없으면 크래시.
        //   근무 중에만 켜고 끝나면 끈다(상시 켜두면 퇴근 후에도 앱이 계속 깨어 있다).
        if manager.authorizationStatus == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        }
        manager.startUpdatingLocation()
        log.notice("근무 중 추적 시작 — 정확도 100m 등급 · 거리필터 \(Self.siteRadiusMaxM, privacy: .public)m")
    }

    private func stopTracking() {
        lock.lock()
        if !tracking { lock.unlock(); return }
        tracking = false
        lock.unlock()
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        // 경계 감시는 남긴다 — OS 가 대신 보는 것이라 앱이 잠들어 있어도 이탈을 놓치지 않는다.
        log.notice("생체 끊김 — 추적 중지(경계 감시는 유지)")
    }

    /// 정지 중 좌표 유지 — 한 건만 받아 `latestFix` 를 갱신한다. **메인에서만 부른다**(`oneShot`).
    ///
    /// ⚠ `requestFreshFix()` 를 재사용하지 않는다. 저것은 캐시가 맞으면 `latestFix` 를 **안 건드리고**
    ///   각인용 페이로드만 돌려주므로, 업로드 경로(`currentFix()`)에는 아무 효과가 없다.
    ///   여기서 필요한 것은 페이로드가 아니라 **캐시에 새 값을 넣는 것**이다.
    ///
    /// ⚠ 촬영 요청과 같은 `oneShot` 을 공유한다. `OneShotLocator.request` 는 앞선 요청을 취소하고
    ///   자기로 대체하므로, 이 갱신이 **촬영 중이면 촬영의 좌표를 뺏는다**(각인이 다시 빈다 —
    ///   2026-08-19 에 고친 바로 그 결함). 그래서 진행 중이면 건너뛴다. 사용자가 누른 촬영이 우선이고,
    ///   갱신은 다음 생체(5초 뒤)에 다시 기회가 온다.
    private func refreshFixWhileStationary() {
        guard manager.authorizationStatus == .authorizedAlways
            || manager.authorizationStatus == .authorizedWhenInUse else { return }
        guard !oneShot.isRequesting else { return }
        lock.lock()
        lastFixRefreshAt = Date()
        lock.unlock()
        oneShot.request(timeout: Self.fixRefreshTimeoutSec) { [weak self] loc in
            guard let self else { return }
            // 실내·지하에서는 새 요청이 실패한다. iOS 가 앱과 무관하게 들고 있는 마지막 좌표라도
            // 채택한다 — 시각이 **실제 측위 시각**이라 `currentFix()` 의 300초 규칙이 그대로 거른다.
            // 즉 묵은 값을 여기서 넣어도 업로드에는 실리지 않는다.
            guard let fix = loc ?? self.oneShot.lastKnown else { return }
            // 추적 경로(`didUpdateLocations`)와 **같은 품질 기준**을 건다. 두 경로가 갈리면
            // 좌표의 의미가 출처마다 달라진다.
            guard fix.horizontalAccuracy > 0, fix.horizontalAccuracy <= Self.siteRadiusMaxM else { return }
            self.lock.lock()
            let newer = self.latestFix.map { fix.timestamp > $0.timestamp } ?? true
            if newer { self.latestFix = fix }
            self.lock.unlock()
            // 그날 첫 fix 가 이 경로로 들어올 수 있다(정지 상태로 기동한 날). 추적 경로와 같이
            // 앵커를 잡아 줘야 구획 감시가 선다.
            if newer { self.anchorIfNeeded(fix) }
        }
    }

    /// 현장 구획 원. 중심 = **그날 첫 유효 fix**(UserDefaults 영속·날짜가 바뀌면 재앵커).
    /// 서버도 `site_coord_daily` 로 그날 최초 좌표 1행만 유지하므로 두 값이 같은 곳을 가리킨다.
    private func anchorIfNeeded(_ fix: CLLocation) {
        let d = UserDefaults.standard
        let today = Self.kstDayKey(fix.timestamp)
        guard d.string(forKey: Self.anchorDayKey) != today else { return }
        d.set(fix.coordinate.latitude, forKey: Self.anchorLatKey)
        d.set(fix.coordinate.longitude, forKey: Self.anchorLonKey)
        d.set(today, forKey: Self.anchorDayKey)
        log.notice("현장 구획 앵커 갱신 — \(today, privacy: .public)")
        startBoundaryMonitoring()
    }

    private func startBoundaryMonitoring() {
        guard manager.authorizationStatus == .authorizedAlways,
              CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        let d = UserDefaults.standard
        guard d.object(forKey: Self.anchorLatKey) != nil,
              d.object(forKey: Self.anchorLonKey) != nil else { return }
        for r in manager.monitoredRegions where r.identifier == Self.regionId {
            manager.stopMonitoring(for: r)
        }
        let center = CLLocationCoordinate2D(
            latitude: d.double(forKey: Self.anchorLatKey),
            longitude: d.double(forKey: Self.anchorLonKey)
        )
        guard CLLocationCoordinate2DIsValid(center) else { return }
        let region = CLCircularRegion(
            center: center,
            radius: Self.clampRadius(Self.siteRadiusMaxM),
            identifier: Self.regionId
        )
        // 이탈만 깨우면 된다 — 복귀는 생체가 계속 오고 있으면 추적이 이미 돌고 있다.
        region.notifyOnExit = true
        region.notifyOnEntry = false
        manager.startMonitoring(for: region)
    }

    /// 관제웹 `clampSiteRadiusM` 과 같은 정책(50~100m).
    static func clampRadius(_ v: CLLocationDistance) -> CLLocationDistance {
        guard v.isFinite else { return siteRadiusMaxM }
        return min(siteRadiusMaxM, max(siteRadiusMinM, v))
    }

    private static func kstDayKey(_ date: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

extension LocationProvider: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        requestAuthorizationIfNeeded()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let fix = locations.last else { return }
        // 음수 정확도 = 측위 실패 표식. 반경보다 나쁜 fix 는 구획 판정을 못 하므로 채택하지 않는다
        // (구 앱 shouldPublishLocation 의 첫 guard 와 같은 취지).
        guard fix.horizontalAccuracy > 0, fix.horizontalAccuracy <= Self.siteRadiusMaxM else { return }
        lock.lock()
        latestFix = fix
        let idle = !isVitalActiveLocked()
        lock.unlock()
        anchorIfNeeded(fix)
        // 생체가 끊겼는데 갱신이 계속 오면 여기서 멈춘다 — 별도 타이머를 두지 않는다.
        if idle { stopTracking() }
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard region.identifier == Self.regionId else { return }
        log.notice("현장 구획 이탈 — 좌표 1회 요청")
        // 앱이 잠들어 있었어도 OS 가 깨워 준 시점이다. 신선한 좌표 한 건을 확보해
        // 관제가 '어디로 벗어났는지'를 받게 한다.
        lock.lock()
        let running = tracking
        lock.unlock()
        if !running { manager.requestLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        log.error("위치 오류 — \(error.localizedDescription, privacy: .public)")
    }
}


/// 일회성 측위기 — 촬영 각인처럼 "지금 한 건" 이 필요한 자리 전용.
///
/// 추적용 매니저와 **분리한다**. 같은 매니저를 쓰면 촬영이 근무 중 추적의 정확도·거리필터를
/// 건드리고, 유휴 판정(`stopTracking`)이 촬영 때문에 오발동한다.
///
/// ⚠ `requestLocation()` 은 결과가 **한 번만** 온다. 실패·무응답이면 델리게이트가 아무것도
///   안 부르는 경우가 있어 **타임아웃을 직접 건다** — 없으면 촬영 화면이 영원히 기다린다.
private final class OneShotLocator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var handler: ((CLLocation?) -> Void)?
    private var timer: DispatchWorkItem?

    override init() {
        super.init()
        manager.delegate = self
        // ⚠ 10m 등급을 요구했다가 실내·지하에서 좌표가 통째로 비었다(2026-08-19 실측).
        //   `requestLocation()` 은 **요구 등급을 만족하는 fix 만** 준다. 실내에서 나오는 Wi-Fi 측위는
        //   보통 30~65m 라 10m 를 영영 못 채우고 타임아웃으로 nil 이 된다.
        //   각인의 목적은 "어느 현장인가" 라 100m 로 충분하다 — 정밀도보다 **확보율**을 택한다.
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// iOS 가 들고 있는 마지막 좌표(앱이 받은 적 없어도 값이 있을 수 있다).
    var lastKnown: CLLocation? { manager.location }

    /// 요청이 진행 중인가. 정지 중 갱신이 **촬영 요청을 취소하지 않도록** 확인하는 데 쓴다
    /// (`request` 는 앞선 요청을 취소하고 자기로 대체한다).
    var isRequesting: Bool { handler != nil }

    func request(timeout: TimeInterval, completion: @escaping (CLLocation?) -> Void) {
        // 앞선 요청이 살아 있으면 그것을 취소하고 새 요청으로 대체한다(중복 호출 방어).
        finish(nil, replacing: true)
        handler = completion
        let t = DispatchWorkItem { [weak self] in self?.finish(nil, replacing: false) }
        timer = t
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: t)
        manager.requestLocation()
    }

    private func finish(_ loc: CLLocation?, replacing: Bool) {
        timer?.cancel()
        timer = nil
        guard let h = handler else { return }
        handler = nil
        if replacing { h(nil) } else { h(loc) }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        finish(locations.last, replacing: false)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(nil, replacing: false)
    }
}
