// 로그인 전체화면 — 기본은 QR(폰이 스캔해 /pair 에서 승인), [직접 입력] 이면 아이디·비밀번호 칸(Wear 시스템 입력)
package com.vitalguard.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Text
import kotlin.math.floor
import kotlin.math.min

/** 로그인 수단. 기본 = QR(08-29 사용자 지시 "로그인 방법을 QR 로 변경") · 직접 입력은 폰이 없을 때의 예비 경로. */
enum class LoginMode { QR, MANUAL }

/**
 * QR 흐름 단계 — 서버 start/poll 결과를 MainActivity 가 여기로 옮긴다(화면은 서버를 모른다).
 * ★ `IDLE` = 아직 시작 안 함(2026-09-09). 로그인이 페이저 0번 면이 되면서 **QR 이 도는 중인지**를
 *   화면이 알아야 한다 — 이 구분이 없으면 로그인을 마친 뒤 0번 면에 머물 때
 *   `LOADING` 으로 읽혀 화면 깨우기(R-16)가 영영 안 풀린다.
 */
enum class QrPhase { IDLE, LOADING, WAITING, APPROVED, EXPIRED, ERROR }

/**
 * QR 모드가 그리는 데 필요한 전부.
 * `qrRows` 는 서버 `qrMatrix.rows`('1' = 검은 칸) 를 **그대로** 든다 — 워치엔 QR 라이브러리도 변환 계층도 없다.
 * `secondsLeft` 는 상태값이다. 화면이 시계를 읽으면 스크린샷 검증이 비결정이 된다(TimeText 전례).
 */
data class QrLoginUiState(
    val phase: QrPhase = QrPhase.IDLE,
    val code: String = "",
    val qrSize: Int = 0,
    val qrRows: List<String> = emptyList(),
    val secondsLeft: Int = 0,
    val error: String? = null,
)

/** 화면이 그리는 데 필요한 전부 — 서버·인텐트를 모르므로 미리보기가 그대로 렌더한다. */
data class LoginUiState(
    val mode: LoginMode = LoginMode.QR,
    val qr: QrLoginUiState = QrLoginUiState(),
    val id: String = "",
    /** ⚠ 원문을 그대로 든다. **화면에는 절대 원문을 그리지 않는다**(masked 로만 그린다). */
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
)

/** 비밀번호 표시 — 길이만 알려준다. 빈 값이면 안내 문구. */
internal fun maskedPassword(password: String): String =
    if (password.isEmpty()) "" else "●".repeat(password.length.coerceAtMost(12))

/** 만료 카운트다운 `m:ss`. 음수는 0 으로. */
internal fun countdownText(secondsLeft: Int): String {
    val s = secondsLeft.coerceAtLeast(0)
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}

/** QR 주변 여백(모듈 수). ISO 18004 권장 4 — 흰 카드 안쪽에 두어 검정 화면과의 경계가 QR 을 흐리지 않게 한다. */
internal const val QR_QUIET_MODULES = 4

@Composable
fun LoginScreen(
    state: LoginUiState,
    onEditId: () -> Unit,
    onEditPassword: () -> Unit,
    onSubmit: () -> Unit,
    onCancel: () -> Unit,
    onQrRefresh: () -> Unit = {},
    onSwitchMode: () -> Unit = {},
) {
    when (state.mode) {
        LoginMode.QR -> QrLoginPane(state.qr, onRefresh = onQrRefresh, onManual = onSwitchMode, onCancel = onCancel)
        LoginMode.MANUAL -> ManualLoginPane(state, onEditId, onEditPassword, onSubmit, onCancel)
    }
}

/**
 * 페이저 0번 — **로그인/로그아웃 면**(2026-09-09 사용자 지시). 종전에 맨 끝 설정 면이던 것을
 * 여기로 **옮겨 왔다**(맨 끝에 남기지 않는다 — 08-26 의 "설정은 맨 아래" 지시를 09-09 지시가 대체한다).
 * QR 이 도는 동안만 QR 면으로 갈아 끼운다.
 *
 * ⚠ 여기서 QR 을 **자동으로 시작하지 않는다.** 0번은 앱을 열면 늘 보이는 면이라 자동 시작하면
 *   QR 수명(≈5분) 내내 `FLAG_KEEP_SCREEN_ON` 이 걸린다 — R-16 의 화면 깨우기가 이 면에 붙어 있다.
 * ⚠ **직접 입력은 이 면에 두지 않는다.** `ManualLoginPane` 은 세로 스크롤 목록이라
 *   세로 페이저 안에서 스크롤과 페이지 넘김이 같은 제스처를 다툰다 — 전체화면으로 띄운다.
 *   (페이저 안 나머지 면은 전부 비스크롤 고정 레이아웃이라 지금까지 이 충돌이 없었다.)
 */
