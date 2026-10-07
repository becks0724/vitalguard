import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';

import '../contracts/field_contracts.dart';
import 'local_store_paths.dart';

class DeviceLocalStore implements LocalStore {
  static const channel = MethodChannel('vitalguard/local');
  Future<Directory>? _directory;
  Future<void> _pending = Future.value();

  Future<Directory> _entries(String account) async {
    if (account.isEmpty) throw ArgumentError('저장 소유자가 필요합니다');
    final root = await (_directory ??= channel
        .invokeMethod<String>('dataPath')
        .then((p) => Directory(p!)));
    return Directory(
      '${root.path}/accounts/${localStorePathSegments(account).join('/')}/entries',
    );
  }

  Future<File> _file(String account, String key) async {
    final segments = localStorePathSegments(key);
    final entries = await _entries(account);
    return File('${entries.path}/${segments.join('/')}/value');
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

  @override
  Future<void> remove(String accountId, String key) {
    final operation = _pending.catchError((_) {}).then<void>((_) async {
      final entries = await _entries(accountId);
      final file = await _file(accountId, key);
      if (await file.exists()) await file.delete();
      var parent = file.parent;
      while (parent.path != entries.path && await parent.exists()) {
        if (!await parent.list(followLinks: false).isEmpty) break;
        await parent.delete();
        parent = parent.parent;
      }
    });
    _pending = operation;
    return operation;
  }

  @override
  Future<List<String>> keys(String accountId) {
    final operation = _pending.catchError((_) {}).then<List<String>>((_) async {
      final entries = await _entries(accountId);
      if (!await entries.exists()) return [];
      final result = <String>[];
      await for (final entity in entries.list(
        recursive: true,
        followLinks: false,
      )) {
        if (entity is! File) continue;
        final parts = entity.path
            .substring(entries.path.length + 1)
            .split(Platform.pathSeparator);
        if (parts.last != 'value') continue;
        final key = localStoreKeyFromSegments(
          parts.sublist(0, parts.length - 1),
        );
        if (key != null) result.add(key);
      }
      return result..sort();
    });
    _pending = operation.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
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
