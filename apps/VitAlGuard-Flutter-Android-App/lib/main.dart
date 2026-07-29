import 'dart:async';

import 'package:flutter/material.dart';

import 'platform/companion_bridge.dart';
import 'vital_domain.dart';

const _bg = Color(0xFF080909);
const _panel = Color(0xFF2B2B2C);
const _panelDeep = Color(0xFF171717);
const _line = Color(0xFF5E5E60);
const _blue = Color(0xFF129EF1);
const _green = Color(0xFF00A866);
const _amber = Color(0xFFFFA400);
const _red = Color(0xFFFF3131);

void main() => runApp(const VitAlGuardApp());

class VitAlGuardApp extends StatelessWidget {
  const VitAlGuardApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'VitAlGuard',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: _bg,
      colorScheme: const ColorScheme.dark(primary: _blue, surface: _panel),
      useMaterial3: true,
    ),
    builder: (context, child) {
      final media = MediaQuery.of(context);
      return MediaQuery(
        data: media.copyWith(
          textScaler: media.textScaler.clamp(maxScaleFactor: 1.15),
        ),
        child: child ?? const SizedBox.shrink(),
      );
    },
    home: const VitAlGuardHome(),
  );
}

class VitAlGuardHome extends StatefulWidget {
  const VitAlGuardHome({super.key});
  @override
  State<VitAlGuardHome> createState() => _VitAlGuardHomeState();
}

class _VitAlGuardHomeState extends State<VitAlGuardHome> {
  final _bridge = CompanionBridge();
  final _detector = FallDetector();
  final _vitals = VitalSnapshot.demo();
  CompanionStatus _companion = const CompanionStatus.unsupported();
  var _tab = 0;
  var _alert = false;
  var _syncText = '관제웹 연결됨 · 대시보드 응답 정상';

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
  }

  Future<void> _refresh() async {
    final status = await _bridge.status();
    if (mounted) setState(() => _companion = status);
  }

  Future<void> _sync() async {
    final outcome = await _bridge.sync(
      WatchContext.worker(
        loginId: 'admin',
        employeeId: 'EMP-admin',
        intervalSeconds: 300,
      ),
    );
    if (!mounted) return;
    setState(() => _syncText = outcome.message);
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(outcome.message)));
    await _refresh();
  }

  void _simulateFall() {
    final start = DateTime.now();
    final samples = [
      MotionSample(at: start, totalG: .45, rotationRadS: 1.1),
      MotionSample(
        at: start.add(const Duration(milliseconds: 300)),
        totalG: 3.12,
        rotationRadS: 7.4,
      ),
      MotionSample(
        at: start.add(const Duration(milliseconds: 900)),
        totalG: 1.05,
        rotationRadS: .1,
      ),
      MotionSample(
        at: start.add(const Duration(milliseconds: 2200)),
        totalG: .98,
        rotationRadS: .05,
      ),
    ];
    for (final sample in samples) {
      if (_detector.ingest(sample)?.isFall ?? false) {
        setState(() => _alert = true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      _HomePage(vitals: _vitals, syncText: _syncText, onRefresh: _refresh),
      _WatchPage(
        vitals: _vitals,
        status: _companion,
        onSync: _sync,
        onSimulateFall: _simulateFall,
      ),
      const _CctvPage(),
      _HealthPage(vitals: _vitals),
      const _SettingsPage(),
    ];
    return Scaffold(
      extendBody: true,
      body: SafeArea(
        child: Stack(
          children: [
            pages[_tab],
            if (_alert)
              _FallAlert(onConfirm: () => setState(() => _alert = false)),
          ],
        ),
      ),
      bottomNavigationBar: _BottomBar(
        index: _tab,
        onChanged: (value) => setState(() => _tab = value),
      ),
    );
  }
}

class _HomePage extends StatelessWidget {
  const _HomePage({
    required this.vitals,
    required this.syncText,
    required this.onRefresh,
  });
  final VitalSnapshot vitals;
  final String syncText;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(14, 16, 14, 118),
    children: [
      const _IdentityCard(),
      const SizedBox(height: 12),
      _ConnectionCard(syncText: syncText, onRefresh: onRefresh),
      const SizedBox(height: 12),
      const _SignalCard(),
      const SizedBox(height: 12),
      const _WeatherCard(),
      const SizedBox(height: 12),
      _ProgressCard(vitals: vitals),
    ],
  );
}

