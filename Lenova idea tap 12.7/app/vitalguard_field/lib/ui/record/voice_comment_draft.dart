import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../../data/contracts/field_contracts.dart';

// 편집 중 녹음은 기존 초안에, 전송을 누른 녹음은 계정별 영속 큐에도 보관한다.
class VoiceCommentDraft extends ChangeNotifier {
  VoiceCommentDraft(this.controller, this.mediaId, {this.siteId})
    : owner = controller.user!.id,
      siteName = controller.site?.site_name ?? '현장 정보 없음' {
    _subscription = controller.recorder.events.listen(
      _onEvent,
      onError: (Object e) {
        error = _message(e);
        unawaited(
          pause().catchError((Object e) {
            error = _message(e);
            _notify();
          }),
        );
        _notify();
      },
    );
  }

  final FieldController controller;
  final String mediaId, owner;
  String? operationId, siteId;
  String siteName;
  String get key => 'voice-comment-draft:$mediaId';
  String get audioKey => '$key:audio';
  String get recorderKey => jsonEncode([owner, mediaId]);
  VoiceRecorder get recorder => controller.recorder;
  late final StreamSubscription<Map<String, dynamic>> _subscription;
  Timer? _ticker;
  Future<void> _writes = Future.value();
  Future<void>? _accepting, _stopping;
  Uint8List? _audio;
  VoiceRecording? clip;
  String status = 'draft';
  String? error, notice;
  bool loading = true, starting = false, recording = false, stopping = false;
  bool sending = false, playing = false, working = false;
  bool _disposed = false;
  int _generation = 0;
  int recordingRevision = 0;
  int _elapsedMs = 0;

  bool get microphoneBusy => starting || recording || stopping;
  bool get busy => loading || starting || stopping || sending || working;
  bool get hasClip => clip != null && status != 'sent';
  int get elapsedMs => _elapsedMs;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  String _message(Object failure) {
    if (failure is PlatformException) {
      return failure.code == 'microphone_denied'
          ? '마이크 권한이 필요합니다'
          : failure.message ?? failure.code;
    }
    if (failure is ApiFailure) {
      final explanation = switch (failure.status) {
        401 => '로그인이 만료되었습니다. 다시 로그인해 주세요.',
        403 => '이 사진에 음성 댓글을 남길 권한이 없습니다.',
        404 => '원본 사진을 찾을 수 없습니다. 삭제 여부를 확인해 주세요.',
        _ => null,
      };
      return explanation == null
          ? failure.message
          : '$explanation\n${failure.message}';
    }
    return '$failure';
  }

  Future<void> restore() async {
    try {
      final raw = await controller.local.read(owner, key);
      if (raw != null) {
        final data = jsonDecode(raw) as Map;
        operationId = data['clientOperationId'] as String?;
        recordingRevision = data['recordingRevision'] as int? ?? 0;
        siteId = data.containsKey('siteId')
            ? data['siteId'] as String?
            : siteId;
        siteName = data['siteName'] as String? ?? '작성 현장명 미기록';
        status = data['status'] == 'sending'
            ? 'uncertain'
            : data['status'] as String? ?? 'draft';
        if (data['clip'] is Map) {
          clip = VoiceRecording.fromJson(data['clip'] as Map);
          if (status == 'sent') {
            notice = '이미 전송한 녹음입니다. 남은 기기 파일을 정리해 주세요.';
          } else {
            _audio = await controller.local.readBytes(owner, audioKey);
            if (_audio == null || _audio!.isEmpty) {
              _audio = await recorder.read(clip!.path);
            }
            notice = '전송 전 녹음을 복원했습니다. 들어본 뒤 전송해 주세요.';
          }
        }
      }
      await controller.outbox.load();
      final queued = controller.outbox.entry(operationId);
      if (queued != null) _sync(queued);
      final device = recorder;
      if (clip == null && device is RecoverableVoiceRecorder) {
        final recovered = await device.recoverDraft(recorderKey);
        if (recovered != null) {
          loading = false;
          await _accept(recovered);
          notice = '중단된 녹음을 복원했습니다. 들어본 뒤 전송해 주세요.';
        }
      }
    } catch (e) {
      error = '기기 녹음을 읽지 못했습니다. 기존 파일은 보존됩니다. ${_message(e)}';
    } finally {
      loading = false;
      _notify();
    }
    // 앱 종료 당시 sending이면 원격 반영 여부가 불명확하다.
    if (status == 'uncertain') await persist();
  }