@Composable
fun LoginPage(
    state: LoginUiState,
    workerName: String?,
    workerId: String?,
    onStart: () -> Unit,
    onLogout: () -> Unit,
    onManual: () -> Unit,
    onCancel: () -> Unit,
) {
    if (state.qr.phase != QrPhase.IDLE) {
        QrLoginPane(state.qr, onRefresh = onStart, onManual = onManual, onCancel = onCancel)
        return
    }
    SettingsPage(workerName = workerName, workerId = workerId, onLogin = onStart, onLogout = onLogout)
}

// ── QR 모드 ───────────────────────────────────────────────────────────────────

/**
 * 세로 예산(226dp 원형) = 안내 13 + 카드 140 + 코드 20 + 버튼 24 + 간격 10 ≈ 207dp.
 * 카드 140dp 가 한 화면 배치의 상한이다 — 위 모서리 반경 √(70²+88²) ≈ 112.4 < 113(화면 반지름) 이고,
 * 버튼 줄 바닥(y≈+104) 의 현 폭이 88dp 라 [직접 입력]+[취소] 가 딱 들어간다. 더 키우려면 코드·버튼을
 * 다른 화면으로 빼야 한다. 41×41 + 여백 8 = 49칸 → 칸 ≈ 2.86dp ≈ 6.1px(340dpi) · QR 본체 ≈ 19mm.
 * 실기에서 판독이 불안하면 여백 2모듈(+8%)·ECC L(+9%) 순으로 키운다(둘 다면 +18%).
 *
 * ★ 카드는 화면 지름에서 유도한다 — `min(140, 지름 − 78)`. 워치8 40mm(실측 438px·340dpi = 206dp)는
 * 128dp: 고정 140 이면 스택(207dp)이 화면을 넘쳐 안내줄이 원 밖으로 밀리고(08-31 실기에서 양끝 잘림)
 * 카드 대각 quiet zone 도 4→1.7모듈로 깎인다. 128 이면 안내줄 현 폭 ≥ 문구 폭, quiet 4모듈이 원 안에
 * 온전히 남는다(칸 ≈ 5.5px · QR 본체 ≈ 16mm — 판독 여유 유지). 226dp 이상은 종전 140 그대로.
 */
@Composable
private fun QrLoginPane(qr: QrLoginUiState, onRefresh: () -> Unit, onManual: () -> Unit, onCancel: () -> Unit) {
    val dim = qr.phase == QrPhase.EXPIRED || qr.phase == QrPhase.ERROR
    // 워치8 40mm(206dp)=128 · 워치9 44mm(226dp)=140 — 근거는 위 doc 주석.
    val cardDp = min(140, LocalConfiguration.current.screenHeightDp - 78).dp
    Column(
        modifier = Modifier.fillMaxSize().background(VgColors.Background),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // 위 안내줄은 원의 상단 현(弦)이라 폭이 ~119dp 뿐이다 — 짧은 문구만 둔다.
        //   긴 오류 문구는 카드 자리(140dp · 줄바꿈 가능)에 넣는다(08-29 프리뷰에서 상단 잘림 실측).
        val (hint, hintColor) = when (qr.phase) {
            QrPhase.IDLE -> "로그인" to VgColors.Secondary
            QrPhase.LOADING -> "잠시만요" to VgColors.Secondary
            QrPhase.WAITING -> "폰으로 스캔 · ${countdownText(qr.secondsLeft)}" to VgColors.Secondary
            QrPhase.APPROVED -> "승인됨 · 로그인 중…" to VgColors.Normal
            QrPhase.EXPIRED -> "만료됨 — 다시 발급하세요" to VgColors.Caution
            QrPhase.ERROR -> "오류" to VgColors.Danger
        }
        Text(hint, color = hintColor, fontSize = 10.sp, textAlign = TextAlign.Center, maxLines = 1)

        val placeholder = when (qr.phase) {
            QrPhase.LOADING -> "코드 받는 중…" to VgColors.Secondary
            QrPhase.ERROR -> (qr.error ?: "코드를 받지 못했습니다.") to VgColors.Danger
            else -> null
        }
        QrCard(
            qr.qrSize, qr.qrRows, placeholder,
            Modifier.padding(top = 2.dp).size(cardDp).alpha(if (dim && qr.qrSize > 0) 0.35f else 1f),
        )

        Text(
            qr.code,
            color = if (dim) VgColors.Idle else VgColors.Primary,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 2.sp,
            modifier = Modifier.padding(top = 4.dp).height(20.dp),
        )

        Row(modifier = Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            when (qr.phase) {
                QrPhase.EXPIRED -> SmallPill("재발급", VgColors.Normal, Color.Black, onRefresh)
                QrPhase.ERROR -> SmallPill("다시 시도", VgColors.Normal, Color.Black, onRefresh)
                else -> SmallPill("직접 입력", VgColors.Pill, VgColors.Primary, onManual)
            }
            Spacer(Modifier.width(8.dp))
            SmallPill("취소", VgColors.Pill, VgColors.Primary, onCancel)
        }
    }
}

