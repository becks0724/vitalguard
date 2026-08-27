// 낙상 섀도 보고 — 판정을 서버에 남긴다. **경보는 안 보낸다** (P7 1단계, 섀도)
//
// ★ v6.1.1 부터 모듈 소속이다 — 추적기(trace)의 생성(FallMLModule)과 **전송(이 파일)** 이 한 경계
//   안에 있어야, 전송이 끊기거나 모양이 바뀌었을 때 모듈 무결성 검사(MANIFEST·버전)로 책임 추적이
//   된다. 수정은 ML 담당 경유 — 통합측 임의 수정 금지(모듈 계약).
//
// 워치→폰 릴레이 계약(축약 키)을 그대로 쓴다 — 폰 VitalPipeline 이 서버 키로 펼친다:
//   candidate      {fcid, fph:"candidate", fpg, ftr [, fpo:"not_alerted"]}   ← 모든 판정마다 1건
//   prompt_result  {fcid, fph:"prompt_result", fpo, frs}                      ← danger 카운트다운 결말
// ⚠ fallDetected·fallDecision 은 만들지 않는다 — 실리면 서버 recordAlert 가 텔레그램을 울린다(섀도 위반).
//
// 통합(WatchStreamer)측 배선 4점 — UI(오버레이·진동 정책·테스트 모드)는 지금처럼 통합측 몫:
//   ① emit = { pendingFallItems.append($0) }   ② 판정 시 onVerdict(v)
//   ③ 모션 콜백에서 feed(totalG:)              ④ "낙상 아님" 버튼 → cancelByUser()
//   결말 통지는 onDanger / onResolve 콜백으로 받는다.
import Foundation

final class FallShadowReporter {
    /// danger 카운트다운 시작 — 오버레이 표시·진동 정책은 통합측이 정한다.
    var onDanger: (() -> Void)?
    /// 결말 — "moved_cancelled" | "dismissed" | "auto_escalated". 오버레이 닫기용.
    var onResolve: ((String) -> Void)?

    private let emit: ([String: Any]) -> Void
    private let now: () -> Date
    private let countdown = CountdownGuard()
    private var activeCandidateId: String?
    private var countdownStartedAt: Date?

    /// emit = 릴레이 큐 적재(통합측이 연결). now 는 시험용 주입점.
    init(emit: @escaping ([String: Any]) -> Void, now: @escaping () -> Date = Date.init) {
        self.emit = emit
        self.now = now
        countdown.onAutoCancel = { [weak self] in self?.finish("moved_cancelled") }
        countdown.onManualCancel = { [weak self] in self?.finish("dismissed") }
        countdown.onConfirm = { [weak self] in self?.finish("auto_escalated") }
    }

    /// 판정 1건 → candidate 항목 1건. danger 면 30초 확인 창을 연다.
    func onVerdict(_ v: FallMLModule.Verdict) {
        let id = UUID().uuidString
        var item: [String: Any] = [
            "fcid": id,
            "fph": "candidate",
            "fpg": v.peakG,        // 피크 G — 기존 필드(accelMagnitudeG)로 펼쳐진다
            "ftr": v.trace,        // ★ 추적성 계약 — 없으면 사후 재현 불가(README)
        ]
        // 기각·무해는 여기서 결말 확정(카운트다운이 안 열리므로 후속 항목이 없다).
        if v.decision != .danger { item["fpo"] = "not_alerted" }
        emit(item)

        guard v.decision == .danger else { return }
        // 진행 중 카운트다운이 있으면 새 후보가 이긴다(이전 후보는 결말 없음) — 종전 동작 유지.
        activeCandidateId = id
        countdownStartedAt = now()
        countdown.start(now: now())
        onDanger?()
    }

    /// 매 모션 샘플 호출(로거와 같은 직렬 큐에서) — 카운트다운이 열려 있을 때만 일한다.
    func feed(totalG: Double) {
        guard activeCandidateId != nil else { return }
        countdown.feed(totalG: totalG, now: now())
    }

    /// "낙상 아님" 버튼에서 호출.
    func cancelByUser() { countdown.cancelByUser() }

    private func finish(_ outcome: String) {
        guard let id = activeCandidateId else { return }
        var item: [String: Any] = [
            "fcid": id,
            "fph": "prompt_result",
            "fpo": outcome,
        ]
        if let startedAt = countdownStartedAt {
            // 0.1초 정밀도 — 종전 frs 반올림 규칙과 동일.
            item["frs"] = (now().timeIntervalSince(startedAt) * 10).rounded() / 10
        }
        emit(item)
        activeCandidateId = nil
        countdownStartedAt = nil
        onResolve?(outcome)
    }
}
