// 배터리 실측 전용. 본 앱과 분리하고 VG_CCTV_PROBE에서만 연다.
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'data/cctv_image_reader.dart';
import 'vg_theme.dart';

const _requestTimeout = Duration(seconds: 15);

class CctvProbeScreen extends StatefulWidget {
  const CctvProbeScreen({super.key});

  @override
  State<CctvProbeScreen> createState() => _CctvProbeScreenState();
}

class _CctvProbeScreenState extends State<CctvProbeScreen> {
  final _url = TextEditingController();
  final _ticket = TextEditingController();
  Timer? _timer;
  HttpClient? _activeClient;
  ui.Image? _image;
  int _period = 5;
  int _generation = 0;
  int _frames = 0;
  int? _lastBytes;
  int? _lastRoundTripMs;
  String? _lastError;
  bool _running = false;

  bool get _locked => _running || _activeClient != null;

  void _start() {
    if (_locked) return;
    final uri = Uri.tryParse(_url.text.trim());
    if (uri == null ||
        !const ['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      setState(() => _lastError = '전체 HTTP 또는 HTTPS 주소를 입력하세요.');
      return;
    }
    final ticket = _ticket.text.trim();
    if (RegExp(r'[\x00-\x1f\x7f]').hasMatch(ticket)) {
      setState(() => _lastError = '티켓에는 줄바꿈이나 제어 문자를 넣을 수 없습니다.');
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    final previous = _image;
    final generation = ++_generation;
    setState(() {
      _running = true;
      _frames = 0;
      _lastBytes = null;
      _lastRoundTripMs = null;
      _lastError = null;
      _image = null;
    });
    previous?.dispose();
    _timer = Timer.periodic(Duration(seconds: _period), (_) {
      unawaited(_poll(uri, ticket, generation));
    });
    unawaited(_poll(uri, ticket, generation));
  }

  void _stop() {
    _timer?.cancel();
    _timer = null;
    _running = false;
    _generation++;
    _activeClient?.close(force: true);
  }

  Future<void> _poll(Uri uri, String ticket, int generation) async {
    // 느린 요청이 진행 중이면 이번 주기를 건너뛴다. 밀린 요청을 쌓지 않는다.
    if (!_running || generation != _generation || _activeClient != null) return;
    final client = HttpClient()..connectionTimeout = _requestTimeout;
    _activeClient = client;
    final watch = Stopwatch()..start();
    try {
      final bytes = await _fetchImage(
        client,
        uri,
        ticket,
      ).timeout(_requestTimeout);
      watch.stop();
      if (!mounted || generation != _generation) return;

      // 한 장만 디코딩하며 이전 이미지를 해제한다. 누적 이미지 캐시나 애니메이션 없음.
      final codec = await ui.instantiateImageCodec(bytes);
      final ui.FrameInfo frame;
      try {
        frame = await codec.getNextFrame();
      } finally {
        codec.dispose();
      }
      if (!mounted || generation != _generation) {
        frame.image.dispose();
        return;
      }
      final previous = _image;
      setState(() {
        _image = frame.image;
        _frames++;
        _lastBytes = bytes.length;
        _lastRoundTripMs = watch.elapsedMilliseconds;
        _lastError = null;
      });
      previous?.dispose();
    } catch (error) {
      if (mounted && generation == _generation) {
        // 원본 예외/응답/URL/티켓은 출력하지 않는다. 다음 주기에 계속 재시도한다.
        setState(() => _lastError = _safeError(error));
      }
    } finally {
      client.close(force: true);
      if (identical(_activeClient, client)) _activeClient = null;
      if (mounted) setState(() {});
    }
  }

  @override
  void dispose() {
    _stop();
    _url.dispose();
    _ticket.dispose();
    _image?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = _lastBytes == null
        ? '—'
        : '${(_lastBytes! / 1024).toStringAsFixed(1)}KB';
    final roundTrip = _lastRoundTripMs == null ? '—' : '${_lastRoundTripMs}ms';
    return MaterialApp(
      title: 'CCTV 스냅샷 측정',
      theme: vgLightTheme(),
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        appBar: AppBar(title: const Text('CCTV 스냅샷 측정')),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              TextField(
                controller: _url,
                enabled: !_locked,
                keyboardType: TextInputType.url,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: 'URL (전체 주소)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _ticket,
                enabled: !_locked,
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
                enableIMEPersonalizedLearning: false,
                decoration: const InputDecoration(
                  labelText: '티켓 (선택)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 16,
                runSpacing: 16,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text('주기'),
                  SegmentedButton<int>(
                    segments: const [
                      ButtonSegment(value: 3, label: Text('3초')),
                      ButtonSegment(value: 5, label: Text('5초')),
                      ButtonSegment(value: 10, label: Text('10초')),
                    ],
                    selected: {_period},
                    onSelectionChanged: _locked
                        ? null
                        : (value) => setState(() => _period = value.single),
                  ),
                  FilledButton(
                    onPressed: _locked ? null : _start,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(96, 56),
                    ),
                    child: const Text('시작'),
                  ),
                  OutlinedButton(
                    onPressed: _running ? () => setState(_stop) : null,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(96, 56),
                    ),
                    child: const Text('정지'),
                  ),
                  Text(_running ? '측정 중' : '정지 상태'),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                '프레임 $_frames장 · 마지막 $size · 왕복 $roundTrip · 주기 $_period초',
                style: const TextStyle(fontSize: 18),
              ),
              const SizedBox(height: 8),
              Text('마지막 오류: ${_lastError ?? '없음'}'),
              const SizedBox(height: 16),
              AspectRatio(
                aspectRatio: 16 / 9,
                child: ColoredBox(
                  color: VgColors.surfaceStrong,
                  child: _image == null
                      ? const Center(child: Text('받은 이미지가 없습니다.'))
                      : RawImage(image: _image, fit: BoxFit.contain),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Future<Uint8List> _fetchImage(HttpClient client, Uri uri, String ticket) async {
  try {
    final request = await client.getUrl(uri);
    request.followRedirects = false;
    if (ticket.isNotEmpty) {
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $ticket');
    }
    final response = await request.close();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _ProbeFailure('HTTP ${response.statusCode} 응답');
    }
    return await readCctvResponseImage(client, response);
  } finally {
    // 첫 파트 반환 시 구독 취소에 더해 소켓도 즉시 닫는다. 다음 프레임을 기다리지 않는다.
    client.close(force: true);
  }
}

/// 측정 화면의 기존 검증 진입점은 유지하고 동일한 공용 파서를 호출한다.
@visibleForTesting
Future<Uint8List> readCctvProbeImage(
  Stream<List<int>> response,
  ContentType? contentType,
) => readCctvImage(response, contentType);

class _ProbeFailure implements Exception {
  const _ProbeFailure(this.message);
  final String message;

  @override
  String toString() => message;
}

String _safeError(Object error) {
  if (error is _ProbeFailure) return error.message;
  if (error is CctvImageFailure) return error.message;
  if (error is TimeoutException) return '요청 시간이 15초를 초과했습니다.';
  if (error is SocketException) return '서버에 연결할 수 없습니다.';
  if (error is HandshakeException) return '보안 연결을 설정할 수 없습니다.';
  if (error is HttpException) return '응답 수신이 중단됐습니다.';
  if (error is FormatException) return '응답 형식이 올바르지 않습니다.';
  return '이미지를 가져오거나 해석하지 못했습니다.';
}
