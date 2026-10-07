import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/cctv/cctv_screen.dart';
import 'package:vitalguard_field/vg_theme.dart';

const _unreachable = '현장 장비에 연결되지 않습니다 (Wi-Fi·장비 전원 확인)';
const _missingRoute = '서버에 CCTV 경로가 없습니다. 관리자에게 서버 배포 확인을 요청해 주세요';

void main() {
  for (final entry in {
    401: '이 현장 CCTV 를 볼 권한이 없습니다',
    403: '이 현장 CCTV 를 볼 권한이 없습니다',
    404: _missingRoute,
    429: '요청이 많습니다. 잠시 후 다시 시도합니다',
    503: '서버에 CCTV 설정이 없습니다',
  }.entries) {
    testWidgets('티켓 ${entry.key}의 원인 문구를 표시하고 재시도한다', (tester) async {
      final fixture = _Fixture();
      fixture.gateway.issue = (_) async => throw ApiFailure(
        'synthetic-private-response',
        status: entry.key,
        action: 'none',
      );
      await fixture.mount(tester);
      expect(find.text(entry.value), findsOneWidget);
      expect(find.textContaining('synthetic-private-response'), findsNothing);
      expect(fixture.clients, isEmpty);
      await tester.pump(const Duration(seconds: 10));
      expect(fixture.gateway.calls, 2);
      await fixture.dispose(tester);
    });
  }

  for (final entry in <String, String>{
    '{"ok":false,"error":"unknown camera"}': '등록되지 않은 카메라입니다',
    '<!DOCTYPE html><html><body>404: This page could not be found.</body></html>':
        _missingRoute,
    '': _missingRoute,
    '{"ok":false,"error":"unknown camera"': _missingRoute,
    '{"ok":false,"error":"not found"}': _missingRoute,
    '{"error":"unknown camera"}': _missingRoute,
    '{"ok":true,"error":"unknown camera"}': _missingRoute,
    '{"ok":"false","error":"unknown camera"}': _missingRoute,
  }.entries) {
    testWidgets('티켓 404 본문 ${entry.key}로 카메라 미등록과 서버 경로 부재를 구분한다', (
      tester,
    ) async {
      final fixture = _Fixture();
      final client = _Client();
      final response = _Response(
        404,
        entry.key.startsWith('<') ? ContentType.html : ContentType.json,
      );
      client.request.reply.complete(response);
      response.body.add(utf8.encode(entry.key));
      unawaited(response.body.close());
      final live = LiveGateway(client: client);
      addTearDown(() => client.close(force: true));
      fixture.gateway.issue = (_) => live.cctvTicket('access', cctvCameraId);

      await fixture.mount(tester);
      await tester.pump();
      expect(client.uri?.path, '/api/app/admin/cctv-ticket');
      expect(find.text(entry.value), findsOneWidget);
      expect(
        find.text(
          entry.value == _missingRoute ? '등록되지 않은 카메라입니다' : _missingRoute,
        ),
        findsNothing,
      );
      expect(fixture.clients, isEmpty);
      expect(tester.takeException(), isNull);
      await fixture.dispose(tester);
    });
  }

  testWidgets('gateApi가 빈 값이면 게이트를 열지 않고 설정 부재를 알린다', (tester) async {
    final fixture = _Fixture();
    fixture.gateway.gate = '  ';
    await fixture.mount(tester);
    expect(find.text('현장 CCTV 주소가 설정되지 않았습니다'), findsOneWidget);
    expect(fixture.clients, isEmpty);
    await fixture.dispose(tester);
  });

  testWidgets('서버가 오프라인이어도 V-03을 표시하고 크래시하지 않는다', (tester) async {
    final fixture = _Fixture();
    final live = LiveGateway(
      transport: (_, _, _, _) async =>
          throw const SocketException('synthetic-private-response'),
    );
    fixture.gateway.issue = (_) => live.cctvTicket('access', cctvCameraId);
    await fixture.mount(tester);
    expect(find.text(_unreachable), findsOneWidget);
    expect(tester.takeException(), isNull);
    expect(fixture.clients, isEmpty);
    await fixture.dispose(tester);
    live.client.close(force: true);
  });

  testWidgets('게이트 연결 실패를 알리고 10·20·40·60초로 재시도한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    for (final delay in [10, 20, 40, 60, 60]) {
      final calls = fixture.gateway.calls;
      fixture.clients.last.request.reply.completeError(
        const SocketException('synthetic-private-response'),
      );
      await tester.pump();
      await tester.pump();
      expect(find.text(_unreachable), findsOneWidget);
      expect(find.textContaining('재시도 간격 $delay초'), findsOneWidget);
      await tester.pump(Duration(seconds: delay - 1));
      expect(fixture.gateway.calls, calls);
      await tester.pump(const Duration(seconds: 1));
      expect(fixture.gateway.calls, calls + 1);
    }
    await fixture.frame(tester);
    expect(find.byKey(const Key('cctv-error')), findsNothing);
    final calls = fixture.gateway.calls;
    await tester.pump(const Duration(seconds: 5));
    expect(fixture.gateway.calls, calls + 1);
    await fixture.dispose(tester);
  });

  testWidgets('응답 없는 게이트는 15초 뒤 연결 실패로 바뀌고 소켓을 닫는다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    await tester.pump(const Duration(seconds: 14));
    expect(fixture.gateway.calls, 1);
    expect(fixture.clients.single.forceClosed, isFalse);
    await tester.pump(const Duration(seconds: 1));
    expect(find.text(_unreachable), findsOneWidget);
    expect(fixture.clients.single.forceClosed, isTrue);
    await tester.pump(const Duration(seconds: 10));
    expect(fixture.gateway.calls, 2);
    await fixture.dispose(tester);
  });

  for (final entry in {
    'disabled': '현장에서 카메라를 꺼 두었습니다',
    'too many viewers': '동시 접속이 많습니다',
  }.entries) {
    testWidgets('게이트 503 ${entry.key}의 원인을 구분한다', (tester) async {
      final fixture = _Fixture();
      await fixture.mount(tester);
      final response = _Response(503, ContentType.json);
      fixture.clients.single.request.reply.complete(response);
      response.body.add(utf8.encode(jsonEncode({'error': entry.key})));
      unawaited(response.body.close());
      await tester.pump();
      await tester.pump();
      expect(find.text(entry.value), findsOneWidget);
      expect(fixture.clients.single.forceClosed, isTrue);
      await fixture.dispose(tester);
    });
  }

  testWidgets('새 티켓 Bearer로 첫 파트만 받고 EOF 전에 연결을 끊는다', (tester) async {
    final fixture = _Fixture();
    fixture.gateway.gate = 'https://camera.invalid:8443/base/';
    await fixture.mount(tester);
    expect(find.text('CCTV · CAM-03'), findsOneWidget);
    expect(find.textContaining('5초 간격'), findsOneWidget);
    for (var cycle = 1; cycle <= 2; cycle++) {
      expect(fixture.gateway.calls, cycle);
      expect(fixture.gateway.cameraIds.last, cctvCameraId);
      final client = fixture.clients.last;
      expect(
        client.uri.toString(),
        'https://camera.invalid:8443/base/cctv/stream3',
      );
      expect(client.request.followRedirects, isFalse);
      expect(
        client.request.headers.values[HttpHeaders.authorizationHeader],
        'Bearer synthetic-$cycle',
      );
      expect(client.request.headers.values.length, 1);
      await fixture.frame(tester);
      expect(client.forceClosed, isTrue);
      expect(client.response!.cancelled, isTrue);
      expect(find.byType(RawImage), findsOneWidget);
      if (cycle == 1) await tester.pump(const Duration(seconds: 5));
    }
    await fixture.dispose(tester);
  });

  for (final period in [3, 5, 10]) {
    testWidgets('$period초 주기에서 정확히 3배를 넘을 때 가리고 새 프레임으로 복구한다', (tester) async {
      final fixture = _Fixture();
      await fixture.mount(tester);
      await tester.tap(find.text('$period초'));
      await tester.pump();
      await fixture.frame(tester);
      final received = fixture.now;
      final held = Completer<CctvTicket>();
      fixture.gateway.issue = (_) => held.future;
      await fixture.advance(tester, Duration(seconds: period * 3));
      expect(fixture.gateway.calls, 2);
      expect(find.byKey(const Key('cctv-stale')), findsNothing);
      expect(
        tester.widget<ImageFiltered>(find.byType(ImageFiltered)).enabled,
        isFalse,
      );
      await fixture.advance(tester, const Duration(seconds: 1));
      expect(find.text('갱신 멈춤 · ${period * 3 + 1}초 전 영상'), findsOneWidget);
      expect(
        tester.widget<ImageFiltered>(find.byType(ImageFiltered)).enabled,
        isTrue,
      );
      expect(find.textContaining('$period초 간격'), findsOneWidget);
      expect(fixture.now.isAfter(received), isTrue);
      held.complete(fixture.gateway.ticket(2));
      await tester.pump();
      await fixture.frame(tester);
      expect(find.byKey(const Key('cctv-stale')), findsNothing);
      expect(find.textContaining('0초 전 · $period초 간격'), findsOneWidget);
      await fixture.dispose(tester);
    });
  }

  testWidgets('진행 중 간격 변경·탭 이탈·복귀에도 티켓 요청을 겹치지 않는다', (tester) async {
    final fixture = _Fixture();
    final held = Completer<CctvTicket>();
    fixture.gateway.issue = (_) => held.future;
    await fixture.mount(tester);
    await tester.tap(find.text('3초'));
    await tester.pump(const Duration(seconds: 20));
    expect(fixture.gateway.calls, 1);
    await fixture.pumpScreen(tester, active: false);
    await tester.pump(const Duration(seconds: 20));
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, 1);
    fixture.gateway.issue = null;
    held.complete(fixture.gateway.ticket(1));
    await tester.pump();
    expect(fixture.gateway.calls, 2);
    expect(fixture.clients.length, 1);
    expect(
      fixture.clients.single.request.headers.values[HttpHeaders
          .authorizationHeader],
      'Bearer synthetic-2',
    );
    await fixture.dispose(tester);
  });

  testWidgets('비활성 탭은 요청하지 않고 나가면 게이트를 닫고 복귀 때 재개한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester, active: false);
    await tester.pump(const Duration(seconds: 30));
    expect(fixture.gateway.calls, 0);
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, 1);
    await fixture.pumpScreen(tester, active: false);
    expect(fixture.clients.single.forceClosed, isTrue);
    await tester.pump(const Duration(seconds: 30));
    expect(fixture.gateway.calls, 1);
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, 2);
    await fixture.dispose(tester);
  });

  testWidgets('모든 백그라운드 상태에서 멈추고 resumed에서 새 티켓으로 재개한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    var calls = 1;
    for (final state in [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
      AppLifecycleState.detached,
    ]) {
      tester.binding.handleAppLifecycleStateChanged(state);
      await tester.pump();
      expect(fixture.clients.last.forceClosed, isTrue);
      await tester.pump(const Duration(seconds: 30));
      expect(fixture.gateway.calls, calls);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(fixture.gateway.calls, ++calls);
    }
    await fixture.dispose(tester);
  });

  testWidgets('잘못된 영상이 와도 원본 예외를 표시하지 않고 재시도한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    final response = _Response(200, ContentType.json);
    fixture.clients.single.request.reply.complete(response);
    response.body.add(utf8.encode('{"ticket":"synthetic-private-response"}'));
    await tester.pump();
    await tester.pump();
    expect(find.text('현장 영상 응답을 읽을 수 없습니다. 다시 시도합니다'), findsOneWidget);
    expect(find.textContaining('synthetic-private-response'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(seconds: 10));
    expect(fixture.gateway.calls, 2);
    await fixture.dispose(tester);
  });
}

