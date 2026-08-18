// 폰 생체 표시 행 조립 — 순수 함수라 화면 없이 테스트된다(값 서식·생략 규칙이 여기 전부 있다)
//
// 값과 단위를 **따로** 들고 있는다 — 타일이 숫자를 크게, 단위를 작게 쓰기 때문이다
// (2026-08-18 개편). 문자열로 붙여 두면 화면이 다시 쪼개야 하고, 쪼개는 규칙이
// 여기와 갈린다. 조립은 `VitalRow.display` 한 곳에서만 한다.
import 'vital_range.dart';
import 'vital_stream.dart';

/// 화면 한 줄(= 타일 하나). `detail` 은 값의 성격을 밝히는 보조 문구(측정 시각·누계 기준 등)다.
///
/// `range` 가 있는 종류만 정상 범위 막대를 그린다 — 근거 있는 임계가 심박·SpO₂ 뿐이라
/// 나머지는 값만 적는다(안전 앱이 근거 없는 의학 판정을 만들지 않는다 · vital_range.dart 참조).
class VitalRow {
  const VitalRow({
    required this.label,
    required this.value,
    this.unit = '',
    this.detail,
    this.range,
    this.numeric,
  });

  final String label;

  /// 숫자만. 타일이 크게 그린다. 값이 없으면 `--`.
  final String value;

  /// 단위. 타일이 작게 그린다. 없는 종류(`--`)는 빈 문자열.
  final String unit;

  final String? detail;

  /// 정상 범위 막대의 근거. null 이면 막대를 그리지 않는다.
  final VitalRange? range;

  /// 막대 위치·판정에 쓰는 원값. `range` 가 있을 때만 채운다.
  final double? numeric;

  /// 한 줄로 붙인 표기 — 타일이 아닌 곳(목록·테스트)에서 쓴다.
  /// 붙이는 규칙은 하나다 — 종류마다 띄어쓰기를 달리하면 그 규칙이 또 갈린다.
  String get display => '$value$unit';
}

/// 이산 측정 한 종류의 표기 규칙.
class DiscreteSpec {
  const DiscreteSpec(this.label, this.unit, this.digits);

  final String label;
  final String unit;
  final int digits;
}

/// 이산 6종 — 순서는 워치 화면(`ContentView.discreteLine`)과 같다.
///
/// 라벨은 **풀어 쓴다.** 워치가 `강도26` 처럼 줄이는 것은 화면 폭 때문이고 폰에는 그 제약이 없다.
/// 줄임말을 그대로 옮기면 작업자가 무슨 값인지 알 수 없다.
const Map<String, DiscreteSpec> discreteSpecs = {
  // 절대적 운동 강도 — 체중으로 나눈 값이라 작업자 간 비교가 성립한다(kcal/kg/hr = MET).
  'pe': DiscreteSpec('운동 강도', 'MET', 1),
  'dl': DiscreteSpec('일광 시간', '분', 0),
  'rhr': DiscreteSpec('안정 심박', 'bpm', 0),
  'whr': DiscreteSpec('보행 심박', 'bpm', 0),
  'rr': DiscreteSpec('호흡수', '회/분', 0),
  'hrv': DiscreteSpec('심박변이(HRV)', 'ms', 1),
};

/// `14:32` — 이산 측정·SpO₂ 는 몇 분에 한 번 오는 값이라 절대 시각으로 적는다.
/// 상대 시각("N초 전")은 매초 바뀌어 화면이 계속 흔들리므로 심박 한 곳에만 쓴다.
String formatClock(DateTime at) {
  final h = at.hour.toString().padLeft(2, '0');
  final m = at.minute.toString().padLeft(2, '0');
  return '$h:$m';
}

/// `1,204` — 자릿수 구분(별도 패키지 없이).
String formatCount(int n) {
  final digits = n.abs().toString();
  final buf = StringBuffer(n < 0 ? '-' : '');
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(',');
    buf.write(digits[i]);
  }
  return buf.toString();
}

/// 심박 아래에 놓일 생체 행들. **0 건인 종류는 넣지 않는다** — 워치와 같은 규칙이고,
/// 안 온 값에 `0` 을 적으면 "측정했는데 0" 으로 읽혀 미수신보다 나쁘다.
///
/// ⚠ **활동 에너지는 여기 없다.** 상시 워크아웃 때문에 약 4 배 과대라(2026-08-15 실측)
/// 축을 바로잡기 전에는 띄우지 않는다 — `apps/dashboard-web/docs/heat-activity-axis/checklist.md`.
/// 활동 지표 라벨 — 생체 값이 아니라 **움직임 누계**라 격자를 나눈다.
/// 섞어 놓으면 "걸음 1,204보" 가 산소포화도 옆에 앉아 같은 성격으로 읽힌다.
const Set<String> activityLabels = {'걸음', '오른 층', '정지 지속'};

/// 화면 두 격자로 가른다. 순서는 [buildVitalRows] 를 그대로 유지한다.
({List<VitalRow> body, List<VitalRow> activity}) splitVitalSections(List<VitalRow> rows) => (
      body: rows.where((r) => !activityLabels.contains(r.label)).toList(),
      activity: rows.where((r) => activityLabels.contains(r.label)).toList(),
    );

List<VitalRow> buildVitalRows(VitalStreamEvent e) {
  final rows = <VitalRow>[];

  final spo2 = e.spo2;
  if (spo2 != null) {
    rows.add(VitalRow(
      label: '산소포화도',
      value: spo2.toStringAsFixed(0),
      unit: '%',
      detail: e.spo2At == null ? null : '측정 ${formatClock(e.spo2At!)}',
      // 근거 있는 임계가 있는 둘 중 하나 — 막대를 붙인다.
      range: spo2Range,
      numeric: spo2,
    ));
  }

  for (final entry in discreteSpecs.entries) {
    final count = e.discreteCounts[entry.key] ?? 0;
    if (count <= 0) continue;
    final spec = entry.value;
    final value = e.discreteValues[entry.key];
    rows.add(VitalRow(
      // 값이 없으면 단위도 비운다 — `--MET` 은 값처럼 읽힌다.
      label: spec.label,
      value: value == null ? '--' : value.toStringAsFixed(spec.digits),
      unit: value == null ? '' : spec.unit,
      detail: '$count건',
    ));
  }

  final steps = e.steps;
  if (steps != null && steps > 0) {
    rows.add(VitalRow(
      label: '걸음',
      value: formatCount(steps),
      unit: '보',
      detail: '폰 수신 누계',
    ));
  }
  final flights = e.flights;
  if (flights != null && flights > 0) {
    rows.add(VitalRow(
      label: '오른 층',
      value: '$flights',
      unit: '층',
      detail: '폰 수신 누계',
    ));
  }

  final still = e.stillSec;
  if (still != null) {
    // 착용 여부의 근거로 쓰지 않는다 — 손목 무동작은 착용 판별의 약한 지표다(Choi 2011 일치도 0.78).
    // 여기서는 워치가 잰 값을 그대로 보여주기만 한다.
    rows.add(VitalRow(label: '정지 지속', value: still.toStringAsFixed(1), unit: '초'));
  }

  return rows;
}
