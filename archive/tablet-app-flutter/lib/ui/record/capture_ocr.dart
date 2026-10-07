import 'dart:io';

import 'package:flutter/services.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

import '../../data/contracts/field_contracts.dart';

const scannerPreparationMessage = '인터넷에 연결해 한 번 준비해 주세요';
const cameraPermissionDeniedMessage = '카메라 권한이 거절되어 사진을 촬영하지 않았습니다.';

enum CaptureMode { photo, document }

class CaptureFailure implements Exception {
  const CaptureFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

class CaptureFix {
  const CaptureFix({
    required this.latitude,
    required this.longitude,
    this.accuracyMeters,
    this.measuredAt,
  });

  final double latitude;
  final double longitude;
  final double? accuracyMeters;
  final DateTime? measuredAt;
}

class CaptureAddress {
  const CaptureAddress(this.text, {required this.deviceEstimated});

  final String text;
  final bool deviceEstimated;

  String get stamped {
    final oneLine = text.replaceAll(RegExp(r'[\r\n]+'), ' ').trim();
    return deviceEstimated ? '$oneLine (기기 추정)' : oneLine;
  }
}

class CaptureRunResult {
  const CaptureRunResult({
    required this.uploaded,
    required this.failed,
    this.queued = 0,
    this.queuedIds = const [],
    this.lastError,
  });

  final int uploaded;
  final int failed;
  final int queued;
  final List<String> queuedIds;
  final String? lastError;
}

class CapturedOriginal {
  const CapturedOriginal(this.path, this.capturedAt);

  final String path;
  final DateTime capturedAt;
}

String captureKstStamp(DateTime instant) {
  final value = instant.toUtc().add(const Duration(hours: 9));
  String two(int number) => number.toString().padLeft(2, '0');
  return '${value.year.toString().padLeft(4, '0')}-'
      '${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}:${two(value.second)}';
}

String captureKstIso(DateTime instant) =>
    '${captureKstStamp(instant).replaceFirst(' ', 'T')}+09:00';

int captureCoordinateDigits(double? accuracyMeters) =>
    (accuracyMeters ?? 0) > 10 ? 5 : 6;

List<String> captureStampLines({
  required DateTime capturedAt,
  required CaptureFix? fix,
  required CaptureAddress? address,
  required String workerName,
  required String workerId,
}) {
  final lines = <String>['[${captureKstStamp(capturedAt)}]'];
  if (address != null && address.text.trim().isNotEmpty) {
    // 도로명 파서가 시/도와 로/길 토큰을 같은 줄에서 찾으므로 줄바꿈하지 않는다.
    lines.add(address.stamped);
  }
  if (fix == null) {
    lines.add('위치 미확보');
  } else {
    final digits = captureCoordinateDigits(fix.accuracyMeters);
    final accuracy = (fix.accuracyMeters ?? 0) > 0
        ? ' (±${fix.accuracyMeters!.round()}m)'
        : '';
    final ageSeconds = fix.measuredAt == null
        ? 0
        : capturedAt
              .toUtc()
              .difference(fix.measuredAt!.toUtc())
              .inSeconds
              .clamp(0, 1 << 31);
    final age = ageSeconds >= 60 ? ' (${(ageSeconds / 60).round()}분 전 좌표)' : '';
    lines.add(
      '${fix.latitude.toStringAsFixed(digits)}, '
      '${fix.longitude.toStringAsFixed(digits)}$accuracy$age',
    );
  }
  final name = workerName.replaceAll(RegExp(r'[\r\n]+'), ' ').trim();
  final id = workerId.replaceAll(RegExp(r'[\r\n]+'), ' ').trim();
  lines.add('작업자/ID: $name, $id');
  return lines;
}

Map<String, String> captureUploadFields({
  required DateTime capturedAt,
  required String title,
  required String ocrText,
  required CaptureFix? fix,
  required CaptureAddress? address,
  String? siteId,
}) => {
  'dateKey': captureKstStamp(capturedAt).substring(0, 10),
  'capturedAt': captureKstIso(capturedAt),
  'title': title,
  'ocrText': ocrText,
  if (address != null) 'roadAddress': address.stamped,
  if (fix != null) 'latitude': fix.latitude.toStringAsFixed(6),
  if (fix != null) 'longitude': fix.longitude.toStringAsFixed(6),
  if (siteId != null && siteId.isNotEmpty) 'siteId': siteId,
  // uploader·workerId는 의도적으로 없다. 서버가 JWT 신원으로 귀속한다.
};

abstract interface class CapturePipelinePort {
  Future<CaptureFix?> requestLocation();
  Future<String?> serverAddress(CaptureFix fix);
  Future<String?> deviceAddress(CaptureFix fix);
  Future<String> recognizeOriginal(String path);
  Future<Uint8List> stampResizeJpeg(String path, List<String> stampLines);
  Future<CalendarMedia> upload(Uint8List jpeg, Map<String, String> fields);
}

class CapturePipeline {
  const CapturePipeline(this.port);

