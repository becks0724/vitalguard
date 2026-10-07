// cctv_probe_screen.dart의 첫 파트 파서를 그대로 공유한다.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

const _maxImageBytes = 16 * 1024 * 1024;
const _maxHeaderBytes = 64 * 1024;

/// HTTP 스트림 구독 취소가 나머지 본문을 기다리지 않도록 소켓부터 닫는다.
/// HTTP chunked 디코딩은 HttpClient에 맡기고 multipart 파서는 그대로 쓴다.
Future<Uint8List> readCctvResponseImage(
  HttpClient client,
  HttpClientResponse response,
) {
  late StreamSubscription<List<int>> subscription;
  final body = StreamController<List<int>>(sync: true);
  body.onListen = () {
    subscription = response.listen(
      body.add,
      onError: body.addError,
      onDone: body.close,
    );
  };
  body.onPause = () => subscription.pause();
  body.onResume = () => subscription.resume();
  body.onCancel = () {
    client.close(force: true);
    return subscription.cancel();
  };
  return readCctvImage(body.stream, response.headers.contentType);
}

/// HTTP 본문에서 이미지 한 장을 읽는다. 조각난 MJPEG 응답도 검증할 수 있도록 분리한다.
Future<Uint8List> readCctvImage(
  Stream<List<int>> response,
  ContentType? contentType,
) async {
  if (contentType?.primaryType == 'image') {
    final body = BytesBuilder(copy: false);
    await for (final chunk in response) {
      body.add(chunk);
      _checkImageSize(body.length);
    }
    return _finishImage(body);
  }
  if (contentType?.mimeType != 'multipart/x-mixed-replace') {
    throw const CctvImageFailure('이미지 또는 MJPEG 응답이 아닙니다.');
  }
  final boundary = contentType!.parameters['boundary'];
  if (boundary == null ||
      boundary.isEmpty ||
      boundary.length > 200 ||
      boundary.codeUnits.any((c) => c < 32 || c > 126)) {
    throw const CctvImageFailure('MJPEG boundary가 없거나 올바르지 않습니다.');
  }

  final opening = latin1.encode('--$boundary\r\n');
  final delimiter = latin1.encode('\r\n--$boundary');
  final pending = <int>[];
  final body = BytesBuilder(copy: false);
  bool opened = false;
  bool headersRead = false;
  int? contentLength;

  // await for에서 return하면 응답 구독을 취소한다. 스트림 전체를 drain하지 않는다.
  await for (final chunk in response) {
    pending.addAll(chunk);
    if (!opened) {
      var start = _indexOfBytes(pending, opening);
      while (start > 0 &&
          !(start >= 2 &&
              pending[start - 2] == 13 &&
              pending[start - 1] == 10)) {
        start = _indexOfBytes(pending, opening, start + 1);
      }
      if (start < 0) {
        _checkHeaderSize(pending.length);
        continue;
      }
      _checkHeaderSize(start);
      pending.removeRange(0, start + opening.length);
      opened = true;
    }
    if (!headersRead) {
      // 헤더 없는 파트는 boundary 줄 뒤에 CRLF 하나만 온다.
      final empty = pending.length >= 2 && pending[0] == 13 && pending[1] == 10;
      final end = empty ? 0 : _indexOfBytes(pending, const [13, 10, 13, 10]);
      if (end < 0) {
        _checkHeaderSize(pending.length);
        continue;
      }
      _checkHeaderSize(end);
      final headers = latin1.decode(pending.sublist(0, end));
      for (final line in headers.split('\r\n')) {
        final colon = line.indexOf(':');
        if (colon < 0) continue;
        final name = line.substring(0, colon).trim().toLowerCase();
        final value = line.substring(colon + 1).trim();
        if (name == 'content-length') {
          final length = int.tryParse(value);
          if (contentLength != null || length == null || length <= 0) {
            throw const CctvImageFailure('MJPEG 파트 길이가 올바르지 않습니다.');
          }
          _checkImageSize(length);
          contentLength = length;
        } else if (name == 'content-type' &&
            ContentType.parse(value).primaryType != 'image') {
          throw const CctvImageFailure('MJPEG 첫 파트가 이미지가 아닙니다.');
        }
      }
      pending.removeRange(0, end + (empty ? 2 : 4));
      headersRead = true;
    }

    if (contentLength != null) {
      final take = math.min(pending.length, contentLength - body.length);
      body.add(pending.sublist(0, take));
      pending.clear();
      // Content-Length가 있으면 다음 boundary를 기다리지 않고 정확히 그 길이에서 종료.
      if (body.length == contentLength) return _finishImage(body);
    } else {
      var end = _indexOfBytes(pending, delimiter);
      while (end >= 0) {
        final suffix = end + delimiter.length;
        if (pending.length < suffix + 2) break;
        final isBoundary =
            (pending[suffix] == 13 && pending[suffix + 1] == 10) ||
            (pending[suffix] == 45 && pending[suffix + 1] == 45);
        if (isBoundary) {
          body.add(pending.sublist(0, end));
          return _finishImage(body);
        }
        end = _indexOfBytes(pending, delimiter, end + 1);
      }
      // 청크 사이에 잘린 boundary(+ CRLF/--)를 놓치지 않도록 끝부분만 보관한다.
      final flush = pending.length - (delimiter.length + 1);
      if (flush > 0) {
        body.add(pending.sublist(0, flush));
        pending.removeRange(0, flush);
      }
      _checkImageSize(body.length);
    }
  }
  throw const CctvImageFailure('첫 이미지 수신 전에 연결이 종료됐습니다.');
}

int _indexOfBytes(List<int> bytes, List<int> needle, [int start = 0]) {
  for (var i = start; i <= bytes.length - needle.length; i++) {
    var j = 0;
    while (j < needle.length && bytes[i + j] == needle[j]) {
      j++;
    }
    if (j == needle.length) return i;
  }
  return -1;
}

void _checkImageSize(int size) {
  if (size > _maxImageBytes) {
    throw const CctvImageFailure('이미지가 측정 한도(16MB)를 초과했습니다.');
  }
}

void _checkHeaderSize(int size) {
  if (size > _maxHeaderBytes) {
    throw const CctvImageFailure('MJPEG 헤더가 너무 큽니다.');
  }
}

Uint8List _finishImage(BytesBuilder body) {
  _checkImageSize(body.length);
  if (body.isEmpty) throw const CctvImageFailure('빈 이미지 응답입니다.');
  return body.takeBytes();
}

class CctvImageFailure implements Exception {
  const CctvImageFailure(this.message);
  final String message;

  @override
  String toString() => message;
}
