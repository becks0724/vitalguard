import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/capture_screen.dart';

import 'support/record_fixture.dart';

class _Gateway extends MockGateway {
  final uploads = <Map<String, String>>[];

  @override
  Future<CalendarMedia> upload(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
  ) {
    uploads.add(Map.of(fields));
    return super.upload(token, bytes, fields);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  const captureChannel = MethodChannel('vitalguard/capture');
  const textChannel = MethodChannel('google_mlkit_text_recognizer');
  const jpeg = [0xff, 0xd8, 0xff, 0xd9];
  late Directory directory;
  late _Gateway gateway;
  late FieldCoordinator controller;
  late DeviceCaptureLauncher launcher;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('vg-capture-site-id-');
    gateway = _Gateway();
    controller = FieldCoordinator(gateway, MemoryStore(), MockSpeechInput());
    await controller.signIn('capture-user', 'mock');
    launcher = DeviceCaptureLauncher(controller);
    messenger.setMockMethodCallHandler(captureChannel, (call) async {
      switch (call.method) {
        case 'scanDocuments':
          final original = File('${directory.path}/original.jpg');
          await original.writeAsBytes(jpeg);
          return [original.path];
        case 'requestLocation':
          return null;
        case 'stampResizeJpeg':
          final stamped = File('${directory.path}/stamped.jpg');
          await stamped.writeAsBytes(jpeg);
          return stamped.path;
        default:
          throw StateError('예상하지 않은 촬영 호출: ${call.method}');
      }
    });
    messenger.setMockMethodCallHandler(textChannel, (call) async {
      switch (call.method) {
        case 'vision#startTextRecognizer':
          return {'text': '', 'blocks': <Object?>[]};
        case 'vision#closeTextRecognizer':
          return null;
        default:
          throw StateError('예상하지 않은 OCR 호출: ${call.method}');
      }
    });
  });

  tearDown(() async {
    await launcher.dispose();
    controller.dispose();
    messenger.setMockMethodCallHandler(captureChannel, null);
    messenger.setMockMethodCallHandler(textChannel, null);
    await directory.delete(recursive: true);
  });

  // 스캔도 촬영과 같은 로컬 보류 파이프라인을 거친다.
  Future<Map<String, String>> scan() async {
    final result = await launcher.scanDocuments();
    expect(result, isNotNull);
    expect(result!.uploaded, 0);
    expect(result.failed, 0);
    expect(result.queued, 1);
    expect(result.queuedIds, hasLength(1));
    expect(gateway.uploads, isEmpty);
    final entry = controller.outbox.entry(result.queuedIds.single)!;
    expect(entry.kind, OutboxKind.photo);
    expect(entry.phase, OutboxPhase.waiting);
    expect(entry.receipt, isNull);
    expect(await controller.local.readBytes(entry.owner, entry.bytesKey), jpeg);
    expect(fromOutbox(entry).json['local'], isTrue);
    return entry.fields;
  }

  test('현재 현장 ID는 첫 캡처와 현장 변경 후 보류 사진에 고정된다', () async {
    controller.site = SiteInfo({'id': 101, 'site_id': 'first-site'});
    expect(await scan(), containsPair('siteId', 'first-site'));
    controller.site = SiteInfo({'id': 102, 'site_id': 'current-site'});
    expect(await scan(), containsPair('siteId', 'current-site'));
    expect(controller.outbox.items.first.siteId, 'first-site');
  });

  test('현재 현장 ID가 없으면 다른 보류 사진의 현장 ID를 빌리지 않는다', () async {
    await seedPhoto(controller, fields: {'siteId': 'other-site'});
    for (final site in [
      null,
      SiteInfo({'id': 101}),
      SiteInfo({'site_id': ''}),
    ]) {
      controller.site = site;
      expect(await scan(), isNot(contains('siteId')));
    }
  });

  test('오프라인 스캔도 사진을 waiting에 보관하고 서버를 호출하지 않는다', () async {
    controller.offline = true;
    controller.site = null;
    expect(await scan(), isNot(contains('siteId')));
    expect(controller.outbox.items.single.phase, OutboxPhase.waiting);
    expect(gateway.uploads, isEmpty);
  });
}
