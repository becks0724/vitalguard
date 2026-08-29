// 로그인 화면 계열(로그인·회원가입·계정 찾기)이 공유하는 글래스 입력 스타일.
// 같은 카드 안에서 나란히 보이는 폼들이라 한쪽만 바뀌면 눈에 띄게 어긋난다 — 한 곳에서 정의한다.

// 셰이더 배경 위 글래스 입력 — 박스 없이 배경과 조화(반투명 흰색 + backdrop-blur).
export const FIELD_BASE =
  "rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm text-white outline-none backdrop-blur-md transition placeholder:text-white/50 focus:border-white/70 focus:bg-white/15";

export const INPUT_CLASS = `mt-1 w-full ${FIELD_BASE}`;

// 라벨 — 폰에서는 감추고(placeholder 와 같은 문구) md 이상에서 보인다. 로그인·/pair 가 같은 규칙을 쓴다.
export const LABEL_PHONE_HIDDEN =
  "sr-only text-xs font-semibold text-white/90 drop-shadow md:not-sr-only";
