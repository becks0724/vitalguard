// PDF 텍스트 추출 — pdfjs-dist(legacy 빌드, Node 서버용) 텍스트 레이어만 사용(렌더링 없음).
// hwp/hwpx 직접 파싱은 인코딩 깨짐이 잦아 지원하지 않는다 — 감독관이 PDF 변환 후 업로드하는 계약.
const MAX_PAGES = 40;

export async function extractPdfText(data: Uint8Array, maxChars = 20_000): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data });
  try {
    const doc = await loadingTask.promise;
    let out = "";
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= pages && out.length < maxChars; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    // 추출 텍스트의 연속 공백 정리(태깅 키워드 매칭 안정화).
    return out.replace(/[ \t]+/g, " ").slice(0, maxChars).trim();
  } finally {
    await loadingTask.destroy();
  }
}
