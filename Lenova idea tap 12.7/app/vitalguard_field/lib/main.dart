// VitAlGuard 현장 — 현장 안전관리자(site_manager) 태블릿 앱.
//
// P6 첫 슬라이스: 인증과 기록. P4 화면은 VG_DIAGNOSTICS=true로 계속 열 수 있다.
// 실제 서버 대신 시연하려면 VG_MOCK=true를 명시한다. 화면에 모의 데이터가 표시된다.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'cctv_probe_screen.dart';
import 'diag_screen.dart';
import 'app.dart';
import 'vg_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Android 16(API 36)은 edge-to-edge 를 강제한다. 명시해 두어 동작을 눈으로 확인한다.
  // 시스템 바 아래까지 그리고 내용은 SafeArea 가 보호한다.
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      systemNavigationBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );

  // ⚠ 화면 방향을 고정하지 않는다 — API 36 + sw600dp 에서는 어차피 무시되고,
  //   우리 최소폭이 866dp 이므로 세로·가로 양쪽을 지원해야 한다(tab_plan §5.3 C-3).

  runApp(const VgFieldApp());
}

class VgFieldApp extends StatelessWidget {
  const VgFieldApp({
    super.key,
    this.cctvProbe = const bool.fromEnvironment('VG_CCTV_PROBE'),
    this.diagnostics = const bool.fromEnvironment('VG_DIAGNOSTICS'),
  });
  final bool cctvProbe;
  final bool diagnostics;

  @override
  Widget build(BuildContext context) {
    // 측정용 임시 화면. 측정 후 이 플래그 분기와 cctv_probe_screen.dart를 제거한다.
    if (cctvProbe) return const CctvProbeScreen();
    if (!diagnostics) return const FieldApp();
    return MaterialApp(
      title: 'VitAlGuard 현장',
      theme: vgLightTheme(),
      debugShowCheckedModeBanner: false,
      home: const DiagScreen(),
    );
  }
}
