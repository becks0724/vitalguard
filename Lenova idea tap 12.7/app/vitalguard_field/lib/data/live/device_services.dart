import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';

import '../contracts/field_contracts.dart';

class DeviceLocalStore implements LocalStore {
  static const channel = MethodChannel('vitalguard/local');
  Future<Directory>? _directory;
  Future<void> _pending = Future.value();

  Future<File> _file(String account, String key) async {
    if (account.isEmpty || key.isEmpty) throw ArgumentError('저장 소유자·키가 필요합니다');
    final root = await (_directory ??= channel
        .invokeMethod<String>('dataPath')
        .then((p) => Directory(p!)));
    String segments(String s) {
      final encoded = base64Url.encode(utf8.encode(s));
      return [
        for (var i = 0; i < encoded.length; i += 80)
          encoded.substring(
            i,
            i + 80 < encoded.length ? i + 80 : encoded.length,
          ),
      ].join('/');
    }

    return File(
      '${root.path}/accounts/${segments(account)}/entries/${segments(key)}/value',
    );
  }

  @override
  Future<String?> readTokenBundle() =>
      channel.invokeMethod<String>('readTokens');
  @override
  Future<void> writeTokenBundle(String? json) =>
      channel.invokeMethod<void>('writeTokens', {'value': json});
  @override
  Future<String?> read(String accountId, String key) async {
    final bytes = await readBytes(accountId, key);
    return bytes == null ? null : utf8.decode(bytes);
  }

  @override
  Future<void> write(String accountId, String key, String value) =>
      writeBytes(accountId, key, Uint8List.fromList(utf8.encode(value)));
  @override
  Future<Uint8List?> readBytes(String accountId, String key) async {
    await _pending.catchError((_) {});
    final file = await _file(accountId, key);
    return await file.exists() ? file.readAsBytes() : null;
  }

  @override
  Future<void> writeBytes(String accountId, String key, Uint8List bytes) {
    final operation = _pending.catchError((_) {}).then<void>((_) async {
      final file = await _file(accountId, key);
      await file.parent.create(recursive: true);
      final pending = File('${file.path}.pending');
      await pending.writeAsBytes(bytes, flush: true);
      await pending.rename(file.path);
    });
    _pending = operation;
    return operation;
  }
}

class DeviceSpeechInput implements SpeechInput {
  static const channel = MethodChannel('vitalguard/stt');
  static const eventChannel = EventChannel('vitalguard/stt_events');
  @override
  Stream<Map<String, dynamic>> get events => eventChannel
      .receiveBroadcastStream()
      .map((e) => Map<String, dynamic>.from(e as Map));
  @override
  Future<bool> available() async {
    final value = await channel.invokeMapMethod<String, dynamic>(
      'isOnDeviceAvailable',
    );
    return value?['available'] == true;
  }

  @override
  Future<void> start(String runId) => channel.invokeMethod<void>('start', {
    'runId': runId,
    'sentence': '현장 기록 자유 발화',
    'diagnostic': false,
  });
  @override
  Future<void> stop({bool cancel = false}) =>
      channel.invokeMethod<void>('stop', {'cancel': cancel});
}
