import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/capture_screen.dart';

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

CalendarMedia _media(String id, String? siteId) =>
    CalendarMedia({'id': id, 'date_key': '2026-09-14', 'site_id': siteId});

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

  // 사진과 스캔이 공유하는 현장 선택·파이프라인·원장·업로드를 스캔 진입점에서 확인한다.
  Future<Map<String, String>> scan() async {
    final count = gateway.uploads.length;
    final result = await launcher.scanDocuments();
    expect(result, isNotNull);
    expect(result!.uploaded, 1);
    expect(result.failed, 0);
    expect(result.queued, 0);
    expect(gateway.uploads, hasLength(count + 1));
    final fields = gateway.uploads.last;
    final entry = controller.outbox.entry(fields['clientOperationId']);
    expect(entry, isNotNull);
    expect(entry!.phase, OutboxPhase.completed);
    expect(entry.siteId, fields['siteId']);
    expect(CalendarMedia(entry.receipt!).site_id, fields['siteId']);
    return fields;
  }

  test('현재 현장 ID는 첫 캡처와 현장 변경 후 업로드에 우선 적용된다', () async {
    controller.site = SiteInfo({'id': 101, 'site_id': 'first-site'});
    controller.media = [];
    expect(await scan(), containsPair('siteId', 'first-site'));

    controller.site = SiteInfo({'id': 102, 'site_id': 'current-site'});
    controller.media = [_media('previous-photo', 'first-site')];
    expect(await scan(), containsPair('siteId', 'current-site'));
  });

  test('현재 현장이나 현장 ID가 없으면 첫 유효한 미디어 현장 ID로 업로드한다', () async {
    controller.media = [
      _media('missing-site', null),
      _media('empty-site', ''),
      _media('first-valid-site', 'fallback-site'),
      _media('later-valid-site', 'other-site'),
    ];
    for (final site in [
      null,
      SiteInfo({'id': 101}),
      SiteInfo({'id': 101, 'site_id': null}),
      SiteInfo({'id': 101, 'site_id': ''}),
    ]) {
      controller.site = site;
      expect(await scan(), containsPair('siteId', 'fallback-site'));
    }
  });

  test('현재 현장과 미디어에 유효한 현장 ID가 없으면 siteId를 전송하지 않는다', () async {
    for (final site in [
      null,
      SiteInfo({'id': 101}),
      SiteInfo({'id': 101, 'site_id': null}),
      SiteInfo({'id': 101, 'site_id': ''}),
    ]) {
      controller.site = site;
      for (final media in [
        <CalendarMedia>[],
        [_media('missing-site', null), _media('empty-site', '')],
      ]) {
        controller.media = media;
        final fields = await scan();
        expect(fields, isNot(contains('siteId')));
        expect(fields['siteId'], isNull);
      }
    }
  });
}
