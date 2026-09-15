import 'dart:async';

import 'package:flutter/material.dart';

import 'data/contracts/field_contracts.dart';
import 'data/field_coordinator.dart';
import 'data/live/device_services.dart';
import 'data/live/device_voice_recorder.dart';
import 'data/live/live_gateway.dart';
import 'data/mock/memory_store.dart';
import 'data/mock/mock_gateway.dart';
import 'data/mock/mock_voice_recorder.dart';
import 'ui/auth/auth_screen.dart';
import 'ui/shell/field_shell.dart';
import 'vg_theme.dart';

// 구현 선택은 조립 지점에서만 한다. ui/는 contracts만 의존한다.
class FieldApp extends StatefulWidget {
  const FieldApp({super.key, this.controller});
  final FieldController? controller;
  @override
  State<FieldApp> createState() => _FieldAppState();
}

class _FieldAppState extends State<FieldApp> {
  late final FieldController controller;

  @override
  void initState() {
    super.initState();
    const mock = bool.fromEnvironment('VG_MOCK');
    controller =
        widget.controller ??
        FieldCoordinator(
          mock ? MockGateway() : LiveGateway(),
          mock ? MemoryStore() : DeviceLocalStore(),
          mock ? MockSpeechInput() : DeviceSpeechInput(),
          recorder: mock ? MockVoiceRecorder() : DeviceVoiceRecorder(),
        );
    unawaited(controller.initialize());
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'VitAlGuard 현장',
    theme: vgLightTheme().copyWith(
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(minimumSize: const Size(56, 56)),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(minimumSize: const Size(56, 56)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(56, 56)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(56, 56)),
      ),
    ),
    debugShowCheckedModeBanner: false,
    home: AnimatedBuilder(
      animation: controller,
      builder: (_, _) => controller.authStage == AuthStage.ready
          ? FieldShell(
              key: ValueKey(controller.user!.id),
              controller: controller,
            )
          : AuthScreen(controller: controller),
    ),
  );
}
