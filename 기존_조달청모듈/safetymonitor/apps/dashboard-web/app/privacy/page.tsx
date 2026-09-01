// 보안·개인정보 신뢰 페이지 — 로그인 없이 접근하는 유일한 공개 문서 라우트.
// 내용 원칙: 코드·스키마·운영에서 확인된 사실만 적는다(ensureSchema·CLAUDE.md 관례가 근거).
// 동의서·철회 창구가 미구현(코드 0건)인 현실을 숨기지 않고 "시행 예정 초안"으로 명시한다.
// 서버 컴포넌트 단독(클라 JS 0) — 신뢰 문서는 정적이 정직하다. 테마는 루트 부트스트랩(html.dark)을 따른다.
import type { Metadata } from "next";

import { PrivacyScrollHero } from "../components/PrivacyScrollHero";

export const metadata: Metadata = {
  title: "보안과 개인정보 보호 | VitAlGuard",
  description:
    "VitAlGuard가 현장에서 무엇을 수집하고, 어디로 보내고, 어떻게 지키는지 정리한 공개 문서입니다.",
};

// ── 데이터 경로 레일(히어로 우측) — 실제 수집 경로 그대로 4단계 ──────────────────
const DATA_PATH = [
  {
    title: "워치가 측정",
    desc: "심박, 산소포화도, 피부온, 가속도. 단말 판정은 즉시성이 필요한 낙상 감지뿐입니다.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="7" y="6" width="10" height="12" rx="3" />
        <path d="M9.5 6V3h5v3M9.5 18v3h5v-3" />
      </svg>
    ),
  },
  {
    title: "폰이 암호화 전송",
    desc: "전 구간 HTTPS에 수명 15분의 앱 토큰을 붙여 보냅니다. 실패분은 기기 안 큐에서 재시도합니다.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="8" y="3" width="8" height="18" rx="2" />
        <path d="M11 18h2" />
      </svg>
    ),
  },
  {
    title: "국내 서버가 저장·판정",
    desc: "서울 리전(asia-northeast3)에서 저장하고 위험 판정도 서버가 합니다. 생체 데이터는 국내에 머뭅니다.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="4" y="4" width="16" height="7" rx="2" />
        <rect x="4" y="13" width="16" height="7" rx="2" />
        <path d="M8 7.5h.01M8 16.5h.01" />
      </svg>
    ),
  },
  {
    title: "허가된 화면에만 표시",
    desc: "로그인과 2단계 인증을 통과한 담당자에게, 권한이 있는 범위만 서버가 잘라서 보여줍니다.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M9 21h6M12 17v4" />
      </svg>
    ),
  },
];

// ── 보안 조치 — 이 세션까지 코드로 확인된 것만 ───────────────────────────────────
const SAFEGUARDS = [
  {
    title: "비밀번호는 원문을 저장하지 않습니다",
    desc: "scrypt 단방향 해시만 보관합니다. 운영자도 비밀번호 원문을 볼 수 없습니다.",
  },
  {
    title: "2단계 인증(TOTP)",
    desc: "관제 계정은 인증 앱의 일회용 번호를 추가로 요구할 수 있습니다.",
  },
  {
    title: "로그인 잠금",
    desc: "같은 접속 위치와 계정에서 로그인 실패가 반복되면 시도 자체를 일정 시간 차단합니다.",
  },
  {
    title: "짧은 토큰 수명",
    desc: "접속 토큰은 15분마다 만료됩니다. 갱신용 토큰조차 서버에는 SHA-256 해시로만 남습니다.",
  },
  {
    title: "권한은 서버가 자릅니다",
    desc: "화면에서 숨기는 방식이 아닙니다. 권한 밖 데이터는 서버 응답에서 애초에 제외됩니다.",
  },
  {
    title: "전송 구간 암호화",
    desc: "워치에서 관제 화면까지 모든 구간이 HTTPS입니다. 평문 전송 구간이 없습니다.",
  },
];