class _IdentityCard extends StatelessWidget {
  const _IdentityCard();
  @override
  Widget build(BuildContext context) => _GlassCard(
    child: Column(
      children: [
        const Row(
          children: [
            _LogoMark(size: 62),
            SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'VitAlGuard 관리자',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  SizedBox(height: 4),
                  Text(
                    '작업자 생체 관제 · CCTV · 작업구역 기상 연결됨',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            _RoundAction(
              icon: Icons.chat_bubble_outline,
              selected: true,
              onTap: () => _openDetail(
                context,
                title: '관제 메시지',
                summary: '현장 관리자와의 최신 관제 메시지입니다.',
                items: const ['가스 감지 경보 2건 확인 필요', '지하 기계실 CCTV 낙상AI 분석 중'],
              ),
            ),
            const SizedBox(width: 9),
            _RoundAction(
              icon: Icons.calendar_month_outlined,
              onTap: () => _openDetail(
                context,
                title: '작업 일정',
                summary: '오늘의 작업 구역과 안전 점검 일정입니다.',
                items: const ['08:30 지하 기계실 순찰', '13:00 탱크 야드 가스 점검'],
              ),
            ),
            const SizedBox(width: 9),
            _RoundAction(
              icon: Icons.notifications_none,
              onTap: () => _openDetail(
                context,
                title: '알림 센터',
                summary: '확인이 필요한 안전 알림입니다.',
                items: const ['위치 권한 확인 대기', 'AED 단말 배터리 부족'],
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({required this.syncText, required this.onRefresh});
  final String syncText;
  final Future<void> Function() onRefresh;
  @override
  Widget build(BuildContext context) => _GlassCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: _TrafficPill(label: '관제웹 연결됨', color: _green),
            ),
            const _RoundAction(icon: Icons.watch_outlined),
            const SizedBox(width: 8),
            _RoundAction(
              icon: Icons.refresh,
              onTap: () => unawaited(onRefresh()),
            ),
          ],
        ),
        const SizedBox(height: 10),
        const Text(
          'admin',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
        ),
        const Text(
          '관리자 모드',
          style: TextStyle(
            color: Color(0xFF147BFF),
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 9),
        const _OutlineNotice(text: '로고를 누르면 문서 스캔·사진·비디오 촬영'),
        const SizedBox(height: 8),
        Text(
          syncText,
          style: const TextStyle(
            color: Colors.white60,
            fontSize: 11,
            height: 1.3,
          ),
        ),
      ],
    ),
  );
}

class _SignalCard extends StatelessWidget {
  const _SignalCard();
  @override
  Widget build(BuildContext context) => _GlassCard(
    child: Column(
      children: [
        const Wrap(
          spacing: 6,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              '현장 통합 안전 신호등',
              style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800),
            ),
            Text('종합', style: TextStyle(color: Colors.white70)),
            _SignalDots(active: _red),
            SizedBox(width: 5),
            Text(
              '위험',
              style: TextStyle(
                color: _red,
                fontSize: 17,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        const _SignalRow(
          icon: Icons.cloud_outlined,
          title: '현장 기상',
          detail: '현장 GPS 대기 · 작업자 GPS 수신 시 자동 평가',
          state: '대기',
          color: _amber,
        ),
        const _SignalRow(
          icon: Icons.group_outlined,
          title: '작업자',
          detail: '작업자 대기 · 작업자 등록 대기',
          state: '대기',
          color: _amber,
        ),
        const _SignalRow(
          icon: Icons.air,
          title: '가스 감지',
          detail: 'CO 52ppm · 탱크 야드 · 산소보안 방해',
          state: '위험',
          color: _red,
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: () => _openDetail(
              context,
              title: '통합 안전 신호 상세',
              summary: '각 신호는 관제 수집 시각과 작업 구역 기준으로 갱신됩니다.',
              items: const [
                '가스 감지: CO 52ppm, 탱크 야드, 즉시 확인 필요',
                'AED: 지하 주차장 B1 단말 배터리 부족, 2건',
                '작업자/GPS: 등록 및 위치 수신 대기',
              ],
            ),
            icon: const Icon(Icons.arrow_forward),
            label: const Text('상세 보기'),
          ),
        ),
        const _SignalRow(
          icon: Icons.medical_information_outlined,
          title: 'AED',
          detail: '단말 배터리 부족 · 지하 주차장 B1 · 2건',
          state: '위험',
          color: _red,
        ),
      ],
    ),
  );
}

class _WeatherCard extends StatelessWidget {
  const _WeatherCard();
  @override
  Widget build(BuildContext context) => _GlassCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            const Text(
              '작업 구역 기상',
              style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800),
            ),
            OutlinedButton(
              onPressed: () => _openDetail(
                context,
                title: '작업 구역 기상 갱신',
                summary: 'GPS를 확인한 뒤 현장 기준 기상과 작업 안전 판단을 갱신합니다.',
                items: const [
                  '현재 위치: 광주 북구 현장 A',
                  '위치 권한: 확인 대기',
                  '관제 기상 API: 다음 동기화 시 조회',
                ],
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white,
                side: const BorderSide(color: _line),
                shape: const StadiumBorder(),
              ),
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: 15, vertical: 9),
                child: Text(
                  '새로고침',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 30),
        const Wrap(
          spacing: 12,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.end,
          children: [
            Text(
              '--°C',
              style: TextStyle(fontSize: 60, fontWeight: FontWeight.w800),
            ),
            Text(
              '작업안전: 위치 확인 대기',
              style: TextStyle(
                color: _amber,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        const Text(
          '광주 북구 현장 A',
          style: TextStyle(fontSize: 18, color: Colors.white70),
        ),
        const SizedBox(height: 5),
        const Text(
          '새로고침을 누르면 관제 대시보드 기준 GPS 위치 날씨 정보를 불러옵니다.',
          style: TextStyle(color: Colors.white60),
        ),
        const SizedBox(height: 16),
        OutlinedButton(
          onPressed: () => _openDetail(
            context,
            title: '현장 기상 상세',
            summary: '외부 날씨 서비스로 이동하기 전에 관제 위치를 확인합니다.',
            items: const [
              '관측 위치: 광주 북구 현장 A',
              '안전 판정: 위치 확인 대기',
              '강풍·호우 특보: 관제 연동 시 표시',
            ],
          ),
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.white,
            side: const BorderSide(color: _line),
            shape: const StadiumBorder(),
          ),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 18, vertical: 8),
            child: Text(
              '네이버 날씨',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
            ),
          ),
        ),
      ],
    ),
  );
}

