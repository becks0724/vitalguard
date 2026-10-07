import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';
import '../shell/action_dock.dart';
import 'ink_stroke.dart';
import 'record_session.dart';
export 'ink_stroke.dart';

const String vgRecordEditorRouteName = 'R-04';

void paintAnnotation(
  Canvas canvas,
  Size size,
  ui.Image image,
  Iterable<InkStroke> strokes, {
  Rect? target,
  bool originalOnly = false,
}) {
  final rect = target ?? (Offset.zero & size);
  canvas.drawImageRect(
    image,
    Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
    rect,
    Paint(),
  );
  if (originalOnly) return;
  for (final stroke in strokes) {
    if (stroke.points.isEmpty) continue;
    Offset point(List<double> p) =>
        Offset(rect.left + p[0] * rect.width, rect.top + p[1] * rect.height);
    final paint = Paint()
      ..color = Color(stroke.color)
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    if (stroke.tool == InkTool.marker) {
      paint.color = paint.color.withValues(alpha: 0.35);
    }
    if (stroke.tool == InkTool.rectangle) {
      paint.strokeWidth = stroke.width * rect.width;
      canvas.drawRect(
        Rect.fromPoints(point(stroke.points.first), point(stroke.points.last)),
        paint,
      );
      continue;
    }
    for (var i = 0; i < stroke.points.length; i++) {
      final p = stroke.points[i];
      paint.strokeWidth =
          stroke.width * rect.width * (0.45 + 0.9 * p[2].clamp(0.0, 1.0));
      if (i == 0) {
        final dot = Paint()..color = paint.color;
        canvas.drawCircle(point(p), paint.strokeWidth / 2, dot);
      } else {
        canvas.drawLine(point(stroke.points[i - 1]), point(p), paint);
      }
    }
  }
}

class RecordEditor extends StatefulWidget {
  const RecordEditor({
    super.key,
    required this.controller,
    required this.original,
  });
  final FieldController controller;
  final CalendarMedia original;
  @override
  State<RecordEditor> createState() => _RecordEditorState();
}

