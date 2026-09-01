"use client";
// /privacy 최상단 스크롤 확장 히어로.
// ⚠ 원본(ScrollExpandMedia)의 스크롤 하이재킹은 걷어냈다 — wheel preventDefault 와
//   window.scrollTo(0,0) 강제 고정이 원본의 핵심인데, 처리방침은 "제5조가 어디 있나"를
//   찾으러 오는 문서라 스크롤을 붙잡으면 안 된다(Ctrl+F·앵커 이동·키보드 이동이 다 죽는다).
//   여기서는 스크롤 진행도만 읽어 사진을 확대한다. 페이지가 "열리는" 동작이 이 페이지의
//   주장(무엇을 어떻게 다루는지 공개합니다)과 같은 말을 해서 연출에 근거가 있다.
// 애니메이션은 transform/opacity 만 — 레이아웃 속성은 건드리지 않는다.
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// 현장 사진 2장은 납품 대기 중. 파일이 없으면 img 를 감춰 아래 그라디언트가 그대로 배경이 된다
// (깨진 이미지 아이콘 대신 의도된 화면이 보이게 — 사진이 들어오면 그 자리에 얹힌다).
const BG_SRC = "/brand/privacy-hero-bg.jpg";
const MEDIA_SRC = "/brand/privacy-hero-media.jpg";

function Photo({
  className,
  onLoaded,
  priority,
  src,
}: {
  className: string;
  onLoaded?: (loaded: boolean) => void;
  priority?: boolean;
  src: string;
}) {
  const [loadable, setLoadable] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);

  // ⚠ 캐시에 있는 이미지는 hydration 전에 이미 로드가 끝나 React 의 onLoad 가 아예 안 불린다.
  //   그래서 마운트 시점에 complete 를 직접 본다(이걸 빼면 새로고침마다 탐지 박스가 사라진다).
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    if (el.complete) onLoaded?.(el.naturalWidth > 0);
  }, [onLoaded]);

  if (!loadable) return null;
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      ref={imgRef}
      // 배경은 첫 화면(LCP)이라 즉시, 확대용은 뒤따라 — 신뢰 페이지가 늦게 뜨면 그 자체로 인상이 나쁘다.
      fetchPriority={priority ? "high" : "low"}
      loading={priority ? "eager" : "lazy"}
      onError={() => {
        setLoadable(false);
        onLoaded?.(false);
      }}
      onLoad={() => onLoaded?.(true)}
      src={src}
    />
  );
}

// 확대 사진 위에 얹는 탐지 표시 — 사진에 글자를 굽지 않고 여기서 그린다(AI 이미지의 글자는 깨진다).
// ★ 표시 범위 = 안전모 · 안전조끼 · 손목 웨어러블 셋.
//   안전모는 PPE 탐지 게이트를 통과한 축이고, 손목은 '탐지'가 아니라 실제로 하는 일(생체 수집)이라
//   라벨을 그렇게 쓴다. **안전조끼는 현재 과업 범위 밖(2026-07-30 제외 확정)이지만 이후 도입 계획이
//   있어 소개 이미지에는 넣기로 사용자가 결정했다(2026-08-31).** 실제 탐지 화면이 아니라는 것은
//   우하단 "예시 이미지입니다" 로 밝힌다. 안전화는 예약 현장 recall 0.000 이라 여전히 넣지 않는다.
// 좌표는 사진 기준 %. privacy-hero-media.jpg(1672×941) 원본에서 직접 측정 — 안전모 x798~895·y113~179,
// 조끼 x759~938·y258~529(형광색 픽셀 범위), 손목 워치 x912~936·y348~377.
// 손목은 실측 그대로면 1.6%×3.3% 라 화면에서 안 보여 약간 넓혔다.
const DETECTIONS = [
  {
    box: "border-emerald-300/90",
    chip: "bg-emerald-300 text-emerald-950",
    delay: 0.45,
    height: "8.1%",
    label: "안전모 착용",
    left: "47.2%",
    side: "right",
    top: "11.5%",
    width: "6.8%",
  },
  {
    // 형광 노란 조끼 위에서는 초록 테두리가 묻힌다 — 붉은 계열로 갈라 놓는다(사용자 지시).
    box: "border-rose-400/90",
    chip: "bg-rose-400 text-rose-950",
    delay: 0.8,
    // ⚠ 형광색 픽셀만 재면 회색 반사띠와 어깨선이 빠져 조끼가 박스 밖으로 삐져나온다 —
    //   실측 범위(x759~938 · y258~529)에 사방 여유를 더해 조끼 전체를 감싼다(2026-08-31 교정).
    height: "31.6%",
    label: "안전조끼 착용",
    left: "44.2%",
    // 오른쪽에 두면 손목 라벨과 겹친다.
    side: "left",
    top: "26.1%",
    width: "12.9%",
  },
  {
    box: "border-emerald-300/90",
    chip: "bg-emerald-300 text-emerald-950",
    delay: 1.15,
    height: "5%",
    label: "생체 신호 수집 중",
    left: "53.8%",
    side: "right",
    top: "36%",
    width: "3%",
  },
] as const;

// 탐지 박스 한 칸 — 사진이 뜬 뒤 순서대로 잡힌다.
// ⚠ 등장을 스크롤 진행도에 물렸다가 뺐다 — 값이 스크롤 위치와 어긋나 박스가 사라지는 구간이
//   생겼다(실측). 마운트 기준 지연이 같은 인상을 주면서 훨씬 견고하다.
function DetectionBox({ detection, still }: { detection: (typeof DETECTIONS)[number]; still: boolean }) {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={`absolute rounded-md border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] ${detection.box}`}
      initial={still ? false : { opacity: 0 }}
      transition={{ delay: detection.delay, duration: 0.45, ease: "easeOut" }}
      style={{
        height: detection.height,
        left: detection.left,
        top: detection.top,
        width: detection.width,
      }}
    >
      {/* 라벨은 박스 옆에 — 위에 두면 확대가 끝났을 때 제목과 겹친다(실측). */}
      <span
        className={
          "absolute top-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold " +
          (detection.side === "left" ? "right-full mr-1.5 " : "left-full ml-1.5 ") +
          detection.chip
        }
      >
        {detection.label}
      </span>
    </motion.div>
  );
}

