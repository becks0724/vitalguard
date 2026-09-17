import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

import 'contracts/field_contracts.dart';

const outboxStorageKey = 'outbox:v1';
const localSavedLabel = '로컬 저장됨 · 서버 미전송';
const serverCompletedLabel = '전송 완료 · 서버 확인됨';
const mockCompletedLabel = '모의 전송 완료 — 실제 서버로 보내지 않았습니다';

enum OutboxKind { photo, ink, voice, text }

enum OutboxPhase {
  waiting,
  sending,
  failed,
  uncertain,
  reauthenticate,
  completed,
}

enum OperationPresence { confirmed, absent, unknown }

class OperationCheck {
  const OperationCheck(
    this.presence, {
    this.receipt,
    this.deduplicated = false,
  });
  final OperationPresence presence;
  final Map<String, dynamic>? receipt;
  final bool deduplicated;
}

const operationLookupBatchSize = 50;

/// 조회만 수행한다. 누락·오류를 미등록으로 추정하지 않는다.
abstract interface class OperationLookupGateway {
  Future<Map<String, OperationCheck>> lookupOperations(
    String token,
    List<String> clientOperationIds,
  );
}

class OutboxEntry {
  OutboxEntry({
    required this.id,
    required this.owner,
    required this.kind,
    required this.fields,
    required this.siteName,
    required this.createdAt,
    required this.mock,
    this.sourceKey,
    this.annotationDraftId,
    this.dependsOn,
    this.completedAt,
    this.draftKeys = const [],
    this.phase = OutboxPhase.waiting,
    this.message,
    this.receipt,
    this.deduplicated = false,
    this.needsVerification = false,
  });

  final String id, owner, siteName;
  final OutboxKind kind;
  final Map<String, String> fields;
  final DateTime createdAt;
  final bool mock;
  final String? sourceKey, annotationDraftId;
  final String? dependsOn;
  DateTime? completedAt;
  final List<String> draftKeys;
  OutboxPhase phase;
  String? message;
  Map<String, dynamic>? receipt;
  bool deduplicated, needsVerification;

  String get bytesKey => 'outbox-file:$id';
  String? get siteId => fields['siteId'];
  String get siteGroup => '${siteId ?? ''}\n$siteName';
  String get kindLabel => switch (kind) {
    OutboxKind.photo => '사진',
    OutboxKind.ink => '잉크본',
    OutboxKind.voice => '음성 댓글',
    OutboxKind.text => '메모',
  };
  String get statusLabel => switch (phase) {
    OutboxPhase.waiting => '$localSavedLabel · 대기',
    OutboxPhase.sending => '로컬 저장됨 · 처리 중',
    OutboxPhase.failed => '로컬 저장됨 · 전송 실패',
    OutboxPhase.uncertain => '로컬 저장됨 · 서버 결과 불명',
    OutboxPhase.reauthenticate => '로컬 저장됨 · 재로그인 필요',
    OutboxPhase.completed => mock ? mockCompletedLabel : serverCompletedLabel,
  };

  Map<String, dynamic> toJson() => {
    'id': id,
    'owner': owner,
    'kind': kind.name,
    'fields': fields,
    'siteName': siteName,
    'createdAt': createdAt.toIso8601String(),
    'mock': mock,
    'sourceKey': sourceKey,
    'annotationDraftId': annotationDraftId,
    'dependsOn': dependsOn,
    'completedAt': completedAt?.toIso8601String(),
    'draftKeys': draftKeys,
    'phase': phase.name,
    'message': message,
    'receipt': receipt,
    'deduplicated': deduplicated,
    'needsVerification': needsVerification,
  };

  factory OutboxEntry.fromJson(Map<String, dynamic> json) => OutboxEntry(
    id: json['id'] as String,
    owner: json['owner'] as String,
    kind: OutboxKind.values.byName(json['kind'] as String),
    fields: Map.unmodifiable(Map<String, String>.from(json['fields'] as Map)),
    siteName: json['siteName'] as String,
    createdAt: DateTime.parse(json['createdAt'] as String),
    mock: json['mock'] as bool,
    sourceKey: json['sourceKey'] as String?,
    annotationDraftId: json['annotationDraftId'] as String?,
    dependsOn: json['dependsOn'] as String?,
    completedAt: json['completedAt'] == null
        ? null
        : DateTime.parse(json['completedAt'] as String),
    draftKeys: List.unmodifiable(
      List<String>.from(json['draftKeys'] as List? ?? const []),
    ),
    phase: OutboxPhase.values.byName(json['phase'] as String),
    message: json['message'] as String?,
    receipt: json['receipt'] == null
        ? null
        : Map<String, dynamic>.from(json['receipt'] as Map),
    deduplicated: json['deduplicated'] == true,
    needsVerification: json['needsVerification'] == true,
  );
}