// ── 외부 전송 내역 — 나가는 것과 나가지 않는 것을 같은 행에서 대조 ────────────────
const OUTBOUND = [
  {
    dest: "네이버클라우드 HyperCLOVA X",
    role: "현장 어시스턴트(챗봇) 답변 생성 · 국내 처리",
    sent: "질문 텍스트와 가명 처리된 사번",
    kept: "작업자 실명과 보호자 연락처. 답변의 실명 표기는 모델 응답이 끝난 뒤 서버가 붙입니다.",
  },
  {
    dest: "텔레그램",
    role: "긴급 경보 통지 · 국외 사업자",
    sent: "경보 종류와 마스킹된 이름(예: 홍○동)",
    kept: "심박 등 생체 수치. 국외 서비스에는 수치를 싣지 않는 것이 원칙입니다.",
  },
  {
    dest: "네이버클라우드 Object Storage",
    role: "현장 사진·영상 보관 · 국내 리전",
    sent: "업로드된 현장 기록 파일",
    kept: "무제한 공개 링크. 열람은 기한이 있는 서명 링크로만 이뤄집니다.",
  },
];

// ── 아직 완성되지 않은 것 — 정직 공개 ──────────────────────────────────────────
const PENDING = [
  {
    title: "수집 동의와 철회 창구",
    desc: "동의서 수령과 철회 처리 기능이 아직 구현되지 않았습니다. 상용 개시 전 필수 과제로 관리하고 있습니다.",
  },
  {
    title: "보존·파기 정책",
    desc: "데이터 보존 기간과 파기 절차가 확정되지 않았습니다. 산업재해 기록은 관계 법령의 보존 의무를 따르도록 설계합니다.",
  },
  {
    title: "처리방침 법률 검토",
    desc: "아래 전문은 법률 검토 전 초안입니다. 검토를 거쳐 시행일과 책임자를 확정한 뒤 시행합니다.",
  },
];

// ── 처리방침 전문(초안) — 수집 항목 표는 정본 스키마(ensureSchema) 기준 ───────────
const COLLECTED = [
  { group: "관제 계정", items: "아이디, 이름, 회사(상호), 연락처, 이메일, 부서·직책·사원번호", note: "가입 신청 시 입력, 승인제" },
  { group: "작업자 신원", items: "이름, 사원번호, 직급, 보호자 이름·연락처", note: "긴급 상황 연락 목적" },
  { group: "생체 신호", items: "심박, 산소포화도, 피부온, 심박변이도, 호흡수, 걸음, 활동에너지, 가속도", note: "워치 측정, 5초 배치 전송" },
  { group: "위치 정보", items: "위도·경도(작업 중 측위)", note: "구획 이탈·위험구역 판정 목적" },
  { group: "현장 기록", items: "현장 사진·영상, 문서 인식 텍스트, 촬영 위치·주소", note: "작업 일지·증빙 목적" },
  { group: "접속·기기 기록", items: "로그인 시도 이력, 기기 이름·플랫폼, 세션 정보", note: "부정 접속 차단 목적" },
];

