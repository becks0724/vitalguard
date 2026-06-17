import 'dart:async';
import 'dart:convert';
import 'dart:io';

// ignore_for_file: prefer_initializing_formals

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:mqtt_client/mqtt_client.dart';
import 'package:mqtt_client/mqtt_server_client.dart';

import '../models/vital_sample.dart';

class AwsIotConfig {
  const AwsIotConfig({
    required this.endpoint,
    required this.clientId,
    required this.topic,
    this.port = 8883,
  });

  final String endpoint;
  final String clientId;
  final String topic;
  final int port;
}

class VitalPublisher {
  // `httpFallbackUrl` is the public constructor name; keep the backing field private.
  VitalPublisher({
    required this.workerId,
    required this.storage,
    Uri? httpFallbackUrl,
  }) : _httpFallbackUrl = httpFallbackUrl;

  final String workerId;
  final FlutterSecureStorage storage;
  Uri? _httpFallbackUrl;

  void setHttpFallbackUrl(Uri? url) {
    _httpFallbackUrl = url;
  }

  MqttServerClient? _client;

  // 전송 실패 샘플 메모리 백로그 — 오프라인/터널 끊김 구간 데이터 유실 방지(AF2).
  // 다음 성공 전송 시 오래된 것부터 flush. cap 초과 시 가장 오래된 것 드롭(최신 우선 보존).
  final List<VitalSample> _backlog = [];
  static const int _maxBacklog = 200;

  int get backlogCount => _backlog.length;

  // ⚠️ 미연결 스캐폴딩 — AWS IoT Core 직송 경로(발표 후 로드맵). 현재 호출처가 없어
  // _client 는 항상 null 이며 publishVital 의 MQTT 분기는 도달하지 않는다(HTTP fallback 가 활성 경로).
  // AWS 결제 보류로 의도적으로 미연결 상태(삭제하지 않고 보존). 상세 docs/commercialization-roadmap.md.
  Future<void> connectMqtt(AwsIotConfig config) async {
    final certificatePem = await storage.read(key: 'aws_iot_certificate_pem');
    final privateKeyPem = await storage.read(key: 'aws_iot_private_key_pem');
    final rootCaPem = await storage.read(key: 'aws_iot_root_ca_pem');

    if (certificatePem == null || privateKeyPem == null || rootCaPem == null) {
      throw StateError('AWS IoT 인증서가 secure storage에 없습니다.');
    }

    final context = SecurityContext.defaultContext
      ..setTrustedCertificatesBytes(utf8.encode(rootCaPem))
      ..useCertificateChainBytes(utf8.encode(certificatePem))
      ..usePrivateKeyBytes(utf8.encode(privateKeyPem));

    final client = MqttServerClient.withPort(
      config.endpoint,
      config.clientId,
      config.port,
    );
    client.secure = true;
    client.securityContext = context;
    client.keepAlivePeriod = 20;
    client.connectionMessage = MqttConnectMessage()
        .withClientIdentifier(config.clientId)
        .startClean()
        .withWillQos(MqttQos.atLeastOnce);

    await client.connect();
    _client = client;
  }

  // 백로그(이전 실패분) + 현재 샘플을 시각 순서대로 전송한다. 첫 실패 지점부터 끝까지를
  // 백로그에 보존하고 예외를 rethrow → 호출부(_pollOnce 등)는 "전송 실패"로 표시하되,
  // 다음 성공 호출에서 보존분이 자동 flush 된다(오프라인 복귀 시 갭 메움).
  Future<void> publishVital(VitalSample sample, {AwsIotConfig? config}) async {
    final queue = <VitalSample>[..._backlog, sample];
    _backlog.clear();
    for (var i = 0; i < queue.length; i++) {
      try {
        await _sendOne(queue[i], config: config);
      } catch (error) {
        final remaining = queue.sublist(i);
        _backlog
          ..clear()
          ..addAll(remaining);
        if (_backlog.length > _maxBacklog) {
          _backlog.removeRange(0, _backlog.length - _maxBacklog);
        }
        rethrow;
      }
    }
  }

  // 백로그에 보존된(이전 실패) 샘플만 재전송 시도 — SOS 즉시 재시도/네트워크 복귀 트리거용.
  // 같은 샘플을 다시 enqueue 하지 않아 중복 없이 재전송된다.
  Future<void> flushBacklog() async {
    if (_backlog.isEmpty) return;
    final queue = <VitalSample>[..._backlog];
    _backlog.clear();
    for (var i = 0; i < queue.length; i++) {
      try {
        await _sendOne(queue[i]);
      } catch (error) {
        final remaining = queue.sublist(i);
        _backlog
          ..clear()
          ..addAll(remaining);
        if (_backlog.length > _maxBacklog) {
          _backlog.removeRange(0, _backlog.length - _maxBacklog);
        }
        rethrow;
      }
    }
  }

  Future<void> _sendOne(VitalSample sample, {AwsIotConfig? config}) async {
    final payload = jsonEncode(sample.toJson());
    final client = _client;

    if (client != null &&
        client.connectionStatus?.state == MqttConnectionState.connected &&
        config != null) {
      final builder = MqttClientPayloadBuilder()..addString(payload);
      client.publishMessage(
        config.topic,
        MqttQos.atLeastOnce,
        builder.payload!,
      );
      return;
    }

    final url = _httpFallbackUrl;
    if (url == null) {
      throw StateError(
        '수신 서버 URL 미설정. 설정 화면에서 LAN URL 을 입력하세요.',
      );
    }

    final http.Response response;
    try {
      response = await http
          .post(
            url,
            headers: const {'content-type': 'application/json'},
            body: payload,
          )
          .timeout(const Duration(seconds: 4));
    } on TimeoutException {
      throw HttpException('타임아웃 (4s) — LAN 도달 실패', uri: url);
    }

    if (response.statusCode >= 400) {
      throw HttpException(
        'HTTP ${response.statusCode}: ${response.body}',
        uri: url,
      );
    }
  }
}
