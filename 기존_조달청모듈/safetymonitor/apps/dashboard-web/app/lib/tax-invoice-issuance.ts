// 국세청 홈택스 '제3자 전자(세금)계산서 발급사실 조회' — CODEF 중계 API 클라이언트.
// VitAlGuard ②사용축 확장: 시공사 제출 세금계산서가 실제 국세청에 전송(발급)됐는지 5요소로 확인.
//   5요소 = 공급자·공급받는자 사업자번호 + 승인번호 + 작성일자 + 공급가액.
//   용도 = 위조 세금계산서(가짜 승인번호) 적발 + 지급 직전 재조회(제출 후 취소 감시 L1 — 조회 시각 기록).
// 스펙(developer.codef.io 개발가이드 2025-11-14 원문 확인):
//   POST {base}/v1/kr/public/nt/third-party/tax-invoice-issue
//   간편인증 로그인(loginType=5, 카카오 등 개인 실명) → CF-03002 continue2Way → 사용자 앱 승인 → is2Way 재요청.
//   출력 = resAuthenticity("1"=발급사실 있음/"0"=없음) + resAuthenticityDesc.
//   env 게이트(CODEF_CLIENT_ID/SECRET + CODEF_AUTH_*) + 미설정·실패 시 mock 강등(nts.ts 패턴).
import "server-only";

const OAUTH_URL = "https://oauth.codef.io/oauth/token";
const DEFAULT_PATH = "/v1/kr/public/nt/third-party/tax-invoice-issue";

type Creds = {
  id: string;
  secret: string;
  path: string;
  base: string;
  auth: { loginTypeLevel: string; userName: string; phoneNo: string; identity: string; telecom?: string };
};

function credentials(): Creds | null {
  const id = process.env.CODEF_CLIENT_ID;
  const secret = process.env.CODEF_CLIENT_SECRET;
  // 간편인증 실명 정보(팀원 1인) — 전부 있어야 실호출 가능.
  const userName = process.env.CODEF_AUTH_NAME;
  const phoneNo = process.env.CODEF_AUTH_PHONE;
  const identity = process.env.CODEF_AUTH_BIRTH; // YYYYMMDD
  if (!id || !secret || !userName || !phoneNo || !identity) return null;
  return {
    id,
    secret,
    path: process.env.CODEF_TAXINVOICE_PATH || DEFAULT_PATH,
    base: process.env.CODEF_API_BASE || "https://development.codef.io",
    auth: {
      loginTypeLevel: process.env.CODEF_AUTH_LOGIN_LEVEL || "1", // 1=카카오톡
      userName,
      phoneNo,
      identity,
      telecom: process.env.CODEF_AUTH_TELECOM || undefined,
    },
  };
}

export type TaxInvoiceQuery = {
  supplierBno: string; // 공급자 사업자번호(10자리)
  buyerBno: string; // 공급받는자 사업자번호(10자리)
  approvalNo: string; // 승인번호(숫자만)
  writeDate: string; // 작성일자(YYYYMMDD)
  supplyAmount: string; // 공급가액(숫자)
};

// CF-03002 추가인증(간편인증 승인 대기) 상태 전달용
export type TwoWayInfo = { jobIndex: number; threadIndex: number; jti: string; twoWayTimestamp: number };

export type TaxInvoiceIssuancePayload = {
  source: "live" | "mock";
  issued: boolean | null; // true=발급사실 있음 / false=없음 / null=판독 불가·인증 대기
  statusText: string;
  checkedAt: string; // 조회 시각(ISO) — 지급 직전 재조회 기록용
  pendingAuth?: TwoWayInfo; // 있으면 간편인증(카카오) 승인 대기 — 승인 후 재요청 필요
  note?: string;
};

// OAuth 토큰 캐시(만료 60초 여유)
let tokenCache: { token: string; expiresAt: number } | null = null;

async function accessToken(c: Creds): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=read",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`oauth HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("oauth no token");
  tokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000 };
  return json.access_token;
}

// S9 데모 시나리오 승인번호(광주 스마트인재개발원 · 대한안전산업 청구건)
const DEMO_APPROVAL_NO = "202606174100001277120034";

