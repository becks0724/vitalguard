// 계정 전환 가드 — 바꾼 계정에 직전 작업자의 값이 남지 않게 못 박는다
//
// ★ 2026-08-18 발견: 업로드 큐는 계정 교체 시 `purgeQueue` 로 폐기되는데 **표시 스냅숏은
//   그 조건을 공유하지 않아** 직전 작업자의 걸음·이산 건수·마지막 심박이 새 계정의 값으로
//   보였다. 서버 귀속은 정확한데 **화면만 거짓을 말하는** 형태라 DB 로는 안 잡힌다.
//
// 가장 위험한 회귀는 "초기화를 지우는 것"이 아니라 **두 조건이 갈리는 것**이다.
// 조건이 갈리면 큐만 비고 화면은 남아, 고치기 전과 같은 상태로 조용히 돌아간다.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// 줄 주석을 걷어낸 본문 — 금지 검사가 자기 설명 주석에 걸리지 않게.
String _codeOnly(String s) =>
    s.split('\n').map((l) => l.replaceFirst(RegExp(r'//.*$'), '')).join('\n');

void main() {
  final receiver = File('ios/Runner/PhoneReceiver.swift').readAsStringSync();
  final bridge = File('ios/Runner/VitalBridge.swift').readAsStringSync();

  test('앵커 — 두 소스를 읽었다', () {
    // 대상이 비면 아래 금지·존재 검사가 조용히 통과한다.
    expect(receiver.length, greaterThan(3000), reason: 'PhoneReceiver 를 못 읽었다');
    expect(bridge.length, greaterThan(2000), reason: 'VitalBridge 를 못 읽었다');
  });

  test('① 표시 스냅숏을 비우는 진입점이 있다', () {
    final code = _codeOnly(receiver);
    final i = code.indexOf('func resetSnapshot(reason: String)');
    expect(i, greaterThan(-1), reason: '초기화 진입점이 사라졌다');
    // ★ 함수 **안**을 본다. 파일 전체에서 찾으면 `private var snapshot = DisplaySnapshot()`
    //   선언부가 검사를 통과시켜, 실제로는 안 비우는 구현이 그대로 통과한다(작성 중 실제로 걸렸다).
    final body = code.substring(i, code.indexOf('\n    }', i));
    expect(body, contains('snapshot = DisplaySnapshot()'), reason: '누적 필드를 비우지 않는다');
    expect(body, contains('emit('), reason: '비운 뒤 화면에 알리지 않는다 — 옛 값이 그대로 남는다');
  });

  test('② ★ 큐 폐기와 화면 초기화가 같은 조건 안에 있다', () {
    final code = _codeOnly(bridge);
    final i = code.indexOf('if let previous = AuthStore.lastWorkerId');
    expect(i, greaterThan(-1), reason: '계정 교체 판정이 사라졌다');
    // 그 if 블록만 잘라 검사한다 — 파일 어딘가에 있기만 하면 통과하는 검사는 조건 분리를 못 잡는다.
    final block = code.substring(i, code.indexOf('\n            }', i) + 1);
    expect(block, contains('previous != workerId'), reason: '교체 판정 조건이 바뀌었다');
    expect(block, contains('VitalPipeline.shared.purgeQueue'),
        reason: '큐 폐기가 이 블록 밖으로 나갔다');
    expect(block, contains('PhoneReceiver.shared.resetSnapshot'),
        reason: '화면 초기화가 이 블록 밖으로 나갔다 — 큐만 비고 화면엔 직전 작업자 값이 남는다');
  });

  test('③ 로그아웃에서도 비운다', () {
    // 워치는 로그인 상태와 무관하게 계속 보내므로 로그아웃 중에도 스냅숏이 자란다.
    final code = _codeOnly(bridge);
    final i = code.indexOf('case "logout":');
    expect(i, greaterThan(-1), reason: '로그아웃 분기가 사라졌다');
    final block = code.substring(i, code.indexOf('case "status":', i));
    expect(block, contains('AuthStore.clearAll()'));
    expect(block, contains('PhoneReceiver.shared.resetSnapshot'),
        reason: '로그아웃이 표시 스냅숏을 남긴다');
  });

  test('④ 스냅숏은 여전히 계정을 모른다 — 초기화가 유일한 연결점이다', () {
    // PhoneReceiver 가 AuthStore 를 직접 보게 되면 수집 경로가 로그인 상태에 묶여
    // 미로그인 구간의 데이터가 조용히 사라질 수 있다. 연결은 Bridge 한 방향만 둔다.
    expect(_codeOnly(receiver), isNot(contains('AuthStore')),
        reason: '수집부가 로그인 상태를 직접 본다 — 미로그인 구간 수집이 끊길 수 있다');
  });
}
