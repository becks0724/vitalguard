// VitAlGuard 관리자 앱 진입 — 저장된 세션이 있으면 현황, 없으면 로그인
//
// 이 앱은 **보기 전용**이다. 생체를 수집하지 않고 경보를 조작하지도 않는다 —
// 관제 서버가 이미 판정해 둔 것을 폰에서 확인하기만 한다(context-notes.md).
import 'package:flutter/material.dart';

import 'login_screen.dart';
import 'session.dart';
import 'theme.dart';
import 'workers_screen.dart';

void main() {
  runApp(const VitalGuardAdminApp());
}

class VitalGuardAdminApp extends StatelessWidget {
  const VitalGuardAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'VitAlGuard 관리자',
      theme: vgLightTheme(),
      debugShowCheckedModeBanner: false,
      home: const RootGate(),
    );
  }
}

/// 시작 시 저장된 refresh 토큰으로 세션을 되살려 화면을 가른다.
class RootGate extends StatefulWidget {
  const RootGate({super.key});

  @override
  State<RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<RootGate> {
  final _session = Session();

  bool _checking = true;
  bool _signedIn = false;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    final ok = await _session.restore();
    if (!mounted) return;
    setState(() {
      _checking = false;
      _signedIn = ok;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!_signedIn) {
      return LoginScreen(
        session: _session,
        onSignedIn: () => setState(() => _signedIn = true),
      );
    }
    return WorkersScreen(
      session: _session,
      onSignedOut: () => setState(() => _signedIn = false),
    );
  }
}
