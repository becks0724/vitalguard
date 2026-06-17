// 시공사 청구 제출 — 피검증자(시공사/현장 담당) 입력 화면. 검증 화면(/weekly-report)과 역할 분리.
import ContractorSubmitForm from "../components/ContractorSubmitForm";

export const metadata = {
  title: "시공사 청구 제출 — VitAlGuard",
  description: "세금계산서·계좌·대장·사진을 시공사가 제출(검증자 수정 불가)",
};

export default function ContractorPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <ContractorSubmitForm />
    </main>
  );
}
