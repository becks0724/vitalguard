import 'site_status_fixture.dart';

// 2026-09-14 사용자가 제공한 3종 예시. 수치·단위를 환산하지 않는다.
Map<String, dynamic> gasStatusReply() => {
  ...siteStatusReply(),
  'gas': <String, dynamic>{
    'ok': true,
    'level': 'warn',
    'summary': '합성 가스 주의',
    'deviceId': 'synthetic-gas-01',
    'lastSeenAt': '2026-09-14T15:12:44.759Z',
    // 표현 규격은 추정하지 않는다. 화면도 서버 값임을 밝힌다.
    'power': 'on',
    'gases': <Object?>[
      <String, dynamic>{
        'key': 'o2',
        'gas': 'O₂ 산소',
        'loc': '현장 가스 감지기',
        'level': 'normal',
        'value': 20.9,
        'unit': '%',
      },
      <String, dynamic>{
        'key': 'co',
        'gas': 'CO 일산화탄소',
        'loc': '탱크 야드',
        'level': 'warn',
        'value': 151,
        'unit': 'raw',
      },
      <String, dynamic>{
        'key': 'h2s',
        'gas': 'H₂S 황화수소',
        'loc': '현장 가스 감지기',
        'level': 'normal',
        'value': 10,
        'unit': 'raw',
      },
    ],
  },
};
