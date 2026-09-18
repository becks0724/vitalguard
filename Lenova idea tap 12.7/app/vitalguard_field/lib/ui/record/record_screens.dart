import 'dart:async';
import 'dart:convert';
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
import 'record_session.dart';

String _recordTime(String? source, {required String missing}) {
  if (source == null || source.trim().isEmpty) return missing;
  try {
    return captureKstStamp(DateTime.parse(asKstIso(source)));
  } on FormatException {
    return '시각 확인 불가';
  }
}

// 상세 하단 버튼은 장갑 손가락 기준 64dp 높이를 유지한다.
final ButtonStyle _actionStyle = ButtonStyle(
  minimumSize: WidgetStatePropertyAll(Size(160, vgTapPrimary)),
);

bool _canDiscard(OutboxEntry item) =>
    item.phase == OutboxPhase.waiting || item.phase == OutboxPhase.failed;

String _attachmentCounts(List<OutboxEntry> items) => [
  for (final pair in const {
    OutboxKind.ink: '주석',
    OutboxKind.text: '메모',
    OutboxKind.voice: '음성',
  }.entries)
    '${pair.value} ${items.where((item) => item.kind == pair.key).length}',
].join(' · ');

class RecordHome extends StatefulWidget {
  const RecordHome({super.key, required this.controller});
  final FieldController controller;
  @override
  State<RecordHome> createState() => _RecordHomeState();
}

class _RecordHomeState extends State<RecordHome> {
  @override
  void initState() {
    super.initState();
    unawaited(widget.controller.outbox.load());
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller.outbox,
    builder: (_, _) {
      final c = widget.controller;
      final photos = c.outbox.items
          .where((item) => item.kind == OutboxKind.photo &&
              item.phase != OutboxPhase.completed)
          .toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      final cardSurface = vgBackdropCardSurface(vgBackdropOf(context))
          .withValues(alpha: vgCardSurfaceAlpha);
      return Scaffold(
        backgroundColor: Colors.transparent,
        bottomNavigationBar: ActionDock(
          child: CaptureActionPanel(
            key: const Key('record-capture-actions'),
            controller: c,
          ),
        ),
        body: ListView(
          key: const Key('record-pending-list'),
          padding: const EdgeInsets.all(20),
          children: [
            Text('보낼 기록', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 12),
            const Text('전송이 끝난 기록은 관제웹에서 봅니다.'),
            if (c.offline) const Text('오프라인 · 촬영한 사진과 주석·메모·음성은 기기에 보관합니다.'),
            if (c.outbox.loadError != null) ...[
              Text(c.outbox.loadError!),
              TextButton(onPressed: c.outbox.load, child: const Text('기록 다시 열기')),
            ],
            const SizedBox(height: 20),
            if (photos.isEmpty && c.outbox.loadError == null)
              const Text('보낼 기록이 없습니다. 촬영한 사진은 여기 모입니다.'),
            for (final photo in photos)
              Card(
                color: cardSurface,
                elevation: 0,
                surfaceTintColor: Colors.transparent,
                child: ListTile(
                  key: ValueKey('record-photo-${photo.id}'),
                  contentPadding: const EdgeInsets.all(16),
                  minTileHeight: vgTapPrimary,
                  leading: SizedBox(
                    width: 72,
                    height: 72,
                    child: _StoredImage(
                      key: ValueKey(photo.bytesKey),
                      store: c.local,
                      owner: photo.owner,
                      storageKey: photo.bytesKey,
                      cacheWidth: 160,
                    ),
                  ),
                  title: Text(photo.fields['title'] ?? '현장 사진'),
                  subtitle: Text([
                    _recordTime(photo.fields['capturedAt'], missing: '촬영 시각 미기록'),
                    photo.siteName,
                    _attachmentCounts(c.outbox.dependents(photo.id)),
                    photo.statusLabel,
                  ].join('\n')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => PhotoDetail(controller: c, photoId: photo.id),
                    ),
                  ),
                ),
              ),
          ],
        ),
      );
    },
  );
}

class PhotoDetail extends StatefulWidget {
  const PhotoDetail({super.key, required this.controller, required this.photoId});
  final FieldController controller;
  final String photoId;
  @override
  State<PhotoDetail> createState() => _PhotoDetailState();
}

class _PhotoDetailState extends State<PhotoDetail> {
  Future<Uint8List>? bytes;
  bool busy = false, closing = false;
  String? error;
  OutboxController get queue => widget.controller.outbox;
  OutboxEntry? get photo => queue.entry(widget.photoId);

