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
  int color = 0xFFDC2626;
  double zoom = 1;
  Offset pan = Offset.zero;
  bool originalOnly = false,
      fitWidth = false,
      busy = false,
      leaving = false,
      canPop = false,
      dirty = false;
  String status = 'draft';
  String? error;
  CalendarMedia? receipt;
  Future<void> Function()? previousFlusher;
  late final Future<void> Function() flusher;
  Future<void> writes = Future.value();
  late final RecordSession session;

  @override
  void initState() {
    super.initState();
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
      finishActive();
      autosave();
    }
  }

  @override
  void didChangeMetrics() {
    // 회전/분할창 변경 전 좌표로 받은 점까지만 확정한다. 새 창의 좌표를
    // 같은 획에 이어 붙이지 않으며, 뒤늦은 PointerCancel도 획을 지우지 않는다.
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
      final alias = await store.read(owner, 'published:${widget.original.id}');
      draftId = alias ?? widget.original.id;
      final raw = await store.read(owner, 'annotation:$draftId');
      if (raw != null) {
        final data = jsonDecode(raw) as Map;
        origin = CalendarMedia(
          Map<String, dynamic>.from(data['origin'] as Map),
        );
        savedStrokes.addAll(
          (data['strokes'] as List).map(
            (s) => InkStroke.fromJson(Map<String, dynamic>.from(s as Map)),
          ),
        );
        status = data['status'] as String? ?? 'draft';
        operationId = data['clientOperationId'] as String?;
        draftSiteName = data['siteName'] as String? ?? '작성 현장명 미기록';
        dirty = data['dirty'] == true;
        revision = data['revision'] as int? ?? 0;
        if (status == 'sending') status = 'uncertain'; // 종료 중 전송 결과를 받지 못한 경우.
        if (data['receipt'] is Map) {
          receipt = CalendarMedia(
            Map<String, dynamic>.from(data['receipt'] as Map),
          );
        }
      }
      await widget.controller.outbox.load();
      syncOperation();
      baseBytes =
          await store.readBytes(owner, 'annotation-base:$draftId') ??
          await widget.controller.photoBytes(origin);
      await store.writeBytes(owner, 'annotation-base:$draftId', baseBytes!);
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
          if (status != 'uncertain') status = 'draft';
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
      'status': status,
      'receipt': receipt?.json,
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
    // 필요한 구역은 `폭 맞춤`으로 키운 뒤 확대·축소·이동 버튼으로 조작한다.
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
    setState(
      () => active[e.pointer] = InkStroke(
        tool,
        color,
        (tool == InkTool.eraser
                ? 28
                : tool == InkTool.marker
                ? 18
                : 4) /
            rect.width,
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
      if (status != 'uncertain') status = 'draft';
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
      if (status != 'uncertain') status = 'draft';
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

  void syncOperation() {
    final item = widget.controller.outbox.entry(operationId);
    if (item == null) return; // 기존 schemaVersion 1 초안도 그대로 복원한다.
    if (item.needsVerification || item.phase == OutboxPhase.sending) {
      status = 'uncertain';
    } else if (item.phase == OutboxPhase.completed) {
      status = dirty ? 'draft' : 'sent';
      if (item.receipt != null) receipt = CalendarMedia(item.receipt!);
    } else {
      status = 'draft';
    }
  }

  Future<void> save({bool localOnly = false}) async {
    if (busy || image == null || active.isNotEmpty) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await persist();
      final png = await render();
      final ink = encodeInk(strokes);
      error = inkUploadSizeError(ink.lengthInBytes);
      syncOperation();
      if (error == null &&
          status != 'uncertain' &&
          (status != 'sent' || dirty)) {
        // 편집 리비전마다 별도 작업을 만든다. 재시도는 그 리비전의 보관본을 쓰며,
        // 새 주석도 원본/이전 게시본을 덮어쓰지 않는다.
        final existing = widget.controller.outbox.entry(operationId);
        if (!dirty && operationId != null && existing == null) {
          throw const ApiFailure(
            '기존 전송 작업을 읽지 못했습니다. 전송 원장을 다시 열어 주세요.',
            status: 400,
          );
        }
        final item = !dirty && existing != null
            ? existing
            : await widget.controller.outbox.enqueue(
                kind: OutboxKind.ink,
                bytes: ink,
                fields: annotationFields(origin),
                siteName: draftSiteName,
                owner: owner,
                sourceKey: 'annotation:$draftId:$revision',
                annotationDraftId: draftId,
                previewBytes: png,
              );
        operationId = item.id;
        dirty = false;
        await persist(); // 큐 링크도 기존 편집 초안에 남긴다.
        if (!localOnly && !widget.controller.offline) {
          await widget.controller.outbox.send(item, retry: true);
        }
        syncOperation();
        error = item.message;
        if (receipt != null && status == 'sent') {
          await widget.controller.local.write(
            owner,
            'published:${receipt!.id}',
            draftId!,
          );
          await widget.controller.local.writeBytes(
            owner,
            'photo:${receipt!.id}',
            png,
          );
        }
      }
      await persist();
      if (!mounted) return;
      await session.close();
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => SaveResult(
            controller: widget.controller,
            origin: origin,
            png: png,
            sent: status == 'sent',
            uncertain: status == 'uncertain',
            error: error,
          ),
        ),
      );
    } catch (e) {
      if (mounted) setState(() => error = '저장 상태를 확인할 수 없습니다: $e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final g = MediaQuery.of(context).systemGestureInsets;
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
                style: IconButton.styleFrom(minimumSize: const Size(56, 56)),
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
                  spacing: 16,
                  runSpacing: vgGapTap,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final item in <InkTool, String>{
                      InkTool.pen: '펜',
                      InkTool.marker: '형광펜',
                      InkTool.rectangle: '사각형',
                      InkTool.eraser: '지우개',
                    }.entries)
                      OutlinedButton(
                        onPressed: busy
                            ? null
                            : () => setState(() => tool = item.key),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(72, 56),
                          backgroundColor: tool == item.key
                              ? Theme.of(context).colorScheme.primaryContainer
                              : null,
                        ),
                        child: Text(item.value),
                      ),
                    IconButton(
                      tooltip: '마지막 획 되돌리기',
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
                                if (status != 'uncertain') status = 'draft';
                              });
                              persist().catchError((_) {
                                if (mounted) setState(() => error = '초안 저장 실패');
                              });
                            },
                      icon: const Icon(Icons.undo),
                      style: IconButton.styleFrom(
                        minimumSize: const Size(56, 56),
                      ),
                    ),
                    OutlinedButton(
                      onPressed: busy
                          ? null
                          : () => setState(() => originalOnly = !originalOnly),
                      child: Text(originalOnly ? '주석 함께 보기' : '원본만 보기'),
                    ),
                    for (final c in [0xFFDC2626, 0xFF171717, 0xFF0D74CE])
                      IconButton(
                        tooltip: c == 0xFFDC2626
                            ? '빨간 펜'
                            : c == 0xFF171717
                            ? '검정 펜'
                            : '파란 펜',
                        onPressed: () => setState(() => color = c),
                        icon: Icon(
                          color == c
                              ? Icons.radio_button_checked
                              : Icons.circle_outlined,
                          color: Color(c),
                        ),
                        iconSize: 40,
                        style: IconButton.styleFrom(
                          minimumSize: const Size(56, 56),
                        ),
                      ),
                    OutlinedButton.icon(
                      onPressed: strokes.isEmpty || active.isNotEmpty || busy
                          ? null
                          : clearAll,
                      icon: const Icon(Icons.delete_sweep_outlined),
                      label: const Text('전체 지우기'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(120, vgTapMin),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: vgGapTap),
                Wrap(
                  spacing: 16,
                  runSpacing: vgGapTap,
                  children: [
                    IconButton(
                      tooltip: '확대',
                      onPressed: active.isEmpty
                          ? () => setState(
                              () => zoom = (zoom + 0.25)
                                  .clamp(1.0, 4.0)
                                  .toDouble(),
                            )
                          : null,
                      icon: const Icon(Icons.zoom_in),
                    ),
                    IconButton(
                      tooltip: '축소',
                      onPressed: active.isEmpty
                          ? () => setState(
                              () => zoom = (zoom - 0.25)
                                  .clamp(1.0, 4.0)
                                  .toDouble(),
                            )
                          : null,
                      icon: const Icon(Icons.zoom_out),
                    ),
                    for (final direction in <IconData, Offset>{
                      Icons.arrow_left: const Offset(60, 0),
                      Icons.arrow_right: const Offset(-60, 0),
                      Icons.arrow_upward: const Offset(0, 60),
                      Icons.arrow_downward: const Offset(0, -60),
                    }.entries)
                      IconButton(
                        tooltip: '확대한 사진 이동',
                        onPressed: active.isEmpty
                            ? () => setState(() => pan += direction.value)
                            : null,
                        icon: Icon(direction.key),
                      ),
                    TextButton(
                      onPressed: () => setState(() {
                        fitWidth = !fitWidth;
                        zoom = 1;
                        pan = Offset.zero;
                      }),
                      child: Text(fitWidth ? '전체 보기' : '폭 맞춤'),
                    ),
                    TextButton(
                      onPressed: busy ? null : () => save(localOnly: true),
                      style: TextButton.styleFrom(
                        minimumSize: const Size(130, vgTapPrimary),
                      ),
                      child: const Text('기기에 저장'),
                    ),
                    FilledButton(
                      onPressed: busy || image == null || active.isNotEmpty
                          ? null
                          : save,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(180, 64),
                      ),
                      child: Text(busy ? '저장 중' : '주석 저장'),
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
            if (status == 'uncertain')
              const Padding(
                padding: EdgeInsets.all(12),
                child: Text('이전 업로드 결과가 불명확합니다. 원본·주석은 보관하며 자동 재전송하지 않습니다.'),
              ),
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
                              onPointerDown: (e) => down(e, rect),
                              onPointerMove: (e) => move(e, rect),
                              onPointerUp: up,
                              onPointerCancel: cancel,
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

class SaveResult extends StatelessWidget {
  const SaveResult({
    super.key,
    required this.controller,
    required this.origin,
    required this.png,
    required this.sent,
    required this.uncertain,
    this.error,
  });
  final FieldController controller;
  final CalendarMedia origin;
  final Uint8List png;
  final bool sent, uncertain;
  final String? error;
  @override
  Widget build(BuildContext context) {
    // N-1의 짝: 필요한 실패를 숨기지 않듯 일어나지 않은 전송도 성공이라고 말하지 않는다.
    final result = sent
        ? controller.isMock
              ? mockCompletedLabel
              : serverCompletedLabel
        : uncertain
        ? '로컬 저장됨 · 서버 결과 불명'
        : localSavedLabel;
    final header = <Widget>[
      Text(
        result,
        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
      ),
      if (error != null)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Text(error!),
        ),
      Text('원본 날짜 ${origin.date_key} · 원본 ID ${origin.id}'),
    ];
    final continuation = <Widget>[
      const SizedBox(height: 16),
      const Text('원본과 펜 작업본은 이 계정의 기기에 보관됩니다. 주석본 제목에는 원본 ID 전체가 포함됩니다.'),
      if (!sent)
        Text(
          uncertain
              ? '업로드 결과가 불명확합니다. 관제웹 반영 여부를 먼저 확인해 주세요.'
              : '전송 상태 탭에서 보관된 작업을 전송하거나, 주석 이어서 편집에서 다시 저장할 수 있습니다.',
        ),
      const SizedBox(height: 16),
      OutlinedButton(
        onPressed: () => Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            settings: const RouteSettings(name: vgRecordEditorRouteName),
            builder: (_) =>
                RecordEditor(controller: controller, original: origin),
          ),
        ),
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(vgTapMin),
        ),
        child: const Text('주석 이어서 편집'),
      ),
      const SizedBox(height: vgGapTap),
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        style: TextButton.styleFrom(
          minimumSize: const Size.fromHeight(vgTapMin),
        ),
        child: const Text('사진으로 돌아가기'),
      ),
    ];
    final wideWindow = MediaQuery.sizeOf(context).width >= vgTwoPaneMinWidth;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: vgToolbarHeight(context),
        title: VgToolbarTitle(
          '주석 저장 결과',
          textScaler: MediaQuery.textScalerOf(context),
        ),
      ),
      body: wideWindow
          ? Padding(
              padding: const EdgeInsets.all(24),
              child: Row(
                children: [
                  Expanded(child: Image.memory(png, fit: BoxFit.contain)),
                  const SizedBox(width: 24),
                  Expanded(
                    child: ListView(
                      key: const ValueKey('save-result-pane'),
                      children: [...header, ...continuation],
                    ),
                  ),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(24),
              children: [
                ...header,
                const SizedBox(height: 16),
                Image.memory(png, height: 400, fit: BoxFit.contain),
                const SizedBox(height: 16),
                ...continuation.skip(1),
              ],
            ),
    );
  }
}
