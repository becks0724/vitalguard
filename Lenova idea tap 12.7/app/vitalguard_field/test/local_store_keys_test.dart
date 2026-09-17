import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/live/local_store_paths.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';

void main() {
  test('한글·공백·구분자가 있는 키를 기존 base64url 경로로 왕복한다', () {
    const key = '사진:현장 A/초안 🔎';
    final parts = localStorePathSegments(key);
    expect(parts.join(), base64Url.encode(utf8.encode(key)));
    expect(localStoreKeyFromSegments(parts), key);
  });

  test('80자를 넘는 경로는 모든 디렉터리 조각을 합쳐 복원한다', () {
    final key = 'ink-draft:${'긴 원본 키/' * 60}';
    final parts = localStorePathSegments(key);
    expect(parts.length, greaterThan(2));
    expect(parts.take(parts.length - 1).every((p) => p.length == 80), isTrue);
    expect(parts.last.length, inInclusiveRange(1, 80));
    expect(localStoreKeyFromSegments(parts), key);
  });

  test('정확히 80자 경계와 그 다음 조각을 보존한다', () {
    expect(localStorePathSegments('a' * 60), hasLength(1));
    expect(localStorePathSegments('a' * 61).map((e) => e.length), [80, 4]);
    expect(
      localStoreKeyFromSegments(localStorePathSegments('a' * 61)),
      'a' * 61,
    );
  });

  test('손상·비정규 base64url·잘못된 UTF-8·빈 조각은 건너뛴다', () {
    for (final parts in <List<String>>[
      [],
      [''],
      ['..'],
      ['%%%'],
      ['a'],
      ['_w=='],
      ['YQ'],
      ['Y', 'Q=='],
      ['YQ==', 'value'],
      ['YQ==', ''],
      ['YQ==/'],
      ['YQ==\n'],
    ]) {
      expect(localStoreKeyFromSegments(parts), isNull, reason: '$parts');
    }
    expect(() => localStorePathSegments(''), throwsArgumentError);
  });

  test('MemoryStore keys는 문자열·바이트 키를 계정별 사본으로 반환한다', () async {
    final store = MemoryStore();
    await store.write('a', '메모', '안전 점검');
    await store.writeBytes('a', '사진', Uint8List.fromList([1, 2]));
    await store.write('b', '다른 계정', '기록');
    final keys = await store.keys('a');
    expect(keys, unorderedEquals(['메모', '사진']));
    keys.clear();
    expect(await store.keys('a'), hasLength(2));
    expect(await store.keys('b'), ['다른 계정']);
    expect(await store.keys('없는 계정'), isEmpty);
  });

  test('MemoryStore remove는 값과 키를 지우고 다른 계정·토큰은 보존한다', () async {
    final store = MemoryStore();
    await store.writeTokenBundle('tokens');
    await store.write('a', '공유 이름', 'a');
    await store.write('b', '공유 이름', 'b');
    await store.remove('a', '공유 이름');
    await store.remove('a', '공유 이름');
    await store.remove('없는 계정', '없는 키');
    expect(await store.readBytes('a', '공유 이름'), isNull);
    expect(await store.keys('a'), isEmpty);
    expect(await store.read('b', '공유 이름'), 'b');
    expect(await store.readTokenBundle(), 'tokens');
  });
}
