import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.controller});
  final FieldController controller;
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final id = TextEditingController();
  final password = TextEditingController();
  final code = TextEditingController();
  bool remember = true;
  bool obscure = true;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && widget.controller.lockedUntil != null) setState(() {});
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    id.dispose();
    password.clear();
    password.dispose();
    code.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (widget.controller.busy ||
        (widget.controller.lockedUntil?.isAfter(DateTime.now()) ?? false)) {
      return;
    }
    if (widget.controller.authStage == AuthStage.totp) {
      if (code.text.length != 6) return;
      await widget.controller.submitTotp(code.text);
    } else if (id.text.trim().isNotEmpty && password.text.isNotEmpty) {
      await widget.controller.signIn(
        id.text.trim(),
        password.text,
        remember: remember,
      );
      if (!mounted) return;
      password.clear();
    } else {
      return;
    }
    if (!mounted) return;
    final failure = widget.controller.loginFailure;
    if (failure?.networkUnreachable != true) return;
    bool? hasInternet;
    try {
      hasInternet = await const MethodChannel('vitalguard/network')
          .invokeMethod<bool>('hasInternet');
    } catch (_) {
      // 채널이 없거나 확인에 실패해도 인터넷 연결 여부를 단정하지 않는다.
    }
    if (!mounted || widget.controller.loginFailure != failure) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        scrollable: true,
        title: Text(
          hasInternet == false
              ? '인터넷에 연결되어 있지 않습니다'
              : '서버에 연결할 수 없습니다',
        ),
        content: Text(switch (hasInternet) {
          false =>
            '기기의 Wi-Fi 가 꺼져 있거나 연결이 끊겼습니다. Wi-Fi 를 켜고 연결한 뒤 다시 로그인해 주세요.',
          true =>
            '인터넷은 연결되어 있습니다. 서버가 응답하지 않으니 잠시 후 다시 시도해 주세요. 계속되면 관리자에게 문의해 주세요.',
          null =>
            '인터넷 연결을 확인한 뒤 다시 로그인해 주세요. 계속되면 관리자에게 문의해 주세요.',
        }),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext),
            style: FilledButton.styleFrom(
              minimumSize: const Size(vgTapMin, vgTapMin),
            ),
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final totp = c.authStage == AuthStage.totp;
    final seconds = c.lockedUntil == null
        ? 0
        : c.lockedUntil!.difference(DateTime.now()).inSeconds + 1;
    final locked = seconds > 0;
    final title = switch (c.authStage) {
      AuthStage.restoring => '로그인 상태 확인 중',
      AuthStage.totp => '2단계 인증',
      AuthStage.denied => '이 앱을 사용할 수 없는 계정입니다',
      AuthStage.reauthenticate => '다시 로그인해 주세요',
      _ => 'VitAlGuard 현장',
    };
    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            key: const Key('auth-scroll'),
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (c.isMock)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 16),
                      child: Text(
                        '모의 데이터 · 비밀번호 mock · 아이디 totp는 인증번호 123456',
                        key: Key('mock-label'),
                      ),
                    ),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (c.authStage == AuthStage.restoring)
                    const LinearProgressIndicator(),
                  if (c.authStage == AuthStage.reauthenticate)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 16),
                      child: Text(
                        '기기에 저장된 기록은 보존됩니다. 다른 계정의 기록은 해당 계정으로 로그인한 뒤 확인할 수 있습니다.',
                      ),
                    ),
                  if (c.authStage == AuthStage.denied) ...[
                    const Text('현장 관리자 계정으로 로그인해 주세요.'),
                    const SizedBox(height: 16),
                    OutlinedButton(
                      onPressed: c.cancelSignIn,
                      child: const Text('다른 계정으로 로그인'),
                    ),
                  ] else if (c.authStage != AuthStage.restoring) ...[
                    if (totp) ...[
                      const Text('인증 앱에 표시된 6자리 숫자를 입력하세요.'),
                      const SizedBox(height: vgGapTap),
                      TextField(
                        controller: code,
                        key: const Key('totp-code'),
                        enabled: !c.busy && !locked,
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(6),
                        ],
                        decoration: const InputDecoration(
                          labelText: '인증번호',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.all(24),
                        ),
                        onSubmitted: (_) => submit(),
                      ),
                    ] else ...[
                      TextField(
                        controller: id,
                        key: const Key('login-id'),
                        enabled: !c.busy,
                        autocorrect: false,
                        decoration: const InputDecoration(
                          labelText: '아이디',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.all(24),
                        ),
                      ),
                      const SizedBox(height: vgGapTap),
                      TextField(
                        controller: password,
                        key: const Key('login-password'),
                        enabled: !c.busy,
                        obscureText: obscure,
                        autocorrect: false,
                        enableSuggestions: false,
                        decoration: InputDecoration(
                          labelText: '비밀번호',
                          border: const OutlineInputBorder(),
                          contentPadding: const EdgeInsets.all(24),
                          suffixIcon: IconButton(
                            tooltip: obscure ? '비밀번호 표시' : '비밀번호 숨기기',
                            onPressed: () => setState(() => obscure = !obscure),
                            icon: Icon(
                              obscure ? Icons.visibility : Icons.visibility_off,
                            ),
                          ),
                        ),
                        onSubmitted: (_) => submit(),
                      ),
                      const SizedBox(height: 16),
                      CheckboxListTile(
                        value: remember,
                        contentPadding: EdgeInsets.zero,
                        title: const Text('이 기기에서 로그인 유지'),
                        onChanged: c.busy
                            ? null
                            : (v) => setState(() => remember = v!),
                      ),
                    ],
                    if (locked)
                      Text('$seconds초 뒤 다시 시도할 수 있습니다. 서버가 알려준 잠금 시간입니다.'),
                    if (c.message != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(c.message!, key: const Key('auth-message')),
                      ),
                    const SizedBox(height: vgGapTap),
                    FilledButton(
                      key: const Key('auth-submit'),
                      onPressed: c.busy || locked ? null : submit,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(64),
                      ),
                      child: Text(
                        c.busy
                            ? '확인 중'
                            : totp
                            ? '인증번호 확인'
                            : '로그인',
                      ),
                    ),
                    if (totp)
                      Padding(
                        padding: const EdgeInsets.only(top: vgGapTap),
                        child: OutlinedButton(
                          onPressed: c.busy
                              ? null
                              : () {
                                  code.clear();
                                  c.cancelSignIn();
                                },
                          child: const Text('아이디부터 다시 입력'),
                        ),
                      ),
                    const SizedBox(height: 24),
                    const Text('계정 이용은 관리자에게 문의하세요. 앱은 비밀번호를 저장하지 않습니다.'),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