  @override
  void initState() {
    super.initState();
    final item = photo;
    // 완료 항목은 새 상세 화면으로 진입할 수 없다.
    if (item == null || item.kind != OutboxKind.photo ||
        item.phase == OutboxPhase.completed) {
      close();
      return;
    }
    bytes = widget.controller.photoBytes(fromOutbox(item));
    queue.addListener(changed);
  }

  void close() {
    if (closing) return;
    closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && ModalRoute.of(context)?.isCurrent == true) {
        Navigator.of(context).pop();
      } else {
        closing = false;
      }
    });
  }

  void changed() {
    if (!mounted) return;
    if (photo == null || queue.bundleCompleted(widget.photoId)) close();
    setState(() {});
  }

  @override
  void dispose() {
    queue.removeListener(changed);
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try {
      await action();
    } catch (value) {
      if (mounted) setState(() => error = '$value');
    } finally {
      if (mounted) {
        setState(() => busy = false);
        changed();
      }
    }
  }

  Future<void> edit({required bool ink}) async {
    final item = photo;
    if (item == null) return;
    final media = fromOutbox(item);
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        settings: RouteSettings(name: ink ? vgRecordEditorRouteName : 'R-06'),
        builder: (_) => ink
            ? RecordEditor(controller: widget.controller, original: media)
            : RecordInput(controller: widget.controller, media: media),
      ),
    );
    if (mounted) changed();
  }

  Future<void> deletePhoto() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('이 사진을 삭제할까요?'),
        content: const Text('기기에 보관한 사진과 딸린 주석·메모·음성을 함께 삭제합니다.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('삭제')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await run(() async {
      await queue.discard(widget.photoId);
      await clearLocalRecordDrafts(widget.controller, widget.photoId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final item = photo;
    if (item == null || bytes == null || queue.bundleCompleted(widget.photoId)) {
      return const Scaffold(body: Center(child: Text('보낼 기록 목록으로 돌아갑니다.')));
    }
    final c = widget.controller;
    final media = fromOutbox(item);
    final attachments = queue.dependents(item.id);
    final members = [item, ...attachments];
    final processing = busy || members.any((e) => queue.isBusy(e) || e.phase == OutboxPhase.sending);
    final uncertain = members.any((e) => e.needsVerification || e.phase == OutboxPhase.uncertain);
    final reauthenticate = members.any((e) => e.phase == OutboxPhase.reauthenticate);
    final editable = _canDiscard(item) && !processing && !uncertain && !reauthenticate;
    final deletable = editable && members.every(_canDiscard);
    final wide = MediaQuery.sizeOf(context).width >= vgTwoPaneMinWidth;
    final preview = FutureBuilder<Uint8List>(
      future: bytes,
      builder: (_, result) => result.hasError
          ? Center(child: Text('${result.error}'))
          : !result.hasData
          ? const Center(child: CircularProgressIndicator())
          : Image.memory(result.data!, fit: BoxFit.contain),
    );
    final details = <Widget>[
      Text(item.statusLabel, key: const Key('photo-bundle-status')),
      if (processing) const LinearProgressIndicator(),
      if (item.message != null) Text(item.message!),
      if (error != null) Text(error!),
      if (c.offline) const Text('오프라인입니다. 연결 후 전송할 수 있습니다.'),
      if (uncertain) const Text('전송 상태 탭에서 서버 반영 여부를 조회하거나 미등록 확인 후 재시도해 주세요.'),
      if (reauthenticate) const Text('작성 계정으로 다시 로그인한 뒤 전송 상태 탭에서 재개해 주세요.'),
      const SizedBox(height: 16),
      Text('${_recordTime(media.captured_at, missing: '촬영 시각 미기록')} · ${item.siteName}'),
      if (media.road_address != null) Text(media.road_address!),
      if (media.latitude != null && media.longitude != null)
        Text('${media.latitude}, ${media.longitude}'),
      ExpansionTile(
        title: const Text('원문 OCR 보기'),
        children: [Padding(padding: const EdgeInsets.all(16), child: SelectableText(media.ocr_text ?? 'OCR 원문 없음'))],
      ),
      const SizedBox(height: 16),
      Text(_attachmentCounts(attachments), style: Theme.of(context).textTheme.titleLarge),
      for (final child in attachments)
        _Attachment(
          key: ValueKey(child.id),
          controller: c,
          item: child,
          onDelete: !processing && _canDiscard(child)
              ? () => run(() => queue.discard(child.id))
              : null,
        ),
    ];
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        toolbarHeight: vgToolbarHeight(context),
        title: VgToolbarTitle(media.title ?? '현장 사진', textScaler: MediaQuery.textScalerOf(context)),
      ),
      bottomNavigationBar: ActionDock(
        child: Wrap(
          key: const Key('photo-detail-actions'),
          spacing: vgGapTap,
          runSpacing: vgGapTap,
          children: [
            OutlinedButton.icon(onPressed: editable ? () => edit(ink: true) : null, icon: const Icon(Icons.draw), label: const Text('주석 그리기'), style: _actionStyle),
            OutlinedButton.icon(onPressed: editable ? () => edit(ink: false) : null, icon: const Icon(Icons.comment_outlined), label: const Text('메모·음성 붙이기'), style: _actionStyle),
            FilledButton.icon(
              key: const Key('send-bundle'),
              onPressed: processing || c.offline || uncertain || reauthenticate
                  ? null
                  : () => run(() async {
                      await queue.sendBundle(item.id, retry: true);
                      if (queue.bundleCompleted(item.id)) {
                        await clearLocalRecordDrafts(c, item.id);
                      }
                    }),
              icon: const Icon(Icons.send), label: const Text('전송'),
              style: _actionStyle,
            ),
            OutlinedButton.icon(key: const Key('delete-bundle'), onPressed: deletable ? deletePhoto : null, icon: const Icon(Icons.delete_outline), label: const Text('삭제'), style: _actionStyle),
          ],
        ),
      ),
      body: wide
          ? Padding(
              padding: const EdgeInsets.all(20),
              child: Row(children: [
                Expanded(child: preview),
                const SizedBox(width: 24),
                Expanded(child: ListView(key: const Key('photo-detail-pane'), children: details)),
              ]),
            )
          : ListView(padding: const EdgeInsets.all(20), children: [
              SizedBox(height: 360, child: preview),
              const SizedBox(height: 20),
              ...details,
            ]),
    );
  }
}

