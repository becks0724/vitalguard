// 카운트다운 가드 — danger 판정 후 30초 확인 창.
// "낙상 아님" 버튼(수동) 외에, recovery 와 같은 원리로 **지속적 움직임이 감지되면 자동 취소**한다.
// 안전 설계: 순간 경련·짧은 꿈틀거림에 취소되지 않도록 "연속 sustainSec 초 이상 움직임"을 요구.
//   (경련성 몸부림 낙상을 오취소하지 않기 위한 보수 장치 — 값 조정은 착용 실측 후)
// 사용: danger 시점에 start() → 매 모션 샘플 feed(totalG:) → 콜백 3종 중 하나로 종료.
import Foundation

final class CountdownGuard {
    var onAutoCancel: (() -> Void)?    // 지속 움직임 → 자동 "낙상 아님"
    var onManualCancel: (() -> Void)?  // 버튼 → cancelByUser() 호출측이 연결
    var onConfirm: (() -> Void)?       // 시간 만료(무반응) → 낙상 확정·신고

    private let durationSec: Double
    private let movingStd: Double             // 1초 창 |accel| 표준편차가 이 이상이면 "움직임"
    private let sustainSec: Int               // 연속 몇 초 움직여야 자동 취소인가
    private let fs: Double

    private var deadline: Date?
    private var second: [Double] = []         // 현재 1초 버킷
    private var movingStreak = 0
    private var finished = false

    init(durationSec: Double = 30, movingStd: Double = 0.15,
                sustainSec: Int = 5, fs: Double = 50) {
        self.durationSec = durationSec
        self.movingStd = movingStd
        self.sustainSec = sustainSec
        self.fs = fs
    }

    func start(now: Date = Date()) {
        deadline = now.addingTimeInterval(durationSec)
        second.removeAll(keepingCapacity: true)
        movingStreak = 0
        finished = false
    }

    /// 모션 콜백에서 매 샘플 호출 (모듈 로거와 같은 직렬 큐에서).
    func feed(totalG: Double, now: Date = Date()) {
        guard !finished, let deadline else { return }
        second.append(totalG)
        if second.count >= Int(fs) {                       // 1초 버킷 완성
            let n = Double(second.count)
            let mean = second.reduce(0, +) / n
            let sd = (second.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / n).squareRoot()
            second.removeAll(keepingCapacity: true)
            movingStreak = sd >= movingStd ? movingStreak + 1 : 0
            if movingStreak >= sustainSec {                // 연속 움직임 → 회복으로 판단
                finish { onAutoCancel?() }
                return
            }
        }
        if now >= deadline {                               // 무반응 → 확정
            finish { onConfirm?() }
        }
    }

    /// "낙상 아님" 버튼에서 호출.
    func cancelByUser() {
        guard !finished else { return }
        finish { onManualCancel?() }
    }

    private func finish(_ emit: () -> Void) {
        finished = true
        deadline = nil
        emit()
    }
}
