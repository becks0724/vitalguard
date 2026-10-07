import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

import '../contracts/voice_recorder.dart';

class DeviceVoiceRecorder implements RecoverableVoiceRecorder {
  DeviceVoiceRecorder() {
    channel.setMethodCallHandler((call) async {
      if (!_events.isClosed) {
        _events.add({
          ...Map<String, dynamic>.from(call.arguments as Map? ?? {}),
          'type': call.method,
        });
      }
    });
  }

  static const channel = MethodChannel('vitalguard/recorder');
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  @override
  Stream<Map<String, dynamic>> get events => _events.stream;
  @override
  Future<void> start() => channel.invokeMethod<void>('start');
  @override
  Future<void> startDraft(String draftKey) =>
      channel.invokeMethod<void>('start', {'draftKey': draftKey});
  @override
  Future<VoiceRecording?> recoverDraft(String draftKey) async {
    final value = await channel.invokeMapMethod<String, dynamic>('recover', {
      'draftKey': draftKey,
    });
    return value == null ? null : VoiceRecording.fromJson(value);
  }

  @override
  Future<VoiceRecording?> stop() async {
    final value = await channel.invokeMapMethod<String, dynamic>('stop');
    return value == null ? null : VoiceRecording.fromJson(value);
  }

  @override
  Future<void> cancel({String? path}) =>
      channel.invokeMethod<void>('cancel', {'path': path});
  @override
  Future<Uint8List> read(String path) => File(path).readAsBytes();
  @override
  Future<void> play(Uint8List audio) =>
      channel.invokeMethod<void>('play', {'audio': audio});
  @override
  Future<void> stopPlay() => channel.invokeMethod<void>('stopPlay');
  @override
  Future<void> close() async {
    try {
      await stop();
      await stopPlay();
    } finally {
      channel.setMethodCallHandler(null);
      await _events.close();
    }
  }
}
