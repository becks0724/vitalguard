// P4 실측 — 장갑 낀 손의 터치. [미검증] 7번을 닫기 위한 화면.
//
// 재는 것 네 가지:
//   1. **인식은 되는가**        — 정전식 화면이 장갑을 아예 못 읽을 수 있다. 이벤트 0건도 결과다.
//   2. **크기별 적중률**        — 40 / 48 / 56 / 64 / 72 dp 중 어디서 무너지는가
//   3. **오차의 크기**          — 얼마나 빗나가는가(dp)
//   4. **오차의 방향 편향**     — ★ 이게 핵심이다.
//
// 4번이 중요한 이유: 빗나감이 **한 방향으로 쏠리면** 타깃을 키우는 건 낭비다.
// 히트박스를 그 방향으로 **옮기면** 된다. 평균 오차 벡터가 그 답을 준다.
//
// 접촉 반경(`radiusMajor`)도 같이 기록한다. 장갑은 손가락 끝이 아니라 천으로 누르므로
// 접촉 면적이 달라질 수 있고, 그러면 OS 가 잡는 좌표의 성격도 달라진다.
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'vg_theme.dart';

/// 재는 타깃 크기 — 계획서가 쓰는 두 값(56·64)을 가운데 두고 양쪽을 넓혔다.
const List<double> kTargetSizes = [40, 48, 56, 64, 72];

enum HandMode { bare, glove }

class _Shot {
  const _Shot({
    required this.mode,
    required this.size,
    required this.hit,
    required this.dx,
    required this.dy,
    required this.radius,
    required this.pressure,
  });

  final HandMode mode;
  final double size;
  final bool hit;
  final double dx; // 타깃 중심 기준 가로 오차(dp) — 오른쪽이 +
  final double dy; // 세로 오차(dp) — 아래가 +
  final double radius; // radiusMajor
  final double pressure;

  double get dist => math.sqrt(dx * dx + dy * dy);
}

class GloveScreen extends StatefulWidget {
  const GloveScreen({super.key});

  @override
  State<GloveScreen> createState() => _GloveScreenState();
}

class _GloveScreenState extends State<GloveScreen> {
  HandMode _mode = HandMode.bare;
  final List<_Shot> _shots = [];
  final _rand = math.Random(7); // 고정 시드 — 맨손과 장갑이 **같은 위치 순서**를 밟는다

  int _round = 0; // 크기 순환 인덱스 — 랜덤이 아니라 순환이라 크기별 표본이 고르다
  Offset? _target; // 타깃 중심(캔버스 로컬 좌표)
  Size _field = Size.zero;

  double get _size => kTargetSizes[_round % kTargetSizes.length];

  void _place(Size field) {
    // 타깃이 잘리지 않게 반지름 + 여유만큼 안쪽에 둔다.
    // ⚠ 좌우 제스처 띠(29.6dp)는 측정에서 뺀다 — 거기서 빗나가는 건 장갑 탓이 아니라
    //   OS 제스처 경합이라 **다른 원인이 섞인다.**
    const edge = 36.0;
    final r = _size / 2 + edge;
    final w = math.max(1.0, field.width - r * 2);
    final h = math.max(1.0, field.height - r * 2);
    _target = Offset(r + _rand.nextDouble() * w, r + _rand.nextDouble() * h);
    _field = field;
  }

  void _onTap(PointerDownEvent e, Size field) {
    if (_target == null || _field != field) {
      setState(() => _place(field));
      return; // 첫 탭은 타깃을 놓는 데 쓴다 — 기록하지 않는다
    }
    final t = _target!;
    final d = e.localPosition - t;
    setState(() {
      _shots.add(
        _Shot(
          mode: _mode,
          size: _size,
          hit: d.distance <= _size / 2,
          dx: d.dx,
          dy: d.dy,
          radius: e.radiusMajor,
          pressure: e.pressure,
        ),
      );
      _round++;
      _place(field);
    });
  }

