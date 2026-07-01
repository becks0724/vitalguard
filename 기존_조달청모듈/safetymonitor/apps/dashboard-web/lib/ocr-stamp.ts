// 사진 하단 카메라 스탬프(OCR 텍스트 말미)에서 촬영시각·GPS·작업자ID·도로명주소를 관용 추출.
// OCR 오인식이 잦아 best-effort — 못 찾으면 null(표시에서 생략).

export type OcrStamp = {
  capturedAt: string | null; // "YYYY-MM-DD HH:MM"
  gps: string | null; // "위도, 경도"
  workerId: string | null; // "EMP-6861" 등
  roadAddress: string | null; // 도로명 주소
};

const EMPTY: OcrStamp = {
  capturedAt: null,
  gps: null,
  workerId: null,
  roadAddress: null,
};

const pad2 = (s: string) => s.padStart(2, "0");

export function parseOcrStamp(ocr: string | null | undefined): OcrStamp {
  if (!ocr) return EMPTY;

  // 촬영 시각 — [YYYY-MM-DD HH:MM(:SS)] (구분자·대괄호 관용).
  const t = ocr.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})[ T]+(\d{1,2}):(\d{2})/);
  const capturedAt = t
    ? `${t[1]}-${pad2(t[2]!)}-${pad2(t[3]!)} ${pad2(t[4]!)}:${t[5]}`
    : null;

  // GPS — 소수 4자리+ 위/경도 쌍. 한국 범위(위 33~39·경 124~132) 우선, 없으면 첫 쌍.
  let gps: string | null = null;
  const re = /(-?\d{1,3}\.\d{4,})\s*[,·]\s*(-?\d{1,3}\.\d{4,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ocr)) !== null) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    const pair = `${m[1]}, ${m[2]}`;
    if (lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132) {
      gps = pair;
      break;
    }
    if (gps === null) gps = pair;
  }

  // 작업자 ID — EMP-#### 우선, 없으면 admin####.
  const idMatch =
    ocr.match(/\bEMP[-_]?[A-Za-z0-9]{2,}/i) ?? ocr.match(/\badmin[A-Za-z0-9]{2,}/i);
  const workerId = idMatch ? idMatch[0].replace(/_/g, "-") : null;

  // 도로명 주소 — 시/도 + 구/군/동/로/길 토큰이 한 줄에 함께 있는 줄.
  let roadAddress: string | null = null;
  for (const raw of ocr.split(/\r?\n/)) {
    const s = raw.trim();
    const hasCity = /(특별시|광역시|특별자치시|특별자치도|[가-힣]{2,}시|[가-힣]{2,}도)/.test(s);
    const hasStreet = /([가-힣]+구|[가-힣]+군|[가-힣]+동|[가-힣0-9]+로|[가-힣0-9]+길|\d+번지)/.test(s);
    if (hasCity && hasStreet) {
      roadAddress = s;
      break;
    }
  }

  return { capturedAt, gps, workerId, roadAddress };
}
