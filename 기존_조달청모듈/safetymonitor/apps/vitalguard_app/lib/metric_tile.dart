// 생체 값 타일과 정상 범위 막대 — 참고 디자인의 "값 + 범위 안 위치" 표현을 라이트 테마로 옮긴 것
//
// 막대는 `range` 가 있는 종류에만 붙는다. 근거 있는 임계가 심박·SpO₂ 뿐이라
// 나머지 타일은 값·단위·측정 시각만 적는다(vital_range.dart 참조).
import 'package:flutter/material.dart';

import 'theme.dart';
import 'vital_display.dart';
import 'vital_range.dart';

Color vgStatusColor(VitalStatus s) => switch (s) {
      VitalStatus.idle => VgColors.muted,
      VitalStatus.normal => VgColors.normal,
      VitalStatus.caution => VgColors.caution,
      VitalStatus.danger => VgColors.danger,
    };

/// 큰 수치의 색 — 관제웹 어법을 그대로 따른다(통계 카드의 값이 브랜드색).
/// 상태는 배지·막대·점이 전담하므로 값은 **브랜드 파랑**이고, **위험일 때만 빨강**이다.
/// 위험을 파랑으로 두면 화면에서 가장 큰 글자가 위험을 숨긴다.
Color vgValueColor(VitalStatus? status) =>
    status == VitalStatus.danger ? VgColors.danger : VgColors.primary;

/// 밴드 색 — 채도를 낮춰 깔고 그 위의 점이 값을 가리킨다. 막대가 진하면 점이 안 보인다.
Color _bandFill(VitalStatus s) => vgStatusColor(s).withValues(alpha: 0.28);

/// 상태 배지 — 색만으로 읽게 두지 않고 글자를 함께 적는다(현장 조명·색각 이상).
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status});

  final VitalStatus status;

  @override
  Widget build(BuildContext context) {
    final c = vgStatusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        vitalStatusLabel[status] ?? '',
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: c),
      ),
    );
  }
}

/// 타일 오른쪽의 세로 막대. 위가 큰 값이다.
class VerticalRangeBar extends StatelessWidget {
  const VerticalRangeBar({super.key, required this.range, required this.value, this.height = 56});

  final VitalRange range;
  final double value;
  final double height;

  @override
  Widget build(BuildContext context) {
    final status = range.statusOf(value);
    // 위가 최대값이므로 밴드를 뒤집어 쌓는다.
    final bands = range.bands.reversed.toList();
    return SizedBox(
      width: 14,
      height: height,
      child: Stack(
        alignment: Alignment.center,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: SizedBox(
              width: 5,
              height: height,
              child: Column(
                // ★ stretch 필수 — ColoredBox 는 자식이 없어 기본 center 정렬에서
                //   교차축이 0 으로 접힌다(막대가 통째로 안 보인다 · 골든 렌더에서 잡힘).
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final b in bands)
                    Expanded(
                      // flex 는 정수라 밴드 폭 비율을 1000 배로 키워 반올림 오차를 줄인다.
                      flex: (((b.to - b.from) / (range.max - range.min)) * 1000).round(),
                      child: ColoredBox(color: _bandFill(b.status)),
                    ),
                ],
              ),
            ),
          ),
          Align(
            // position 0 = 최소값 = 아래. Align 의 y 는 -1 이 위라 뒤집는다.
            alignment: Alignment(0, 1 - 2 * range.positionOf(value)),
            child: Container(
              width: 11,
              height: 11,
              decoration: BoxDecoration(
                color: VgColors.canvas,
                shape: BoxShape.circle,
                border: Border.all(color: vgStatusColor(status), width: 2.5),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 히어로(실시간 심박)용 가로 막대. 세로판과 같은 밴드를 눕힌 것이다.
class HorizontalRangeBar extends StatelessWidget {
  const HorizontalRangeBar({super.key, required this.range, required this.value});

  final VitalRange range;
  final double value;

  @override
  Widget build(BuildContext context) {
    final status = range.statusOf(value);
    return SizedBox(
      height: 16,
      child: Stack(
        alignment: Alignment.center,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: SizedBox(
              height: 6,
              child: Row(
                // ★ stretch 필수 — 세로 막대와 같은 이유(교차축 0 붕괴).
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final b in range.bands)
                    Expanded(
                      flex: (((b.to - b.from) / (range.max - range.min)) * 1000).round(),
                      child: ColoredBox(color: _bandFill(b.status)),
                    ),
                ],
              ),
            ),
          ),
          Align(
            alignment: Alignment(2 * range.positionOf(value) - 1, 0),
            child: Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                color: VgColors.canvas,
                shape: BoxShape.circle,
                border: Border.all(color: vgStatusColor(status), width: 3),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 격자 한 칸. 막대가 있는 타일과 없는 타일의 **높이를 같게** 둔다 —
/// 칸 높이가 들쭉날쭉하면 값끼리 눈으로 비교가 안 된다.
class MetricTile extends StatelessWidget {
  const MetricTile({super.key, required this.row});

  final VitalRow row;

  @override
  Widget build(BuildContext context) {
    final range = row.range;
    final numeric = row.numeric;
    final hasBar = range != null && numeric != null;

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, color: VgColors.body),
                  ),
                  const Spacer(),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Flexible(
                        child: Text(
                          row.value,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.bold,
                            color: vgValueColor(hasBar ? range.statusOf(numeric) : null),
                            height: 1.1,
                          ),
                        ),
                      ),
                      if (row.unit.isNotEmpty) ...[
                        const SizedBox(width: 3),
                        Text(row.unit,
                            style: const TextStyle(fontSize: 12, color: VgColors.muted)),
                      ],
                    ],
                  ),
                  const SizedBox(height: 6),
                  // 막대가 있으면 상태 배지, 없으면 보조 문구. 둘 다 한 줄이라 높이가 같다.
                  if (hasBar)
                    StatusBadge(status: range.statusOf(numeric))
                  else
                    Text(
                      row.detail ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11, color: VgColors.muted),
                    ),
                ],
              ),
            ),
            if (hasBar) ...[
              const SizedBox(width: 8),
              Center(child: VerticalRangeBar(range: range, value: numeric)),
            ],
          ],
        ),
      ),
    );
  }
}
