// 현장 관리자 청구 제출 — 피검증자 입력 화면. 검증 화면(/weekly-report)과 역할 분리.
// ⚠ 계정 유형 표기는 '현장 관리자'다(2026-08-28). 다만 아래 설명문의 '시공사'는 유형이 아니라
//   공사를 시공하는 회사를 가리키는 일반 명사라 그대로 둔다 — 바꾸면 뜻이 흐려진다.
import { LoginGate } from "../components/LoginGate";
import ContractorSubmitForm from "../components/ContractorSubmitForm";

export const metadata = {
  title: "현장 관리자 청구 제출 — VitAlGuard",
  description: "세금계산서·계좌·대장·사진을 시공사가 제출(검증자 수정 불가)",
};

export default function ContractorPage() {
  return (
    <LoginGate>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <ContractorSubmitForm />
      </main>
    </LoginGate>
  );
}