const ARTICLES = [
  {
    no: "제1조",
    title: "처리 목적",
    body: "수집한 정보는 작업자 안전 상태의 실시간 관제, 위험 상황 감지와 경보, 사고 발생 시 구조·대응, 안전 기록의 보존을 위해서만 처리합니다. 목적 밖 이용과 제3자 판매는 하지 않습니다.",
  },
  {
    no: "제2조",
    title: "수집 항목",
    body: "수집 항목은 아래 표와 같습니다. 표에 없는 항목은 수집하지 않습니다.",
    table: true,
  },
  {
    no: "제3조",
    title: "보유와 파기",
    body: "보유 기간과 파기 절차는 법률 검토를 거쳐 확정합니다. 산업재해 관련 기록은 관계 법령이 정한 보존 의무를 따르며, 사고 기록 원장은 사후 검증을 위해 수정·삭제 없이 보존하는 구조로 설계되어 있습니다.",
  },
  {
    no: "제4조",
    title: "처리 위탁과 국외 이전",
    body: "위 \"밖으로 나가는 것\" 표의 범위에서 처리를 위탁합니다. 국외 사업자(텔레그램)에는 생체 수치를 전송하지 않고 이름을 마스킹하는 최소화 원칙을 적용합니다. 생체 신호의 저장과 AI 처리는 모두 국내 리전에서 이뤄집니다.",
  },
  {
    no: "제5조",
    title: "정보주체의 권리",
    body: "작업자와 계정 사용자는 자신의 정보에 대한 열람, 정정, 삭제, 처리정지를 요구할 수 있습니다. 전용 창구가 마련되기 전까지는 관제 운영 담당자를 통해 요청을 접수하며, 접수된 요청은 지체 없이 처리합니다.",
  },
  {
    no: "제6조",
    title: "안전성 확보조치",
    body: "비밀번호 단방향 해시(scrypt), 2단계 인증, 로그인 시도 제한, 접속 토큰 15분 만료, 서버 측 권한 검증과 데이터 트리밍, 전 구간 HTTPS 암호화를 적용하고 있습니다.",
  },
  {
    no: "제7조",
    title: "자동 수집 장치",
    body: "광고·행태 추적 쿠키를 사용하지 않습니다. 브라우저 저장소는 로그인 세션 유지와 화면 테마 설정에만 사용합니다.",
  },
  {
    no: "제8조",
    title: "책임자와 시행일",
    body: "개인정보 보호책임자는 상용 서비스 개시 전에 지정해 이 문서에 공개합니다. 이 방침은 법률 검토 전 초안이며, 시행일은 검토 완료 후 확정합니다.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* 상단 바 */}
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <a href="/" className="flex items-center gap-2.5">
            <img src="/brand/vitalguard-logo-light.png" alt="" className="h-8 w-8 rounded-lg object-cover dark:hidden" />
            <img src="/brand/vitalguard-logo-dark.png" alt="" className="hidden h-8 w-8 rounded-lg object-cover dark:block" />
            <span className="text-sm font-semibold tracking-tight">VitAlGuard</span>
          </a>
          <a
            href="/"
            className="rounded-full border border-hairline-strong px-4 py-1.5 text-xs font-semibold text-body-strong transition hover:bg-surface-soft active:scale-[0.98]"
          >
            관제 대시보드
          </a>
        </div>
      </header>

      {/* 히어로 — 스크롤 진행도로 사진이 확대되는 전면 스테이지(스크롤 잠금 없음) */}
      <PrivacyScrollHero />

      {/* 데이터가 다니는 길 — 히어로에서 분리해 독립 섹션으로. 실제 수집 경로 그대로이고,
          단계 번호는 장식이 아니라 진짜 순서다(측정 → 전송 → 저장 → 표시). */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">데이터가 다니는 길</h2>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-body">
            워치가 잰 값이 관제 화면에 닿기까지 거치는 네 단계입니다. 각 단계에서 무엇을 하는지 그대로 적었습니다.
          </p>
          <ol className="mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
            {DATA_PATH.map((step, index) => (
              <li className="border-t-2 border-primary/40 pt-5" key={step.title}>
                <div className="flex items-center gap-2">
                  <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-hairline-strong bg-surface-card text-primary">
                    {step.icon}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-muted">{index + 1}</span>
                </div>
                <h3 className="mt-3 text-[15px] font-semibold text-body-strong">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-body">{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 보안 조치 — 2열 그리드, 카드 대신 hairline 리듬 */}
      <section className="border-t border-hairline bg-canvas-soft">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">지키는 방식</h2>
          <p className="mt-2 text-sm text-body">아래 여섯 가지는 문서상 계획이 아니라 현재 코드에 구현되어 동작 중인 조치입니다.</p>
          <div className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
            {SAFEGUARDS.map((s) => (
              <div key={s.title} className="border-t border-hairline-strong pt-4">
                <h3 className="text-[15px] font-semibold text-body-strong">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-body">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 외부 전송 — 나가는 것 / 나가지 않는 것 대조 행 */}
      <section className="border-t border-hairline">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">밖으로 나가는 것, 나가지 않는 것</h2>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-body">
            외부 서비스로 나가는 데이터는 아래가 전부입니다. 각 행의 오른쪽이 이 페이지에서 가장 중요한 칸입니다.
          </p>
          <div className="mt-10 space-y-8">
            {OUTBOUND.map((o) => (
              <div key={o.dest} className="grid gap-4 border-t border-hairline-strong pt-5 md:grid-cols-[1.1fr_1fr_1fr] md:gap-8">
                <div>
                  <h3 className="text-[15px] font-semibold text-body-strong">{o.dest}</h3>
                  <p className="mt-1 text-xs text-muted">{o.role}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-body-strong">나가는 것</p>
                  <p className="mt-1 text-sm leading-relaxed text-body">{o.sent}</p>
                </div>
                <div className="rounded-2xl bg-primary-subtle px-4 py-3">
                  <p className="text-xs font-semibold text-primary">나가지 않는 것</p>
                  <p className="mt-1 text-sm leading-relaxed text-body">{o.kept}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 text-xs leading-relaxed text-muted">
            기상청 등 공공 데이터 조회에는 개인정보를 보내지 않습니다. 현장 좌표 기반의 날씨·특보 조회만 이뤄집니다.
          </p>
        </div>
      </section>

      {/* 정직 공개 — 미구현 항목 */}
      <section className="border-t border-hairline bg-canvas-soft">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">아직 완성되지 않은 것</h2>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-body">
            다 되어 있다고 말하지 않습니다. 실증 단계인 지금, 남아 있는 과제는 다음 세 가지입니다.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PENDING.map((p, i) => (
              <div key={p.title} className="rounded-2xl border border-hairline-strong bg-surface-card p-5">
                <p className="text-xs font-semibold text-muted">{i + 1}</p>
                <h3 className="mt-2 text-[15px] font-semibold text-body-strong">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-body">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 처리방침 전문(초안) — 문서 타이포그래피 */}
      <section id="policy" className="border-t border-hairline">
        <div className="mx-auto max-w-3xl px-5 py-16 md:py-20">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">개인정보 처리방침</h2>
            <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">법률 검토 전 초안</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-body">
            VitAlGuard(이하 &ldquo;서비스&rdquo;)는 산업 현장 작업자의 안전 관제를 위해 개인정보를 처리합니다. 이 방침은
            상용 서비스 개시 전 시행을 목표로 작성된 초안이며, 확정 시 시행일과 함께 이 페이지에 게시합니다.
          </p>

          <div className="mt-10 space-y-10">
            {ARTICLES.map((a) => (
              <article key={a.no}>
                <h3 className="text-base font-semibold text-body-strong">
                  {a.no} <span className="ml-1">{a.title}</span>
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-body">{a.body}</p>
                {a.table ? (
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-hairline-strong">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="bg-surface-strong/60 text-xs text-body-strong">
                          <th className="px-4 py-2.5 font-semibold">구분</th>
                          <th className="px-4 py-2.5 font-semibold">항목</th>
                          <th className="px-4 py-2.5 font-semibold">비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {COLLECTED.map((row) => (
                          <tr key={row.group} className="border-t border-hairline align-top">
                            <td className="whitespace-nowrap px-4 py-3 font-medium text-body-strong">{row.group}</td>
                            <td className="px-4 py-3 leading-relaxed text-body">{row.items}</td>
                            <td className="px-4 py-3 text-xs leading-relaxed text-muted">{row.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 푸터 */}
      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-10 text-xs text-muted md:flex-row md:items-center md:justify-between">
          <p>VitAlGuard는 스마트 안전장비 실증 사업의 데모 서비스입니다.</p>
          <a href="/" className="font-semibold text-text-link hover:underline">
            관제 대시보드로 이동
          </a>
        </div>
      </footer>
    </div>
  );
}
