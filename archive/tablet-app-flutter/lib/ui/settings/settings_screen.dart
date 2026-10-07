import 'package:flutter/material.dart';

import '../../data/action_placement.dart';
import '../../vg_theme.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.placement});

  final ActionPlacement placement;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: placement,
    builder: (context, _) => ListView(
      key: const Key('settings-screen'),
      padding: const EdgeInsets.all(24),
      children: [
        const Text(
          '설정',
          style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 24),
        Card(
          elevation: 0,
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '실행 버튼 위치',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                const Text('잡는 손에 맞춰 자주 쓰는 버튼을 화면 하단 왼쪽 또는 오른쪽에 놓습니다.'),
                const SizedBox(height: vgGapTap),
                Wrap(
                  spacing: vgGapTap,
                  runSpacing: vgGapTap,
                  children: [
                    for (final side in ActionSide.values)
                      Semantics(
                        selected: placement.side == side,
                        inMutuallyExclusiveGroup: true,
                        child: OutlinedButton.icon(
                          key: Key('action-side-${side.name}'),
                          onPressed: !placement.loaded || placement.saving
                              ? null
                              : () => placement.select(side),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(180, vgTapMin),
                            backgroundColor: placement.side == side
                                ? Theme.of(context).colorScheme.primaryContainer
                                : null,
                          ),
                          icon: Icon(
                            placement.side == side
                                ? Icons.radio_button_checked
                                : Icons.radio_button_off,
                          ),
                          label: Text(side == ActionSide.left ? '왼손' : '오른손'),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: vgGapTap),
                const Text('기록의 촬영·스캔, 사진의 펜·댓글, 펜 편집의 도구·저장에 적용됩니다.'),
                const SizedBox(height: 12),
                const Text('이 기기에서 현재 계정의 선택을 기억합니다.'),
                if (!placement.loaded || placement.saving) ...[
                  const SizedBox(height: vgGapTap),
                  Text(placement.saving ? '저장 중…' : '선택을 불러오는 중…'),
                ],
                if (placement.error != null) ...[
                  const SizedBox(height: vgGapTap),
                  Text(
                    placement.error!,
                    key: const Key('action-side-error'),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    ),
  );
}
