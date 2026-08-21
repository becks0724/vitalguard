// Flutter UI ↔ 네이티브 브리지 — 관제웹 계정 로그인(JWT 발급·Keychain 저장)과 파이프라인 상태 조회를 담당한다
import Flutter
import Foundation
import Photos
import Security

// JWT 는 Keychain, 사번·이름 등 비밀 아닌 값은 UserDefaults 에 둔다.
enum AuthStore {
    private static let service = "com.vitalguard.vitalguardApp"
    private static let account = "app-jwt"

    static var token: String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func saveToken(_ token: String) {
        clearToken()
        let attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func clearToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    static var workerId: String? {
        get { UserDefaults.standard.string(forKey: "auth.workerId") }
        set { UserDefaults.standard.set(newValue, forKey: "auth.workerId") }
    }

    static var userName: String? {
        get { UserDefaults.standard.string(forKey: "auth.userName") }
        set { UserDefaults.standard.set(newValue, forKey: "auth.userName") }
    }

    /// 로그인 ID(관제웹과 같은 계정 아이디 · JWT `sub`).
    ///
    /// ★ 사번(`workerId`)과 **다른 값**이다 — 관제는 `admin6861`, 사번은 `EMP-6861`.
    ///   댓글 작성자(`author_id`)는 서버가 로그인 ID 로 적으므로, "내 댓글인가" 판정에는
    ///   사번이 아니라 이것을 써야 한다. 사번으로 비교하면 내 댓글도 남의 것으로 보인다.
    static var loginId: String? {
        get { UserDefaults.standard.string(forKey: "auth.loginId") }
        set { UserDefaults.standard.set(newValue, forKey: "auth.loginId") }
    }

    /// 마지막으로 로그인에 성공한 사번 — 계정 교체 감지용이라 로그아웃(clearAll)에도 지우지 않는다.
    static var lastWorkerId: String? {
        get { UserDefaults.standard.string(forKey: "auth.lastWorkerId") }
        set { UserDefaults.standard.set(newValue, forKey: "auth.lastWorkerId") }
    }

    static func clearAll() {
        clearToken()
        UserDefaults.standard.removeObject(forKey: "auth.workerId")
        UserDefaults.standard.removeObject(forKey: "auth.userName")
        UserDefaults.standard.removeObject(forKey: "auth.loginId")
    }
}

final class VitalBridge: NSObject {
    static let shared = VitalBridge()
    private override init() {}

    private var eventSink: FlutterEventSink?

    func attach(messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "vitalguard/bridge", binaryMessenger: messenger)
        channel.setMethodCallHandler { [weak self] call, result in
            self?.handle(call, result: result)
        }
        let events = FlutterEventChannel(name: "vitalguard/stream", binaryMessenger: messenger)
        events.setStreamHandler(self)
    }

