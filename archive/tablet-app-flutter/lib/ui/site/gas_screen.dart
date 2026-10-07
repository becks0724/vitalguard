import 'package:flutter/material.dart';

import '../../data/models/site_status.dart';
import '../../vg_theme.dart';

/// S-04. S-01의 스냅샷·조회·권한 상태를 공유한다.
class GasScreen extends StatelessWidget {
  const GasScreen({
    super.key,
    required this.gas,
    required this.forbidden,
    required this.isMock,
    required this.stale,
    required this.receipt,
    required this.onBack,
  });

  final SiteStatusGas? gas;
  final bool forbidden, isMock, stale;
  final Widget receipt;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final data = forbidden ? null : gas;
    return SingleChildScrollView(
      key: const Key('gas-detail-scroll'),
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('gas-back'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(vgTapMin, vgTapMin),
              ),
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back),
              label: const Text('현장 요약으로'),
            ),
          ),
          const SizedBox(height: vgGapTap),
          Text('가스 감지기 상세', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 16),
          _GasPanel(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                isMock ? '모의 데이터 · 데모' : '실연동 모드 · 서버 데이터',
                key: const Key('gas-source'),
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          receipt,
          const SizedBox(height: 16),
          const Text(
            'raw는 센서 원시값(ADC)으로, 절대 농도가 아닙니다.',
            key: Key('gas-raw-explanation'),
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          const Text('값 옆의 서버 단위를 확인해 주세요. 판정은 서버가 보낸 상태입니다.'),
          const SizedBox(height: 16),
          if (!forbidden) ...[
            if (data == null)
              const Text('가스 데이터 없음 · 아직 받지 못했습니다')
            else if (!data.ok)
              const Text(
                '가스 수신 실패 · 감지기 상태를 확인할 수 없습니다. 새로고침해 주세요.',
                key: Key('gas-section-error'),
              )
            else ...[
              _GasPanel(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('감지기 ID ${data.deviceId ?? '데이터 없음'}'),
                      Text(
                        '감지기 마지막 수신 ${alertTime(data.lastSeenAt)}',
                        key: const Key('gas-last-seen'),
                      ),
                      Text(
                        data.power == null
                            ? '전원 데이터 없음'
                            : '전원 ${data.power} (서버 값)',
                      ),
                      if (stale)
                        const Text(
                          '감지기 수신 오래됨 · 마지막 수신 후 5분 이상 지났습니다. 아래는 이전 수신 값입니다.',
                          key: Key('gas-device-stale'),
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                      if (data.level == 'idle')
                        const Text('감지기 수신·전원 대기 · 현재 측정값을 표시하지 않습니다'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              if (!data.gasesAvailable)
                const Text('가스별 데이터 없음 · 목록을 받지 못했습니다')
              else if (data.gases.isEmpty)
                const Text('가스별 데이터 없음 · 수신 목록에서 3종의 값을 확인할 수 없습니다'),
              if (data.omittedGases > 0)
                Text('종류 식별이 안 되거나 중복된 가스 ${data.omittedGases}건은 표시하지 못했습니다.'),
              _GasPanel(
                key: const Key('gas-readings'),
                child: Column(
                  children: [
                    for (final (key, name) in const [
                      ('o2', 'O₂ 산소'),
                      ('co', 'CO 일산화탄소'),
                      ('h2s', 'H₂S 황화수소'),
                    ]) ...[
                      if (key != 'o2') const Divider(height: 1),
                      _GasRow(
                        gasKey: key,
                        name: name,
                        item: data.gases
                            .where((item) => item.key == key)
                            .firstOrNull,
                        waiting: data.level == 'idle',
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _GasRow extends StatelessWidget {
  const _GasRow({
    required this.gasKey,
    required this.name,
    required this.item,
    required this.waiting,
  });

  final String gasKey, name;
  final GasReading? item;
  final bool waiting;

  @override
  Widget build(BuildContext context) {
    final level = waiting ? 'idle' : item?.level;
    final (symbol, label, color) = switch (level) {
      'normal' => ('✓', '정상', VgColors.ok),
      'warn' => ('!', '주의', VgColors.warn),
      'danger' => ('!!', '위험', VgColors.danger),
      'idle' => ('—', '수신·전원 대기', VgColors.surfaceStrong),
      _ => ('?', '확인 불가', VgColors.surfaceStrong),
    };
    return Column(
      key: Key('gas-row-$gasKey'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ConstrainedBox(
          key: Key('gas-header-$gasKey'),
          // V-5: 작업자 화면과 같은 72dp 머리행. 확대 시 높이가 늘어난다.
          constraints: const BoxConstraints(minHeight: 72),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                ExcludeSemantics(
                  child: Container(
                    constraints: const BoxConstraints(
                      minWidth: 32,
                      minHeight: 32,
                    ),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: color,
                      shape: level == 'danger'
                          ? BoxShape.circle
                          : BoxShape.rectangle,
                      borderRadius: level == 'danger'
                          ? null
                          : BorderRadius.circular(6),
                      border: Border.all(color: VgColors.ink),
                    ),
                    child: Text(
                      symbol,
                      style: const TextStyle(
                        color: VgColors.ink,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    '${item?.gas ?? name} · 판정 $label',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _measurement(item, waiting: level == 'idle'),
                key: Key('gas-value-$gasKey'),
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                item?.unit == null
                    ? '단위 없음 · 서버 단위를 받지 못했습니다'
                    : '서버 단위 ${item!.unit}',
              ),
              const SizedBox(height: 8),
              Text(
                '위치 ${item?.loc ?? '데이터 없음'}',
                key: Key('gas-location-$gasKey'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

String _measurement(GasReading? item, {required bool waiting}) {
  if (waiting) return '측정 대기 · 수신·전원 대기';
  final value = item?.value;
  if (value == null) return '측정값 없음 · 값을 받지 못했습니다';
  // 단위가 없으면 맨숫자를 보여주거나 종류별 단위를 추측하지 않는다.
  if (item?.unit == null) return '측정값 표시 보류 · 단위를 받지 못했습니다';
  // SiteSafetyTables: O₂(%)만 소수 1자리. raw·다른 서버 단위는 그대로 보존한다.
  // 표시 반올림은 item.value나 서버 판정에 반영하지 않는다.
  final text = item!.key == 'o2' && item.unit == '%'
      ? value.toStringAsFixed(1)
      : value.toString();
  return '$text ${item.unit}';
}

class _GasPanel extends StatelessWidget {
  const _GasPanel({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Material(
    color: VgColors.canvas,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(vgRadiusCard),
      side: const BorderSide(color: VgColors.hairlineStrong),
    ),
    clipBehavior: Clip.antiAlias,
    child: child,
  );
}