class _ProgressCard extends StatelessWidget {
  const _ProgressCard({required this.vitals});
  final VitalSnapshot vitals;
  @override
  Widget build(BuildContext context) => _GlassCard(
    color: _panelDeep,
    child: Column(
      children: [
        const _SegmentedLabels(),
        const SizedBox(height: 20),
        const _GradientProgress(
          label: '공정률',
          value: '65.1%',
          detail: '경과 128일 / 총 196일',
          right: '준공까지 D-69',
          colors: [
            Color(0xFFFF3D30),
            Color(0xFFFFC017),
            Color(0xFF00A85F),
            Color(0xFF123985),
          ],
        ),
        const SizedBox(height: 24),
        _GradientProgress(
          label: '무사고',
          value: '${vitals.steps ~/ 49}일',
          detail: '연속 무사고',
          right: '목표 200일까지 73일',
          colors: const [
            Color(0xFFFF4A36),
            Color(0xFFFFD913),
            Color(0xFF59D445),
            Color(0xFF0B542A),
          ],
        ),
      ],
    ),
  );
}

class _WatchPage extends StatelessWidget {
  const _WatchPage({
    required this.vitals,
    required this.status,
    required this.onSync,
    required this.onSimulateFall,
  });
  final VitalSnapshot vitals;
  final CompanionStatus status;
  final Future<void> Function() onSync;
  final VoidCallback onSimulateFall;
  @override
  Widget build(BuildContext context) => _SubPage(
    title: 'Watch',
    child: ListView(
      children: [
        _GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _LogoMark(size: 56),
                  const SizedBox(width: 13),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            status.reachable ? 'Watch 연결됨' : 'Watch 연결 대기',
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          status.detail,
                          style: const TextStyle(
                            color: Colors.white70,
                            height: 1.35,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: _RoundAction(icon: Icons.sync, onTap: onSync),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _GlassCard(
          child: Wrap(
            spacing: 16,
            runSpacing: 16,
            children: [
              _WatchMetric(
                icon: Icons.favorite,
                label: '심박',
                value: '${vitals.heartRate}',
                unit: 'bpm',
                color: _red,
              ),
              _WatchMetric(
                icon: Icons.air,
                label: '산소포화도',
                value: '${vitals.spo2}',
                unit: '%',
                color: _blue,
              ),
              _WatchMetric(
                icon: Icons.directions_walk,
                label: '걸음',
                value: '${vitals.steps}',
                unit: '걸음',
                color: _green,
              ),
              _WatchMetric(
                icon: Icons.battery_6_bar,
                label: '배터리',
                value: '${vitals.batteryPct}',
                unit: '%',
                color: Colors.white70,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: onSimulateFall,
          icon: const Icon(Icons.warning_amber),
          label: const Text('낙상 감지 흐름 시연'),
        ),
      ],
    ),
  );
}

class _CctvPage extends StatelessWidget {
  const _CctvPage();
  @override
  Widget build(BuildContext context) => _SubPage(
    title: 'CCTV',
    child: ListView(
      children: [
        _CctvTile(
          name: '지하 기계실',
          code: 'CAM-02 · GoPro EDGE · 낙상AI',
          state: '낙상AI',
          color: _red,
          onTap: () => _openDetail(
            context,
            title: '지하 기계실 CCTV',
            summary: 'CAM-02의 낙상AI 이벤트와 실시간 관제 상태입니다.',
            items: const [
              '영상 상태: 수신 중',
              '낙상AI: 후보 이벤트 1건',
              '다음 단계: 관제 확인 후 담당자 호출',
            ],
          ),
        ),
        const SizedBox(height: 12),
        _CctvTile(
          name: '탱크 야드',
          code: 'CAM-04 · 가스 감지 연계',
          state: 'LIVE',
          color: _green,
          onTap: () => _openDetail(
            context,
            title: '탱크 야드 CCTV',
            summary: 'CAM-04의 가스 감지 연계 상태입니다.',
            items: const ['영상 상태: LIVE', '가스 센서: CO 52ppm', '다음 단계: 안전 담당자 확인'],
          ),
        ),
        const SizedBox(height: 12),
        _CctvTile(
          name: '본관 출입구',
          code: 'CAM-07 · 작업자 PPE',
          state: 'PPE',
          color: _blue,
          onTap: () => _openDetail(
            context,
            title: '본관 출입구 CCTV',
            summary: 'CAM-07의 작업자 PPE 확인 상태입니다.',
            items: const ['영상 상태: 수신 중', 'PPE 분석: 확인 대기', '다음 단계: 출입 기록과 연결'],
          ),
        ),
      ],
    ),
  );
}

class _HealthPage extends StatelessWidget {
  const _HealthPage({required this.vitals});
  final VitalSnapshot vitals;
  @override
  Widget build(BuildContext context) => _SubPage(
    title: 'Health',
    child: ListView(
      children: [
        _GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '작업자 건강 현황',
                style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 14),
              _HealthLine(
                label: '심박',
                value: '${vitals.heartRate} bpm',
                color: _red,
              ),
              _HealthLine(
                label: '산소포화도',
                value: '${vitals.spo2}%',
                color: _blue,
              ),
              _HealthLine(
                label: '걸음',
                value: '${vitals.steps}걸음',
                color: _green,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        const _GlassCard(
          child: Text(
            '실제 의료·건강 데이터는 시계의 사용자 권한을 받은 값만 표시하고, 진단 용도로 사용하지 않습니다.',
            style: TextStyle(color: Colors.white70),
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => _openDetail(
            context,
            title: '건강 신호 상세',
            summary: 'Watch가 사용자 동의를 받아 전송한 건강 신호의 최근 상태입니다.',
            items: [
              '심박: ${vitals.heartRate} bpm',
              '산소포화도: ${vitals.spo2}%',
              '활동량: ${vitals.steps}걸음',
              '의료 진단 목적이 아닌 안전 보조 정보',
            ],
          ),
          icon: const Icon(Icons.arrow_forward),
          label: const Text('건강 신호 상세 보기'),
        ),
      ],
    ),
  );
}

class _SettingsPage extends StatelessWidget {
  const _SettingsPage();
  @override
  Widget build(BuildContext context) => _SubPage(
    title: '설정',
    child: ListView(
      children: [
        _SettingsRow(
          icon: Icons.person_outline,
          title: '계정 및 작업자',
          detail: 'admin · 관리자 모드',
          onTap: () => _openDetail(
            context,
            title: '계정 및 작업자',
            summary: '현장 계정과 작업자 권한을 확인합니다.',
            items: const ['로그인 계정: admin', '역할: 관리자', '작업자 식별자: EMP-admin'],
          ),
        ),
        _SettingsRow(
          icon: Icons.location_on_outlined,
          title: 'GPS 및 위치 권한',
          detail: '작업 위치 기상과 안전 상태 갱신',
          onTap: () => _openDetail(
            context,
            title: 'GPS 및 위치 권한',
            summary: '현장 기상과 위치 기반 안전 신호를 위한 설정입니다.',
            items: const [
              '현재 상태: 확인 대기',
              '사용 목적: 작업 구역 기상·안전 신호',
              '권한 변경은 기기 설정에서 가능',
            ],
          ),
        ),
        _SettingsRow(
          icon: Icons.watch_outlined,
          title: 'Watch 동기화 주기',
          detail: '300초 · 실측 데이터만 전송',
          onTap: () => _openDetail(
            context,
            title: 'Watch 동기화 주기',
            summary: 'Apple Watch 및 Wear OS의 안전 신호 동기화 설정입니다.',
            items: const [
              '동기화 주기: 300초',
              '전송 범위: 권한을 받은 실측 데이터',
              '낙상 후보: 사용자 확인 후 관제 전송',
            ],
          ),
        ),
        _SettingsRow(
          icon: Icons.cloud_outlined,
          title: '관제 대시보드',
          detail: '연결 상태 및 API 주소 설정',
          onTap: () => _openDetail(
            context,
            title: '관제 대시보드',
            summary: '안전 신호와 CCTV 상태를 관제 웹으로 전달하는 연결입니다.',
            items: const [
              '상태: 연결됨',
              '데이터: 안전 신호·Watch 문맥',
              '인증 정보는 기기 보안 저장소에서 관리',
            ],
          ),
        ),
      ],
    ),
  );
}

class _SubPage extends StatelessWidget {
  const _SubPage({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(14, 16, 14, 118),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 31, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 14),
          Expanded(child: child),
        ],
      ),
    ),
  );
}

class _BottomBar extends StatelessWidget {
  const _BottomBar({required this.index, required this.onChanged});
  final int index;
  final ValueChanged<int> onChanged;
  static const _items = [
    (Icons.home_outlined, Icons.home, '홈'),
    (Icons.watch_outlined, Icons.watch, 'Watch'),
    (Icons.videocam_outlined, Icons.videocam, 'CCTV'),
    (Icons.medical_information_outlined, Icons.medical_information, 'Health'),
    (Icons.settings_outlined, Icons.settings, '설정'),
  ];
  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(10, 5, 10, 10),
      child: Container(
        decoration: BoxDecoration(
          color: _panelDeep,
          border: Border.all(color: _line, width: 2),
          borderRadius: BorderRadius.circular(44),
        ),
        child: Row(
          children: List.generate(_items.length, (i) {
            final item = _items[i];
            final selected = i == index;
            return Expanded(
              child: InkWell(
                onTap: () => onChanged(i),
                borderRadius: BorderRadius.circular(40),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(9),
                        decoration: BoxDecoration(
                          color: selected
                              ? _blue.withValues(alpha: .38)
                              : Colors.transparent,
                          shape: BoxShape.circle,
                          boxShadow: selected
                              ? [
                                  BoxShadow(
                                    color: _blue.withValues(alpha: .75),
                                    blurRadius: 17,
                                  ),
                                ]
                              : null,
                        ),
                        child: Icon(
                          selected ? item.$2 : item.$1,
                          color: selected ? _blue : Colors.white,
                          size: 29,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.$3,
                        style: TextStyle(
                          color: selected ? _blue : Colors.white,
                          fontWeight: selected
                              ? FontWeight.w700
                              : FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    ),
  );
}

class _GlassCard extends StatelessWidget {
  const _GlassCard({required this.child, this.color});
  final Widget child;
  final Color? color;
  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: color ?? _panel,
      border: Border.all(color: _line),
      borderRadius: BorderRadius.circular(34),
    ),
    padding: const EdgeInsets.all(18),
    child: child,
  );
}

class _LogoMark extends StatelessWidget {
  const _LogoMark({required this.size});
  final double size;
  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: const Color(0xFF171B1D),
      borderRadius: BorderRadius.circular(size * .27),
    ),
    child: const Icon(
      Icons.health_and_safety_outlined,
      color: Colors.white,
      size: 38,
    ),
  );
}

class _RoundAction extends StatelessWidget {
  const _RoundAction({required this.icon, this.selected = false, this.onTap});
  final IconData icon;
  final bool selected;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(30),
    child: Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: selected ? const Color(0xFF164462) : const Color(0xFF49494A),
        border: Border.all(
          color: selected ? _blue : const Color(0xFF666669),
          width: 1.5,
        ),
      ),
      child: Icon(icon, color: Colors.white, size: 25),
    ),
  );
}

class _TrafficPill extends StatelessWidget {
  const _TrafficPill({required this.label, required this.color});
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(
      border: Border.all(color: color, width: 2),
      borderRadius: BorderRadius.circular(26),
    ),
    child: Row(
      children: [
        const _SignalDots(active: _green),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            label,
            style: TextStyle(color: color, fontWeight: FontWeight.w800),
          ),
        ),
      ],
    ),
  );
}