  final CapturePipelinePort port;

  Future<CaptureRunResult> process({
    required List<String> originalPaths,
    required DateTime capturedAt,
    required CaptureMode mode,
    required String workerName,
    required String workerId,
    String? siteId,
  }) async {
    if (originalPaths.isEmpty) {
      return const CaptureRunResult(uploaded: 0, failed: 0);
    }

    // 촬영 직후 가장 먼저 요청한다. 정지 상태의 오래된 좌표를 현재 좌표처럼 쓰지 않는다.
    CaptureFix? fix;
    try {
      fix = await port.requestLocation();
    } catch (_) {
      fix = null;
    }

    CaptureAddress? address;
    if (fix != null) {
      try {
        final server = (await port.serverAddress(fix)).nullIfBlank;
        if (server != null) {
          address = CaptureAddress(server, deviceEstimated: false);
        }
      } catch (_) {
        // 서버 주소 실패는 촬영 실패가 아니다. 기기 추정으로 내려간다.
      }
      if (address == null) {
        try {
          final device = (await port.deviceAddress(fix)).nullIfBlank;
          if (device != null) {
            address = CaptureAddress(device, deviceEstimated: true);
          }
        } catch (_) {
          // 주소는 선택값이다. 좌표와 미확보 표시는 그대로 남긴다.
        }
      }
    }

    final stampLines = captureStampLines(
      capturedAt: capturedAt,
      fix: fix,
      address: address,
      workerName: workerName,
      workerId: workerId,
    );
    var failed = 0;
    final queuedIds = <String>[];
    String? lastError;
    for (var index = 0; index < originalPaths.length; index++) {
      try {
        // ★ OCR은 원본 파일 경로로 먼저 실행한다. 리사이즈/각인은 이 호출 뒤에만 온다.
        final recognized = await port.recognizeOriginal(originalPaths[index]);
        final pageText =
            '페이지 ${index + 1}\n'
            '${recognized.trim().isEmpty ? '[텍스트 미검출]' : recognized.trim()}';
        final ocrText = ([pageText] + stampLines).join('\n');
        final jpeg = await port.stampResizeJpeg(
          originalPaths[index],
          stampLines,
        );
        final title = mode == CaptureMode.photo
            ? '현장 사진'
            : '서류 스캔 · 페이지 ${index + 1}';
        final fields = captureUploadFields(
          capturedAt: capturedAt,
          title: title,
          ocrText: ocrText,
          fix: fix,
          address: address,
          siteId: siteId,
        );
        final photo = await port.upload(jpeg, fields);
        queuedIds.add(photo.id);
      } catch (error) {
        failed++;
        lastError = error is CaptureFailure ? error.message : '$error';
      }
    }
    return CaptureRunResult(
      uploaded: 0,
      failed: failed,
      queued: queuedIds.length,
      queuedIds: List.unmodifiable(queuedIds),
      lastError: lastError,
    );
  }
}

extension on String? {
  String? get nullIfBlank {
    final value = this?.trim();
    return value == null || value.isEmpty ? null : value;
  }
}

abstract interface class CaptureNativePort {
  Future<bool> prepareDocumentScanner();
  Future<List<String>?> scanDocuments();
  Future<CaptureFix?> requestLocation();
  Future<String?> reverseGeocode(CaptureFix fix);
  Future<Uint8List> stampResizeJpeg(String path, List<String> stampLines);
}

class DeviceCaptureNative implements CaptureNativePort {
  const DeviceCaptureNative();

  static const _channel = MethodChannel('vitalguard/capture');

