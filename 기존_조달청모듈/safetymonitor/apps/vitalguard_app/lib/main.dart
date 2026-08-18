// 관제웹 계정 로그인·업로드 상태 표시 UI — 생체 데이터 경로는 네이티브 전담이라 Dart 를 경유하지 않는다
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'metric_tile.dart';
import 'own_vitals.dart';
import 'status_ring.dart';
import 'theme.dart';
import 'vital_display.dart';
import 'vital_range.dart';
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
      theme: vgLightTheme(),
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
                const Icon(Icons.favorite, size: 56, color: VgColors.heart),
                const SizedBox(height: 12),
                const Text('VitAlGuard', textAlign: TextAlign.center, style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                // 관제웹 로그인과 동일한 브랜드·문구 — 작업자가 같은 로그인임을 바로 알게 한다.
                const Text('OPEN SAFETY · NEVER ALONE',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: VgColors.muted, fontSize: 12, letterSpacing: 1.2)),
                const SizedBox(height: 20),
                const Text('로그인', textAlign: TextAlign.center, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                const Text('관제웹과 같은 ID·비밀번호를 사용합니다',
                    textAlign: TextAlign.center, style: TextStyle(color: VgColors.body)),
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
                  Text(_error!, style: const TextStyle(color: VgColors.danger)),
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
  // 서버 파생 지표는 추정 체온 캐시(서버 60초)와 같은 주기로만 받는다 — 더 자주 물어도
  // 같은 값이 온다. 3초 폴링(_timer)에 얹으면 왕복만 20배가 된다.
  Timer? _ownTimer;
  OwnVitals? _own;
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
    _refreshOwn();
    _ownTimer = Timer.periodic(const Duration(seconds: 60), (_) => _refreshOwn());
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
    _ownTimer?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  /// 서버 파생 지표 조회. 실패하면 **직전 값을 지우고 null 로 둔다** — 옛 값을 계속 그리면
  /// 언제 것인지 모르는 수치가 화면에 남는다(추정 체온은 분 단위로 움직인다).
  Future<void> _refreshOwn() async {
    Map<String, dynamic>? res;
    try {
      res = await _bridge.invokeMapMethod<String, dynamic>('ownVitals');
    } catch (_) {
      res = null; // 브리지 부재(테스트 등)
    }
    if (!mounted) return;
    setState(() => _own = OwnVitals.fromMap(res));
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
    // 네이티브 스냅숏은 로그아웃에서 비워지지만 Dart 가 들고 있는 서버 파생분도 함께 버린다.
    _own = null;
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

  /// 섹션 제목 — 격자마다 무엇을 모아 둔 곳인지 밝힌다.
  Widget _sectionTitle(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(2, 20, 0, 10),
        child: Text(text,
            style: const TextStyle(
                fontSize: 15, fontWeight: FontWeight.w700, color: VgColors.ink)),
      );

  /// 2열 격자. **칸 높이를 고정**한다 — 막대 있는 타일과 없는 타일이 섞여도
  /// 높이가 들쭉날쭉하면 값끼리 눈으로 비교가 안 된다.
  Widget _tileGrid(List<VitalRow> rows) {
    final lines = <Widget>[];
    for (var i = 0; i < rows.length; i += 2) {
      final right = i + 1 < rows.length ? rows[i + 1] : null;
      lines.add(Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: SizedBox(
          height: 108,
          child: Row(
            children: [
              Expanded(child: MetricTile(row: rows[i])),
              const SizedBox(width: 10),
              // 홀수 개면 마지막 칸은 빈 자리로 둔다(늘려서 채우면 그 타일만 커진다).
              Expanded(child: right == null ? const SizedBox() : MetricTile(row: right)),
            ],
          ),
        ),
      ));
    }
    return Column(children: lines);
  }

  /// 아래 3열의 한 칸 — 라벨 + 밴드 막대(또는 판정 없음) + 값.
  ///
  /// ★ 막대는 **밴드 안 위치**다. 참고 디자인의 `35/180 g` 같은 진행률이 아니다 —
  /// 이 앱엔 목표 개념이 없고(`목표`·`goal`·`target`·근무 시간 전부 0건),
  /// 만들면 없는 기준을 우리가 정하는 것이 된다.
  Widget _bandColumn({
    required String label,
    required VitalRange? range,
    required double? value,
    required String display,
    String? noBarNote,
  }) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: VgColors.body)),
          const SizedBox(height: 6),
          SizedBox(
            height: 16,
            child: range != null && value != null
                ? HorizontalRangeBar(range: range, value: value)
                // 판정에 안 올리기로 한 값은 **막대 자리를 비우고 그 사실을 적는다.**
                // 그냥 비우면 "측정 안 됨" 으로 읽힌다 — 다른 사실이다.
                : Align(
                    alignment: Alignment.centerLeft,
                    child: Text(noBarNote ?? '판정 없음',
                        style: const TextStyle(fontSize: 10, color: VgColors.muted)),
                  ),
          ),
          const SizedBox(height: 5),
          Text(display, style: const TextStyle(fontSize: 11, color: VgColors.ink)),
        ],
      ),
    );
  }

  /// 5칸 요약 행 — 두 번째 참고 이미지의 `신체 지표` 배치.
  ///
  /// ★ 아래 격자와 **다른 규칙**을 쓴다. 격자는 "측정 안 된 종류는 타일 자체가 없다" 인데
  /// 이 행은 **칸을 고정하고 없으면 `--`** 로 둔다. 다섯 자리가 늘 같은 자리에 있어야
  /// "무엇이 안 오고 있는지"가 한눈에 보이기 때문이다 — 참고 디자인도 안정심박을 `--` 로 둔다.
  /// 0 을 적지 않는다는 원래 계약은 그대로다(`--` 는 0 이 아니라 모름이다).
  ///
  /// 세로 표식은 **임계가 있는 것에만** 붙는다. 지금은 SpO₂ 하나뿐이고, 나머지 넷은
  /// 근거 있는 기준이 없어 값만 적는다(HRV·호흡수에 참고범위를 새로 넣지 않기로 한 결정).
  Widget _summaryStrip(VitalStreamEvent? vitals) {
    final d = vitals?.discreteValues ?? const <String, double>{};
    String f(double? v, int digits) => v == null ? '--' : v.toStringAsFixed(digits);

    final items = <(IconData, Color, String, String, double?, VitalRange?)>[
      (Icons.monitor_heart_outlined, VgColors.heart, f(d['hrv'], 0), 'ms', d['hrv'], null),
      (Icons.favorite_border, VgColors.heart, f(d['rhr'], 0), 'bpm', d['rhr'], null),
      (Icons.air, VgColors.primary, f(d['rr'], 1), '회/분', d['rr'], null),
      (Icons.water_drop_outlined, VgColors.primary, f(vitals?.spo2, 0), '%', vitals?.spo2, spo2Range),
      (Icons.thermostat, VgColors.caution, f(_own?.coreTempC, 1), '℃', _own?.coreTempC, null),
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('주요 생체',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: VgColors.ink)),
            const SizedBox(height: 10),
            Row(
              children: [
                for (final (icon, tint, value, unit, raw, range) in items)
                  Expanded(
                    child: Column(
                      children: [
                        Icon(icon, size: 17, color: raw == null ? VgColors.muted : tint),
                        const SizedBox(height: 6),
                        SizedBox(
                          height: 34,
                          // 임계가 있는 것만 위치 표식. 없으면 자리만 비운다(막대를 그리면 근거가 생긴 것처럼 읽힌다).
                          child: range != null && raw != null
                              ? Center(child: VerticalRangeBar(range: range, value: raw, height: 34))
                              : const SizedBox(),
                        ),
                        const SizedBox(height: 6),
                        Text(value,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              color: raw == null ? VgColors.muted : VgColors.primary,
                            )),
                        Text(unit, style: const TextStyle(fontSize: 9, color: VgColors.muted)),
                      ],
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// 현재 상태 카드 — 참고 디자인(사용자 제공)의 **배치만** 옮긴 것.
  /// 좌·우 보조값 · 가운데 링 · 아래 3열. 의미는 목표가 아니라 **임계 밴드 안 위치**다.
  Widget _statusCard(VitalStreamEvent? vitals) {
    final bpm = vitals?.bpm;
    final receiving = bpm != null;
    final spo2 = vitals?.spo2;
    final coreC = _own?.coreTempC;

    return Card(
      color: VgColors.primarySubtle,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(vgCardRadius),
        side: const BorderSide(color: VgColors.primaryRing),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 14),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: spo2 == null
                      ? const SizedBox()
                      : RingSideValue(
                          label: '산소포화도',
                          value: spo2.toStringAsFixed(0),
                          unit: '%',
                          status: spo2Status(spo2),
                        ),
                ),
                if (receiving)
                  StatusRing(range: heartRateRange, value: bpm, unit: 'bpm')
                else
                  const SizedBox(
                    width: 124,
                    height: 124,
                    child: Center(
                      child: Text('수집 대기', style: TextStyle(fontSize: 13, color: VgColors.muted)),
                    ),
                  ),
                Expanded(
                  // ★ 상태를 주지 않는다 — 추정치가 입력이라 판정·경보에 올리지 않기로 한 값이다.
                  child: coreC == null
                      ? const SizedBox()
                      : RingSideValue(
                          label: '체온(추정)',
                          value: coreC.toStringAsFixed(1),
                          unit: '℃',
                          note: '의료 판정 아님',
                        ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Divider(height: 1, color: VgColors.hairline),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _bandColumn(
                  label: '심박',
                  range: receiving ? heartRateRange : null,
                  value: bpm,
                  display: receiving ? '${bpm.toStringAsFixed(0)} bpm' : '--',
                  noBarNote: '미수신',
                ),
                const SizedBox(width: 12),
                _bandColumn(
                  label: '산소포화도',
                  range: spo2 == null ? null : spo2Range,
                  value: spo2,
                  display: spo2 == null ? '--' : '${spo2.toStringAsFixed(0)} %',
                  noBarNote: '미수신',
                ),
                const SizedBox(width: 12),
                _bandColumn(
                  label: '체온(추정)',
                  range: null, // 판정 미주입 계약 — 밴드를 그리지 않는다
                  value: null,
                  display: coreC == null ? '--' : '${coreC.toStringAsFixed(1)} ℃',
                  noBarNote: coreC == null ? '미수신' : '판정 없음',
                ),
              ],
            ),
            if (receiving) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  const Text('안정 기준', style: TextStyle(fontSize: 10, color: VgColors.muted)),
                  const Spacer(),
                  Flexible(
                    child: Text(
                      '측정 ${_measuredAgoText()} · 배치 #${vitals?.seq ?? '-'}',
                      textAlign: TextAlign.right,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 10, color: VgColors.muted),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
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
    // 워치가 보낸 것 + 서버가 계산한 것을 한 격자에 둔다. 둘 다 "지금 이 사람의 몸" 이라
    // 성격이 같고, 출처가 다르다고 나누면 같은 걸 두 번 찾게 된다(활동 누계와는 다르다).
    final sections = splitVitalSections(vitals == null ? const [] : buildVitalRows(vitals));
    // 요약 행에 올라간 것은 격자에서 뺀다 — 같은 값이 한 화면에 두 번 뜨면
    // 어느 쪽이 최신인지 읽는 사람이 판단해야 한다.
    final bodyRows = [...sections.body, ...buildServerRows(_own)]
        .where((r) => !summaryStripLabels.contains(r.label))
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('VitAlGuard', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          IconButton(onPressed: _logout, tooltip: '로그아웃', icon: const Icon(Icons.logout)),
        ],
      ),
      // 카드가 늘 수 있어 ListView — 화면 밖으로 밀리면 그 값은 없는 것과 같다.
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          if (_authRejected)
            MaterialBanner(
              backgroundColor: VgColors.danger.withValues(alpha: 0.08),
              content: const Text('서버가 인증을 거부했습니다. 다시 로그인해 주세요.'),
              actions: [TextButton(onPressed: _logout, child: const Text('재로그인'))],
            ),
          _statusCard(vitals),
          const SizedBox(height: 10),
          _summaryStrip(vitals),
          // 측정 안 된 종류는 타일 자체가 없다 — 0 을 적으면 "측정했는데 0" 이 된다.
          if (bodyRows.isNotEmpty) ...[
            _sectionTitle('그 밖의 지표'),
            _tileGrid(bodyRows),
          ],
          if (sections.activity.isNotEmpty) ...[
            _sectionTitle('활동'),
            _tileGrid(sections.activity),
          ],
          _sectionTitle('전송'),
          Card(
            child: ListTile(
              leading: Icon(
                pending == 0 ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined,
                color: pending == 0 ? VgColors.normal : VgColors.caution,
              ),
              title: Text(pending == 0 ? '전송 큐 비어 있음' : '전송 대기 $pending건',
                  style: const TextStyle(fontSize: 14, color: VgColors.ink)),
              subtitle: Text(baseURL,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: VgColors.muted)),
            ),
          ),
          // DB 누적 — 조회 실패는 값을 지어내지 않고 줄 자체를 생략한다.
          if (_own?.totalPersisted != null) ...[
            const SizedBox(height: 10),
            Card(
              child: ListTile(
                leading: const Icon(Icons.storage_outlined, color: VgColors.primary),
                title: Text('누적 ${formatCount(_own!.totalPersisted!)}건',
                    style: const TextStyle(fontSize: 14, color: VgColors.ink)),
                subtitle: const Text('서버에 영속된 내 생체 샘플',
                    style: TextStyle(fontSize: 12, color: VgColors.muted)),
              ),
            ),
          ],
          const SizedBox(height: 10),
          Card(
            child: ListTile(
              leading: const Icon(Icons.badge_outlined, color: VgColors.primary),
              title: Text('$name ($workerId)',
                  style: const TextStyle(fontSize: 14, color: VgColors.ink)),
              subtitle: const Text('업로드 파이프라인 가동 중 — 워치 수집분을 서버로 전송합니다',
                  style: TextStyle(fontSize: 12, color: VgColors.muted)),
            ),
          ),
        ],
      ),
    );
  }
}
