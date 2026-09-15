import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/cctv_image_reader.dart';

final _multipart = ContentType.parse(
  'multipart/x-mixed-replace; boundary="FrameB"',
);
List<int> _bytes(String value) => latin1.encode(value);
Stream<List<int>> _chunks(List<int> bytes, int cut) =>
    Stream.fromIterable([bytes.sublist(0, cut), bytes.sublist(cut)]);

void main() {
  test('single JPEG and PNG consume the complete body', () async {
    for (final mime in ['image/jpeg', 'image/png']) {
      final result = await readCctvImage(
        Stream.fromIterable([
          [0, 255, 1],
          [13, 10, 254],
        ]),
        ContentType.parse(mime),
      );
      expect(result, [0, 255, 1, 13, 10, 254]);
    }
  });
  test('multipart length wins over boundary bytes inside first image, every split', () async {
    final frame = _bytes('pixels\r\n--FrameB\r\nstill-image');
    final payload = [
      ..._bytes(
        '--FrameB\r\ncOnTeNt-LeNgTh: ${frame.length}\r\nContent-Type: image/jpeg\r\n\r\n',
      ),
      ...frame,
      ..._bytes('\r\n--FrameB\r\nContent-Length: 6\r\n\r\nSECOND'),
    ];
    for (var cut = 0; cut <= payload.length; cut++) {
      expect(await readCctvImage(_chunks(payload, cut), _multipart), frame);
    }
    expect(
      await readCctvImage(
        Stream.fromIterable(payload.map((b) => [b])),
        _multipart,
      ),
      frame,
    );
  });
  test(
    'multipart length returns and cancels without EOF or following boundary',
    () async {
      var cancelled = false;
      final stream = StreamController<List<int>>(
        onCancel: () => cancelled = true,
      );
      final result = readCctvImage(stream.stream, _multipart);
      stream.add(_bytes('--FrameB\r\nContent-Length: 5\r\n\r\nFIRST'));
      expect(await result.timeout(const Duration(seconds: 1)), _bytes('FIRST'));
      expect(cancelled, isTrue);
      await stream.close();
    },
  );
  test(
    'multipart without length handles every split and false boundary prefixes',
    () async {
      final frame = _bytes('pixels\r\n--FrameBextra\r\nmore\r\n');
      final payload = [
        ..._bytes('preamble\r\n--FrameB\r\nContent-Type: image/jpeg\r\n\r\n'),
        ...frame,
        ..._bytes('\r\n--FrameB\r\nContent-Type: image/jpeg\r\n\r\nSECOND'),
      ];
      for (var cut = 0; cut <= payload.length; cut++) {
        expect(await readCctvImage(_chunks(payload, cut), _multipart), frame);
      }
      expect(
        await readCctvImage(
          Stream.fromIterable(payload.map((b) => [b])),
          _multipart,
        ),
        frame,
      );
    },
  );
  test(
    'multipart without length cancels immediately after next boundary',
    () async {
      var cancelled = false;
      final stream = StreamController<List<int>>(
        onCancel: () => cancelled = true,
      );
      final result = readCctvImage(stream.stream, _multipart);
      stream.add(
        _bytes(
          '--FrameB\r\nContent-Type: image/jpeg\r\n\r\nFIRST\r\n--FrameB\r\n',
        ),
      );
      expect(await result.timeout(const Duration(seconds: 1)), _bytes('FIRST'));
      expect(cancelled, isTrue);
      await stream.close();
    },
  );
  test('headerless part supports terminal boundary', () async {
    final payload = _bytes('--FrameB\r\n\r\nFIRST\r\n--FrameB--\r\n');
    expect(
      await readCctvImage(
        Stream.fromIterable(payload.map((b) => [b])),
        _multipart,
      ),
      _bytes('FIRST'),
    );
  });
  test('truncated bodies, empty images, and invalid lengths fail', () async {
    for (final body in [
      '--FrameB\r\nContent-Length: 10\r\n\r\nshort',
      '--FrameB\r\nContent-Length: 0\r\n\r\n',
      '--FrameB\r\nContent-Length: invalid\r\n\r\n',
      '--FrameB\r\nContent-Length: 3\r\nContent-Length: 3\r\n\r\nabc',
      '--FrameB\r\nContent-Type: image/jpeg\r\n\r\nunterminated',
    ]) {
      await expectLater(
        readCctvImage(Stream.value(_bytes(body)), _multipart),
        throwsException,
      );
    }
    await expectLater(
      readCctvImage(const Stream.empty(), ContentType('image', 'png')),
      throwsException,
    );
  });
  test('unsupported content types and missing boundaries fail', () async {
    for (final type in [
      null,
      ContentType.json,
      ContentType('multipart', 'x-mixed-replace'),
    ]) {
      await expectLater(
        readCctvImage(const Stream.empty(), type),
        throwsException,
      );
    }
  });
  test(
    'oversized headers and declared images fail without unbounded buffering',
    () async {
      await expectLater(
        readCctvImage(Stream.value(List.filled(65537, 65)), _multipart),
        throwsException,
      );
      await expectLater(
        readCctvImage(
          Stream.value(_bytes('--FrameB\r\nContent-Length: 16777217\r\n\r\n')),
          _multipart,
        ),
        throwsException,
      );
    },
  );
}
