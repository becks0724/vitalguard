// 색 토큰 — 관제웹 `apps/dashboard-web/app/globals.css` 와 같은 값.
//
// ★ 값은 같게 유지하되 **쓰는 방식이 다르다**(design-constraints.md V-1~V-5).
//   - 상태색 3종은 **배경면 전용**이고 그 위 글자는 잉크다. 흰 글자는 셋 다 대비 미달이다.
//   - primary 는 정반대로 **흰 글자만** 통과한다(흰 4.77:1 / 잉크 3.76:1).
//   - 상태는 색 하나로 말하지 않는다 — 색 + 모양으로 말하고 **글자를 덧붙이지 않는다.**
//
// ⚠ 판정은 서버가 하고 색은 표현이다. 토큰을 맞추는 것은 브랜드·표기 일관성 정책이지
//   "색을 맞추면 판정이 같아진다"는 뜻이 아니다.
import 'package:flutter/material.dart';

// C-3: 기존 두 패널의 최소 작업 폭. 물리 방향/기기 크기가 아닌 현재 창 dp 기준.
const double vgTwoPaneMinWidth = 1000;

// C-04: 툴바 제목도 사용자 글자 크기를 그대로 쓰며, 긴 제목은 안에서 스크롤한다.
double vgToolbarHeight(BuildContext context) =>
    _toolbarHeight(MediaQuery.textScalerOf(context));

double _toolbarHeight(TextScaler scaler) =>
    (scaler.scale(22) * 1.4 + 16).clamp(kToolbarHeight, double.infinity);

class VgToolbarTitle extends StatelessWidget {
  const VgToolbarTitle(this.text, {super.key, required this.textScaler});

  final String text;
  // AppBar 내부의 배율 제한보다 바깥에서 읽은 사용자 배율을 전달한다.
  final TextScaler textScaler;

  @override
  Widget build(BuildContext context) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: textScaler),
    child: ConstrainedBox(
      // AppBar는 제목에 무한 높이를 주므로 스크롤 뷰포트 높이를 명시한다.
      constraints: BoxConstraints(maxHeight: _toolbarHeight(textScaler)),
      child: SingleChildScrollView(
        primary: false,
        child: DefaultTextStyle(
          // AppBar의 기본 한 줄 말줄임을 상속하지 않는다.
          style: DefaultTextStyle.of(context).style,
          child: Text(text),
        ),
      ),
    ),
  );
}

class VgColors {
  const VgColors._();

  // 브랜드 — 흰 글자만 올린다
  static const primary = Color(0xFF0D74CE);
  static const primaryActive = Color(0xFF0A5FAD);
  static const primarySubtle = Color(0x140D74CE);

  // 중립
  static const canvas = Color(0xFFFFFFFF);
  static const surfaceSoft = Color(0xFFFAFAFA);
  static const surfaceStrong = Color(0xFFF0F0F3);
  static const hairline = Color(0xFFF0F0F3);
  static const hairlineStrong = Color(0xFFDCDEE0);
  static const ink = Color(0xFF171717); // 흰 배경 17.93:1
  static const body = Color(0xFF60646C); // 흰 배경 5.94:1
  static const muted = Color(0xFF999999); // 2.85:1 — 본문 텍스트로 쓰지 않는다

  // 상태 — 배경면 전용. 그 위 글자는 ink
  static const ok = Color(0xFF10B981); // 위에 ink 7.07:1
  static const warn = Color(0xFFF59E0B); // 위에 ink 8.35:1
  static const danger = Color(0xFFEF4444); // 위에 ink 4.76:1

  // 상태 연한 면 — 행 배경용
  static const okTint = Color(0xFFE7F8F2);
  static const warnTint = Color(0xFFFEF3DC);
  static const dangerTint = Color(0xFFFDE8E8);
}

/// 터치 타깃 — 40dp는 맨손도 2/4, 48dp부터는 소표본에서 실패가 없었다.
/// 56dp 최소는 유지한다. ⚠ 천 조건은 면 95% 의류 원단 1겹이지 진짜 장갑이 아니다.
const double vgTapMin = 56;
const double vgTapPrimary = 64;
// 맨손 실측 조준 편향 크기 13.2dp를 넘는 인접 타겟 간격.
const double vgGapTap = 16;

// 2944×1840·1840×2944 전 픽셀 실측(2026-09-12):
// dark max L=0.045045 → card L=0.011210, white 17.154:1 / ink 1.045:1.
// light min L=0.761249 → card L=0.969322, ink 17.404:1 / white 1.030:1.
// 본문은 dark에서 white, light에서 ink만 쓴다. 반대 조합은 AA 미달이다.
const double vgCardSurfaceAlpha = 0.88;

/// 좌우 시스템 제스처 경합 띠. ⚠ 상수로 쓰지 말고 런타임 인셋을 읽는 것이 원칙이다.
/// 이 값은 관찰값(63px / 2.125)이며 참고용이다.
const double vgEdgeGestureHint = 29.6;

const double vgRadiusCard = 16;

ThemeData vgLightTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: VgColors.primary,
    brightness: Brightness.light,
  ).copyWith(surface: VgColors.canvas, error: VgColors.danger);

  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: VgColors.canvas,
    useMaterial3: true,
    fontFamily: null, // 시스템 한글 폰트를 그대로 쓴다
  );
}
