package com.vitalguard.field.ui.site

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vitalguard.field.R
import com.vitalguard.field.data.models.*
import com.vitalguard.field.ui.theme.*

@Composable
fun SiteScreen(state: SiteSummaryState, onRefresh: () -> Unit = {}, onNextStage: () -> Unit = {}) {
    val data = state.data
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .testTag("site-summary-scroll").padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("현장 요약", style = MaterialTheme.typography.headlineSmall)
        SitePanel {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (state.forbidden) "마지막 수신 정보 표시 불가 · 접근 권한 없음" else siteStatusReceipt(data?.fetchedAt),
                    Modifier.testTag("site-receipt"))
                if (state.loading) Text(if (data == null) "갱신 중 · 첫 자료를 기다리고 있습니다"
                    else "갱신 중 · 수신 완료 전까지 이전 자료를 표시합니다")
                if (state.stale) Text("오래된 자료 · 마지막 수신 후 5분 이상 지났습니다",
                    Modifier.testTag("site-stale"), fontWeight = FontWeight.Bold)
                if (state.forbidden) {
                    Text(siteForbiddenMessage, Modifier.testTag("site-forbidden"))
                    Text("권한이 바뀌었으면 새로고침을 눌러 다시 조회합니다.")
                } else if (state.failed) {
                    Text(if (data == null) "수신 실패 · 연결 상태를 확인하고 새로고침해 주세요"
                        else "갱신 실패 · 이전에 받은 자료입니다. 연결 상태를 확인해 주세요",
                        Modifier.testTag("site-refresh-error"))
                }
                Spacer(Modifier.height(8.dp))
                Button(onRefresh, Modifier.heightIn(min = vgTapPrimary).testTag("site-refresh"), enabled = !state.loading) {
                    VgIcon(R.drawable.ic_refresh)
                    Spacer(Modifier.width(8.dp))
                    Text("새로고침")
                }
            }
        }
        SitePanel(Modifier.testTag("site-signals")) {
            Column {
                val entries = listOf(
                    Triple("weather", "기상", data?.weather),
                    Triple("workers", "작업자", data?.workers),
                    Triple("gas", "가스", data?.gas),
                    Triple("aed", "AED", data?.aed),
                )
                entries.forEachIndexed { index, (id, title, section) ->
                    if (index > 0) HorizontalDivider(color = VgColors.hairlineStrong)
                    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).testTag("site-row-$id")
                        .clickable(enabled = !state.forbidden, onClick = onNextStage)
                        .padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        SignalMark(if (state.forbidden) null else section?.level)
                        Spacer(Modifier.width(16.dp))
                        Text(buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("$title  ") }
                            append(if (state.forbidden) "접근 권한 없음" else signalText(id, section))
                        }, Modifier.weight(1f))
                        if (!state.forbidden) VgIcon(R.drawable.ic_chevron_right)
                    }
                }
            }
        }
        SitePanel(Modifier.testTag("site-alerts")) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("미대응 경보", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text(if (state.forbidden) "접근 권한 없음" else alertsText(data?.alerts))
                if (!state.forbidden && data?.alerts?.ok == true) {
                    Text(when (data.alerts.siteScoped) {
                        false -> "전체 현장 기준 · 이 현장만의 경보 수가 아닙니다"
                        true -> "이 현장 기준"
                        null -> "경보 집계 범위 확인 불가"
                    })
                }
            }
        }
        SitePanel {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("현장 CCTV", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text("CAM-03 · 스냅샷 갱신 영상")
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onNextStage, Modifier.heightIn(min = vgTapMin).testTag("site-open-cctv")) {
                    VgIcon(R.drawable.ic_video)
                    Spacer(Modifier.width(8.dp))
                    Text("영상 보기")
                }
            }
        }
    }
}

@Composable
private fun SitePanel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(vgRadiusCard), color = VgColors.canvas,
        border = BorderStroke(1.dp, VgColors.hairlineStrong), content = content)
}

@Composable
fun SignalMark(level: String?) {
    val (symbol, label, color) = when (level) {
        "normal" -> Triple("✓", "정상", VgColors.ok)
        "warn" -> Triple("!", "주의", VgColors.warn)
        "danger" -> Triple("!!", "위험", VgColors.danger)
        "idle" -> Triple("—", "데이터 없음 또는 전원 대기", VgColors.surfaceStrong)
        else -> Triple("?", "상태 확인 불가", VgColors.surfaceStrong)
    }
    val shape = if (level == "danger") CircleShape else RoundedCornerShape(6.dp)
    // 글자를 확대해도 위험 표식이 타원/캡슐로 변하지 않도록 정사각형을 유지한다.
    val side = (24f * LocalDensity.current.fontScale + 8f).coerceAtLeast(32f).dp
    Box(Modifier.size(side)
        .clip(shape).background(color).border(1.dp, VgColors.ink, shape)
        .clearAndSetSemantics { contentDescription = label }.padding(4.dp), contentAlignment = Alignment.Center) {
        Text(symbol, color = VgColors.ink, fontWeight = FontWeight.Bold)
    }
}
