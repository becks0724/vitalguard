// 생체 값의 정상 범위 판정·막대 배치 — 순수 로직이라 화면 없이 테스트된다
//
// ★★ 임계를 **여기서 새로 만들지 않는다.** 전부 관제웹과 같은 출처다.
//   packages/analyzers `THRESHOLDS` · apps/dashboard-web `lib/severity.ts`
// 안전 앱이 근거 문서 없는 의학 판정을 자체 정의하면 오경보의 책임 소재가 사라진다.
// 그래서 임계가 **있는 종류만** 막대를 그린다 — HRV·호흡수·안정심박·운동강도는 값만 적는다.
//
// ⚠ 폰에는 활동 게이트가 없다. 관제웹은 `isWorking()` 으로 작업 중 심박을 완화하지만
//   (작업 중 135/155) 폰의 걸음·층은 **누계**라 구간 강도를 못 낸다. 그래서 폰은
//   안정 기준을 쓰고 그 사실을 화면에 적는다(`basis`) — 안 적으면 벽돌 나르는
//   작업자에게 "주의"가 뜨고, 화면이 사실과 다른 것을 말하게 된다.

/// 관제웹 `Status` 와 같은 어휘. 새 말을 만들지 않는다(작업자·관제가 같은 단어를 봐야 한다).
enum VitalStatus { idle, normal, caution, danger }

const Map<VitalStatus, String> vitalStatusLabel = {
  VitalStatus.idle: '대기',
  VitalStatus.normal: '정상',
  VitalStatus.caution: '주의',
  VitalStatus.danger: '위험',
};

/// 막대의 한 구간. `[from, to)` 이고 마지막 구간만 `to` 를 포함한다.
class RangeBand {
  const RangeBand(this.from, this.to, this.status);

  final double from;
  final double to;
  final VitalStatus status;
}

/// 값 하나의 표시 구간과 밴드. `statusOf` 는 밴드가 아니라 **관제웹 판정식**을 그대로 옮긴 것이고,
/// 밴드는 그림용이다. 둘이 어긋나면 색과 글자가 다른 말을 하므로 테스트로 전 구간 대조한다.
class VitalRange {
  const VitalRange({
    required this.min,
    required this.max,
    required this.bands,
    required this.basis,
    required this.statusOf,
  });

  /// 막대에 그리는 구간. 임계를 다 담되 과하게 넓히지 않는다(넓히면 점이 늘 가운데에 붙는다).
  final double min;
  final double max;
  final List<RangeBand> bands;

  /// 판정 근거 표기 — 화면에 그대로 적는다.
  final String basis;

  /// 관제웹과 같은 판정식.
  final VitalStatus Function(double) statusOf;

  /// 막대 위 위치 0.0~1.0. 구간 밖 값은 끝에 붙인다 — 막대 밖으로 나가면 위치가 거짓이 된다.
  double positionOf(double value) {
    final v = value.clamp(min, max).toDouble();
    return (v - min) / (max - min);
  }

  /// 그 값이 놓이는 밴드. 그림 색을 고를 때 쓴다.
  RangeBand bandAt(double value) {
    final v = value.clamp(min, max).toDouble();
    for (final b in bands) {
      if (v >= b.from && v < b.to) return b;
    }
    return bands.last; // v == max
  }
}

// ── 심박 ────────────────────────────────────────────────────────────────
// severity.ts `heartRateStatus`(활동 미지정) · THRESHOLDS.heartRate{highBpm:130, lowBpm:40}
//   위험 ≥130 · ≤40   주의 110–129 · 41–50   정상 51–109
// 밴드 경계가 41·51 인 것은 위 부등호(`<=40`, `<=50`)를 정수에서 정확히 재현하기 위해서다.
VitalStatus heartRateStatus(double bpm) {
  if (bpm >= 130 || bpm <= 40) return VitalStatus.danger;
  if (bpm >= 110 || bpm <= 50) return VitalStatus.caution;
  return VitalStatus.normal;
}

const List<RangeBand> _hrBands = [
  RangeBand(30, 41, VitalStatus.danger),
  RangeBand(41, 51, VitalStatus.caution),
  RangeBand(51, 110, VitalStatus.normal),
  RangeBand(110, 130, VitalStatus.caution),
  RangeBand(130, 170, VitalStatus.danger),
];

final VitalRange heartRateRange = VitalRange(
  min: 30,
  max: 170,
  bands: _hrBands,
  basis: '안정 기준',
  statusOf: heartRateStatus,
);

// ── SpO₂ ────────────────────────────────────────────────────────────────
// severity.ts `spo2Status` · THRESHOLDS.spo2{cautionPct:92, dangerPct:88}
//   위험 <88   주의 88–91   정상 ≥92
VitalStatus spo2Status(double pct) {
  if (pct < 88) return VitalStatus.danger;
  if (pct < 92) return VitalStatus.caution;
  return VitalStatus.normal;
}

const List<RangeBand> _spo2Bands = [
  RangeBand(80, 88, VitalStatus.danger),
  RangeBand(88, 92, VitalStatus.caution),
  RangeBand(92, 100, VitalStatus.normal),
];

final VitalRange spo2Range = VitalRange(
  min: 80,
  max: 100,
  bands: _spo2Bands,
  basis: '의학 기준',
  statusOf: spo2Status,
);
