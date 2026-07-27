// Core Motion deviceMotion(가속도+중력+자이로)으로 낙상을 3단계로 판정하는 디텍터
// Apple 내장 낙상감지(CMFallDetectionManager)는 특수 entitlement(유료 Program+Apple 승인)라
// 무료 Personal Team 서명 불가 → 워크아웃 세션 중 raw 모션 스트림으로 직접 판정한다.
// 워크아웃 세션이 살아있는 동안 폰/워치 잠금과 무관하게 모션 업데이트가 지속된다.
//
// 판정 = ① 자유낙하 전조(impact 직전 무중력 딥) ② 충격 스파이크 ③ 충격 후 저활동 윈도
//        + 자이로 보강(자유낙하 OR 강회전 tumble 중 하나로 코로보레이션) → 오탐/미탐 동시 완화.
//   - 자유낙하 전조: 망치질·팔 내려치기 등 작업 충격을 배제(그 동작엔 무중력 구간이 없음) → 오탐↓.
//   - 저활동 윈도(연속 정지 강제 → 누적 시간): 넘어진 뒤 약간 몸부림쳐도 감지 → 미탐↓.
//   - 자이로 강회전: 자유낙하가 너무 짧아 놓친 낙상도 몸통 회전으로 보강 포착.
//
// ML 데이터 수집(fall-ml) — 후보가 "해소"될 때마다(양성 발화 + 거부 2종) onCandidate 로 활성화 요소
// 전부(충격G/정지초/자유낙하 전조/회전 피크/판정 사유)를 내보낸다. 음성(거부) 샘플은 임계 최적화
// 학습에 필수다. 라이브 알림/카드는 decision==fall(=fallDetected) 만 사용하므로 음성은 무해하다.
import Foundation
import CoreMotion

// 낙상 디텍터가 후보를 해소(발화/거부)할 때 내보내는 활성화 요소 묶음.
struct FallCandidate {
    enum Decision: String {
        case fall                                       // 발화 — 자유낙하 OR 강회전 코로보레이션 충족
        case rejectedNoCorroboration = "rejected_no_corroboration" // 정지 충족했으나 전조·회전 둘 다 없음
        case rejectedTimeout = "rejected_timeout"        // postWindow 내 저활동 미충족(충격 후 계속 움직임)
    }
    let decision: Decision
    let peakG: Double             // 충격 피크 (총가속도)
    let stillSec: Double          // 충격 후 누적 저활동초(해소 시점)
    let freefallPreceded: Bool    // 충격 직전 자유낙하 전조 유무
    let peakRotationRadS: Double  // 후보 구간 자이로 회전 피크
    var isFall: Bool { decision == .fall }
}

final class FallDetector {
    // 후보 해소(양성/음성 공통) — 항상 메인 큐에서 호출. ML 수집·라이브 알림 양쪽이 구독.
    var onCandidate: ((FallCandidate) -> Void)?
    var onMotionSample: ((_ accelerationMagnitudeG: Double, _ rotationRateRadS: Double) -> Void)?
    var imuLogger: IMUWindowLogger?

    private let motion = CMMotionManager()
    private let queue = OperationQueue()

    // 임계 — PoC 기준값(현장 튜닝 필요). totalG = |userAcceleration + gravity| 라 기존 raw 가속도와
    // 동일 스케일(정지 ≈ 1.0G) → impact/still 임계 의미가 가속도계 버전과 일관된다.
    private let sampleHz: Double
    private let eventSampleHz: Double
    private let motionPublishInterval: TimeInterval
    private var eventSampleBoostUntil: Date?
    private let impactThresholdG = 2.8       // 실제 낙상 민감도를 유지하는 충격 스파이크 판정
    private let freefallG = 0.6              // 자유낙하 판정 (무중력 → 총가속도 ≈ 0)
    private let freefallLookbackSec = 0.8    // 충격 직전 이 시간 내 자유낙하가 있었으면 전조 인정
    private let stillBandG = 0.3             // 저활동 판정 밴드 (|totalG - 1.0|)
    private let stillRequiredSec = 1.2       // 충격 후 누적 저활동 시간(연속 강제 아님)
    private let postWindowSec = 4.0          // 충격 후 이 시간 내 저활동 미충족이면 후보 폐기
    private let tumbleRotThresholdRadS = 6.0 // 자유낙하 부재 시 코로보레이션용 강회전(몸통 tumble) 임계
    private let refractorySec = 8.0          // 재트리거 방지 윈도
    private let maxIntegrationDtSec = 0.1    // 센서 일시정지 시 dt 과대적분 방지 상한

