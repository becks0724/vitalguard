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

/// 보조줄 픽셀 폭 근사 — 한글·ASCII·공백의 폭이 크게 달라 **글자 수는 못 쓴다**
/// (`6 이상 높은 부담` 10자 84px < `개인 안정심박 기준` 9자 95px).
///
/// 계수는 실측 대조로 잡았다(11px AppleGothic · TextPainter):
/// ```
///   최근 170분 기준   실측 84  근사 82      개인 안정심박 기준  실측 95  근사 98
///   폰 수신 누계      실측 62  근사 64      심박 기반 · 참고값  실측 90  근사 96
///   기준 심박 60(미수신) 실측 110 근사 110    참고값 · 6 이상…    실측 127 근사 128
/// ```
double _approxPx(String s) {
  var w = 0.0;
  for (final c in s.runes) {
    if (c == 0x20) {
      w += 3; // 공백
    } else if (c >= 0x1100) {
      w += 11.5; // 한글·전각
    } else {
      w += 6; // 숫자·괄호 등 반각
    }
  }
  return w;
}

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

  test('★ 보조줄이 잘리지 않는 폭이다', () {
    // 보조줄은 한 줄 + ellipsis 라 길면 **조용히 잘린다** — tsc·test 어디에도 신호가 없고
    // 실기기 화면에서만 드러난다. 실기기에서 잘 나온 최장 문구가 `개인 안정심박 기준`
    // (실측 95px · 근사 98)이라 그것을 상한으로 삼는다.
    const maxPx = 100.0;
    final rows = [
      ...buildServerRows(OwnVitals.fromMap(_ok())!),
      ...buildServerRows(
          OwnVitals.fromMap(_ok(psi: const {'value': 2.5, 'personalized': false}))!),
    ];
    expect(rows.length, greaterThan(3), reason: '검사 대상을 못 만들었다');
    for (final r in rows) {
      final px = _approxPx(r.detail ?? '');
      expect(px, lessThanOrEqualTo(maxPx),
          reason: '${r.label} 보조줄 "${r.detail}" 근사 ${px.toStringAsFixed(0)}px — 잘린다');
    }
  });

  test('★ 추정 체온에 의료 판정 아님 자격이 붙는다', () {
    // 관제웹은 같은 값에 툴팁으로 자격을 달지만 **폰에는 툴팁이 없다.** 심박에서 역산하는
    // 값이라 걷기만 해도 오른다 — 실측에서 평균 111bpm 구간에 38.0℃ 가 나왔고 그 값은
    // 하필 danger 임계와 같다. 자격이 빠지면 작업자가 열이 있다고 읽는다.
    final core = buildServerRows(OwnVitals.fromMap(_ok())!)
        .firstWhere((r) => r.label.contains('체온'));
    expect(core.detail, contains('의료 판정 아님'));
  });

  test('PSI — 개인화면 임계 맥락, 아니면 기준 심박 caveat 을 앞세운다', () {
    // 4.7 이 높은지 낮은지가 화면에 없으면 숫자만 남는다(문헌 임계 6·7.5).
    final personal = buildServerRows(OwnVitals.fromMap(_ok())!)
        .firstWhere((r) => r.label.contains('PSI'));
    expect(personal.detail, contains('6 이상'));
    // ★ 기준 심박이 문헌 기본값(60)이면 값의 성격이 다르다 — 감추면 두 값이 같아 보인다.
    final fallback = buildServerRows(
            OwnVitals.fromMap(_ok(psi: const {'value': 2.5, 'personalized': false}))!)
        .firstWhere((r) => r.label.contains('PSI'));
    expect(fallback.detail, contains('60'));
    expect(fallback.detail, contains('미수신'), reason: '왜 개인화가 안 됐는지가 빠졌다');
  });
}
