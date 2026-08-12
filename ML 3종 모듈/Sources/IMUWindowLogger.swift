// 원시 IMU 6축 윈도 로거 (ML 트랙B 데이터 수집) — A1.
//
// FallDetector 와 같은 deviceMotion 스트림의 6축(accel xyz + gyro xyz)을 링버퍼에 롤링 적재하고,
// 알림 임계(impactThresholdG=2.8)보다 낮은 "로깅 게이트"가 열린 시점 ±N초 윈도를 잘라 onWindow 로 내보낸다.
//   - 알림 임계보다 낮은 로깅 임계 → 망치질·약충격 등 음성(작업동작) 샘플도 수집(트랙B 학습 필수).
//   - 충격 시점(t_impact) 기준 pre/post 윈도라 서버에서 work_veto(3s)/impact(±1s)/recovery(post)로 잘라 쓸 수 있다.
// 기존 FallDetector 판정/임계는 전혀 건드리지 않는다(추가만). imuLogger 가 nil 이면 완전 비활성 = 기존 동작 불변.
// 수집 모드에서만 주입(평소 발표 데모엔 영향 0).
import Foundation

struct ImuWindow {
    let fs: Double
    let samples: [[Float]]   // 각 행 = [ax, ay, az, gx, gy, gz], 시간순
    let impactIndex: Int     // 윈도 내 충격(로깅 게이트) 위치
}

final class IMUWindowLogger {
    var onWindow: ((ImuWindow) -> Void)?

    private let fs: Double
    private let preSec: Double
    private let postSec: Double
    private let logThresholdG: Double   // 알림 임계(2.8)보다 낮음 → 음성·약충격도 수집
    private let refractorySec: Double

    private let capacity: Int
    private var buf: [(t: Date, s: [Float])] = []
    private var pendingImpactAt: Date?
    private var lastEmitAt: Date?

    init(fs: Double = 50.0, preSec: Double = 2.0, postSec: Double = 10.0,
         logThresholdG: Double = 1.8, refractorySec: Double = 2.0) {
        self.fs = fs
        self.preSec = preSec
        self.postSec = postSec
        self.logThresholdG = logThresholdG
        self.refractorySec = refractorySec
        self.capacity = Int((preSec + postSec + 1.0) * fs)   // 여유 1s
    }

    // FallDetector 의 deviceMotion 클로저에서 6축 raw 와 totalG 를 넘겨 호출(콜백당 1줄).
    // FallDetector 와 동일 직렬 큐에서 호출되므로 buf 접근은 직렬화되어 안전.
    func ingest(ax: Double, ay: Double, az: Double,
                gx: Double, gy: Double, gz: Double,
                totalG: Double, at now: Date) {
        buf.append((now, [Float(ax), Float(ay), Float(az), Float(gx), Float(gy), Float(gz)]))
        if buf.count > capacity { buf.removeFirst(buf.count - capacity) }

        // 로깅 게이트 — 알림 임계보다 낮은 충격에서도 윈도 후보 시작(refractory 로 과다 트리거 억제).
        if pendingImpactAt == nil, totalG >= logThresholdG {
            if let last = lastEmitAt, now.timeIntervalSince(last) < refractorySec { return }
            pendingImpactAt = now
        }

        // post 구간이 다 채워지면 [impact-pre, impact+post] 윈도 추출 후 방출.
        if let impact = pendingImpactAt, now.timeIntervalSince(impact) >= postSec {
            emit(around: impact)
            pendingImpactAt = nil
            lastEmitAt = now
        }
    }

    private func emit(around impact: Date) {
        let start = impact.addingTimeInterval(-preSec)
        let end = impact.addingTimeInterval(postSec)
        let win = buf.filter { $0.t >= start && $0.t <= end }
        guard win.count >= Int(fs) else { return }   // 1초 미만이면 버림(드롭/지터 방어)
        // 충격 위치 = impact 에 가장 가까운 샘플 인덱스
        var idx = 0
        var best = Double.greatestFiniteMagnitude
        for (i, e) in win.enumerated() {
            let d = abs(e.t.timeIntervalSince(impact))
            if d < best { best = d; idx = i }
        }
        onWindow?(ImuWindow(fs: fs, samples: win.map { $0.s }, impactIndex: idx))
    }
}
