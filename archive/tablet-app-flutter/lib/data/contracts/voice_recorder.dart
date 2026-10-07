import 'dart:typed_data';

const maxVoiceBytes = 10 * 1024 * 1024;
const maxVoiceDurationMs = 180000;

class VoiceRecording {
  const VoiceRecording({
    required this.path,
    required this.durationMs,
    required this.byteLength,
    this.reason = 'manual',
  });

  factory VoiceRecording.fromJson(Map<dynamic, dynamic> json) => VoiceRecording(
    path: json['path'] as String,
    durationMs: (json['durationMs'] as num).toInt(),
    byteLength: (json['byteLength'] as num).toInt(),
    reason: json['reason'] as String? ?? 'manual',
  );

  final String path;
  final int durationMs, byteLength;
  final String reason;

  Map<String, dynamic> toJson() => {
    'path': path,
    'durationMs': durationMs,
    'byteLength': byteLength,
    'reason': reason,
  };
}

String voiceTime(int milliseconds) {
  final seconds = milliseconds ~/ 1000;
  return '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
}

abstract interface class VoiceRecorder {
  // stopped: 녹음 메타데이터, error: message, playbackStopped: 재생 종료.
  Stream<Map<String, dynamic>> get events;
  Future<void> start();
  Future<VoiceRecording?> stop();
  Future<void> cancel({String? path});
  Future<Uint8List> read(String path);
  Future<void> play(Uint8List audio);
  Future<void> stopPlay();
  Future<void> close();
}

// 기기 녹음의 종료 콜백을 받기 전에 Dart 프로세스가 사라져도 찾아올 수 있는 계약.
// draftKey는 계정과 원본 사진을 함께 식별하며, 복구는 자동 전송하지 않는다.
abstract interface class RecoverableVoiceRecorder implements VoiceRecorder {
  Future<void> startDraft(String draftKey);
  Future<VoiceRecording?> recoverDraft(String draftKey);
}

// 녹음기를 주입하지 않은 기존 대체 컨트롤러도 화면을 열 수 있다.
class UnavailableVoiceRecorder implements VoiceRecorder {
  const UnavailableVoiceRecorder();
  @override
  Stream<Map<String, dynamic>> get events => const Stream.empty();
  @override
  Future<void> start() async => throw UnsupportedError('이 기기에서는 녹음할 수 없습니다');
  @override
  Future<VoiceRecording?> stop() async => null;
  @override
  Future<void> cancel({String? path}) async {}
  @override
  Future<Uint8List> read(String path) async =>
      throw UnsupportedError('녹음 파일이 없습니다');
  @override
  Future<void> play(Uint8List audio) async =>
      throw UnsupportedError('재생할 수 없습니다');
  @override
  Future<void> stopPlay() async {}
  @override
  Future<void> close() async {}
}
