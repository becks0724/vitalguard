// 클라이언트 IP 판정 — **이 프로젝트의 유일한 X-Forwarded-For 파서**.
//
// 왜 단일 모듈인가. 과거 같은 규칙을 세 곳(admin-auth·rate-limit·email/send-code)이
// 각자 구현했고 그중 둘이 틀렸다(교훈 L-12). IP 는 로그인 잠금·빈도 제한의 키라
// 규칙이 어긋나면 곧바로 우회 취약점이 된다. 새 파서를 만들지 말고 이 함수를 쓴다.
// lib/client-ip.guard.test.ts 가 다른 파일의 XFF 직접 파싱을 실패시킨다.
//
// 왜 최우측인가(2026-07-25 라이브 실측). 배포된 레이트리밋을 관측 장치로 삼아,
// 버킷 소진 후 `X-Forwarded-For: 203.0.113.77` 을 동봉한 요청이 새 버킷을 얻는지 확인했다.
// "뒤에서 두 번째" 구현은 위조값을 집어 제한을 우회했고(202 5/5), 이는 서버가 받은 XFF 가
// `위조값, 진짜IP` 2개였다는 뜻 — 즉 **Cloud Run 은 홉을 정확히 1개(진짜 클라이언트 IP)만
// 덧붙인다**. 따라서 최좌측·중간은 클라이언트가 위조할 수 있고 최우측만 프록시가 보증한다.
// 정정 후 재시험에서 위조 요청도 대조군과 동일하게 429 로 차단됨을 확인했다.
export function clientIpFromRequest(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1] ?? "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
