"use client";
// VitAlGuard 현장 어시스턴트 마스코트 — 파츠 분리 PNG(공유 좌표계 512px)를 Framer Motion 으로
// 레이어 조립해 구동한다(2026-08-31 재납품 파츠 검수 합격 — 각 파일 단독 열기 확인).
// 상태 전환은 전부 props.state 로만(트리거 판정은 AssignmentChatBoard, 부유·배치는 Widget 소유).
// 깜빡임·잔제스처·시선 추적만 내부(시선은 모션 값으로만 흘러 리렌더 0 — useState 금지).
// 에셋 = public/mascots/vitalguard/ (원본은 데스크톱 폴더).

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionProps,
  type Variants,
} from "framer-motion";
import { useEffect, useRef, useState, type RefObject } from "react";

export type MascotState =
  | "idle"
  | "greet"
  | "thinking"
  | "answering"
  | "alert"
  | "sorry"
  | "hold"
  | "proud";

type EyeExpression = "default" | "serious" | "closed" | "thinking";
export type MouthExpression = "smile" | "flat" | "open" | "wavy";

export type MascotAssets = {
  torso: string;
  head: string;
  leftArm: string;
  rightArm: string;
  /** Optional alternate open-palm arm used only by the `hold` state. */
  rightArmHold?: string;
  /** Optional thumbs-up arm used only by the `proud` state (전원 정상 판정). */
  rightArmProud?: string;
  shadow: string;
  eyes: Record<EyeExpression, string>;
  mouth: Record<MouthExpression, string>;
};

/** Point this at your public directory, or pass another complete `assets` object. */
export const DEFAULT_MASCOT_ASSETS: MascotAssets = {
  torso: "/mascots/vitalguard/torso.png",
  head: "/mascots/vitalguard/head.png",
  leftArm: "/mascots/vitalguard/left-arm.png",
  rightArm: "/mascots/vitalguard/right-arm.png",
  rightArmHold: "/mascots/vitalguard/right-arm-hold.png",
  rightArmProud: "/mascots/vitalguard/right-arm-thumbsup.png",
  shadow: "/mascots/vitalguard/shadow.png",
  eyes: {
    default: "/mascots/vitalguard/eyes-default.png",
    serious: "/mascots/vitalguard/eyes-serious.png",
    closed: "/mascots/vitalguard/eyes-closed.png",
    thinking: "/mascots/vitalguard/eyes-thinking.png",
  },
  mouth: {
    smile: "/mascots/vitalguard/mouth-smile.png",
    flat: "/mascots/vitalguard/mouth-flat.png",
    open: "/mascots/vitalguard/mouth-open.png",
    wavy: "/mascots/vitalguard/mouth-wavy.png",
  },
};

const EXPRESSION: Record<MascotState, { eyes: EyeExpression; mouth: MouthExpression }> = {
  idle: { eyes: "default", mouth: "smile" },
  greet: { eyes: "default", mouth: "smile" },
  thinking: { eyes: "thinking", mouth: "flat" },
  answering: { eyes: "default", mouth: "open" },
  alert: { eyes: "serious", mouth: "flat" },
  sorry: { eyes: "closed", mouth: "wavy" },
  hold: { eyes: "serious", mouth: "flat" },
  proud: { eyes: "default", mouth: "smile" },
};