class _RecordEditorState extends State<RecordEditor>
    with WidgetsBindingObserver {
  late final String owner;
  late CalendarMedia origin;
  String? draftId, operationId;
  int revision = 0;
  late String draftSiteName;
  ui.Image? image;
  Uint8List? baseBytes;
  final strokes = <InkStroke>[];
  final active = <int, InkStroke>{};
  final undoHistory = <void Function()>[];
  InkTool tool = InkTool.pen;
  double widthMultiplier = 1.0;
  int color = 0xFFDC2626;
  double zoom = 1;
  Offset pan = Offset.zero;
  // 화면 변환은 zoom/pan만 사용하고, 접촉 좌표와 핀치 기준 거리만 추적한다.
  final _touchPositions = <int, Offset>{};
  double? _touchSpanPerZoom;
  bool originalOnly = false,
      fitWidth = false,
      busy = false,
      leaving = false,
      canPop = false,
      dirty = false;
  String? error;
  Future<void> Function()? previousFlusher;
  late final Future<void> Function() flusher;
  Future<void> writes = Future.value();
  late final RecordSession session;

  @override
  void initState() {
    super.initState();
    if (widget.original.json['local'] != true) {
      throw ArgumentError('로컬 사진만 편집할 수 있습니다');
    }
    owner = widget.controller.user!.id;
    session = RecordSession(widget.controller);
    origin = widget.original;
    draftSiteName = widget.controller.site?.site_name ?? '현장 정보 없음';
    previousFlusher = widget.controller.beforeLock;
    flusher = persist;
    widget.controller.beforeLock = flusher;
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      clearTouches();
      finishActive();
      autosave();
    }
  }

  @override
  void didChangeMetrics() {
    // 회전/분할창 변경 전 좌표로 받은 점까지만 확정한다. 새 창의 좌표를
    // 같은 획에 이어 붙이지 않으며, 뒤늦은 PointerCancel도 획을 지우지 않는다.
    clearTouches();
    finishActive();
    autosave();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (identical(widget.controller.beforeLock, flusher)) {
      widget.controller.beforeLock = previousFlusher;
    }
    image?.dispose();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final savedStrokes = <InkStroke>[];
      final store = widget.controller.local;
      requireEditablePhoto(widget.controller, widget.original.id, owner);
      draftId = widget.original.id;
      final raw = await store.read(owner, 'annotation:$draftId');
      if (raw != null) {
        final data = jsonDecode(raw) as Map;
        savedStrokes.addAll(
          (data['strokes'] as List).map(
            (s) => InkStroke.fromJson(Map<String, dynamic>.from(s as Map)),
          ),
        );
        operationId = data['clientOperationId'] as String?;
        draftSiteName = data['siteName'] as String? ?? '작성 현장명 미기록';
        dirty = data['dirty'] == true;
        revision = data['revision'] as int? ?? 0;
      }
      baseBytes = await widget.controller.photoBytes(origin);
      final codec = await ui.instantiateImageCodec(baseBytes!);
      final decoded = (await codec.getNextFrame()).image;
      codec.dispose();
      if (!mounted) {
        decoded.dispose();
        return;
      }
      image?.dispose();
      setState(() {
        image = decoded;
        strokes
          ..clear()
          ..addAll(restoreInkStrokes(savedStrokes, imageSize));
        undoHistory.clear();
        if (savedStrokes.any((s) => s.tool == InkTool.eraser)) {
          dirty = true;
          revision++;
        }
        error = null;
      });
      await persist();
      await session.remember(origin, ink: true);
    } catch (e) {
      if (mounted) setState(() => error = '원본 또는 작업본을 열지 못했습니다: $e');
    }
  }

  Future<void> persist() {
    if (draftId == null || baseBytes == null || image == null) {
      return Future.value();
    }
    final rawOrigin = {
      ...origin.json,
      'media_url': null,
      'thumbnail_url': null,
    };
    // 포인터가 올라오기 전에도 받은 점은 즉시 스냅샷으로 보관한다.
    // 진행 중 지우개는 확정 전 삭제이므로 복구본에는 적용하지 않는다.
    final pendingInk = active.values.where((s) => s.tool != InkTool.eraser);
    final snapshot = jsonEncode({
      'origin': rawOrigin,
      'strokes': [...strokes, ...pendingInk].map((s) => s.toJson()).toList(),
      'status': 'draft',
      'schemaVersion': 1,
      'clientOperationId': operationId,
      'siteName': draftSiteName,
      'dirty': dirty || pendingInk.isNotEmpty,
      'revision': revision + pendingInk.length,
    });
    // 이미 받은 점의 저장은 화면이 닫혀도 끝낸다. 큐 안에서 State.widget을 읽지 않는다.
    final store = widget.controller.local;
    final key = 'annotation:$draftId';
    final operation = writes
        .catchError((_) {})
        .then((_) => store.write(owner, key, snapshot));
    writes = operation;
    return operation;
  }

  void autosave() {
    unawaited(
      persist().catchError((_) {
        if (mounted) {
          setState(() => error = '기기 저장에 실패했습니다. 화면을 닫기 전에 다시 저장해 주세요.');
        }
      }),
    );
  }

  Size get imageSize => Size(image!.width.toDouble(), image!.height.toDouble());

  List<InkStroke> get visibleStrokes {
    final visible = [
      ...strokes,
      ...active.values.where((s) => s.tool != InkTool.eraser),
    ];
    for (final eraser in active.values.where((s) => s.tool == InkTool.eraser)) {
      eraseInkStrokes(visible, eraser, imageSize);
    }
    return visible;
  }

  Rect rectFor(Size size) {
    final source = Size(image!.width.toDouble(), image!.height.toDouble());
    // 기본은 원본 전체를 먼저 보여 주어 화면 밖 위험 요소를 놓치지 않게 한다.
    // 필요한 구역은 손가락으로 확대·이동하고, `폭 맞춤`으로 보기 위치를 복귀한다.
    final fitted = applyBoxFit(
      fitWidth ? BoxFit.fitWidth : BoxFit.contain,
      source,
      size,
    ).destination;
    return Rect.fromCenter(
      center: size.center(Offset.zero) + pan,
      width: fitted.width * zoom,
      height: fitted.height * zoom,
    );
  }

  List<double>? point(PointerEvent e, Rect rect) {
    if (!rect.contains(e.localPosition)) return null;
    final x = (e.localPosition.dx - rect.left) / rect.width;
    final y = (e.localPosition.dy - rect.top) / rect.height;
    // 좌표 4자리는 논리폭 1472px × 최대 4배에서도 0.59px 간격으로 4px 획보다 작다.
    // 압력 0.01 차이는 원본 4160px의 반경 약 5.65px에 약 0.05px만 영향을 준다.
    return [
      (x * 10000).round() / 10000,
      (y * 10000).round() / 10000,
      (e.pressure.clamp(0.0, 1.0) * 100).round() / 100,
    ];
  }

  void down(PointerDownEvent e, Rect rect) {
    if (e.kind != PointerDeviceKind.stylus || busy || originalOnly) return;
    final p = point(e, rect);
    if (p == null) return;
    final baseWidth = tool == InkTool.eraser
        ? 28
        : tool == InkTool.marker
        ? 18
        : 4;
    // 공통 배수를 써야 형광펜과 펜의 기본 굵기 차이를 유지한다.
    // 도구마다 선택 단계의 절대값을 따로 두면 두 도구의 성격이 뒤섞인다.
    setState(
      () => active[e.pointer] = InkStroke(
        tool,
        color,
        baseWidth * widthMultiplier / rect.width,
        [p],
      ),
    );
    autosave();
  }

  void move(PointerMoveEvent e, Rect rect) {
    final stroke = active[e.pointer];
    if (e.kind != PointerDeviceKind.stylus || stroke == null) return;
    final p = point(e, rect);
    if (p != null) {
      final last = stroke.points.last;
      final dx = (p[0] - last[0]) * rect.width;
      final dy = (p[1] - last[1]) * rect.height;
      // 1px 미만 이동은 4px 획에서 구분되지 않으며 점을 줄이면 지우개 판정 비용도 줄어든다.
      // 지우개는 남긴 점 사이를 잇는 선분으로 판정한다.
      if (dx * dx + dy * dy < 1.0) return;
      setState(() => stroke.points.add(p));
      autosave();
    }
  }

  void up(PointerUpEvent e) {
    finishPointer(e.pointer);
    autosave();
  }

  void finishPointer(int pointer, {bool cancelled = false}) {
    final stroke = active.remove(pointer);
    if (stroke == null) return;
    setState(() {
      if (stroke.tool == InkTool.eraser) {
        if (cancelled) return;
        final before = List<InkStroke>.of(strokes);
        if (!eraseInkStrokes(strokes, stroke, imageSize)) return;
        // 한 번의 드래그를 한 작업으로 확정한다. 취소된 포인터는 삭제를 확정하지 않는다.
        undoHistory.add(
          () => strokes
            ..clear()
            ..addAll(before),
        );
      } else {
        strokes.add(stroke);
        undoHistory.add(() => strokes.remove(stroke));
      }
      dirty = true;
      revision++;
    });
  }

  void finishActive() {
    for (final pointer in active.keys.toList()) {
      finishPointer(pointer, cancelled: true);
    }
  }

  void cancel(PointerCancelEvent e) {
    finishPointer(e.pointer, cancelled: true);
    autosave();
  }

  void clearTouches() {
    _touchPositions.clear();
    _touchSpanPerZoom = null;
  }

  void rebaseTouchSpan() {
    final positions = _touchPositions.values.toList();
    final span = positions.length == 2
        ? (positions.last - positions.first).distance
        : 0.0;
    _touchSpanPerZoom = span > 0 ? span / zoom : null;
  }

  void touchDown(PointerDownEvent e) {
    // 펜이 먼저/나중에 닿는 두 경우 모두, 남아 있는 손바닥 접촉은 떼기까지 무시한다.
    if (active.isNotEmpty) {
      clearTouches();
      return;
    }
    if (e.kind != PointerDeviceKind.touch ||
        busy ||
        _touchPositions.length >= 2) {
      return;
    }
    _touchPositions[e.pointer] = e.localPosition;
    rebaseTouchSpan();
  }

  void touchMove(PointerMoveEvent e, Size size) {
    if (e.kind != PointerDeviceKind.touch ||
        !_touchPositions.containsKey(e.pointer)) {
      return;
    }
    if (active.isNotEmpty || busy) {
      clearTouches();
      return;
    }
    final before = _touchPositions.values.toList();
    _touchPositions[e.pointer] = e.localPosition;
    final after = _touchPositions.values.toList();
    final previousFocal = (before.first + before.last) / 2;
    final focal = (after.first + after.last) / 2;
    final span = (after.last - after.first).distance;
    // 이벤트마다 배율을 누적 clamp하면, 한계에서 두 손가락을 함께 옮겨도
    // 먼저 움직인 손가락 때문에 배율이 틀어진다. 접촉 구성이 바뀔 때만 기준을 잡는다.
    final nextZoom = _touchSpanPerZoom == null
        ? zoom
        : (span / _touchSpanPerZoom!).clamp(1.0, 4.0).toDouble();
    final center = size.center(Offset.zero);
    setState(() {
      pan = focal + (center + pan - previousFocal) * (nextZoom / zoom) - center;
      zoom = nextZoom;
    });
    if (_touchSpanPerZoom == null) rebaseTouchSpan();
  }

  void touchEnd(PointerEvent e) {
    if (_touchPositions.remove(e.pointer) != null) rebaseTouchSpan();
  }

  Future<void> clearAll() async {
    if (strokes.isEmpty || active.isNotEmpty || busy) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('주석을 모두 지울까요?'),
        content: const Text('완료한 모든 획을 지웁니다. 이 작업은 되돌릴 수 없습니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(
              backgroundColor: VgColors.danger,
              foregroundColor: VgColors.ink,
            ),
            child: const Text('전체 지우기'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      strokes.clear();
      undoHistory.clear(); // 전체 지우기는 기존 확인창의 '되돌릴 수 없음'을 유지한다.
      dirty = true;
      revision++;
    });
    try {
      await persist();
    } catch (_) {
      if (mounted) setState(() => error = '초안 저장 실패');
    }
  }

  Future<void> back() async {
    if (busy || leaving) return;
    leaving = true;
    try {
      finishActive();
      if (strokes.isNotEmpty) {
        final leave = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('작성 중인 주석을 보관하고 나갈까요?'),
            content: const Text(
              '그린 획은 이 기기에 초안으로 보관됩니다. 같은 사진에서 이어서 작성할 수 있습니다.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('계속 작성'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('초안 보관 후 나가기'),
              ),
            ],
          ),
        );
        if (leave != true || !mounted) return;
      }
      await persist();
      await session.close();
      if (!mounted) return;
      setState(() => canPop = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pop();
      });
    } catch (_) {
      if (mounted) setState(() => error = '초안을 저장하지 못했습니다. 저장 공간을 확인해 주세요.');
    } finally {
      leaving = false;
    }
  }

  Future<Uint8List> render() async {
    final recorder = ui.PictureRecorder();
    paintAnnotation(
      Canvas(recorder),
      Size(image!.width.toDouble(), image!.height.toDouble()),
      image!,
      strokes,
    );
    final picture = recorder.endRecording();
    final rendered = await picture.toImage(image!.width, image!.height);
    final bytes = await rendered.toByteData(format: ui.ImageByteFormat.png);
    picture.dispose();
    rendered.dispose();
    return bytes!.buffer.asUint8List();
  }

  Future<void> save() async {
    if (busy || image == null || active.isNotEmpty) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final queue = widget.controller.outbox;
      final photo = requireEditablePhoto(widget.controller, origin.id, owner);
      final previous = queue
          .dependents(origin.id)
          .where((item) => item.kind == OutboxKind.ink)
          .toList();
      if (previous.any(
        (item) =>
            item.needsVerification ||
            queue.isBusy(item) ||
            (item.phase != OutboxPhase.waiting &&
                item.phase != OutboxPhase.failed),
      )) {
        throw const ApiFailure(
          '이전 주석의 전송 상태를 먼저 확인해 주세요. 전송 중·결과 불명·완료 주석은 바꿀 수 없습니다.',
        );
      }
      await persist();
      final ink = encodeInk(strokes);
      final sizeError = inkUploadSizeError(ink.lengthInBytes);
      if (sizeError != null) throw ApiFailure(sizeError);
      final png = await render();
      requireEditablePhoto(widget.controller, origin.id, owner);
      // 기존 리비전의 draftKeys 삭제가 현재 초안까지 지우므로 이후 persist로 복원한다.
      for (final item in previous) {
        await queue.discard(item.id);
      }
      final item = await queue.enqueue(
        kind: OutboxKind.ink,
        bytes: ink,
        fields: {'siteId': ?origin.site_id},
        siteName: photo.siteName,
        owner: owner,
        dependsOn: origin.id,
        sourceKey: 'annotation:$draftId:$revision',
        annotationDraftId: draftId,
        previewBytes: png,
        draftKeys: ['annotation:$draftId'],
      );
      operationId = item.id;
      dirty = false;
      await persist();
      await session.close();
      if (!mounted) return;
      setState(() => canPop = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pop();
      });
    } catch (e) {
      if (mounted) setState(() => error = '주석을 저장하지 못했습니다: $e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget editorButton({
    required String id,
    required String label,
    required IconData icon,
    required VoidCallback? onPressed,
    bool? selected,
    double iconSize = 24,
    ButtonStyle? style,
  }) => IconButton(
    key: Key('editor-$id'),
    tooltip: label,
    isSelected: selected,
    onPressed: onPressed,
    icon: Icon(icon, semanticLabel: label),
    iconSize: iconSize,
    style: (style ?? const ButtonStyle()).merge(
      IconButton.styleFrom(
        minimumSize: const Size.square(vgTapMin),
        visualDensity: VisualDensity.standard,
        foregroundColor: selected == true ? Colors.white : null,
        backgroundColor: selected == true ? VgColors.primary : null,
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final g = MediaQuery.of(context).systemGestureInsets;
    // 전체 지우기로 비운 주석은 dirty이므로 저장할 수 있다.
    final untouched = strokes.isEmpty && !dirty;
    return PopScope(
      canPop: canPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) back();
      },
      child: Scaffold(
        // V-8: 현장 사진·펜 캔버스와 툴바 뒤로 셀 배경을 비치지 않는다.
        backgroundColor: Theme.of(context).colorScheme.surface,
        appBar: AppBar(
          toolbarHeight: vgToolbarHeight(context),
          leading: IconButton(
            tooltip: '초안 저장 후 뒤로',
            onPressed: back,
            icon: const Icon(Icons.arrow_back),
          ),
          title: VgToolbarTitle(
            '펜으로 표시하기',
            textScaler: MediaQuery.textScalerOf(context),
          ),
        ),
        bottomNavigationBar: ActionDock(
          maxWidth: 960,
          child: Theme(
            data: Theme.of(context).copyWith(
              iconButtonTheme: IconButtonThemeData(
                style: IconButton.styleFrom(
                  minimumSize: const Size.square(vgTapMin),
                ),
              ),
              textButtonTheme: TextButtonThemeData(
                style: TextButton.styleFrom(minimumSize: const Size(56, 56)),
              ),
              outlinedButtonTheme: OutlinedButtonThemeData(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(56, 56),
                ),
              ),
            ),
            child: Column(
              key: const Key('editor-actions'),
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Wrap(
                  key: const Key('editor-drawing-tools'),
                  spacing: 8,
                  runSpacing: vgGapTap,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final item in const [
                      (
                        tool: InkTool.pen,
                        label: '펜',
                        icon: Icons.edit_outlined,
                      ),
                      (
                        tool: InkTool.marker,
                        label: '형광펜',
                        icon: Icons.border_color_outlined,
                      ),
                      (
                        tool: InkTool.rectangle,
                        label: '사각형',
                        icon: Icons.crop_square,
                      ),
                      (
                        tool: InkTool.eraser,
                        label: '지우개',
                        icon: Icons.backspace_outlined,
                      ),
                    ])
                      editorButton(
                        id: 'tool-${item.tool.name}',
                        label: item.label,
                        icon: item.icon,
                        selected: tool == item.tool,
                        onPressed: busy
                            ? null
                            : () => setState(() => tool = item.tool),
                      ),
                    for (final width in const [
                      (id: 'thin', label: '가늘게', multiplier: 0.5, size: 8.0),
                      (id: 'normal', label: '보통', multiplier: 1.0, size: 14.0),
                      (id: 'thick', label: '굵게', multiplier: 2.0, size: 22.0),
                    ])
                      editorButton(
                        id: 'width-${width.id}',
                        label: width.label,
                        icon: Icons.circle,
                        iconSize: width.size,
                        selected: widthMultiplier == width.multiplier,
                        // 점은 굵기만 나타내고 선택은 사각 테두리로 구분한다.
                        style: IconButton.styleFrom(
                          foregroundColor: VgColors.ink,
                          backgroundColor: Colors.transparent,
                          side: BorderSide(
                            color: widthMultiplier == width.multiplier
                                ? VgColors.primary
                                : Colors.transparent,
                            width: 2,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        onPressed: busy
                            ? null
                            : () => setState(
                                () => widthMultiplier = width.multiplier,
                              ),
                      ),
                  ],
                ),
                const SizedBox(height: vgGapTap),
                Wrap(
                  key: const Key('editor-edit-actions'),
                  spacing: 8,
                  runSpacing: vgGapTap,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final swatch in const [
                      (id: 'red', label: '빨간 펜', color: 0xFFDC2626),
                      (id: 'black', label: '검정 펜', color: 0xFF171717),
                      (id: 'blue', label: '파란 펜', color: 0xFF0D74CE),
                    ])
                      IconButton(
                        key: Key('editor-color-${swatch.id}'),
                        tooltip: swatch.label,
                        isSelected: color == swatch.color,
                        onPressed: () => setState(() => color = swatch.color),
                        icon: Icon(
                          color == swatch.color
                              ? Icons.radio_button_checked
                              : Icons.circle_outlined,
                          color: Color(swatch.color),
                          semanticLabel: swatch.label,
                        ),
                        iconSize: 40,
                        style: IconButton.styleFrom(
                          minimumSize: const Size.square(vgTapMin),
                          visualDensity: VisualDensity.standard,
                        ),
                      ),
                    editorButton(
                      id: 'undo',
                      label: '마지막 획 되돌리기',
                      icon: Icons.undo,
                      onPressed:
                          (strokes.isEmpty && undoHistory.isEmpty) ||
                              active.isNotEmpty ||
                              busy
                          ? null
                          : () {
                              setState(() {
                                if (undoHistory.isNotEmpty) {
                                  undoHistory.removeLast()();
                                } else {
                                  // 다시 연 초안도 기존처럼 마지막 획부터 되돌릴 수 있다.
                                  strokes.removeLast();
                                }
                                dirty = true;
                                revision++;
                              });
                              persist().catchError((_) {
                                if (mounted) setState(() => error = '초안 저장 실패');
                              });
                            },
                    ),
                    editorButton(
                      id: 'clear-all',
                      label: '전체 지우기',
                      icon: Icons.delete_sweep_outlined,
                      onPressed: strokes.isEmpty || active.isNotEmpty || busy
                          ? null
                          : clearAll,
                    ),
                    editorButton(
                      id: 'original-only',
                      label: '원본만 보기',
                      icon: Icons.image_outlined,
                      selected: originalOnly,
                      onPressed: busy
                          ? null
                          : () => setState(() => originalOnly = !originalOnly),
                    ),
                    editorButton(
                      id: 'fit-width',
                      label: fitWidth
                          ? '전체 보기 · 확대·이동 초기화'
                          : '폭 맞춤 · 확대·이동 초기화',
                      icon: Icons.fit_screen,
                      selected: fitWidth,
                      onPressed: () => setState(() {
                        clearTouches();
                        fitWidth = !fitWidth;
                        zoom = 1;
                        pan = Offset.zero;
                      }),
                    ),
                  ],
                ),
                const SizedBox(height: vgGapTap),
                Wrap(
                  spacing: 16,
                  runSpacing: vgGapTap,
                  children: [
                    Tooltip(
                      message: untouched ? '표시할 내용이 없습니다' : '',
                      child: FilledButton(
                        onPressed:
                            busy ||
                                image == null ||
                                active.isNotEmpty ||
                                untouched
                            ? null
                            : save,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(180, 64),
                        ),
                        child: Text(busy ? '저장 중' : '주석 저장'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        body: Column(
          children: [
            if (error != null)
              Padding(padding: const EdgeInsets.all(12), child: Text(error!)),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(left: g.left, right: g.right),
                child: image == null
                    ? Center(
                        child: error == null
                            ? const CircularProgressIndicator()
                            : TextButton(
                                onPressed: load,
                                child: const Text('원본 다시 열기'),
                              ),
                      )
                    : LayoutBuilder(
                        builder: (_, constraints) {
                          final size = Size(
                                constraints.maxWidth,
                                constraints.maxHeight,
                              ),
                              rect = rectFor(
                                Size(
                                  constraints.maxWidth,
                                  constraints.maxHeight,
                                ),
                              );
                          return ClipRect(
                            child: _InkPointerListener(
                              key: const Key('ink-canvas'),
                              behavior: HitTestBehavior.opaque,
                              // 기존 펜 콜백을 즉시 호출한다. 손가락도 raw Listener로
                              // 받아 제스처 인식 대기나 arena 경쟁을 추가하지 않는다.
                              onPointerDown: (e) {
                                down(e, rect);
                                touchDown(e);
                              },
                              onPointerMove: (e) {
                                move(e, rect);
                                touchMove(e, size);
                              },
                              onPointerUp: (e) {
                                up(e);
                                touchEnd(e);
                              },
                              onPointerCancel: (e) {
                                cancel(e);
                                touchEnd(e);
                              },
                              child: CustomPaint(
                                size: size,
                                painter: _InkPainter(
                                  image!,
                                  visibleStrokes,
                                  rect,
                                  originalOnly,
                                ),
                                child: const SizedBox.expand(),
                              ),
                            ),
                          );
                        },
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InkPointerListener extends Listener {
  const _InkPointerListener({
    super.key,
    required super.behavior,
    required super.onPointerDown,
    required super.onPointerMove,
    required super.onPointerUp,
    required super.onPointerCancel,
    required super.child,
  });

  @override
  RenderPointerListener createRenderObject(BuildContext context) {
    final renderObject = _RenderInkPointerListener();
    updateRenderObject(context, renderObject);
    return renderObject;
  }
}

class _RenderInkPointerListener extends RenderPointerListener {
  @override
  void dispose() {
    // 누른 포인터의 hit-test 경로는 up/cancel까지 이 객체를 보관한다.
    // 화면 제거 후에도 이벤트가 도착하므로 State를 참조하는 콜백 자체를 끊는다.
    onPointerDown = null;
    onPointerMove = null;
    onPointerUp = null;
    onPointerCancel = null;
    super.dispose();
  }
}

class _InkPainter extends CustomPainter {
  _InkPainter(this.image, this.strokes, this.rect, this.originalOnly);
  final ui.Image image;
  final List<InkStroke> strokes;
  final Rect rect;
  final bool originalOnly;
  @override
  void paint(Canvas canvas, Size size) => paintAnnotation(
    canvas,
    size,
    image,
    strokes,
    target: rect,
    originalOnly: originalOnly,
  );
  @override
  bool shouldRepaint(covariant _InkPainter oldDelegate) => true;
}
