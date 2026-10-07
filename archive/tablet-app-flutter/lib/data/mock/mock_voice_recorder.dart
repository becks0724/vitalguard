import 'dart:async';
import 'dart:typed_data';

import '../contracts/voice_recorder.dart';

// 모의 흐름 전용. 실제 마이크·파일·네트워크를 사용하지 않는다.
class MockVoiceRecorder implements VoiceRecorder {
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final _files = <String, Uint8List>{};
  final _clock = Stopwatch();
  Timer? _limit, _playback;
  VoiceRecording? _last;
  int _id = 0;
  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

  @override
  Future<void> start() async {
    if (_clock.isRunning) throw StateError('이미 녹음 중입니다');
    _last = null;
    _clock
      ..reset()
      ..start();
    _limit = Timer(const Duration(milliseconds: maxVoiceDurationMs), () {
      final recording = _finish('maxDuration');
      _events.add({'type': 'stopped', ...recording.toJson()});
    });
  }

  VoiceRecording _finish(String reason) {
    _limit?.cancel();
    _clock.stop();
    final path = 'mock-voice-${++_id}.m4a';
    final audio = Uint8List.fromList('MOCK VOICE $_id'.codeUnits);
    _files[path] = audio;
    return _last = VoiceRecording(
      path: path,
      durationMs: reason == 'maxDuration'
          ? maxVoiceDurationMs
          : _clock.elapsedMilliseconds,
      byteLength: audio.length,
      reason: reason,
    );
  }

  @override
  Future<VoiceRecording?> stop() async =>
      _clock.isRunning ? _finish('manual') : _last;
  @override
  Future<Uint8List> read(String path) async =>
      Uint8List.fromList(_files[path]!);
  @override
  Future<void> cancel({String? path}) async {
    if (_clock.isRunning) _finish('cancelled');
    _files.remove(path ?? _last?.path);
    _last = null;
    await stopPlay();
  }

  @override
  Future<void> play(Uint8List audio) async {
    _playback?.cancel();
    _playback = Timer(Duration(milliseconds: _last?.durationMs ?? 1000), () {
      _events.add({'type': 'playbackStopped'});
    });
  }

  @override
  Future<void> stopPlay() async => _playback?.cancel();
  @override
  Future<void> close() async {
    _limit?.cancel();
    _playback?.cancel();
    _clock.stop();
    await _events.close();
  }
}
