import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/capture_ocr.dart';
import 'package:vitalguard_field/ui/record/capture_screen.dart';

final _capturedAt = DateTime.utc(2026, 8, 19, 5, 7, 17); // KST 14:07:17

class _PipelinePort implements CapturePipelinePort {
  CaptureFix? fix;
  String? server;
  String? device;
  String recognized = '안전난간 점검';
  final calls = <String>[];
  Map<String, String>? uploadedFields;

  @override
  Future<CaptureFix?> requestLocation() async {
    calls.add('location');
    return fix;
  }

  @override
  Future<String?> serverAddress(CaptureFix fix) async {
    calls.add('server-address');
    return server;
  }

  @override
  Future<String?> deviceAddress(CaptureFix fix) async {
    calls.add('device-address');
    return device;
  }

  @override
  Future<String> recognizeOriginal(String path) async {
    calls.add('ocr:$path');
    return recognized;
  }

  @override
  Future<Uint8List> stampResizeJpeg(
    String path,
    List<String> stampLines,
  ) async {
    calls.add('stamp-resize:$path');
    return Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]);
  }

  @override
  Future<CalendarMedia> upload(
    Uint8List jpeg,
    Map<String, String> fields,
  ) async {
    calls.add('upload');
    uploadedFields = fields;
    return CalendarMedia({
      'id': 'capture-1',
      'date_key': fields['dateKey'],
      'captured_at': fields['capturedAt'],
    });
  }
}

class _Launcher implements CaptureLauncher {
  int photoCalls = 0;
  int scanCalls = 0;

  @override
  Future<bool> prepareScanner() async => false;

  @override
  Future<CaptureRunResult?> capturePhoto(BuildContext context) async {
    photoCalls++;
    return const CaptureRunResult(uploaded: 0, queued: 1, failed: 0);
  }

  @override
  Future<CaptureRunResult?> scanDocuments() async {
    scanCalls++;
    throw const CaptureFailure(scannerPreparationMessage);
  }

  @override
  Future<void> dispose() async {}
}

class _DeniedCamera implements CaptureCamera {
  @override
  Future<void> initialize() =>
      Future.error(CameraException('CameraAccessDenied', 'denied'));

  @override
  Widget preview() => const SizedBox();

  @override
  Future<String> takePicture() => throw UnimplementedError();

  @override
  Future<void> dispose() async {}
}