export function PrivacyScrollHero() {
  const trackRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  // 확대 사진이 실제로 로드됐을 때만 탐지 박스를 그린다 — 사진이 없으면 박스가 허공에 뜬다.
  const [mediaReady, setMediaReady] = useState(false);
  // 0→1 구간 = sticky 스테이지가 화면에 붙어 있는 동안.
  // ⚠ 끝을 "end start"(트랙 끝이 화면 위로 나감)로 잡으면 확대가 끝나는 순간 스테이지가 이미
  //   화면 밖이라 마지막 연출을 아무도 못 본다 — "end end" 여야 붙어 있는 동안 완료된다(실측).
  const { scrollYProgress } = useScroll({
    offset: ["start start", "end end"],
    target: trackRef,
  });

  const mediaScale = useTransform(scrollYProgress, [0, 1], [0.44, 1]);
  const photoOpacity = useTransform(scrollYProgress, [0, 1], [1, 0.18]);
  // 확대가 진행될수록 제목이 살짝 위로 물러난다 — 사진이 주인공 자리를 넘겨받는다는 신호.
  const titleShift = useTransform(scrollYProgress, [0, 1], [24, 0]);
  const ctaOpacity = useTransform(scrollYProgress, [0.55, 1], [0, 1]);

  return (
    <div className="relative h-[180vh]" ref={trackRef}>
      <div className="sticky top-0 flex h-[100dvh] items-center justify-center overflow-hidden bg-surface-dark">
        {/* 배경 사진 — 확대가 진행될수록 물러난다(주인공을 미디어로 넘긴다). */}
        {/* ⚠ 그라디언트 색 정지점 유틸리티에는 우리 색 토큰을 쓰지 않는다 — Tailwind 가 투명 폴백을
            계산할 때 opacityValue 로 숫자를 넘기는데 config 의 token() 헬퍼는 문자열만 받아
            빌드가 깨진다(2026-08-31 실측). 단색 배경 토큰만 쓴다.
            ⚠⚠ 이 주석에 그 클래스명을 예시로 적지 말 것 — Tailwind 는 주석까지 정규식으로 훑어서
            문자열만 있어도 똑같이 깨진다(코드를 지우고도 30분 헤맨 실측). */}
        <motion.div
          className="absolute inset-0 bg-surface-dark-elevated"
          style={reduceMotion ? { opacity: 0.18 } : { opacity: photoOpacity }}
        >
          <Photo className="h-full w-full object-cover" priority src={BG_SRC} />
        </motion.div>

        {/* 확대되는 미디어 — 크기가 아니라 scale 로 키운다(레이아웃 재계산 없음). */}
        <motion.div
          className="relative z-10 h-[min(76vh,720px)] w-[min(1120px,92vw)] overflow-hidden rounded-3xl bg-surface-dark-elevated shadow-2xl"
          style={reduceMotion ? { scale: 1 } : { scale: mediaScale }}
        >
          <Photo className="h-full w-full object-cover" onLoaded={setMediaReady} src={MEDIA_SRC} />
          {/* 제목이 사진 위에서도 읽히도록 깔는 막 */}
          <div className="absolute inset-0 bg-black/40" />

          {/* 탐지 표시 — 사진이 실제로 있을 때만. 화면에 올리는 축은 규칙이 허용한 둘뿐이다. */}
          {mediaReady ? (
            <>
              {DETECTIONS.map((detection) => (
                <DetectionBox detection={detection} key={detection.label} still={Boolean(reduceMotion)} />
              ))}
              {/* 실제 탐지 화면이 아니라는 것을 그림 안에서 밝힌다(심사 자료로 이어지는 페이지다). */}
              <span className="absolute bottom-3 right-4 text-[11px] text-white/70">
                예시 이미지입니다
              </span>
            </>
          ) : null}
        </motion.div>

        {/* 글자는 위아래로 갈라 둔다 — 사진 속 인물이 정중앙이라 가운데 정렬하면 얼굴과 몸을 덮는다
            (실측 후 조정). 제목은 하늘 쪽 위, 부제·버튼은 바닥 쪽 아래. 가운데는 사진에 내준다. */}
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-between px-6 py-[7vh] text-center">
          <motion.h1
            className="text-2xl font-semibold leading-tight tracking-tight text-white drop-shadow-lg sm:text-3xl md:text-5xl"
            style={reduceMotion ? undefined : { y: titleShift }}
          >
            현장 데이터가 다니는 길까지 공개합니다
          </motion.h1>

          <div className="flex flex-col items-center">
            <motion.p
              className="max-w-[42ch] text-sm leading-relaxed text-white/85 drop-shadow md:text-base"
              style={reduceMotion ? { opacity: 1 } : { opacity: ctaOpacity }}
            >
              무엇을 수집하고, 어디로 보내고, 어떻게 지키는지 이 한 페이지에 정리했습니다.
            </motion.p>
            <motion.div
              className="pointer-events-auto mt-6"
              style={reduceMotion ? { opacity: 1 } : { opacity: ctaOpacity }}
            >
              <a
                className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-surface-dark transition hover:bg-white/90 active:scale-[0.98]"
                href="#policy"
              >
                처리방침 전문 보기
              </a>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
