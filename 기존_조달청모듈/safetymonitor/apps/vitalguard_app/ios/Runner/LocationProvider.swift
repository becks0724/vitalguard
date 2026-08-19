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
        lock.unlock()
        guard needStart else { return }
        DispatchQueue.main.async { self.startTracking() }
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
    func requestFreshFix(
        freshEnoughSec: TimeInterval = 60,
        timeout: TimeInterval = 8,
        completion: @escaping ([String: Any]?) -> Void
    ) {
        lock.lock()
        let fix = latestFix
        lock.unlock()
        if let fix, Date().timeIntervalSince(fix.timestamp) <= freshEnoughSec {
            completion(payload(from: fix))
            return
        }
        DispatchQueue.main.async {
            self.oneShot.request(timeout: timeout) { [weak self] loc in
                guard let self, let loc else { completion(nil); return }
                // 받은 fix 는 추적 경로와 같은 품질 기준을 통과할 때만 캐시에 반영한다.
                if loc.horizontalAccuracy > 0, loc.horizontalAccuracy <= Self.siteRadiusMaxM {
                    self.lock.lock()
                    self.latestFix = loc
                    self.lock.unlock()
                }
                completion(self.payload(from: loc))
            }
        }
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
        // 각인은 "어느 현장인가" 가 아니라 "어디서 찍었나" 라 추적보다 정확도를 올린다.
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

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
