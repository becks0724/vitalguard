import 'package:flutter/material.dart';

import '../../data/models/site_status.dart';
import '../../vg_theme.dart';

// 끊김은 별도 축이다. 서버처럼 주의/위험 필터와 겹칠 수 있다.
enum _WorkerFilter {
  all('전체'),
  normal('정상'),
  caution('주의'),
  danger('위험'),
  idle('대기'),
  stale('끊김');

  const _WorkerFilter(this.label);
  final String label;

  bool matches(WorkerItem item) => switch (this) {
    all => true,
    stale => item.stale == true,
    _ => item.tone == name,
  };

  int? count(SiteStatusWorkers workers) => switch (this) {
    all => workers.total,
    normal => workers.normal,
    caution => workers.caution,
    danger => workers.danger,
    idle => workers.waiting,
    stale => workers.stale,
  };
}

/// S-02. 조회/권한/수신 상태는 S-01이 소유하며 목록은 같은 스냅샷을 읽는다.
class WorkersScreen extends StatefulWidget {
  const WorkersScreen({
    super.key,
    required this.workers,
    required this.forbidden,
    required this.receipt,
    required this.onBack,
  });

  final SiteStatusWorkers? workers;
  final bool forbidden;
  final Widget receipt;
  final VoidCallback onBack;

  @override
  State<WorkersScreen> createState() => _WorkersScreenState();
}

class _WorkersScreenState extends State<WorkersScreen> {
  _WorkerFilter _filter = _WorkerFilter.all;

  @override
  Widget build(BuildContext context) {
    final workers = widget.forbidden ? null : widget.workers;
    final rows = workers?.ok == true
        ? workers!.items.where(_filter.matches).toList()
        : <WorkerItem>[];
    return CustomScrollView(
      key: const Key('workers-list-scroll'),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.all(24),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    key: const Key('workers-back'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(vgTapMin, vgTapMin),
                    ),
                    onPressed: widget.onBack,
                    icon: const Icon(Icons.arrow_back),
                    label: const Text('현장 요약으로'),
                  ),
                ),
                const SizedBox(height: vgGapTap),
                Text(
                  '작업자 목록',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 16),
                widget.receipt,
                const SizedBox(height: 16),
                if (!widget.forbidden) ...[
                  if (workers == null)
                    const Text('작업자 데이터 없음 · 목록을 아직 받지 못했습니다')
                  else if (!workers.ok)
                    const Text(
                      '작업자 수신 실패 · 작업자 목록을 확인할 수 없습니다. 새로고침해 주세요.',
                      key: Key('workers-section-error'),
                    )
                  else ...[
                    Text(switch (workers.piiRedacted) {
                      true => '위치 가림 · 개인정보 보호 설정에 따라 서버가 위치를 가렸습니다.',
                      false => '위치 표시 허용 · 수신된 좌표를 표시합니다.',
                      null => '위치 표시 보류 · 개인정보 가림 여부를 받지 못했습니다. 새로고침해 주세요.',
                    }, key: const Key('workers-pii')),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: vgGapTap,
                      runSpacing: vgGapTap,
                      children: [
                        for (final filter in _WorkerFilter.values)
                          _filterButton(filter, workers),
                      ],
                    ),
                    const SizedBox(height: 16),
                    const Text('서버 집계 기준 · 끊김은 주의·위험과 겹칠 수 있습니다.'),
                    if (workers.omittedItems > 0)
                      Text(
                        '식별 정보가 없거나 중복된 작업자 ${workers.omittedItems}건은 표시하지 못했습니다.',
                      ),
                    if (!workers.itemsAvailable)
                      const Text('작업자 데이터 없음 · 개별 목록을 받지 못했습니다')
                    else if (workers.items.isEmpty && workers.omittedItems > 0)
                      const Text('작업자 데이터 확인 불가 · 개별 목록의 식별 정보를 확인해 주세요')
                    else if (workers.items.isEmpty && (workers.total ?? 0) > 0)
                      const Text('작업자 데이터 없음 · 집계 인원에 해당하는 개별 목록이 비어 있습니다')
                    else if (workers.items.isEmpty)
                      const Text('작업자 0명 · 수신한 목록이 비어 있습니다')
                    else
                      Text('수신 목록 필터 결과 ${rows.length}명'),
                    if (workers.items.isNotEmpty && rows.isEmpty)
                      const Text('수신한 목록에 선택한 상태의 작업자가 없습니다'),
                  ],
                ],
              ],
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          sliver: SliverList.builder(
            itemCount: rows.length,
            itemBuilder: (context, index) => Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: _WorkerCard(
                item: rows[index],
                piiRedacted: workers?.piiRedacted,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _filterButton(_WorkerFilter filter, SiteStatusWorkers workers) {
    final selected = _filter == filter;
    final count = filter.count(workers);
    final text = '${filter.label} ${count == null ? '데이터 없음' : '$count명'}';
    return Semantics(
      selected: selected,
      child: OutlinedButton(
        key: Key('workers-filter-${filter.name}'),
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(vgTapMin, vgTapMin),
          backgroundColor: selected ? VgColors.primarySubtle : VgColors.canvas,
          foregroundColor: VgColors.ink,
          side: BorderSide(color: selected ? VgColors.primary : VgColors.body),
        ),
        onPressed: () => setState(() => _filter = filter),
        child: Text(selected ? '✓ $text' : text),
      ),
    );
  }
}