class _SignalDots extends StatelessWidget {
  const _SignalDots({required this.active});
  final Color active;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      for (final color in [_green, _amber, _red])
        Padding(
          padding: const EdgeInsets.only(right: 4),
          child: CircleAvatar(
            radius: 7,
            backgroundColor: color == active
                ? color
                : color.withValues(alpha: .32),
          ),
        ),
    ],
  );
}

class _OutlineNotice extends StatelessWidget {
  const _OutlineNotice({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    decoration: BoxDecoration(
      border: Border.all(color: const Color(0xFFFF2F98), width: 2),
      borderRadius: BorderRadius.circular(22),
    ),
    child: Row(
      children: [
        const Icon(
          Icons.center_focus_strong,
          color: Color(0xFFFF2F98),
          size: 17,
        ),
        const SizedBox(width: 7),
        Expanded(
          child: Text(
            text,
            maxLines: 2,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
}

class _SignalRow extends StatelessWidget {
  const _SignalRow({
    required this.icon,
    required this.title,
    required this.detail,
    required this.state,
    required this.color,
  });
  final IconData icon;
  final String title, detail, state;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 6),
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
    decoration: BoxDecoration(
      color: const Color(0xFF373738),
      border: Border.all(color: const Color(0xFF4B4B4C)),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Row(
      children: [
        Icon(icon, color: Colors.white70, size: 23),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 6,
                runSpacing: 3,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  _SignalDots(active: color),
                  Text(
                    state,
                    style: TextStyle(color: color, fontWeight: FontWeight.w800),
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                detail,
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 12,
                  height: 1.25,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _SegmentedLabels extends StatelessWidget {
  const _SegmentedLabels();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(5),
    decoration: BoxDecoration(
      border: Border.all(color: _line, width: 2),
      borderRadius: BorderRadius.circular(30),
    ),
    child: const Row(
      children: [
        Expanded(child: _Segment(label: '현황 요약', selected: true)),
        Expanded(child: _Segment(label: '실시간 레이더')),
        Expanded(child: _Segment(label: '태풍 진로')),
        Expanded(child: _Segment(label: '특보 영상')),
      ],
    ),
  );
}

class _Segment extends StatelessWidget {
  const _Segment({required this.label, this.selected = false});
  final String label;
  final bool selected;
  @override
  Widget build(BuildContext context) => Container(
    alignment: Alignment.center,
    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
    decoration: BoxDecoration(
      color: selected ? _blue : Colors.transparent,
      borderRadius: BorderRadius.circular(23),
    ),
    child: FittedBox(
      fit: BoxFit.scaleDown,
      child: Text(
        label,
        style: TextStyle(
          fontWeight: FontWeight.w700,
          fontSize: 12,
          color: selected ? Colors.white : Colors.white70,
        ),
      ),
    ),
  );
}

class _GradientProgress extends StatelessWidget {
  const _GradientProgress({
    required this.label,
    required this.value,
    required this.detail,
    required this.right,
    required this.colors,
  });
  final String label, value, detail, right;
  final List<Color> colors;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Wrap(
        spacing: 8,
        runSpacing: 2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          ),
          Text(
            value,
            style: const TextStyle(fontSize: 29, fontWeight: FontWeight.w800),
          ),
          Text(
            detail,
            style: const TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
      const SizedBox(height: 7),
      Stack(
        alignment: Alignment.centerRight,
        children: [
          Container(
            height: 27,
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: colors),
              borderRadius: BorderRadius.circular(20),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 11),
            child: Text(
              right,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    ],
  );
}

class _WatchMetric extends StatelessWidget {
  const _WatchMetric({
    required this.icon,
    required this.label,
    required this.value,
    required this.unit,
    required this.color,
  });
  final IconData icon;
  final String label, value, unit;
  final Color color;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 132,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: color),
        const SizedBox(height: 7),
        Text(label, style: const TextStyle(color: Colors.white70)),
        Wrap(
          spacing: 4,
          runSpacing: 1,
          crossAxisAlignment: WrapCrossAlignment.end,
          children: [
            Text(
              value,
              style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w800),
            ),
            Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 5),
              child: Text(unit, style: const TextStyle(color: Colors.white70)),
            ),
          ],
        ),
      ],
    ),
  );
}

class _CctvTile extends StatelessWidget {
  const _CctvTile({
    required this.name,
    required this.code,
    required this.state,
    required this.color,
    this.onTap,
  });
  final String name, code, state;
  final Color color;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(34),
    child: _GlassCard(
      child: Row(
        children: [
          Container(
            width: 84,
            height: 66,
            decoration: BoxDecoration(
              color: Colors.black,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.videocam, color: Colors.white54, size: 35),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(code, style: const TextStyle(color: Colors.white70)),
              ],
            ),
          ),
          Text(
            state,
            style: TextStyle(color: color, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    ),
  );
}

class _HealthLine extends StatelessWidget {
  const _HealthLine({
    required this.label,
    required this.value,
    required this.color,
  });
  final String label, value;
  final Color color;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Row(
      children: [
        CircleAvatar(radius: 6, backgroundColor: color),
        const SizedBox(width: 10),
        Text(label),
        const Spacer(),
        Text(
          value,
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
        ),
      ],
    ),
  );
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.icon,
    required this.title,
    required this.detail,
    this.onTap,
  });
  final IconData icon;
  final String title, detail;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 11),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(34),
      child: _GlassCard(
        child: Row(
          children: [
            Icon(icon, color: _blue),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 17,
                    ),
                  ),
                  Text(detail, style: const TextStyle(color: Colors.white70)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: Colors.white54),
          ],
        ),
      ),
    ),
  );
}

