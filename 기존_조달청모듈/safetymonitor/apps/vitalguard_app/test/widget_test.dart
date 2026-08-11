// 로그인 화면 스모크 테스트 — 핵심 입력 요소(아이디·비밀번호·로그인 버튼)가 렌더되는지 확인
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/main.dart';

void main() {
  testWidgets('로그인 화면 핵심 요소가 렌더된다', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    await tester.pump();

    // '로그인' 은 부제목과 버튼 두 곳에 있다(관제웹과 동일 구성).
    expect(find.text('로그인'), findsNWidgets(2));
    expect(find.text('ID'), findsOneWidget);
    expect(find.text('비밀번호'), findsOneWidget);
    expect(find.text('OPEN SAFETY · NEVER ALONE'), findsOneWidget);
  });
}
