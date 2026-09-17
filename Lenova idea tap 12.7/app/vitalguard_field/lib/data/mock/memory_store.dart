import 'dart:convert';
import 'dart:typed_data';

import '../contracts/field_contracts.dart';

class MemoryStore implements LocalStore {
  String? tokens;
  final _data = <String, Map<String, Uint8List>>{};
  @override
  Future<String?> readTokenBundle() async => tokens;
  @override
  Future<void> writeTokenBundle(String? json) async {
    tokens = json;
  }

  @override
  Future<String?> read(String accountId, String key) async {
    final bytes = await readBytes(accountId, key);
    return bytes == null ? null : utf8.decode(bytes);
  }

  @override
  Future<void> write(String accountId, String key, String value) =>
      writeBytes(accountId, key, Uint8List.fromList(utf8.encode(value)));
  @override
  Future<Uint8List?> readBytes(String accountId, String key) async =>
      _data[accountId]?[key];
  @override
  Future<void> writeBytes(String accountId, String key, Uint8List bytes) async {
    (_data[accountId] ??= {})[key] = Uint8List.fromList(bytes);
  }

  @override
  Future<void> remove(String accountId, String key) async {
    _data[accountId]?.remove(key);
  }

  @override
  Future<List<String>> keys(String accountId) async =>
      List.of(_data[accountId]?.keys ?? const <String>[]);
}
