// 앱 촬영 각인용 좌표→주소 조회. 앱 JWT 로 잠근다.
//
// ★ 애플 CLGeocoder 를 대체하는 경로다. 같은 좌표에서 애플은 광역명·자치구·지번 세 축을
//   동시에 틀렸다(2026-08-28 실측 · docs/ocr-address-geocode/context-notes.md).
import { NextResponse } from "next/server";

import { bearerToken, verifyAppJwt } from "../../../../lib/app-jwt";
import { reverseGeocode } from "../../../lib/reverse-geocode";

export async function GET(request: Request) {
  // ★ 인증 없이 열지 않는다 — 지오코딩은 과금 쿼터라 열어 두면 남이 태운다.
  if (!verifyAppJwt(bearerToken(request))) {
    return NextResponse.json({ ok: false, error: "인증이 필요합니다." }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const rawLat = sp.get("lat");
  const rawLon = sp.get("lon");
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    // ⚠ 받은 값을 함께 찍는다 — 무엇이 거부됐는지 안 적으면 호출자가 소스를 읽어야 한다([[L-115]]④).
    return NextResponse.json(
      { ok: false, error: `좌표가 올바르지 않습니다 — lat=${rawLat} lon=${rawLon}` },
      { status: 400 },
    );
  }

  try {
    const result = await reverseGeocode(lat, lon);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // ⚠ 빈 주소를 200 으로 위장하지 않는다. 앱이 '주소 없음'과 '조회 실패'를 가를 수 있어야
    //   기기 추정 폴백을 쓸지 판단한다. 200 으로 감추면 그 판단이 불가능해진다.
    return NextResponse.json(
      {
        ok: false,
        error: "역지오코딩 실패",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
