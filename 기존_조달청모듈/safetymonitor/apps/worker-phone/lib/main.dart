// 작업자 폰 메인 — Health 폴링·게이트웨이 전송·설정 (이름·사원번호) 관리 진입점
import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models/vital_sample.dart';
import 'services/background_keepalive.dart';
import 'services/health_vitals_service.dart';
import 'services/vital_publisher.dart';
import 'theme/app_tokens.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const WorkerPhoneApp());
}

class WorkerPhoneApp extends StatelessWidget {
  const WorkerPhoneApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SafetyMonitor 작업자',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppTokens.accentDeep,
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: AppTokens.bgTop,
        useMaterial3: true,
      ),
      home: const WorkerHomePage(),
    );
  }
}

class WorkerHomePage extends StatefulWidget {
  const WorkerHomePage({super.key});

  @override
  State<WorkerHomePage> createState() => _WorkerHomePageState();
}

class _WorkerHomePageState extends State<WorkerHomePage>
    with WidgetsBindingObserver {
  static const _workerId = String.fromEnvironment(
    'WORKER_ID',
    defaultValue: 'demo_ios_01',
  );
  static const _mockReceiverUrl = String.fromEnvironment(
    'MOCK_RECEIVER_URL',
    defaultValue: '',
  );
  static const _storageKeyReceiverUrl = 'mock_receiver_url';
  static const _storageKeyWorkerName = 'worker_name';
  static const _storageKeyEmployeeId = 'employee_id';
  static const _storageKeyJobTitle = 'job_title';
  static const _storageKeyGuardianName = 'guardian_name';
  static const _storageKeyGuardianPhone = 'guardian_phone';
  // 자동 재개 플래그 — _startPolling 성공 시 'true', _stopPolling 시 'false'.
  // 앱 강제 종료 후 재시작 또는 폰 재부팅 시 initState 에서 읽어 자동 시작.
  static const _storageKeyAutoPolling = 'auto_polling';
  // 스트레스 입력 sub-cadence — 5초 폴링 N회마다 1회 수집 (12 → 60초 간격)
  static const _stressEveryNPolls = 12;

  final _healthVitals = HealthVitalsService();
  final _storage = const FlutterSecureStorage();
  final _keepalive = BackgroundKeepalive();
  late final VitalPublisher _publisher;
  final _connectivity = Connectivity();

  Timer? _timer;
  StreamSubscription<List<ConnectivityResult>>? _connSub;
  // 마지막 알려진 네트워크 상태 — offline → online 전이 감지용
  bool _online = true;
  VitalSample? _latest;
  // 5초 폴링 카운터 — _stressEveryNPolls 간격으로 스트레스 입력 수집 트리거
  int _pollTick = 0;
  // 마지막 전송 시각 — 위치 콜백 이중화 전송의 throttle 기준
  DateTime _lastPollTs = DateTime.fromMillisecondsSinceEpoch(0);
  String _connectionStatus = '대기';
  String _keepaliveStatus = '대기';
  bool _healthAuthorized = false;
  bool _polling = false;
  // SOS 전송 상태 — 전송 중/최종 실패 시 액션바 SOS 버튼에 표시(AF3).
  bool _sosSending = false;
  bool _sosFailed = false;
  String? _receiverUrl;
  String? _workerName;
  String? _employeeId;
  String? _jobTitle;
  String? _guardianName;
  String? _guardianPhone;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _publisher = VitalPublisher(
      workerId: _workerId,
      storage: _storage,
    );
    _initConnectivityWatch();
    // URL/프로파일 로딩을 순서대로 await 한 뒤 자동 시작 — _tryAutoStart 가
    // _receiverUrl 로드(_loadReceiverUrl) 완료 전에 실행돼 자동 시작이 누락되는 것 방지
    unawaited(_initAndAutoStart());
  }

  // 앱 lifecycle — 백그라운드에서 OS 가 Timer 를 정지시켰을 가능성 대비.
  // resumed (포그라운드 복귀) 시 polling 상태인데 Timer 가 죽어 있으면 즉시 재가동.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    if (!_polling) return;
    final isAlive = _timer?.isActive ?? false;
    if (!isAlive) {
      debugPrint('[auto-reconnect] resume + dead timer → restart');
      _timer = Timer.periodic(const Duration(seconds: 5), (_) => _pollOnce());
      // 5초 기다리지 않고 즉시 1회 트리거
      unawaited(_pollOnce());
    }
  }

  // 네트워크 변화 감시 — 오프라인 → 온라인 전이 시 즉시 _pollOnce 트리거 (자연 5초 대기 회피).
  Future<void> _initConnectivityWatch() async {
    try {
      final current = await _connectivity.checkConnectivity();
      _online = _isOnline(current);
    } catch (error) {
      debugPrint('[auto-reconnect] initial connectivity check failed: $error');
    }
    _connSub = _connectivity.onConnectivityChanged.listen(
      (results) {
        final nowOnline = _isOnline(results);
        if (!_online && nowOnline) {
          debugPrint('[auto-reconnect] network back online → immediate poll');
          if (_polling) {
            unawaited(_pollOnce());
          } else {
            // _polling 가 false 인데 auto_polling 영속 플래그가 true 면 자동 시작
            unawaited(_tryAutoStart());
          }
        }
        _online = nowOnline;
        if (mounted && !nowOnline) {
          setState(() => _connectionStatus = '네트워크 오프라인 — 복귀 대기');
        }
      },
      onError: (error) =>
          debugPrint('[auto-reconnect] connectivity stream error: $error'),
      cancelOnError: false,
    );
  }

  bool _isOnline(List<ConnectivityResult> results) {
    // wifi / mobile / ethernet / vpn 중 하나라도 있으면 online (none / bluetooth 만 = offline)
    return results.any((r) =>
        r == ConnectivityResult.wifi ||
        r == ConnectivityResult.mobile ||
        r == ConnectivityResult.ethernet ||
        r == ConnectivityResult.vpn);
  }

  // 앱 시작 시 — 마지막 polling 상태가 true 였으면 자동 _startPolling 호출
  // 초기화 순서 보장 — URL → 프로파일 로드 완료 후 자동 시작 시도.
  Future<void> _initAndAutoStart() async {
    await _loadReceiverUrl();
    await _loadProfile();
    await _tryAutoStart();
  }

  Future<void> _tryAutoStart() async {
    if (_polling) return;
    final flag = await _storage.read(key: _storageKeyAutoPolling);
    if (flag != 'true') return;
    if (_receiverUrl == null || _receiverUrl!.isEmpty) return;
    debugPrint('[auto-reconnect] auto-polling flag detected → start');
    await _startPolling();
  }

  Future<void> _loadReceiverUrl() async {
    final saved = await _storage.read(key: _storageKeyReceiverUrl);
    final initial = (saved != null && saved.isNotEmpty)
        ? saved
        : (_mockReceiverUrl.isNotEmpty ? _mockReceiverUrl : null);

    if (initial != null) {
      _publisher.setHttpFallbackUrl(Uri.tryParse(initial));
    }

    if (!mounted) {
      return;
    }

    setState(() {
      _receiverUrl = initial;
    });
  }

  Future<void> _loadProfile() async {
    final name = await _storage.read(key: _storageKeyWorkerName);
    final empId = await _storage.read(key: _storageKeyEmployeeId);
    final jobTitle = await _storage.read(key: _storageKeyJobTitle);
    final gName = await _storage.read(key: _storageKeyGuardianName);
    final gPhone = await _storage.read(key: _storageKeyGuardianPhone);
    if (!mounted) {
      return;
    }
    setState(() {
      _workerName = (name != null && name.isNotEmpty) ? name : null;
      _employeeId = (empId != null && empId.isNotEmpty) ? empId : null;
      _jobTitle = (jobTitle != null && jobTitle.isNotEmpty) ? jobTitle : null;
      _guardianName = (gName != null && gName.isNotEmpty) ? gName : null;
      _guardianPhone = (gPhone != null && gPhone.isNotEmpty) ? gPhone : null;
    });
  }

  Future<void> _saveReceiverUrl(String raw) async {
    final trimmed = raw.trim();
    final parsed = trimmed.isEmpty ? null : Uri.tryParse(trimmed);

    if (trimmed.isNotEmpty && (parsed == null || !parsed.hasScheme)) {
      setState(() => _connectionStatus = 'URL 형식 오류: $trimmed');
      return;
    }

    await _storage.write(key: _storageKeyReceiverUrl, value: trimmed);
    _publisher.setHttpFallbackUrl(parsed);

    setState(() {
      _receiverUrl = trimmed.isEmpty ? null : trimmed;
      _connectionStatus = trimmed.isEmpty ? 'URL 미설정' : 'URL 저장됨';
    });
  }

  Future<void> _saveProfile({
    required String? name,
    required String? employeeId,
    required String? jobTitle,
    required String? guardianName,
    required String? guardianPhone,
  }) async {
    final trimmedName = name?.trim();
    final trimmedEmp = employeeId?.trim();
    final trimmedJob = jobTitle?.trim();
    final trimmedGName = guardianName?.trim();
    final trimmedGPhone = guardianPhone?.trim();

    await _storage.write(key: _storageKeyWorkerName, value: trimmedName ?? '');
    await _storage.write(key: _storageKeyEmployeeId, value: trimmedEmp ?? '');
    await _storage.write(key: _storageKeyJobTitle, value: trimmedJob ?? '');
    await _storage.write(key: _storageKeyGuardianName, value: trimmedGName ?? '');
    await _storage.write(key: _storageKeyGuardianPhone, value: trimmedGPhone ?? '');

    if (!mounted) {
      return;
    }
    setState(() {
      _workerName =
          (trimmedName != null && trimmedName.isNotEmpty) ? trimmedName : null;
      _employeeId =
          (trimmedEmp != null && trimmedEmp.isNotEmpty) ? trimmedEmp : null;
      _jobTitle =
          (trimmedJob != null && trimmedJob.isNotEmpty) ? trimmedJob : null;
      _guardianName =
          (trimmedGName != null && trimmedGName.isNotEmpty) ? trimmedGName : null;
      _guardianPhone =
          (trimmedGPhone != null && trimmedGPhone.isNotEmpty) ? trimmedGPhone : null;
    });
  }

  Future<void> _openSettings() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => SettingsPage(
          initialName: _workerName,
          initialEmployeeId: _employeeId,
          initialJobTitle: _jobTitle,
          initialGuardianName: _guardianName,
          initialGuardianPhone: _guardianPhone,
          healthAuthorized: _healthAuthorized,
          initialReceiverUrl: _receiverUrl,
          onSave: _saveProfile,
          onSaveReceiverUrl: _saveReceiverUrl,
        ),
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _connSub?.cancel();
    _timer?.cancel();
    _keepalive.stop();
    super.dispose();
  }

  Future<void> _startPolling() async {
    if (_polling) {
      return;
    }

    if (_receiverUrl == null || _receiverUrl!.isEmpty) {
      setState(() => _connectionStatus = '수신 서버 URL 을 먼저 저장하세요.');
      return;
    }

    setState(() {
      _polling = true;
      _connectionStatus = 'Health 권한 요청 중';
    });

    try {
      final authorized = await _healthVitals.requestReadAccess();
      if (!mounted) return;
      setState(() {
        _healthAuthorized = authorized;
        _connectionStatus = authorized ? '5초 폴링 중' : 'Health 권한 필요';
      });

      if (!authorized) {
        setState(() => _polling = false);
        return;
      }

      // 백그라운드/잠금 상태에서도 폴링 유지하기 위해 location 백그라운드 모드 활성화.
      // 권한 다이얼로그가 처음 1회 표시됨 — 사용자는 "항상 허용" 선택 필요.
      // 위치 업데이트마다 전송을 태우는 이중화 — 타이머가 지연/정지된 짧은 백그라운드
      // wake 창에서도 위치 콜백이 전송을 트리거 (4.5s throttle 로 중복 방지).
      final keepaliveMsg = await _keepalive.start(
        onUpdate: (_) => unawaited(_pollOnce(throttled: true)),
      );
      if (mounted) {
        setState(() => _keepaliveStatus = keepaliveMsg);
      }

      await _pollOnce();
      _timer = Timer.periodic(const Duration(seconds: 5), (_) => _pollOnce());

      // 시작 성공 — 다음 앱 실행 시 자동 재개되도록 영속 플래그 ON
      await _storage.write(key: _storageKeyAutoPolling, value: 'true');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _polling = false;
        _connectionStatus = '시작 실패: $error';
      });
    }
  }

  // 수동 정지 — Timer 해제 + 영속 플래그 OFF (다음 앱 실행 때 자동 재개 안 함)
  Future<void> _stopPolling() async {
    _timer?.cancel();
    _timer = null;
    await _keepalive.stop();
    await _storage.write(key: _storageKeyAutoPolling, value: 'false');
    if (!mounted) return;
    setState(() {
      _polling = false;
      _connectionStatus = '정지됨';
      _keepaliveStatus = '대기';
    });
  }

  // 사원번호가 입력되어 있으면 그것을 workerId 로 사용 (폰 별 자동 분리).
  // 미입력 시 빌드 타임 default (`demo_ios_01` 등) 로 fallback.
  String get _effectiveWorkerId {
    final emp = _employeeId?.trim();
    return (emp != null && emp.isNotEmpty) ? emp : _workerId;
  }

  // payload 에 동봉할 보호자 + 위치 메타 — 매번 동일하게 적용하기 위해 헬퍼화
  Map<String, dynamic> _extraMeta() {
    final pos = _keepalive.lastPosition;
    return {
      'guardianName': _guardianName,
      'guardianPhone': _guardianPhone,
      'latitude': pos?.latitude,
      'longitude': pos?.longitude,
    };
  }

  // throttled=true (위치 콜백 이중화 트리거) 면 직전 전송 이후 최소 간격 미만일 때 skip —
  // 5초 타이머와 중복 전송 회피. 타이머·복구(resume/online) 트리거는 throttled=false 로 항상 전송.
  Future<void> _pollOnce({bool throttled = false}) async {
    final pollNow = DateTime.now();
    if (throttled &&
        pollNow.difference(_lastPollTs) < const Duration(milliseconds: 4500)) {
      return;
    }
    _lastPollTs = pollNow;
    VitalSample? base;
    try {
      base = await _healthVitals.readLatestVitals(
        workerId: _effectiveWorkerId,
        workerName: _workerName,
        employeeId: _employeeId,
      );
    } catch (error) {
      if (mounted) setState(() => _connectionStatus = 'Health 읽기 실패: $error');
      return;
    }

    final extra = _extraMeta();

    // 스트레스 입력은 60초 sub-cadence 로만 수집 (첫 폴 + 매 N번째). sparse 필드.
    _pollTick++;
    final collectStress = _pollTick == 1 || _pollTick % _stressEveryNPolls == 0;
    final stress =
        collectStress ? await _healthVitals.readStressInputs() : const StressInputs();

    final sample = VitalSample(
      workerId: base.workerId,
      workerName: base.workerName,
      employeeId: base.employeeId,
      jobTitle: _jobTitle,
      guardianName: extra['guardianName'] as String?,
      guardianPhone: extra['guardianPhone'] as String?,
      latitude: extra['latitude'] as double?,
      longitude: extra['longitude'] as double?,
      ts: base.ts,
      hr: base.hr,
      spo2: base.spo2,
      skinTempC: base.skinTempC,
      ambientTempC: base.ambientTempC,
      hrvSdnnMs: stress.hrvSdnnMs,
      restingHeartRate: stress.restingHeartRate,
      activeEnergyKcal: stress.activeEnergyKcal,
      steps: stress.steps,
      walkingHeartRate: stress.walkingHeartRate,
      flightsClimbed: stress.flightsClimbed,
      respiratoryRate: stress.respiratoryRate,
    );

    if (mounted) setState(() => _latest = sample);

    // 정확하게 수신된 데이터만 전송 — 센서가 없거나(예: Apple Watch SE 의 SpO₂·손목온도)
    // 측정값이 없는 메트릭은 시연용 값으로 채우지 않고 그대로 omit (toJson 이 null 필드 제외).
    // 관제 대시보드는 미수신 메트릭을 "--" 로 표시한다.
    final hasAnyVital =
        sample.hr != null || sample.spo2 != null || sample.skinTempC != null;

    try {
      await _publisher.publishVital(sample);
      if (!mounted) return;
      setState(
        () => _connectionStatus = hasAnyVital
            ? '전송 완료 ${_formatTime(sample.ts)}'
            : '수신 데이터 없음 — 빈 샘플 전송 ${_formatTime(sample.ts)}',
      );
    } catch (error) {
      // 전송 실패분은 _publisher 백로그에 보존되어 다음 성공 시 자동 재전송된다(AF2).
      if (!mounted) return;
      final n = _publisher.backlogCount;
      setState(
        () => _connectionStatus =
            '전송 실패 — 미전송 $n건 보존(복귀 시 자동 재전송)',
      );
    }
  }

  // SOS — 생명 직결 액션이라 (1) 실수 발신 방지를 위해 버튼은 3초 길게-누르기로만 트리거되고
  // (2) 전송 실패 시 즉시 자동 재시도(최대 3회, 1·2초 백오프)한다. 최종 실패해도 샘플은
  // _publisher 백로그에 보존되어 다음 폴에서 자동 재전송된다(_sosFailed 로 빨강 경고 유지).
  Future<void> _sendSos() async {
    if (_sosSending) return;
    setState(() {
      _sosSending = true;
      _sosFailed = false;
      _connectionStatus = 'SOS 전송 중...';
    });

    final extra = _extraMeta();
    final sample = VitalSample(
      workerId: _effectiveWorkerId,
      workerName: _workerName,
      employeeId: _employeeId,
      jobTitle: _jobTitle,
      guardianName: extra['guardianName'] as String?,
      guardianPhone: extra['guardianPhone'] as String?,
      latitude: extra['latitude'] as double?,
      longitude: extra['longitude'] as double?,
      ts: DateTime.now(),
      manualSos: true,
    );
    if (mounted) setState(() => _latest = sample);

    const maxAttempts = 3;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // 1회차는 일반 경로(백로그 드레인 포함), 재시도는 백로그만 flush 해
        // 같은 SOS 샘플이 중복 enqueue 되지 않게 한다.
        if (attempt == 1) {
          await _publisher.publishVital(sample);
        } else {
          await _publisher.flushBacklog();
        }
        if (mounted) {
          setState(() {
            _sosSending = false;
            _sosFailed = false;
            _connectionStatus = 'SOS 전송 완료';
          });
        }
        return;
      } catch (error) {
        if (attempt < maxAttempts) {
          if (mounted) {
            setState(
              () => _connectionStatus = 'SOS 전송 재시도 $attempt/$maxAttempts...',
            );
          }
          await Future<void>.delayed(Duration(seconds: attempt));
        } else {
          if (mounted) {
            setState(() {
              _sosSending = false;
              _sosFailed = true;
              _connectionStatus = 'SOS 전송 실패 — 자동 재전송 대기(백로그 보존)';
            });
          }
        }
      }
    }
  }

  // 낙상 시연 — Apple Watch / Galaxy Watch native fall detection 은 외부 API 노출이 없어
  // 시연용으로 폰에서 직접 fallDetected:true payload 를 트리거.
  Future<void> _sendFall() async {
    final extra = _extraMeta();
    final sample = VitalSample(
      workerId: _effectiveWorkerId,
      workerName: _workerName,
      employeeId: _employeeId,
      jobTitle: _jobTitle,
      guardianName: extra['guardianName'] as String?,
      guardianPhone: extra['guardianPhone'] as String?,
      latitude: extra['latitude'] as double?,
      longitude: extra['longitude'] as double?,
      ts: DateTime.now(),
      fallDetected: true,
    );
    if (mounted) setState(() => _latest = sample);
    try {
      await _publisher.publishVital(sample);
      if (mounted) setState(() => _connectionStatus = '낙상 시연 전송 완료');
    } catch (error) {
      if (mounted) {
        setState(
          () => _connectionStatus = '낙상 전송 실패 — 미전송 ${_publisher.backlogCount}건 보존',
        );
      }
    }
  }

  String _formatMetric(num? value, String unit) {
    if (value == null) {
      return '--';
    }
    return '${value.toStringAsFixed(value % 1 == 0 ? 0 : 1)} $unit';
  }

  String _formatTime(DateTime time) {
    final local = time.toLocal();
    return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}:${local.second.toString().padLeft(2, '0')}';
  }

  String get _workerDisplay {
    if (_workerName != null && _employeeId != null) {
      return '$_workerName ($_employeeId)';
    }
    return _workerName ?? _employeeId ?? _workerId;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTokens.bgTop,
      body: Container(
        decoration: const BoxDecoration(gradient: AppTokens.bgGradient),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _TopBar(
                  workerDisplay: _workerDisplay,
                  onSettings: _openSettings,
                ),
                const SizedBox(height: 18),
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // 히어로 — 핵심 지표(심박) 큰 숫자 + 수집 상태. raw 표시(분석은 서버).
                        _HeroCard(
                          hr: _latest?.hr,
                          polling: _polling,
                          connectionStatus: _connectionStatus,
                          updatedLabel:
                              _latest != null ? _formatTime(_latest!.ts) : null,
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: _MetricTile(
                                label: 'SpO₂',
                                value: _formatMetric(_latest?.spo2, '%'),
                                icon: Icons.bloodtype,
                                chipBg: AppTokens.chipBlueBg,
                                chipFg: AppTokens.chipBlueFg,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: _MetricTile(
                                label: '손목 온도',
                                value: _formatMetric(_latest?.skinTempC, '℃'),
                                icon: Icons.device_thermostat,
                                chipBg: AppTokens.chipOrangeBg,
                                chipFg: AppTokens.chipOrangeFg,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        _StatusPanel(
                          connectionStatus: _connectionStatus,
                          keepaliveStatus: _keepaliveStatus,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                _ActionBar(
                  polling: _polling,
                  onToggle: _polling ? _stopPolling : _startPolling,
                  onFall: _sendFall,
                  onSos: _sendSos,
                  sosSending: _sosSending,
                  sosFailed: _sosFailed,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({
    required this.label,
    required this.value,
    required this.icon,
    required this.chipBg,
    required this.chipFg,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color chipBg;
  final Color chipFg;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IconChip(icon: icon, bg: chipBg, fg: chipFg, size: 38),
          const SizedBox(height: 14),
          Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              color: AppTokens.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: AppTokens.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusPanel extends StatelessWidget {
  const _StatusPanel({
    required this.connectionStatus,
    required this.keepaliveStatus,
  });

  final String connectionStatus;
  final String keepaliveStatus;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Column(
        children: [
          _StatusRow(
            icon: Icons.sync,
            bg: AppTokens.chipBlueBg,
            fg: AppTokens.chipBlueFg,
            label: '연결 상태',
            value: connectionStatus,
          ),
          _StatusRow(
            icon: Icons.bolt,
            bg: AppTokens.chipOrangeBg,
            fg: AppTokens.chipOrangeFg,
            label: '백그라운드',
            value: keepaliveStatus,
          ),
        ],
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.icon,
    required this.bg,
    required this.fg,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final Color bg;
  final Color fg;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          IconChip(icon: icon, bg: bg, fg: fg, size: 34),
          const SizedBox(width: 12),
          Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              color: AppTokens.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontSize: 13,
                color: AppTokens.textPrimary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// 상단 바 — 로고/타이틀 + 작업자 표시 + 설정 버튼
class _TopBar extends StatelessWidget {
  const _TopBar({required this.workerDisplay, required this.onSettings});

  final String workerDisplay;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'SafetyMonitor',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: AppTokens.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                workerDisplay,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppTokens.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        InkWell(
          onTap: onSettings,
          borderRadius: BorderRadius.circular(AppTokens.rChip),
          child: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppTokens.surface,
              borderRadius: BorderRadius.circular(AppTokens.rChip),
              boxShadow: AppTokens.cardShadow,
            ),
            child: const Icon(Icons.settings, color: AppTokens.accentDeep, size: 22),
          ),
        ),
      ],
    );
  }
}

// 히어로 카드 — 핵심 지표(심박) 큰 숫자 + 수집 상태 pill. raw 표시(분석은 서버).
class _HeroCard extends StatelessWidget {
  const _HeroCard({
    required this.hr,
    required this.polling,
    required this.connectionStatus,
    required this.updatedLabel,
  });

  final num? hr;
  final bool polling;
  final String connectionStatus;
  final String? updatedLabel;

  @override
  Widget build(BuildContext context) {
    final hrText = hr == null ? '--' : hr!.round().toString();
    return AppCard(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const IconChip(
                icon: Icons.favorite,
                bg: AppTokens.chipRedBg,
                fg: AppTokens.chipRedFg,
              ),
              const SizedBox(width: 12),
              const Text(
                '심박',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppTokens.textSecondary,
                ),
              ),
              const Spacer(),
              _StatusPill(polling: polling),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                hrText,
                style: const TextStyle(
                  fontSize: 56,
                  fontWeight: FontWeight.w800,
                  color: AppTokens.textPrimary,
                  height: 1.0,
                ),
              ),
              const SizedBox(width: 6),
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text(
                  'bpm',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: AppTokens.textMuted,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            updatedLabel == null
                ? connectionStatus
                : '$connectionStatus · 측정 $updatedLabel',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12.5, color: AppTokens.textMuted),
          ),
        ],
      ),
    );
  }
}

// 수집 상태 pill — 수집 중(녹) / 정지(회색). 연결 UI 상태일 뿐 위험 판정 아님.
class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.polling});

  final bool polling;

  @override
  Widget build(BuildContext context) {
    final color = polling ? AppTokens.ok : AppTokens.textMuted;
    final bg = polling ? AppTokens.chipTealBg : const Color(0xFFE7EDEB);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            polling ? '수집 중' : '정지',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

// 하단 액션 바 — 수집 시작/정지 (딥틸) · 낙상 시연 (amber outline) · SOS (red)
class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.polling,
    required this.onToggle,
    required this.onFall,
    required this.onSos,
    required this.sosSending,
    required this.sosFailed,
  });

  final bool polling;
  final VoidCallback onToggle;
  final VoidCallback onFall;
  final VoidCallback onSos;
  final bool sosSending;
  final bool sosFailed;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: SizedBox(
            height: 56,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor:
                    polling ? const Color(0xFF7F8C9D) : AppTokens.accentDeep,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTokens.rButton),
                ),
              ),
              onPressed: onToggle,
              icon: Icon(polling ? Icons.stop : Icons.play_arrow),
              label: Text(
                polling ? '수집 정지' : '수집 시작',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        SizedBox(
          height: 56,
          width: 84,
          child: OutlinedButton(
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTokens.warn,
              side: const BorderSide(color: AppTokens.warn, width: 1.5),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppTokens.rButton),
              ),
            ),
            onPressed: onFall,
            child: const Text(
              '낙상\n시연',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.w700, height: 1.1),
            ),
          ),
        ),
        const SizedBox(width: 10),
        _SosHoldButton(
          onSos: onSos,
          sending: sosSending,
          failed: sosFailed,
        ),
      ],
    );
  }
}