class _Gateway extends MockGateway {
  int calls = 0;
  String gate = 'https://camera.invalid:8443';
  final cameraIds = <String>[];
  Future<CctvTicket> Function(int)? issue;

  CctvTicket ticket(int call) => CctvTicket({
    'ok': true,
    'ticket': 'synthetic-$call',
    'expiresAt': DateTime(2099).millisecondsSinceEpoch,
    'ttlSec': 60,
    'gateApi': gate,
  });

  @override
  Future<CctvTicket> cctvTicket(String accessToken, String cameraId) {
    cameraIds.add(cameraId);
    final call = ++calls;
    return issue?.call(call) ?? Future.value(ticket(call));
  }
}

class _Fixture {
  final gateway = _Gateway();
  final clients = <_Client>[];
  late final controller = FieldCoordinator(
    gateway,
    MemoryStore(),
    MockSpeechInput(),
  );
  DateTime now = DateTime(2026, 9, 13, 14, 32, 5);
  Uint8List? png;

  Future<void> mount(WidgetTester tester, {bool active = true}) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1000, 900);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await controller.signIn('demo', 'mock');
    await pumpScreen(tester, active: active);
  }

  Future<void> pumpScreen(WidgetTester tester, {bool active = true}) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        home: Scaffold(
          body: CctvScreen(
            controller: controller,
            active: active,
            now: () => now,
            clientFactory: () {
              final client = _Client();
              clients.add(client);
              return client;
            },
          ),
        ),
      ),
    );
    await tester.pump();
  }

  Future<void> advance(WidgetTester tester, Duration duration) async {
    now = now.add(duration);
    await tester.pump(duration);
  }

  Future<void> frame(WidgetTester tester) async {
    png ??= await tester.runAsync(() async {
      final recorder = ui.PictureRecorder();
      Canvas(recorder).drawColor(const Color(0xFF50647A), BlendMode.src);
      final picture = recorder.endRecording();
      final image = await picture.toImage(4, 4);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      picture.dispose();
      return data!.buffer.asUint8List();
    });
    final client = clients.last;
    final response = _Response(
      200,
      ContentType.parse('multipart/x-mixed-replace; boundary=frame'),
    );
    client.response = response;
    response.beforeCancel = () => expect(client.forceClosed, isTrue);
    client.request.reply.complete(response);
    // EOF도 다음 프레임도 보내지 않는다. 첫 파트의 길이만으로 종료해야 한다.
    response.body.add([
      ...latin1.encode(
        '--frame\r\nContent-Type: image/png\r\nContent-Length: ${png!.length}\r\n\r\n',
      ),
      ...png!,
    ]);
    await tester.pump();
    for (var attempt = 0; attempt < 25; attempt++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      await tester.pump();
      if (find.textContaining(' 기준 · 0초 전 ·').evaluate().isNotEmpty &&
          find.byKey(const Key('cctv-error')).evaluate().isEmpty &&
          response.cancelled) {
        break;
      }
    }
    expect(response.cancelled, isTrue);
    expect(find.byType(RawImage), findsOneWidget);
    expect(find.byKey(const Key('cctv-error')), findsNothing);
  }

  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    controller.dispose();
  }
}