  List<_Shot> _of(HandMode m, double size) =>
      _shots.where((s) => s.mode == m && s.size == size).toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VgColors.canvas,
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            const Divider(height: 1, color: VgColors.hairline),
            Expanded(
              child: Row(
                children: [
                  Expanded(flex: 3, child: _field_()),
                  const VerticalDivider(width: 1, color: VgColors.hairline),
                  SizedBox(width: 360, child: _result()),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── 상단 — 모드 전환 ────────────────────────────────────────
  Widget _header() {
    final mine = _shots.where((s) => s.mode == _mode).length;
    final hit = _shots.where((s) => s.mode == _mode && s.hit).length;
    return Container(
      color: VgColors.surfaceSoft,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back),
            iconSize: 28,
            tooltip: '돌아가기',
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '장갑 터치 실측',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                Text(
                  '${_mode == HandMode.bare ? "맨손" : "장갑"}  ·  다음 타깃 ${_size.toInt()}dp'
                  '  ·  이 모드 $mine 회 중 $hit 회 적중',
                  style: const TextStyle(fontSize: 13, color: VgColors.body),
                ),
              ],
            ),
          ),
          SegmentedButton<HandMode>(
            segments: const [
              ButtonSegment(value: HandMode.bare, label: Text('맨손')),
              ButtonSegment(value: HandMode.glove, label: Text('장갑')),
            ],
            selected: {_mode},
            onSelectionChanged: (v) => setState(() {
              _mode = v.first;
              _round = 0; // 두 모드가 같은 크기 순서를 밟게 한다
              _target = null;
            }),
          ),
          const SizedBox(width: 12),
          FilledButton.tonal(
            onPressed: () => setState(() {
              _shots.clear();
              _round = 0;
              _target = null;
            }),
            style: FilledButton.styleFrom(
              minimumSize: const Size(80, vgTapMin),
            ),
            child: const Text('초기화'),
          ),
        ],
      ),
    );
  }

  // ── 타깃 판 ────────────────────────────────────────────────
  Widget _field_() {
    return LayoutBuilder(
      builder: (context, c) {
        final field = Size(c.maxWidth, c.maxHeight);
        if (_target == null || _field != field) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) setState(() => _place(field));
          });
        }
        return Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: (e) => _onTap(e, field),
          child: CustomPaint(
            painter: _TargetPainter(_target, _size, _lastShot),
            child: const SizedBox.expand(),
          ),
        );
      },
    );
  }

  _Shot? get _lastShot => _shots.isEmpty ? null : _shots.last;

  // ── 결과 ───────────────────────────────────────────────────
  Widget _result() {
    return Container(
      color: VgColors.surfaceSoft,
      padding: const EdgeInsets.all(16),
      child: ListView(
        children: [
          if (_shots.isEmpty)
            const Text(
              '타깃을 탭하세요. 맨손으로 한 바퀴 돌고 장갑으로 한 바퀴 도세요.\n'
              '크기는 40 → 48 → 56 → 64 → 72 dp 순으로 순환합니다.',
              style: TextStyle(fontSize: 13, color: VgColors.body, height: 1.5),
            ),
          if (_shots.isNotEmpty) ...[
            const Text(
              '크기별 적중률',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            ...kTargetSizes.map(_sizeRow),
            const SizedBox(height: 20),
            const Text(
              '★ 오차의 방향 편향',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 4),
            const Text(
              '한 방향으로 쏠리면 타깃을 키울 게 아니라 히트박스를 그쪽으로 옮기면 된다.',
              style: TextStyle(fontSize: 12, color: VgColors.body, height: 1.4),
            ),
            const SizedBox(height: 10),
            _biasRow(HandMode.bare),
            _biasRow(HandMode.glove),
            const SizedBox(height: 20),
            const Text(
              '접촉 면적 · 압력',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            _touchRow(HandMode.bare),
            _touchRow(HandMode.glove),
          ],
        ],
      ),
    );
  }

  Widget _sizeRow(double size) {
    String cell(HandMode m) {
      final l = _of(m, size);
      if (l.isEmpty) return '—';
      final h = l.where((s) => s.hit).length;
      final err = l.map((s) => s.dist).reduce((a, b) => a + b) / l.length;
      return '$h/${l.length}  (${(h * 100 / l.length).round()}%)  오차 ${err.toStringAsFixed(1)}';
    }

    final g = _of(HandMode.glove, size);
    final gHit = g.where((s) => s.hit).length;
    // 표본이 쌓이기 전에는 색으로 단정하지 않는다
    final warn = g.length >= 3 && gHit * 100 / g.length < 90;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: warn ? VgColors.warnTint : VgColors.canvas,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: VgColors.hairlineStrong),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${size.toInt()} dp',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            '맨손  ${cell(HandMode.bare)}',
            style: const TextStyle(fontSize: 12, color: VgColors.body),
          ),
          Text(
            '장갑  ${cell(HandMode.glove)}',
            style: const TextStyle(fontSize: 12, color: VgColors.ink),
          ),
        ],
      ),
    );
  }

  Widget _biasRow(HandMode m) {
    final l = _shots.where((s) => s.mode == m).toList();
    final label = m == HandMode.bare ? '맨손' : '장갑';
    if (l.isEmpty) {
      return _plain('$label  —  표본 없음');
    }
    final mx = l.map((s) => s.dx).reduce((a, b) => a + b) / l.length;
    final my = l.map((s) => s.dy).reduce((a, b) => a + b) / l.length;
    final mag = math.sqrt(mx * mx + my * my);
    final dir = mag < 1.0
        ? '쏠림 없음'
        : '${my > 0 ? "아래" : "위"}${mx.abs() > 1 ? (mx > 0 ? "·오른쪽" : "·왼쪽") : ""}로 쏠림';
    return _plain(
      '$label  평균 (${mx.toStringAsFixed(1)}, ${my.toStringAsFixed(1)}) dp'
      '  ·  크기 ${mag.toStringAsFixed(1)}  ·  $dir  ·  표본 ${l.length}',
    );
  }

  Widget _touchRow(HandMode m) {
    final l = _shots.where((s) => s.mode == m).toList();
    final label = m == HandMode.bare ? '맨손' : '장갑';
    if (l.isEmpty) return _plain('$label  —  표본 없음');
    final r = l.map((s) => s.radius).reduce((a, b) => a + b) / l.length;
    final p = l.map((s) => s.pressure).reduce((a, b) => a + b) / l.length;
    return _plain(
      '$label  반경 ${r.toStringAsFixed(1)}  ·  압력 ${p.toStringAsFixed(3)}',
    );
  }

  Widget _plain(String t) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(t, style: const TextStyle(fontSize: 12, color: VgColors.ink)),
  );
}

