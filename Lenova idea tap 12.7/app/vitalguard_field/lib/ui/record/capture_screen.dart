import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';
import 'capture_ocr.dart';
import 'record_screens.dart';

abstract interface class CaptureCamera {
  Future<void> initialize();
  Widget preview();
  Future<String> takePicture();
  Future<void> dispose();
}

class PluginCaptureCamera implements CaptureCamera {
  CameraController? _controller;

  @override
  Future<void> initialize() async {
    await dispose();
    final cameras = await availableCameras();
    if (cameras.isEmpty) throw const CaptureFailure('사용할 수 있는 카메라가 없습니다.');
    final selected = cameras.firstWhere(
      (camera) => camera.lensDirection == CameraLensDirection.back,
      orElse: () => cameras.first,
    );
    final controller = CameraController(
      selected,
      ResolutionPreset.max,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.jpeg,
    );
    _controller = controller;
    await controller.initialize();
  }

  CameraController get _ready {
    final value = _controller;
    if (value == null || !value.value.isInitialized) {
      throw const CaptureFailure('카메라 준비가 끝나지 않았습니다.');
    }
    return value;
  }

  @override
  Widget preview() => CameraPreview(_ready);

  @override
  Future<String> takePicture() async => (await _ready.takePicture()).path;

  @override
  Future<void> dispose() async {
    final controller = _controller;
    _controller = null;
    await controller?.dispose();
  }
}

String captureCameraErrorMessage(Object error) {
  if (error is CameraException &&
      const {
        'CameraAccessDenied',
        'CameraAccessDeniedWithoutPrompt',
        'CameraAccessRestricted',
      }.contains(error.code)) {
    return cameraPermissionDeniedMessage;
  }
  if (error is CaptureFailure) return error.message;
  if (error is CameraException && error.description?.isNotEmpty == true) {
    return '카메라를 열지 못했습니다: ${error.description}';
  }
  return '카메라를 열지 못했습니다.';
}

class CameraCaptureScreen extends StatefulWidget {
  const CameraCaptureScreen({super.key, this.camera});

  final CaptureCamera? camera;

  @override
  State<CameraCaptureScreen> createState() => _CameraCaptureScreenState();
}

class _CameraCaptureScreenState extends State<CameraCaptureScreen> {
  late final CaptureCamera camera;
  bool ready = false;
  bool taking = false;
  String? error;

  @override
  void initState() {
    super.initState();
    camera = widget.camera ?? PluginCaptureCamera();
    unawaited(initialize());
  }

  Future<void> initialize() async {
    if (mounted) setState(() => error = null);
    try {
      await camera.initialize();
      if (mounted) setState(() => ready = true);
    } catch (value) {
      if (!mounted) return;
      setState(() {
        ready = false;
        error = captureCameraErrorMessage(value);
      });
    }
  }

  Future<void> takePicture() async {
    if (!ready || taking) return;
    setState(() => taking = true);
    final capturedAt = DateTime.now();
    try {
      final path = await camera.takePicture();
      if (mounted) {
        Navigator.of(context).pop(CapturedOriginal(path, capturedAt));
      }
    } catch (value) {
      if (!mounted) return;
      setState(() {
        taking = false;
        error = captureCameraErrorMessage(value);
      });
    }
  }