void _openDetail(
  BuildContext context, {
  required String title,
  required String summary,
  required List<String> items,
}) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => _DetailPage(title: title, summary: summary, items: items),
    ),
  );
}

class _DetailPage extends StatelessWidget {
  const _DetailPage({
    required this.title,
    required this.summary,
    required this.items,
  });
  final String title;
  final String summary;
  final List<String> items;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: _bg,
    appBar: AppBar(
      backgroundColor: _bg,
      foregroundColor: Colors.white,
      elevation: 0,
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
    ),
    body: SafeArea(
      top: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 28),
        children: [
          _GlassCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    _LogoMark(size: 46),
                    SizedBox(width: 10),
                    Text(
                      'VitAlGuard',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(
                  summary,
                  style: const TextStyle(color: Colors.white70, height: 1.4),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          ...items.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _GlassCard(
                color: _panelDeep,
                child: Row(
                  children: [
                    const Icon(Icons.check_circle_outline, color: _blue),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Text(
                        item,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    const Icon(Icons.chevron_right, color: Colors.white54),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class _FallAlert extends StatelessWidget {
  const _FallAlert({required this.onConfirm});
  final VoidCallback onConfirm;
  @override
  Widget build(BuildContext context) => Positioned.fill(
    child: ColoredBox(
      color: Colors.black87,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _GlassCard(
            color: const Color(0xFF262020),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.emergency, color: _red, size: 46),
                const SizedBox(height: 10),
                const Text(
                  '낙상 후보 감지',
                  style: TextStyle(fontSize: 23, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                const Text(
                  '자유낙하·충격·정지 신호가 확인되었습니다. 사용자 확인 뒤에만 관제 경보를 보냅니다.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: onConfirm,
                  style: FilledButton.styleFrom(backgroundColor: _red),
                  child: const Text('사용자 확인 완료'),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
