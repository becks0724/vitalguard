// 네온 로딩 인디케이터 — 글자 순차 회전 + 글로우 바 스윕 (globals.css 의 generating-loader-* 키프레임 사용).
// 원본 에셋의 useState 카운터는 미사용이라 제거. 문구는 한국어 단독 관례에 따라 조정 가능하게 props 로.
export function QuantumPulseLoader({ text = "불러오는 중" }: { text?: string }) {
  return (
    <div className="generating-loader-wrapper" role="status" aria-label={text}>
      <div className="generating-loader-text" aria-hidden>
        {Array.from(text).map((ch, i) => (
          <span key={i} className="generating-loader-letter" style={{ animationDelay: `${i * 0.1}s` }}>
            {ch === " " ? " " : ch}
          </span>
        ))}
      </div>
      <div className="generating-loader-bar" aria-hidden />
    </div>
  );
}