// SOS 버튼 — 실수 발신 방지를 위해 3초 길게 눌러야 발신(누르는 동안 진행 게이지).
// 손을 떼면 취소. sending 중엔 잠금, failed 시 "재전송 대기" 빨강 표시.
class _SosHoldButton extends StatefulWidget {
  const _SosHoldButton({
    required this.onSos,
    required this.sending,
    required this.failed,
  });

  final VoidCallback onSos;
  final bool sending;
  final bool failed;

  @override
  State<_SosHoldButton> createState() => _SosHoldButtonState();
}

class _SosHoldButtonState extends State<_SosHoldButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _hold;

  @override
  void initState() {
    super.initState();
    _hold = AnimationController(vsync: this, duration: const Duration(seconds: 3))
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) {
          widget.onSos();
          _hold.reset();
        }
      });
  }

  @override
  void dispose() {
    _hold.dispose();
    super.dispose();
  }

  void _startHold(_) {
    if (widget.sending) return;
    _hold.forward(from: 0);
  }

  void _cancelHold([_]) {
    if (_hold.isAnimating) _hold.reverse();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: _startHold,
      onTapUp: _cancelHold,
      onTapCancel: _cancelHold,
      child: AnimatedBuilder(
        animation: _hold,
        builder: (context, _) {
          final holding = _hold.value > 0 && !widget.sending;
          return SizedBox(
            height: 56,
            width: 84,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: AppTokens.danger,
                borderRadius: BorderRadius.circular(AppTokens.rButton),
                border: widget.failed
                    ? Border.all(color: Colors.white, width: 2)
                    : null,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppTokens.rButton),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // 누르는 동안 아래→위로 차오르는 진행 게이지
                    if (holding)
                      Align(
                        alignment: Alignment.bottomCenter,
                        child: FractionallySizedBox(
                          heightFactor: _hold.value,
                          widthFactor: 1,
                          child: Container(color: Colors.white24),
                        ),
                      ),
                    Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          widget.sending ? '전송중' : 'SOS',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                          ),
                        ),
                        Text(
                          widget.failed
                              ? '재전송 대기'
                              : widget.sending
                                  ? '...'
                                  : holding
                                      ? '계속 누르세요'
                                      : '3초 길게',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            height: 1.1,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class SettingsPage extends StatefulWidget {
  const SettingsPage({
    super.key,
    required this.initialName,
    required this.initialEmployeeId,
    required this.initialJobTitle,
    required this.initialGuardianName,
    required this.initialGuardianPhone,
    required this.healthAuthorized,
    required this.initialReceiverUrl,
    required this.onSave,
    required this.onSaveReceiverUrl,
  });

  final String? initialName;
  final String? initialEmployeeId;
  final String? initialJobTitle;
  final String? initialGuardianName;
  final String? initialGuardianPhone;
  final bool healthAuthorized;
  final String? initialReceiverUrl;
  final Future<void> Function({
    required String? name,
    required String? employeeId,
    required String? jobTitle,
    required String? guardianName,
    required String? guardianPhone,
  })
  onSave;
  final Future<void> Function(String) onSaveReceiverUrl;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  late final TextEditingController _nameController;
  late final TextEditingController _empController;
  late final TextEditingController _jobController;
  late final TextEditingController _guardianNameController;
  late final TextEditingController _guardianPhoneController;
  late final TextEditingController _urlController;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.initialName ?? '');
    _empController = TextEditingController(
      text: widget.initialEmployeeId ?? '',
    );
    _jobController = TextEditingController(
      text: widget.initialJobTitle ?? '',
    );
    _guardianNameController = TextEditingController(
      text: widget.initialGuardianName ?? '',
    );
    _guardianPhoneController = TextEditingController(
      text: widget.initialGuardianPhone ?? '',
    );
    _urlController = TextEditingController(
      text: widget.initialReceiverUrl ?? '',
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _empController.dispose();
    _jobController.dispose();
    _guardianNameController.dispose();
    _guardianPhoneController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _handleSave() async {
    setState(() => _saving = true);
    await widget.onSave(
      name: _nameController.text,
      employeeId: _empController.text,
      jobTitle: _jobController.text,
      guardianName: _guardianNameController.text,
      guardianPhone: _guardianPhoneController.text,
    );
    await widget.onSaveReceiverUrl(_urlController.text);
    if (!mounted) {
      return;
    }
    setState(() => _saving = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('설정 저장됨 — 다음 전송부터 적용')),
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('설정')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                '작업자 정보',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 4),
              const Text(
                '저장 후 다음 전송부터 관제 대시보드에 표시됩니다.',
                style: TextStyle(color: AppTokens.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 20),
              TextField(
                controller: _nameController,
                textInputAction: TextInputAction.next,
                maxLength: 40,
                decoration: const InputDecoration(
                  labelText: '작업자 이름',
                  hintText: '홍길동',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _empController,
                textInputAction: TextInputAction.next,
                maxLength: 40,
                decoration: const InputDecoration(
                  labelText: '사원번호',
                  hintText: 'EMP-1024',
                  border: OutlineInputBorder(),
                ),
              ),
              TextField(
                controller: _jobController,
                textInputAction: TextInputAction.next,
                maxLength: 40,
                decoration: const InputDecoration(
                  labelText: '직급 / 직책',
                  hintText: '현장소장 · 안전관리자 · 철근공',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                '보호자 연락처',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 4),
              const Text(
                'SOS/낙상 발생 시 관제 대시보드에서 보호자에게 문자/전화를 발신합니다.',
                style: TextStyle(color: AppTokens.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _guardianNameController,
                textInputAction: TextInputAction.next,
                maxLength: 40,
                decoration: const InputDecoration(
                  labelText: '보호자 이름 / 관계',
                  hintText: '예: 김보호 (배우자)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _guardianPhoneController,
                textInputAction: TextInputAction.done,
                keyboardType: TextInputType.phone,
                maxLength: 40,
                decoration: const InputDecoration(
                  labelText: '보호자 전화번호',
                  hintText: '010-1234-5678',
                  border: OutlineInputBorder(),
                ),
                onSubmitted: (_) => _handleSave(),
              ),
              const SizedBox(height: 24),
              const Text(
                '연결 설정',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 4),
              const Text(
                '관제 서버 수신 URL · Health 권한 상태. 권한은 "수집 시작" 시 요청됩니다.',
                style: TextStyle(color: AppTokens.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 14,
                ),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFD5E4DF)),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.health_and_safety,
                      color: AppTokens.chipTealFg,
                      size: 20,
                    ),
                    const SizedBox(width: 10),
                    const Text(
                      'Health 권한',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: AppTokens.textPrimary,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      widget.healthAuthorized ? '허용' : '대기',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: widget.healthAuthorized
                            ? AppTokens.ok
                            : AppTokens.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _urlController,
                keyboardType: TextInputType.url,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: '수신 서버 URL',
                  hintText: 'https://...trycloudflare.com/api/mock/vital',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: _saving ? null : _handleSave,
                icon: const Icon(Icons.save),
                label: Text(_saving ? '저장 중...' : '저장'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