void main() {
  test('각인 GPS는 정확도에 따라 소수 5자리 또는 6자리로 찍는다', () {
    final inaccurate = captureStampLines(
      capturedAt: _capturedAt,
      fix: const CaptureFix(
        latitude: 35.1234567,
        longitude: 127.1234567,
        accuracyMeters: 44,
      ),
      address: null,
      workerName: '홍길동',
      workerId: 'EMP-6861',
    )[1];
    final accurate = captureStampLines(
      capturedAt: _capturedAt,
      fix: const CaptureFix(
        latitude: 35.1234567,
        longitude: 127.1234567,
        accuracyMeters: 10,
      ),
      address: null,
      workerName: '홍길동',
      workerId: 'EMP-6861',
    )[1];

    expect(inaccurate, startsWith('35.12346, 127.12346'));
    expect(accurate, startsWith('35.123457, 127.123457'));
    expect(
      RegExp(r'-?\d{1,3}\.(\d{4,}),\s*-?\d{1,3}\.(\d{4,})')
          .hasMatch(inaccurate),
      isTrue,
    );
    expect(captureCoordinateDigits(10.0001), 5);
    expect(captureCoordinateDigits(10), 6);
  });

  test('위치를 못 받으면 빈 줄 대신 위치 미확보를 찍는다', () {
    final lines = captureStampLines(
      capturedAt: _capturedAt,
      fix: null,
      address: null,
      workerName: '홍길동',
      workerId: 'EMP-6861',
    );

    expect(lines, ['[2026-08-19 14:07:17]', '위치 미확보', '작업자/ID: 홍길동, EMP-6861']);
  });

  test('60초 이상 묵은 좌표에는 나이를 함께 찍는다', () {
    final line = captureStampLines(
      capturedAt: _capturedAt,
      fix: CaptureFix(
        latitude: 35.12345,
        longitude: 127.12345,
        measuredAt: _capturedAt.subtract(const Duration(seconds: 185)),
      ),
      address: null,
      workerName: '홍길동',
      workerId: 'EMP-6861',
    )[1];

    expect(line, contains('(3분 전 좌표)'));
  });

  test('기기 추정 주소는 한 줄에 출처를 밝힌다', () {
    final lines = captureStampLines(
      capturedAt: _capturedAt,
      fix: const CaptureFix(latitude: 35.12345, longitude: 127.12345),
      address: const CaptureAddress('광주광역시\n동구 금남로 1', deviceEstimated: true),
      workerName: '홍길동',
      workerId: 'EMP-6861',
    );

    expect(lines[1], '광주광역시 동구 금남로 1 (기기 추정)');
  });

  test('OCR은 리사이즈 전 원본으로 돌고 업로드 폼에는 신원을 넣지 않는다', () async {
    final port = _PipelinePort()
      ..fix = const CaptureFix(
        latitude: 35.12345,
        longitude: 127.12345,
        accuracyMeters: 12,
      )
      ..server = '전라남도 순천시 중앙로 1';

    final result = await CapturePipeline(port).process(
      originalPaths: const ['/original/full-resolution.jpg'],
      capturedAt: _capturedAt,
      mode: CaptureMode.photo,
      workerName: '홍길동',
      workerId: 'EMP-6861',
      siteId: 'site-1',
    );

    expect(result.uploaded, 0);
    expect(result.queued, 1);
    expect(result.queuedIds, ['capture-1']);
    expect(port.calls, [
      'location',
      'server-address',
      'ocr:/original/full-resolution.jpg',
      'stamp-resize:/original/full-resolution.jpg',
      'upload',
    ]);
    expect(port.uploadedFields, containsPair('dateKey', '2026-08-19'));
    expect(
      port.uploadedFields,
      containsPair('capturedAt', '2026-08-19T14:07:17+09:00'),
    );
    expect(port.uploadedFields, containsPair('siteId', 'site-1'));
    expect(port.uploadedFields, containsPair('title', '현장 사진'));
    expect(port.uploadedFields, containsPair('roadAddress', '전라남도 순천시 중앙로 1'));
    expect(port.uploadedFields, containsPair('latitude', '35.123450'));
    expect(port.uploadedFields, containsPair('longitude', '127.123450'));
    expect(port.uploadedFields, contains('ocrText'));
    expect(port.uploadedFields, isNot(contains('uploader')));
    expect(port.uploadedFields, isNot(contains('workerName')));
    expect(port.uploadedFields, isNot(contains('workerId')));
    expect(port.uploadedFields!['ocrText'], contains('작업자/ID: 홍길동, EMP-6861'));
  });

  test('서버 주소가 없을 때만 기기 주소로 내려가며 출처를 남긴다', () async {
    final port = _PipelinePort()
      ..fix = const CaptureFix(latitude: 35.12345, longitude: 127.12345)
      ..device = '광주광역시 동구 금남로 1';

    await CapturePipeline(port).process(
      originalPaths: const ['/original/document.jpg'],
      capturedAt: _capturedAt,
      mode: CaptureMode.document,
      workerName: '홍길동',
      workerId: 'EMP-6861',
    );

    expect(port.calls.take(3), [
      'location',
      'server-address',
      'device-address',
    ]);
    expect(port.uploadedFields!['roadAddress'], '광주광역시 동구 금남로 1 (기기 추정)');
  });

  testWidgets('스캐너가 준비되지 않아도 사진 촬영은 그대로 동작한다', (tester) async {
    final controller = FieldCoordinator(
      MockGateway(),
      MemoryStore(),
      MockSpeechInput(),
    );
    await controller.signIn('capture-user', 'mock');
    final launcher = _Launcher();
    var reloads = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CaptureActionPanel(
            controller: controller,
            launcher: launcher,
            onUploaded: () async => reloads++,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text(scannerPreparationMessage), findsOneWidget);
    expect(tester.getSize(find.byKey(const Key('document-scan'))).height, 64);
    expect(tester.getSize(find.byKey(const Key('photo-capture'))).height, 64);

    await tester.tap(find.byKey(const Key('document-scan')));
    await tester.pump();
    expect(find.byKey(const Key('capture-status')), findsOneWidget);
    expect(find.text(scannerPreparationMessage), findsNWidgets(2));

    await tester.tap(find.byKey(const Key('photo-capture')));
    await tester.pump();
    expect(launcher.photoCalls, 1);
    expect(find.text('기기에 저장됨 · 1건 · 주석·메모를 붙인 뒤 전송'), findsOneWidget);
    expect(reloads, 1);

    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('카메라 권한 거절 시 빈 화면 대신 거절 사실을 말한다', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: CameraCaptureScreen(camera: _DeniedCamera())),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('camera-error')), findsOneWidget);
    expect(find.text(cameraPermissionDeniedMessage), findsOneWidget);
    expect(find.byType(CameraPreview), findsNothing);
  });
}
