// 국세청 사업자등록정보 상태조회 OpenAPI 클라이언트 (data.go.kr 15081808 / odcloud.kr).
// VitAlGuard ②사용축: 안전관리비 지출 세금계산서의 '발급처(공급자)'가 실존·정상 사업자인지 검증.
//   상태조회(status): 사업자번호 → 계속(01)/휴업(02)/폐업(03). 휴·폐업처 발급 세금계산서 = 위험 신호.
//   env 게이트(NTS_SERVICE_KEY ?? G2B_SERVICE_KEY, data.go.kr 계정 공통키) + 실패 시 mock 강등(KOSHA/G2B 패턴).
import "server-only";

const NTS_STATUS_URL = "https://api.odcloud.kr/api/nts-businessman/v1/status";

function serviceKey(): string | null {
  return process.env.NTS_SERVICE_KEY || process.env.G2B_SERVICE_KEY || null;
}

export type BusinessStatus = {
  bno: string; // 사업자등록번호(10자리)
  status: string; // 계속사업자 / 휴업자 / 폐업자 / 미등록
  statusCode: string; // 01 / 02 / 03 / ""
  taxType: string; // 과세유형
  closedDate?: string; // 폐업일(YYYYMMDD)
  ok: boolean; // 계속사업자(01) 여부 = 정상 발급처
};

export type NtsStatusPayload = { source: "live" | "mock"; items: BusinessStatus[]; note?: string };

function codeLabel(code: string): string {
  if (code === "01") return "계속사업자";
  if (code === "02") return "휴업자";
  if (code === "03") return "폐업자";
  return "미등록";
}

// 국세청 status 응답 row → 정규화. (필드: b_no / b_stt / b_stt_cd / tax_type / end_dt)
function normalizeStatus(row: Record<string, unknown>): BusinessStatus {
  const code = String(row.b_stt_cd ?? "").trim();
  const sttRaw = String(row.b_stt ?? "").trim();
  return {
    bno: String(row.b_no ?? "").trim(),
    status: sttRaw || codeLabel(code),
    statusCode: code,
    taxType: String(row.tax_type ?? "").trim(),
    closedDate: row.end_dt ? String(row.end_dt).trim() || undefined : undefined,
    ok: code === "01",
  };
}

// 데모용 결정적 mock — 끝자리로 상태 분기(정상/휴업/폐업 시연 가능).
function mockStatus(bno: string): BusinessStatus {
  const last = Number(bno.slice(-1)) || 0;
  if (last % 5 === 0) return { bno, status: "폐업자", statusCode: "03", taxType: "", closedDate: "20240630", ok: false };
  if (last % 5 === 1) return { bno, status: "휴업자", statusCode: "02", taxType: "부가가치세 일반과세자", ok: false };
  return { bno, status: "계속사업자", statusCode: "01", taxType: "부가가치세 일반과세자", ok: true };
}

export async function checkBusinessStatus(bnos: string[]): Promise<NtsStatusPayload> {
  const clean = bnos.map((b) => b.replace(/[^0-9]/g, "")).filter((b) => b.length === 10);
  if (clean.length === 0) return { source: "mock", items: [], note: "유효한 사업자번호(10자리)가 없습니다" };

  const key = serviceKey();
  if (!key) return { source: "mock", items: clean.map(mockStatus), note: "샘플 — 국세청 인증키 연결 시 실데이터로 전환" };

  try {
    const url = `${NTS_STATUS_URL}?serviceKey=${encodeURIComponent(key)}&returnType=JSON`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b_no: clean }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: unknown };
    const data = Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : [];
    if (data.length === 0) throw new Error("빈 응답");
    return { source: "live", items: data.map(normalizeStatus) };
  } catch (err) {
    console.error("[nts] checkBusinessStatus fallback to mock:", err);
    return { source: "mock", items: clean.map(mockStatus), note: "실 API 응답 실패 — 샘플 표시" };
  }
}
