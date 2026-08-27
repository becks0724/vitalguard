// 생체 카드 격자 — 참고 디자인(Health Monitor)의 카드 한 칸을 폰 생체값에 옮긴 것
//
// ★ 참고 디자인은 여섯 칸 **전부**에 상태 글자(`Normal`·`Lower`)와 세로 막대를 단다.
//   옮기지 않은 것이 그것이다 — 근거 있는 임계가 있는 값은 심박·SpO₂ 뿐이고
//   (`vital_range.dart` 머리말), 나머지에 막대를 그리면 **없던 기준이 생긴 것처럼** 읽힌다.
//   그래서 막대와 상태 글자는 `range` 가 있는 칸에만 붙고, 나머지 칸은 같은 자리에
//   값의 성격(측정 건수·누계 기준·자격 문구)을 적는다. 자리를 비우지는 않는다.
//
// ⚠ 아이콘은 이름을 **대신하지 않는다.** 2026-08-19 실기기 확인에서 아이콘만 있던 행이
//   무슨 값인지 알 수 없어 이름을 넣기로 했다(사용자 지적). 참고 디자인은 아이콘 **과**
//   이름을 나란히 두므로 그 결정과 어긋나지 않는다 — 이름을 빼면 그때로 되돌아간다.
import 'package:flutter/material.dart';

import 'metric_tile.dart';
import 'own_vitals.dart';
import 'theme.dart';
import 'vital_display.dart';
import 'vital_range.dart';
import 'vital_stream.dart';

/// 값이 안 온 칸의 표시. 화면 여러 곳이 같은 글자를 써야 "미수신" 이 한 가지 뜻으로 읽힌다.
const String _noValue = '--';

/// 칸 아이콘. **이름 옆에 붙는 보조 표지**이지 이름의 대체가 아니다(머리말 ⚠).
/// 모르는 라벨은 점 하나로 떨어진다 — 아이콘이 없다고 칸을 빼지 않는다.
const Map<String, IconData> vitalCardIcons = {
  '산소포화도': Icons.water_drop_outlined,
  '체온(추정)': Icons.thermostat,
  '심박변이(HRV)': Icons.monitor_heart_outlined,
  '안정 심박': Icons.favorite_border,
  '보행 심박': Icons.favorite,
  '호흡수': Icons.air,
  '생리적 부담': Icons.speed,
  '스트레스': Icons.bolt_outlined,
  '운동 강도': Icons.directions_run,
  '일광 시간': Icons.wb_sunny_outlined,
  '걸음': Icons.directions_walk,
  '정지 지속': Icons.pause_circle_outline,
};

IconData vitalCardIcon(String label) => vitalCardIcons[label] ?? Icons.circle_outlined;

/// 상태 글자 앞의 표지 — 색만으로 읽게 두지 않는다(현장 조명·색각 이상).
IconData vitalStatusIcon(VitalStatus s) => switch (s) {
  VitalStatus.idle => Icons.remove,
  VitalStatus.normal => Icons.check_circle,
  VitalStatus.caution => Icons.error_outline,
  VitalStatus.danger => Icons.warning_amber_rounded,
};

/// 격자 한 칸. 참고 디자인의 뼈대 그대로 — 아이콘+이름 / 큰 값+단위 / 상태줄, 오른쪽에 세로 막대.
///
/// 높이를 스스로 고정하지 않는다 — 한 줄의 칸들을 [VitalCardGrid] 가 `IntrinsicHeight` 로
/// 맞춘다. 고정하면 좁은 기기에서 이름이 두 줄이 될 때 그 줄만 넘친다.
class VitalCard extends StatelessWidget {
  const VitalCard({super.key, required this.row});

  final VitalRow row;

  @override
  Widget build(BuildContext context) {
    final range = row.range;
    final numeric = row.numeric;
    final hasBar = range != null && numeric != null;
    final has = row.value != _noValue;

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(9, 5, 7, 5),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Icon(vitalCardIcon(row.label), size: 11, color: VgColors.muted),
                      const SizedBox(width: 3),
                      Expanded(
                        // 두 줄까지 쓰고 자르지 않는다 — 잘린 이름은 아이콘만 있던 때와 같다
                        // (`summary_strip_test` 가 320px 까지 좌표로 고정한다).
                        child: Text(
                          row.label,
                          maxLines: 2,
                          style: TextStyle(
                            fontSize: 11,
                            height: 1.1,
                            fontWeight: FontWeight.w600,
                            color: has ? VgColors.body : VgColors.muted,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Flexible(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            row.value,
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              height: 1.1,
                              color: has
                                  ? vgValueColor(hasBar ? range.statusOf(numeric) : null)
                                  : VgColors.muted,
                            ),
                          ),
                        ),
                      ),
                      if (row.unit.isNotEmpty) ...[
                        const SizedBox(width: 2),
                        Text(
                          row.unit,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 9, color: VgColors.muted),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 1),
                  // 임계가 있는 칸만 판정을 말한다. 나머지는 값의 성격을 적는다.
                  if (hasBar)
                    _StatusLine(status: range.statusOf(numeric))
                  else
                    Text(
                      row.detail ?? (has ? '' : '미수신'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 9, color: VgColors.muted),
                    ),
                ],
              ),
            ),
            if (hasBar) ...[
              const SizedBox(width: 5),
              VerticalRangeBar(range: range, value: numeric, height: 42),
            ],
          ],
        ),
      ),
    );
  }
}

