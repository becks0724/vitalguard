// P4 실측 화면 — 계획서의 [미검증] 항목을 실기기에서 숫자로 바꾸는 것이 목적이다.
//
// 이 화면이 답하는 질문:
//   1. 창·인셋이 실제로 얼마인가 (edge-to-edge 적용 후)       → tab_plan §2.2
//   2. 펜 축(PRESSURE·TILT·ORIENTATION·DISTANCE)이 실제로 변하는가 → §2.2 [미검증]
//   3. 손가락과 펜이 구분되는가 · 팜 리젝션이 동작하는가        → §5.3 T-3
//   4. 펜 측면 버튼이 어떤 키로 들어오는가                      → §2.5
//
// ⚠ 이 화면은 진단용이다. 실제 앱 화면이 아니다.
// ⚠ `Listener`(raw pointer)를 쓴다 — `GestureDetector` 는 제스처 아레나가 펜 이벤트를 삼킬 수 있다.
import 'package:flutter/gestures.dart'; // PointerDeviceKind
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'glove_screen.dart';
import 'stt_screen.dart';
import 'vg_theme.dart';

class DiagScreen extends StatefulWidget {
  const DiagScreen({super.key});

  @override
  State<DiagScreen> createState() => _DiagScreenState();
}

/// 한 포인터의 마지막 상태. 동시에 여러 개가 들어오는지 보려고 id 별로 들고 있는다.
class _Pt {
  _Pt(
    this.kind,
    this.pos,
    this.pressure,
    this.tilt,
    this.orientation,
    this.distance,
  );
  final PointerDeviceKind kind;
  final Offset pos;
  final double pressure;
  final double tilt;
  final double orientation;
  final double distance;
}

class _DiagScreenState extends State<DiagScreen> {
  final _keyboardFocus = FocusNode();

  @override
  void dispose() {
    _keyboardFocus.dispose();
    super.dispose();
  }

  final Map<int, _Pt> _live = {}; // 지금 화면에 닿아 있는 포인터
  final List<Offset> _stroke = []; // 마지막 스트로크 경로(펜만)
  final List<String> _keyLog = []; // 펜 버튼 등 키 이벤트

  // 최댓값 기록 — 값이 "실제로 변하는가"를 보려면 순간값만으로는 부족하다
  double _maxPressure = 0, _minPressure = 1;
  double _maxTilt = 0;
  double _maxDistance = 0;
  bool _sawStylus = false, _sawTouch = false, _sawInverted = false;
  int _maxConcurrent = 0; // **화면에 닿은** 포인터의 동시 최댓값 — 호버는 세지 않는다
  _Pt? _hoverPt; // 공중에 떠 있는 펜. 접촉과 섞지 않는다
  int _cancelCount = 0; // PointerCancel 누적 — 팜 리젝션이 실제로 걸렸다는 신호
  String _lastCancelKind = '—';
  double _pressureMinReported =
      1; // PointerEvent.pressureMin — 1.0 이면 진짜 필압이 아니다
  int _penSamples = 0; // 펜 이벤트를 실제로 몇 개 받았나 — 0 이면 아래 판정은 전부 무의미하다
  double _maxIme = 0; // 관측된 최대 IME 높이(dp) — 키보드가 내려가도 남겨 둔다
  double _lastTopPad = 0; // 손실률 계산에 쓰는 상태바 높이

  void _absorb(PointerEvent e) {
    if (e.kind == PointerDeviceKind.stylus) _sawStylus = true;
    if (e.kind == PointerDeviceKind.touch) _sawTouch = true;
    if (e.kind == PointerDeviceKind.invertedStylus) _sawInverted = true;

    // ⚠ 펜 축은 **펜 이벤트에서만** 기록한다.
    //   손가락·합성 터치의 pressure 를 섞으면 판정이 오염된다 — 실제로 겪었다:
    //   `adb shell input swipe` 의 UP 이벤트가 pressure 0 을 보내
    //   pressureMin 0.000 이 기록됐고 "진짜 필압이다 ✓" 로 잘못 표시됐다.
    //   그건 필압이 아니라 합성 터치였다.
    final isPen =
        e.kind == PointerDeviceKind.stylus ||
        e.kind == PointerDeviceKind.invertedStylus;
    if (!isPen) return;

    _penSamples++;
    if (e.pressureMin < _pressureMinReported) {
      _pressureMinReported = e.pressureMin;
    }
    if (e.pressure > _maxPressure) _maxPressure = e.pressure;
    if (e.pressure < _minPressure && e.pressure > 0) _minPressure = e.pressure;
    if (e.tilt.abs() > _maxTilt) _maxTilt = e.tilt.abs();
    if (e.distance > _maxDistance) _maxDistance = e.distance;
  }

