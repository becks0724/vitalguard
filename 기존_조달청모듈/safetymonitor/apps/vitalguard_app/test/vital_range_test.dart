// 밴드 판정 테스트 — 임계가 관제웹과 갈리는 것을 막는다
//
// ★ 가장 위험한 회귀는 "임계가 바뀌는 것"이 아니라 **색과 글자가 갈리는 것**이다.
//   `statusOf`(판정식)와 `bands`(그림)는 각자 적혀 있어서, 한쪽만 고치면
//   막대는 초록인데 배지는 "주의" 가 된다. 그래서 전 구간을 대조한다.
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/vital_range.dart';

void main() {
  group('심박 — severity.ts heartRateStatus(활동 미지정) 와 같은 경계', () {
    test('경계값', () {
      expect(heartRateStatus(39), VitalStatus.danger);
      expect(heartRateStatus(40), VitalStatus.danger, reason: '40 은 위험(<=40)');
      expect(heartRateStatus(41), VitalStatus.caution);
      expect(heartRateStatus(50), VitalStatus.caution, reason: '50 은 주의(<=50)');
      expect(heartRateStatus(51), VitalStatus.normal);
      expect(heartRateStatus(109), VitalStatus.normal);
      expect(heartRateStatus(110), VitalStatus.caution, reason: '110 은 주의(>=110)');
      expect(heartRateStatus(129), VitalStatus.caution);
      expect(heartRateStatus(130), VitalStatus.danger, reason: '130 은 위험(>=130)');
    });

    test('★ 밴드(그림)와 판정식(글자)이 전 구간에서 일치한다', () {
      for (var v = heartRateRange.min.toInt(); v <= heartRateRange.max.toInt(); v++) {
        expect(heartRateRange.bandAt(v.toDouble()).status, heartRateStatus(v.toDouble()),
            reason: '$v bpm 에서 막대 색과 상태 글자가 다르다');
      }
    });

    test('구간 밖 값은 막대 끝에 붙는다 — 밖으로 나가면 위치가 거짓이다', () {
      expect(heartRateRange.positionOf(10), 0.0);
      expect(heartRateRange.positionOf(300), 1.0);
      expect(heartRateRange.positionOf(100), closeTo((100 - 30) / 140, 1e-9));
    });

    test('안정 기준임을 화면에 적을 근거 문구가 있다', () {
      // 폰은 활동 게이트가 없다 — 이 표기가 빠지면 작업 중 상승이 "주의" 로 읽힌다.
      expect(heartRateRange.basis, '안정 기준');
    });
  });

  group('SpO₂ — severity.ts spo2Status 와 같은 경계', () {
    test('경계값', () {
      expect(spo2Status(87.9), VitalStatus.danger);
      expect(spo2Status(88), VitalStatus.caution, reason: '88 은 주의(<88 만 위험)');
      expect(spo2Status(91.9), VitalStatus.caution);
      expect(spo2Status(92), VitalStatus.normal, reason: '92 부터 정상');
      expect(spo2Status(100), VitalStatus.normal);
    });

    test('★ 밴드와 판정식이 전 구간에서 일치한다', () {
      for (var i = 0; i <= 40; i++) {
        final v = spo2Range.min + i * 0.5;
        expect(spo2Range.bandAt(v).status, spo2Status(v),
            reason: '$v % 에서 막대 색과 상태 글자가 다르다');
      }
    });
  });

  test('밴드가 표시 구간을 빈틈·겹침 없이 덮는다', () {
    for (final r in [heartRateRange, spo2Range]) {
      expect(r.bands.first.from, r.min);
      expect(r.bands.last.to, r.max);
      for (var i = 1; i < r.bands.length; i++) {
        expect(r.bands[i].from, r.bands[i - 1].to, reason: '밴드 사이가 벌어졌거나 겹친다');
      }
    }
  });

  test('상태 어휘가 관제웹과 같다 — 새 말을 만들지 않는다', () {
    expect(vitalStatusLabel[VitalStatus.idle], '대기');
    expect(vitalStatusLabel[VitalStatus.normal], '정상');
    expect(vitalStatusLabel[VitalStatus.caution], '주의');
    expect(vitalStatusLabel[VitalStatus.danger], '위험');
  });
}
