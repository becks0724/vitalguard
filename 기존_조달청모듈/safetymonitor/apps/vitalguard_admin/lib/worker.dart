// `/api/app/admin/workers` 응답 모델 — 서버가 판정한 값을 그대로 담는다
//
// ★ 여기서 판정을 다시 하지 않는다. `tone`·`label`·`counts` 는 서버가 관제웹 화면과 **같은
//   함수**(`lib/worker-signal.ts`)로 낸 값이다. 앱이 임계를 따로 두면 같은 작업자가 웹과 앱에서
//   다른 색으로 뜬다(context-notes.md "판정을 클라이언트가 하지 않는다").
//
// ⚠ 없는 값은 `null` 이고 그것은 "0" 이 아니라 "모름" 이다. 끊긴 작업자의 생체는 서버가 이미
//   비워서 내려준다(`gateStaleVitals`) — 낡은 값을 현재값처럼 보이면 false-OK 가 된다.

/// 서버 `tone` 어휘. 새 말을 만들지 않는다 — 관제웹·워치·앱이 같은 단어를 써야 한다.
enum Tone { normal, caution, danger, idle }

Tone toneOf(Object? raw) {
  switch (raw) {
    case 'danger':
      return Tone.danger;
    case 'caution':
      return Tone.caution;
    case 'idle':
      return Tone.idle;
    default:
      return Tone.normal;
  }
}

class Worker {
  const Worker({
    required this.workerId,
    required this.name,
    required this.tone,
    required this.label,
    required this.stale,
    this.jobTitle,
    this.staleLabel,
    this.heartRate,
    this.spo2,
    this.skinTempC,
    this.coreTempC,
    this.worn,
    this.ageSec,
  });

  final String workerId;
  final String name;
  final String? jobTitle;

  /// 서버 판정 — 신호등 색의 유일한 출처다.
  final Tone tone;

  /// 서버 라벨 — 수신 중 / 주의 / 위험 / 대기, 끊겼으면 사유가 상태를 대신한다.
  final String label;

  /// 끊긴 사유(구 표본·폰 등). 라벨만으로는 1분과 12시간이 같아 보인다.
  final String? staleLabel;

  final bool stale;
  final double? heartRate;
  final double? spo2;
  final double? skinTempC;
  final double? coreTempC;

  /// 착용 표식. 끊김과 **별개 축**이라 서버가 게이트를 안 태운다. `null` 은 모름(구 표본·폰).
  final bool? worn;

  final int? ageSec;

  static Worker? from(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['workerId'];
    if (id is! String) return null;
    return Worker(
      workerId: id,
      name: raw['name'] is String ? raw['name'] as String : id,
      jobTitle: raw['jobTitle'] is String ? raw['jobTitle'] as String : null,
      tone: toneOf(raw['tone']),
      label: raw['label'] is String ? raw['label'] as String : '—',
      staleLabel: raw['staleLabel'] is String ? raw['staleLabel'] as String : null,
      stale: raw['stale'] == true,
      heartRate: _d(raw['heartRate']),
      spo2: _d(raw['spo2']),
      skinTempC: _d(raw['skinTempC']),
      coreTempC: _d(raw['coreTempC']),
      worn: raw['worn'] is bool ? raw['worn'] as bool : null,
      ageSec: raw['ageSec'] is num ? (raw['ageSec'] as num).round() : null,
    );
  }

  static double? _d(Object? v) => v is num ? v.toDouble() : null;
}

/// 이상 인원 집계. **서버가 센 값**을 그대로 쓴다 — 앱이 따로 세면 같은 화면에서 두 숫자가 갈린다.
class WorkerCounts {
  const WorkerCounts({
    required this.total,
    required this.danger,
    required this.caution,
    required this.stale,
  });

  final int total;
  final int danger;
  final int caution;
  final int stale;

  /// 화면 상단의 "이상 N명" — 위험과 주의를 합친 수다.
  int get abnormal => danger + caution;

  static const empty = WorkerCounts(total: 0, danger: 0, caution: 0, stale: 0);

  static WorkerCounts from(Object? raw) {
    if (raw is! Map) return empty;
    int n(String k) => raw[k] is num ? (raw[k] as num).round() : 0;
    return WorkerCounts(
      total: n('total'),
      danger: n('danger'),
      caution: n('caution'),
      stale: n('stale'),
    );
  }
}

/// 화면 한 장의 재료.
class WorkerBoard {
  const WorkerBoard({required this.counts, required this.workers});

  final WorkerCounts counts;
  final List<Worker> workers;

  static WorkerBoard from(Map<String, dynamic> body) {
    final raw = body['workers'];
    return WorkerBoard(
      counts: WorkerCounts.from(body['counts']),
      workers: raw is List ? raw.map(Worker.from).whereType<Worker>().toList() : const [],
    );
  }
}