class _Client implements HttpClient {
  final request = _Request();
  _Response? response;
  Uri? uri;
  bool forceClosed = false;

  @override
  set connectionTimeout(Duration? value) {}
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) => getUrl(url);
  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    uri = url;
    return request;
  }

  @override
  void close({bool force = false}) {
    forceClosed = forceClosed || force;
    if (!request.reply.isCompleted) {
      request.reply.completeError(const HttpException('closed'));
    }
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Headers implements HttpHeaders {
  _Headers([this.contentType]);
  final values = <String, Object>{};
  @override
  ContentType? contentType;
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) =>
      values[name] = value;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Request implements HttpClientRequest {
  final reply = Completer<HttpClientResponse>();
  @override
  final _Headers headers = _Headers();
  @override
  bool followRedirects = true;
  @override
  void write(Object? object) {}
  @override
  Future<HttpClientResponse> close() => reply.future;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Response extends Stream<List<int>> implements HttpClientResponse {
  _Response(this.statusCode, ContentType type) : headers = _Headers(type) {
    body = StreamController<List<int>>(
      onCancel: () {
        beforeCancel?.call();
        cancelled = true;
      },
    );
  }
  late final StreamController<List<int>> body;
  VoidCallback? beforeCancel;
  bool cancelled = false;
  @override
  final int statusCode;
  @override
  final _Headers headers;
  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => body.stream.listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
