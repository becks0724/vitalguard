import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';
import '../shell/action_dock.dart';
import '../shell/vg_background.dart';
import 'capture_ocr.dart';
import 'capture_screen.dart';
import 'record_editor.dart';
import 'record_input.dart';

String _recordTime(String? source, {required String missing}) {
  if (source == null || source.trim().isEmpty) return missing;
  try {
    // 시간대 없는 값도 기존 KST 규칙으로 해석하고 사진 각인과 같은 형식으로 표시한다.
    return captureKstStamp(DateTime.parse(asKstIso(source)));
  } on FormatException {
    return '시각 확인 불가';
  }
}

class RecordHome extends StatefulWidget {
  const RecordHome({super.key, required this.controller});
  final FieldController controller;
  @override
  State<RecordHome> createState() => _RecordHomeState();
}

class _RecordHomeState extends State<RecordHome> {
  late DateTime selected;
  late DateTime month;
  bool week = false;
  @override
  void initState() {
    super.initState();
    final today = kstNow();
    selected = DateTime.utc(today.year, today.month, today.day);
    month = DateTime.utc(today.year, today.month);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) reload();
    });
  }

  DateTime get start => month.subtract(Duration(days: month.weekday % 7));
  Future<void> reload() => widget.controller.loadPeriod(
    calendarDate(start),
    calendarDate(start.add(const Duration(days: 41))),
  );
  void changeMonth(int delta) {
    setState(() {
      month = DateTime.utc(month.year, month.month + delta);
      selected = month;
    });
    reload();
  }

  Widget _calendar(DateTime first, String selectedKey) => LayoutBuilder(
    builder: (_, constraints) {
      final scale = MediaQuery.textScalerOf(context).scale(1);
      final minimumWidth = 448.0 * (scale < 1 ? 1.0 : scale);
      final width = constraints.maxWidth < minimumWidth
          ? minimumWidth
          : constraints.maxWidth;
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: width,
          child: Column(
            children: [
              Row(
                children: [
                  for (final day in ['일', '월', '화', '수', '목', '금', '토'])
                    Expanded(child: Center(child: Text(day))),
                ],
              ),
              const SizedBox(height: 16),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: week ? 7 : 42,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 7,
                  mainAxisExtent: 66 * (scale < 1 ? 1 : scale),
                  mainAxisSpacing: 16,
                  crossAxisSpacing: 8,
                ),
                itemBuilder: (_, i) {
                  final date = first.add(Duration(days: i));
                  final dayKey = calendarDate(date);
                  final count = widget.controller.media
                      .where((m) => m.date_key == dayKey)
                      .length;
                  return OutlinedButton(
                    onPressed: () => setState(() => selected = date),
                    style: OutlinedButton.styleFrom(
                      padding: EdgeInsets.zero,
                      backgroundColor: dayKey == selectedKey
                          ? Theme.of(context).colorScheme.primaryContainer
                          : null,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          '${date.day}',
                          style: TextStyle(
                            color: date.month == month.month
                                ? null
                                : const Color(0xFF60646C),
                          ),
                        ),
                        if (count > 0)
                          Text(
                            '사진 $count',
                            style: const TextStyle(fontSize: 11),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      );
    },
  );

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (_, _) {
      final c = widget.controller;
      final cardSurface = vgBackdropCardSurface(vgBackdropOf(context))
          .withValues(alpha: vgCardSurfaceAlpha);
      final key = calendarDate(selected);
      final photos = c.media.where((m) => m.date_key == key).toList();
      final events = c.calendarEvents
          .where(
            (e) =>
                e.date_key.compareTo(key) <= 0 &&
                (e.end_date_key ?? e.date_key).compareTo(key) >= 0,
          )
          .toList();
      final first = week
          ? selected.subtract(Duration(days: selected.weekday % 7))
          : start;
      final calendarChildren = <Widget>[
        Row(
          children: [
            IconButton(
              tooltip: '이전 달',
              onPressed: () => changeMonth(-1),
              icon: const Icon(Icons.chevron_left),
            ),
            Expanded(
              child: Text(
                '${month.year}년 ${month.month}월',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            IconButton(
              tooltip: '다음 달',
              onPressed: () => changeMonth(1),
              icon: const Icon(Icons.chevron_right),
            ),
            TextButton(
              onPressed: () => setState(() => week = !week),
              child: Text(week ? '월 보기' : '주 보기'),
            ),
            IconButton(
              tooltip: '기록 새로 고침',
              onPressed: c.busy ? null : reload,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        if (c.busy) const LinearProgressIndicator(),
        if (c.message != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(c.message!),
          ),
        _calendar(first, key),
      ];
      final recordChildren = <Widget>[
        Text(
          '$key 기록',
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        if (!c.busy && c.fetchedAt == null)
          const Text('아직 이 기간의 기록을 받지 못했습니다.'),
        if (!c.busy && c.fetchedAt != null && events.isEmpty && photos.isEmpty)
          const Text('선택한 날짜에 받은 사진·일정이 없습니다.'),
        ...events.map(
          (e) => Card(
            color: cardSurface,
            elevation: 0,
            surfaceTintColor: Colors.transparent,
            child: ListTile(
              leading: const Icon(Icons.event_outlined),
              title: Text(e.title),
              subtitle: Text(
                [e.start_time ?? '종일', if (e.note != null) e.note!].join(' · '),
              ),
            ),
          ),
        ),
        ...photos.map(
          (photo) => Card(
            color: cardSurface,
            elevation: 0,
            surfaceTintColor: Colors.transparent,
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: const Icon(Icons.image_outlined, size: 40),
              title: Text(photo.title ?? '현장 사진'),
              subtitle: Text(
                '${_recordTime(photo.captured_at, missing: '촬영 시각 미기록')}\n${photo.uploader ?? '촬영자 미기록'}',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => PhotoDetail(controller: c, media: photo),
                  ),
                );
                if (mounted) await reload();
              },
            ),
          ),
        ),
      ];
      Widget list(String id, List<Widget> children) => RefreshIndicator(
        key: ValueKey(id),
        onRefresh: reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: children,
        ),
      );

      // C-3: 좁은 가로 분할창은 1단, 넓은 세로 창은 2단. 선택 날짜는 State에 유지한다.
      final wideWindow = MediaQuery.sizeOf(context).width >= vgTwoPaneMinWidth;
      return Scaffold(
        backgroundColor: Colors.transparent,
        bottomNavigationBar: ActionDock(
          child: CaptureActionPanel(
            key: const Key('record-capture-actions'),
            controller: c,
            onUploaded: reload,
          ),
        ),
        body: wideWindow
            ? Row(
                children: [
                  Expanded(
                    child: list('record-calendar-pane', calendarChildren),
                  ),
                  const VerticalDivider(width: 1),
                  Expanded(child: list('record-day-pane', recordChildren)),
                ],
              )
            : list('record-single-pane', [
                ...calendarChildren,
                const SizedBox(height: 24),
                ...recordChildren,
              ]),
      );
    },
  );
}

class PhotoDetail extends StatefulWidget {
  const PhotoDetail({super.key, required this.controller, required this.media});
  final FieldController controller;
  final CalendarMedia media;
  @override
  State<PhotoDetail> createState() => _PhotoDetailState();
}

class _PhotoDetailState extends State<PhotoDetail> {
  late CalendarMedia media;
  late Future<Uint8List> bytes;
  @override
  void initState() {
    super.initState();
    media = widget.media;
    bytes = widget.controller.photoBytes(media);
  }

  Future<void> refresh() async {
    await widget.controller.loadPeriod(media.date_key, media.date_key);
    if (!mounted) return;
    for (final value in widget.controller.media) {
      if (value.id == media.id) media = value;
    }
    setState(() {
      bytes = widget.controller.photoBytes(media);
    });
  }

  Future<void> input({MediaComment? comment}) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => RecordInput(
          controller: widget.controller,
          media: media,
          editing: comment,
        ),
      ),
    );
    if (mounted) await refresh();
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final backdrop = vgBackdropOf(context);
    final opaqueSurface = vgBackdropCardSurface(backdrop);
    final cardSurface = opaqueSurface.withValues(alpha: vgCardSurfaceAlpha);
    final wideWindow = MediaQuery.sizeOf(context).width >= vgTwoPaneMinWidth;
    Widget preview({required bool limitHeight}) => FutureBuilder<Uint8List>(
      future: bytes,
      builder: (_, result) {
        if (result.hasError) {
          return Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('${result.error}'),
                TextButton(
                  onPressed: refresh,
                  child: const Text('목록을 갱신하고 다시 받기'),
                ),
              ],
            ),
          );
        }
        if (!result.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final image = Image.memory(result.data!, fit: BoxFit.contain);
        return limitHeight
            ? ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 440),
                child: image,
              )
            : Center(child: image);
      },
    );
    final actions = Wrap(
      key: const Key('photo-detail-actions'),
      spacing: 16,
      runSpacing: vgGapTap,
      children: [
        FilledButton.icon(
          onPressed: () async {
            await Navigator.of(context).push(
              MaterialPageRoute<void>(
                settings: const RouteSettings(name: vgRecordEditorRouteName),
                builder: (_) => RecordEditor(controller: c, original: media),
              ),
            );
            if (mounted) await refresh();
          },
          icon: const Icon(Icons.draw),
          label: const Text('펜으로 표시하기'),
          style: FilledButton.styleFrom(minimumSize: const Size(200, 64)),
        ),
        OutlinedButton.icon(
          onPressed: input,
          icon: const Icon(Icons.comment_outlined),
          label: const Text('기록·댓글 남기기'),
          style: OutlinedButton.styleFrom(minimumSize: const Size(200, 64)),
        ),
      ],
    );
    Widget opaquePreview({required bool limitHeight}) => ColoredBox(
      color: opaqueSurface,
      child: preview(limitHeight: limitHeight),
    );
    final metadata = <Widget>[
      for (final row in <String, String>{
        '캘린더 날짜': media.date_key,
        '촬영 시각': _recordTime(media.captured_at, missing: '미기록'),
        '촬영자': media.uploader ?? '미기록',
        '원본 ID': media.id,
        '도로명': media.road_address ?? '미기록',
        'GPS': media.latitude == null || media.longitude == null
            ? '미기록'
            : '${media.latitude}, ${media.longitude}',
        '좌표 대조': media.coord_gap_m == null
            ? '대조 정보 없음'
            : '${media.coord_gap_m}m · 참조 정확도 ${media.coord_ref_accuracy_m ?? '미기록'}',
      }.entries)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 110, child: Text(row.key)),
              Expanded(child: SelectableText(row.value)),
            ],
          ),
        ),
      if (media.description != null) Text(media.description!),
      ExpansionTile(
        title: const Text('원문 OCR 보기'),
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: SelectableText(media.ocr_text ?? 'OCR 원문 없음'),
          ),
        ],
      ),
    ];
    final metadataPanel = Card(
      color: cardSurface,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: metadata,
        ),
      ),
    );
    final comments = <Widget>[
      const Text(
        '댓글',
        style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
      ),
      ...media.comments.map(
        (comment) => Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${comment.author_name ?? '작성자 미기록'} · ${_recordTime(comment.created_at, missing: '시각 미기록')}',
                ),
                const SizedBox(height: 8),
                if (comment.audio_storage_key != null)
                  Row(
                    children: [
                      const Icon(Icons.mic),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '음성 댓글${comment.audio_ms == null ? '' : ' · ${voiceTime(comment.audio_ms!)}'}',
                        ),
                      ),
                    ],
                  )
                else
                  SelectableText(comment.body),
                if (comment.author_id == c.user?.id)
                  Wrap(
                    spacing: 16,
                    children: [
                      if (comment.audio_storage_key == null)
                        TextButton(
                          onPressed: () => input(comment: comment),
                          child: const Text('수정'),
                        ),
                      TextButton(
                        onPressed: () async {
                          final yes = await showDialog<bool>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: const Text('이 댓글을 삭제할까요?'),
                              content: Text(
                                comment.audio_storage_key == null
                                    ? comment.body
                                    : '음성 녹음도 함께 삭제됩니다.',
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.pop(ctx, false),
                                  child: const Text('취소'),
                                ),
                                FilledButton(
                                  onPressed: () => Navigator.pop(ctx, true),
                                  child: const Text('삭제'),
                                ),
                              ],
                            ),
                          );
                          if (yes != true) return;
                          try {
                            await c.removeComment(comment.id);
                            if (mounted) await refresh();
                          } catch (e) {
                            if (context.mounted) {
                              ScaffoldMessenger.of(context)
                                  .showSnackBar(SnackBar(content: Text('$e')));
                            }
                          }
                        },
                        child: const Text('삭제'),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    ];
    return Scaffold(
      backgroundColor: Colors.transparent,
      bottomNavigationBar: ActionDock(child: actions),
      appBar: AppBar(
        toolbarHeight: vgToolbarHeight(context),
        title: VgToolbarTitle(
          media.title ?? '현장 사진',
          textScaler: MediaQuery.textScalerOf(context),
        ),
        actions: [
          IconButton(
            tooltip: '사진 정보 새로 고침',
            onPressed: refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: wideWindow
          ? Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: Column(
                      children: [
                        Expanded(child: opaquePreview(limitHeight: false)),
                        if (c.isMock) const Text('모의 도면 · 실제 현장 사진이 아닙니다'),
                      ],
                    ),
                  ),
                  const SizedBox(width: 24),
                  Expanded(
                    child: ListView(
                      key: const ValueKey('photo-detail-pane'),
                      children: [
                        metadataPanel,
                        const SizedBox(height: 24),
                        ...comments,
                      ],
                    ),
                  ),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                opaquePreview(limitHeight: true),
                if (c.isMock)
                  const Center(child: Text('모의 도면 · 실제 현장 사진이 아닙니다')),
                const SizedBox(height: 24),
                metadataPanel,
                const SizedBox(height: 24),
                ...comments,
              ],
            ),
    );
  }
}
