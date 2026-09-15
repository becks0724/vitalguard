import 'package:flutter/material.dart';

import '../../vg_theme.dart';

/// S-05/S-06 공통 틀. 조회·권한·타이머는 SiteScreen이 소유한다.
class SiteDetailBody extends StatelessWidget {
  const SiteDetailBody({
    super.key,
    required this.prefix,
    required this.title,
    required this.receipt,
    required this.onBack,
    required this.children,
  });

  final String prefix, title;
  final Widget receipt;
  final VoidCallback onBack;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    key: Key('$prefix-detail-scroll'),
    padding: const EdgeInsets.all(24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            key: Key('$prefix-back'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(vgTapMin, vgTapMin),
            ),
            onPressed: onBack,
            icon: const Icon(Icons.arrow_back),
            label: const Text('현장 요약으로'),
          ),
        ),
        const SizedBox(height: vgGapTap),
        Text(title, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        receipt,
        const SizedBox(height: 16),
        ...children,
      ],
    ),
  );
}

class SiteDetailPanel extends StatelessWidget {
  const SiteDetailPanel({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Material(
    color: VgColors.canvas,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(vgRadiusCard),
      side: const BorderSide(color: VgColors.hairlineStrong),
    ),
    clipBehavior: Clip.antiAlias,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}

/// V-5: 기본 72dp, 글자 확대 시 자연스럽게 높이를 늘린다.
class SiteDetailRow extends StatelessWidget {
  const SiteDetailRow({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 72),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Align(alignment: Alignment.centerLeft, child: child),
    ),
  );
}

class SiteDetailJudgment extends StatelessWidget {
  const SiteDetailJudgment({
    super.key,
    required this.level,
    required this.title,
  });
  final String? level;
  final String title;

  @override
  Widget build(BuildContext context) {
    final (symbol, label, color) = switch (level) {
      'normal' => ('✓', '정상', VgColors.ok),
      'warn' || 'caution' => ('!', '주의', VgColors.warn),
      'danger' => ('!!', '위험', VgColors.danger),
      'idle' => ('—', '대기', VgColors.surfaceStrong),
      _ => ('?', '확인 불가', VgColors.surfaceStrong),
    };
    return Row(
      children: [
        ExcludeSemantics(
          child: Container(
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color,
              shape: level == 'danger' ? BoxShape.circle : BoxShape.rectangle,
              borderRadius: level == 'danger' ? null : BorderRadius.circular(6),
              border: Border.all(color: VgColors.ink),
            ),
            child: Text(
              symbol,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Text(
            '$title · 판정 $label',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
        ),
      ],
    );
  }
}