/// 상태 표지 + 글자. 알약 배지(`StatusBadge`)보다 낮아 칸 높이를 덜 먹는다.
class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.status});

  final VitalStatus status;

  @override
  Widget build(BuildContext context) {
    final c = vgStatusColor(status);
    return Row(
      children: [
        Icon(vitalStatusIcon(status), size: 11, color: c),
        const SizedBox(width: 3),
        Flexible(
          child: Text(
            vitalStatusLabel[status] ?? '',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: c),
          ),
        ),
      ],
    );
  }
}

/// 여러 열 격자. **모자라는 칸은 빈 자리로 둔다** — 늘려 채우면 그 칸만 넓어져 열이 어긋난다.
class VitalCardGrid extends StatelessWidget {
  const VitalCardGrid({super.key, required this.rows, this.columns = 3, this.gap = 7});

  final List<VitalRow> rows;
  final int columns;
  final double gap;

  @override
  Widget build(BuildContext context) {
    final lines = <Widget>[];
    for (var i = 0; i < rows.length; i += columns) {
      if (lines.isNotEmpty) lines.add(SizedBox(height: gap));
      final cells = <Widget>[];
      for (var c = 0; c < columns; c++) {
        if (c > 0) cells.add(SizedBox(width: gap));
        final k = i + c;
        cells.add(Expanded(child: k < rows.length ? VitalCard(row: rows[k]) : const SizedBox()));
      }
      // 한 줄의 칸 높이를 서로 맞춘다 — 들쭉날쭉하면 값끼리 눈으로 비교가 안 된다.
      lines.add(
        IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: cells),
        ),
      );
    }
    return Column(children: lines);
  }
}

/// 격자에 쓰는 짧은 이름. 원본 라벨은 서버·목록과 맞물려 있어 못 바꾸고,
/// 칸 폭은 좁다. **여기 한 곳에서만** 줄인다 — 두 벌이 되면 같은 값이 화면마다 다르게 불린다.
const Map<String, String> _shortLabels = {'체온(심박 추정)': '체온(추정)', '생리적 부담(PSI)': '생리적 부담'};

/// 값이 없어도 자리를 지키는 칸 — `(원본 라벨, 미수신일 때 보일 단위)`.
///
/// ★ 빈 자리로 두지 않는 이유. 항목까지 사라지면 "그런 걸 재고 있는지" 조차 안 보인다
///   (2026-08-18 실기기). 단위는 남겨 무엇을 재는 칸인지 말하게 한다.
const List<(String, String)> _leadSlots = [
  ('산소포화도', '%'),
  ('체온(심박 추정)', '℃'),
  ('심박변이(HRV)', 'ms'),
  ('안정 심박', 'bpm'),
  ('호흡수', '회/분'),
  ('생리적 부담(PSI)', '/10'),
  ('스트레스', '지수'),
];

/// 활동 누계는 성격이 달라 **뒤로 몰아** 둔다(`activityLabels` 주석).
/// ⚠ `오른 층` 은 여기 없다 — 2026-08-20 사용자 결정으로 격자에서 뺐고 수집만 한다.
const List<(String, String)> _tailSlots = [('걸음', '보'), ('정지 지속', '초')];

/// 격자에 그릴 칸을 순서대로 만든다. 순수 함수라 화면 없이 테스트된다.
///
/// ★ **서식을 여기서 새로 만들지 않는다** — 값은 `buildVitalRows`·`buildServerRows` 가
///   이미 만든 것을 라벨로 찾아 쓴다. 두 벌이 되면 같은 값이 화면에서 다르게 보인다.
List<VitalRow> buildHealthMonitorRows({VitalStreamEvent? vitals, OwnVitals? own}) {
  final measured = <VitalRow>[
    if (vitals != null) ...buildVitalRows(vitals),
    ...buildServerRows(own),
  ];
  VitalRow? pick(String label) {
    for (final r in measured) {
      if (r.label == label) return r;
    }
    return null;
  }

  VitalRow slot((String, String) s) {
    final found = pick(s.$1);
    final short = _shortLabels[s.$1] ?? s.$1;
    if (found == null) {
      return VitalRow(label: short, value: _noValue, unit: s.$2, detail: '미수신');
    }
    return VitalRow(
      label: short,
      value: found.value,
      // 값이 있으면 그 행의 단위를 쓴다 — 없을 때만 고정 단위로 무엇을 재는 칸인지 말한다.
      unit: found.unit.isEmpty ? s.$2 : found.unit,
      detail: found.detail,
      range: found.range,
      numeric: found.numeric,
    );
  }

  final taken = {..._leadSlots.map((s) => s.$1), ..._tailSlots.map((s) => s.$1)};
  // 고정 칸에 안 들어간 측정값(운동 강도·일광 시간·보행 심박 …).
  // 활동 누계는 `splitVitalSections` 가 갈라내므로 `오른 층` 이 여기로 새지 않는다.
  final extra = splitVitalSections(measured).body.where((r) => !taken.contains(r.label)).toList();

  return [..._leadSlots.map(slot), ...extra, ..._tailSlots.map(slot)];
}
