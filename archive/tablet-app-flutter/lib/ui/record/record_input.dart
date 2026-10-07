import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';
import 'record_editor.dart';
import 'record_session.dart';
import 'voice_comment_draft.dart';

class RecordInput extends StatefulWidget {
  const RecordInput({
    super.key,
    required this.controller,
    required this.media,
  });
  final FieldController controller;
  final CalendarMedia media;
  @override
  State<RecordInput> createState() => _RecordInputState();
}

class _RecordInputState extends State<RecordInput> with WidgetsBindingObserver {
  final note = TextEditingController();
  final speechText = TextEditingController();
  StreamSubscription<Map<String, dynamic>>? subscription;
  late final String owner;
  late final String key;
  late final Future<void> Function() flusher;
  Future<void> Function()? previousFlusher;
  late final VoiceCommentDraft? voice;
  int speechGeneration = 0;
  int revision = DateTime.now().microsecondsSinceEpoch;
  String? notice;
  String? runId, error;
  String speechStatus = '음성 입력 대기';
  List<String> candidates = [];
  int? choice;
  bool speaking = false,
      saving = false,
      confirmed = false,
      loading = true,
      leaving = false,
      canPop = false;
  Future<void> writes = Future.value();
  late final RecordSession session;

  @override
  void initState() {
    super.initState();
    if (widget.media.json['local'] != true) {
      throw ArgumentError('로컬 사진에만 메모를 붙일 수 있습니다');
    }
    owner = widget.controller.user!.id;
    session = RecordSession(widget.controller);
    voice = VoiceCommentDraft(widget.controller, widget.media.id, siteId: widget.media.site_id);
    voice?.addListener(voiceChanged);
    key = 'comment-draft:${widget.media.id}:new';
    flusher = flush;
    previousFlusher = widget.controller.beforeLock;
    widget.controller.beforeLock = flusher;
    note.addListener(changed);
    speechText.addListener(changed);
    WidgetsBinding.instance.addObserver(this);
    restore();
    subscription = widget.controller.speech.events.listen(
      onSpeech,
      onError: (Object e) {
        if (mounted) {
          setState(() {
            speaking = false;
            error = '음성 입력 연결 실패: $e';
          });
        }
      },
    );
  }

  void changed() {
    if (mounted) setState(() => confirmed = false);
    autosave();
  }

  void autosave() {
    unawaited(
      persist().catchError((_) {
        if (mounted) setState(() => error = '초안 저장에 실패했습니다. 저장 공간을 확인해 주세요.');
      }),
    );
  }

  void voiceChanged() {
    if (!mounted) return;
    setState(() {});
  }

  bool get audioBusy =>
      voice?.microphoneBusy == true ||
      voice?.playing == true ||
      voice?.busy == true;

  Future<void> stopSpeech() async {
    ++speechGeneration;
    await widget.controller.speech.stop(cancel: true);
    if (mounted) {
      setState(() {
        speaking = false;
        runId = null;
      });
    }
  }

  Future<void> flush() async {
    // 마이크 정지/권한 콜백을 기다리는 동안에도 글은 먼저 보관한다.
    await Future.wait([
      persist(),
      stopSpeech(),
      if (voice != null) voice!.pause(),
    ]);
  }