// 데모용 결정적 mock — 시나리오 승인번호=발급사실 있음, 그 외=없음(위조 적발 시연).
function mockIssuance(q: TaxInvoiceQuery): TaxInvoiceIssuancePayload {
  const issued = q.approvalNo === DEMO_APPROVAL_NO;
  return {
    source: "mock",
    issued,
    statusText: issued ? "국세청 전송 확인 (데모 시나리오)" : "발급사실 없음 — 미전송·위조 의심",
    checkedAt: new Date().toISOString(),
    note: "데모 — CODEF 키(.env) 연결 시 홈택스 실조회로 전환",
  };
}

// CODEF 응답은 URL 인코딩 JSON 인 경우가 있어 이중 파싱.
function parseCodefBody(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return JSON.parse(decodeURIComponent(text.replace(/\+/g, " "))) as Record<string, unknown>;
  }
}

export async function checkTaxInvoiceIssuance(q: TaxInvoiceQuery, twoWay?: TwoWayInfo): Promise<TaxInvoiceIssuancePayload> {
  const c = credentials();
  if (!c) return mockIssuance(q);

  try {
    const token = await accessToken(c);
    // 개발가이드 원문 파라미터(간편인증 loginType=5). 추가인증 재요청 시 is2Way + twoWayInfo 동봉.
    const body: Record<string, unknown> = {
      organization: "0004",
      loginType: "5",
      loginTypeLevel: c.auth.loginTypeLevel,
      userName: c.auth.userName,
      phoneNo: c.auth.phoneNo,
      identity: c.auth.identity,
      ...(c.auth.telecom ? { telecom: c.auth.telecom } : {}),
      id: `vitalguard-${c.auth.phoneNo}`,
      supplierRegNumber: q.supplierBno,
      contractorRegNumber: q.buyerBno,
      approvalNo: q.approvalNo,
      reportingDate: q.writeDate,
      supplyValue: q.supplyAmount,
      ...(twoWay ? { simpleAuth: "1", is2Way: true, twoWayInfo: twoWay } : {}),
    };
    const res = await fetch(`${c.base}${c.path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(twoWay ? 280_000 : 60_000), // 추가인증 처리 지연 대비(가이드 timeout 300/270초)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = parseCodefBody(await res.text());
    const result = json.result as Record<string, unknown> | undefined;
    const code = String(result?.code ?? "");
    const data = (json.data ?? {}) as Record<string, unknown>;

    // CF-03002 = 간편인증(카카오 등) 승인 대기 — twoWayInfo 를 클라이언트에 넘겨 승인 후 재요청.
    if (code === "CF-03002" && data.continue2Way === true) {
      return {
        source: "live",
        issued: null,
        statusText: "간편인증 대기 — 카카오톡 승인 후 '인증 완료'를 누르세요",
        checkedAt: new Date().toISOString(),
        pendingAuth: {
          jobIndex: Number(data.jobIndex ?? 0),
          threadIndex: Number(data.threadIndex ?? 0),
          jti: String(data.jti ?? ""),
          twoWayTimestamp: Number(data.twoWayTimestamp ?? 0),
        },
      };
    }
    if (code !== "CF-00000") throw new Error(`CODEF ${code} ${String(result?.message ?? "")}`);

    // 출력부: resAuthenticity "1"=발급사실 있음 / "0"=없음
    const authenticity = String(data.resAuthenticity ?? "").trim();
    const issued = authenticity === "1" ? true : authenticity === "0" ? false : null;
    const statusText =
      String(data.resAuthenticityDesc ?? "").trim() ||
      (issued === true ? "국세청 발급사실 확인" : issued === false ? "발급사실 없음" : "응답 판독 불가 — 원문 확인 필요");
    return { source: "live", issued, statusText, checkedAt: new Date().toISOString() };
  } catch (err) {
    console.error("[tax-invoice-issuance] fallback to mock:", err);
    return { ...mockIssuance(q), note: "실 API 응답 실패 — 샘플 표시" };
  }
}
