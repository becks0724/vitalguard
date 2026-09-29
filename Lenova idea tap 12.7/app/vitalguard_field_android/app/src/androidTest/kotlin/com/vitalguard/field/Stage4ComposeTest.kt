package com.vitalguard.field

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.*
import com.vitalguard.field.data.cctv.CCTV_PERIOD_PREFERENCE_KEY
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class Stage4ComposeTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private lateinit var field: FieldCoordinator
    private val local = MemoryStore()
    private val graph = object : ExternalResource() {
        override fun before() {
            val app = ApplicationProvider.getApplicationContext<FieldApplication>()
            app.captureEnabledForTests = false
            app.controllerFactoryForTests = { scope -> FieldCoordinator(MockGateway(), local, scope).also { field = it } }
        }
        override fun after() {
            val app = ApplicationProvider.getApplicationContext<FieldApplication>()
            app.controllerFactoryForTests = null; app.captureEnabledForTests = null
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(graph).around(compose)
    private fun login(account: String) {
        compose.waitUntil(5000) { field.state.value.authStage == AuthStage.login }
        compose.onNodeWithTag("login-id").performScrollTo().performTextReplacement(account)
        compose.onNodeWithTag("login-password").performScrollTo().performTextInput("mock")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(5000) { field.state.value.siteStatusSnapshot != null }
    }
    private fun settings() = compose.onNodeWithTag("rail-destination-4").performScrollTo().performClick()
    private fun assertRailSide(onRight: Boolean) {
        val rail = compose.onAllNodes(hasTestTag("rail-expanded") or hasTestTag("rail-collapsed"))
            .fetchSemanticsNodes().single().boundsInRoot
        val content = compose.onNodeWithTag("shell-content").fetchSemanticsNode().boundsInRoot
        if (onRight) assertTrue(rail.left >= content.right) else assertTrue(rail.right <= content.left)
    }
    @Test fun settingsPersistAcrossRecreationAndDoNotLeakToAnotherAccount() {
        login("settings-a"); settings()
        val bothHands = compose.onNodeWithTag("work-hand-selector").fetchSemanticsNode().boundsInRoot
        val leftHand = compose.onNodeWithTag("action-side-left").fetchSemanticsNode().boundsInRoot
        val rightHand = compose.onNodeWithTag("action-side-right").fetchSemanticsNode().boundsInRoot
        assertEquals(bothHands.width, bothHands.height, 1f)
        assertTrue(leftHand.width > 0 && rightHand.width > 0 && leftHand.right <= rightHand.left)
        assertTrue(leftHand.left >= bothHands.left && rightHand.right <= bothHands.right)
        compose.onNodeWithTag("action-side-left").performScrollTo().performClick()
        compose.waitUntil(5000) { runBlocking { local.read("settings-a", vgActionSidePreferenceKey) == "left" } }
        assertRailSide(onRight = true)
        compose.onNodeWithTag("cctv-period-slider").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.SetProgress) { it(0f) }
        compose.waitUntil(5000) { runBlocking { local.read("settings-a", CCTV_PERIOD_PREFERENCE_KEY) == "0" } }
        compose.activityRule.scenario.recreate()
        settings()
        compose.onNodeWithTag("action-side-left").assertIsSelected()
        assertRailSide(onRight = true)
        compose.onNodeWithTag("cctv-period-slider").assert(androidx.compose.ui.test.SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, "실시간"))
        compose.runOnIdle { ViewModelProvider(compose.activity)[FieldViewModel::class.java].shell.logout() }
        login("settings-b"); settings()
        compose.onNodeWithTag("action-side-right").assertIsSelected()
        assertRailSide(onRight = false)
        compose.onNodeWithTag("cctv-period-slider").assert(androidx.compose.ui.test.SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, "2초"))
        assertEquals("left", runBlocking { local.read("settings-a", vgActionSidePreferenceKey) })
        assertNull(runBlocking { local.read("settings-b", vgActionSidePreferenceKey) })
        assertEquals("0", runBlocking { local.read("settings-a", CCTV_PERIOD_PREFERENCE_KEY) })
        assertNull(runBlocking { local.read("settings-b", CCTV_PERIOD_PREFERENCE_KEY) })
    }
    @Test fun selectionWorksWhileOfflineAndMovesTheSharedActionPlacement() {
        login("settings-offline"); settings()
        compose.runOnIdle { runBlocking { field.connectivityChanged(false) } }
        compose.onNodeWithTag("cctv-period-slider").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.SetProgress) { it(500f) }
        compose.waitUntil(5000) { runBlocking { local.read("settings-offline", CCTV_PERIOD_PREFERENCE_KEY) == "500" } }
        compose.onNodeWithTag("action-side-left").performScrollTo().performClick()
        compose.waitUntil(5000) { runBlocking { local.read("settings-offline", vgActionSidePreferenceKey) == "left" } }
        assertRailSide(onRight = true)
        compose.onNodeWithTag("action-side-left").assertIsSelected()
        compose.runOnIdle {
            val model = ViewModelProvider(compose.activity)[FieldViewModel::class.java]
            assertTrue(field.state.value.offline)
            assertEquals(ActionSide.left, model.placement.value!!.state.value.side)
        }
        compose.onNodeWithTag("rail-destination-2").performScrollTo().performClick()
        compose.onNodeWithTag("record-calendar").assertExists()
        val left = compose.onNodeWithTag("record-capture-actions").fetchSemanticsNode().boundsInRoot
        val content = compose.onNodeWithTag("shell-content").fetchSemanticsNode().boundsInRoot
        assertTrue(left.center.x < content.center.x)
        settings()
        compose.onNodeWithTag("action-side-right").performScrollTo().performClick()
        compose.waitUntil(5000) { runBlocking { local.read("settings-offline", vgActionSidePreferenceKey) == "right" } }
        assertRailSide(onRight = false)
        compose.onNodeWithTag("rail-destination-2").performScrollTo().performClick()
        val right = compose.onNodeWithTag("record-capture-actions").fetchSemanticsNode().boundsInRoot
        assertTrue(right.center.x > content.center.x)
    }
    @Test fun usageTabIsBelowSettingsAndGuideWorksOfflineWithoutOutboxInfoButton() {
        login("guide-a"); settings()
        val settingsBounds = compose.onNodeWithTag("rail-destination-4").fetchSemanticsNode().boundsInRoot
        val guideBounds = compose.onNodeWithTag("rail-destination-5").fetchSemanticsNode().boundsInRoot
        assertTrue(guideBounds.top >= settingsBounds.bottom)
        compose.runOnIdle { runBlocking { field.connectivityChanged(false) } }
        compose.onNodeWithTag("rail-destination-5").performScrollTo().performClick()
        compose.onNodeWithTag("usage-guide").assertIsDisplayed()
        compose.onNodeWithTag("shell-receipt").assertTextEquals("사용 방법")
        compose.onNodeWithTag("guide-section-transfer").performClick()
        compose.onNodeWithTag("guide-table").performScrollToNode(hasTestTag("guide-row-결과 불명"))
        compose.onNodeWithTag("guide-row-결과 불명").assertIsDisplayed()
        compose.onNodeWithTag("rail-destination-3").performScrollTo().performClick()
        compose.onNodeWithTag("outbox-guide").assertDoesNotExist()
        compose.onNodeWithTag("rail-destination-5").performScrollTo().performClick()
        compose.onNodeWithTag("guide-section-transfer").assertIsSelected()
    }

}
