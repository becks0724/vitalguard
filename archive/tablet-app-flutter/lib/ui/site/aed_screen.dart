import 'package:flutter/material.dart';

import '../../data/models/site_status.dart';
import 'site_detail_widgets.dart';

/// S-05. 교환 일수는 서버 값이며 경과 일수도 그대로 표시한다.
class AedScreen extends StatelessWidget {
  const AedScreen({
    super.key,
    required this.aed,
    required this.forbidden,
    required this.receipt,
    required this.onBack,
  });

  final SiteStatusAed? aed;
  final bool forbidden;
  final Widget receipt;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final data = forbidden ? null : aed;
    return SiteDetailBody(
      prefix: 'aed',
      title: 'AED 상세',
      receipt: receipt,
      onBack: onBack,
      children: [
        if (!forbidden)
          if (data == null)
            const Text('AED 데이터 없음 · 아직 받지 못했습니다')
          else if (!data.ok)
            const Text(
              'AED 수신 실패 · 기기 상태를 확인할 수 없습니다. 새로고침해 주세요.',
              key: Key('aed-section-error'),
            )
          else ...[
            SiteDetailPanel(
              children: [
                SiteDetailRow(
                  child: SiteDetailJudgment(level: data.level, title: 'AED'),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(data.summary ?? '요약 데이터 없음'),
                      Text(
                        data.total == null
                            ? '등록 기기 수 데이터 없음'
                            : '등록 기기 ${data.total}대',
                        key: const Key('aed-total'),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(
              '교환·점검 일정',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const Text('교환까지 남은 일수는 서버가 보낸 값입니다. 점검 예정일은 제공되지 않았습니다.'),
            const SizedBox(height: 16),
            if (!data.devicesAvailable)
              const Text(
                'AED 기기 데이터 없음 · 목록을 받지 못했습니다',
                key: Key('aed-list-missing'),
              )
            else if (data.devices.isEmpty && data.omittedDevices > 0)
              const Text('AED 기기 데이터 확인 불가 · 식별 정보를 확인해 주세요')
            else if (data.devices.isEmpty)
              Text(
                data.total == 0
                    ? '등록된 AED 0대 · 수신한 기기 목록이 비어 있습니다'
                    : 'AED 기기 데이터 없음 · 등록 수에 해당하는 목록을 확인할 수 없습니다',
                key: const Key('aed-empty'),
              ),
            if (data.omittedDevices > 0)
              Text('식별 정보가 없거나 중복된 AED ${data.omittedDevices}건은 표시하지 못했습니다.'),
            if (data.devices.isNotEmpty)
              SiteDetailPanel(
                key: const Key('aed-devices'),
                children: [
                  for (final (index, device) in data.devices.indexed) ...[
                    if (index > 0) const Divider(height: 1),
                    SiteDetailRow(
                      key: Key('aed-header-${device.deviceId}'),
                      child: SiteDetailJudgment(
                        level: device.level,
                        title: device.loc ?? '위치 데이터 없음',
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('기기 ID ${device.deviceId}'),
                          if (device.summary != null) Text(device.summary!),
                          const SizedBox(height: 8),
                          Text(
                            '배터리 교환 ${aedDueText(device.batteryDueDays)}',
                            key: Key('aed-battery-${device.deviceId}'),
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '전극패드 교환 ${aedDueText(device.padsDueDays)}',
                            key: Key('aed-pads-${device.deviceId}'),
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
          ],
      ],
    );
  }
}