  String get composed => [
    if (note.text.isNotEmpty) note.text,
    if (choice != null && speechText.text.isNotEmpty) speechText.text,
  ].join('\n');
  Future<void> restore() async {
    try {
      await voice?.restore();
      final saved = await widget.controller.local.read(owner, key);
      if (!mounted) return;
      if (saved != null) {
        final data = jsonDecode(saved) as Map;
        // 철회된 조치수준 칩은 복원하지 않는다.
        note.text = data['text'] as String? ?? '';
        revision = data['revision'] as int? ?? revision;
      }
      await session.remember(widget.media);
    } catch (_) {
      error = '이전에 저장한 초안을 읽지 못했습니다';
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> persist() {
    if (loading) return Future.value();
    // 미확인 STT 후보는 로컬 업무 초안에도 넣지 않는다. 직접 입력한 내용만 보존한다.
    final text = confirmed && choice != null
        ? [note.text, speechText.text].where((s) => s.isNotEmpty).join('\n')
        : note.text;
    final snapshot = jsonEncode({
      'text': text,
      'status': 'draft',
      'revision': revision,
      'mediaId': widget.media.id,
    });
    final operation = writes
        .catchError((_) {})
        .then((_) => text.isEmpty
            ? widget.controller.local.remove(owner, key)
            : widget.controller.local.write(owner, key, snapshot));
    writes = operation;
    return operation;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive) {
      // 권한창도 inactive를 만들므로 이때 녹음 준비를 취소하지 않는다.
      autosave();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      flush().catchError((Object e) {
        if (mounted) setState(() => error = '초안 보존 상태를 확인해 주세요: $e');
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    ++speechGeneration;
    widget.controller.speech.stop(cancel: true).catchError((_) {});
    subscription?.cancel();
    voice?.removeListener(voiceChanged);
    unawaited(voice?.pause().catchError((_) {}));
    voice?.dispose();
    if (identical(widget.controller.beforeLock, flusher)) {
      widget.controller.beforeLock = previousFlusher;
    }
    note.dispose();
    speechText.dispose();
    super.dispose();
  }

  Future<void> back() async {
    if (saving || leaving || loading || voice?.sending == true) return;
    leaving = true;
    try {
      await flush();
      await session.close();
      if (!mounted) return;
      setState(() => canPop = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pop();
      });
    } catch (_) {
      if (mounted) setState(() => error = '초안 저장에 실패했습니다. 저장 공간을 확인해 주세요.');
    } finally {
      leaving = false;
    }
  }

  Future<void> startSpeech() async {
    if (speaking || saving || audioBusy) return;
    final generation = ++speechGeneration;
    // available()·권한 요청을 기다리는 동안에도 녹음 버튼을 잠근다.
    setState(() {
      speaking = true;
      error = null;
    });
    try {
      if (!await widget.controller.speech.available()) {
        if (mounted && generation == speechGeneration) {
          setState(() {
            speaking = false;
            error = '온디바이스 인식기를 사용할 수 없습니다. 직접 입력해 주세요.';
          });
        }
        return;
      }
      if (!mounted || generation != speechGeneration) return;
      runId = 'record-${DateTime.now().microsecondsSinceEpoch}';
      setState(() {
        speaking = true;
        candidates = [];
        choice = null;
        confirmed = false;
        speechText.clear();
        speechStatus = '마이크 준비 중';
        error = null;
      });
      await widget.controller.speech.start(runId!);
    } catch (_) {
      if (mounted && generation == speechGeneration) {
        setState(() {
          speaking = false;
          error = '마이크 권한과 인식기 상태를 확인해 주세요';
        });
      }
    }
  }

  void onSpeech(Map<String, dynamic> e) {
    if (!mounted || e['runId'] != runId) return;
    switch (e['type']) {
      case 'status':
        setState(
          () => speechStatus = e['state'] == 'ready'
              ? '말씀하세요'
              : e['state'] == 'waiting_final'
              ? '후보를 받는 중'
              : '음성 입력 중',
        );
      case 'partial':
        setState(() => speechStatus = '인식 중 · 아직 저장하지 않습니다');
      case 'final':
        setState(() {
          candidates = (e['results'] as List? ?? [])
              .cast<String>()
              .take(5)
              .toList();
          choice = null;
          confirmed = false;
          speaking = false;
          speechStatus = candidates.isEmpty
              ? '후보가 없습니다. 다시 말하거나 펜으로 기록해 주세요.'
              : '맞는 후보를 고르고 문장을 확인하세요';
          runId = null;
        });
      case 'error':
        setState(() {
          speaking = false;
          runId = null;
          error = '음성 인식 오류 ${e['code']} · ${e['name']}';
        });
      case 'cancelled':
      case 'diagnostic_error':
        setState(() {
          speaking = false;
          runId = null;
          speechStatus = '음성 입력이 중단됐습니다';
        });
    }
  }

  Future<void> save() async {
    if (!confirmed || composed.trim().isEmpty || saving || audioBusy) return;
    final text = composed;
    setState(() { saving = true; error = notice = null; });
    try {
      final photo = requireEditablePhoto(widget.controller, widget.media.id, owner);
      await stopSpeech();
      await persist();
      await widget.controller.outbox.enqueue(
        kind: OutboxKind.text,
        bytes: Uint8List.fromList(utf8.encode(text)),
        fields: {'siteId': ?widget.media.site_id},
        dependsOn: widget.media.id,
        siteName: photo.siteName,
        owner: owner,
        sourceKey: 'comment-draft:${widget.media.id}:$revision',
        draftKeys: [key],
      );
      revision++;
      if (!mounted) return;
      note.clear();
      speechText.clear();
      setState(() {
        choice = null;
        candidates = [];
        confirmed = false;
        notice = '메모를 기기에 저장했습니다. 사진 상세에서 함께 전송해 주세요.';
      });
      await persist();
    } catch (value) {
      if (mounted) setState(() => error = '메모를 저장하지 못했습니다: $value');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Widget voiceControls(VoiceCommentDraft draft) => Padding(
    padding: const EdgeInsets.only(top: 16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.controller.isMock) const Text('모의 녹음 · 마이크를 사용하지 않습니다'),
        if (draft.starting) const Text('녹음 준비 중'),
        if (draft.recording || draft.stopping)
          Wrap(
            spacing: 16,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                '녹음 중 ${voiceTime(draft.elapsedMs)}',
                key: const Key('voice-elapsed'),
              ),
              OutlinedButton.icon(
                key: const Key('voice-stop'),
                onPressed: draft.stopping ? null : draft.stop,
                icon: const Icon(Icons.stop),
                label: Text(draft.stopping ? '녹음 보존 중' : '녹음 정지'),
              ),
              TextButton(
                key: const Key('voice-cancel-recording'),
                onPressed: draft.busy ? null : draft.discard,
                child: const Text('녹음 취소'),
              ),
            ],
          ),
        if (draft.hasClip && !draft.stopping) ...[
          Text('녹음 ${voiceTime(draft.clip!.durationMs)} · 전송 전 확인'),
          Wrap(
            spacing: 16,
            runSpacing: vgGapTap,
            children: [
              OutlinedButton.icon(
                key: const Key('voice-preview'),
                onPressed: speaking || saving || draft.busy
                    ? null
                    : draft.preview,
                icon: Icon(draft.playing ? Icons.stop : Icons.play_arrow),
                label: Text(draft.playing ? '미리듣기 정지' : '미리듣기'),
              ),
              FilledButton.icon(
                key: const Key('voice-send'),
                onPressed: speaking || saving || draft.busy ? null : draft.send,
                icon: const Icon(Icons.save_outlined),
                label: Text(draft.sending ? '저장 중' : '음성 저장'),
              ),
              OutlinedButton(
                key: const Key('voice-rerecord'),
                onPressed: speaking || saving || draft.busy
                    ? null
                    : draft.rerecord,
                child: const Text('다시 녹음'),
              ),
              TextButton(
                key: const Key('voice-cancel'),
                onPressed: saving || draft.busy ? null : draft.discard,
                child: const Text('취소'),
              ),
            ],
          ),
        ],
        if (draft.notice != null) Text(draft.notice!),
        if (draft.error != null)
          Text(draft.error!, key: const Key('voice-error')),
        if (draft.error != null && draft.hasClip)
          const Text('녹음을 보존했습니다. 기기 저장 상태를 확인한 뒤 다시 저장해 주세요.'),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: canPop,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop) back();
    },
    child: Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        toolbarHeight: vgToolbarHeight(context),
        title: VgToolbarTitle(
          '메모·음성 붙이기',
          textScaler: MediaQuery.textScalerOf(context),
        ),
        leading: IconButton(
          tooltip: '초안 보존 후 뒤로',
          onPressed: saving || voice?.sending == true ? null : back,
          icon: const Icon(Icons.arrow_back),
        ),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              key: const Key('record-input-scroll'),
              padding: const EdgeInsets.all(20),
              children: [
                const Text(
                  '관리자 기록',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                ),
                const Text('직접 확인한 내용을 남깁니다. 센서 판정과 별개입니다.'),
                const SizedBox(height: 16),
                // R-06: 2026-09-13 태곤 님 결정으로 조치수준 칩 4개를 철회했다.
                // 앱의 4단 라벨이 서버의 3단 판정(정상/주의/위험)과 충돌하고,
                // 사용자 라벨이 서버 판정처럼 읽힐 위험이 있었다. 판정은 서버가 한다.
                // 근거: artifacts/screen-inventory.md의
                // 'R-06 입력 — 칩을 뺀다 (2026-09-13 · 태곤 님)'.
                // 타이핑이 기본이며, 그 아래 아이콘 버튼으로 STT·손글씨·녹음을 연다.
                TextField(
                  key: const Key('record-note'),
                  controller: note,
                  enabled: !saving,
                  minLines: 3,
                  maxLines: 8,
                  decoration: const InputDecoration(
                    labelText: '내용 직접 입력',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 20),
                Wrap(
                  spacing: 16,
                  runSpacing: vgGapTap,
                  children: [
                    FilledButton.icon(
                      key: const Key('speech-start'),
                      onPressed: speaking || saving || audioBusy
                          ? null
                          : startSpeech,
                      icon: const Icon(Icons.mic_none),
                      label: const Text('말로 입력'),
                    ),
                    OutlinedButton.icon(
                      onPressed: saving || audioBusy
                          ? null
                          : () async {
                              await flush();
                              if (!context.mounted) return;
                              await Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  settings: const RouteSettings(
                                    name: vgRecordEditorRouteName,
                                  ),
                                  builder: (_) => RecordEditor(
                                    controller: widget.controller,
                                    original: widget.media,
                                  ),
                                ),
                              );
                              if (mounted) {
                                await session.remember(
                                  widget.media,
                                );
                              }
                            },
                      icon: const Icon(Icons.draw),
                      label: const Text('사진에 펜으로 메모하기'),
                    ),
                    if (voice != null)
                      OutlinedButton.icon(
                        key: const Key('voice-start'),
                        onPressed:
                            speaking ||
                                saving ||
                                audioBusy ||
                                voice!.clip != null
                            ? null
                            : voice!.start,
                        icon: const Icon(Icons.mic),
                        label: const Text('녹음'),
                      ),
                    OutlinedButton(
                      onPressed: speaking
                          ? () => widget.controller.speech.stop()
                          : null,
                      child: const Text('말하기 끝내기'),
                    ),
                  ],
                ),
                if (voice != null) voiceControls(voice!),
                const SizedBox(height: 16),
                Text(speechStatus),
                ...List.generate(
                  candidates.length,
                  (i) => Padding(
                    padding: const EdgeInsets.only(top: vgGapTap),
                    child: OutlinedButton(
                      key: Key('speech-candidate-$i'),
                      onPressed: saving
                          ? null
                          : () => setState(() {
                              choice = i;
                              speechText.text = candidates[i];
                              confirmed = false;
                            }),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(56),
                        backgroundColor: choice == i
                            ? const Color(0xFFE5E7EB)
                            : null,
                      ),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text('${i + 1}. ${candidates[i]}'),
                      ),
                    ),
                  ),
                ),
                if (choice != null)
                  Padding(
                    padding: const EdgeInsets.only(top: vgGapTap),
                    child: TextField(
                      key: const Key('record-speech-text'),
                      controller: speechText,
                      enabled: !saving,
                      minLines: 2,
                      maxLines: 6,
                      decoration: const InputDecoration(
                        labelText: '선택한 음성 문장 · 필요하면 수정',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                const SizedBox(height: 20),
                const Text(
                  '저장할 내용 확인',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                SelectableText(
                  composed.isEmpty ? '아직 선택하거나 작성한 내용이 없습니다.' : composed,
                ),
                const Text('특히 “미착용”, “중지”, 숫자와 장소가 맞는지 확인해 주세요.'),
                CheckboxListTile(
                  key: const Key('confirm-record'),
                  value: confirmed,
                  contentPadding: EdgeInsets.zero,
                  title: const Text('위 문장 전체를 확인했습니다'),
                  onChanged: saving || composed.trim().isEmpty
                      ? null
                      : (value) {
                          setState(() => confirmed = value!);
                          autosave();
                        },
                ),
                if (error != null) Text(error!),
                if (notice != null) Text(notice!),
                const SizedBox(height: vgGapTap),
                FilledButton(
                  key: const Key('save-record'),
                  onPressed:
                      confirmed &&
                          !saving &&
                          !audioBusy
                      ? save
                      : null,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(64),
                  ),
                  child: Text(saving ? '저장 중' : '메모 저장'),
                ),
              ],
            ),
    ),
  );
}