  Future<void> persist() {
    if (loading) return Future.value();
    final audio = _audio;
    final metadata = jsonEncode({
      'mediaId': mediaId,
      'status': status,
      'clip': clip?.toJson(),
      'clientOperationId': operationId,
      'recordingRevision': recordingRevision,
      'siteId': siteId,
      'siteName': siteName,
    });
    final write = _writes.catchError((_) {}).then((_) async {
      if (audio != null) {
        await controller.local.writeBytes(owner, audioKey, audio);
      }
      await controller.local.write(owner, key, metadata);
    });
    _writes = write;
    return write;
  }

  Future<void> start() async {
    if (busy || recording || clip != null) return;
    final generation = ++_generation;
    starting = true;
    error = notice = null;
    status = 'draft';
    _notify();
    try {
      // 댓글 소유자/현장 연결을 마이크 시작 전에 영속화한다.
      await persist();
      if (generation != _generation || !starting) return;
      final device = recorder;
      if (device is RecoverableVoiceRecorder) {
        await device.startDraft(recorderKey);
      } else {
        await device.start();
      }
      if (generation != _generation || !starting) return;
      starting = false;
      recording = true;
      _elapsedMs = 0;
      _ticker = Timer.periodic(const Duration(seconds: 1), (timer) {
        _elapsedMs = (timer.tick * 1000).clamp(0, maxVoiceDurationMs);
        _notify();
      });
    } catch (e) {
      if (generation == _generation) {
        starting = false;
        error = _message(e);
      }
    }
    _notify();
  }

  void _endClock() {
    _ticker?.cancel();
    starting = recording = false;
  }

  void _onEvent(Map<String, dynamic> event) {
    if (_disposed) return;
    switch (event['type']) {
      case 'stopped':
        if (microphoneBusy) {
          unawaited(_accept(VoiceRecording.fromJson(event)));
        }
      case 'error':
        _endClock();
        stopping = false;
        error = event['message'] as String? ?? '녹음을 저장하지 못했습니다';
        _notify();
      case 'playbackStopped':
        playing = false;
        if (event['message'] != null) error = event['message'] as String;
        _notify();
    }
  }

  Future<void> _accept(VoiceRecording value) {
    if (clip?.path == value.path) return _accepting ?? Future.value();
    _endClock();
    stopping = true;
    clip = value;
    operationId = null;
    recordingRevision++;
    _audio = null;
    status = 'draft';
    notice = switch (value.reason) {
      'maxDuration' => '최대 3분까지 녹음됩니다',
      'maxSize' => '녹음 용량 한도에 도달해 정지했습니다',
      'background' => '앱이 백그라운드로 전환되어 녹음을 정지했습니다',
      'recorderError' => '녹음이 중단됐습니다. 저장된 소리를 확인해 주세요.',
      _ => '들어본 뒤 전송해 주세요.',
    };
    _notify();
    return _accepting = () async {
      try {
        await persist(); // 파일 읽기 실패 시에도 원본 경로를 잃지 않는다.
        _audio = await recorder.read(value.path);
        await persist();
      } catch (e) {
        error = '녹음 보존 상태를 확인해 주세요. ${_message(e)}';
      } finally {
        stopping = false;
        _notify();
      }
    }();
  }

  Future<void> stop() {
    if (_stopping != null) return _stopping!;
    if (!microphoneBusy) return _accepting ?? Future.value();
    ++_generation;
    _endClock();
    stopping = true;
    _notify();
    return _stopping = () async {
      try {
        final value = await recorder.stop();
        if (value != null) await _accept(value);
      } catch (e) {
        error = _message(e);
      } finally {
        stopping = false;
        _stopping = null;
        _notify();
      }
    }();
  }

  Future<void> stopPlay() async {
    await recorder.stopPlay();
    playing = false;
    _notify();
  }

