// 가드 테스트용 주석 제거기 — 문자열·정규식 리터럴 안을 건너뛰므로 URL 의 `//` 를 먹지 않는다.
//
// 왜 공유 헬퍼인가([[L-119]] · 2026-08-27).
//   [[L-83]] 이 "금지형 검사는 줄 주석을 걷어낸 본문에서만 한다" 는 룰을 세우면서 관용구로
//   `src.replace(/\/\/[^\n]*/g, "")` 를 처방했다. 그런데 이 정규식은 **문자열 안의 `https://`
//   를 주석 시작으로 오인**해 그 줄의 나머지를 통째로 지운다.
//
//     const u = "https://tiles.example.com/"; dangerousCall();
//       →  const u = "https:                              ← dangerousCall() 이 증발
//
//   방향이 둘이고 위험도가 다르다.
//     · 앵커형(assert.match)  → 코드가 잘려 **거짓 빨간불**. 시끄러워서 바로 잡힌다(실제로 그랬다).
//     · 금지형(doesNotMatch)  → 금지 패턴이 함께 증발해 **거짓 초록**. 조용해서 안 잡힌다.
//   금지형이 [[L-83]] 의 본래 대상이므로, 그 룰을 지킬수록 위험한 쪽으로 틀린다.
//
// 그래서 각 가드가 정규식을 다시 쓰지 않도록 여기 한 곳에 둔다. 새 가드는 이것을 import 한다.
//
// ⚠ 범위 — 문자열(`"` `'` `` ` ``)과 이스케이프만 다룬다. 정규식 리터럴(`/.../`) 안의 `//` 는
//   문법상 나올 수 없고(빈 정규식은 `//` 가 주석이다), 템플릿 리터럴 `${}` 안의 중첩 문자열은
//   이 레포의 가드 대상 파일에서 실제로 문제가 된 적이 없다. 필요해지면 그때 넓힌다.

/** 줄 주석과 블록 주석을 지운다. 문자열 리터럴 안은 건드리지 않는다. */
export function stripComments(src: string): string {
  let out = "";
  let quote: string | null = null; // 문자열 안이면 그 따옴표 문자
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}