class _TargetPainter extends CustomPainter {
  _TargetPainter(this.target, this.size_, this.last);

  final Offset? target;
  final double size_;
  final _Shot? last;

  @override
  void paint(Canvas canvas, Size size) {
    // 좌우 제스처 띠 — 여기엔 타깃을 두지 않는다는 걸 눈으로 확인한다
    final band = Paint()..color = VgColors.danger.withValues(alpha: .05);
    canvas.drawRect(Rect.fromLTWH(0, 0, vgEdgeGestureHint, size.height), band);
    canvas.drawRect(
      Rect.fromLTWH(
        size.width - vgEdgeGestureHint,
        0,
        vgEdgeGestureHint,
        size.height,
      ),
      band,
    );

    final t = target;
    if (t == null) return;

    canvas.drawCircle(t, size_ / 2, Paint()..color = VgColors.primary);
    canvas.drawCircle(
      t,
      size_ / 2,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = VgColors.primaryActive,
    );
    // 중심점 — 어디를 노려야 하는지 분명히 한다
    canvas.drawCircle(t, 2, Paint()..color = Colors.white);

    // 직전 탭이 어디에 닿았는지 보여 준다 — 사용자가 편향을 스스로 느낀다
    if (last != null) {
      final p = t + Offset(last!.dx, last!.dy);
      canvas.drawCircle(
        p,
        6,
        Paint()..color = last!.hit ? VgColors.ok : VgColors.danger,
      );
    }
  }

  @override
  bool shouldRepaint(_TargetPainter old) =>
      old.target != target || old.size_ != size_ || old.last != last;
}
