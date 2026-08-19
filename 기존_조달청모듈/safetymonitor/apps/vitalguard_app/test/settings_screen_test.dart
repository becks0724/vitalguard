// 설정 화면 가드 — 전송 항목을 홈에서 뺀 대가로 잃으면 안 되는 것들을 고정한다
//
// ★ 이 변경의 위험은 "안 보이는 것"이 아니라 **거짓으로 안심시키는 것**이다.
//   전송 큐는 밀리면 알아야 하는 값인데 설정 안으로 들어가면 ① 홈에서 신호가 사라지고
//   ② 설정을 열어둔 채 밀려도 열 때의 `비어 있음` 이 그대로 남는다.
//   둘 다 이 레포가 반복해서 당한 false-OK 형태라 가드로 못 박는다.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/main.dart';
import 'package:vitalguard_app/settings_screen.dart';
import 'package:vitalguard_app/theme.dart';

const _bridge = MethodChannel('vitalguard/bridge');
const _stream = EventChannel('vitalguard/stream');

/// 네이티브를 막고 홈을 띄운다. `sink` 로 나중에 파이프라인 이벤트를 밀어 넣을 수 있다.
MockStreamHandlerEventSink? _sink;

void _mockBridge({required int pending, int? totalPersisted = 251862}) {
  final m = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  m.setMockMethodCallHandler(_bridge, (call) async {
    if (call.method == 'status') {
      return <String, dynamic>{
        'loggedIn': true,
        'name': '장우진',
        'workerId': 'EMP-6861',
        'pending': pending,
        'baseURL': 'https://example.invalid',
      };
    }
    if (call.method == 'ownVitals') {
      return <String, dynamic>{
        'ok': true,
        'applicable': true,
        'stress': {'calibrating': false, 'index': 41},
        'totalPersisted': ?totalPersisted,
      };
    }
    return null;
  });
  m.setMockStreamHandler(
    _stream,
    // ★ 블록 본문이어야 한다 — `=> _sink = sink` 는 sink 를 반환값으로 돌려주고
    //   그 값이 채널 응답으로 인코딩되며 스트림 활성화가 통째로 실패한다.
    MockStreamHandler.inline(onListen: (args, sink) {
      _sink = sink;
    }),
  );
}

/// 플랫폼 채널 이벤트는 비동기로 배달된다 — pump 한 번으로는 아직 안 와 있다.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

Future<void> _pumpHome(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1170, 2600);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: vgLightTheme(), home: const HomeScreen()));
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 80));
  }
}

void main() {
  setUp(() => _sink = null);

  testWidgets('홈에는 전송 항목이 남지 않는다', (tester) async {
    _mockBridge(pending: 0);
    await _pumpHome(tester);

    expect(find.text('전송'), findsNothing);
    expect(find.text('전송 큐 비어 있음'), findsNothing);
    expect(find.textContaining('누적'), findsNothing);
    expect(find.textContaining('업로드 파이프라인'), findsNothing);
    // 생체 쪽은 그대로 남아 있어야 한다 — 같이 쓸려 나가면 홈이 빈다.
    expect(find.text('주요 생체'), findsOneWidget);
    // 2026-08-19 에 세 박스를 하나로 합치며 `활동` 섹션 제목이 사라졌다 — 제목 대신
    // 그 안의 칸으로 앵커를 옮긴다(앵커가 없으면 홈이 비어도 이 가드가 통과한다).
    expect(find.text('걸음'), findsOneWidget);
  });

  testWidgets('톱니를 누르면 세 항목이 설정에 그대로 있다', (tester) async {
    _mockBridge(pending: 0);
    await _pumpHome(tester);

    await tester.tap(find.byTooltip('설정'));
    await tester.pumpAndSettle();

    expect(find.byType(SettingsScreen), findsOneWidget);
    expect(find.text('전송 큐 비어 있음'), findsOneWidget);
    expect(find.text('누적 251,862건'), findsOneWidget);
    expect(find.text('장우진 (EMP-6861)'), findsOneWidget);
  });

  testWidgets('★ 설정을 열어둔 채 큐가 밀리면 문구가 따라간다', (tester) async {
    _mockBridge(pending: 0);
    await _pumpHome(tester);
    await tester.tap(find.byTooltip('설정'));
    await tester.pumpAndSettle();
    expect(find.text('전송 큐 비어 있음'), findsOneWidget);

    // 열 때의 스냅숏만 그리면 여기서부터 화면이 거짓말을 한다.
    _sink!.success(<String, dynamic>{'type': 'pipeline', 'pending': 41});
    await _settle(tester);

    expect(find.text('전송 대기 41건'), findsOneWidget);
    expect(find.text('전송 큐 비어 있음'), findsNothing);
  });

  testWidgets('★ 큐가 밀리면 홈 톱니에 표식이 붙는다 — 평시엔 없다', (tester) async {
    _mockBridge(pending: 0);
    await _pumpHome(tester);
    expect(find.byType(Badge), findsNothing,
        reason: '평시에 표식이 붙으면 진짜 적체와 구별되지 않는다');

    _sink!.success(<String, dynamic>{'type': 'pipeline', 'pending': 41});
    await _settle(tester);
    expect(find.byType(Badge), findsOneWidget,
        reason: '전송 상태를 설정으로 옮기면서 "밀리고 있다" 는 신호까지 숨기면 안 된다');
  });

  testWidgets('누적 조회 실패는 값을 지어내지 않고 줄을 생략한다', (tester) async {
    _mockBridge(pending: 0, totalPersisted: null);
    await _pumpHome(tester);
    await tester.tap(find.byTooltip('설정'));
    await tester.pumpAndSettle();

    expect(find.textContaining('누적'), findsNothing);
    // 나머지 줄은 그대로 — 하나가 없다고 화면이 비지 않는다.
    expect(find.text('전송 큐 비어 있음'), findsOneWidget);
    expect(find.text('장우진 (EMP-6861)'), findsOneWidget);
  });
}