  void _down(PointerDownEvent e) {
    _absorb(e);
    setState(() {
      _hoverPt = null; // 닿았으면 더 이상 호버가 아니다
      _live[e.pointer] = _Pt(
        e.kind,
        e.localPosition,
        e.pressure,
        e.tilt,
        e.orientation,
        e.distance,
      );
      if (_live.length > _maxConcurrent) _maxConcurrent = _live.length;
      if (e.kind == PointerDeviceKind.stylus) {
        _stroke
          ..clear()
          ..add(e.localPosition);
      }
    });
  }

  void _move(PointerMoveEvent e) {
    _absorb(e);
    setState(() {
      _live[e.pointer] = _Pt(
        e.kind,
        e.localPosition,
        e.pressure,
        e.tilt,
        e.orientation,
        e.distance,
      );
      if (_live.length > _maxConcurrent) _maxConcurrent = _live.length;
      if (e.kind == PointerDeviceKind.stylus) _stroke.add(e.localPosition);
    });
  }

  void _up(PointerEvent e) => setState(() => _live.remove(e.pointer));

  /// 팜 리젝션의 실제 신호 — 시스템이 포인터를 **취소**한다.
  /// 손바닥이 닿았다가 걸러지면 `up` 이 아니라 `cancel` 로 끝난다.
  void _cancel(PointerCancelEvent e) {
    _cancelCount++;
    _lastCancelKind = _kindName(e.kind);
    _up(e);
  }

  /// 호버 — 펜을 화면에 대기 전 공중에서 잡히는지(DISTANCE 축 확인)
  ///
  /// ⚠ 호버는 **`_live` 에 넣지 않는다.** `Listener` 에는 exit 콜백이 없어서
  ///   한 번 넣으면 지울 방법이 없다. 그러면 유령 포인터가 남아
  ///   **"동시 포인터" 가 부풀고 팜 리젝션 판정이 오염된다** — 실제로 겪었다.
  void _hover(PointerHoverEvent e) {
    _absorb(e);
    setState(() {
      _hoverPt = _Pt(
        e.kind,
        e.localPosition,
        e.pressure,
        e.tilt,
        e.orientation,
        e.distance,
      );
    });
  }

  bool _onKey(KeyEvent e) {
    if (e is KeyDownEvent) {
      setState(() {
        _keyLog.insert(
          0,
          '${e.logicalKey.debugName ?? e.logicalKey.keyLabel}  ·  usb=0x${e.physicalKey.usbHidUsage.toRadixString(16)}',
        );
        if (_keyLog.length > 6) _keyLog.removeLast();
      });
    }
    return false; // 소비하지 않는다 — 다른 처리기도 보게 둔다
  }

  void _reset() => setState(() {
    _maxPressure = 0;
    _minPressure = 1;
    _maxTilt = 0;
    _maxDistance = 0;
    _maxConcurrent = 0;
    _hoverPt = null;
    _cancelCount = 0;
    _lastCancelKind = '—';
    _pressureMinReported = 1;
    _penSamples = 0;
    _maxIme = 0;
    _sawStylus = _sawTouch = _sawInverted = false;
    _stroke.clear();
    _keyLog.clear();
  });

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final stylus = _live.values
        .where((p) => p.kind == PointerDeviceKind.stylus)
        .toList();
    // 닿아 있는 펜이 우선, 없으면 공중에 떠 있는 펜의 값을 보여 준다
    final cur = stylus.isNotEmpty ? stylus.first : _hoverPt;