class _WorkerCard extends StatelessWidget {
  const _WorkerCard({required this.item, required this.piiRedacted});
  final WorkerItem item;
  final bool? piiRedacted;

  @override
  Widget build(BuildContext context) => Material(
    key: Key('worker-card-${item.workerId}'),
    color: VgColors.canvas,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(vgRadiusCard),
      side: const BorderSide(color: VgColors.hairlineStrong),
    ),
    clipBehavior: Clip.antiAlias,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ConstrainedBox(
          key: Key('worker-header-${item.workerId}'),
          // V-5: 기본 정보 행 72dp. 확대 글자는 줄바꿈하고 높이가 늘어난다.
          constraints: const BoxConstraints(minHeight: 72),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                _WorkerMark(item: item),
                const SizedBox(width: 16),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: '${item.name ?? item.workerId}  ',
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        TextSpan(text: item.label ?? '상태 데이터 없음'),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('직급 ${item.jobTitle ?? '데이터 없음'} · ID ${item.workerId}'),
              Text(switch (item.worn) {
                true => '착용 중',
                false => '미착용',
                null => '착용 여부 데이터 없음',
              }),
              const SizedBox(height: 8),
              if (item.stale == true)
                const Text('연결 끊김 · 생체값은 현재값으로 표시하지 않습니다')
              else
                Wrap(
                  spacing: 24,
                  runSpacing: 8,
                  children: [
                    Text(_metric('심박', item.heartRate, 'bpm', 0)),
                    Text(_metric('산소포화도', item.spo2, '%', 0)),
                    Text(_metric('피부체온', item.skinTempC, '°C', 1)),
                    Text(_metric('심부체온 추정', item.coreTempC, '°C', 1)),
                  ],
                ),
              if (item.stale == null) const Text('연결 상태 데이터 없음'),
              if (item.staleLabel != null) Text(item.staleLabel!),
              const SizedBox(height: 8),
              Text('마지막 측정 ${alertTime(item.lastSeenAt)}'),
              Text(
                item.ageSec == null
                    ? '수신 당시 경과 시간 데이터 없음'
                    : '수신 당시 ${item.ageSec}초 경과',
              ),
              const SizedBox(height: 8),
              Text(
                _location(item, piiRedacted),
                key: Key('worker-location-${item.workerId}'),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

// DemoDashboard의 정수 생체값·소수 1자리 체온 표기만 맞춘다. 서버 tone은 그대로 쓴다.
String _metric(String label, num? value, String unit, int digits) =>
    '$label ${value == null ? '데이터 없음' : '${value.toStringAsFixed(digits)} $unit'}';

String _number(num value) => value == value.roundToDouble()
    ? value.toInt().toString()
    : value.toString();

String _location(WorkerItem item, bool? redacted) {
  if (redacted == true) return '위치 가림 · 개인정보 보호 설정 적용';
  if (redacted == null) return '위치 표시 보류 · 가림 여부 확인 후 표시합니다';
  if (item.latitude == null || item.longitude == null) {
    return '위치 데이터 없음 · 서버에서 좌표를 받지 못했습니다.';
  }
  final accuracy = item.locationAccuracyMeters;
  return '마지막 수신 위치 · 위도 ${_number(item.latitude!)} · 경도 ${_number(item.longitude!)}\n'
      '${accuracy == null ? '위치 정확도 데이터 없음' : '위치 정확도 ${accuracy.toStringAsFixed(0)} m'}';
}

class _WorkerMark extends StatelessWidget {
  const _WorkerMark({required this.item});
  final WorkerItem item;

  @override
  Widget build(BuildContext context) {
    final (symbol, label, color) = switch (item.tone) {
      'normal' => ('✓', '정상', VgColors.ok),
      'caution' => ('!', '주의', VgColors.warn),
      'danger' => ('!!', '위험', VgColors.danger),
      'idle' => ('—', '대기', VgColors.surfaceStrong),
      _ => ('?', '상태 확인 불가', VgColors.surfaceStrong),
    };
    return Semantics(
      label: '$label${item.stale == true ? ' · 끊김' : ''}',
      child: ExcludeSemantics(
        child: Container(
          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: color,
            shape: item.tone == 'danger' ? BoxShape.circle : BoxShape.rectangle,
            borderRadius: item.tone == 'danger'
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
    );
  }
}
