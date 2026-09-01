// 관제 홈 최하단 사이트 푸터 — 공개 문서 진입점(2026-08-31 사용자 지시, 네이버 푸터 형태 참고).
// 목적은 하나: 로그인 없이 봐야 하는 개인정보 처리방침으로 가는 길을 화면에 두는 것.
// ⚠ 아직 문서가 없는 항목은 링크로 만들지 않는다 — 죽은 링크를 놓는 대신 준비 중으로 표시한다.
//    (문서가 생기면 href 를 채우기만 하면 되도록 같은 배열에서 갈린다.)
const FOOTER_LINKS: { label: string; href?: string; emphasis?: boolean }[] = [
  { label: "회사소개" },
  { label: "제휴제안" },
  { label: "이용약관" },
  { label: "개인정보처리방침", href: "/privacy", emphasis: true },
];

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1280px] px-6 pb-8 pt-2 max-[640px]:px-4">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-hairline pt-5 text-xs">
        {FOOTER_LINKS.map((item, index) => (
          <span className="flex items-center gap-x-3" key={item.label}>
            {index > 0 ? <span aria-hidden="true" className="h-3 w-px bg-hairline-strong" /> : null}
            {item.href ? (
              <a
                className={
                  "transition hover:text-primary " +
                  (item.emphasis ? "font-semibold text-body-strong" : "text-body")
                }
                href={item.href}
              >
                {item.label}
              </a>
            ) : (
              <span className="cursor-default text-muted" title="준비 중입니다">
                {item.label}
              </span>
            )}
          </span>
        ))}
        <span aria-hidden="true" className="h-3 w-px bg-hairline-strong" />
        <span className="font-semibold text-body-strong">© VitAlGuard</span>
      </div>
    </footer>
  );
}
