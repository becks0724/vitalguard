import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../data/cctv_image_reader.dart';
import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';

const cctvCameraId = 'CAM-03';
const _requestTimeout = Duration(seconds: 15);
const _unreachable = '현장 장비에 연결되지 않습니다 (Wi-Fi·장비 전원 확인)';

class CctvScreen extends StatefulWidget {
  const CctvScreen({
    super.key,
    required this.controller,
    this.active = true,
    this.clientFactory,
    this.now,
  });

  final FieldController controller;
  // IndexedStack은 보이지 않는 탭도 살려 두므로 현장 탭 선택 여부를 받는다.
  final bool active;
  final HttpClient Function()? clientFactory;
  final DateTime Function()? now;

  @override
  State<CctvScreen> createState() => _CctvScreenState();
}

class _CctvScreenState extends State<CctvScreen> with WidgetsBindingObserver {
  Timer? _pollTimer;
  Timer? _ageTimer;
  HttpClient? _activeClient;
  ui.Image? _image;
  DateTime? _receivedAt;
  String? _error;
  int _period = 5;
  int _failures = 0;
  int _generation = 0;
  bool _foreground = true;
  bool _running = false;
  bool _polling = false;

  DateTime _now() => widget.now?.call() ?? DateTime.now();
  int get _delaySeconds => math.min(60, _period * (1 << _failures));
  bool _current(int generation) =>
      mounted && _running && generation == _generation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    _syncPolling();
  }

  @override
  void didUpdateWidget(CctvScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      _stop();
      _image?.dispose();
      _image = null;
      _receivedAt = null;
      _error = null;
      _failures = 0;
    }
    _syncPolling();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _syncPolling();
    if (mounted) setState(() {});
  }

  void _syncPolling() {
    final shouldRun = widget.active && _foreground;
    if (shouldRun == _running) return;
    if (!shouldRun) {
      _stop();
      return;
    }
    _running = true;
    _ageTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
    unawaited(_poll());
  }

  void _stop() {
    _running = false;
    _generation++;
    _pollTimer?.cancel();
    _pollTimer = null;
    _ageTimer?.cancel();
    _ageTimer = null;
    _activeClient?.close(force: true);
    // 발급 중이던 앱 요청은 공유 인증 요청이다. 완료까지 잠금을 유지하고
    // 결과를 버려, 복귀 시 새 요청과 겹치거나 숨은 탭에서 게이트를 열지 않는다.
  }

  void _schedule() {
    _pollTimer?.cancel();
    if (!_running) return;
    _pollTimer = Timer(Duration(seconds: _delaySeconds), () {
      unawaited(_poll());
    });
  }

  Future<void> _poll() async {
    if (!_running || _polling) return;
    _polling = true;
    final generation = _generation;
    HttpClient? client;
    try {
      // 티켓은 1회용이다. 성공/실패/복귀와 무관하게 매 주기 새로 발급한다.
      final CctvTicket ticket;
      try {
        ticket = await widget.controller.cctvTicket(cctvCameraId);
      } on ApiFailure catch (error) {
        throw _CctvFailure(_ticketError(error));
      } catch (_) {
        throw const _CctvFailure('CCTV 이용 정보를 받을 수 없습니다. 다시 시도합니다');
      }
      if (!_current(generation)) return;
      final gate = ticket.gateApi.trim();
      if (gate.isEmpty) {
        throw const _CctvFailure('현장 CCTV 주소가 설정되지 않았습니다');
      }
      final uri = Uri.tryParse(gate);
      if (uri == null ||
          !const ['http', 'https'].contains(uri.scheme) ||
          uri.host.isEmpty ||
          uri.userInfo.isNotEmpty ||
          uri.hasQuery ||
          uri.hasFragment) {
        throw const _CctvFailure('현장 CCTV 주소 형식이 올바르지 않습니다');
      }
      if (ticket.expiresAt <= _now().millisecondsSinceEpoch) {
        throw const _CctvFailure('CCTV 이용 시간이 만료되었습니다. 다시 시도합니다');
      }
      final streamUri = uri.replace(
        path: '${uri.path.replaceFirst(RegExp(r'/+$'), '')}/cctv/stream3',
      );
      client = (widget.clientFactory ?? HttpClient.new)()
        ..connectionTimeout = _requestTimeout;
      _activeClient = client;
      final bytes = await _fetchImage(
        client,
        streamUri,
        ticket.ticket,
      ).timeout(_requestTimeout);
      if (!_current(generation)) return;
      final receivedAt = _now();
      final codec = await ui.instantiateImageCodec(bytes);
      final ui.FrameInfo frame;
      try {
        frame = await codec.getNextFrame();
      } finally {
        codec.dispose();
      }
      if (!_current(generation)) {
        frame.image.dispose();
        return;
      }
      final previous = _image;
      setState(() {
        _image = frame.image;
        _receivedAt = receivedAt;
        _error = null;
        _failures = 0;
      });
      previous?.dispose();
    } catch (error) {
      if (_current(generation)) {
        setState(() {
          _error = _safeError(error);
          _failures = math.min(_failures + 1, 6);
        });
      }
    } finally {
      client?.close(force: true);
      if (identical(_activeClient, client)) _activeClient = null;
      _polling = false;
      if (mounted && _running) {
        if (generation != _generation) {
          // 복귀가 앞선 요청 완료보다 빨랐으면 완료 직후 새 티켓으로 재개한다.
          unawaited(_poll());
        } else {
          _schedule();
        }
      }
    }
  }

  void _setPeriod(int period) {
    setState(() => _period = period);
    if (!_polling) _schedule();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stop();
    _image?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final received = _receivedAt;
    final age = received == null ? Duration.zero : _now().difference(received);
    final seconds = math.max(0, age.inSeconds);
    final stale = received != null && age > Duration(seconds: _period * 3);
    final local = received?.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    final time = local == null
        ? '—'
        : '${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Material(
          color: VgColors.canvas.withValues(alpha: vgCardSurfaceAlpha),
          borderRadius: BorderRadius.circular(vgRadiusCard),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'CCTV · $cctvCameraId',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                const Text('스냅샷 · 기준 시각은 앱 수신 시각입니다'),
                const SizedBox(height: 24),
                Wrap(
                  spacing: vgGapTap,
                  runSpacing: vgGapTap,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const Text('갱신 간격'),
                    SegmentedButton<int>(
                      style: SegmentedButton.styleFrom(
                        minimumSize: const Size(64, vgTapMin),
                      ),
                      segments: const [
                        ButtonSegment(value: 3, label: Text('3초')),
                        ButtonSegment(value: 5, label: Text('5초')),
                        ButtonSegment(value: 10, label: Text('10초')),
                      ],
                      selected: {_period},
                      onSelectionChanged: (value) => _setPeriod(value.single),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(
                  '$time 기준 · ${received == null ? '수신 전' : '$seconds초 전'} · $_period초 간격',
                  key: const Key('cctv-timestamp'),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Semantics(
                    liveRegion: true,
                    child: Text(_error!, key: const Key('cctv-error')),
                  ),
                  const SizedBox(height: 8),
                  Text('재시도 간격 $_delaySeconds초 · 연결되면 $_period초 간격으로 돌아갑니다'),
                ],
                const SizedBox(height: 16),
                AspectRatio(
                  aspectRatio: 16 / 9,
                  child: ClipRect(
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        ColoredBox(
                          color: VgColors.surfaceStrong,
                          child: _image == null
                              ? Center(
                                  child: Text(
                                    _error != null
                                        ? '받은 영상이 없습니다'
                                        : '첫 영상을 불러오는 중입니다',
                                  ),
                                )
                              : ImageFiltered(
                                  enabled: stale,
                                  imageFilter: ui.ImageFilter.blur(
                                    sigmaX: 8,
                                    sigmaY: 8,
                                  ),
                                  child: Opacity(
                                    opacity: stale ? 0.45 : 1,
                                    child: RawImage(
                                      image: _image,
                                      fit: BoxFit.contain,
                                    ),
                                  ),
                                ),
                        ),
                        if (stale)
                          Center(
                            child: Container(
                              key: const Key('cctv-stale'),
                              margin: const EdgeInsets.all(16),
                              padding: const EdgeInsets.all(16),
                              color: VgColors.warnTint,
                              child: Text(
                                '갱신 멈춤 · $seconds초 전 영상',
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  color: VgColors.ink,
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

Future<Uint8List> _fetchImage(HttpClient client, Uri uri, String ticket) async {
  final request = await client.getUrl(uri);
  request.followRedirects = false;
  request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $ticket');
  final response = await request.close();
  if (response.statusCode == 503) {
    // 503 본문은 작은 오류 객체만 읽는다. 원본 문구는 화면/로그에 보내지 않는다.
    final bytes = BytesBuilder();
    await for (final chunk in response) {
      if (bytes.length + chunk.length > 4096) break;
      bytes.add(chunk);
    }
    var reason = utf8.decode(bytes.takeBytes(), allowMalformed: true).trim();
    try {
      final body = jsonDecode(reason);
      if (body is Map && body['error'] is String) {
        reason = body['error'] as String;
      }
    } catch (_) {}
    if (reason == 'disabled') {
      throw const _CctvFailure('현장에서 카메라를 꺼 두었습니다');
    }
    if (reason == 'too many viewers') {
      throw const _CctvFailure('동시 접속이 많습니다');
    }
    throw const _CctvFailure(_unreachable);
  }
  if (response.statusCode != 200) {
    throw _CctvFailure(switch (response.statusCode) {
      401 || 403 => '현장 장비의 영상 접근이 거부되었습니다. 다시 시도합니다',
      404 => '현장 장비에서 CCTV 영상을 찾을 수 없습니다',
      429 => '요청이 많습니다. 잠시 후 다시 시도합니다',
      _ => _unreachable,
    });
  }
  return readCctvResponseImage(client, response);
}

String _ticketError(ApiFailure error) => switch (error.status) {
  401 || 403 => '이 현장 CCTV 를 볼 권한이 없습니다',
  404 =>
    error.code == 'unknown camera'
        ? '등록되지 않은 카메라입니다'
        : '서버에 CCTV 경로가 없습니다. 관리자에게 서버 배포 확인을 요청해 주세요',
  429 => '요청이 많습니다. 잠시 후 다시 시도합니다',
  503 => '서버에 CCTV 설정이 없습니다',
  null => _unreachable,
  _ => 'CCTV 이용 정보를 받을 수 없습니다. 다시 시도합니다',
};

class _CctvFailure implements Exception {
  const _CctvFailure(this.message);
  final String message;

  @override
  String toString() => message;
}

String _safeError(Object error) {
  if (error is _CctvFailure) return error.message;
  if (error is SocketException ||
      error is TimeoutException ||
      error is HttpException ||
      error is HandshakeException) {
    return _unreachable;
  }
  return '현장 영상 응답을 읽을 수 없습니다. 다시 시도합니다';
}