class _Attachment extends StatefulWidget {
  const _Attachment({super.key, required this.controller, required this.item, this.onDelete});
  final FieldController controller;
  final OutboxEntry item;
  final VoidCallback? onDelete;
  @override
  State<_Attachment> createState() => _AttachmentState();
}

class _AttachmentState extends State<_Attachment> {
  late final Future<Uint8List?> textBytes = widget.controller.local.readBytes(widget.item.owner, widget.item.bytesKey);
  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('${item.kindLabel} · ${item.statusLabel}'),
        if (item.message != null) Text(item.message!),
        if (item.kind == OutboxKind.ink)
          SizedBox(height: 180, child: _StoredImage(store: widget.controller.local, owner: item.owner, storageKey: 'outbox-preview:${item.id}', cacheWidth: 720)),
        if (item.kind == OutboxKind.text)
          FutureBuilder<Uint8List?>(future: textBytes, builder: (_, result) => SelectableText(
            result.hasError ? '메모를 읽지 못했습니다' : result.data == null ? '메모를 불러오는 중입니다' : utf8.decode(result.data!, allowMalformed: true),
          )),
        if (item.kind == OutboxKind.voice)
          Text('음성 · ${voiceTime(int.tryParse(item.fields['audioMs'] ?? '') ?? 0)}'),
        Align(alignment: Alignment.centerRight, child: TextButton(
          key: ValueKey('discard-${item.id}'), onPressed: widget.onDelete, child: const Text('지우기'),
        )),
      ],
    )));
  }
}

class _StoredImage extends StatefulWidget {
  const _StoredImage({super.key, required this.store, required this.owner, required this.storageKey, required this.cacheWidth});
  final LocalStore store;
  final String owner, storageKey;
  final int cacheWidth;
  @override
  State<_StoredImage> createState() => _StoredImageState();
}

class _StoredImageState extends State<_StoredImage> {
  late final Future<Uint8List?> bytes = widget.store.readBytes(widget.owner, widget.storageKey);
  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List?>(
    future: bytes,
    builder: (_, result) => result.data == null
        ? const Icon(Icons.image_outlined)
        : Image.memory(result.data!, cacheWidth: widget.cacheWidth, fit: BoxFit.contain,
            errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined)),
  );
}
