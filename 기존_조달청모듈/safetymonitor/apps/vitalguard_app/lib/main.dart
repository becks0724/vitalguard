// 관제웹 계정 로그인·업로드 상태 표시 UI — 생체 데이터 경로는 네이티브 전담이라 Dart 를 경유하지 않는다
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'glass_tab_bar.dart';
import 'heart_rate_trend.dart';
import 'own_vitals.dart';
import 'record_screen.dart';
import 'settings_screen.dart';
import 'theme.dart';
import 'vital_card.dart';
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
                const Text(
                  'VitAlGuard',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                // 관제웹 로그인과 동일한 브랜드·문구 — 작업자가 같은 로그인임을 바로 알게 한다.
                const Text(
                  'OPEN SAFETY · NEVER ALONE',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: VgColors.muted,
                    fontSize: 12,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 20),
                const Text(
                  '로그인',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                const Text(
                  '관제웹과 같은 ID·비밀번호를 사용합니다',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: VgColors.body),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _idController,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'ID',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _pwController,
                  obscureText: true,
                  onSubmitted: (_) => _busy ? null : _login(),
                  decoration: const InputDecoration(
                    labelText: '비밀번호',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: VgColors.danger)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _login,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
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
  final _hrHistory = HeartRateHistory();
  int? _livePending;
  bool _authRejected = false;

  /// 하단 탭. 0 = 요약(현 화면). 나머지 둘은 **아직 만들지 않았고 화면에 그렇게 적는다**.
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
    _refreshOwn();
    _ownTimer = Timer.periodic(
      const Duration(seconds: 60),
      (_) => _refreshOwn(),
    );
    _subscribe();
  }

  /// EventChannel 구독. **끊기면 다시 붙는다.**
  ///
  /// ★ 2026-08-20 실측 — 종전에는 `onError`·`onDone` 이 없어 스트림이 한 번 끊기면
  ///   화면이 마지막 값에 영영 얼어붙었다. 네이티브는 계속 수집·업로드하므로
  ///   **서버에서는 아무 이상이 안 보인다**(서버 12건/분 · 화면 19분 전). 하루에 두 번 났다.
  void _subscribe() {
    try {
      _sub?.cancel();
      _sub = VitalStream.events().listen(
        (e) {
          if (!mounted) return;
          setState(() {
            if (e.type == 'hr') {
              _vitals = e;
              _recordHeartRate(e);
            }
            if (e.pending != null) _livePending = e.pending;
            if (e.authRejected == true) _authRejected = true;
            if (e.uploadOk == true) _authRejected = false;
          });
        },
        // 재구독은 한 박자 쉬고 한다 — 즉시 다시 붙으면 실패가 반복될 때 폭주한다.
        onError: (_) => _scheduleResubscribe(),
        onDone: _scheduleResubscribe,
        cancelOnError: true,
      );
    } catch (_) {
      // 브리지 부재(테스트 등)면 폴링 표시만 유지한다.
    }
  }

  void _scheduleResubscribe() {
    if (!mounted) return;
    Future<void>.delayed(const Duration(seconds: 3), () {
      if (mounted) _subscribe();
    });
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
    // ★ 스트림과 **같은 값을 다른 경로로** 한 번 더 가져온다. 스트림이 살아 있으면 같은 값이라
    //   화면이 안 흔들리고, 죽어 있으면 이 경로가 3초 안에 화면을 되살린다.
    //   즉시성은 스트림이, 정확성은 이 폴링이 맡는다.
    try {
      final snap = await _bridge.invokeMapMethod<String, dynamic>(
        'vitalsSnapshot',
      );
      if (mounted && snap != null && snap['type'] == 'hr') {
        final event = VitalStreamEvent.fromMap(snap);
        setState(() {
          _vitals = event;
          _recordHeartRate(event);
        });
      }
    } catch (_) {
      // 브리지 부재(테스트 등) — 스트림 값만 유지한다.
    }
    try {
      final status = await _bridge.invokeMapMethod<String, dynamic>('status');
      if (mounted && status != null) setState(() => _status = status);
    } catch (_) {
      // 브리지 부재(테스트 등)면 표시만 유지한다.
    }
  }

  /// 설정 화면 — 전송 상태·계정. 열 때의 값을 넘기고, 그 뒤 갱신은 설정 화면이 스스로 한다.
  void _openSettings() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SettingsScreen(
          bridge: _bridge,
          status: _status,
          pending: _livePending ?? _status['pending'] as int? ?? 0,
          totalPersisted: _own?.totalPersisted,
        ),
      ),
    );
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

  /// 심박 이력에 한 점 넣는다. 스트림과 폴링이 **같은 값**을 주므로 같은 측정 시각은
  /// 버퍼가 거른다 — 안 거르면 한 측정이 두 번 세어져 평균이 그쪽으로 끌린다.
  void _recordHeartRate(VitalStreamEvent e) {
    final bpm = e.bpm;
    final at = e.measuredAt;
    if (bpm == null || at == null) return;
    _hrHistory.add(bpm, at);
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

  /// ★ 활동 에너지(kcal)는 **일부러 없다.** 상시 `HKWorkoutSession` 때문에 애플이 하루 종일을
  /// 운동으로 계산해 정지 상태에서도 288kcal/시간이 찍힌다(2026-08-15 실측 · 약 4배 과대).
  /// 네이티브가 Dart 로 아예 안 싣고 가드 2개가 되살아나는 것을 막는다
  /// (`vital_display_test.dart` · `heat-activity-axis` 트랙이 축을 바로잡으면 그때 연다).
  /// 조용히 빼면 다음 사람이 "빠뜨렸네" 하고 채워 넣으므로 화면에도 사유를 적는다.
  /// 값을 안 그리는 항목의 사유 한 줄. **빈 자리로 두지 않는다** — 빈 칸은 "아직 안 만들었다"
  /// 나 "고장" 으로 읽히고, 이 앱은 같은 자리(활동 에너지)에서 이미 사유를 적는 쪽을 택했다.
  Widget _heldRow(IconData icon, String label, String why) => Row(
    children: [
      Icon(icon, size: 13, color: VgColors.muted),
      const SizedBox(width: 5),
      Text(label, style: const TextStyle(fontSize: 11, color: VgColors.body)),
      const Spacer(),
      Flexible(
        child: Text(
          why,
          textAlign: TextAlign.right,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 10, color: VgColors.muted),
        ),
      ),
    ],
  );

  /// 참고 디자인(Health Monitor)의 카드 격자 — 심박 카드 아래 생체 전부를 **한 섹션**에 담는다.
  ///
  /// 2026-08-19 에 세 박스(주요 생체·그 밖의 지표·활동)를 하나로 합친 결정을 그대로 잇는다.
  /// 바뀐 것은 칸의 모양뿐이고 섹션은 여전히 하나다 — 종전의 바깥 카드는 참고 디자인처럼
  /// 칸마다 카드를 두면서 없앴다(카드 안의 카드는 면이 두 겹이 된다).
  ///
  /// ⚠ 활동 누계(걸음·정지 지속)는 생체 값이 아니라 **움직임 누계**라 뒤로 몰아 둔다
  ///   (`activityLabels` 주석). 섞으면 "걸음 1,204보" 가 산소포화도 옆에서 같은 성격으로 읽힌다.
  ///
  /// ★ 막대가 붙는 칸은 산소포화도 하나뿐이다 — 근거 있는 임계가 심박·SpO₂ 뿐이고 심박은
  ///   위 히어로 카드가 가져갔다. 나머지에 막대를 그리면 없던 기준이 생긴다(`vital_card.dart`).
  Widget _healthMonitor(List<VitalRow> rows) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(left: 2, bottom: 6),
          child: Text(
            '주요 생체',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: VgColors.ink,
            ),
          ),
        ),
        VitalCardGrid(rows: rows),
        const SizedBox(height: 6),
        const Divider(height: 1, color: VgColors.hairline),
        const SizedBox(height: 6),
        // 빼놓은 것을 화면에도 적는다 — 빈 자리는 "아직 안 만들었다" 로 읽힌다.
        _heldRow(
          Icons.local_fire_department_outlined,
          '활동 에너지',
          '보류 — 측정축 정리 중',
        ),
        const SizedBox(height: 4),
        _heldRow(Icons.stairs_outlined, '오른 층', '수집만 — 기기가 층을 거의 안 센다'),
      ],
    );
  }

  /// 심박 히어로 — 참고 디자인(사용자 제공)의 배치를 옮긴 것.
  /// 큰 현재값 + 상태 배지 + 추이 그래프 + 평균/최소/최대. 그래프와 3분할 요약은
  /// 폰이 실제로 받은 심박만 읽는다(`_hrHistory`).
  ///
  /// ★ 종전의 링(StatusRing)은 이 카드에서 뺐다 — 같은 값을 링과 큰 숫자가 두 번
  ///   말하게 된다. 이 앱은 2026-08-18 실기기 확인에서 같은 이유로 3열 밴드 행을
  ///   이미 한 번 지운 적이 있다.
  Widget _heartRateCard(VitalStreamEvent? vitals) {
    final receiving = vitals?.bpm != null;
    return HeartRateHeroCard(
      bpm: vitals?.bpm,
      history: _hrHistory.samples,
      footnote: receiving
          ? '측정 ${_measuredAgoText()} · 배치 #${vitals?.seq ?? '-'}'
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final pending = _livePending ?? _status['pending'] as int? ?? 0;
    final vitals = _vitals;
    // 워치가 보낸 것 + 서버가 계산한 것을 한 격자에 둔다. 둘 다 "지금 이 사람의 몸" 이라
    // 성격이 같고, 출처가 다르다고 나누면 같은 걸 두 번 찾게 된다(활동 누계와는 다르다).
    // 순서·고정 칸·중복 제거는 전부 `buildHealthMonitorRows` 한 곳에 있다.
    final rows = buildHealthMonitorRows(vitals: vitals, own: _own);

    return Scaffold(
      appBar: AppBar(
        // 글자 대신 로고 락업. 높이만 고정하고 너비는 비율에 맡긴다 — 폭을 고정하면
        // 기기 폭이 좁을 때 로고가 눌린다.
        title: Image.asset(
          'assets/vitalguard_wordmark.png',
          height: 26,
          fit: BoxFit.contain,
          // 이미지가 못 뜨면 화면이 비는 대신 글자로 돌아간다 — 앱 이름이 사라지지 않게.
          errorBuilder: (_, _, _) => const Text(
            'VitAlGuard',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          semanticLabel: 'VitAlGuard',
        ),
        actions: [
          // ★ 큐가 밀리면 톱니에 점을 찍는다 — 전송 상태를 설정 안으로 옮기면서
          //   "밀리고 있다" 는 신호까지 함께 숨기지 않기 위한 것이다(평시엔 아무 표시 없음).
          IconButton(
            onPressed: _openSettings,
            tooltip: '설정',
            icon: pending > 0
                ? const Badge(
                    smallSize: 8,
                    backgroundColor: VgColors.caution,
                    child: Icon(Icons.settings_outlined),
                  )
                : const Icon(Icons.settings_outlined),
          ),
          IconButton(
            onPressed: _logout,
            tooltip: '로그아웃',
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      // ★ 본문이 유리 바 **아래로 지나가야** 블러가 보인다. 대신 마지막 카드가 가리므로
      //   하단 여백에 `glassTabBarInset` 을 더한다(안 더하면 그 값은 없는 것과 같다).
      extendBody: true,
      body: switch (_tab) {
        0 => _summaryBody(vitals, rows),
        1 => const RecordScreen(),
        _ => _notBuiltYet(Icons.grid_view, '둘러보기', '담을 내용을 정하는 중입니다.'),
      },
      bottomNavigationBar: GlassTabBar(
        tabs: _tabs,
        currentIndex: _tab,
        onTap: (i) => setState(() => _tab = i),
      ),
    );
  }

  /// 요약 탭 — 이 앱이 지금 실제로 가진 화면 전부다.
  /// 당겨서 새로고침 — 세 경로를 **한 번에** 다시 묻는다.
  ///
  /// ★ 자동 갱신이 멈춘 것 같을 때 사람이 확인할 수단이 없었다(2026-08-20 요청).
  ///   스트림이 죽어 있으면 여기서 재구독까지 걸어 **다음부터는 자동으로도 온다**.
  Future<void> _pullToRefresh() async {
    _subscribe();
    await Future.wait([_refresh(), _refreshOwn()]);
  }

  Widget _summaryBody(VitalStreamEvent? vitals, List<VitalRow> rows) {
    // 카드가 늘 수 있어 ListView — 화면 밖으로 밀리면 그 값은 없는 것과 같다.
    return RefreshIndicator(
      onRefresh: _pullToRefresh,
      child: ListView(
        // 짧은 화면에서도 당길 수 있어야 한다 — 내용이 안 넘치면 ListView 는 스크롤을 막는다.
        physics: const AlwaysScrollableScrollPhysics(),
        // 하단 여백은 유리 바를 피할 만큼만 둔다(종전 28 → 8) — 남는 20pt 는 생체 칸으로 간다.
        // 한 화면에 다 보이게 하려고 줄인 것이고, 바에 가리는지는 `glass_tab_bar_test` 가 잡는다.
        padding: EdgeInsets.fromLTRB(16, 8, 16, 8 + glassTabBarInset(context)),
        children: [
          if (_authRejected)
            MaterialBanner(
              backgroundColor: VgColors.danger.withValues(alpha: 0.08),
              content: const Text('서버가 인증을 거부했습니다. 다시 로그인해 주세요.'),
              actions: [
                TextButton(onPressed: _logout, child: const Text('재로그인')),
              ],
            ),
          _heartRateCard(vitals),
          const SizedBox(height: 8),
          // 값이 안 온 칸도 자리를 지킨다 — 항목까지 사라지면 그것을 재고 있는지조차 안 보인다.
          _healthMonitor(rows),
        ],
      ),
    );
  }

  /// 아직 안 만든 탭. **빈 화면으로 두지 않는다** — 빈 자리는 "고장" 이나 "빠뜨림" 으로
  /// 읽히고, 이 앱은 같은 자리(활동 에너지)에서 이미 사유를 적는 쪽을 택했다.
  Widget _notBuiltYet(IconData icon, String title, String why) {
    return Center(
      child: Padding(
        padding: EdgeInsets.fromLTRB(32, 0, 32, glassTabBarInset(context)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 34, color: VgColors.muted),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: VgColors.ink,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              '준비 중',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: VgColors.caution,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              why,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: VgColors.body),
            ),
          ],
        ),
      ),
    );
  }
}

/// 하단 탭 3종. **늘어날 수 있다** — 바는 개수를 세지 않고 이 목록을 그대로 그린다.
const List<GlassTab> _tabs = [
  (Icons.favorite, '요약'),
  (Icons.photo_camera_outlined, 'OCR'),
  (Icons.grid_view, '둘러보기'),
];