    return KeyboardListener(
      focusNode: _keyboardFocus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              _header(mq),
              const Divider(height: 1, color: VgColors.hairline),
              Expanded(
                child: Row(
                  children: [
                    Expanded(flex: 3, child: _canvas()),
                    const VerticalDivider(width: 1, color: VgColors.hairline),
                    SizedBox(width: 320, child: _panel(cur)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── 1. 창·인셋 실측 ──────────────────────────────────────────
  /// 키보드가 안전 높이를 얼마나 먹는가 — **화면이 직접 계산한다.**
  ///
  /// ⚠ `viewInsets.bottom` 에는 **하단 네비바가 이미 포함**돼 있다.
  ///   `padding.bottom` 을 또 빼면 중복 차감이다(코덱스 지적으로 잡은 오류).
  String _imeLine(MediaQueryData mq) {
    final h = mq.size.height;
    final safe = h - mq.padding.top - mq.padding.bottom; // 키보드 없을 때 쓸 수 있는 높이
    final ime = mq.viewInsets.bottom;
    if (ime > _maxIme) _maxIme = ime;
    if (ime <= 0) {
      return _maxIme > 0
          ? '안전 높이 ${safe.toStringAsFixed(1)} dp   ·   최대 IME ${_maxIme.toStringAsFixed(1)} dp 관측 → 손실 ${_imeLossPct(h, safe, _maxIme)}'
          : '안전 높이 ${safe.toStringAsFixed(1)} dp   ·   아래 입력란을 눌러 키보드를 띄우세요';
    }
    final left = h - mq.padding.top - ime; // 위는 상태바, 아래는 IME(네비바 포함)
    return 'IME ${ime.toStringAsFixed(1)} dp → 남는 높이 ${left.toStringAsFixed(1)} dp   ·   '
        '안전 높이의 ${_imeLossPct(h, safe, ime)} 가 사라짐';
  }

  String _imeLossPct(double h, double safe, double ime) {
    final left = h - _lastTopPad - ime;
    final lost = (1 - left / safe) * 100;
    return '${lost.toStringAsFixed(1)}%';
  }

  Widget _header(MediaQueryData mq) {
    final s = mq.size;
    final p = mq.padding;
    _lastTopPad = p.top;
    final v = mq.viewInsets;
    final g = mq.systemGestureInsets;
    return Container(
      color: VgColors.surfaceSoft,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'P4 실측 — 창·펜·키',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                Text(
                  '창 ${s.width.toStringAsFixed(1)} × ${s.height.toStringAsFixed(1)} dp   '
                  'DPR ${mq.devicePixelRatio}   글자배율 ${mq.textScaler.scale(1).toStringAsFixed(2)}',
                  style: const TextStyle(fontSize: 14, color: VgColors.ink),
                ),
                Text(
                  'padding  상 ${p.top.toStringAsFixed(1)} · 하 ${p.bottom.toStringAsFixed(1)} · '
                  '좌 ${p.left.toStringAsFixed(1)} · 우 ${p.right.toStringAsFixed(1)}',
                  style: const TextStyle(fontSize: 13, color: VgColors.body),
                ),
                Text(
                  'viewInsets(IME)  하 ${v.bottom.toStringAsFixed(1)}     '
                  'systemGesture  좌 ${g.left.toStringAsFixed(1)} · 우 ${g.right.toStringAsFixed(1)}',
                  style: const TextStyle(fontSize: 13, color: VgColors.body),
                ),
                Text(
                  _imeLine(mq),
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: v.bottom > 0 ? VgColors.primary : VgColors.body,
                  ),
                ),
              ],
            ),
          ),
          FilledButton.tonal(
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const GloveScreen())),
            style: FilledButton.styleFrom(
              minimumSize: const Size(104, vgTapMin),
            ),
            child: const Text('장갑 측정'),
          ),
          const SizedBox(width: 16),
          FilledButton.tonal(
            onPressed: () =>
                Navigator.of(context)
                    .push(MaterialPageRoute(builder: (_) => const SttScreen())),
            style: FilledButton.styleFrom(
              minimumSize: const Size(104, vgTapMin),
            ),
            child: const Text('STT 측정'),
          ),
          const SizedBox(width: vgGapTap),
          FilledButton.tonal(
            onPressed: _reset,
            style: FilledButton.styleFrom(
              minimumSize: const Size(88, vgTapMin),
            ),
            child: const Text('초기화'),
          ),
        ],
      ),
    );
  }

  // ── 2·3. 펜 캔버스 ───────────────────────────────────────────
  Widget _canvas() {
    return Listener(
      onPointerDown: _down,
      onPointerMove: _move,
      onPointerUp: _up,
      onPointerCancel: _cancel, // 팜 리젝션은 보통 cancel 로 온다 — 횟수를 센다
      onPointerHover: _hover,
      behavior: HitTestBehavior.opaque,
      child: Container(
        color: VgColors.canvas,
        child: CustomPaint(
          painter: _StrokePainter(_stroke, _live),
          child: Center(
            child: _live.isEmpty
                ? const Text(
                    '여기에 펜으로 그어 보세요\n손바닥을 대고도 그어 보세요(팜 리젝션 확인)',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: VgColors.muted,
                      fontSize: 15,
                      height: 1.7,
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ),
      ),
    );
  }

  // ── 값 패널 ──────────────────────────────────────────────────
  Widget _panel(_Pt? cur) {
    return Container(
      color: VgColors.surfaceSoft,
      padding: const EdgeInsets.all(16),
      child: ListView(
        children: [
          _sectionTitle('지금 들어오는 값'),
          _kv('입력 종류', cur == null ? '—' : _kindName(cur.kind)),
          _kv('PRESSURE', cur == null ? '—' : cur.pressure.toStringAsFixed(4)),
          _kv('TILT(rad)', cur == null ? '—' : cur.tilt.toStringAsFixed(4)),
          _kv(
            'ORIENTATION',
            cur == null ? '—' : cur.orientation.toStringAsFixed(4),
          ),
          _kv('DISTANCE', cur == null ? '—' : cur.distance.toStringAsFixed(4)),
          _kv('동시 포인터(접촉)', '${_live.length}'),
          _kv('호버 중', _hoverPt == null ? '아니오' : '예'),

          const SizedBox(height: 18),
          _sectionTitle('기록된 최댓값 — "실제로 변하는가"의 답'),

          // ⚠ 펜 표본이 0 이면 아래 네 판정은 **측정된 적이 없다**는 뜻이지
          //   "그 기능이 없다"는 뜻이 아니다. 화면이 그 둘을 구분해서 말한다.
          _kv(
            '펜 표본 수',
            '$_penSamples${_penSamples == 0 ? "  ← 펜으로 그어야 아래가 채워집니다" : ""}',
          ),
          const SizedBox(height: 8),

          _verdict(
            '필압이 변한다',
            _maxPressure > 0 && _minPressure < _maxPressure - 0.02,
            _penSamples == 0
                ? '미측정 — 펜 이벤트 0건'
                : 'min ${_minPressure.toStringAsFixed(3)} → max ${_maxPressure.toStringAsFixed(3)}',
          ),
          _verdict(
            '기울기가 변한다',
            _maxTilt > 0.05,
            _penSamples == 0
                ? '미측정 — 펜 이벤트 0건'
                : 'max ${_maxTilt.toStringAsFixed(3)} rad (${(_maxTilt * 57.2958).toStringAsFixed(1)}°)',
          ),
          _verdict(
            '호버가 잡힌다',
            _maxDistance > 0,
            _penSamples == 0
                ? '미측정 — 펜 이벤트 0건'
                : 'max distance ${_maxDistance.toStringAsFixed(3)}',
          ),
          _verdict(
            '펜과 손가락이 구분된다',
            _sawStylus && _sawTouch,
            'stylus ${_sawStylus ? "○" : "×"} · touch ${_sawTouch ? "○" : "×"} · 지우개 ${_sawInverted ? "○" : "×"}',
          ),
          _verdict(
            '진짜 필압이다 (pressureMin < 1)',
            _penSamples > 0 && _pressureMinReported < 1.0,
            _penSamples == 0
                ? '미측정 — 펜 이벤트 0건'
                : 'pressureMin ${_pressureMinReported.toStringAsFixed(3)}',
          ),
          _kv('최대 동시 포인터(접촉)', '$_maxConcurrent'),
          _kv('포인터 취소(팜 리젝션)', '$_cancelCount 회  ·  마지막 $_lastCancelKind'),

          const SizedBox(height: 18),
          _sectionTitle('키 이벤트 (펜 버튼 확인)'),
          if (_keyLog.isEmpty)
            const Text(
              '펜 측면 버튼을 눌러 보세요',
              style: TextStyle(color: VgColors.muted, fontSize: 13),
            )
          else
            ..._keyLog.map(
              (k) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  k,
                  style: const TextStyle(fontSize: 12, color: VgColors.ink),
                ),
              ),
            ),

          const SizedBox(height: 18),
          _sectionTitle('키보드 높이 측정'),
          const Text(
            '여기를 눌러 키보드를 띄우면 위쪽에 손실률이 표시됩니다.',
            style: TextStyle(color: VgColors.body, fontSize: 13),
          ),
          const SizedBox(height: 8),
          TextField(
            decoration: const InputDecoration(
              hintText: '아무거나 입력해 보세요',
              border: OutlineInputBorder(),
              isDense: true,
              contentPadding: EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 16,
              ),
            ),
            style: const TextStyle(fontSize: 15),
          ),
          const SizedBox(height: 8),
          // 키보드를 내려도 관측한 최댓값은 헤더에 남는다
          TextButton(
            onPressed: () => FocusScope.of(context).unfocus(),
            child: const Text('키보드 내리기'),
          ),
          // 키보드가 목록을 가리지 않게 — 이 화면 자체가 규칙을 지킨다
          SizedBox(height: MediaQuery.of(context).viewInsets.bottom),
        ],
      ),
    );
  }

  static String _kindName(PointerDeviceKind k) => switch (k) {
    PointerDeviceKind.stylus => 'stylus (펜)',
    PointerDeviceKind.invertedStylus => 'invertedStylus (지우개)',
    PointerDeviceKind.touch => 'touch (손가락)',
    PointerDeviceKind.mouse => 'mouse',
    _ => k.name,
  };

  Widget _sectionTitle(String t) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      t,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w800,
        color: VgColors.body,
      ),
    ),
  );

  Widget _kv(String k, String v) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 118,
          child: Text(
            k,
            style: const TextStyle(fontSize: 13, color: VgColors.body),
          ),
        ),
        Expanded(
          child: Text(
            v,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ),
      ],
    ),
  );

  /// 판정 한 줄 — 색 + 모양으로 말하고 "정상/실패" 글자를 덧붙이지 않는다(V-1).
  Widget _verdict(String label, bool passed, String detail) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    decoration: BoxDecoration(
      color: passed ? VgColors.okTint : VgColors.surfaceStrong,
      borderRadius: BorderRadius.circular(10),
      border: Border.all(
        color: passed
            ? VgColors.ok.withValues(alpha: .45)
            : VgColors.hairlineStrong,
      ),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 26,
          height: 26,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: passed ? VgColors.ok : VgColors.surfaceStrong,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.black.withValues(alpha: .14)),
          ),
          child: Text(
            passed ? '✓' : '–',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w900,
              color: passed ? VgColors.ink : VgColors.muted,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                detail,
                style: const TextStyle(fontSize: 12, color: VgColors.body),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _StrokePainter extends CustomPainter {
  _StrokePainter(this.stroke, this.live);
  final List<Offset> stroke;
  final Map<int, _Pt> live;

  @override
  void paint(Canvas canvas, Size size) {
    // 좌우 시스템 제스처 경합 띠를 그려 둔다 — 여기에 주 실행을 두면 안 된다(C-1)
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

    if (stroke.length > 1) {
      final p = Paint()
        ..color = VgColors.primary
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round
        ..style = PaintingStyle.stroke;
      final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
      for (final o in stroke.skip(1)) {
        path.lineTo(o.dx, o.dy);
      }
      canvas.drawPath(path, p);
    }

    // 지금 닿아 있는 포인터 — 펜은 파랑, 손가락은 주황(구분되는지 눈으로 본다)
    for (final pt in live.values) {
      final isStylus =
          pt.kind == PointerDeviceKind.stylus ||
          pt.kind == PointerDeviceKind.invertedStylus;
      canvas.drawCircle(
        pt.pos,
        isStylus ? 6 + pt.pressure * 26 : 22,
        Paint()
          ..color = (isStylus ? VgColors.primary : VgColors.warn).withValues(
            alpha: .45,
          ),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _StrokePainter old) => true;
}
