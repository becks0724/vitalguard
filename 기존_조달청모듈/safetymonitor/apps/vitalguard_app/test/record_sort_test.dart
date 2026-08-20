// 기록 목록 정렬 — 최신 촬영이 위로 오는지 고정한다
//
// ★ 순서 결함은 조용하다. 잘못 정렬돼도 예외가 없고 화면도 멀쩡해 보이며, 사람은 "왜 방금 찍은
//   게 안 보이지" 로만 겪는다. 서버는 `captured_at ASC`(관제 캘린더 계약)로 주므로 이 뒤집기가
//   빠지면 최신이 목록 맨 아래로 간다 — 2026-08-20 실제로 그 상태였다.
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/record_screen.dart';

Map<String, dynamic> row(String? captured, {String? dateKey, String id = ''}) => {
      'id': id,
      'captured_at': ?captured,
      'date_key': ?dateKey,
    };

void main() {
  test('최신 촬영이 맨 위로 온다', () {
    final sorted = newestFirst([
      row('2026-08-19T17:16:22+09:00', id: '가운데'),
      row('2026-08-19T23:38:32+09:00', id: '최신'),
      row('2026-08-19T14:07:17+09:00', id: '가장오래'),
    ]);
    expect(sorted.map((m) => m['id']).toList(), ['최신', '가운데', '가장오래']);
  });

  test('★ 오프셋이 섞여도 실제 시각으로 정렬한다 — 사전순이면 뒤집힌다', () {
    // `2026-08-19T23:38:32+09:00` = `2026-08-19T14:38:32Z` 로 같은 순간이다.
    // 문자열로 비교하면 "23…" 이 "14…" 보다 커서 UTC 표기 쪽이 항상 아래로 밀린다.
    final sorted = newestFirst([
      row('2026-08-19T23:38:32+09:00', id: '먼저'),
      row('2026-08-19T15:00:00Z', id: '나중'), // = 00:00 KST(08-20)
    ]);
    expect(sorted.first['id'], '나중');
  });

  test('촬영 시각이 없으면 날짜로 정렬하고, 그것도 없으면 맨 아래로 간다', () {
    final sorted = newestFirst([
      row(null, id: '알수없음'),
      row(null, dateKey: '2026-08-18', id: '날짜만'),
      row('2026-08-19T09:00:00+09:00', id: '시각있음'),
    ]);
    expect(sorted.map((m) => m['id']).toList(), ['시각있음', '날짜만', '알수없음']);
  });

  test('원본 목록을 건드리지 않는다', () {
    final original = [
      row('2026-08-19T10:00:00+09:00', id: 'a'),
      row('2026-08-19T20:00:00+09:00', id: 'b'),
    ];
    newestFirst(original);
    expect(original.map((m) => m['id']).toList(), ['a', 'b']);
  });
}