/**
 * 흰 카드 위 검은 칸. ⚠ 검정 배경에 흰 칸(반전 QR)으로 그리지 않는다 — 폰 카메라 앱이 못 읽는 경우가 있다.
 * 칸 크기는 **정수 px 로 내림**해 모든 칸이 픽셀 격자에 딱 맞게 한다(안티앨리어스 경계선이 판독을 흐린다).
 */
@Composable
internal fun QrCard(
    size: Int,
    rows: List<String>,
    placeholder: Pair<String, Color>? = null,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier.clip(RoundedCornerShape(8.dp)).background(if (size > 0) Color.White else VgColors.Divider),
        contentAlignment = Alignment.Center,
    ) {
        if (size <= 0) {
            placeholder?.let { (msg, color) ->
                Text(msg, color = color, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(12.dp))
            }
            return@Box
        }
        Canvas(Modifier.fillMaxSize()) {
            val cells = size + 2 * QR_QUIET_MODULES
            val cell = floor(this.size.minDimension / cells)
            val x0 = floor((this.size.width - cell * cells) / 2f) + cell * QR_QUIET_MODULES
            val y0 = floor((this.size.height - cell * cells) / 2f) + cell * QR_QUIET_MODULES
            rows.take(size).forEachIndexed { r, row ->
                // 가로로 이어진 검은 칸은 사각형 하나로 — 그리기 호출 수가 1/3 로 준다.
                var c = 0
                while (c < size) {
                    if (row.getOrNull(c) != '1') { c++; continue }
                    val start = c
                    while (c < size && row.getOrNull(c) == '1') c++
                    drawRect(Color.Black, Offset(x0 + start * cell, y0 + r * cell), Size((c - start) * cell, cell))
                }
            }
        }
    }
}

@Composable
private fun SmallPill(label: String, bg: Color, fg: Color, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .height(24.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = fg, fontSize = 11.sp, maxLines = 1) }
}

// ── 직접 입력 모드 ─────────────────────────────────────────────────────────────

@Composable
private fun InputRow(label: String, shown: String, placeholder: String, enabled: Boolean, onTap: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .border(1.dp, VgColors.Divider, RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onTap)
            .padding(horizontal = 12.dp, vertical = 5.dp),
    ) {
        Text(label, color = VgColors.Secondary, fontSize = 9.sp)
        Text(
            shown.ifEmpty { placeholder },
            color = if (shown.isEmpty()) VgColors.Idle else VgColors.Primary,
            fontSize = 14.sp,
        )
    }
}

@Composable
private fun ManualLoginPane(
    state: LoginUiState,
    onEditId: () -> Unit,
    onEditPassword: () -> Unit,
    onSubmit: () -> Unit,
    onCancel: () -> Unit,
) {
    TransformingLazyColumn(
        modifier = Modifier.fillMaxSize().background(VgColors.Background),
        horizontalAlignment = Alignment.CenterHorizontally,
        // ★ 세로 패딩이 없으면 첫 줄과 마지막 버튼이 둥근 가장자리에 잘린다(08-29 프리뷰·실기 대조).
        //   위아래 22dp 를 비우고 칸·버튼을 낮춰 제목·칸 2·[취소|로그인] 이 한 화면(226dp)에 들어온다.
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 22.dp),
    ) {
        item { Text("VitAlGuard", color = VgColors.Primary, fontSize = 14.sp, modifier = Modifier.padding(bottom = 2.dp)) }
        item { InputRow("아이디", state.id, "탭하여 입력", !state.busy, onEditId) }
        item { InputRow("비밀번호", maskedPassword(state.password), "탭하여 입력", !state.busy, onEditPassword) }
        state.error?.let { msg ->
            item {
                Text(
                    msg,
                    color = VgColors.Danger,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        // ★ 취소·로그인을 **반폭으로 한 줄에**(08-29 사용자 결정 ①B) — 다섯 항목을 세로로 쌓으면 226dp 화면에
        //   안 들어가 취소가 스크롤 아래로 숨었다. 워치 표준 뒤로가기(가로 스와이프)는 이 앱에서 앱을 닫으므로
        //   취소 버튼은 화면 안에 있어야 한다. 아래쪽은 둥근 화면이 좁아 버튼 하나가 ~70dp 지만 글자는 들어간다.
        item {
            Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                Button(
                    onClick = onCancel,
                    enabled = !state.busy,
                    label = { Text("취소", fontSize = 13.sp, color = VgColors.Primary) },
                    colors = ButtonDefaults.buttonColors(containerColor = VgColors.Pill),
                    modifier = Modifier.weight(1f).height(40.dp),
                )
                Spacer(Modifier.width(6.dp))
                Button(
                    onClick = onSubmit,
                    enabled = !state.busy,
                    label = {
                        Text(
                            if (state.busy) "확인 중…" else "로그인",
                            fontSize = 13.sp,
                            color = Color.Black,
                        )
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = VgColors.Normal),
                    modifier = Modifier.weight(1f).height(40.dp),
                )
            }
        }
    }
}
