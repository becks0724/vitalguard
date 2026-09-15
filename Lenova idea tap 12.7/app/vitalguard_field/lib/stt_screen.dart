// P4 순정 STT 실측. 결과를 정규화하거나 일치율로 바꾸지 않는다.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'vg_theme.dart';

const sttSentences = <String>[
  '3번 구역 안전난간 파손 확인했습니다',
  '크레인 작업 중지 요청합니다',
  '가스 농도 초과 경보 발생',
  '작업자 두 명 안전대 미착용',
  '오후 두시 십오분 점검 완료',
];

typedef SttInvoke = Future<Object?> Function(
  String method,
  Map<String, Object?>? arguments,
);

class SttTrial {
  SttTrial(this.id, this.sentence);
  final String id;
  final String sentence;
  bool started = false;
  bool finished = false;
  String status = '준비 중';
  int? firstPartialMs;
  int? errorCode;
  String? errorName;
  List<String>? finalResults;
  final List<List<String>> partialResults = [];
  Map<String, dynamic>? environmentAtStart;
  Map<String, dynamic>? environmentAtEnd;
  bool environmentChanged = false;
  final List<Map<String, dynamic>> rawEvents = [];

  void absorb(Map<String, dynamic> event) {
    rawEvents.add(event);
    final type = event['type'];
    if (event['firstPartialMs'] is num) {
      firstPartialMs = (event['firstPartialMs'] as num).toInt();
    }
    if (event['environmentAtStart'] is Map) {
      environmentAtStart = Map<String, dynamic>.from(
        event['environmentAtStart'] as Map,
      );
    }
    environmentChanged =
        environmentChanged || event['environmentChanged'] == true;
    final results = (event['results'] as List?)?.cast<String>() ?? <String>[];
    switch (type) {
      case 'started':
        started = true;
        status = '인식 준비 중';
      case 'status':
        status = switch (event['state']) {
          'ready' => '말씀하세요',
          'speech' => '음성 입력 중',
          'waiting_final' => '최종 결과 대기',
          _ => '${event['state']}',
        };
      case 'partial':
        partialResults.add(results);
        status = '부분 결과 수신';
      case 'final':
        finalResults = results;
        status = '최종 결과 수신';
        finished = true;
      case 'error':
        errorCode = (event['code'] as num).toInt();
        errorName = event['name'] as String?;
        status = '인식기 오류 $errorCode · $errorName';
        finished = true;
      case 'cancelled':
        status = '측정 중단 · ${event['reason']}';
        finished = true;
      case 'diagnostic_error':
        status = '진단 중단 · ${event['reason']}';
        finished = true;
    }
    if (finished && event['environment'] is Map) {
      environmentAtEnd = Map<String, dynamic>.from(event['environment'] as Map);
    }
  }
}

class SttMeasurements extends ChangeNotifier {
  SttMeasurements({SttInvoke? invoke, Stream<dynamic>? events})
    : _invoke =
          invoke ??
          ((method, args) => _methods.invokeMethod<Object?>(method, args)),
      _events = events ?? _channel.receiveBroadcastStream();
  static const _methods = MethodChannel('vitalguard/stt');
  static const _channel = EventChannel('vitalguard/stt_events');
  final SttInvoke _invoke;
  final Stream<dynamic> _events;
  StreamSubscription<dynamic>? _subscription;
  final Map<String, SttTrial> _trials = {};
  bool? available;
  bool checking = false;
  bool _disposed = false;
  int _sequence = 0;
  String? activeId;
  String? platformError;
  String logPath = '미확인';
  Map<String, dynamic>? environment;
  Map<String, dynamic>? support;

  List<SttTrial> get trials => _trials.values.toList().reversed.toList();
  bool get running => activeId != null;
  int get sampleCount => _trials.values.where((r) => r.started).length;

  Future<void> initialize() async {
    _subscription = _events.listen(
      _event,
      onError: (Object error) {
        if (_disposed) return;
        platformError = '이벤트 연결 오류: $error';
        notifyListeners();
        unawaited(stop(cancel: true));
      },
    );
    try {
      final saved = await _invoke('readLog', null) as String? ?? '';
      if (_disposed) return;
      for (final line in const LineSplitter().convert(saved)) {
        try {
          final event = Map<String, dynamic>.from(jsonDecode(line) as Map);
          final id = event['runId'];
          if (id is! String) continue;
          final trial = _trials.putIfAbsent(
            id,
            () => SttTrial(id, event['sentence'] as String),
          );
          trial.absorb(event);
        } on FormatException {
          platformError = '원시기록 중 읽을 수 없는 행이 있습니다. 파일은 보존됩니다.';
        }
      }
      for (final trial in _trials.values.where((r) => !r.finished)) {
        trial.status = '종료 기록 없음 · 이전 측정';
        trial.finished = true;
      }
    } on PlatformException catch (error) {
      platformError = '기록 읽기 실패: ${error.code} · ${error.message}';
    } on MissingPluginException {
      platformError = '네이티브 STT 채널이 없습니다. 새 APK 설치가 필요합니다.';
    }
    if (!_disposed) await probe();
  }