    /// 표시용 상태 이벤트를 Flutter 로 밀어준다. 어느 스레드에서 불러도 안전(채널 규약상 메인으로 전달).
    func emit(_ payload: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            self?.eventSink?(payload)
        }
    }

    private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "login":
            guard let args = call.arguments as? [String: Any],
                  let id = args["id"] as? String, !id.isEmpty,
                  let password = args["password"] as? String, !password.isEmpty else {
                result(["ok": false, "error": "아이디와 비밀번호를 입력하세요."])
                return
            }
            login(id: id, password: password, result: result)
        case "logout":
            AuthStore.clearAll()
            VitalPipeline.shared.reloadAuth()
            // 로그아웃 중에도 워치는 계속 보낸다 — 비우지 않으면 다음 로그인 화면이
            // 직전 작업자의 누계를 이어받는다.
            PhoneReceiver.shared.resetSnapshot(reason: "로그아웃")
            result(["ok": true])
        case "ownVitals":
            ownVitals(result: result)
        // 촬영 — 서류 스캔(scan) · 현장 사진(photo). 결과는 촬영·OCR·각인·업로드까지 끝난 뒤 온다.
        case "captureMedia":
            let raw = (call.arguments as? [String: Any])?["mode"] as? String ?? "photo"
            let mode = MediaCapture.Mode(rawValue: raw) ?? .photo
            MediaCapture.shared.start(mode: mode) { result($0) }
        // 기록 탭 목록. ★ 별도 앱 API 를 만들지 않는다 — 관제 캘린더 조회가 **앱 JWT 를 그대로
        //   수용**하고 표시용 만료 URL·삭제 권한(canDelete)까지 서버가 계산해 내려준다.
        case "listMedia":
            let days = (call.arguments as? [String: Any])?["days"] as? Int ?? 30
            listMedia(days: days, result: result)
        // 삭제·설명 수정. 권한 판정은 서버가 한다(올린 본인 또는 owner) — 여기서 다시 재지 않는다.
        case "deleteMedia":
            guard let id = (call.arguments as? [String: Any])?["id"] as? String, !id.isEmpty else {
                result(["ok": false, "error": "id 가 없습니다."])
                return
            }
            apiWrite(path: "api/calendar/media", method: "DELETE", query: ["id": id], body: nil, result: result)
        // 댓글 — 관제웹의 같은 사진 '설명·댓글' 스레드와 **같은 저장소**다.
        case "addComment":
            let args = call.arguments as? [String: Any]
            guard let mediaId = args?["mediaId"] as? String, !mediaId.isEmpty,
                  let text = (args?["body"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty else {
                result(["ok": false, "error": "내용을 입력해 주세요."])
                return
            }
            apiWrite(path: "api/calendar/media/comment", method: "POST", query: [:],
                     body: ["mediaId": mediaId, "body": text], result: result)
        case "updateComment":
            let args = call.arguments as? [String: Any]
            guard let id = args?["id"] as? String, !id.isEmpty,
                  let text = (args?["body"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty else {
                result(["ok": false, "error": "내용을 입력해 주세요."])
                return
            }
            apiWrite(path: "api/calendar/media/comment", method: "PATCH", query: [:],
                     body: ["id": id, "body": text], result: result)
        case "deleteComment":
            guard let id = (call.arguments as? [String: Any])?["id"] as? String, !id.isEmpty else {
                result(["ok": false, "error": "id 가 없습니다."])
                return
            }
            apiWrite(path: "api/calendar/media/comment", method: "DELETE", query: ["id": id],
                     body: nil, result: result)
        case "updateMediaDescription":
            let args = call.arguments as? [String: Any]
            guard let id = args?["id"] as? String, !id.isEmpty else {
                result(["ok": false, "error": "id 가 없습니다."])
                return
            }
            let text = args?["description"] as? String ?? ""
            apiWrite(path: "api/calendar/media", method: "PATCH", query: [:],
                     body: ["id": id, "description": text], result: result)
        // 화면이 스트림 없이 현재 값을 당겨 가는 경로(주기 폴백 · 당겨서 새로고침).
        case "vitalsSnapshot":
            result(PhoneReceiver.shared.currentDisplaySnapshot())
        case "status":
            var payload: [String: Any] = [
                "loggedIn": AuthStore.token != nil,
                "workerId": AuthStore.workerId as Any,
                "loginId": AuthStore.loginId as Any,
                "name": AuthStore.userName as Any,
                "pending": VitalPipeline.shared.pendingCount,
                "baseURL": VitalPipeline.resolvedBaseURL().absoluteString,
            ]
            // ★ 진단 항목 — 설정 화면이 3초마다 이 경로로 다시 묻는다. EventChannel 과 독립이라
            //   스트림이 끊겨도 값이 얼지 않는다(2026-08-20 실측 결함 대응).
            if let at = PhoneReceiver.shared.lastVitalAt {
                payload["lastVitalAtMs"] = Int(at.timeIntervalSince1970 * 1000)
                payload["lastVitalAgeSec"] = Int(Date().timeIntervalSince(at))
            }
            if let bat = PhoneReceiver.shared.watchBatteryPct { payload["watchBatteryPct"] = bat }
            if let lag = PhoneReceiver.shared.lastBatchLagSec {
                // 소수 1자리면 충분하다 — 정상 0~5초, 단절 복귀 직후엔 분 단위가 나온다.
                payload["lastBatchLagSec"] = (lag * 10).rounded() / 10
            }
            payload.merge(LocationProvider.shared.diagnostics()) { a, _ in a }
            payload["photoAddAuth"] = Self.photoAddAuthText()
            let info = Bundle.main.infoDictionary
            payload["appVersion"] = info?["CFBundleShortVersionString"] as? String ?? "-"
            payload["appBuild"] = info?["CFBundleVersion"] as? String ?? "-"
            // 빌드 시각은 별도 필드가 없다 — 실행 파일의 수정 시각이 곧 빌드·설치 시점이다.
            if let exe = Bundle.main.executableURL,
               let m = (try? FileManager.default.attributesOfItem(atPath: exe.path))?[.modificationDate] as? Date {
                payload["builtAtMs"] = Int(m.timeIntervalSince1970 * 1000)
            }
            result(payload)
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    /// 본인 파생 지표 조회 — 서버만 낼 수 있는 값(추정 체온·PSI·스트레스·누적)을 받아 온다.
    ///
    /// ★ 토큰을 Dart 로 넘기지 않는다. 스코프가 **서명된 클레임**으로만 정해지므로 사번을
    /// 실어 보낼 것도 없다 — 계정을 바꾸면 토큰이 바뀌고 그것만으로 대상이 바뀐다.
    /// 실패는 값을 지어내지 않고 `ok:false` 로 돌려준다(화면이 타일을 안 그린다).
    private func ownVitals(result: @escaping FlutterResult) {
        guard let token = AuthStore.token, !token.isEmpty else {
            result(["ok": false, "error": "로그인이 필요합니다."])
            return
        }
        var request = URLRequest(url: VitalPipeline.resolvedBaseURL().appendingPathComponent("api/app/me/vitals"))
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        var finished = false
        let finish: (Any) -> Void = { value in
            guard !finished else { return }
            finished = true
            DispatchQueue.main.async { result(value) }
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                finish(["ok": false, "error": error.localizedDescription])
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                // 401 은 앱이 스스로 복구 가능한 상태다 — 화면이 재로그인을 띄우게 코드를 함께 준다.
                finish(["ok": false, "status": code, "error": "조회 실패(\(code))"])
                return
            }
            finish(json)
        }.resume()
    }

    /// 최근 [days] 일의 캘린더 미디어. 응답의 `media[].media_url` 은 서버가 발급한 만료형 URL 이라
    /// 화면이 그대로 <img> 로 쓰면 된다(비공개 버킷이므로 영구 링크는 존재하지 않는다).
    private func listMedia(days: Int, result: @escaping FlutterResult) {
        guard let token = AuthStore.token, !token.isEmpty else {
            result(["ok": false, "error": "로그인이 필요합니다."])
            return
        }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Seoul")
        f.dateFormat = "yyyy-MM-dd"
        let to = Date()
        let from = to.addingTimeInterval(-Double(max(1, days)) * 86_400)

        var comps = URLComponents(
            url: VitalPipeline.resolvedBaseURL().appendingPathComponent("api/calendar/media"),
            resolvingAgainstBaseURL: false
        )
        comps?.queryItems = [
            URLQueryItem(name: "from", value: f.string(from: from)),
            URLQueryItem(name: "to", value: f.string(from: to)),
        ]
        guard let url = comps?.url else {
            result(["ok": false, "error": "조회 주소를 만들지 못했습니다."])
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        URLSession.shared.dataTask(with: request) { data, response, error in
            let finish: ([String: Any]) -> Void = { payload in
                DispatchQueue.main.async { result(payload) }
            }
            if let error {
                finish(["ok": false, "error": error.localizedDescription])
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                finish(["ok": false, "status": code, "error": "조회 실패(\(code))"])
                return
            }
            finish(json)
        }.resume()
    }

    /// 사진첩 **추가 전용** 권한 상태 문구. 거부돼 있으면 촬영본이 조용히 안 남는다.
    private static func photoAddAuthText() -> String {
        switch PHPhotoLibrary.authorizationStatus(for: .addOnly) {
        case .notDetermined: return "미결정"
        case .restricted: return "제한됨"
        case .denied: return "거부됨"
        case .authorized: return "허용"
        case .limited: return "일부 허용"
        @unknown default: return "알 수 없음"
        }
    }

    /// 인증이 필요한 쓰기 요청 공통 경로(미디어 삭제·설명, 댓글 추가·수정·삭제).
    ///
    /// ★ 서버가 소유권을 판정한다 — 남의 것이면 **404**(있는지조차 알려주지 않는다).
    ///   그 404 를 "없어졌다" 로 옮기면 사용자가 오해하므로 화면에 쓸 사유를 여기서 붙인다.
    private func apiWrite(
        path: String,
        method: String,
        query: [String: String],
        body: [String: Any]?,
        result: @escaping FlutterResult
    ) {
        guard let token = AuthStore.token, !token.isEmpty else {
            result(["ok": false, "error": "로그인이 필요합니다."])
            return
        }
        var comps = URLComponents(
            url: VitalPipeline.resolvedBaseURL().appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty {
            comps?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = comps?.url else {
            result(["ok": false, "error": "요청 주소를 만들지 못했습니다."])
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            let finish: ([String: Any]) -> Void = { payload in
                DispatchQueue.main.async { result(payload) }
            }
            if let error {
                finish(["ok": false, "error": error.localizedDescription])
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 200 {
                finish(["ok": true])
                return
            }
            // 서버 문구가 있으면 그것을 쓴다(권한 사유가 담겨 있다). 없으면 코드별 기본 문구.
            let serverError = data
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["error"] as? String
            let fallback: String
            switch code {
            case 401: fallback = "다시 로그인해 주세요."
            case 403, 404: fallback = "본인이 올린 것만 지우거나 고칠 수 있습니다."
            default: fallback = "요청 실패(\(code))"
            }
            finish(["ok": false, "status": code, "error": serverError ?? fallback])
        }.resume()
    }

    private func login(id: String, password: String, result: @escaping FlutterResult) {
        var request = URLRequest(url: VitalPipeline.resolvedBaseURL().appendingPathComponent("api/app-auth/login"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["id": id, "password": password])

        URLSession.shared.dataTask(with: request) { data, response, error in
            let finish: ([String: Any]) -> Void = { payload in
                DispatchQueue.main.async { result(payload) }
            }
            if let error {
                finish(["ok": false, "error": "네트워크 오류: \(error.localizedDescription)"])
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            guard status == 200, let json,
                  json["ok"] as? Bool == true,
                  let token = json["token"] as? String,
                  let user = json["user"] as? [String: Any] else {
                let reason = json?["error"] as? String
                let message: String
                switch (status, reason) {
                // 관제웹 로그인과 동일 문구 — 두 화면이 같은 로그인임을 문구까지 일치시킨다.
                case (401, _): message = "아이디 또는 비밀번호가 일치하지 않습니다."
                case (403, _): message = "미승인 계정입니다. 관리자 승인 후 이용하세요."
                case (429, _): message = "시도가 너무 잦습니다. 잠시 후 다시 시도하세요."
                default: message = "로그인 실패(\(status)\(reason.map { "·\($0)" } ?? ""))"
                }
                finish(["ok": false, "error": message])
                return
            }
            let workerId = user["workerId"] as? String
            guard let workerId, !workerId.isEmpty else {
                // 사번 없는 토큰은 생체 업로드가 서버에서 401 이므로 저장하지 않고 명확히 알린다.
                finish(["ok": false, "error": "이 계정에는 사번이 등록돼 있지 않아 생체 전송을 시작할 수 없습니다."])
                return
            }
            // 계정 교체 감지 — 직전 로그인 사번과 다르면 미전송 잔여 큐를 폐기한다(새 사번으로 오귀속 방지).
            // ★ 큐 폐기와 화면 초기화를 **같은 조건 안에** 둔다. 조건이 갈리면
            //   "큐는 비웠는데 화면엔 직전 작업자 값이 남는" 상태가 다시 만들어진다.
            if let previous = AuthStore.lastWorkerId, !previous.isEmpty, previous != workerId {
                let reason = "계정 교체 \(previous) → \(workerId)"
                VitalPipeline.shared.purgeQueue(reason: reason)
                PhoneReceiver.shared.resetSnapshot(reason: reason)
            }
            AuthStore.lastWorkerId = workerId
            AuthStore.saveToken(token)
            AuthStore.workerId = workerId
            AuthStore.userName = user["name"] as? String
            AuthStore.loginId = user["id"] as? String
            VitalPipeline.shared.reloadAuth()
            finish(["ok": true, "workerId": workerId, "name": user["name"] as? String as Any])
        }.resume()
    }
}

// MARK: - EventChannel (표시용 실시간 스트림)

extension VitalBridge: FlutterStreamHandler {
    func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        eventSink = events
        return nil
    }

    func onCancel(withArguments arguments: Any?) -> FlutterError? {
        eventSink = nil
        return nil
    }
}
