// P4 실측 단계의 최소 위젯 테스트.
// ⚠ 진단 화면은 실기기 입력을 전제로 하므로 여기서는 **뜨는지**만 본다.
//   실제 화면 테스트는 구현 단계에서 화면 ID 별로 쓴다(프로젝트 관례: 새 기능에 위젯 테스트 동반).
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/main.dart';

void main() {
  testWidgets('진단 화면이 뜨고 창 실측 헤더를 보여준다', (WidgetTester tester) async {
    await tester.pumpWidget(const VgFieldApp(diagnostics: true));

    expect(find.text('P4 실측 — 창·펜·키'), findsOneWidget);
    expect(find.text('초기화'), findsOneWidget);
    // 아직 아무 입력도 없으므로 안내 문구가 보인다
    expect(find.textContaining('여기에 펜으로 그어 보세요'), findsOneWidget);
  });
}