/// 파일을 먼저 저장하고 원장을 원자적으로 교체한 뒤에만 POST를 허용한다.
/// 경보 대응 확인은 이 큐의 작업 종류/전송 경로에 존재하지 않는다(N-2).
class OutboxController extends ChangeNotifier {
  OutboxController(this.field) {
    field.addListener(_fieldChanged);
  }
  final FieldController field;
  final _accounts = <String, List<OutboxEntry>>{};
  final _inflight = <String>{};
  final _bundleSends = <String, Future<void>>{};
  // 미등록 관측은 재전송 허가가 아니다. 명시적 retry에서만 한 번 소비한다.
  // 재시작·새 조회 뒤에는 다시 확인하도록 디스크에는 저장하지 않는다.
  final _retryableUncertain = <String>{};
  bool _lookupRunning = false;
  String? _lookupOwner, _lookupMessage;
  final _lastAutomaticLookup = <String, DateTime>{};
  Future<void> _writes = Future.value();
  bool _disposed = false;
  String? loadError;

  String? get account =>
      field.authStage == AuthStage.ready ? field.user?.id : null;
  List<OutboxEntry> get items =>
      List.unmodifiable(_accounts[account] ?? const <OutboxEntry>[]);
  bool get supportedLookup => field.operationLookupAvailable;
  bool get checking => _lookupRunning && _lookupOwner == account;
  String? get lookupMessage => _lookupOwner == account ? _lookupMessage : null;
  bool canRetryUncertain(OutboxEntry item) =>
      _owned(item) &&
      item.phase == OutboxPhase.uncertain &&
      _retryableUncertain.contains('${item.owner}:${item.id}');
  bool isBusy(OutboxEntry item) =>
      _inflight.contains('${item.owner}:${item.id}');
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _fieldChanged() {
    _notify();
  }

  Future<T> _serial<T>(Future<T> Function() action) {
    final work = _writes.catchError((_) {}).then((_) => action());
    _writes = work.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return work;
  }

  Future<void> _load(String owner) async {
    if (_accounts.containsKey(owner)) return;
    final raw = await field.local.read(owner, outboxStorageKey);
    final entries = raw == null
        ? <OutboxEntry>[]
        : ((jsonDecode(raw) as Map)['items'] as List)
              .map(
                (e) =>
                    OutboxEntry.fromJson(Map<String, dynamic>.from(e as Map)),
              )
              .toList();
    if (entries.any(
      (e) => e.owner != owner || e.fields['clientOperationId'] != e.id,
    )) {
      throw const FormatException('전송 원장의 계정 또는 작업 ID 불일치');
    }
    for (final entry in entries) {
      if (entry.phase == OutboxPhase.sending) {
        entry.phase = OutboxPhase.uncertain;
        entry.needsVerification = true;
        entry.message = '앱 종료 당시 처리 중이었습니다. 서버 반영 여부를 먼저 확인해 주세요.';
      }
    }
    // 복구 상태를 영속화하지 못하면 보내지 않는다.
    await _write(owner, entries);
    _accounts[owner] = entries;
  }

  Future<void> load() async {
    final owner = account;
    if (owner == null) return;
    try {
      await _serial(() => _load(owner));
      if (owner == account) await purgeExpired();
      loadError = null;
    } catch (_) {
      loadError = '전송 원장을 읽지 못했습니다. 기기 파일은 보존됩니다. 다시 열어 주세요.';
    }
    _notify();
  }

  Future<void> _write(String owner, List<OutboxEntry> entries) =>
      field.local.write(
        owner,
        outboxStorageKey,
        jsonEncode({
          'schemaVersion': 1,
          'items': entries.map((e) => e.toJson()).toList(),
        }),
      );

