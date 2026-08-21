// 설정 진단 4항목 가드 — "안 되고 있다" 를 화면이 스스로 말하는지 고정한다
//
// ★ 네 항목 전부 **없어도 화면은 멀쩡해 보인다**. 그래서 넣는 것이고, 그래서 조용히 사라진다.
//   ① 워치 수신 — 2026-08-20 실측: 서버는 12건/분 받는데 홈 화면만 7분 41초 전에 얼어 있었다.
//      사용자는 "워치가 멈춘 건지 화면이 멈춘 건지" 를 가릴 방법이 없었다.
//   ② 위치 — 지하주차장 각인이 `위치 미확보` 로 나온 이유를 사진을 찍어 봐야 알 수 있었다.
//   ③ 사진첩 — 권한 거부는 스낵바로 한 번 스치고 지나가 상태를 다시 볼 자리가 없었다.
//   ④ 버전 — 설치된 것이 최신인지 사람이 확인할 수단이 아예 없었다(devicectl 로만 확인 가능).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/settings_screen.dart';

const _bridge = MethodChannel('vitalguard/bridge');

/// `status` 만 흉내 낸다 — 진단 값은 **EventChannel 이 아니라 이 경로**로 와야 한다.
void _mockStatus(Map<String, dynamic> extra) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_bridge, (call) async {
    if (call.method != 'status') return null;
    return <String, dynamic>{
      'loggedIn': true,
      'name': '장우진',
      'workerId': 'EMP-6861',
      'pending': 0,
      'baseURL': 'https://example.invalid',
      ...extra,
    };
  });
}

Future<void> _pump(WidgetTester tester, Map<String, dynamic> status) async {
  await tester.pumpWidget(MaterialApp(
    home: SettingsScreen(bridge: _bridge, status: status, pending: 0),
  ));
  await tester.pump();
}

void main() {
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_bridge, null);
  });

  testWidgets('★ 워치가 끊기면 끊겼다고 적고 경과를 함께 말한다', (tester) async {
    _mockStatus({});
    await _pump(tester, {'lastVitalAgeSec': 461, 'watchBatteryPct': 85});
    expect(find.textContaining('워치 수신 끊김'), findsOneWidget);
    // 경과 없이 "끊김" 만 적으면 1분과 12시간이 같은 화면이 된다(관제에서 겪은 그 결함).
    expect(find.textContaining('7분 41초 전'), findsWidgets);
    expect(find.textContaining('워치 배터리 85%'), findsOneWidget);
  });

  testWidgets('정상 수신 중에는 수신 중이라고 적는다', (tester) async {
    _mockStatus({});
    await _pump(tester, {'lastVitalAgeSec': 4, 'watchBatteryPct': 85});
    expect(find.textContaining('워치 수신 중'), findsOneWidget);
    expect(find.textContaining('끊김'), findsNothing);
  });

  // 전달 지연(2026-08-21 ⓐ — 봉투 sentAt 을 처음 읽는다 · seam-contracts A-1).
  // 한 테스트에 _pump 를 두 번 부르면 State 가 유지돼 status 가 안 바뀐다 — 케이스당 한 테스트.
  testWidgets('전달 지연 — 정상 값은 소수 1자리 초로 적는다', (tester) async {
    _mockStatus({});
    await _pump(tester, {'lastVitalAgeSec': 4, 'lastBatchLagSec': 1.2});
    expect(find.textContaining('전달 지연 1.2초'), findsOneWidget);
  });

  testWidgets('전달 지연 — 단절 복귀 직후엔 분 단위로 읽히게 적는다', (tester) async {
    _mockStatus({});
    // 08-14 실측 최장 629초 자릿수 — 초로만 적으면 크기가 안 읽힌다.
    await _pump(tester, {'lastVitalAgeSec': 4, 'lastBatchLagSec': 125});
    expect(find.textContaining('전달 지연 2분 5초'), findsOneWidget);
  });

  testWidgets('전달 지연 — 음수(시계 오차)는 0 으로 접는다, 미래 배달로 읽히면 안 된다', (tester) async {
    _mockStatus({});
    await _pump(tester, {'lastVitalAgeSec': 4, 'lastBatchLagSec': -0.4});
    expect(find.textContaining('전달 지연 0.0초'), findsOneWidget);
  });

  testWidgets('전달 지연 — 값이 없으면 줄을 생략한다(구 폰 바이너리 = 0 이 아니라 못 잼)', (tester) async {
    _mockStatus({});
    await _pump(tester, {'lastVitalAgeSec': 4});
    expect(find.textContaining('전달 지연'), findsNothing);
  });

  testWidgets('한 건도 못 받았으면 "없음" 이지 "정상" 이 아니다', (tester) async {
    _mockStatus({});
    await _pump(tester, {});
    expect(find.textContaining('워치 수신 없음'), findsOneWidget);
  });

  testWidgets('★ 권한이 있는데 좌표가 없으면 실내 탓임을 적는다 — 권한 문제로 오독시키지 않는다',
      (tester) async {
    _mockStatus({});
    await _pump(tester, {'locationAuth': '항상 허용'});
    expect(find.textContaining('실내·지하'), findsOneWidget);
  });

  testWidgets('권한이 없으면 권한 탓임을 적는다', (tester) async {
    _mockStatus({});
    await _pump(tester, {'locationAuth': '거부됨'});
    expect(find.textContaining('권한이 없어'), findsOneWidget);
  });

  testWidgets('좌표가 있으면 정확도와 나이를 함께 적는다', (tester) async {
    _mockStatus({});
    await _pump(tester, {
      'locationAuth': '항상 허용',
      'fixLat': 35.161476,
      'fixLon': 126.927731,
      'fixAccM': 32.4,
      'fixAgeSec': 125,
    });
    expect(find.textContaining('35.161476, 126.927731'), findsOneWidget);
    expect(find.textContaining('±32m'), findsOneWidget);
    expect(find.textContaining('2분 5초 전'), findsOneWidget);
  });

  testWidgets('★ 사진첩 권한이 거부면 촬영본이 안 남는다고 적는다', (tester) async {
    _mockStatus({});
    await _pump(tester, {'photoAddAuth': '거부됨'});
    expect(find.textContaining('기기에 안 남습니다'), findsOneWidget);
  });

  testWidgets('앱 버전과 빌드 시각을 적는다', (tester) async {
    _mockStatus({});
    await _pump(tester, {
      'appVersion': '1.0.0',
      'appBuild': '1',
      'builtAtMs': DateTime(2026, 8, 20, 10, 5).millisecondsSinceEpoch,
    });
    // ListView 는 화면 밖 항목을 만들지 않는다 — 맨 아래 줄이라 끝까지 내려야 보인다.
    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pump();
    expect(find.textContaining('버전 1.0.0 (1)'), findsOneWidget);
    expect(find.textContaining('빌드 8/20 10:05'), findsOneWidget);
  });
}
