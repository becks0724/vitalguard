// 작업자 현황 목록 — 서버가 판정한 색·라벨·집계를 그리기만 한다
//
// ★ 이 파일에 임계 비교가 있으면 안 된다. 심박 몇 이상이 위험인지 앱은 모른다 —
//   서버 `tone` 을 색으로 옮기는 표(`_toneColor`)가 전부다. 값을 비교하기 시작하면
//   관제웹과 판정이 갈린다(context-notes.md · 가드 `test/no_client_judgment_test.dart`).
import 'dart:async';

import 'package:flutter/material.dart';

import 'session.dart';
import 'theme.dart';
import 'worker.dart';

/// 서버 tone → 화면 색. **유일한 판정 반영 지점**이고 여기서 값을 보지 않는다.
Color _toneColor(Tone tone) {
  switch (tone) {
    case Tone.danger:
      return VgColors.danger;
    case Tone.caution:
      return VgColors.caution;
    case Tone.idle:
      return VgColors.muted;
    case Tone.normal:
      return VgColors.normal;
  }
}

class WorkersScreen extends StatefulWidget {
  const WorkersScreen({super.key, required this.session, required this.onSignedOut});

  final Session session;
  final VoidCallback onSignedOut;

  @override
  State<WorkersScreen> createState() => _WorkersScreenState();
}

class _WorkersScreenState extends State<WorkersScreen> {
  /// 관제웹 화면과 같은 감각을 주되 서버를 과하게 두드리지 않는 주기.
  static const _period = Duration(seconds: 15);

  Timer? _timer;
  WorkerBoard? _board;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(_period, (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final res = await widget.session.get('/api/app/admin/workers');
    if (!mounted) return;
    if (res.status == 401) {
      // 세션이 끝났다 — `session.get` 이 이미 토큰을 지웠다.
      widget.onSignedOut();
      return;
    }
    setState(() {
      _loading = false;
      if (res.ok) {
        _board = WorkerBoard.from(res.body);
        _error = null;
      } else {
        // 갱신 실패로 **이미 받은 목록을 지우지 않는다** — 빈 화면이 "이상 없음" 으로 읽힌다.
        _error = res.message;
      }
    });
  }

  Future<void> _signOut() async {
    await widget.session.signOut();
    if (mounted) widget.onSignedOut();
  }

  @override
  Widget build(BuildContext context) {
    final board = _board;
    return Scaffold(
      appBar: AppBar(
        title: const Text('작업자 현황', style: TextStyle(fontWeight: FontWeight.w600)),
        actions: [
          IconButton(
            onPressed: _signOut,
            icon: const Icon(Icons.logout),
            tooltip: '로그아웃',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                children: [
                  if (board != null) _Summary(counts: board.counts),
                  if (_error != null) _ErrorBanner(message: _error!),
                  if (board != null && board.workers.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 48),
                      child: Text(
                        '표시할 작업자가 없습니다.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: VgColors.muted),
                      ),
                    ),
                  if (board != null)
                    for (final w in board.workers)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: _WorkerCard(worker: w),
                      ),
                ],
              ),
      ),
    );
  }
}

/// 상단 집계. 숫자는 **서버가 센 것**이라 목록을 세어 다시 만들지 않는다.
class _Summary extends StatelessWidget {
  const _Summary({required this.counts});

  final WorkerCounts counts;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
        child: Row(
          children: [
            _Stat(label: '전체', value: counts.total, color: VgColors.ink),
            _Stat(label: '이상', value: counts.abnormal, color: VgColors.danger),
            _Stat(label: '연결끊김', value: counts.stale, color: VgColors.muted),
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.color});

  final String label;
  final int value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            '$value',
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: color),
          ),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 12, color: VgColors.body)),
        ],
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: VgColors.surfaceStrong,
          borderRadius: BorderRadius.circular(vgCardRadius),
        ),
        child: Row(
          children: [
            const Icon(Icons.cloud_off, size: 18, color: VgColors.body),
            const SizedBox(width: 10),
            // 갱신이 멈춘 사실을 적되 목록은 남겨 둔다 — 아래 값이 언제 것인지는 각 행이 말한다.
            Expanded(
              child: Text(
                '$message 아래는 마지막으로 받은 값입니다.',
                style: const TextStyle(fontSize: 12.5, color: VgColors.body),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WorkerCard extends StatelessWidget {
  const _WorkerCard({required this.worker});

  final Worker worker;

  @override
  Widget build(BuildContext context) {
    final tone = _toneColor(worker.tone);
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    worker.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: VgColors.ink,
                    ),
                  ),
                ),
                Text(
                  worker.label,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: tone),
                ),
              ],
            ),
            const SizedBox(height: 3),
            Padding(
              padding: const EdgeInsets.only(left: 20),
              child: Text(
                _subtitle(worker),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, color: VgColors.muted),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _Metric(label: '심박', value: worker.heartRate, unit: 'bpm', digits: 0),
                _Metric(label: 'SpO₂', value: worker.spo2, unit: '%', digits: 0),
                _Metric(label: '심부체온', value: worker.coreTempC, unit: '℃', digits: 1),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// 직급 · 착용 · 끊김 사유를 한 줄로. 없는 것은 적지 않는다.
  static String _subtitle(Worker w) {
    final parts = <String>[
      if (w.jobTitle != null && w.jobTitle!.isNotEmpty) w.jobTitle!,
      // 착용은 끊김과 별개 축이라 함께 적는다. `null` 은 모름이라 아무 말도 하지 않는다.
      if (w.worn == false) '미착용',
      if (w.staleLabel != null) w.staleLabel!,
    ];
    return parts.isEmpty ? w.workerId : parts.join(' · ');
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    required this.unit,
    required this.digits,
  });

  final String label;
  final double? value;
  final String unit;
  final int digits;

  @override
  Widget build(BuildContext context) {
    final v = value;
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: VgColors.body)),
          const SizedBox(height: 2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                // 모르는 값은 `—` 다. 0 으로 적으면 측정된 0 과 구별이 안 된다.
                v == null ? '—' : v.toStringAsFixed(digits),
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.bold,
                  color: v == null ? VgColors.muted : VgColors.ink,
                ),
              ),
              if (v != null) ...[
                const SizedBox(width: 2),
                Text(unit, style: const TextStyle(fontSize: 11, color: VgColors.muted)),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