const bodyVariants: Variants = {
  // idle — 살아있는 대기: 호흡 + 아주 느린 좌우 스웨이(주기를 머리·팔과 다르게 둬 유기적으로).
  idle: {
    y: [0, -2.2, 0],
    scale: [1, 1.02, 1],
    rotate: [0, -0.7, 0, 0.7, 0],
    transition: {
      y: { duration: 2.6, ease: "easeInOut", repeat: Infinity },
      scale: { duration: 2.6, ease: "easeInOut", repeat: Infinity },
      rotate: { duration: 5.4, ease: "easeInOut", repeat: Infinity },
    },
  },
  // greet — 질문을 받은 것을 반갑고 짧게 확인하는 고개 끄덕임.
  greet: { y: [0, 2, 0], rotate: [0, 1.4, 0], transition: { duration: 1.2, ease: "easeInOut" } },
  // thinking — 판단을 정돈하며 잠시 집중하는 안정된 자세.
  thinking: { y: 1, transition: { duration: 0.24, ease: "easeOut" } },
  // answering — 설명에 맞춰 아주 약하게 리듬을 주는 친절한 자세.
  answering: { y: [0, -1, 0], transition: { duration: 1.5, ease: "easeInOut", repeat: Infinity } },
  // alert — 위험을 분명히 알리되 경보 UI와 경쟁하지 않는 한 번의 강조.
  alert: { scale: [1, 1.045, 1], transition: { duration: 0.48, ease: "easeOut" } },
  // sorry — 오류를 인정하고 도움을 다시 제안하는 조심스러운 자세.
  sorry: { y: [0, 2, 0], rotate: [0, -1, 0], transition: { duration: 1.2, ease: "easeInOut" } },
  // hold — 권한이나 근거가 부족해 잠시 멈춰 달라는 단정한 자세.
  hold: { y: 1, transition: { duration: 0.22, ease: "easeOut" } },
  // proud — 전원 정상 판정을 축하하는 짧고 경쾌한 팝(엄지척 스프라이트를 보조).
  proud: { y: [0, -4, 0], scale: [1, 1.03, 1], transition: { duration: 0.55, ease: "easeOut" } },
};

const headVariants: Variants = {
  // idle — 호흡보다 반 박자 다른 주기의 잔잔한 고갯짓(살아있음을 전달).
  idle: {
    y: [0, -1.6, 0],
    rotate: [0, -1.3, 0, 1.1, 0],
    transition: {
      y: { duration: 3.1, ease: "easeInOut", repeat: Infinity },
      rotate: { duration: 4.4, ease: "easeInOut", repeat: Infinity },
    },
  },
  // greet — 짧은 끄덕임으로 질문 접수를 알림.
  greet: { y: [0, 8, 0], rotate: [0, -1.5, 0], transition: { duration: 1.2, ease: "easeInOut" } },
  // thinking — 위를 올려다보며 정보를 검토하는 시선.
  thinking: { y: -5, rotate: -2, transition: { duration: 0.28, ease: "easeOut" } },
  // answering — 설명 중에도 시선을 안정적으로 유지.
  answering: { y: [0, -1, 0], transition: { duration: 1.5, ease: "easeInOut", repeat: Infinity } },
  // alert — 심각도를 전달하는 낮고 단단한 머리 위치.
  alert: { y: 3, rotate: 0, transition: { duration: 0.22, ease: "easeOut" } },
  // sorry — 미안함을 표현하는 아주 작은 기울임.
  sorry: { y: 3, rotate: -4, transition: { duration: 0.32, ease: "easeOut" } },
  // hold — 보류 사유를 차분히 전달하는 정면 시선.
  hold: { y: 1, rotate: 0, transition: { duration: 0.22, ease: "easeOut" } },
  // proud — 엄지척과 함께 살짝 젖히는 밝은 고개.
  proud: { y: [0, -2, 0], rotate: [0, 2, 0], transition: { duration: 0.55, ease: "easeOut" } },
};

