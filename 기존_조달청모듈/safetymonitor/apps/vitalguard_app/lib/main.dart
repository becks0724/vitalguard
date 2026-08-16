// 관제웹 계정 로그인·업로드 상태 표시 UI — 생체 데이터 경로는 네이티브 전담이라 Dart 를 경유하지 않는다
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'vital_display.dart';
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
                // 관제웹 로그인과 동일한 브랜드·문구 — 작업자가 같은 로그인임을 바로 알게 한다.
                const Text('OPEN SAFETY · NEVER ALONE',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey, fontSize: 12, letterSpacing: 1.2)),
                const SizedBox(height: 20),
                const Text('로그인', textAlign: TextAlign.center, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                const Text('관제웹과 같은 ID·비밀번호를 사용합니다', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 24),
                TextField(
                  controller: _idController,
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: 'ID', border: OutlineInputBorder()),
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
                  child: _busy ? const Text('확인 중…') : const Text('로그인'),
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
  // 네이티브가 누적 스냅숏을 통째로 보내므로 마지막 이벤트 하나만 들고 있으면 된다.
  VitalStreamEvent? _vitals;
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
          if (e.type == 'hr') _vitals = e;
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

  /// 심박에만 상대 시각을 쓴다 — 5초마다 오는 값이라 나이가 곧 수신 상태다.
  /// 나머지(SpO₂·이산 측정)는 절대 시각으로 적는다. 매초 바뀌는 문구를 여러 줄에 두면
  /// 화면이 계속 흔들려 정작 값이 안 읽힌다.
  String _measuredAgoText() {
    final at = _vitals?.measuredAt;
    if (at == null) return '';
    final sec = DateTime.now().difference(at).inSeconds;
    if (sec <= 1) return '방금';
    if (sec < 60) return '$sec초 전';
    return '${sec ~/ 60}분 ${sec % 60}초 전';
  }

  /// 생체 한 줄 — 왼쪽 이름, 오른쪽 값. 보조 문구(측정 시각·건수)는 값 아래 작게 둔다.
  Widget _vitalRowTile(VitalRow row) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(row.label, style: const TextStyle(color: Colors.grey))),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(row.value, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
              if (row.detail != null)
                Text(row.detail!, style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final name = _status['name'] as String? ?? '작업자';
    final workerId = _status['workerId'] as String? ?? '-';
    final pending = _livePending ?? _status['pending'] as int? ?? 0;
    final baseURL = _status['baseURL'] as String? ?? '';
    final vitals = _vitals;
    final bpm = vitals?.bpm;
    final receiving = bpm != null;
    final rows = vitals == null ? const <VitalRow>[] : buildVitalRows(vitals);

    return Scaffold(
      appBar: AppBar(
        title: const Text('VitAlGuard'),
        actions: [
          IconButton(onPressed: _logout, tooltip: '로그아웃', icon: const Icon(Icons.logout)),
        ],
      ),
      // 카드가 늘 수 있어 ListView — 화면 밖으로 밀리면 그 값은 없는 것과 같다.
      body: ListView(
        padding: const EdgeInsets.all(20),
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
                        receiving ? bpm.toStringAsFixed(0) : '--',
                        style: const TextStyle(fontSize: 56, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(width: 6),
                      const Text('bpm', style: TextStyle(fontSize: 18, color: Colors.grey)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    receiving
                        ? '측정 ${_measuredAgoText()} · 배치 #${vitals?.seq ?? '-'}'
                        : '워치 수집 대기 — VitalWatch 에서 [시작]을 누르세요',
                    style: const TextStyle(color: Colors.grey),
                  ),
                ],
              ),
            ),
          ),
          // 나머지 생체 — 워치가 보낸 것만 그린다. 안 온 종류는 행 자체가 없다(0 으로 적으면 거짓말).
          if (rows.isNotEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Column(children: rows.map(_vitalRowTile).toList()),
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
    );
  }
}