    private var impactAt: Date?
    private var impactPeakG = 0.0
    private var lowActivityAccum: TimeInterval = 0
    private var lastSampleAt: Date?
    private var peakRotation = 0.0           // 후보 구간 최대 회전속도(rad/s)
    private var freefallPrecededImpact = false
    private var lastFreefallAt: Date?        // 직전 자유낙하 시각(후보와 무관하게 상시 추적)
    private var lastFallAt: Date?
    private var lastMotionPublishAt: Date?

    init(sampleHz: Double = 50, eventSampleHz: Double = 50, motionPublishInterval: TimeInterval = 1) {
        let normalizedSampleHz = max(10, sampleHz)
        self.sampleHz = normalizedSampleHz
        self.eventSampleHz = max(normalizedSampleHz, eventSampleHz)
        self.motionPublishInterval = max(1, motionPublishInterval)
        queue.name = "com.vitalguard.fall-detector"
        queue.qualityOfService = .utility
        queue.maxConcurrentOperationCount = 1
    }

    func start() {
        guard motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = 1.0 / sampleHz
        motion.startDeviceMotionUpdates(to: queue) { [weak self] dm, _ in
            guard let self, let dm else { return }
            // userAcceleration(중력 제거 동가속) + gravity 의 벡터합 = 가속도계 원시 비력(specific force).
            // 정지 ≈ 1.0G / 자유낙하 ≈ 0G / 충격 시 스파이크 — 기존 raw 가속도 스케일과 동일.
            let ax = dm.userAcceleration.x + dm.gravity.x
            let ay = dm.userAcceleration.y + dm.gravity.y
            let az = dm.userAcceleration.z + dm.gravity.z
            let totalG = (ax * ax + ay * ay + az * az).squareRoot()
            let r = dm.rotationRate
            let rotMag = (r.x * r.x + r.y * r.y + r.z * r.z).squareRoot()
            let now = Date()
            self.updateSamplingRateIfNeeded(totalG: totalG, at: now)
            self.publishMotionSampleIfNeeded(totalG: totalG, rotMag: rotMag, at: now)
            self.imuLogger?.ingest(
                ax: ax,
                ay: ay,
                az: az,
                gx: r.x,
                gy: r.y,
                gz: r.z,
                totalG: totalG,
                at: now
            )
            self.process(totalG: totalG, rotMag: rotMag, at: now)
        }
    }

    func stop() {
        if motion.isDeviceMotionActive { motion.stopDeviceMotionUpdates() }
        // 상태 리셋을 모션 콜백과 같은 직렬 큐(maxConcurrentOperationCount=1)로 보내 process() 와 직렬화한다.
        // → 공유 가변 상태(impactAt/lowActivityAccum/peakRotation 등)가 단일 직렬 컨텍스트에서만 변형되어
        //   백그라운드 큐 ↔ MainActor(stop 호출) 간 데이터 레이스를 제거한다(stopDeviceMotionUpdates 직후
        //   큐에 남은 콜백보다 뒤에 실행되어 안전).
        queue.addOperation { [weak self] in
            self?.eventSampleBoostUntil = nil
            self?.resetEvent()
        }
    }