const leftArmVariants: Variants = {
  // idle — 편안하게 내려둔 채 몸 리듬을 따라 미세하게 흔들리는 팔.
  idle: {
    rotate: [0, -1.8, 0],
    y: [0, -1.5, 0],
    transition: { duration: 3.4, ease: "easeInOut", repeat: Infinity },
  },
  // greet — 짧은 경례를 보조하는 친근한 팔 동작.
  greet: { rotate: [0, -9, 5, 0], y: [0, -8, -2, 0], transition: { duration: 1.2, ease: "easeInOut" } },
  // thinking — 손을 살짝 들어 검토 중임을 표현.
  // ⚠ 팔은 어깨(transformOrigin)를 축으로 "회전만" 시킨다. x·y 로 평행이동시키면 몸통에서
  //   떨어져 팔이 공중에 뜬다(2026-08-31 사용자 지적 — 재납품 파츠에서 특히 눈에 띈다).
  thinking: { rotate: -20, transition: { duration: 0.34, ease: "easeOut" } },
  // answering — 말의 박자에 맞춘 작고 절제된 설명 제스처.
  answering: { rotate: [0, -5, 0], y: [0, -6, 0], transition: { duration: 1.1, ease: "easeInOut", repeat: Infinity } },
  // alert — 몸에 가깝게 둬서 경고의 진지함을 보조.
  alert: { rotate: 7, transition: { duration: 0.22, ease: "easeOut" } },
  // sorry — 손을 들어 난처함을 표현(회전만 — 위 thinking 주석의 이유와 동일).
  sorry: { rotate: -26, transition: { duration: 0.42, ease: "easeOut" } },
  // hold — 상대를 재촉하지 않고 대기하는 편안한 팔 위치.
  hold: { rotate: -7, transition: { duration: 0.24, ease: "easeOut" } },
  // proud — 주역은 오른팔 엄지척 — 왼팔은 편안히 내려 시선을 뺏지 않는다.
  proud: { rotate: 0, x: 0, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

const rightArmVariants: Variants = {
  // idle — 가리킬 준비가 된 포인터 팔도 왼팔과 다른 주기로 살짝 떠다닌다.
  idle: {
    rotate: [0, 2.2, 0],
    x: 0,
    y: [0, -1.8, 0],
    transition: { duration: 3.9, ease: "easeInOut", repeat: Infinity },
  },
  // greet — 손끝을 작게 흔들어 접수를 확인.
  greet: { rotate: [0, 8, -4, 0], y: [0, -4, -2, 0], transition: { duration: 1.2, ease: "easeInOut" } },
  // thinking — 시선과 함께 멈춰 있어, 조급한 답변을 하지 않음을 전달.
  thinking: { rotate: -7, y: 4, transition: { duration: 0.28, ease: "easeOut" } },
  // answering — 말풍선 쪽(마스코트의 오른쪽)으로 손끝을 들어, 방금 도착한 답변을 짚어 주는 안내 동작.
  // 위젯이 답변 시 마스코트를 답변 왼쪽 앵커로 옮기므로 양(+) 회전 = 말풍선을 가리키는 방향이다.
  answering: { rotate: [24, 31, 24], y: [-4, -9, -4], transition: { duration: 1.15, ease: "easeInOut", repeat: Infinity } },
  // alert — 손을 들어 보호장비 확인을 강조한 뒤 정지(회전만 — 평행이동은 팔을 몸에서 떼어낸다).
  alert: { rotate: -24, transition: { duration: 0.42, ease: "easeOut" } },
  // sorry — 한 박자 멈춘 손끝으로 난처함과 재시도를 표현.
  sorry: { rotate: 10, y: -6, transition: { duration: 0.32, ease: "easeOut" } },
  // hold — 앞으로 향한 팔로 판단 보류와 잠시 대기를 정중하게 알림.
  hold: { rotate: 0, x: 0, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  // proud — 엄지척 스프라이트를 한 번 힘있게 들어올린 뒤 정지(무한 반복은 소란스럽다).
  proud: { rotate: [0, -8, 0], x: 0, y: [0, -10, 0], transition: { duration: 0.55, ease: "easeOut" } },
};

const shadowVariants: Variants = {
  // idle — 호흡에만 맞춰 거의 느껴지지 않게 변화하는 접지감.
  idle: { opacity: [0.58, 0.48, 0.58], scaleX: [1, 0.96, 1], transition: { duration: 2.5, ease: "easeInOut", repeat: Infinity } },
  // greet — 끄덕임에 동반하는 짧은 접지 변화.
  greet: { opacity: [0.58, 0.48, 0.58], scaleX: [1, 0.95, 1], transition: { duration: 1.2, ease: "easeInOut" } },
  // thinking — 집중 중에도 흔들리지 않는 안정감.
  thinking: { opacity: 0.55, scaleX: 0.98, transition: { duration: 0.24 } },
  // answering — 설명 중의 미세한 리듬만 반영.
  answering: { opacity: [0.58, 0.52, 0.58], transition: { duration: 1.5, repeat: Infinity } },
  // alert — 진입 강조 후 즉시 안정되는 접지감.
  alert: { opacity: [0.58, 0.78, 0.58], scaleX: [1, 1.06, 1], transition: { duration: 0.48 } },
  // sorry — 고개를 숙인 듯한 작은 접지 변화.
  sorry: { opacity: [0.58, 0.66, 0.58], transition: { duration: 1.2 } },
  // hold — 판단 보류 중의 정지된 자세.
  hold: { opacity: 0.58, transition: { duration: 0.2 } },
  // proud — 팝에 맞춘 한 번의 접지 변화.
  proud: { opacity: [0.58, 0.5, 0.58], scaleX: [1, 0.97, 1], transition: { duration: 0.55 } },
};

const reducedBodyVariants: Variants = {
  idle: {}, greet: {}, thinking: { y: 1 }, answering: {}, alert: {}, sorry: {}, hold: { y: 1 }, proud: {},
};
const reducedHeadVariants: Variants = {
  idle: {}, greet: {}, thinking: { y: -5, rotate: -2 }, answering: {}, alert: { y: 3 }, sorry: { y: 3, rotate: -4 }, hold: { y: 1 }, proud: {},
};
const reducedLeftArmVariants: Variants = {
  idle: {}, greet: {}, thinking: { rotate: -20 }, answering: {}, alert: { rotate: 7 }, sorry: { rotate: -26 }, hold: { rotate: -7 }, proud: {},
};
const reducedRightArmVariants: Variants = {
  idle: {}, greet: {}, thinking: { rotate: -7 }, answering: { rotate: 27 }, alert: { rotate: -24 }, sorry: { rotate: 10 }, hold: {}, proud: {},
};
const reducedShadowVariants: Variants = {
  idle: { opacity: 0.58 }, greet: { opacity: 0.58 }, thinking: { opacity: 0.55 }, answering: { opacity: 0.58 }, alert: { opacity: 0.58 }, sorry: { opacity: 0.58 }, hold: { opacity: 0.58 }, proud: { opacity: 0.58 },
};

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

// ── 시선 추적 — 마우스를 따라 고개·눈동자가 돈다(2026-08-31 사용자 요청, Spline 로봇 레퍼런스의
// head-tracking 을 스프라이트 조립 구조로 번안). 연속 좌표는 리렌더 없이 모션 값으로만 흐른다.
const GAZE_RANGE_PX = 260; // 마스코트 중심 기준 이 반경에서 최대 기울기 도달(밖은 클램프)

function clampUnit(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function useGaze(rootRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  // 스프링이 즉답 대신 살짝 따라오게 — 기계적 1:1 추적은 시선이 아니라 커서 복제로 보인다.
  const x = useSpring(rawX, { stiffness: 120, damping: 18 });
  const y = useSpring(rawY, { stiffness: 120, damping: 18 });

  useEffect(() => {
    if (!enabled) {
      rawX.set(0);
      rawY.set(0);
      return;
    }
    const onMove = (event: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      rawX.set(clampUnit((event.clientX - (rect.left + rect.width / 2)) / GAZE_RANGE_PX));
      rawY.set(clampUnit((event.clientY - (rect.top + rect.height / 2)) / GAZE_RANGE_PX));
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [enabled, rawX, rawY, rootRef]);

  return { x, y };
}

// 대기 중 잔제스처 풀 — 파츠 하나만 1회성으로 움직여 "살아있음"을 전달한다(전신 동시 모션 금지).
const IDLE_GESTURES = ["wave", "tilt", "point", "sway"] as const;
type IdleGesture = (typeof IDLE_GESTURES)[number] | null;

function randomBetween(minimum: number, maximum: number) {
  return Math.round(minimum + Math.random() * (maximum - minimum));
}

type PartProps = {
  src: string;
  variants?: Variants;
  animate?: MotionProps["animate"];
  origin?: string;
  zIndex: number;
};

function Part({ src, variants, animate, origin = "50% 50%", zIndex }: PartProps) {
  return (
    <motion.div
      animate={animate}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, zIndex, transformOrigin: origin, willChange: "transform, opacity" }}
      variants={variants}
    >
      <img alt="" draggable={false} src={src} style={{ display: "block", height: "100%", pointerEvents: "none", width: "100%" }} />
    </motion.div>
  );
}

export function SiteAssistantMascot({
  state,
  size = 120,
  assets = DEFAULT_MASCOT_ASSETS,
  className,
  mouthOverride,
}: {
  state: MascotState;
  size?: number;
  assets?: MascotAssets;
  className?: string;
  /** 자세는 그대로 두고 입모양만 바꾼다(예: 예시 칩에 마우스를 올렸을 때). */
  mouthOverride?: MouthExpression;
}) {
  const reducedMotion = useReducedMotionPreference();
  const [isBlinking, setIsBlinking] = useState(false);
  const [idleGesture, setIdleGesture] = useState<IdleGesture>(null);

  // 시선 추적 — 고개는 "기울이기"만 한다. ⚠ 머리를 평행이동시키면 토르소의 목 라인과 어긋나
  // 목이 잘려 보인다(2026-08-31 사용자 지적) — 그래서 회전축을 목 관절(50% 54%, 머리 파츠의
  // 기존 피벗과 동일)에 두고 x/y 이동은 싣지 않는다. 표정 쪽은 눈이 커서를 따라 미세하게 옮겨간다.
  const rootRef = useRef<HTMLDivElement>(null);
  const gaze = useGaze(rootRef, !reducedMotion);
  const faceRotate = useTransform(gaze.x, (v) => v * 4);
  const eyesX = useTransform(gaze.x, (v) => v * 2.5);
  const eyesY = useTransform(gaze.y, (v) => v * 2);
  // 입도 시선을 따라간다 — 눈만 움직이면 얼굴이 따로 논다. 폭은 눈의 약 2/3(눈이 앞서고 입이 따라오는 비율).
  const mouthX = useTransform(gaze.x, (v) => v * 1.6);
  const mouthY = useTransform(gaze.y, (v) => v * 1.3);
  // ⚠ 입 벌린 스프라이트는 위쪽 끝(y202)이 눈 아래쪽 끝(y210)보다 높아 원본부터 8px 겹친다.
  //   그래서 'open' 일 때만 조금 내려 앉힌다(다른 입모양은 여유가 있어 그대로 둔다).
  const mouthOpenY = useTransform(gaze.y, (v) => v * 1.3 + 2);
  // 좌우로 갈수록 입을 살짝 줄인다 — 얼굴 옆선 밖으로 새어 나가지 않게(사용자 제안 2026-08-31).
  const mouthScale = useTransform(gaze.x, (v) => 1 - Math.abs(v) * 0.07);

  useEffect(() => {
    if (state !== "idle" || reducedMotion) {
      setIsBlinking(false);
      return;
    }

    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let nextTimer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      nextTimer = setTimeout(() => {
        setIsBlinking(true);
        closeTimer = setTimeout(() => {
          setIsBlinking(false);
          schedule();
        }, 120);
      }, randomBetween(4_000, 7_000));
    };
    schedule();
    return () => {
      if (nextTimer) clearTimeout(nextTimer);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [reducedMotion, state]);

  useEffect(() => {
    if (state !== "idle" || reducedMotion) {
      setIdleGesture(null);
      return;
    }

    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let nextTimer: ReturnType<typeof setTimeout> | undefined;
    let last: IdleGesture = null;
    const schedule = () => {
      nextTimer = setTimeout(() => {
        // 같은 제스처 연속 반복은 기계적으로 보인다 — 직전 것을 빼고 뽑는다.
        const pool = IDLE_GESTURES.filter((g) => g !== last);
        const pick = pool[Math.floor(Math.random() * pool.length)] ?? "wave";
        last = pick;
        setIdleGesture(pick);
        finishTimer = setTimeout(() => {
          setIdleGesture(null);
          schedule();
        }, 950);
      }, randomBetween(8_000, 14_000));
    };
    schedule();
    return () => {
      if (nextTimer) clearTimeout(nextTimer);
      if (finishTimer) clearTimeout(finishTimer);
    };
  }, [reducedMotion, state]);

  const expression = EXPRESSION[state];
  const selectedEyes: EyeExpression = state === "idle" && isBlinking ? "closed" : expression.eyes;
  const selectedMouth: MouthExpression = mouthOverride ?? expression.mouth;
  // 잔제스처 발동 중이면 해당 파츠만 1회성 키프레임으로 덮는다(나머지는 상시 idle 리듬 유지).
  const gesture = state === "idle" ? idleGesture : null;
  const activeLeftArm =
    gesture === "wave"
      ? { rotate: [0, -7, 4, 0], y: [0, -5, -1, 0], transition: { duration: 0.9, ease: "easeInOut" as const } }
      : state;
  const activeRightArm =
    gesture === "point"
      ? { rotate: [0, -9, 0], y: [0, -7, 0], transition: { duration: 0.9, ease: "easeInOut" as const } }
      : state;
  const activeHead =
    gesture === "tilt"
      ? { rotate: [0, -5, 0, 3.5, 0], y: [0, 1, 0], transition: { duration: 0.95, ease: "easeInOut" as const } }
      : state;
  const activeBody =
    gesture === "sway"
      ? { rotate: [0, -1.8, 1.4, 0], y: [0, -1, 0], transition: { duration: 0.95, ease: "easeInOut" as const } }
      : state;

  return (
    <motion.div
      aria-label="VitAlGuard 현장 어시스턴트"
      className={className}
      ref={rootRef}
      role="img"
      style={{ height: size, position: "relative", width: size }}
    >
      <Part animate={state} origin="50% 95%" src={assets.shadow} variants={reducedMotion ? reducedShadowVariants : shadowVariants} zIndex={0} />
      <Part animate={activeLeftArm} origin="28% 60%" src={assets.leftArm} variants={reducedMotion ? reducedLeftArmVariants : leftArmVariants} zIndex={1} />
      <Part
        animate={activeRightArm}
        src={
          state === "hold"
            ? (assets.rightArmHold ?? assets.rightArm)
            : state === "proud"
              ? (assets.rightArmProud ?? assets.rightArm)
              : assets.rightArm
        }
        origin="70% 60%"
        variants={reducedMotion ? reducedRightArmVariants : rightArmVariants}
        zIndex={1}
      />
      <Part animate={activeBody} src={assets.torso} variants={reducedMotion ? reducedBodyVariants : bodyVariants} zIndex={2} />

      {/* 얼굴 그룹 — 시선 추적 기울임은 이 래퍼에만 싣는다(상태 variants 와 독립으로 합성).
          회전축 = 목 관절. 이동값은 싣지 않는다(목 잘림 방지).
          내부 z 는 래퍼 안에서만 유효: 머리 1 < 눈 2 < 입 3. 래퍼 자체는 토르소(2) 위 = 3. */}
      <motion.div
        aria-hidden="true"
        style={{
          inset: 0,
          pointerEvents: "none",
          position: "absolute",
          rotate: faceRotate,
          transformOrigin: "50% 54%",
          zIndex: 3,
        }}
      >
        {/* 머리 모션 래퍼 — 눈·입은 반드시 이 "안"에 있어야 한다. 밖에 두면 머리만 끄덕이고
            눈·입은 제자리에 남아 얼굴에서 떨어져 보인다(2026-08-31 사용자 지적). */}
        <motion.div
          animate={activeHead}
          style={{ inset: 0, position: "absolute", transformOrigin: "50% 54%", willChange: "transform" }}
          variants={reducedMotion ? reducedHeadVariants : headVariants}
        >
          <img alt="" draggable={false} src={assets.head} style={{ display: "block", height: "100%", pointerEvents: "none", width: "100%" }} />

          {(Object.keys(assets.eyes) as EyeExpression[]).map((name) => (
            <motion.div
              animate={{ opacity: selectedEyes === name ? 1 : 0 }}
              aria-hidden="true"
              key={name}
              style={{ inset: 0, pointerEvents: "none", position: "absolute", x: eyesX, y: eyesY, zIndex: 1 }}
              transition={{ duration: 0.12, ease: "linear" }}
            >
              <img alt="" draggable={false} src={assets.eyes[name]} style={{ display: "block", height: "100%", width: "100%" }} />
            </motion.div>
          ))}
          {(Object.keys(assets.mouth) as MouthExpression[]).map((name) => (
            <motion.div
              animate={{ opacity: selectedMouth === name ? 1 : 0 }}
              aria-hidden="true"
              key={name}
              style={{
                inset: 0,
                pointerEvents: "none",
                position: "absolute",
                scale: mouthScale,
                // 축소 기준점을 입의 실제 중심(스프라이트 알파 기준 50% / 44%)에 둬야
                // 줄어들 때 입이 제자리에서 작아진다(캔버스 중심이면 위로 딸려 올라간다).
                transformOrigin: "50% 44%",
                x: mouthX,
                y: name === "open" ? mouthOpenY : mouthY,
                zIndex: 2,
              }}
              transition={{ duration: 0.12, ease: "linear" }}
            >
              <img alt="" draggable={false} src={assets.mouth[name]} style={{ display: "block", height: "100%", width: "100%" }} />
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
