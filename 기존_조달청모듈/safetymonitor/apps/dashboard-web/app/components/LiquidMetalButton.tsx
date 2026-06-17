// 로그인 화면 CTA — 리퀴드 메탈 셰이더(@paper-design/shaders-react) 애니메이션 버튼. hover 가속·press 함몰·클릭 리플.
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { LiquidMetal } from "@paper-design/shaders-react";

type Ripple = { x: number; y: number; id: number };

// 리플 키프레임 1회 주입(globals.css 미오염, 컴포넌트 자급자족).
function ensureRippleKeyframes() {
  const id = "liquid-metal-ripple-style";
  if (typeof document === "undefined" || document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent =
    "@keyframes lm-ripple{0%{transform:translate(-50%,-50%) scale(0);opacity:.55}100%{transform:translate(-50%,-50%) scale(5);opacity:0}}";
  document.head.appendChild(style);
}

export function LiquidMetalButton({
  label,
  type = "button",
  disabled = false,
  onClick,
  className = "",
}: {
  label: string;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const rippleId = useRef(0);
  // 리플 제거 타이머 모음 — 언마운트 시 일괄 정리(미정리 setTimeout 누수 방지).
  const rippleTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    ensureRippleKeyframes();
  }, []);

  useEffect(() => {
    const timers = rippleTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      const el = btnRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const id = rippleId.current++;
        setRipples((prev) => [
          ...prev,
          { x: e.clientX - r.left, y: e.clientY - r.top, id },
        ]);
        const timer = setTimeout(() => {
          setRipples((prev) => prev.filter((rp) => rp.id !== id));
          rippleTimers.current.delete(timer);
        }, 600);
        rippleTimers.current.add(timer);
      }
      onClick?.();
    },
    [disabled, onClick],
  );

  return (
    <button
      ref={btnRef}
      type={type}
      disabled={disabled}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      aria-label={label}
      className={`relative inline-flex h-[46px] min-w-[168px] items-center justify-center overflow-hidden rounded-full px-6 outline-none transition-transform duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50 ${
        pressed ? "translate-y-px scale-[0.98]" : ""
      } ${className}`}
      style={{
        boxShadow: pressed
          ? "0 0 0 1px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.4)"
          : hovered
            ? "0 0 0 1px rgba(0,0,0,0.4), 0 10px 18px rgba(0,0,0,0.25)"
            : "0 0 0 1px rgba(0,0,0,0.3), 0 18px 28px rgba(0,0,0,0.16)",
      }}
    >
      {/* 리퀴드 메탈 셰이더 필 */}
      <LiquidMetal
        speed={hovered ? 1.6 : 0.6}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
      {/* 어두운 메탈 마감 오버레이 — 셰이더 위 대비 확보 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "linear-gradient(180deg, rgba(22,22,22,0.42) 0%, rgba(0,0,0,0.74) 100%)",
        }}
      />
      {/* 라벨 */}
      <span className="pointer-events-none relative z-10 text-sm font-semibold tracking-wide text-zinc-100 drop-shadow">
        {label}
      </span>
      {/* 클릭 리플 */}
      {ripples.map((r) => (
        <span
          key={r.id}
          aria-hidden="true"
          className="pointer-events-none absolute z-20 h-6 w-6 rounded-full"
          style={{
            left: r.x,
            top: r.y,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 70%)",
            animation: "lm-ripple 0.6s ease-out",
          }}
        />
      ))}
    </button>
  );
}