  Future<void> preview() async {
    if (busy || recording || !hasClip) return;
    working = true;
    error = null;
    _notify();
    try {
      if (playing) {
        await stopPlay();
      } else {
        _audio ??= await recorder.read(clip!.path);
        playing = true;
        await recorder.play(_audio!);
      }
    } catch (e) {
      playing = false;
      error = _message(e);
    } finally {
      working = false;
      _notify();
    }
  }

  Future<void> pause() async {
    await stop();
    await stopPlay();
    await persist();
  }

  Future<void> discard() async {
    if (busy) return;
    working = true;
    ++_generation;
    _endClock();
    error = notice = null;
    _notify();
    try {
      await stopPlay();
      await recorder.cancel(path: clip?.path);
      playing = false;
      clip = null;
      operationId = null;
      _audio = null;
      status = 'draft';
      await persist();
      // LocalStore에 삭제 메서드가 없으므로 기존 저장 방식으로 내용을 비운다.
      await _clearAudio();
    } catch (e) {
      error = '녹음 취소를 완료하지 못했습니다. ${_message(e)}';
    } finally {
      working = false;
      _notify();
    }
  }

  Future<void> rerecord() async {
    await discard();
    if (error == null) await start();
  }

  Future<void> _clearAudio() {
    final write = _writes
        .catchError((_) {})
        .then(
          (_) => controller.local.writeBytes(owner, audioKey, Uint8List(0)),
        );
    _writes = write;
    return write;
  }

  void _sync(OutboxEntry item) {
    status = item.phase == OutboxPhase.completed
        ? 'sent'
        : item.needsVerification ||
              item.phase == OutboxPhase.uncertain ||
              item.phase == OutboxPhase.sending
        ? 'uncertain'
        : 'draft';
    if (status == 'sent') notice = item.statusLabel;
  }

  Future<void> send({bool confirmedAbsent = false}) async {
    if (busy ||
        recording ||
        !hasClip ||
        (status == 'uncertain' && !confirmedAbsent)) {
      return;
    }
    sending = true;
    error = notice = null;
    var submitted = false, succeeded = false;
    _notify();
    try {
      await stopPlay();
      _audio ??= await recorder.read(clip!.path);
      await persist();
      final retry = operationId != null;
      final existing = controller.outbox.entry(operationId);
      if (retry && existing == null) {
        throw const ApiFailure(
          '기존 전송 작업을 읽지 못했습니다. 전송 원장을 다시 열어 주세요.',
          status: 400,
        );
      }
      final item =
          existing ??
          await controller.outbox.enqueue(
            kind: OutboxKind.voice,
            bytes: _audio!,
            fields: {
              'commentOf': mediaId,
              'audioMs': '${clip!.durationMs}',
              'siteId': ?siteId,
            },
            siteName: siteName,
            owner: owner,
            sourceKey: '$key:recording:$recordingRevision',
          );
      operationId = item.id;
      await persist();
      if (confirmedAbsent && item.needsVerification) {
        await controller.outbox.confirmAbsent(item);
      }
      submitted = true;
      await controller.outbox.send(item, retry: retry);
      _sync(item);
      if (item.phase != OutboxPhase.completed) {
        error = item.message;
        notice = item.statusLabel;
        await persist();
        return;
      }
      succeeded = true;
      status = 'sent';
      await persist();
      await recorder.cancel(path: clip!.path);
      await _clearAudio();
      clip = null;
      _audio = null;
      await persist();
      notice = controller.isMock ? mockCompletedLabel : serverCompletedLabel;
    } catch (e) {
      if (succeeded) {
        status = 'sent';
        error =
            '${controller.isMock ? mockCompletedLabel : serverCompletedLabel}. 기기 파일 정리를 완료하지 못했습니다. ${_message(e)}';
      } else {
        status = e is ApiFailure
            ? (e.uncertainWrite ? 'uncertain' : 'draft')
            : (submitted ? 'uncertain' : 'draft');
        error = _message(e);
      }
      try {
        await persist();
      } catch (storageError) {
        error = '$error\n기기 초안 저장 실패: ${_message(storageError)}';
      }
    } finally {
      sending = false;
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _ticker?.cancel();
    unawaited(_subscription.cancel());
    super.dispose();
  }
}