    private func process(totalG: Double, rotMag: Double, at now: Date) {
        if let last = lastFallAt, now.timeIntervalSince(last) < refractorySec { return }

        // 0) 자유낙하 전조 추적 — 후보 여부와 무관하게 무중력 딥 시각을 항상 기록.
        if totalG <= freefallG { lastFreefallAt = now }

        // 1) 충격 스파이크 — 후보 시작/갱신. 직전 자유낙하 전조와 회전 피크를 함께 캡처.
        if totalG >= impactThresholdG {
            impactAt = now
            impactPeakG = max(impactPeakG, totalG)
            peakRotation = max(peakRotation, rotMag)
            if let ff = lastFreefallAt, now.timeIntervalSince(ff) <= freefallLookbackSec {
                freefallPrecededImpact = true
            }
            lowActivityAccum = 0
            lastSampleAt = now
            return
        }

        // 2) 충격 이후 — 저활동 누적 + 회전 추적, 충족 시 코로보레이션 검증 후 발화.
        guard let impact = impactAt else { return }
        peakRotation = max(peakRotation, rotMag)

        // 충격 후 postWindow 내 저활동 미충족 — 음성 후보(계속 움직임)로 기록 후 폐기.
        if now.timeIntervalSince(impact) > postWindowSec {
            resolve(.rejectedTimeout)
            return
        }

        let dt = min(now.timeIntervalSince(lastSampleAt ?? now), maxIntegrationDtSec)
        lastSampleAt = now
        if abs(totalG - 1.0) < stillBandG { lowActivityAccum += dt }

        if lowActivityAccum >= stillRequiredSec {
            // 자유낙하 또는 몸통 tumble을 보조 증거로 사용해 민감도를 유지한다.
            // 착용·심박 확인과 ML 작업동작 기각은 상위 경보 경로에서 별도로 적용한다.
            if freefallPrecededImpact || peakRotation >= tumbleRotThresholdRadS {
                resolve(.fall)
            } else {
                resolve(.rejectedNoCorroboration)
            }
        }
    }

    private func publishMotionSampleIfNeeded(totalG: Double, rotMag: Double, at now: Date) {
        if let lastMotionPublishAt, now.timeIntervalSince(lastMotionPublishAt) < motionPublishInterval { return }
        lastMotionPublishAt = now
        OperationQueue.main.addOperation { [weak self] in
            self?.onMotionSample?(totalG, rotMag)
        }
    }

    private func updateSamplingRateIfNeeded(totalG: Double, at now: Date) {
        if totalG <= freefallG || totalG >= 1.8 {
            eventSampleBoostUntil = now.addingTimeInterval(5)
        }
        let isBoosted = eventSampleBoostUntil.map { $0 > now } ?? false
        let targetHz = isBoosted ? eventSampleHz : sampleHz
        let targetInterval = 1.0 / targetHz
        if abs(motion.deviceMotionUpdateInterval - targetInterval) > 0.0001 {
            motion.deviceMotionUpdateInterval = targetInterval
        }
    }

    // 후보 해소 — 현재 상태로 FallCandidate 를 만들어 내보내고(메인 큐), 상태를 리셋한다.
    // 발화(.fall)만 재트리거 윈도(lastFallAt)를 연다 — 음성 거부는 연속 작업충격을 막지 않는다.
    private func resolve(_ decision: FallCandidate.Decision) {
        if decision == .fall { lastFallAt = Date() }
        let candidate = FallCandidate(
            decision: decision,
            peakG: impactPeakG,
            stillSec: lowActivityAccum,
            freefallPreceded: freefallPrecededImpact,
            peakRotationRadS: peakRotation
        )
        resetEvent()
        OperationQueue.main.addOperation { [weak self] in self?.onCandidate?(candidate) }
    }

    private func resetEvent() {
        impactAt = nil
        impactPeakG = 0
        lowActivityAccum = 0
        lastSampleAt = nil
        peakRotation = 0
        freefallPrecededImpact = false
        // lastFreefallAt 은 후보와 독립인 롤링 전조이므로 보존(lookback 으로 자연 만료).
    }
}