  String _uuid() {
    final random = Random.secure();
    final bytes = List.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<OutboxEntry> enqueue({
    required OutboxKind kind,
    required Uint8List bytes,
    required Map<String, String> fields,
    required String siteName,
    String? owner,
    String? sourceKey,
    String? annotationDraftId,
    String? dependsOn,
    List<String> draftKeys = const [],
    Uint8List? previewBytes,
  }) {
    if (dependsOn != null &&
        const [
          'annotationOf',
          'commentOf',
          'mediaId',
        ].any(fields.containsKey)) {
      throw ArgumentError('딸린 항목의 서버 참조는 전송 시 원본 사진에서 채웁니다');
    }
    final author = owner ?? account;
    final payload = Uint8List.fromList(bytes);
    final drafts = List<String>.unmodifiable(draftKeys);
    final metadata = Map<String, String>.from(fields)
      ..remove('clientOperationId');
    return _serial(() async {
      if (author == null || author != account) {
        throw const ApiFailure('작성 계정으로 다시 로그인해 주세요', action: 'reauth');
      }
      await _load(author);
      if (author != account) {
        throw const ApiFailure('로그인 상태가 바뀌었습니다', action: 'reauth');
      }
      final entries = _accounts[author]!;
      if (dependsOn != null) {
        final parent = entries
            .where((e) => e.id == dependsOn && e.kind == OutboxKind.photo)
            .firstOrNull;
        if (parent != null) {
          metadata.remove('siteId');
          if (parent.siteId != null) metadata['siteId'] = parent.siteId!;
        }
      }
      // 편집기 링크 저장 직전 앱이 종료돼도 마지막 동일 스냅숏을 재사용한다.
      final previous = sourceKey == null
          ? null
          : entries
                .where(
                  (e) =>
                      e.sourceKey == sourceKey &&
                      e.kind == kind &&
                      e.dependsOn == dependsOn &&
                      listEquals(e.draftKeys, drafts),
                )
                .lastOrNull;
      if (previous != null) {
        final oldFields = Map<String, String>.from(previous.fields)
          ..remove('clientOperationId');
        if (mapEquals(metadata, oldFields) &&
            listEquals(
              payload,
              await field.local.readBytes(author, previous.bytesKey),
            )) {
          return previous;
        }
      }
      final id = _uuid(); // 새 큐 작업에서 단 한 번만 생성한다.
      final entry = OutboxEntry(
        id: id,
        owner: author,
        kind: kind,
        fields: Map.unmodifiable({...metadata, 'clientOperationId': id}),
        siteName: siteName,
        createdAt: DateTime.now(),
        mock: field.isMock,
        sourceKey: sourceKey,
        annotationDraftId: annotationDraftId,
        dependsOn: dependsOn,
        draftKeys: drafts,
      );
      await field.local.writeBytes(author, entry.bytesKey, payload);
      if (previewBytes != null) {
        await field.local.writeBytes(
          author,
          'outbox-preview:$id',
          previewBytes,
        );
      }
      final next = [...entries, entry];
      await _write(author, next);
      _accounts[author] = next;
      _notify();
      return entry;
    });
  }

  OutboxEntry? entry(String? id) => items.where((e) => e.id == id).firstOrNull;

  List<OutboxEntry> dependents(String photoId) {
    final ordered =
        items.indexed.where((e) => e.$2.dependsOn == photoId).toList()
          ..sort((a, b) {
            final time = a.$2.createdAt.compareTo(b.$2.createdAt);
            return time == 0 ? a.$1.compareTo(b.$1) : time;
          });
    return List.unmodifiable(ordered.map((e) => e.$2));
  }

  OutboxEntry? parentOf(OutboxEntry item) {
    final parent = entry(item.dependsOn);
    return parent?.kind == OutboxKind.photo && parent?.owner == item.owner
        ? parent
        : null;
  }

  bool bundleCompleted(String photoId) {
    final photo = entry(photoId);
    return photo?.kind == OutboxKind.photo &&
        photo?.phase == OutboxPhase.completed &&
        dependents(photoId).every((e) => e.phase == OutboxPhase.completed);
  }

  Future<void> _save(OutboxEntry entry) => _serial(() async {
    await _write(entry.owner, _accounts[entry.owner]!);
    _notify();
  });

  bool _owned(OutboxEntry item) =>
      !_disposed &&
      item.owner == account &&
      item.mock == field.isMock &&
      identical(entry(item.id), item);

  Future<void> send(OutboxEntry item, {bool retry = false}) async {
    final explicitUncertainRetry = retry && canRetryUncertain(item);
    if (!_owned(item) ||
        isBusy(item) ||
        item.phase == OutboxPhase.completed ||
        item.phase == OutboxPhase.sending ||
        ((item.needsVerification || item.phase == OutboxPhase.uncertain) &&
            !explicitUncertainRetry)) {
      return;
    }
    final parent = parentOf(item);
    if (item.dependsOn != null) {
      if (parent == null) {
        item.phase = OutboxPhase.failed;
        item.message = '원본 사진 항목이 없습니다';
        await _save(item);
        return;
      }
      if (parent.phase != OutboxPhase.completed) {
        await sendBundle(parent.id, retry: retry);
        return;
      }
      if (parent.receipt?['id'] is! String) {
        item.phase = OutboxPhase.waiting;
        item.message = '원본 사진 결과 확인 후 전송됩니다';
        await _save(item);
        return;
      }
    }
    if (field.offline && !retry) {
      item.message = '오프라인입니다. 연결 후 전송 상태에서 전송/재시도를 눌러 주세요.';
      await _save(item);
      return;
    }
    final key = '${item.owner}:${item.id}';
    _retryableUncertain.remove(key);
    _inflight.add(key);
    var submitted = false;
    try {
      final bytes = await field.local.readBytes(item.owner, item.bytesKey);
      if (bytes == null) {
        throw const ApiFailure('보관 파일을 읽을 수 없습니다', status: 400);
      }
      if (!_owned(item)) return;
      final fields = item.kind == OutboxKind.ink && parent != null
          ? <String, String>{
              // 조회 영수증은 id만 올 수 있으므로 촬영 메타는 로컬 원본으로 보완한다.
              ...annotationFields(
                CalendarMedia({...fromOutbox(parent).json, ...parent.receipt!}),
              ),
              ...item.fields,
              'clientOperationId': item.id,
            }
          : item.fields;
      final mediaId =
          parent?.receipt?['id'] as String? ??
          item.fields[item.kind == OutboxKind.text ? 'mediaId' : 'commentOf'];
      final text = item.kind == OutboxKind.text ? utf8.decode(bytes) : null;
      if (item.kind == OutboxKind.text && mediaId == null) {
        throw const ApiFailure('원본 사진 항목이 없습니다', status: 400);
      }
      item.phase = OutboxPhase.sending;
      item.message = null;
      await _save(item); // sending을 저장하지 못하면 HTTP를 열지 않는다.
      if (!_owned(item)) {
        item.phase = OutboxPhase.reauthenticate;
        return;
      }
      submitted = true;
      if (item.kind == OutboxKind.voice) {
        final result = await field.voiceComment(
          mediaId!,
          bytes,
          durationMs: int.tryParse(item.fields['audioMs'] ?? ''),
          clientOperationId: item.id,
          siteId: item.siteId,
        );
        item.receipt = result.json;
        item.deduplicated = result.deduplicated;
      } else if (item.kind == OutboxKind.text) {
        final result = await field.comment(
          mediaId!,
          text!,
          clientOperationId: item.id,
        );
        item.receipt = result.json;
        item.deduplicated = result.deduplicated;
      } else {
        final result = await field.publish(bytes, fields);
        item.receipt = result.json;
        item.deduplicated = result.deduplicated;
      }
      item.phase = OutboxPhase.completed;
      item.completedAt = DateTime.now();
      item.needsVerification = false;
      item.message = item.deduplicated ? '같은 작업이 이미 서버에 있습니다. 서버 확인됨.' : null;
    } catch (error) {
      final api = error is ApiFailure ? error : null;
      final unknown = api == null
          ? submitted
          : api.uncertainWrite || (submitted && (api.status ?? 0) >= 500);
      item.needsVerification = unknown;
      item.phase = api?.action == 'reauth' || api?.status == 401
          ? OutboxPhase.reauthenticate
          : unknown
          ? OutboxPhase.uncertain
          : OutboxPhase.failed;
      final explanation = switch (api?.status) {
        401 => '로그인이 만료되었습니다. 다시 로그인해 주세요.',
        403 => '이 기록을 전송할 권한이 없습니다.',
        404 => '원본 사진을 찾을 수 없습니다. 삭제 여부를 확인해 주세요.',
        _ => null,
      };
      item.message = explanation != null
          ? '$explanation\n${api!.message}'
          : api?.message ?? '전송 상태를 확인하지 못했습니다. 서버 반영 여부를 먼저 확인해 주세요.';
    } finally {
      try {
        if (item.dependsOn == null) await _cacheInkReceipt(item);
        await _save(item);
        await _cleanupCompletedItem(item);
      } catch (_) {
        item.message = '전송 상태의 기기 저장 실패 · 서버 반영 여부를 확인해 주세요.';
      }
      _inflight.remove(key);
      _notify();
    }
    // 자동 GET은 활성 O 화면이 전경에서만 시작한다. 여기서는 POST를 반복하지 않는다.
  }

  Future<void> sendBundle(String photoId, {bool retry = false}) {
    final photo = entry(photoId);
    if (photo == null || photo.kind != OutboxKind.photo || !_owned(photo)) {
      return Future.value();
    }
    final key = '${photo.owner}:$photoId';
    return _bundleSends[key] ??= _sendBundle(photo, retry: retry).whenComplete(
      () {
        _bundleSends.remove(key);
      },
    );
  }

  Future<void> _sendBundle(OutboxEntry photo, {required bool retry}) async {
    if (photo.phase != OutboxPhase.completed) await send(photo, retry: retry);
    if (photo.phase != OutboxPhase.completed) {
      // 재로그인으로 화면 계정이 사라져도 원래 원장에 대기 이유는 남긴다.
      await _serial(() async {
        final entries = _accounts[photo.owner]!;
        for (final item in entries.where((e) => e.dependsOn == photo.id)) {
          if (item.phase != OutboxPhase.completed) {
            item.message = '원본 사진 결과 확인 후 전송됩니다';
          }
        }
        await _write(photo.owner, entries);
        _notify();
      });
      return;
    }
    if (!_owned(photo)) return;
    for (final item in dependents(photo.id)) {
      if (!_owned(photo)) return;
      if (item.phase != OutboxPhase.completed) await send(item, retry: retry);
    }
    await _cleanupBundle(photo.id);
  }

  Future<void> _removeFiles(OutboxEntry item) async {
    for (final key in {
      item.bytesKey,
      'outbox-preview:${item.id}',
      ...item.draftKeys,
      if (item.receipt?['id'] is String) ...[
        'photo:${item.receipt!['id']}',
        'published:${item.receipt!['id']}',
      ],
    }) {
      await field.local.remove(item.owner, key);
    }
  }

  Future<void> _cleanupBundle(String photoId) {
    final owner = account;
    return _serial(() async {
      if (owner == null || owner != account || !bundleCompleted(photoId)) {
        return;
      }
      // 직전 완료 저장이 실패했어도 영수증을 영속화하기 전에는 파일을 지우지 않는다.
      await _write(owner, _accounts[owner]!);
      for (final item in [entry(photoId)!, ...dependents(photoId)]) {
        await _removeFiles(item);
      }
    });
  }

  Future<void> _cleanupCompletedItem(OutboxEntry item) async {
    if (!_owned(item) || item.phase != OutboxPhase.completed) return;
    if (item.dependsOn != null) {
      await _cleanupBundle(item.dependsOn!);
    } else if (item.kind == OutboxKind.photo &&
        dependents(item.id).isNotEmpty) {
      await _cleanupBundle(item.id);
    }
    // 기존 단독 send(photo)는 유지한다. 사진만의 정리는 sendBundle로 선택한다.
  }

  Future<void> discard(String id) {
    final owner = account;
    return _serial(() async {
      if (owner == null || owner != account) throw StateError('작성 계정이 필요합니다');
      await _load(owner);
      if (owner != account) throw StateError('로그인 상태가 바뀌었습니다');
      final item = entry(id);
      if (item == null) throw StateError('전송함 항목이 없습니다');
      final targets = [
        item,
        if (item.kind == OutboxKind.photo) ...dependents(id),
      ];
      if (targets.any(
        (e) =>
            !_owned(e) ||
            isBusy(e) ||
            (e.phase != OutboxPhase.waiting && e.phase != OutboxPhase.failed),
      )) {
        throw StateError('대기 또는 실패한 항목만 삭제할 수 있습니다');
      }
      final busyKeys = targets.map((e) => '${e.owner}:${e.id}').toSet();
      _inflight.addAll(busyKeys);
      try {
        for (final target in targets) {
          await _removeFiles(target);
        }
        final next = _accounts[owner]!
            .where((e) => !targets.contains(e))
            .toList();
        await _write(owner, next);
        _accounts[owner] = next;
        _retryableUncertain.removeAll(busyKeys);
      } finally {
        _inflight.removeAll(busyKeys);
        _notify();
      }
    });
  }

  Future<int> purgeExpired({
    Duration keep = const Duration(days: 7),
    DateTime? now,
  }) {
    final owner = account;
    final cutoff = now ?? DateTime.now();
    return _serial(() async {
      if (owner == null || owner != account) return 0;
      await _load(owner);
      if (owner != account) return 0;
      final entries = _accounts[owner]!;
      final expired = entries
          .where(
            (e) =>
                e.phase == OutboxPhase.completed &&
                !isBusy(e) &&
                (e.completedAt ?? e.createdAt).add(keep).isBefore(cutoff),
          )
          .toList();
      if (expired.isEmpty) return 0;
      for (final item in expired) {
        await _removeFiles(item);
      }
      final next = entries.where((e) => !expired.contains(e)).toList();
      await _write(owner, next);
      _accounts[owner] = next;
      _notify();
      return expired.length;
    });
  }

  bool _checkable(OutboxEntry item) =>
      _owned(item) && !isBusy(item) && item.phase == OutboxPhase.uncertain;

  Future<void> verify(OutboxEntry item, {bool Function()? shouldContinue}) =>
      _verify([item], shouldContinue: shouldContinue);

  Future<void> verifyUncertain({
    bool automatic = false,
    bool Function()? shouldContinue,
  }) async {
    final owner = account;
    if (owner == null ||
        !supportedLookup ||
        _lookupRunning ||
        shouldContinue?.call() == false) {
      return;
    }
    final candidates = items.where(_checkable).toList();
    if (candidates.isEmpty) return;
    if (automatic) {
      final now = DateTime.now();
      final last = _lastAutomaticLookup[owner];
      if (last != null && now.difference(last) < const Duration(seconds: 30)) {
        return;
      }
      _lastAutomaticLookup[owner] = now;
    }
    await _verify(candidates, shouldContinue: shouldContinue);
  }

  Future<void> _verify(
    List<OutboxEntry> candidates, {
    bool Function()? shouldContinue,
  }) async {
    final owner = account;
    if (owner == null ||
        !supportedLookup ||
        _lookupRunning ||
        shouldContinue?.call() == false) {
      return;
    }
    final pending = candidates.where(_checkable).toList();
    if (pending.isEmpty) return;
    _lookupRunning = true;
    _lookupOwner = owner;
    _lookupMessage = '서버 상태 조회 중 · 결과 불명 ${pending.length}건';
    _notify();
    var confirmed = 0, unresolved = 0;
    try {
      for (
        var offset = 0;
        offset < pending.length;
        offset += operationLookupBatchSize
      ) {
        if (_disposed || owner != account || shouldContinue?.call() == false) {
          _lookupMessage = '서버 조회 중단 · 남은 결과 불명 항목은 화면에서 다시 조회해 주세요.';
          break;
        }
        final batch = pending
            .skip(offset)
            .take(operationLookupBatchSize)
            .where(_checkable)
            .toList();
        if (batch.isEmpty) continue;
        _lookupMessage =
            '서버 상태 조회 중 · ${offset + 1}~${offset + batch.length}/${pending.length}건';
        for (final item in batch) {
          final key = '${item.owner}:${item.id}';
          _inflight.add(key);
          _retryableUncertain.remove(key);
          item.needsVerification = true;
          item.message = '서버 상태 조회 중 · 전송 결과를 확인하고 있습니다.';
        }
        _notify();
        var failed = false;
        try {
          final results = await field.lookupOperations(
            batch.map((e) => e.id).toList(),
          );
          if (_disposed || owner != account) return;
          for (final item in batch) {
            final result =
                results[item.id] ??
                const OperationCheck(OperationPresence.unknown);
            switch (result.presence) {
              case OperationPresence.confirmed:
                item.phase = OutboxPhase.completed;
                item.completedAt = DateTime.now();
                item.receipt ??= result.receipt;
                item.deduplicated = result.deduplicated;
                item.needsVerification = false;
                item.message = '서버 재조회로 확인했습니다.';
                confirmed++;
              case OperationPresence.absent:
                // 아직 커밋 중인 POST일 수 있다. uncertain/needsVerification을 유지한다.
                _retryableUncertain.add('${item.owner}:${item.id}');
                item.message =
                    '조회 시점에는 미등록입니다. 기존 전송이 처리 중일 수 있어 결과 불명을 유지합니다. '
                    '필요하면 같은 작업 재시도를 눌러 주세요. 자동 재전송하지 않습니다.';
                unresolved++;
              case OperationPresence.unknown:
                item.message =
                    '서버 반영 여부를 확인하지 못했습니다. 서버 상태를 다시 조회해 주세요. 자동 재전송하지 않습니다.';
                unresolved++;
            }
          }
          _lookupMessage =
              '서버 조회 완료 · 서버 확인됨 $confirmed건 · 결과 불명 $unresolved건. '
              '남은 항목은 다시 조회하거나 미등록 조회 후 같은 작업 재시도를 눌러 주세요.';
        } catch (error) {
          // 503·통신 실패·잘못된 응답은 absent 분기로 들어갈 수 없다.
          failed = true;
          final status = error is ApiFailure ? error.status : null;
          final reason = switch (status) {
            401 => '로그인이 만료되었습니다. 다시 로그인한 뒤 조회해 주세요.',
            403 => '서버 상태를 조회할 권한이 없습니다. 관리자에게 문의해 주세요.',
            400 => '조회 요청을 확인할 수 없습니다. 앱의 작업 ID를 확인해 주세요.',
            503 => '서버 DB 장애로 상태를 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.',
            _ => '연결 또는 서버 응답을 확인하지 못했습니다. 연결 후 다시 조회해 주세요.',
          };
          _lookupMessage = '서버 조회 실패 · $reason 결과 불명을 유지하며 자동 재전송하지 않습니다.';
          for (final item in batch) {
            item.message = _lookupMessage;
          }
        } finally {
          try {
            for (final item in batch) {
              if (item.dependsOn == null) await _cacheInkReceipt(item);
            }
            await _serial(() => _write(owner, _accounts[owner]!));
            for (final item in batch) {
              await _cleanupCompletedItem(item);
            }
          } catch (_) {
            failed = true;
            _lookupMessage = '조회 상태의 기기 저장 실패 · 서버 상태를 다시 조회해 주세요.';
            for (final item in batch) {
              _retryableUncertain.remove('${item.owner}:${item.id}');
              item.message = _lookupMessage;
            }
          } finally {
            for (final item in batch) {
              _inflight.remove('${item.owner}:${item.id}');
            }
            _notify();
          }
        }
        // 장애·권한 오류 때 남은 묶음을 계속 보내지 않는다.
        if (failed) break;
      }
    } finally {
      _lookupRunning = false;
      _notify();
    }
  }

  Future<void> _cacheInkReceipt(OutboxEntry item) async {
    if (item.phase != OutboxPhase.completed ||
        item.annotationDraftId == null ||
        item.receipt?['id'] is! String) {
      return;
    }
    final id = item.receipt!['id'] as String;
    await field.local.write(
      item.owner,
      'published:$id',
      item.annotationDraftId!,
    );
    final preview = await field.local.readBytes(
      item.owner,
      'outbox-preview:${item.id}',
    );
    if (preview != null) {
      await field.local.writeBytes(item.owner, 'photo:$id', preview);
    }
  }

  /// 조회 계약이 없는 환경에서만 관제웹에서 미등록 확인을 받는다.
  Future<void> confirmAbsent(OutboxEntry item) async {
    if (!_owned(item) ||
        isBusy(item) ||
        !item.needsVerification ||
        supportedLookup) {
      return;
    }
    item.needsVerification = false;
    item.phase = OutboxPhase.failed;
    item.message = '사용자가 관제웹에서 미등록을 확인했습니다. 같은 작업 ID로 재시도합니다.';
    await _save(item);
  }

  @override
  void dispose() {
    _disposed = true;
    field.removeListener(_fieldChanged);
    super.dispose();
  }
}
