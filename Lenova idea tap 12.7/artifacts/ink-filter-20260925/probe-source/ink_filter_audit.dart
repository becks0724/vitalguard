import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';

import 'ui/record/ink_stroke.dart';

const inkAuditEnabled = bool.fromEnvironment('VG_INK_AUDIT');

class InkFilterAudit {
  static final session = DateTime.now().toUtc().toIso8601String().replaceAll(
    ':',
    '-',
  );
  static final notice = ValueNotifier<String>('실제 펜 입력을 기다립니다');
  static final labels = ValueNotifier<String>('느린 직선');
  static final _active = <int, Map<String, dynamic>>{};
  static int _serial = 0;
  static Future<void> _writes = Future.value();
  static String get directory =>
      '/storage/emulated/0/Android/data/com.vitalguard.field/files/ink-filter-audit';

  static void begin(
    PointerDownEvent e,
    Rect rect,
    InkStroke stroke,
    double dpr,
    Size source,
  ) {
    _active[e.pointer] = {
      'session': session,
      'stroke': ++_serial,
      'label': labels.value,
      'kind': e.kind.name,
      'tool': stroke.tool.name,
      'device_pixel_ratio': dpr,
      'source_size': [source.width, source.height],
      'rect': [rect.left, rect.top, rect.width, rect.height],
      'rect_changed': false,
      'start_us': e.timeStamp.inMicroseconds,
      'last_us': e.timeStamp.inMicroseconds,
      'unfiltered_points': <List<double>>[List<double>.of(stroke.points.first)],
      'events': <List<num>>[
        [
          e.localPosition.dx,
          e.localPosition.dy,
          e.pressure,
          e.timeStamp.inMicroseconds,
        ],
      ],
    };
  }

  static void sample(PointerMoveEvent e, List<double> point, Rect rect) {
    final trace = _active[e.pointer];
    if (trace == null) return;
    final original = trace['rect'] as List<double>;
    if (original[0] != rect.left ||
        original[1] != rect.top ||
        original[2] != rect.width ||
        original[3] != rect.height) {
      trace['rect_changed'] = true;
    }
    (trace['unfiltered_points'] as List<List<double>>).add(
      List<double>.of(point),
    );
    (trace['events'] as List<List<num>>).add([
      e.localPosition.dx,
      e.localPosition.dy,
      e.pressure,
      e.timeStamp.inMicroseconds,
    ]);
    trace['last_us'] = e.timeStamp.inMicroseconds;
  }

  static void finish(int pointer, InkStroke kept, {required bool cancelled}) {
    final trace = _active.remove(pointer);
    if (trace == null) return;
    final rawPoints = trace['unfiltered_points'] as List<List<double>>;
    final raw = InkStroke(kept.tool, kept.color, kept.width, rawPoints);
    trace['cancelled'] = cancelled;
    trace['filtered_stroke'] = kept.toJson();
    trace['input_points'] = rawPoints.length;
    trace['kept_points'] = kept.points.length;
    trace['dropped_points'] = rawPoints.length - kept.points.length;
    trace['duration_us'] =
        (trace['last_us'] as int) - (trace['start_us'] as int);
    // This reports the exact existing JSON representation, holding rounding fixed.
    if (kept.tool != InkTool.eraser) {
      trace['unfiltered_json_bytes'] = encodeInk([raw]).length;
      trace['filtered_json_bytes'] = encodeInk([kept]).length;
    }
    final line = jsonEncode(trace);
    final id = trace['stroke'];
    final label = trace['label'];
    final summary =
        '$label · 획 $id: ${rawPoints.length} → ${kept.points.length}점';
    notice.value = summary;
    // One async append after pen-up, never logging/serializing during move dispatch.
    _writes = _writes
        .then((_) async {
          final file = File('$directory/$session.jsonl');
          await file.parent.create(recursive: true);
          await file.writeAsString(
            '$line\n',
            mode: FileMode.append,
            flush: true,
          );
          // ignore: avoid_print
          print(
            'VG_INK_AUDIT ${jsonEncode({'stroke': id, 'label': label, 'input': rawPoints.length, 'kept': kept.points.length, 'path': file.path})}',
          );
        })
        .catchError((Object error) {
          notice.value = '측정 파일 저장 실패: $error';
          // ignore: avoid_print
          print('VG_INK_AUDIT_ERROR $error');
        });
  }
}
