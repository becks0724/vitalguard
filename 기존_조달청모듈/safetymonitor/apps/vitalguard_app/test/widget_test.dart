// 로그인 화면 스모크 테스트 — 핵심 입력 요소(아이디·비밀번호·로그인 버튼)가 렌더되는지 확인
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/main.dart';

void main() {
  testWidgets('로그인 화면 핵심 요소가 렌더된다', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    await tester.pump();

    expect(find.text('로그인'), findsOneWidget);
    expect(find.text('아이디'), findsOneWidget);
    expect(find.text('비밀번호'), findsOneWidget);
  });
}
