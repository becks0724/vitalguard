// 서버 파생 지표 파싱·표시 테스트 — 실패를 값으로 바꾸지 않는 것이 요점이다
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/own_vitals.dart';

Map<String, dynamic> _ok({
  Object? core = const {'tempC': 37.5, 'basisMinutes': 96},
  Object? psi = const {'value': 2.5, 'personalized': true},
  Object? stress = const {'calibrating': false, 'index': 38, 'level': 'moderate'},
  Object? total = 247608,
  bool applicable = true,
}) =>
    {
      'ok': true,
      'applicable': applicable,
      'workerId': 'EMP-6861',
      'coreTemp': core,
      'psi': psi,
      'stress': stress,
      'totalPersisted': total,
    };

void main() {
  test('정상 응답을 그대로 읽는다', () {
    final v = OwnVitals.fromMap(_ok())!;
    expect(v.coreTempC, 37.5);
    expect(v.coreBasisMinutes, 96);
    expect(v.psi, 2.5);
    expect(v.psiPersonalized, isTrue);
    expect(v.stressCalibrating, isFalse);
    expect(v.stressIndex, 38);
    expect(v.totalPersisted, 247608);
  });

  test('★ 실패는 null 이다 — 0 으로 바꾸지 않는다', () {
    // "조회 실패" 와 "값이 0" 은 다른 사실이다. 0 으로 바꾸면 화면이 없는 사실을 단언한다.
    expect(OwnVitals.fromMap(null), isNull);
    expect(OwnVitals.fromMap({'ok': false, 'error': '조회 실패(401)'}), isNull);
    expect(OwnVitals.fromMap({'ok': false, 'status': 500}), isNull);
  });

  test('★ 개별 값이 없으면 그 값만 null 이다', () {
    // 워밍업 30분 미만이면 서버가 추정 체온을 아예 안 만든다 — 그때 PSI 도 함께 없다.
    final v = OwnVitals.fromMap(_ok(core: null, psi: null))!;
    expect(v.coreTempC, isNull);
    expect(v.psi, isNull);
    expect(v.totalPersisted, 247608, reason: '다른 값까지 사라지면 안 된다');
    expect(buildServerRows(v).map((r) => r.label), ['스트레스']);
  });

  test('보정 중 스트레스는 행을 만들지 않는다 — 상태이지 값이 아니다', () {
    final v = OwnVitals.fromMap(_ok(stress: const {'calibrating': true, 'index': null}))!;
    expect(v.stressCalibrating, isTrue);
    expect(buildServerRows(v).map((r) => r.label), ['체온(심박 추정)', '생리적 부담(PSI)']);
  });

  test('★ 수집 대상 아닌 계정(env owner)은 아무 행도 만들지 않는다', () {
    // 합성 사번이라 생체가 영영 없다 — 0 이나 `--` 를 그리면 "수집됐는데 없다" 로 읽힌다.
    final v = OwnVitals.fromMap(_ok(applicable: false))!;
    expect(v.applicable, isFalse);
    expect(buildServerRows(v), isEmpty);
  });

  test('★ 서버 파생 지표에는 범위 막대를 붙이지 않는다', () {
    // 추정 체온·PSI 는 관제웹에서도 판정·경보에 넣지 않기로 못 박은 값이다(추정치가 입력이라
    // 오차 전파를 검증할 정답 데이터가 없다). 폰에서 밴드를 그리면 그 계약이 폰에서만 깨진다.
    for (final r in buildServerRows(OwnVitals.fromMap(_ok())!)) {
      expect(r.range, isNull, reason: '${r.label} 에 판정 밴드가 붙었다');
      expect(r.numeric, isNull, reason: '${r.label} 이 판정 입력을 들고 있다');
    }
  });

  test('PSI 기준 심박 출처를 감추지 않는다', () {
    final personal = buildServerRows(OwnVitals.fromMap(_ok())!)
        .firstWhere((r) => r.label.contains('PSI'));
    expect(personal.detail, '개인 안정심박 기준');
    final fallback = buildServerRows(
            OwnVitals.fromMap(_ok(psi: const {'value': 2.5, 'personalized': false}))!)
        .firstWhere((r) => r.label.contains('PSI'));
    expect(fallback.detail, contains('60'));
  });
}
