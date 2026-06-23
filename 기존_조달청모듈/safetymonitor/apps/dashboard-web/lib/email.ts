// Resend HTTP API로 회원가입 인증 메일을 발송하는 클라이언트(의존성 0 — fetch만 사용).
// RESEND_API_KEY 미설정 시: 개발 환경에선 콘솔 출력 + devCode 반환(로컬/데모용), 운영에선 실패.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// 발신 주소 — Resend 검증 도메인 필요. 미설정 시 Resend 테스트 발신주소 사용(가입 계정 본인 메일로만 발송 가능).
function fromAddress(): string {
  return process.env.EMAIL_FROM || "VitAlGuard <onboarding@resend.dev>";
}

function verificationHtml(code: string): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 8px">VitAlGuard 관리자 회원가입 인증</h2>
      <p style="margin:0 0 16px;color:#444">아래 인증번호를 회원가입 화면에 입력해주세요. 유효시간은 10분입니다.</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#f1f5f9;border-radius:12px">${code}</div>
      <p style="margin:16px 0 0;color:#888;font-size:12px">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
    </div>`;
}

export type SendResult = { ok: boolean; error?: string; devCode?: string };

// 인증번호 메일 발송. 성공/실패와 (개발 폴백 시) devCode 를 반환.
export async function sendVerificationEmail(
  to: string,
  code: string,
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;

  // 키 미설정 — 개발 환경은 콘솔로 코드 노출(실발송 없이 흐름 검증), 운영은 미구성 오류.
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "이메일 발송이 구성되지 않았습니다." };
    }
    // eslint-disable-next-line no-console
    console.log(`[email:dev] ${to} 인증번호 = ${code}`);
    return { ok: true, devCode: code };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject: "[VitAlGuard] 관리자 회원가입 인증번호",
        html: verificationHtml(code),
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `메일 발송 실패(${res.status})` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "메일 발송 중 오류가 발생했습니다." };
  }
}
