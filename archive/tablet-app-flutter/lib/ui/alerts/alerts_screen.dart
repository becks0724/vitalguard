import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/alerts_controller.dart';
import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';
import '../site/site_screen.dart';

class AlertsScreen extends StatefulWidget {
  const AlertsScreen({
    super.key,
    required this.controller,
    this.active = true,
    this.now,
    this.alerts,
  });

  final FieldController controller;
  // 셸과 같은 수신/쓰기 상태를 사용한다. 단독 화면은 기존처럼 자체 소유한다.
  final AlertsController? alerts;
  final bool active;
  final DateTime Function()? now;

  @override
  AlertsScreenState createState() => AlertsScreenState();
}

class AlertsScreenState extends State<AlertsScreen>
    with WidgetsBindingObserver {
  late AlertsController _alerts;
  Timer? _timer;
  bool _foreground = true;
  bool _acknowledged = false;
  AlertType? _type;
  AlertItem? _selected;

  @override
  void initState() {
    super.initState();
    _alerts = widget.alerts ?? AlertsController(widget.controller);
    WidgetsBinding.instance.addObserver(this);
    final state = WidgetsBinding.instance.lifecycleState;
    _foreground = state == null || state == AppLifecycleState.resumed;
    _sync();
  }

  @override
  void didUpdateWidget(AlertsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller ||
        oldWidget.alerts != widget.alerts) {
      if (oldWidget.alerts == null) _alerts.dispose();
      _alerts = widget.alerts ?? AlertsController(widget.controller);
      _selected = null;
    }
    if (oldWidget.active != widget.active ||
        oldWidget.controller != widget.controller ||
        oldWidget.alerts != widget.alerts) {
      _sync();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync();
  }

  void _sync() {
    _timer?.cancel();
    if (!widget.active || !_foreground) return;
    if (!widget.controller.offline) unawaited(_alerts.refresh());
    // 자동 작업은 조회뿐이다. 비활성 탭·백그라운드에서는 중지한다.
    _timer = Timer.periodic(siteStatusRefreshInterval, (_) {
      unawaited(_alerts.refresh());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    if (widget.alerts == null) _alerts.dispose();
    super.dispose();
  }

  // L-07: 스트립을 직접 누른 경우에만 기존 상세 선택으로 연결한다.
  void openDetail(AlertItem alert) {
    if (!_alerts.authorized || _alerts.forbidden) return;
    setState(() => _selected = alert);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _alerts,
    builder: (context, _) => PopScope(
      canPop: _selected == null || !widget.active,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && widget.active) setState(() => _selected = null);
      },
      child: SingleChildScrollView(
        key: Key(
          _selected == null ? 'alerts-list-scroll' : 'alerts-detail-scroll',
        ),
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _selected == null ? '경보 목록' : '경보 상세',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            const Text(
              '전체 현장 기준 · 현장별로 한정되지 않은 경보입니다',
              key: Key('alerts-scope'),
            ),
            const SizedBox(height: 16),
            _receipt(),
            const SizedBox(height: 16),
            if (_alerts.forbidden || !_alerts.authorized)
              const Text(
                '경보 접근 권한을 확인할 수 없습니다. 관리자에게 문의해 주세요.',
                key: Key('alerts-forbidden'),
              )
            else if (_selected == null)
              _list()
            else
              _detail(),
          ],
        ),
      ),
    ),
  );

  Widget _receipt() {
    final data = _alerts.data;
    final stale =
        data != null &&
        (widget.now?.call() ?? DateTime.now()).toUtc().difference(
              DateTime.parse(data.fetchedAt),
            ) >=
            siteStatusStaleAfter;
    return _Panel(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _alerts.forbidden || !_alerts.authorized
                  ? '마지막 수신 정보 표시 불가 · 접근 권한 없음'
                  : siteStatusReceipt(data?.fetchedAt),
              key: const Key('alerts-receipt'),
            ),
            if (widget.controller.offline)
              const Text(
                '오프라인 · 대응 확인은 연결 후 가능',
                key: Key('alerts-offline'),
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
            if (stale) const Text('오래된 자료 · 마지막 수신 후 5분 이상 지났습니다'),
            if (_alerts.loading)
              const Text('서버 상태 조회 중 · 수신 완료 전까지 이전 자료를 표시합니다'),
            if (_alerts.readFailed)
              const Text(
                '경보 조회 실패 · 이전에 받은 내용만 표시합니다. 연결 상태를 확인해 주세요.',
                key: Key('alerts-read-error'),
              ),
            if (!_alerts.forbidden && _alerts.authorized) ...[
              const Text('활성 화면에서 1분마다 조회합니다. 아래 버튼으로도 다시 조회할 수 있습니다.'),
              const SizedBox(height: vgGapTap),
              Wrap(
                spacing: vgGapTap,
                runSpacing: vgGapTap,
                children: [
                  if (_selected != null)
                    OutlinedButton.icon(
                      key: const Key('alerts-back'),
                      style: _buttonStyle(),
                      onPressed: () => setState(() => _selected = null),
                      icon: const Icon(Icons.arrow_back),
                      label: const Text('목록으로'),
                    ),
                  OutlinedButton.icon(
                    key: const Key('alerts-refresh'),
                    style: _buttonStyle(),
                    onPressed: _alerts.loading || _alerts.sending
                        ? null
                        : _alerts.refresh,
                    icon: const Icon(Icons.refresh),
                    label: const Text('서버 상태 다시 조회'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _list() {
    final rows = _alerts.items.where(
      (row) =>
          row.acknowledged == _acknowledged &&
          (_type == null || row.type == _type),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: vgGapTap,
          runSpacing: vgGapTap,
          children: [
            for (final done in [false, true])
              _filter(
                key: Key('alerts-filter-${done ? 'acked' : 'unacked'}'),
                selected: _acknowledged == done,
                text: done ? '대응완료' : '미대응',
                onPressed: () => setState(() => _acknowledged = done),
              ),
          ],
        ),
        const SizedBox(height: vgGapTap),
        Wrap(
          key: const Key('alerts-types'),
          spacing: vgGapTap,
          runSpacing: vgGapTap,
          children: [
            _filter(
              key: const Key('alerts-type-all'),
              selected: _type == null,
              text: '전체 종류',
              onPressed: () => setState(() => _type = null),
            ),
            for (final type in AlertType.values)
              _filter(
                key: Key('alerts-type-${type.name}'),
                selected: _type == type,
                text: type.label,
                onPressed: () => setState(() => _type = type),
              ),
          ],
        ),
        const SizedBox(height: 16),
        if (_alerts.data != null) ...[
          Text(
            '마지막 수신 기준 · 전체 현장 미대응 ${_alerts.data!.alerts.unacked?.toString() ?? '수신 안 됨'}'
            '${_alerts.data!.alerts.unacked == null ? '' : '건'} · 아래는 수신 목록의 필터 결과 ${rows.length}건',
          ),
          if (_alerts.data!.alerts.omittedItems > 0)
            const Text('종류 또는 필수 정보를 확인할 수 없는 경보가 있습니다. 관제 화면에서 확인해 주세요.'),
          const SizedBox(height: 8),
        ],
        if (_alerts.data == null)
          const Text('경보 데이터 없음 · 목록을 아직 받지 못했습니다')
        else if (rows.isEmpty)
          const Text('수신한 목록에 선택한 조건의 경보가 없습니다')
        else
          _Panel(
            key: const Key('alerts-rows'),
            child: Column(
              children: [
                for (final (index, row) in rows.indexed) ...[
                  if (index > 0) const Divider(height: 1),
                  InkWell(
                    key: Key('alert-row-${row.id}'),
                    // L-02: 행 탭은 상세 선택만 한다. 대응 확인은 여기서 호출하지 않는다.
                    onTap: () => setState(() => _selected = row),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 72),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        child: Row(
                          children: [
                            Icon(
                              row.acknowledged
                                  ? Icons.task_alt
                                  : Icons.warning_amber_rounded,
                              color: VgColors.ink,
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text:
                                          '${row.type.label} · ${_worker(row)}\n',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    TextSpan(
                                      text:
                                          '${alertTime(row.ts)} · ${_rowState(row)}',
                                    ),
                                    if (row.acknowledged)
                                      TextSpan(
                                        text: '\n처리자 ${row.ackBy ?? '정보 없음'}',
                                      ),
                                  ],
                                ),
                              ),
                            ),
                            const Icon(Icons.chevron_right),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }

  String _rowState(AlertItem row) => row.acknowledged
      ? '대응완료'
      : _alerts.reopened.contains(row.id)
      ? '다시 열린 경보 · 미대응'
      : '미대응';

  Widget _detail() {
    final current = _alerts.item(_selected!.id);
    final row = current ?? _selected!;
    final phase = _alerts.phase(row.id);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Panel(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${row.type.label} · ${_worker(row)}',
                  key: const Key('alert-target'),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text('작업자 ID · ${row.workerId ?? '정보 없음'}'),
                Text('경보 ID · ${row.id}'),
                Text(
                  '발생 시각 · ${alertTime(row.ts)}',
                  key: const Key('alert-time'),
                ),
                Text('등록 시각 · ${alertTime(row.createdAt)}'),
                Text('수신 상태 · ${_rowState(row)}'),
                if (row.acknowledged) ...[
                  Text('대응 확인 시각 · ${alertTime(row.ackAt)}'),
                  Text(
                    '처리자 · ${row.ackBy ?? '정보 없음'}',
                    key: const Key('alert-ack-by'),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          '연락 방법',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const Text(
          '무전 또는 별도 전화로 관제 담당자에게 작업자 이름·ID와 경보 발생 시각을 전달해 주세요. '
          '앱에 등록된 연락처는 없습니다.',
          key: Key('alert-contact'),
        ),
        const SizedBox(height: 16),
        if (current == null)
          const Text(
            '현재 수신 목록에서 찾을 수 없습니다. 종료 여부는 확인되지 않았습니다. 서버 상태를 다시 조회해 주세요.',
            key: Key('alert-missing'),
          )
        else if (_alerts.reopened.contains(row.id))
          const Text(
            '다시 열린 경보 · 서버 상태가 대응완료에서 미대응으로 바뀌었습니다. 대상과 시각을 다시 확인해 주세요.',
            key: Key('alert-reopened'),
          )
        else if (row.acknowledged)
          Text(
            _alerts.closed.contains(row.id)
                ? '종료된 경보 · 서버에서 대응 확인이 반영되었습니다.'
                : '종료된 경보 · 대응 확인이 기록되어 있습니다.',
            key: const Key('alert-closed'),
          ),
        const SizedBox(height: 16),
        if (phase != AlertWritePhase.idle) ...[
          _writeStatus(row, phase),
          if (current != null &&
              !current.acknowledged &&
              const {
                AlertWritePhase.confirmed,
                AlertWritePhase.conflict,
              }.contains(phase))
            const Text('대응 확인 응답과 조회 목록의 상태가 아직 일치하지 않습니다. 서버 상태를 다시 조회해 주세요.'),
          const SizedBox(height: 16),
        ],
        if (row.workerId == null || row.ts == null)
          const Text('대상 또는 발생 시각 정보가 없어 대응 확인을 할 수 없습니다. 관제 담당자에게 확인해 주세요.'),
        const Text(
          '위 대상·발생 시각을 확인한 뒤 아래 버튼을 한 번 눌러 주세요. '
          '대응 확인은 위험 해제나 사고 종결을 뜻하지 않습니다.',
        ),
        const SizedBox(height: vgGapTap),
        FilledButton.icon(
          key: const Key('alert-ack'),
          style: FilledButton.styleFrom(
            minimumSize: const Size(vgTapMin, vgTapPrimary),
          ),
          onPressed: current != null && _alerts.canAck(row)
              ? () => _alerts.acknowledge(row)
              : null,
          icon: const Icon(Icons.check),
          label: Text(
            widget.controller.offline
                ? '연결 후 가능'
                : phase == AlertWritePhase.sending
                ? '처리 중'
                : '대응 확인',
          ),
        ),
      ],
    );
  }

  Widget _writeStatus(AlertItem row, AlertWritePhase phase) {
    final text = switch (phase) {
      AlertWritePhase.sending => '처리 중 · 서버 응답을 기다리고 있습니다',
      AlertWritePhase.confirmed =>
        widget.controller.isMock
            ? '모의 대응 확인됨 · 실제 서버로 보내지 않았습니다'
            : '서버 확인됨 · 대응 확인이 반영되었습니다',
      AlertWritePhase.conflict => '충돌 · 다른 관리자가 이미 처리함. 서버 목록에서 처리자를 확인합니다.',
      AlertWritePhase.failed =>
        '실패 · ${_alerts.failure(row.id)} 자동으로 다시 보내지 않습니다.',
      AlertWritePhase.uncertain =>
        '결과 불명 · 서버에서 처리했을 수 있습니다. '
            '서버 상태 재조회가 우선입니다. 자동으로 다시 보내지 않습니다.',
      AlertWritePhase.retryReady =>
        '서버 재조회됨 · 미대응 상태입니다. 대상과 시각을 다시 확인한 뒤 직접 눌러 주세요.',
      AlertWritePhase.idle => '',
    };
    return Container(
      key: Key('alert-write-${phase.name}'),
      padding: const EdgeInsets.all(16),
      color: phase == AlertWritePhase.confirmed
          ? VgColors.okTint
          : VgColors.warnTint,
      child: Text(
        text,
        style: const TextStyle(
          color: VgColors.ink,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

String _worker(AlertItem row) => row.workerName ?? row.workerId ?? '작업자 정보 없음';

ButtonStyle _buttonStyle() =>
    OutlinedButton.styleFrom(minimumSize: const Size(vgTapMin, vgTapMin));

Widget _filter({
  required Key key,
  required bool selected,
  required String text,
  required VoidCallback onPressed,
}) => Semantics(
  selected: selected,
  child: OutlinedButton(
    key: key,
    style: _buttonStyle().copyWith(
      backgroundColor: WidgetStatePropertyAll(
        selected ? VgColors.primarySubtle : VgColors.canvas,
      ),
      foregroundColor: const WidgetStatePropertyAll(VgColors.ink),
      side: WidgetStatePropertyAll(
        BorderSide(color: selected ? VgColors.primary : VgColors.body),
      ),
    ),
    onPressed: onPressed,
    child: Text(selected ? '✓ $text' : text),
  ),
);

class _Panel extends StatelessWidget {
  const _Panel({super.key, required this.child});
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
