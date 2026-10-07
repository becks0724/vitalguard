import 'site_status_fixture.dart';

// 실제 app/admin/workers 응답 키만 사용한 합성 자료다.
Map<String, dynamic> workerReply(
  String id, {
  String tone = 'normal',
  bool stale = false,
}) => {
  'workerId': id,
  'name': '작업자 $id',
  'jobTitle': '현장 기사',
  'tone': tone,
  'label': stale
      ? '연결끊김'
      : switch (tone) {
          'normal' => '수신 중',
          'caution' => '주의',
          'danger' => 'SOS 요청',
          _ => '대기',
        },
  'staleLabel': stale ? '장기 미수신' : null,
  'heartRate': stale ? null : 78,
  'spo2': stale ? null : 98,
  'skinTempC': stale ? null : 34.5,
  'coreTempC': 36.8,
  'worn': true,
  'lastSeenAt': '2026-09-14T15:12:44.759Z',
  'ageSec': 20,
  'stale': stale,
  'latitude': 37.501234,
  'longitude': 127.012345,
  'locationAccuracyMeters': 8,
};

Map<String, dynamic> workersStatusReply({
  List<Map<String, dynamic>>? items,
  bool? piiRedacted = false,
}) {
  final rows = items ?? [workerReply('w-1')];
  int count(String tone) => rows.where((row) => row['tone'] == tone).length;
  return {
    ...siteStatusReply(),
    'workers': {
      'ok': true,
      'level': rows.isEmpty ? 'idle' : 'normal',
      'summary': '합성 작업자 현황',
      'total': rows.length,
      'normal': count('normal'),
      'waiting': count('idle'),
      'caution': count('caution'),
      'danger': count('danger'),
      'stale': rows.where((row) => row['stale'] == true).length,
      'piiRedacted': piiRedacted,
      'fetchedAt': '2026-09-14T15:13:04.759Z',
      'items': rows,
    },
  };
}
