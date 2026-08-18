// VitAlGuard 폰 앱 색 토큰·테마 — 관제웹 globals.css 와 같은 값을 쓴다(브랜드 일관)
//
// ★ 종전 시드는 빨강(0xFFD32F2F)이었다. 하트 아이콘의 빨강은 옳지만 **시드로 쓴 것이
// 잘못**이라 버튼·입력·앱바까지 전부 붉게 물들어 로고(#1860c0 네이비블루)·관제웹과
// 어긋나 있었다. 브랜드 파랑을 시드로 올리고 빨강은 심박·위험에만 남긴다.
//
// 비율 — 중립 ~85% · 브랜드 ~10% · 상태색 ~5%. 상태색은 **판정에만** 쓴다.
import 'package:flutter/material.dart';

/// 관제웹 `app/globals.css` 의 CSS 변수와 1:1. 값을 바꾸려면 양쪽을 같이 바꾼다.
class VgColors {
  const VgColors._();

  // 중립 — 화면의 대부분
  static const canvas = Color(0xFFFFFFFF); // --color-canvas
  static const surfaceCard = Color(0xFFFAFAFA); // --color-surface-card(soft)
  static const surfaceStrong = Color(0xFFF0F0F3); // --color-surface-strong
  static const hairline = Color(0xFFF0F0F3); // --color-hairline
  static const hairlineStrong = Color(0xFFDCDEE0); // --color-hairline-strong
  static const ink = Color(0xFF171717); // --color-ink   (값)
  static const body = Color(0xFF60646C); // --color-body  (라벨)
  static const muted = Color(0xFF999999); // --color-muted (보조)

  // 브랜드 — 액센트
  static const primary = Color(0xFF0D74CE); // --color-primary
  static const primaryActive = Color(0xFF0A5FAD); // --color-primary-active
  /// 주 지표를 감싸는 옅은 브랜드 면 — 관제웹의 같은 토큰과 같은 용도다.
  static const primarySubtle = Color(0x140D74CE); // --color-primary-subtle rgba(13,116,206,.08)
  static const primaryRing = Color(0x470D74CE); // --color-primary-ring rgba(13,116,206,.28)

  // 상태 — 판정에만
  static const normal = Color(0xFF10B981); // --color-semantic-up
  static const caution = Color(0xFFF59E0B); // --color-warning
  static const danger = Color(0xFFEF4444); // --color-semantic-down

  /// 심박 하트 — 참고 디자인도 심박은 빨강이다. 시드가 아니라 이 한 곳에서만 쓴다.
  static const heart = Color(0xFFD32F2F);
}

/// 카드 모서리 — 참고 디자인의 큼직한 라운드. 타일·카드가 같은 값을 쓴다.
const double vgCardRadius = 16;

ThemeData vgLightTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: VgColors.primary,
    brightness: Brightness.light,
  ).copyWith(
    surface: VgColors.canvas,
    error: VgColors.danger,
  );

  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: VgColors.canvas,
    // 참고 디자인의 카드는 그림자가 없다 — 면과 헤어라인으로만 나눈다.
    cardTheme: CardThemeData(
      color: VgColors.surfaceCard,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(vgCardRadius),
        side: const BorderSide(color: VgColors.hairline),
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: VgColors.canvas,
      foregroundColor: VgColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: VgColors.primary,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: VgColors.primary, width: 2),
      ),
    ),
  );
}