  @override
  void dispose() {
    unawaited(camera.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: VgColors.ink,
    appBar: AppBar(
      toolbarHeight: vgToolbarHeight(context),
      title: VgToolbarTitle(
        '사진 촬영',
        textScaler: MediaQuery.textScalerOf(context),
      ),
    ),
    body: error != null
        ? Center(
            child: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.camera_alt_outlined,
                      size: 48,
                      color: Colors.white,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      error!,
                      key: const Key('camera-error'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, fontSize: 18),
                    ),
                    if (error != cameraPermissionDeniedMessage) ...[
                      const SizedBox(height: 16),
                      OutlinedButton(
                        onPressed: initialize,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                        ),
                        child: const Text('다시 시도'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          )
        : !ready
        ? const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(color: Colors.white),
                SizedBox(height: 16),
                Text(
                  '카메라 권한과 장치를 확인하는 중입니다.',
                  style: TextStyle(color: Colors.white),
                ),
              ],
            ),
          )
        : Stack(
            fit: StackFit.expand,
            children: [
              Center(child: camera.preview()),
              Positioned(
                left: 24,
                right: 24,
                bottom: 24,
                child: Center(
                  child: SizedBox(
                    width: 240,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 64),
                      child: FilledButton.icon(
                        key: const Key('take-picture'),
                        onPressed: taking ? null : takePicture,
                        icon: taking
                            ? const SizedBox(
                                width: 24,
                                height: 24,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.camera_alt),
                        label: Text(taking ? '촬영 중…' : '촬영'),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
  );
}

abstract interface class CaptureLauncher {
  Future<bool> prepareScanner();
  Future<CaptureRunResult?> capturePhoto(BuildContext context);
  Future<CaptureRunResult?> scanDocuments();
  Future<void> dispose();
}

class DeviceCaptureLauncher implements CaptureLauncher {
  DeviceCaptureLauncher(this.controller)
    : native = const DeviceCaptureNative(),
      text = MlKitCaptureText();

  final FieldController controller;
  final DeviceCaptureNative native;
  final MlKitCaptureText text;

  String? get _siteId {
    final siteId = controller.site?.site_id;
    if (siteId?.isNotEmpty == true) return siteId;
    // 배정 ID가 없으면 생략한다. 다른 보류 사진의 현장 ID를 빌리지 않는다.
    return null;
  }

  Future<CaptureRunResult> _process(
    List<String> paths,
    DateTime capturedAt,
    CaptureMode mode, {
    required String owner,
    required String? siteName,
    required String? siteId,
    required String workerName,
    required String workerId,
  }) async {
    final pipeline = CapturePipeline(
      DeviceCapturePipelinePort(
        controller: controller,
        native: native,
        text: text,
        owner: owner,
        siteName: siteName,
      ),
    );
    try {
      return await pipeline.process(
        originalPaths: paths,
        capturedAt: capturedAt,
        mode: mode,
        workerName: workerName,
        // JWT의 workerId를 각인에 그대로 쓴다. 폼 필드에는 넣지 않는다.
        workerId: workerId,
        siteId: siteId,
      );
    } finally {
      for (final path in paths) {
        try {
          await File(path).delete();
        } catch (_) {}
      }
    }
  }

  @override
  Future<bool> prepareScanner() => native.prepareDocumentScanner();

  @override
  Future<CaptureRunResult?> capturePhoto(BuildContext context) async {
    final author = controller.user!;
    final siteId = _siteId, siteName = controller.site?.site_name;
    final original = await Navigator.of(context).push<CapturedOriginal>(
      MaterialPageRoute(builder: (_) => const CameraCaptureScreen()),
    );
    if (original == null) return null;
    return _process(
      [original.path],
      original.capturedAt,
      CaptureMode.photo,
      owner: author.id,
      siteName: siteName,
      siteId: siteId,
      workerName: author.name ?? '-',
      workerId: author.workerId ?? '-',
    );
  }

  @override
  Future<CaptureRunResult?> scanDocuments() async {
    final author = controller.user!;
    final siteId = _siteId, siteName = controller.site?.site_name;
    final paths = await native.scanDocuments();
    if (paths == null || paths.isEmpty) return null;
    return _process(
      paths,
      DateTime.now(),
      CaptureMode.document,
      owner: author.id,
      siteName: siteName,
      siteId: siteId,
      workerName: author.name ?? '-',
      workerId: author.workerId ?? '-',
    );
  }

  @override
  Future<void> dispose() => text.close();
}

class CaptureActionPanel extends StatefulWidget {
  const CaptureActionPanel({
    super.key,
    required this.controller,
    this.onUploaded,
    this.launcher,
  });

  final FieldController controller;
  // 로컬 기록 목록의 갱신 알림이다. 서버 업로드를 뜻하지 않는다.
  final Future<void> Function()? onUploaded;
  final CaptureLauncher? launcher;

  @override
  State<CaptureActionPanel> createState() => _CaptureActionPanelState();
}

class _CaptureActionPanelState extends State<CaptureActionPanel> {
  late final CaptureLauncher launcher;
  late final bool ownsLauncher;
  bool busy = false;
  bool? scannerReady;
  String? operationMessage;

  @override
  void initState() {
    super.initState();
    ownsLauncher = widget.launcher == null;
    launcher = widget.launcher ?? DeviceCaptureLauncher(widget.controller);
    unawaited(prepareScanner());
  }

  Future<void> prepareScanner() async {
    var ready = false;
    try {
      ready = await launcher.prepareScanner();
    } catch (_) {
      ready = false;
    }
    if (mounted) setState(() => scannerReady = ready);
  }

  Future<void> run(CaptureMode mode) async {
    if (busy) return;
    setState(() {
      busy = true;
      operationMessage = '좌표·주소·글자를 확인하고 기기에 저장하는 중입니다.';
    });
    try {
      final result = mode == CaptureMode.photo
          ? await launcher.capturePhoto(context)
          : await launcher.scanDocuments();
      if (!mounted) return;
      if (result == null) {
        setState(() => operationMessage = null);
        return;
      }
      if (result.queued > 0) await widget.onUploaded?.call();
      if (!mounted) return;
      setState(() {
        operationMessage = [
          if (result.queued > 0)
            '기기에 저장됨 · ${result.queued}건 · 주석·메모를 붙인 뒤 전송',
          if (result.failed > 0) '${result.failed}건 처리 실패',
          if (result.lastError != null) result.lastError!,
        ].join('\n');
      });
      if (result.queuedIds.length == 1 && result.failed == 0) {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => PhotoDetail(
              controller: widget.controller,
              photoId: result.queuedIds.single,
            ),
          ),
        );
      }
    } on CaptureFailure catch (error) {
      if (mounted) setState(() => operationMessage = error.message);
    } catch (_) {
      if (mounted) setState(() => operationMessage = '촬영 기록을 처리하지 못했습니다.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    if (ownsLauncher) unawaited(launcher.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        children: [
          Expanded(
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: vgTapPrimary),
              child: FilledButton.icon(
                key: const Key('document-scan'),
                onPressed: busy ? null : () => run(CaptureMode.document),
                icon: const Icon(Icons.document_scanner_outlined),
                label: const Text('서류 스캔'),
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: vgTapPrimary),
              child: FilledButton.icon(
                key: const Key('photo-capture'),
                onPressed: busy ? null : () => run(CaptureMode.photo),
                icon: const Icon(Icons.photo_camera_outlined),
                label: const Text('사진 촬영'),
              ),
            ),
          ),
        ],
      ),
      if (scannerReady == false) ...[
        const SizedBox(height: 8),
        const Text(scannerPreparationMessage, key: Key('scanner-not-ready')),
      ],
      if (operationMessage != null) ...[
        const SizedBox(height: 8),
        Text(operationMessage!, key: const Key('capture-status')),
      ],
      if (busy) ...[const SizedBox(height: 8), const LinearProgressIndicator()],
    ],
  );
}
