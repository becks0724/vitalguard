// build.mjs 의 타입 선언 — 가드 테스트가 이 모듈을 import 하므로 tsc 가 형을 알아야 한다
export declare const BEGIN: string;
export declare const END: string;

export type SeamRow = {
  name: string;
  rt: string;
  how: string;
  where: string;
  broken: string;
};

/** 절 제목 → 그 아래 코드블록 줄들. `parent` 는 상위 `##` 제목(하위 절일 때만). */
export type CallsiteSection = { parent: string | null; lines: string[] };

export declare function readSeamTable(): Map<string, SeamRow>;
export declare function readCallsites(): Map<string, CallsiteSection>;
export declare function sitesFor(
  id: string,
  sections: Map<string, CallsiteSection>,
): { sec: string; lines: string[] }[];
export declare function buildBlock(): string;
export declare function currentVsBuilt(): { html: string; next: string };
