// Flutter UI ↔ 네이티브 브리지 — 관제웹 계정 로그인(JWT 발급·Keychain 저장)과 파이프라인 상태 조회를 담당한다
import Flutter
import Foundation
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

    /// 마지막으로 로그인에 성공한 사번 — 계정 교체 감지용이라 로그아웃(clearAll)에도 지우지 않는다.
    static var lastWorkerId: String? {
        get { UserDefaults.standard.string(forKey: "auth.lastWorkerId") }
        set { UserDefaults.standard.set(newValue, forKey: "auth.lastWorkerId") }
    }

    static func clearAll() {
        clearToken()
        UserDefaults.standard.removeObject(forKey: "auth.workerId")
        UserDefaults.standard.removeObject(forKey: "auth.userName")
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
        case "status":
            result([
                "loggedIn": AuthStore.token != nil,
                "workerId": AuthStore.workerId as Any,
                "name": AuthStore.userName as Any,
                "pending": VitalPipeline.shared.pendingCount,
                "baseURL": VitalPipeline.resolvedBaseURL().absoluteString,
            ])
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
