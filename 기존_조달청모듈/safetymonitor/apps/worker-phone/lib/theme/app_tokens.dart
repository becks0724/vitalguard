// 작업자 폰 앱 디자인 토큰 — 레퍼런스(민트/틸 수면 테마) 기반 색·간격·라운드·그림자 + 공용 위젯
import 'package:flutter/material.dart';

class AppTokens {
  AppTokens._();

  // 배경 그라데이션 (민트 → 틸)
  static const bgTop = Color(0xFFDCEEE9);
  static const bgBottom = Color(0xFFAFD6CD);

  // 표면 / 강조
  static const surface = Color(0xFFFFFFFF);
  static const accentDeep = Color(0xFF2E6B5E); // 딥틸 강조 카드 / 주요 버튼

  // 텍스트
  static const textPrimary = Color(0xFF143029);
  static const textSecondary = Color(0xFF5B7A72);
  static const textMuted = Color(0xFF93AAA3);

  // 상태색 (대시보드 신호등 체계와 동일 톤 — 단 폰은 분석 안 함, 연결 상태 표시에만 사용)
  static const ok = Color(0xFF15916B);
  static const warn = Color(0xFFCB8A1E);
  static const danger = Color(0xFFE5484D);

  // 아이콘 칩 파스텔 배경 / 전경
  static const chipRedBg = Color(0xFFFCE4E6);
  static const chipRedFg = Color(0xFFE5484D);
  static const chipBlueBg = Color(0xFFE2ECFE);
  static const chipBlueFg = Color(0xFF3A6FD6);
  static const chipOrangeBg = Color(0xFFFBEAD6);
  static const chipOrangeFg = Color(0xFFD08A2C);
  static const chipTealBg = Color(0xFFDCF1EA);
  static const chipTealFg = Color(0xFF2E6B5E);

  // 라운드
  static const rCard = 22.0;
  static const rChip = 14.0;
  static const rButton = 16.0;

  // 카드 그림자 (부드럽게)
  static const cardShadow = <BoxShadow>[
    BoxShadow(color: Color(0x14123A30), blurRadius: 24, offset: Offset(0, 10)),
  ];

  static const bgGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [bgTop, bgBottom],
  );
}

// 흰색 라운드 카드 + 부드러운 그림자 (레퍼런스 카드 스타일)
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.color,
  });

  final Widget child;
  final EdgeInsets padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? AppTokens.surface,
        borderRadius: BorderRadius.circular(AppTokens.rCard),
        boxShadow: AppTokens.cardShadow,
      ),
      child: child,
    );
  }
}

// 파스텔 원형(라운드) 배경 + 컬러 아이콘 칩
class IconChip extends StatelessWidget {
  const IconChip({
    super.key,
    required this.icon,
    required this.bg,
    required this.fg,
    this.size = 44,
  });

  final IconData icon;
  final Color bg;
  final Color fg;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppTokens.rChip),
      ),
      child: Icon(icon, color: fg, size: size * 0.5),
    );
  }
}
