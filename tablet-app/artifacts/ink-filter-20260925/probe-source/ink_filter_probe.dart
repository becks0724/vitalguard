import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ink_filter_audit.dart';
import 'package:vitalguard_field/ui/record/record_editor.dart';
import 'package:vitalguard_field/vg_theme.dart';

Future<Uint8List> blankPage() async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawColor(Colors.white, BlendMode.src);
  final grid = Paint()
    ..color = const Color(0xffe6e8eb)
    ..strokeWidth = 1;
  for (var y = 50.0; y < 1500; y += 50) {
    canvas.drawLine(Offset(0, y), Offset(1200, y), grid);
  }
  for (var x = 50.0; x < 1200; x += 50) {
    canvas.drawLine(Offset(x, 0), Offset(x, 1500), grid);
  }
  final picture = recorder.endRecording();
  final image = await picture.toImage(1200, 1500);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  return data!.buffer.asUint8List();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!inkAuditEnabled) throw StateError('VG_INK_AUDIT=true is required');
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  final controller = FieldCoordinator(
    MockGateway(),
    MemoryStore(),
    MockSpeechInput(),
  );
  await controller.signIn('ink-audit-local-only', 'mock');
  if (controller.authStage != AuthStage.ready) {
    runApp(
      MaterialApp(
        home: Scaffold(
          body: Center(child: Text('측정 준비 실패: ${controller.message}')),
        ),
      ),
    );
    return;
  }
  final entry = await controller.outbox.enqueue(
    kind: OutboxKind.photo,
    bytes: await blankPage(),
    fields: {
      'title': '잉크 필터 실측용 격자',
      'dateKey': '2026-09-25',
      'siteId': 'ink-audit-only',
    },
    siteName: '기기 안에서만 측정',
  );
  final original = CalendarMedia({
    'id': entry.id,
    'date_key': '2026-09-25',
    'local': true,
    'site_id': 'ink-audit-only',
  });
  runApp(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: vgLightTheme(),
      home: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              const Padding(
                padding: EdgeInsets.all(10),
                child: Text(
                  '잉크 필터 실측 · 실제 펜으로 그려 주세요\n느린 직선 2개 → 느린 원 2개 → 평소 속도로 “안전”',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 20),
                ),
              ),
              ValueListenableBuilder<String>(
                valueListenable: InkFilterAudit.labels,
                builder: (_, value, _) => Wrap(
                  spacing: 12,
                  children: [
                    for (final label in ['느린 직선', '느린 원', '일반 필기'])
                      ChoiceChip(
                        label: Text(label),
                        selected: value == label,
                        onSelected: (_) => InkFilterAudit.labels.value = label,
                      ),
                  ],
                ),
              ),
              ValueListenableBuilder<String>(
                valueListenable: InkFilterAudit.notice,
                builder: (_, value, _) => Padding(
                  padding: const EdgeInsets.all(6),
                  child: Text(value),
                ),
              ),
              Expanded(
                child: Row(
                  children: [
                    const SizedBox(width: 80),
                    Expanded(
                      child: RecordEditor(
                        controller: controller,
                        original: original,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