  Future<void> probe() async {
    if (running || checking || _disposed) return;
    checking = true;
    support = null;
    notifyListeners();
    try {
      final result = await _invoke('isOnDeviceAvailable', null);
      if (_disposed) return;
      final data = Map<String, dynamic>.from(result as Map);
      available = data['available'] as bool;
      environment = Map<String, dynamic>.from(data['environment'] as Map);
      logPath = data['logPath'] as String;
    } on PlatformException catch (error) {
      if (!_disposed) {
        platformError = '가용성 조회 실패: ${error.code} · ${error.message}';
      }
    } on MissingPluginException {
      if (!_disposed) platformError = '네이티브 STT 채널이 없습니다. 새 APK 설치가 필요합니다.';
    } finally {
      checking = false;
      if (!_disposed) notifyListeners();
    }
  }

  void _event(dynamic raw) {
    if (_disposed) return;
    final event = Map<String, dynamic>.from(raw as Map);
    if (event['environment'] is Map) {
      environment = Map<String, dynamic>.from(event['environment'] as Map);
    }
    if (event['type'] == 'support') support = event;
    final id = event['runId'];
    // 이전 측정의 늦은 콜백이 현재 표본이나 완료한 결과를 덮지 못하게 한다.
    if (id is String && id == activeId) {
      final trial = _trials[id]!;
      trial.absorb(event);
      if (trial.finished) activeId = null;
    }
    if (event['logWriteError'] != null) {
      platformError = '기록 파일 저장 실패: ${event['logWriteError']}';
    }
    notifyListeners();
  }

  Future<void> start(int sentenceIndex) async {
    if (running || checking || available != true || _disposed) return;
    final id = '${DateTime.now().microsecondsSinceEpoch}-${++_sequence}';
    final trial = SttTrial(id, sttSentences[sentenceIndex]);
    _trials[id] = trial;
    activeId = id;
    platformError = null;
    if (support?['state'] == 'checking') {
      support = {'state': '측정 시작으로 지원 조회 중단 · 종료 후 다시 확인'};
    }
    notifyListeners();
    try {
      await _invoke('start', {'runId': id, 'sentence': trial.sentence});
    } on PlatformException catch (error) {
      if (_disposed) return;
      trial.status = '준비 실패 · ${error.code} · ${error.message}';
      trial.finished = true;
      activeId = null;
      notifyListeners();
    } on MissingPluginException {
      if (_disposed) return;
      trial.status = '미측정 · 네이티브 채널 없음';
      trial.finished = true;
      activeId = null;
      notifyListeners();
    }
  }

  Future<void> stop({bool cancel = false}) async {
    try {
      await _invoke('stop', {'cancel': cancel});
      if (cancel && !_disposed && activeId != null) {
        _trials[activeId]!.status = '측정 중단';
        _trials[activeId]!.finished = true;
        activeId = null;
        notifyListeners();
      }
    } on PlatformException catch (error) {
      if (!_disposed) {
        platformError = '중지 요청 실패: ${error.code} · ${error.message}';
        notifyListeners();
      }
    } on MissingPluginException {
      // 설치되지 않은 네이티브 채널은 초기 가용성 조회에서 이미 표시한다.
    }
  }

  Future<String> readLog() async =>
      await _invoke('readLog', null) as String? ?? '';

  @override
  void dispose() {
    _disposed = true;
    unawaited(stop(cancel: true));
    unawaited(_subscription?.cancel());
    super.dispose();
  }
}

class SttScreen extends StatefulWidget {
  const SttScreen({super.key});
  @override
  State<SttScreen> createState() => _SttScreenState();
}