  @override
  Future<bool> prepareDocumentScanner() async {
    try {
      return await _channel.invokeMethod<bool>('prepareScanner') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<List<String>?> scanDocuments() async {
    try {
      final paths = await _channel.invokeListMethod<String>('scanDocuments');
      return paths == null || paths.isEmpty ? null : paths;
    } on PlatformException catch (error) {
      if (error.code == 'scanner_not_ready') {
        throw const CaptureFailure(scannerPreparationMessage);
      }
      throw CaptureFailure(error.message ?? '서류 스캔을 시작하지 못했습니다.');
    } on MissingPluginException {
      throw const CaptureFailure('이 기기에서는 서류 스캔을 사용할 수 없습니다.');
    }
  }

  @override
  Future<CaptureFix?> requestLocation() async {
    try {
      final value = await _channel.invokeMapMethod<String, dynamic>(
        'requestLocation',
      );
      if (value == null) return null;
      final latitude = (value['latitude'] as num?)?.toDouble();
      final longitude = (value['longitude'] as num?)?.toDouble();
      if (latitude == null || longitude == null) return null;
      final timestamp = (value['timestampEpochMs'] as num?)?.toInt();
      return CaptureFix(
        latitude: latitude,
        longitude: longitude,
        accuracyMeters: (value['accuracyMeters'] as num?)?.toDouble(),
        measuredAt: timestamp == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(timestamp, isUtc: true),
      );
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Future<String?> reverseGeocode(CaptureFix fix) async {
    try {
      return await _channel.invokeMethod<String>('reverseGeocode', {
        'latitude': fix.latitude,
        'longitude': fix.longitude,
      });
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Future<Uint8List> stampResizeJpeg(
    String path,
    List<String> stampLines,
  ) async {
    try {
      final output = await _channel.invokeMethod<String>('stampResizeJpeg', {
        'path': path,
        'lines': stampLines,
        'maxEdge': 2400,
        'quality': 85,
      });
      if (output == null) throw const CaptureFailure('각인 이미지를 만들지 못했습니다.');
      final file = File(output);
      final bytes = await file.readAsBytes();
      try {
        await file.delete();
      } catch (_) {}
      return bytes;
    } on PlatformException catch (error) {
      throw CaptureFailure(error.message ?? '각인 이미지를 만들지 못했습니다.');
    } on MissingPluginException {
      throw const CaptureFailure('이 기기에서는 사진 각인을 사용할 수 없습니다.');
    }
  }
}

class MlKitCaptureText {
  MlKitCaptureText()
    : _recognizer = TextRecognizer(script: TextRecognitionScript.korean);

  final TextRecognizer _recognizer;

  Future<String> recognizeOriginal(String path) async {
    try {
      final result = await _recognizer.processImage(
        InputImage.fromFilePath(path),
      );
      return result.text;
    } catch (_) {
      return '';
    }
  }

  Future<void> close() async {
    try {
      await _recognizer.close();
    } on PlatformException {
      // 테스트/미지원 플랫폼에는 플러그인 채널이 없다.
    } on MissingPluginException {
      // 테스트/미지원 플랫폼에는 플러그인 채널이 없다.
    }
  }
}

class DeviceCapturePipelinePort implements CapturePipelinePort {
  DeviceCapturePipelinePort({
    required this.controller,
    required this.native,
    required this.text,
    this.owner,
    this.siteName,
  });

  final FieldController controller;
  final CaptureNativePort native;
  final MlKitCaptureText text;
  final String? owner, siteName;

  @override
  Future<CaptureFix?> requestLocation() => native.requestLocation();

  @override
  Future<String?> serverAddress(CaptureFix fix) => controller.captureAddress(
    latitude: fix.latitude,
    longitude: fix.longitude,
  );

  @override
  Future<String?> deviceAddress(CaptureFix fix) => native.reverseGeocode(fix);

  @override
  Future<String> recognizeOriginal(String path) => text.recognizeOriginal(path);

  @override
  Future<Uint8List> stampResizeJpeg(String path, List<String> stampLines) =>
      native.stampResizeJpeg(path, stampLines);

  @override
  Future<CalendarMedia> upload(
    Uint8List jpeg,
    Map<String, String> fields,
  ) async {
    final item = await controller.outbox.enqueue(
      kind: OutboxKind.photo,
      bytes: jpeg,
      fields: fields,
      owner: owner,
      siteName: siteName ?? controller.site?.site_name ?? '현장 정보 없음',
    );
    return fromOutbox(item);
  }
}
