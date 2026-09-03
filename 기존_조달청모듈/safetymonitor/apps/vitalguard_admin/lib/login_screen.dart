// 관리자 로그인 화면 — 관제웹과 같은 2단계 계약
//
// 1단계 `{id,password}` → 서버가 `twoFactorRequired` 로 되물으면 2단계에 `totpCode` 를 얹는다.
// ⚠ **중간 토큰이 없다.** 2단계 요청은 아이디·비밀번호를 다시 실어 보낸다(관제웹과 같다) —
//   그래서 코드 칸이 뜬 뒤에도 앞 두 칸의 값을 화면이 들고 있어야 한다.
import 'package:flutter/material.dart';

import 'session.dart';
import 'theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session, required this.onSignedIn});

  final Session session;
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  final _codeFocus = FocusNode();

  bool _busy = false;
  bool _needsCode = false;
  String? _error;

  @override
  void dispose() {
    _id.dispose();
    _password.dispose();
    _code.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final id = _id.text.trim();
    final password = _password.text;
    if (id.isEmpty || password.isEmpty) {
      setState(() => _error = '아이디와 비밀번호를 입력하세요.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });

    final result = await widget.session.login(
      id,
      password,
      totpCode: _needsCode ? _code.text.trim() : null,
    );
    if (!mounted) return;

    if (result.ok) {
      widget.onSignedIn();
      return;
    }
    setState(() {
      _busy = false;
      _error = result.message;
      if (result.twoFactorRequired) {
        // 코드 칸이 처음 뜨는 순간에만 비운다 — 오타 재입력에서 이미 지운 값을 또 지우지 않는다.
        if (!_needsCode) _code.clear();
        _needsCode = true;
      }
    });
    if (_needsCode) _codeFocus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'VitAlGuard',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.bold,
                      color: VgColors.primary,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    '관리자',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 15, color: VgColors.body),
                  ),
                  const SizedBox(height: 36),
                  TextField(
                    controller: _id,
                    enabled: !_busy,
                    autocorrect: false,
                    decoration: const InputDecoration(labelText: '관리자 ID'),
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _password,
                    enabled: !_busy,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: '비밀번호'),
                    textInputAction: _needsCode ? TextInputAction.next : TextInputAction.done,
                    onSubmitted: (_) => _busy ? null : _submit(),
                  ),
                  if (_needsCode) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: _code,
                      focusNode: _codeFocus,
                      enabled: !_busy,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      decoration: const InputDecoration(
                        labelText: '인증 코드',
                        helperText: '인증 앱의 6자리 코드',
                        counterText: '',
                      ),
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _busy ? null : _submit(),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Text(
                      _error!,
                      style: const TextStyle(color: VgColors.danger, fontSize: 13),
                    ),
                  ],
                  const SizedBox(height: 22),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 15),
                    ),
                    child: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : Text(_needsCode ? '확인' : '로그인'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