class _SttScreenState extends State<SttScreen> with WidgetsBindingObserver {
  final measurements = SttMeasurements();
  int selected = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(measurements.initialize());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      unawaited(measurements.stop(cancel: true));
    } else if (state == AppLifecycleState.resumed) {
      unawaited(measurements.probe());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    measurements.dispose();
    super.dispose();
  }

  String flag(Map<String, dynamic>? env, String key) =>
      env?[key] == null ? '미확인' : (env![key] == true ? '켜짐' : '꺼짐');

  Widget environmentText(Map<String, dynamic>? env) => Text(
    '비행기모드 ${flag(env, 'airplaneMode')} · Wi-Fi ${flag(env, 'wifiEnabled')} · '
    '활성 네트워크 ${flag(env, 'activeNetwork')}',
  );

  Future<void> copyLog() async {
    try {
      final log = await measurements.readLog();
      await Clipboard.setData(ClipboardData(text: log));
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('원시 JSONL 기록을 복사했습니다')));
      }
    } on PlatformException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('복사 실패: ${error.message}')));
      }
    } on MissingPluginException {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('네이티브 기록 채널이 없습니다')));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('P4 STT 측정')),
    body: SafeArea(
      child: AnimatedBuilder(
        animation: measurements,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              '온디바이스 인식기: ${switch (measurements.available) {
                true => '있음',
                false => '없음',
                null => '미측정',
              }}',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            environmentText(measurements.environment),
            const Text(
              'Android 설정값을 직접 읽습니다. 비행기모드에서도 Wi-Fi가 켜져 있으면 오프라인 시험 조건이 아닙니다.',
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 16,
              runSpacing: 16,
              children: [
                OutlinedButton(
                  onPressed: measurements.running || measurements.checking
                      ? null
                      : measurements.probe,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(160, vgTapMin),
                  ),
                  child: const Text('가용성 다시 확인'),
                ),
                OutlinedButton(
                  onPressed: copyLog,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(160, vgTapMin),
                  ),
                  child: const Text('원시기록 복사'),
                ),
              ],
            ),
            if (measurements.platformError != null)
              Text(
                measurements.platformError!,
                style: const TextStyle(
                  color: VgColors.ink,
                  fontWeight: FontWeight.bold,
                ),
              ),
            const SizedBox(height: 16),
            Text('한국어 모델 보고: ${measurements.support?['state'] ?? '미확인'}'),
            if (measurements.support != null)
              SelectableText(
                const JsonEncoder.withIndent('  ')
                    .convert(measurements.support),
              ),
            const Text(
              '설치 언어 목록은 모델 준비 상태의 보고입니다. 실제 한국어 문장 인식 성공과는 별도입니다. 모델을 자동 다운로드하지 않습니다.',
            ),
            const Divider(height: 32),
            const Text(
              '읽을 문장 선택',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            ...List.generate(
              sttSentences.length,
              (i) => Padding(
                padding: const EdgeInsets.only(top: 16),
                child: OutlinedButton(
                  onPressed: measurements.running
                      ? null
                      : () => setState(() => selected = i),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(vgTapMin),
                    backgroundColor: selected == i
                        ? VgColors.primarySubtle
                        : null,
                  ),
                  child: Text(
                    '${i + 1}. ${sttSentences[i]}',
                    style: const TextStyle(fontSize: 18),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              '측정 시작을 누르고 “말씀하세요”가 나오면 선택한 문장을 직접 읽으세요. 비행기모드·Wi-Fi 끄기는 시작 전에 설정합니다. 이 시험은 인식 시 네트워크 의존성을 확인하며 모델 배포 방식은 판정하지 않습니다.',
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 16,
              runSpacing: 16,
              children: [
                FilledButton(
                  onPressed:
                      measurements.running ||
                          measurements.checking ||
                          measurements.available != true
                      ? null
                      : () => measurements.start(selected),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(160, vgTapPrimary),
                  ),
                  child: const Text('측정 시작'),
                ),
                OutlinedButton(
                  onPressed: measurements.running
                      ? () => measurements.stop()
                      : null,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(160, vgTapPrimary),
                  ),
                  child: const Text('말하기 끝내기'),
                ),
                OutlinedButton(
                  onPressed: measurements.running
                      ? () => measurements.stop(cancel: true)
                      : null,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(120, vgTapPrimary),
                  ),
                  child: const Text('측정 취소'),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Text(
              measurements.sampleCount == 0
                  ? '인식 표본 0 · 미측정'
                  : '인식 표본 ${measurements.sampleCount}',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const Text(
              '부분결과 지연은 startListening 호출 직전부터 첫 onPartialResults 콜백까지입니다. 발화 시작 기준이 아니며 빈 부분결과도 원문으로 기록합니다. 일치율은 계산하지 않습니다.',
            ),
            ...measurements.trials.map(trialCard),
            const SizedBox(height: 16),
            SelectableText('원시기록: ${measurements.logPath}'),
          ],
        ),
      ),
    ),
  );

  Widget trialCard(SttTrial trial) {
    final output = trial.finalResults == null
        ? (trial.errorCode != null
              ? '${trial.errorCode} · ${trial.errorName}'
              : !trial.started
              ? '미측정'
              : trial.finished
              ? '최종 결과 미수신'
              : '최종 결과 대기')
        : jsonEncode(trial.finalResults);
    return Card(
      margin: const EdgeInsets.only(top: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              trial.status,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('읽은 문장'),
                      SelectableText(trial.sentence),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [const Text('인식 결과 원문'), SelectableText(output)],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '첫 부분결과: ${trial.firstPartialMs == null ? (trial.finished && trial.started ? '미수신' : '미측정') : '${trial.firstPartialMs} ms'}',
            ),
            if (trial.partialResults.isNotEmpty)
              SelectableText('부분결과 원문: ${jsonEncode(trial.partialResults)}'),
            const Text('측정 시작 설정'),
            environmentText(trial.environmentAtStart),
            if (trial.environmentAtEnd != null) ...[
              const Text('측정 종료 설정'),
              environmentText(trial.environmentAtEnd),
            ],
            Text(
              '측정 중 관찰된 환경 변화: ${!trial.started
                  ? '미측정'
                  : trial.environmentChanged
                  ? '있음 · 오프라인 판정에서 분리'
                  : '관찰 구간에서 없음'}',
            ),
          ],
        ),
      ),
    );
  }
}
