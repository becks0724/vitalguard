import 'server_models.dart';

const int maxInkUploadBytes = 2097152;

String? inkUploadSizeError(int byteLength) => byteLength > maxInkUploadBytes
    ? '잉크 크기 ${(byteLength / 1024).toStringAsFixed(1)} KB가 전송 한도 2 MB '
          '(2,097,152바이트)를 넘었습니다. 기기에는 저장됩니다. 획을 줄인 뒤 다시 저장해 주세요.'
    : null;

String calendarDate(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-'
    '${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

DateTime kstNow() => DateTime.now().toUtc().add(const Duration(hours: 9));

String asKstIso(String source) {
  final hasZone = RegExp(r'(Z|[+-]\d{2}:?\d{2})$').hasMatch(source);
  final instant = DateTime.parse(hasZone ? source : '$source+09:00');
  final local = instant.toUtc().add(const Duration(hours: 9));
  return '${local.toIso8601String().replaceFirst(RegExp(r'Z$'), '')}+09:00';
}

Map<String, String> annotationFields(CalendarMedia original) => {
  // 날짜와 원본 ID를 보존한다. 제목을 잘라내지 않으며 현재 업로더를 원본 업로더로 위조하지 않는다.
  'dateKey': original.date_key,
  'annotationOf': original.id,
  'title':
      '현장 이미지 (주석) — 원본 ${original.captured_at ?? original.date_key} · ${original.id}',
  if (original.captured_at != null)
    'capturedAt': asKstIso(original.captured_at!),
  if (original.site_id != null) 'siteId': original.site_id!,
  if (original.ocr_text != null) 'ocrText': original.ocr_text!,
  if (original.road_address != null) 'roadAddress': original.road_address!,
  if (original.latitude != null) 'latitude': '${original.latitude}',
  if (original.longitude != null) 'longitude': '${original.longitude}',
};
