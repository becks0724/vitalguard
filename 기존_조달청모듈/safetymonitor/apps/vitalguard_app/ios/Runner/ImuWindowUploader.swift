// 낙상 진단용 원시 IMU 윈도 업로더 — 워치가 보낸 12초 6축 파형을 수집 서버로 올린다
//
// **왜 생체 경로와 분리하는가** — 이것은 진단 데이터지 안전 신호가 아니다. 실시간일 이유가 없고,
// 윈도 하나가 25KB 라 5초 배치에 얹으면 생체 업로드를 밀어낸다. 서버도 다른 라우트를 쓴다
// (`/api/fall/imu-window` → `imu_collect.imu_window` · 구 미니앱 시절부터 있던 계약 그대로).
//
// **왜 디스크 큐가 없는가** — 진단 표본이라 몇 건 잃어도 결론이 안 바뀐다. 앱이 죽는 순간
// 메모리에 있던 것만 사라지고, 시간당 30건 수집·즉시 업로드라 실제 손실은 극히 작다.
// 생체(`VitalPipeline`)는 반대다 — 거긴 한 건도 잃으면 안 되므로 디스크 큐가 있다.
// 이 비대칭은 의도된 것이다.
import Foundation
import os

final class ImuWindowUploader {
    static let shared = ImuWindowUploader()

    private let log = Logger(subsystem: "com.vitalguard.vitalguardApp", category: "ImuWindow")
    private let work = DispatchQueue(label: "com.vitalguard.imu-window")
    /// 상한 — 넘으면 **오래된 것부터** 버린다. 최근 것이 진단에 더 쓸모 있다.
    private let maxQueue = 100
    private var pending: [[String: Any]] = []
    private var uploading = false

    private init() {}

    /// `PhoneReceiver` 가 워치 페이로드를 그대로 넘긴다.
    func enqueue(_ payload: [String: Any]) {
        work.async {
            guard let axes = payload["axes"] as? [[Double]], !axes.isEmpty else {
                self.log.error("윈도 페이로드에 axes 가 없다 — 폐기")
                return
            }
            var item: [String: Any] = [
                "axes": axes,
                "fs": payload["fs"] as? Double ?? 50,
                "impactIndex": payload["impactIndex"] as? Int ?? 0,
            ]
            // family 는 워치가 결말에서 정한 것만 붙는다(모르면 안 붙인다 — 서버 CHECK 가
            // 허용 목록 밖 값을 거부하고, 무엇보다 **모르는 것을 아는 척하면 학습이 오염된다**).
            if let family = payload["family"] as? String { item["family"] = family }
            self.pending.append(item)
            if self.pending.count > self.maxQueue {
                let dropped = self.pending.count - self.maxQueue
                self.pending.removeFirst(dropped)
                self.log.notice("윈도 큐 상한 초과 — 오래된 \(dropped, privacy: .public)건 폐기")
            }
            self.uploadLocked()
        }
    }

    private func uploadLocked() {
        guard !uploading, !pending.isEmpty else { return }
        // 미로그인이면 보내지 않고 큐에 둔다 — 로그인 후 다음 윈도가 올 때 함께 나간다.
        guard let token = AuthStore.token, !token.isEmpty,
              let workerId = AuthStore.workerId, !workerId.isEmpty
        else { return }
        uploading = true

        var body = pending[0]
        body["workerId"] = workerId
        var request = URLRequest(url: VitalPipeline.resolvedBaseURL().appendingPathComponent("api/fall/imu-window"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let encoded = try? JSONSerialization.data(withJSONObject: body) else {
            log.error("윈도 직렬화 실패 — 1건 폐기")
            pending.removeFirst()
            uploading = false
            return
        }
        request.httpBody = encoded
        let rows = (body["axes"] as? [[Double]])?.count ?? 0

        URLSession.shared.dataTask(with: request) { data, response, error in
            self.work.async {
                self.uploading = false
                let status = (response as? HTTPURLResponse)?.statusCode ?? -1
                if let error {
                    // 진단 데이터라 재시도는 다음 윈도 도착 때 자연히 일어난다(전용 타이머 없음).
                    self.log.warning("윈도 업로드 실패(네트워크): \(error.localizedDescription, privacy: .public) — 큐 \(self.pending.count, privacy: .public)건")
                    return
                }
                switch status {
                case 200...299:
                    self.pending.removeFirst()
                    self.log.notice("[IMU] 윈도 업로드 성공(\(status, privacy: .public)) — \(rows, privacy: .public)행, 잔여 \(self.pending.count, privacy: .public)건")
                    self.uploadLocked()
                case 400:
                    // 계약 위반(축 수·행 수·family 허용목록)은 재시도해도 같다 — 버리되 소리 나게.
                    let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? "(본문 없음)"
                    self.log.error("[IMU] ★ 서버가 윈도를 거부(400) — \(detail, privacy: .public). 재시도해도 같아 폐기한다")
                    self.pending.removeFirst()
                    self.uploadLocked()
                default:
                    self.log.warning("[IMU] 윈도 업로드 실패(HTTP \(status, privacy: .public)) — 큐 \(self.pending.count, privacy: .public)건 유지")
                }
            }
        }.resume()
    }
}
