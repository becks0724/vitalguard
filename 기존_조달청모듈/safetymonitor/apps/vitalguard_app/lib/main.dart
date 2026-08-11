// 관제웹 계정 로그인·업로드 상태 표시 UI — 생체 데이터 경로는 네이티브 전담이라 Dart 를 경유하지 않는다
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'vital_stream.dart';

const MethodChannel _bridge = MethodChannel('vitalguard/bridge');

void main() {
  runApp(const VitalGuardApp());
}

class VitalGuardApp extends StatelessWidget {
  const VitalGuardApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'VitAlGuard',
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFD32F2F))),
      home: const RootGate(),
    );
  }
}

/// 시작 시 로그인 여부로 화면을 분기한다. 브리지가 없으면(위젯 테스트 등) 로그인 화면으로.
class RootGate extends StatefulWidget {
  const RootGate({super.key});

  @override
  State<RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<RootGate> {
  bool? _loggedIn;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    var loggedIn = false;
    try {
      final status = await _bridge.invokeMapMethod<String, dynamic>('status');
      loggedIn = status?['loggedIn'] == true;
    } catch (_) {
      loggedIn = false;
    }
    if (mounted) setState(() => _loggedIn = loggedIn);
  }

  @override
  Widget build(BuildContext context) {
    switch (_loggedIn) {
      case null:
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case true:
        return const HomeScreen();
      case false || _:
        return const LoginScreen();
    }
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _idController = TextEditingController();
  final _pwController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _idController.dispose();
    _pwController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await _bridge.invokeMapMethod<String, dynamic>('login', {
        'id': _idController.text.trim(),
        'password': _pwController.text,
      });
      if (res?['ok'] == true) {
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(builder: (_) => const HomeScreen()),
        );
        return;
      }
      setState(() => _error = (res?['error'] as String?) ?? '로그인에 실패했습니다.');
    } catch (_) {
      setState(() => _error = '네이티브 브리지 연결에 실패했습니다.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.favorite, size: 56, color: Color(0xFFD32F2F)),
                const SizedBox(height: 12),
                const Text('VitAlGuard', textAlign: TextAlign.center, style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                const Text('관제웹 계정으로 로그인하세요', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 28),
                TextField(
                  controller: _idController,
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: '아이디', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _pwController,
                  obscureText: true,
                  onSubmitted: (_) => _busy ? null : _login(),
                  decoration: const InputDecoration(labelText: '비밀번호', border: OutlineInputBorder()),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.red)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _login,
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                  child: _busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('로그인'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Timer? _timer;
  Map<String, dynamic> _status = const {};
  StreamSubscription<VitalStreamEvent>? _sub;

  // 실시간 표시 상태(EventChannel) — 폴링(_status)과 별개로 즉시 갱신된다.
  double? _bpm;
  DateTime? _measuredAt;
  int? _seq;
  int? _livePending;
  bool _authRejected = false;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
    try {
      _sub = VitalStream.events().listen((e) {
        if (!mounted) return;
        setState(() {
          if (e.type == 'hr') {
            _bpm = e.bpm;
            _measuredAt = e.measuredAt;
            _seq = e.seq;
          }
          if (e.pending != null) _livePending = e.pending;
          if (e.authRejected == true) _authRejected = true;
          if (e.uploadOk == true) _authRejected = false;
        });
      });
    } catch (_) {
      // 브리지 부재(테스트 등)면 폴링 표시만 유지한다.
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final status = await _bridge.invokeMapMethod<String, dynamic>('status');
      if (mounted && status != null) setState(() => _status = status);
    } catch (_) {
      // 브리지 부재(테스트 등)면 표시만 유지한다.
    }
  }

  Future<void> _logout() async {
    try {
      await _bridge.invokeMethod<void>('logout');
    } catch (_) {}
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
    );
  }

  String _measuredAgoText() {
    final at = _measuredAt;
    if (at == null) return '';
    final sec = DateTime.now().difference(at).inSeconds;
    return sec <= 1 ? '방금' : '$sec초 전';
  }

  @override
  Widget build(BuildContext context) {
    final name = _status['name'] as String? ?? '작업자';
    final workerId = _status['workerId'] as String? ?? '-';
    final pending = _livePending ?? _status['pending'] as int? ?? 0;
    final baseURL = _status['baseURL'] as String? ?? '';
    final receiving = _bpm != null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('VitAlGuard'),
        actions: [
          IconButton(onPressed: _logout, tooltip: '로그아웃', icon: const Icon(Icons.logout)),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_authRejected)
              MaterialBanner(
                backgroundColor: Colors.red.shade50,
                content: const Text('서버가 인증을 거부했습니다. 다시 로그인해 주세요.'),
                actions: [TextButton(onPressed: _logout, child: const Text('재로그인'))],
              ),
            // 실시간 심박 — 워치 → 폰 수신 즉시 갱신(EventChannel).
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Icon(Icons.favorite, color: receiving ? const Color(0xFFD32F2F) : Colors.grey, size: 32),
                        const SizedBox(width: 10),
                        Text(
                          receiving ? _bpm!.toStringAsFixed(0) : '--',
                          style: const TextStyle(fontSize: 56, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(width: 6),
                        const Text('bpm', style: TextStyle(fontSize: 18, color: Colors.grey)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      receiving
                          ? '측정 ${_measuredAgoText()} · 배치 #$_seq'
                          : '워치 수집 대기 — VitalWatch 에서 [시작]을 누르세요',
                      style: const TextStyle(color: Colors.grey),
                    ),
                  ],
                ),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.badge_outlined),
                title: Text('$name ($workerId)'),
                subtitle: const Text('업로드 파이프라인 가동 중 — 워치 수집분을 서버로 전송합니다'),
              ),
            ),
            Card(
              child: ListTile(
                leading: Icon(
                  pending == 0 ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined,
                  color: pending == 0 ? Colors.green : Colors.orange,
                ),
                title: Text(pending == 0 ? '전송 큐 비어 있음' : '전송 대기 $pending건'),
                subtitle: Text(baseURL, maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
