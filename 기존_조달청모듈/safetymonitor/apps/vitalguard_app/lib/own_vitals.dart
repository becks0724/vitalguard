// 본인 파생 지표(서버 계산분) 조회·표시행 조립 — 파싱은 순수 함수라 화면 없이 테스트된다
//
// ★ 왜 서버에서 받는가 — 아래 넷은 폰이 낼 수 없거나 내면 관제웹과 갈린다.
//   추정 체온  180분 HR 시계열 + 워밍업 30분. 폰은 HR 이력을 안 들고 있다
//   PSI        추정 체온 파생. 두 곳이 계산하면 갈린다
//   스트레스   computeStressIndex + 모집단 베이스라인 상수. 이식하면 갈린다
//   누적 건수  DB COUNT
// 심박·SpO₂·이산·걸음은 폰이 이미 갖고 있으므로 여기서 받지 않는다(왕복을 늘리지 않는다).
//
// ★ 조회 대상은 **토큰이 정한다.** 사번을 실어 보내지 않으므로 계정을 바꾸면 그것만으로 바뀐다.
import 'vital_display.dart';

/// 서버가 준 본인 파생 지표. 없는 값은 `null` 이고 **0 이 아니다**.
class OwnVitals {
  const OwnVitals({
    required this.applicable,
    this.coreTempC,
    this.coreBasisMinutes,
    this.psi,
    this.psiPersonalized = false,
    this.stressCalibrating = true,
    this.stressIndex,
    this.totalPersisted,
  });

  /// 생체 수집 대상 계정인가. env owner 는 합성 사번이라 영영 데이터가 없다 —
  /// 그 경우 `false` 이고 화면은 "0" 이 아니라 아무것도 그리지 않는다.
  final bool applicable;

  final double? coreTempC;

  /// 추정의 근거가 된 분(워밍업 30분 미만이면 서버가 아예 안 만든다).
  final int? coreBasisMinutes;

  final double? psi;

  /// 개인 안정심박을 썼는가. 아니면 문헌 기본값(60)이라 값의 성격이 다르다.
  final bool psiPersonalized;

  /// 신호가 하나도 없어 보정 중인가. 보정 중은 **값이 아니라 상태**다.
  final bool stressCalibrating;
  final int? stressIndex;

  final int? totalPersisted;

  static double? _d(Object? v) => v is num ? v.toDouble() : null;
  static int? _i(Object? v) => v is num ? v.toInt() : null;

  /// 브리지 응답 → 모델. `ok != true` 면 null 을 돌려 **호출부가 타일을 안 그리게** 한다.
  /// 실패를 0 으로 바꾸지 않는다 — "조회 실패" 와 "값이 0" 은 다른 사실이다.
  static OwnVitals? fromMap(Map<dynamic, dynamic>? map) {
    if (map == null || map['ok'] != true) return null;
    final core = map['coreTemp'];
    final psi = map['psi'];
    final stress = map['stress'];
    return OwnVitals(
      applicable: map['applicable'] != false,
      coreTempC: core is Map ? _d(core['tempC']) : null,
      coreBasisMinutes: core is Map ? _i(core['basisMinutes']) : null,
      psi: psi is Map ? _d(psi['value']) : null,
      psiPersonalized: psi is Map && psi['personalized'] == true,
      stressCalibrating: stress is Map ? stress['calibrating'] == true : true,
      stressIndex: stress is Map ? _i(stress['index']) : null,
      totalPersisted: _i(map['totalPersisted']),
    );
  }
}

/// 서버 파생 지표의 표시행.
///
/// ★ **막대(range)를 붙이지 않는다.** 추정 체온·PSI 는 관제웹에서도 판정·경보에 넣지 않기로
/// 못 박은 값이다(추정치가 입력이라 오차 전파를 검증할 정답 데이터가 없다). 폰에서 밴드를
/// 그리면 그 계약이 폰에서만 깨진다. 스트레스도 같은 이유로 참고값이다.
List<VitalRow> buildServerRows(OwnVitals? v) {
  if (v == null || !v.applicable) return const [];
  final rows = <VitalRow>[];

  final core = v.coreTempC;
  if (core != null) {
    rows.add(VitalRow(
      label: '체온(심박 추정)',
      value: core.toStringAsFixed(1),
      unit: '℃',
      // ★ 자격 문구를 값 옆에 붙인다. 관제웹은 같은 값에 툴팁으로
      //   "의료 판정 아님·열 스트레스 참고" 를 달지만 **폰에는 툴팁이 없다.**
      //   심박에서 역산하는 값이라 걷기만 해도 오른다 — 2026-08-18 실측에서 최근 3시간
      //   평균 111bpm 구간에 38.0℃ 가 나왔고, 그 값은 하필 THRESHOLDS.coreTemp.dangerC 와 같다.
      //   관리자는 툴팁을 열 수 있지만 **작업자는 숫자만 본다.** 근거 분(basisMinutes)보다
      //   이 자격이 작업자에게 중요해 자리를 내줬다(사용자 결정 2026-08-18).
      //
      // ⚠ 보조줄은 한 줄 + ellipsis 라 길면 **조용히 잘린다.** 실기기에서 잘 나온 최장 문구가
      //   `개인 안정심박 기준`(95px)이라 그것을 상한으로 잡았다. `심박 추정 · 의료 판정 아님`
      //   은 130px 로 잘렸다 — 라벨이 이미 `(심박 추정)` 이라 그 부분을 덜어냈다(73px).
      detail: '의료 판정 아님',
    ));
  }

  final psi = v.psi;
  if (psi != null) {
    rows.add(VitalRow(
      label: '생리적 부담(PSI)',
      value: psi.toStringAsFixed(1),
      unit: '/10',
      // 개인화된 경우에는 **임계 맥락**을 준다 — 4.7 이 높은지 낮은지가 화면에 없으면
      // 숫자만 남는다(문헌 임계 6·7.5 · Moran 1998).
      // 개인화가 안 된 경우에는 그 사실이 먼저다 — 기준 심박이 문헌 기본값 60 이면 값의
      // 성격이 달라지므로 임계 맥락보다 이 caveat 을 앞세운다. 감추면 두 값이 같아 보인다.
      // 폭 상한 95px — `참고값 · 6 이상 높은 부담`(127px)·`기준 심박 60(미수신)`(110px)은
      // 둘 다 잘린다. 후자는 이번 변경 이전부터 잘리고 있던 잠재 결함이다(개인화된 화면만
      // 실측돼 드러나지 않았다). 각각 84px·83px 로 줄이되 담은 뜻은 그대로 둔다.
      detail: v.psiPersonalized ? '6 이상 높은 부담' : '기준 60 · 미수신',
    ));
  }

  if (!v.stressCalibrating && v.stressIndex != null) {
    rows.add(VitalRow(
      label: '스트레스',
      value: '${v.stressIndex}',
      detail: '심박 기반 · 참고값',
    ));
  }

  return rows;
}
