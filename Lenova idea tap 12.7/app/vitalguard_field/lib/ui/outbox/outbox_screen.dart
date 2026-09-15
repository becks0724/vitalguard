import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';

class OutboxScreen extends StatefulWidget {
  const OutboxScreen({super.key, required this.controller, this.active = true});
  final FieldController controller;
  final bool active;
  @override
  State<OutboxScreen> createState() => _OutboxScreenState();
}

class _OutboxScreenState extends State<OutboxScreen>
    with WidgetsBindingObserver {
  OutboxController get queue => widget.controller.outbox;
  String? account, siteGroup;
  OutboxPhase? filter;
  String? error;
  bool _foreground = true;
  int _generation = 0;
  bool get _canLookup => mounted && widget.active && _foreground;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final state = WidgetsBinding.instance.lifecycleState;
    _foreground = state == null || state == AppLifecycleState.resumed;
    widget.controller.addListener(_accountChanged);
    _accountChanged();
  }

  void _accountChanged() {
    if (account == queue.account) return;
    account = queue.account;
    siteGroup = null;
    filter = null;
    error = null;
    _generation++;
    unawaited(_loadAndCheck());
  }

  Future<void> _loadAndCheck() async {
    final currentQueue = queue;
    final generation = _generation;
    await currentQueue.load();
    if (!_canLookup ||
        generation != _generation ||
        currentQueue.loadError != null) {
      return;
    }
    await currentQueue.verifyUncertain(
      automatic: true,
      shouldContinue: () => _canLookup && generation == _generation,
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _generation++;
    setState(() => _foreground = state == AppLifecycleState.resumed);
    if (_canLookup) unawaited(_loadAndCheck());
  }

  @override
  void didUpdateWidget(OutboxScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_accountChanged);
      widget.controller.addListener(_accountChanged);
      account = null;
      _accountChanged();
    } else if (oldWidget.active != widget.active) {
      _generation++;
      if (_canLookup) unawaited(_loadAndCheck());
    }
  }

  @override
  void dispose() {
    _generation++;
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.removeListener(_accountChanged);
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    try {
      setState(() => error = null);
      await action();
    } catch (_) {
      if (mounted) {
        setState(() => error = '처리를 완료하지 못했습니다. 기기 저장 상태와 서버 반영 여부를 확인해 주세요.');
      }
    }
  }

  Future<void> confirmAbsent(OutboxEntry item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('서버 반영 여부를 확인했나요?'),
        content: SingleChildScrollView(
          child: Text(
            '관제웹에서 이 기록이 등록되지 않은 것을 확인한 경우에만 재시도해 주세요.\n\n'
            '${item.siteName} · ${item.kindLabel}\n'
            '작성일 ${item.fields['dateKey'] ?? item.createdAt.toLocal().toString().substring(0, 10)}\n'
            '원본 ${item.fields['annotationOf'] ?? item.fields['commentOf'] ?? '새 사진'}\n'
            '작업 ID ${item.id}\n\n동일한 작업 ID와 보관 파일로 재시도합니다.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('아직 확인하지 못함'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('미등록 확인 · 재시도'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await run(() async {
      await queue.confirmAbsent(item);
      await queue.send(item, retry: true);
    });
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: queue,
    builder: (context, _) {
      final items = queue.items;
      final groups = <String, String>{
        for (final item in items) item.siteGroup: item.siteName,
      };
      final visible = items
          .where(
            (e) =>
                (siteGroup == null || e.siteGroup == siteGroup) &&
                (filter == null || e.phase == filter),
          )
          .toList()
          .reversed
          .toList();
      return ListView(
        key: const Key('outbox-list'),
        padding: const EdgeInsets.all(24),
        children: [
          Text('전송 상태', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 12),
          Text(
            '현재 계정 · ${widget.controller.user?.name ?? account ?? '로그인 필요'}${account == null ? '' : ' ($account)'}',
          ),
          const Text('로컬 저장됨은 기기에 보관한 상태입니다. 전송 완료는 서버에서 받은 사실을 확인한 상태입니다.'),
          const Text('초안은 작성 당시 현장으로 고정됩니다. 연결 후 각 항목의 전송/재시도를 눌러 주세요.'),
          if (widget.controller.offline)
            const Text('오프라인 · 사진·잉크본·음성 댓글은 기기에 보관합니다.'),
          const SizedBox(height: 16),
          if (queue.supportedLookup) ...[
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                key: const Key('outbox-lookup-all'),
                onPressed:
                    !_canLookup ||
                        queue.checking ||
                        !items.any((e) => e.phase == OutboxPhase.uncertain)
                    ? null
                    : () {
                        final generation = _generation;
                        unawaited(
                          run(
                            () => queue.verifyUncertain(
                              shouldContinue: () =>
                                  _canLookup && generation == _generation,
                            ),
                          ),
                        );
                      },
                child: const Text('서버 상태 다시 조회'),
              ),
            ),
            const Text(
              '결과 불명만 조회합니다. 화면 진입·전경 복귀 시 자동 조회하며, 30초 안에는 반복하지 않습니다.',
            ),
            if (queue.checking) const LinearProgressIndicator(),
            if (queue.lookupMessage != null)
              Text(
                queue.lookupMessage!,
                key: const Key('outbox-lookup-message'),
              ),
          ],
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilterChip(
                label: Text('전체 ${items.length}'),
                selected: filter == null,
                onSelected: (_) => setState(() => filter = null),
              ),
              for (final pair in const <OutboxPhase, String>{
                OutboxPhase.waiting: '대기',
                OutboxPhase.sending: '진행',
                OutboxPhase.failed: '실패',
                OutboxPhase.uncertain: '결과 불명',
                OutboxPhase.reauthenticate: '재로그인 필요',
                OutboxPhase.completed: '완료',
              }.entries)
                FilterChip(
                  label: Text(
                    '${pair.value} ${items.where((e) => e.phase == pair.key).length}',
                  ),
                  selected: filter == pair.key,
                  onSelected: (_) => setState(() => filter = pair.key),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(
                label: const Text('모든 작성 현장'),
                selected: siteGroup == null,
                onSelected: (_) => setState(() => siteGroup = null),
              ),
              for (final group in groups.entries)
                ChoiceChip(
                  label: Text(group.value),
                  selected: siteGroup == group.key,
                  onSelected: (_) => setState(() => siteGroup = group.key),
                ),
            ],
          ),
          if (queue.loadError != null) ...[
            Text(queue.loadError!),
            TextButton(onPressed: queue.load, child: const Text('전송 원장 다시 열기')),
          ],
          if (error != null) Text(error!),
          if (visible.isEmpty && queue.loadError == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Text('이 계정에 표시할 전송 항목이 없습니다.'),
            ),
          for (final group in groups.entries)
            if (visible.any((e) => e.siteGroup == group.key)) ...[
              Padding(
                padding: const EdgeInsets.only(top: 24, bottom: 8),
                child: Text(
                  '작성 당시 현장 · ${group.value}',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              for (final item in visible.where((e) => e.siteGroup == group.key))
                card(item),
            ],
        ],
      );
    },
  );

  Widget card(OutboxEntry item) {
    final busy = queue.isBusy(item);
    final uncertain =
        item.needsVerification || item.phase == OutboxPhase.uncertain;
    return Card(
      key: ValueKey('outbox-${item.id}'),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${item.kindLabel} · ${item.fields['title'] ?? item.fields['commentOf'] ?? ''}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              item.statusLabel,
              key: ValueKey('outbox-status-${item.id}'),
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            if (busy) const LinearProgressIndicator(),
            if (item.message != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(item.message!),
              ),
            Text(
              '현장 ID ${item.siteId ?? '미제공'} · ${item.createdAt.toLocal().toString().substring(0, 16)}',
            ),
            SelectableText('작업 ID ${item.id}'),
            if (item.fields['annotationOf'] != null)
              Text('원본 사진 ${item.fields['annotationOf']}'),
            if (uncertain)
              const Text('이미 서버에 등록됐을 수 있습니다. 서버 반영 여부를 먼저 확인해 주세요.'),
            if (uncertain && !queue.supportedLookup)
              const Text(
                '서버 반영 여부를 자동으로 확인할 수 없습니다. 관제웹에서 먼저 확인해 주세요. 자동 재전송하지 않습니다.',
              ),
            if (item.phase == OutboxPhase.reauthenticate)
              const Text('작성 계정으로 다시 로그인한 뒤 이 항목을 재개해 주세요. 초안은 그대로 보관됩니다.'),
            const SizedBox(height: 8),
            Wrap(
              spacing: vgGapTap,
              runSpacing: vgGapTap,
              children: [
                if (uncertain) ...[
                  if (queue.supportedLookup)
                    OutlinedButton(
                      onPressed: busy || queue.checking || !_canLookup
                          ? null
                          : () {
                              final generation = _generation;
                              unawaited(
                                run(
                                  () => queue.verify(
                                    item,
                                    shouldContinue: () =>
                                        _canLookup && generation == _generation,
                                  ),
                                ),
                              );
                            },
                      child: const Text('서버 상태 재조회'),
                    ),
                  if (queue.canRetryUncertain(item))
                    FilledButton(
                      onPressed: busy || queue.checking || !_canLookup
                          ? null
                          : () => run(() => queue.send(item, retry: true)),
                      child: const Text('같은 작업 재시도'),
                    ),
                  if (!queue.supportedLookup)
                    OutlinedButton(
                      onPressed: busy ? null : () => confirmAbsent(item),
                      child: const Text('관제웹 미등록 확인 후 재시도'),
                    ),
                ] else if (item.phase != OutboxPhase.completed &&
                    item.phase != OutboxPhase.sending)
                  FilledButton(
                    onPressed: busy
                        ? null
                        : () => run(() => queue.send(item, retry: true)),
                    child: Text(
                      item.phase == OutboxPhase.waiting ? '전송' : '같은 작업 재시도',
                    ),
                  ),
                if (item.phase == OutboxPhase.reauthenticate)
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => run(widget.controller.signOut),
                    child: const Text('다시 로그인'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
