package com.vitalguard.field

// Ports: login_connection_test.dart, common_states_test.dart(인증), nav_rail_test.dart,
// site_screen_test.dart, settings_test.dart(자리 화면 범위). widget_test.dart는 진단 화면 대신 메인 진입 smoke로 한정.
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.session.FieldCoordinator
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.time.Instant

private class UiGateway : MockGateway() {
    @Volatile var forbidden = false
    @Volatile var failSection: String? = null
    @Volatile var statusCalls = 0
    override suspend fun siteStatus(accessToken: String): SiteStatus {
        statusCalls++
        if (forbidden) throw ApiFailure("private", status = 403)
        val reply = mockSiteStatusReply(Instant.now().toString()).toMutableMap()
        failSection?.let { reply[it] = mapOf("ok" to false, "error" to "private") }
        return SiteStatus(reply)
    }
}

@RunWith(AndroidJUnit4::class)
class FieldAppComposeTest {
    private lateinit var gateway: UiGateway
    private lateinit var controller: FieldController
    private val compose = createAndroidComposeRule<MainActivity>()
    private val graph = object : ExternalResource() {
        override fun before() {
            gateway = UiGateway()
            val application = ApplicationProvider.getApplicationContext<FieldApplication>()
            application.captureEnabledForTests = false
            application.controllerFactoryForTests = { scope ->
                FieldCoordinator(gateway, MemoryStore(), scope).also { controller = it }
            }
            application.internetProbeForTests = InternetProbe { false }
        }
        override fun after() {
            val application = ApplicationProvider.getApplicationContext<FieldApplication>()
            application.captureEnabledForTests = null
            application.controllerFactoryForTests = null
            application.internetProbeForTests = null
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(graph).around(compose)

    private fun credentials(id: String = "demo", password: String = "mock") {
        compose.waitUntil(5_000) { controller.state.value.authStage == AuthStage.login }
        compose.onNodeWithTag("login-id").performScrollTo().performTextInput(id)
        compose.onNodeWithTag("login-password").performScrollTo().performTextInput(password)
        compose.onNodeWithTag("auth-submit").performScrollTo().assertHeightIsAtLeast(64.dp).performClick()
    }
    private fun login() {
        credentials()
        compose.waitUntil(5_000) { controller.state.value.authStage == AuthStage.ready && controller.state.value.siteStatusSnapshot != null }
    }
    private fun select(index: Int) = compose.onNodeWithTag("rail-destination-$index").performScrollTo().performClick()

    @Test fun mainStartsAtLoginAndMockTotpSurvivesActivityRecreation() {
        compose.onNodeWithTag("mock-label").assertExists()
        credentials("totp")
        compose.waitUntil(5_000) { controller.state.value.authStage == AuthStage.totp }
        compose.onNodeWithText("2단계 인증").assertExists()
        compose.onNodeWithTag("totp-code").performScrollTo().performTextInput("123")
        compose.activityRule.scenario.recreate()
        compose.onNodeWithTag("totp-code").performScrollTo().assertTextContains("123")
        compose.onNodeWithTag("totp-code").performTextInput("456")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(5_000) { controller.state.value.authStage == AuthStage.ready }
        compose.onNodeWithText("현장 요약").assertExists()
    }
    @Test fun deniedAccountAndWrongPasswordCanReturnToLogin() {
        credentials("demo", "wrong")
        compose.onNodeWithTag("auth-message").assertTextEquals("모의 비밀번호는 mock입니다")
        compose.onNodeWithTag("login-password").assertTextContains("")
        compose.onNodeWithTag("login-id").performTextClearance()
        compose.onNodeWithTag("login-id").performTextInput("worker")
        compose.onNodeWithTag("login-password").performTextInput("mock")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(5_000) { controller.state.value.authStage == AuthStage.denied }
        compose.onNodeWithText("다른 계정으로 로그인").performScrollTo().performClick()
        compose.onNodeWithTag("login-id").assertExists()
    }
    @Test fun railToggleDestinationsReceiptAndSelectionRemainUsable() {
        login()
        val initiallyCollapsed = compose.onAllNodesWithTag("rail-collapsed").fetchSemanticsNodes().isNotEmpty()
        compose.onNodeWithTag("rail-collapse-toggle").performScrollTo().assertHeightIsAtLeast(56.dp).performClick()
        compose.onNodeWithTag(if (initiallyCollapsed) "rail-expanded" else "rail-collapsed")
            .assertWidthIsEqualTo(if (initiallyCollapsed) 256.dp else 80.dp)
        for ((index, title) in listOf(1 to "경보", 2 to "기록", 3 to "전송 상태", 4 to "설정")) {
            select(index)
            when (index) {
                2 -> compose.onNodeWithTag("record-pending-list").assertExists()
                3 -> compose.onNodeWithTag("outbox-list").assertExists()
                else -> {
                    compose.onNodeWithTag("placeholder-$index").assertExists()
                    compose.onNodeWithText("다음 단계에서 옮깁니다").assertExists()
                }
            }
            compose.onNodeWithTag("rail-destination-$index").assertIsSelected().assertHeightIsAtLeast(56.dp)
            compose.onNodeWithTag("rail-selection-dot", useUnmergedTree = true).assertExists()
            if (index >= 2) compose.onNodeWithTag("shell-receipt")
                .assertTextEquals("전송 전 기록은 기기에 보관 · 전송한 기록은 관제웹에서 봅니다")
        }
        select(0)
        compose.onNodeWithTag("shell-receipt").assertTextContains("마지막 수신", substring = true)
    }
    @Test fun summaryShowsIndependentRowsAndNextStageActions() {
        gateway.failSection = "gas"
        login()
        for (id in listOf("weather", "workers", "gas", "aed")) {
            compose.onNodeWithTag("site-row-$id").performScrollTo().assertHeightIsAtLeast(72.dp)
        }
        compose.onNodeWithText("작업자  정상 12명 · 대기 0명", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("가스  수신 실패 · 이 항목의 상태를 확인할 수 없습니다", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("미대응 경보 0건").assertExists()
        compose.onNodeWithTag("site-row-weather").performScrollTo().performClick()
        compose.onNodeWithText("다음 단계").assertExists()
        compose.onNodeWithTag("site-open-cctv").performScrollTo().assertHeightIsAtLeast(56.dp).performClick()
        compose.onNodeWithText("현장 CCTV").assertExists()
    }
    @Test fun forbiddenRemovesPreviousValuesAndManualRefreshRecovers() {
        login()
        gateway.forbidden = true
        compose.onNodeWithTag("site-refresh").performScrollTo().performClick()
        compose.waitUntil(5_000) { controller.state.value.siteStatusForbidden }
        compose.onNodeWithTag("site-forbidden").assertExists()
        compose.onNodeWithText("권한이 바뀌었으면 새로고침을 눌러 다시 조회합니다.").assertExists()
        compose.onNodeWithTag("shell-receipt").assertTextEquals("마지막 수신 정보 표시 불가 · 접근 권한 없음")
        compose.onNodeWithText("미대응 경보 0건").assertDoesNotExist()
        val calls = gateway.statusCalls
        select(4); select(0)
        compose.runOnIdle { assertEquals(calls, gateway.statusCalls) }
        gateway.forbidden = false
        compose.onNodeWithTag("site-refresh").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(5_000) { !controller.state.value.siteStatusForbidden }
        compose.onNodeWithTag("site-forbidden").assertDoesNotExist()
    }
    @Test fun selectedTabAndSiteScrollSurviveTabSwitchAndRecreation() {
        login()
        compose.onNodeWithTag("site-open-cctv").performScrollTo().assertIsDisplayed()
        select(4)
        compose.activityRule.scenario.recreate()
        compose.onNodeWithTag("placeholder-4").assertExists()
        select(0)
        compose.onNodeWithTag("site-open-cctv").assertIsDisplayed()
        assertEquals(AuthStage.ready, controller.state.value.authStage)
    }
}
