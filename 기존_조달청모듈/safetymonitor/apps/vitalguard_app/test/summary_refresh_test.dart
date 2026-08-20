// 요약 화면 갱신 경로 가드 — 스트림이 죽어도 화면이 얼지 않는다
//
// ★ 2026-08-20 실측, 하루에 두 번. 워치는 보내고 서버는 12건/분 받는데 **폰 화면만 얼었다**
//   (09:44 = 7분 41초 전 · 11:42 = 19분 5초 전). 숫자가 정확히 맞았다 —
//   워치 전송 카운터 − 폰 배치 번호 = 얼어 있던 시간 ÷ 5초.
//   원인 = `EventChannel` 구독에 `onError`·`onDone` 이 없어 한 번 끊기면 영영 안 붙었다.
//   네이티브는 계속 수집·업로드하므로 **서버에서는 아무 이상이 안 보인다** — 조용한 결함이다.
//
// 그래서 셋을 고정한다.
//   ① 스트림이 한 건도 안 와도 3초 폴링이 화면을 채운다(정확성은 폴링이 맡는다)
//   ② 당겨서 새로고침이 있다(사람이 확인할 수단)
//   ③ 폴링이 죽은 값을 지어내지 않는다 — 네이티브가 값을 안 주면 화면도 비어 있다
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/main.dart';
import 'package:vitalguard_app/theme.dart';

const _bridge = MethodChannel('vitalguard/bridge');
const _stream = EventChannel('vitalguard/stream');

/// 스트림은 **한 건도 안 보낸다** — 죽은 스트림을 흉내 낸다.
void _mockDeadStream({Map<String, dynamic>? snapshot}) {
  final m = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  m.setMockMethodCallHandler(_bridge, (call) async {
    switch (call.method) {
      case 'status':
        return <String, dynamic>{
          'loggedIn': true,
          'name': '장우진',
          'workerId': 'EMP-6861',
          'pending': 0,
          'baseURL': 'https://example.invalid',
        };
      case 'vitalsSnapshot':
        return snapshot;
      case 'ownVitals':
        return <String, dynamic>{'ok': true, 'applicable': true};
      default:
        return null;
    }
  });
  m.setMockStreamHandler(_stream, MockStreamHandler.inline(onListen: (args, sink) {}));
}

Future<void> _pumpHome(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1170, 2600);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: vgLightTheme(), home: const HomeScreen()));
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 80));
  }
}

void main() {
  tearDown(() {
    final m = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    m.setMockMethodCallHandler(_bridge, null);
    m.setMockStreamHandler(_stream, null);
  });

  testWidgets('★ 스트림이 한 건도 안 와도 폴링이 심박을 채운다', (tester) async {
    _mockDeadStream(snapshot: <String, dynamic>{
      'type': 'hr',
      'seq': 1046,
      'channel': 'sendMessage',
      'bpm': 83.0,
      'measuredAtMs': DateTime.now().millisecondsSinceEpoch,
    });
    await _pumpHome(tester);
    // 스트림 이벤트 0건인데도 값이 보인다 — 종전 코드였다면 `--` 로 남았다.
    expect(find.text('83'), findsOneWidget);
  });

  testWidgets('★ 네이티브가 값을 안 주면 지어내지 않는다', (tester) async {
    // 통제군 — 위 테스트가 "폴링이 채운다"를 증명하려면 안 채우는 경우도 확인해야 한다.
    _mockDeadStream(snapshot: <String, dynamic>{'type': 'hr', 'seq': -1, 'channel': 'none'});
    await _pumpHome(tester);
    expect(find.text('83'), findsNothing);
    expect(find.text('--'), findsWidgets);
  });

  testWidgets('★ 당겨서 새로고침이 있다 — 자동 갱신이 멈춰도 사람이 확인할 수단', (tester) async {
    _mockDeadStream(snapshot: <String, dynamic>{'type': 'hr', 'seq': 1, 'channel': 'x'});
    await _pumpHome(tester);
    expect(find.byType(RefreshIndicator), findsOneWidget);
  });

  testWidgets('내용이 짧아도 당길 수 있다', (tester) async {
    // `AlwaysScrollableScrollPhysics` 가 빠지면 화면이 안 넘칠 때 당김이 통째로 죽는다.
    _mockDeadStream(snapshot: <String, dynamic>{'type': 'hr', 'seq': 1, 'channel': 'x'});
    await _pumpHome(tester);
    final list = tester.widget<ListView>(find.byType(ListView).first);
    expect(list.physics, isA<AlwaysScrollableScrollPhysics>());
  });
}
